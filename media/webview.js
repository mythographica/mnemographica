/* eslint-env browser */
/* global THREE, d3, acquireVsCodeApi */

(function () {
	'use strict';

	// Placeholder for vscode reference (set after acquireVsCodeApi)
	let vscodeRef = null;

	// Generate radii array for any number of generations
	// 2D: root=80, each gen adds 80px -> [80, 160, 240, ...]
	// 3D: root=105, gen1=180 (+75), gen2=245 (+65) -> [105, 180, 245, 310, ...]
	function get2D_Radii(maxDepth) {
		const radii = [];
		for (let i = 0; i <= maxDepth; i++) {
			radii.push(80 + i * 80);
		}
		return radii;
	}
	function get3D_Radii(maxDepth) {
		const radii = [];
		for (let i = 0; i <= maxDepth; i++) {
			// First jump is +75, then +65 for each subsequent
			radii.push(105 + (i === 0 ? 0 : 75 + (i - 1) * 65));
		}
		return radii;
	}

	// Send log message to extension's LoggerService
	function debugLog(message, type) {
		if (!vscodeRef) return;
		try {
			vscodeRef.postMessage({
				command: 'log',
				data: { message: String(message), type: type }
			});
		} catch (error) {
			console.log(type, message);
			console.error(error);
		}
	}

	// ===== Main Application Code =====
	debugLog('[Mnemonica] Script starting...', 'log');
	debugLog('[Mnemonica] THREE available: ' + typeof THREE, 'log');

	// Focus-animation helpers (rotate-then-zoom on sidebar click)
	function lerp(a, b, t) {
		return a + (b - a) * t;
	}
	function easeInOutCubic(t) {
		return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
	}

	// THREE's Raycaster does not skip invisible objects — walk the parent
	// chain so meshes inside a hidden layer group stop taking clicks
	function firstVisibleIntersect(intersects) {
		for (const hit of intersects) {
			let obj = hit.object;
			let visible = true;
			while (obj) {
				if (obj.visible === false) {
					visible = false;
					break;
				}
				obj = obj.parent;
			}
			if (visible) return hit;
		}
		return null;
	}

	const vscode = acquireVsCodeApi();
	vscodeRef = vscode;
	let simulation = null;
	let svg = null;
	let g = null;
	let zoom = null;
	let currentData = null;
	// 3D-only mode (2026-08, owner decision): the 2D view is retired.
	// The 2D renderer code remains below but is never entered — is3D
	// starts true and no UI flips it.
	let is3D = true;
	let renderer3D = null;
	let resizeHandler3D = null;
	let saved3DCameraState = null; // Stores camera state when switching to 2D

	// Live trace stream state (B1.5): strategy pushes dive-trace deltas
	// as 'traceEvent' messages; the counter/last-name feed the status
	// line, and matching spheres flash in 3D
	let liveTraceCount = 0;
	let liveTraceLast = null;
	let lastStatusBase = '';
	// Names that traced this session — a single click on such a sphere
	// opens trace mode (names-first tracing, 2026-08-30)
	const liveTraceNames = new Set();

	// The status line is base text ("N types | M relationships") plus,
	// once the live stream flows, a "· ⟁ live N (last: X)" suffix —
	// replaced by the isolated path while trace mode is open
	function updateStatusLine() {
		const status = document.getElementById('status');
		if (!status) return;
		let text = lastStatusBase;
		const traceNames = renderer3D && renderer3D.traceMode ? renderer3D.traceMode.names : null;
		if (traceNames) {
			const shown = traceNames.length > 4
				? traceNames[0] + ' → … → ' + traceNames.slice(-2).join(' → ')
				: traceNames.join(' → ');
			text += ' · ⟁ TRACE ' + shown;
		} else if (liveTraceCount > 0) {
			text += ' · ⟁ live ' + liveTraceCount;
			if (liveTraceLast) {
				text += ' (last: ' + liveTraceLast + ')';
			}
		}
		status.textContent = text;
	}

	function setStatusBase(text) {
		lastStatusBase = text;
		updateStatusLine();
	}

	// Initialize when DOM is ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}

	function init() {
		debugLog('[Mnemonica] DOM ready, d3 available: ' + (typeof d3 !== 'undefined'), 'log');
		debugLog('[Mnemonica] THREE available: ' + (typeof THREE !== 'undefined'), 'log');
		debugLog('[Mnemonica] Requesting data from extension...', 'log');
		setupEventListeners();
		setupLegend();
		vscode.postMessage({ command: 'ready' });
	}

	// Focus requests arriving before the renderer exists (freshly opened
	// panel — 'ready' fired but render3DGraph has not run yet) are stashed
	// here and flushed at the end of render3DGraph
	let pendingFocusNode = null;

	// Legend panel interactivity (2026-09-05 review): the header is the
	// drag handle AND the collapse toggle. A press that moves < 4px counts
	// as a click (toggle); a real drag repositions the panel. First drag
	// switches the CSS bottom-anchoring to explicit left/top — bottom
	// anchoring fights pixel dragging.
	let legendDragState = null;
	let legendSuppressClick = false;

	function setupLegend() {
		const legend = document.getElementById('dive-legend');
		const header = document.getElementById('dive-legend-header');
		const toggle = document.getElementById('dive-legend-toggle');
		if (!legend || !header) return;

		header.addEventListener('mousedown', function (event) {
			const rect = legend.getBoundingClientRect();
			legend.style.bottom = 'auto';
			legend.style.left = rect.left + 'px';
			legend.style.top = rect.top + 'px';
			legendDragState = {
				startX: event.clientX,
				startY: event.clientY,
				baseLeft: rect.left,
				baseTop: rect.top,
				moved: false
			};
			event.preventDefault();
		});

		document.addEventListener('mousemove', function (event) {
			if (!legendDragState) return;
			const dx = event.clientX - legendDragState.startX;
			const dy = event.clientY - legendDragState.startY;
			if (!legendDragState.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
			legendDragState.moved = true;
			legend.classList.add('dragging');
			const maxLeft = Math.max(0, window.innerWidth - legend.offsetWidth);
			const maxTop = Math.max(0, window.innerHeight - legend.offsetHeight);
			const nextLeft = Math.min(maxLeft, Math.max(0, legendDragState.baseLeft + dx));
			const nextTop = Math.min(maxTop, Math.max(0, legendDragState.baseTop + dy));
			legend.style.left = nextLeft + 'px';
			legend.style.top = nextTop + 'px';
		});

		document.addEventListener('mouseup', function () {
			if (legendDragState && legendDragState.moved) {
				// mouseup fires BEFORE click — swallow the trailing click so
				// a drag does not also toggle collapse
				legendSuppressClick = true;
			}
			legendDragState = null;
			legend.classList.remove('dragging');
		});

		header.addEventListener('click', function () {
			if (legendSuppressClick) {
				legendSuppressClick = false;
				return;
			}
			const collapsed = legend.classList.toggle('collapsed');
			if (toggle) {
				toggle.textContent = collapsed ? '▸' : '▾';
			}
		});
	}

	function setupEventListeners() {
		// Control buttons
		document.getElementById('zoom-in').addEventListener('click', function () {
			if (is3D && renderer3D) {
				renderer3D.zoomIn();
			} else if (svg && zoom) {
				svg.transition().call(zoom.scaleBy, 1.3);
			}
		});

		document.getElementById('zoom-out').addEventListener('click', function () {
			if (is3D && renderer3D) {
				renderer3D.zoomOut();
			} else if (svg && zoom) {
				svg.transition().call(zoom.scaleBy, 0.7);
			}
		});

		document.getElementById('reset').addEventListener('click', function () {
			if (is3D && renderer3D) {
				renderer3D.reset();
			} else {
				if (svg && zoom) svg.transition().call(zoom.transform, d3.zoomIdentity);
				if (simulation) {
					// Release all fixed positions and restart simulation briefly
					currentData.nodes.forEach(function (d) {
						d.fx = null;
						d.fy = null;
					});
					simulation.alpha(1).restart();
					// Stop after 2 seconds
					setTimeout(function () {
						if (simulation) simulation.stop();
					}, 2000);
				}
			}
		});

		// 3D-only: the mode toggle buttons no longer exist in the DOM.
	}

	function set3DMode(target3D) {
		if (is3D === target3D) return;
		// Determine what mode we're LEAVING (before flipping is3D)
		const was3D = is3D;

		// Save state of the mode we're leaving
		if (currentData) {
			if (was3D) {
				// Leaving 3D mode - save 3D coordinates
				currentData.nodes.forEach(function (node) {
					if (node.x !== undefined) node.x3d = node.x;
					if (node.y !== undefined) node.y3d = node.y;
					if (node.z !== undefined) node.z3d = node.z;
				});
				// Save 3D camera state
				if (renderer3D) {
					debugLog('Saving 3D camera state before switch...', 'log');
					saved3DCameraState = {
						cameraRotation: { ...renderer3D.cameraRotation },
						zoom: renderer3D.zoom,
						panOffset: { ...renderer3D.panOffset }
					};
					debugLog('Saved: ' + JSON.stringify(saved3DCameraState), 'log');
				}
			} else {
				// Leaving 2D mode - save 2D coordinates
				currentData.nodes.forEach(function (node) {
					if (node.x !== undefined) node.x2d = node.x;
					if (node.y !== undefined) node.y2d = node.y;
				});
			}
		}

		// NOW flip the mode
		is3D = target3D;
		const btn2d = document.getElementById('mode-2d');
		const btn3d = document.getElementById('mode-3d');
		if (btn2d) btn2d.classList.toggle('active', !is3D);
		if (btn3d) btn3d.classList.toggle('active', is3D);

		// Notify extension of mode change
		vscode.postMessage({ command: 'modeChanged', data: { mode: is3D ? '3D' : '2D' } });

		// Hide any visible tooltip
		d3.select('#tooltip').classed('visible', false);

		// Show/hide generation controls
		const genControls = document.getElementById('gen-controls');
		if (genControls) {
			genControls.style.display = is3D ? 'block' : 'none';
		}

		const container = document.getElementById('graph');

		// Clean up previous mode BEFORE clearing container
		if (simulation) {
			simulation.stop();
			simulation = null;
		}
		if (svg) {
			svg = null;
		}
		if (g) {
			g = null;
		}
		if (renderer3D) {
			renderer3D.dispose();
			renderer3D = null;
		}

		// Remove 3D resize handler
		if (resizeHandler3D) {
			window.removeEventListener('resize', resizeHandler3D);
			resizeHandler3D = null;
		}

		// NOW clear the container after cleanup
		container.innerHTML = '';

		// Re-render in new mode
		try {
			if (currentData) {
				if (is3D) {
					// Wait for THREE to be ready
					if (typeof THREE !== 'undefined') {
						render3DGraph(currentData, saved3DCameraState);
					} else {
						container.innerHTML = '<div class="loading">Loading 3D engine...</div>';
						const checkThree = setInterval(function () {
							if (typeof THREE !== 'undefined') {
								clearInterval(checkThree);
								render3DGraph(currentData, saved3DCameraState);
							}
						}, 100);
						setTimeout(function () {
							clearInterval(checkThree);
							if (typeof THREE === 'undefined') {
								container.innerHTML = '<div class="loading">3D engine failed to load (timeout)</div>';
							}
						}, 5000);
					}
				} else {
					render2DGraph(currentData);
				}
			}
		} catch (err) {
			debugLog('[Mnemonica] Error toggling mode:', err, 'error');
			container.innerHTML = '<div class="loading">Error: ' + err.message + '</div>';
		}
	}

	// Handle messages from extension
	window.addEventListener('message', function (event) {
		const message = event.data;

		if (message.command === 'updateGraph') {
			currentData = message.data;
			if (is3D) {
				render3DGraph(message.data);
			} else {
				render2DGraph(message.data);
			}
		}

		if (message.command === 'focusNode') {
			// Sidebar click → rotate the 3D camera onto the node instead
			// of jumping to the file (extension gates on 3D being visible).
			// A focus landing before the first render (freshly opened
			// panel) is stashed and flushed at the end of render3DGraph.
			if (is3D && renderer3D && message.data) {
				renderer3D.focusNode(message.data.id, message.data.name);
			} else if (message.data) {
				pendingFocusNode = message.data;
			}
		}

		if (message.command === 'traceEvent') {
			// B1.5 live illumination: strategy pushed dive-trace deltas —
			// advance the status counter and flash matching spheres
			const edges = message.data && message.data.edges;
			if (Array.isArray(edges)) {
				liveTraceCount += edges.length;
				for (const edge of edges) {
					if (!edge || typeof edge !== 'object') continue;
					const targetName = edge.instanceType ||
						(typeof edge.name === 'string' ? edge.name : null);
					if (targetName) {
						liveTraceLast = targetName;
						liveTraceNames.add(targetName);
						// dive >= 0.8.3: 'ambient' attribution is the
						// newest-wins lastContext fallback — possibly a
						// FOREIGN flow's instance. Count it (the stream is
						// alive) but never light a bulb on ambient alone:
						// attribution must be true or absent, never guessed.
						const ambient = edge.instanceSource === 'ambient';
						if (!ambient && is3D && renderer3D) {
							renderer3D.flashTraceNode(targetName);
						}
					}
				}
				updateStatusLine();
			}
		}

		if (message.command === 'traceModeEnter') {
			// Trace mode (names-first tracing): isolate the resolved
			// lineage — green path, everything else dimmed
			const data = message.data || {};
			if (is3D && renderer3D && Array.isArray(data.edges)) {
				renderer3D.enterTraceMode(data.edges, data.name);
				updateStatusLine();
			}
		}

		if (message.command === 'traceModeExtend') {
			// Mid-flight continuation: the open trace is still running
			// and these fresh edges belong to it
			const data = message.data || {};
			if (is3D && renderer3D && renderer3D.traceMode && Array.isArray(data.edges)) {
				renderer3D.extendTraceMode(data.edges);
				updateStatusLine();
			}
		}

		if (message.command === 'traceReplay') {
			// Replay (Wanted #5): isolate the trace, then re-walk its
			// spheres at human speed
			const data = message.data || {};
			if (is3D && renderer3D && Array.isArray(data.edges)) {
				renderer3D.enterTraceMode(data.edges, data.name);
				renderer3D.replayTrace(data.edges);
				updateStatusLine();
			}
		}

		if (message.command === 'queryViewState') {
			// Strategy state-query readback (B1.3): report the live
			// camera + focus so view control can read the scene before
			// rotating it
			const requestId = message.data && message.data.requestId;
			const state = {
				requestId   : requestId,
				mode        : is3D ? '3D' : '2D',
				focusedNode : null,
				camera      : null,
				nodeCount   : 0
			};
			if (renderer3D) {
				state.camera = {
					rotX : renderer3D.cameraRotation.x,
					rotY : renderer3D.cameraRotation.y,
					zoom : renderer3D.zoom,
					pan  : {
						x : renderer3D.panOffset.x,
						y : renderer3D.panOffset.y,
						z : renderer3D.panOffset.z || 0
					}
				};
				state.nodeCount = renderer3D.nodeMeshes.size;
				const focused = renderer3D.focusedMesh;
				if (focused && focused.userData.node) {
					state.focusedNode = {
						id   : focused.userData.node.id,
						name : focused.userData.node.name
					};
				}
			}
			vscode.postMessage({ command: 'viewState', data: state });
		}
	});

	// Escape leaves trace mode (names-first tracing)
	window.addEventListener('keydown', function (event) {
		if (event.key === 'Escape' && renderer3D && renderer3D.traceMode) {
			renderer3D.exitTraceMode();
			updateStatusLine();
			if (vscodeRef) {
				vscodeRef.postMessage({ command: 'traceModeExit' });
			}
		}
	});

	function render2DGraph(data) {
		debugLog('[Mnemonica] Rendering 2D graph with ' + data.nodes.length + ' nodes and ' + data.links.length + ' links', 'log');

		if (!data || data.nodes.length === 0) {
			debugLog('[Mnemonica] No data to render', 'warn');
			document.getElementById('graph').innerHTML = '<div class="loading">No type data found</div>';
			return;
		}

		// Show generation controls in 2D mode too
		const genControls = document.getElementById('gen-controls');
		if (genControls) {
			genControls.style.display = 'block';
		}

		// Check if we have saved 2D coordinates
		const hasSaved2D = data.nodes.some(n => n.x2d !== undefined && n.y2d !== undefined);

		if (!hasSaved2D) {
			// First time in 2D - calculate concentric circle positions
			calculate2DPositions(data);
		}

		// Restore 2D coordinates
		data.nodes.forEach(function (node) {
			if (node.x2d !== undefined && node.y2d !== undefined) {
				node.x = node.x2d;
				node.y = node.y2d;
			}
		});

		const container = document.getElementById('graph');
		if (!container) {
			debugLog('[Mnemonica] Graph container not found!', 'error');
			return;
		}

		container.innerHTML = '';

		const width = container.clientWidth || 800;
		const height = container.clientHeight || 600;

		debugLog('[Mnemonica] Container size:', width, 'x', height, 'log');

		// Create SVG
		svg = d3.select('#graph')
			.append('svg')
			.attr('width', width)
			.attr('height', height)
			.attr('viewBox', [0, 0, width, height])
			.style('width', '100%')
			.style('height', '100%');

		// Center the graph in the viewport - store globally for drag calculations
		const offsetX = (width - 800) / 2;
		const offsetY = (height - 600) / 2;
		window.graphOffsetX = offsetX;
		window.graphOffsetY = offsetY;
		g = svg.append('g')
			.attr('transform', 'translate(' + offsetX + ',' + offsetY + ')');

		zoom = d3.zoom()
			.scaleExtent([0.1, 4])
			.on('zoom', function (event) {
				g.attr('transform', 'translate(' + (offsetX + event.transform.x) + ',' +
					(offsetY + event.transform.y) + ') scale(' + event.transform.k + ')');
			});

		svg.call(zoom);

		// Handle resize
		window.addEventListener('resize', function () {
			if (is3D) return;
			const newWidth = container.clientWidth || 800;
			const newHeight = container.clientHeight || 600;
			svg.attr('width', newWidth).attr('height', newHeight)
				.attr('viewBox', [0, 0, newWidth, newHeight]);
			// Recenter
			const newOffsetX = (newWidth - 800) / 2;
			const newOffsetY = (newHeight - 600) / 2;
			window.graphOffsetX = newOffsetX;
			window.graphOffsetY = newOffsetY;
			g.attr('transform', 'translate(' + newOffsetX + ',' + newOffsetY + ')');
		});

		// Color scale
		const colors = ['#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f',
			'#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab'];

		// NO force simulation - use fixed concentric positions
		// Links will be updated after they're created

		// Resolve link source/target to node objects
		const nodeMap = new Map();
		data.nodes.forEach(node => {
			nodeMap.set(node.id, node);
		});
		data.links.forEach(link => {
			if (typeof link.source === 'string') {
				link.source = nodeMap.get(link.source);
			}
			if (typeof link.target === 'string') {
				link.target = nodeMap.get(link.target);
			}
		});

		// Add arrow marker
		svg.append('defs').append('marker')
			.attr('id', 'arrowhead')
			.attr('viewBox', '0 -5 10 10')
			.attr('refX', 25)
			.attr('refY', 0)
			.attr('markerWidth', 6)
			.attr('markerHeight', 6)
			.attr('orient', 'auto')
			.append('path')
			.attr('d', 'M0,-5L10,0L0,5')
			.attr('fill', 'var(--vscode-foreground)');

		// Draw links (behind nodes)
		const link = g.insert('g', ':first-child')
			.attr('class', 'links')
			.selectAll('line')
			.data(data.links)
			.enter().append('line')
			.attr('class', 'link')
			.attr('marker-end', 'url(#arrowhead)');

		// Track drag state
		let isDragging2D = false;
		let draggedNode2D = null;

		// Draw nodes
		const node = g.append('g')
			.attr('class', 'nodes')
			.selectAll('g')
			.data(data.nodes)
			.enter().append('g')
			.attr('class', 'node')
			.attr('transform', function (d) {
				return 'translate(' + d.x + ',' + d.y + ')';
			})
			.style('cursor', 'pointer');

		// Add root class to root nodes
		node.filter(function (d) { return d.isRoot; })
			.classed('root', true);

		// Node circles - uniform size
		node.append('circle')
			.attr('r', 15)
			.attr('fill', function (d) { return colors[d.depth % colors.length]; })
			.style('cursor', 'pointer');

		// Node labels
		node.append('text')
			.attr('dx', 15)
			.attr('dy', 4)
			.text(function (d) { return d.name; })
			.style('pointer-events', 'none');

		// Add drag behavior using raw mouse events
		node.on('mousedown', function (event, d) {
			event.stopPropagation();
			isDragging2D = true;
			draggedNode2D = d;
			d3.select(this).style('cursor', 'move');
		});

		// Global mouse handlers for dragging
		svg.on('mousemove', function (event) {
			if (isDragging2D && draggedNode2D) {
				const transform = d3.zoomTransform(svg.node());
				// Account for centering offset in drag calculations
				const offsetX = window.graphOffsetX || 0;
				const offsetY = window.graphOffsetY || 0;
				const x = (event.offsetX - offsetX - transform.x) / transform.k;
				const y = (event.offsetY - offsetY - transform.y) / transform.k;

				draggedNode2D.x = x;
				draggedNode2D.y = y;
				draggedNode2D.fx = x;
				draggedNode2D.fy = y;
				// Save to 2D coordinates
				draggedNode2D.x2d = x;
				draggedNode2D.y2d = y;

				// Update visual position
				const nodeSelection = node.filter(function (n) { return n.id === draggedNode2D.id; });
				nodeSelection.attr('transform', 'translate(' + x + ',' + y + ')');

				// Update links
				updateLinks();
			}
		});

		svg.on('mouseup', function () {
			isDragging2D = false;
			draggedNode2D = null;
			node.style('cursor', 'pointer');
		});

		// Single click on node - show tooltip
		node.on('click', function (event, d) {
			event.stopPropagation();
			const tooltip = d3.select('#tooltip');
			const props = (d.properties || [])
				.map(function (p) { return p.name + ': ' + p.type; })
				.join('<br>');
			const genLabel = d.depth === 0 ? 'Root' : 'Gen ' + d.depth;
			const edsLabel = d.edsStatus && d.edsStatus !== 'none' ? ' · ' + d.edsStatus : '';
			const edsEntries = d.edsEntries || [];
			const edsRows = edsEntries.map(function (e, i) {
				const site = e.parsedLocation;
				const siteHint = site ? ' ' + site.fileName.split('/').pop() + ':' + site.line : '';
				// External scope = the wrap site lives outside the type graph
				// (module scope or a non-mnemonica class); 'unknown' is
				// tactica's module-scope key.
				const scopeHint = e.scope ? ' [' + (e.scope === 'unknown' ? 'module' : e.scope) + ']' : '';
				return '<span class="eds-entry" data-eds-index="' + i + '" style="cursor:pointer;text-decoration:underline">' +
					e.kind + siteHint + scopeHint + '</span>';
			}).join('<br>');
			const loc = d.definitionLocation || d.location;
			const fileHint = loc ? '<br><span style="opacity:0.6;font-size:11px">' + loc.fileName.split('/').pop() + ':' + loc.line + '</span>' : '';
			tooltip
				.attr('data-node-id', d.id)
				.classed('visible', true)
				.html('<strong>' + d.name + '</strong><span style="float:right;opacity:0.5">' + genLabel + edsLabel + '</span>' +
					fileHint +
					(props ? '<hr>' + props : '') +
					(edsRows ? '<hr>' + edsRows : '') +
					'<br><span style="opacity:0.5;font-size:11px">Double-click to go to definition</span>')
				.style('left', (event.pageX + 10) + 'px')
				.style('top', (event.pageY - 10) + 'px');

			// Jump to the EDS (wrap/consume/hook) site on entry click
			tooltip.selectAll('.eds-entry').on('click', function (event) {
				event.stopPropagation();
				const entry = edsEntries[+this.getAttribute('data-eds-index')];
				if (entry && entry.parsedLocation) {
					d3.select('#tooltip').classed('visible', false);
					vscode.postMessage({
						command: 'goToDefinition',
						data: entry.parsedLocation
					});
				}
			});
		});

		// Double-click on node - go to definition (prefer actual define() site)
		node.on('dblclick', function (event, d) {
			event.stopPropagation();
			// Hide tooltip on navigation
			d3.select('#tooltip').classed('visible', false);
			const loc = d.definitionLocation || d.location;
			if (loc) {
				vscode.postMessage({
					command: 'goToDefinition',
					data: loc
				});
			}
		});

		svg.on('mouseleave', function () {
			isDragging2D = false;
			draggedNode2D = null;
			node.style('cursor', 'pointer');
		});

		// Click on background to close tooltip
		svg.on('click', function (event) {
			// Only close if clicking on the svg background, not a node
			if (event.target.tagName === 'svg' || event.target.id === 'graph-container') {
				d3.select('#tooltip').classed('visible', false);
			}
		});

		function updateLinks() {
			link
				.attr('x1', function (d) { return d.source.x; })
				.attr('y1', function (d) { return d.source.y; })
				.attr('x2', function (d) { return d.target.x; })
				.attr('y2', function (d) { return d.target.y; });
		}

		// Initial draw of links (no simulation, fixed positions)
		updateLinks();

		// Update status
		setStatusBase(data.nodes.length + ' types | ' +
			data.links.length + ' relationships');

		// Create generation distance controls for 2D too
		createGenControls(data, null);

		debugLog('[Mnemonica] 2D Graph rendered successfully', 'log');
	}

	/**
		* Calculate 2D concentric circle positions
		* Uses space-filling angular sectors based on subtree sizes
		* Prevents line crossings by allocating exclusive angular wedges
		*/
	function calculate2DPositions(data) {
		const layoutWidth = 800;
		const layoutHeight = 600;
		const centerX = layoutWidth / 2;
		const centerY = layoutHeight / 2;

		// Build parent-child relationships first
		const nodeMap = new Map();
		data.nodes.forEach(node => {
			nodeMap.set(node.id, node);
			node.children = [];
		});
		data.links.forEach(link => {
			const source = typeof link.source === 'object' ? link.source : nodeMap.get(link.source);
			const target = typeof link.target === 'object' ? link.target : nodeMap.get(link.target);
			if (source && target) {
				source.children.push(target);
				target.parent = source;
			}
		});

		// Fixed radii for each generation
		const maxDepth = Math.max(...data.nodes.map(n => n.depth || 0));
		const radii = get3D_Radii(maxDepth);
		const depthRadii = new Map(radii.map((r, i) => [i, r]));

		// Calculate subtree sizes (total descendants including self)
		function calculateSubtreeSize(node) {
			let size = 1; // Count self
			if (node.children && node.children.length > 0) {
				for (const child of node.children) {
					size += calculateSubtreeSize(child);
				}
			}
			node.subtreeSize = size;
			return size;
		}

		// Calculate subtree sizes for all roots
		data.nodes.filter(n => !n.parent).forEach(calculateSubtreeSize);

		// Assign angular sectors using space-filling approach
		// Each node gets [startAngle, endAngle] sector proportional to its subtree size
		function assignSectors(node, startAngle, endAngle) {
			node.startAngle = startAngle;
			node.endAngle = endAngle;
			node.angle2d = (startAngle + endAngle) / 2; // Center angle for positioning

			if (node.children && node.children.length > 0) {
				const totalChildSize = node.children.reduce((sum, c) => sum + c.subtreeSize, 0);
				const sectorSize = endAngle - startAngle;

				let currentAngle = startAngle;
				for (const child of node.children) {
					const childSectorSize = (child.subtreeSize / totalChildSize) * sectorSize;
					assignSectors(child, currentAngle, currentAngle + childSectorSize);
					currentAngle += childSectorSize;
				}
			}
		}

		// Assign sectors to roots (distribute full circle proportionally)
		const roots = data.nodes.filter(n => !n.parent);
		const totalRootSize = roots.reduce((sum, r) => sum + r.subtreeSize, 0);
		let currentAngle = 0;

		for (const root of roots) {
			const rootSectorSize = (root.subtreeSize / totalRootSize) * 2 * Math.PI;
			assignSectors(root, currentAngle, currentAngle + rootSectorSize);
			currentAngle += rootSectorSize;
		}

		// Position nodes at their center angles
		for (let depth = 0; depth <= maxDepth; depth++) {
			const nodesAtDepth = data.nodes.filter(n => (n.depth || 0) === depth);
			const radius = depthRadii.get(depth) || (105 + depth * 65);

			nodesAtDepth.forEach(node => {
				const angle = node.angle2d || 0;
				node.x2d = centerX + radius * Math.cos(angle);
				node.y2d = centerY + radius * Math.sin(angle);
			});
		}
	}

	function render3DGraph(data, initialCameraState = null) {
		debugLog('[Mnemonica] Rendering 3D graph with', data.nodes.length, 'nodes and', data.links.length, 'links', 'log');
		debugLog('render3DGraph called with initialCameraState: ' + (initialCameraState ? 'YES' : 'NO'), 'log');
		if (initialCameraState) {
			debugLog('Camera state: ' + JSON.stringify(initialCameraState), 'log');
		}

		// Show generation controls
		const genControls = document.getElementById('gen-controls');
		if (genControls) {
			genControls.style.display = 'block';
		}

		if (!data || data.nodes.length === 0) {
			debugLog('[Mnemonica] No data to render', 'warn');
			document.getElementById('graph').innerHTML = '<div class="loading">No type data found</div>';
			return;
		}

		const container = document.getElementById('graph');
		if (!container) {
			debugLog('[Mnemonica] Graph container not found!', 'error');
			return;
		}

		container.innerHTML = '';

		// Create 3D renderer
		renderer3D = new Graph3DRenderer(container, initialCameraState);
		// Debug handle: agent automation (Strategy/CDP) reads camera and
		// scene state through this
		window.__mnemographica3D = renderer3D;
		renderer3D.setOnNodeClick(function (node) {
			debugLog('[Mnemonica] 3D Node clicked:', node.name, 'log');
			const loc = node.definitionLocation || node.location;
			if (loc) {
				vscode.postMessage({
					command: 'goToDefinition',
					data: loc
				});
			}
		});
		renderer3D.renderGraph(data, d3);

		// Handle resize
		resizeHandler3D = function () {
			if (!is3D || !renderer3D) return;
			const newWidth = container.clientWidth || 800;
			const newHeight = container.clientHeight || 600;
			renderer3D.resize(newWidth, newHeight);
		};
		window.addEventListener('resize', resizeHandler3D);

		// Update status
		setStatusBase(data.nodes.length + ' types | ' +
			data.links.length + ' relationships (3D)');

		// Create the collapsible Layers & Distances panel — per-layer
		// visibility checkboxes plus that layer's own distance knobs
		createLayerControls(data, renderer3D);

		// Flush a focus request that arrived before the renderer existed
		// (Show on Graph with the panel freshly opened)
		if (pendingFocusNode) {
			const pending = pendingFocusNode;
			pendingFocusNode = null;
			renderer3D.focusNode(pending.id, pending.name);
		}

		debugLog('[Mnemonica] 3D Graph rendered successfully', 'log');
	}

	/**
		* Create the layer toggles + per-layer distance controls — one
		* COLLAPSIBLE block per layer (2026-09-05 review: "we need distances
		* for each layer type; the layer type itself must be collapsible as
		* well as clickable"). The header row carries the visibility
		* checkbox and an expand toggle; the expanded body lists that
		* layer's distance knobs with ± buttons. Any adjust re-runs
		* renderGraph (the old adjustGenRadius precedent) and rebuilds the
		* panel so cascading displays refresh. Purely local to the webview
		* (nothing posted to the extension host)
		*/
	// Knob-driven scaling of PINNED elements (2026-09-05 review): pins
	// preserve the user's arrangement through relayouts, but a distance
	// knob must still REACH them — "nothing increases the distance of
	// diamonds and bagels from sphere" otherwise. Scale the pinned
	// displacement by the knob's ratio instead of resetting to the
	// layout default: the arrangement keeps its shape, stretched.
	const scalePinnedDiamonds = function (renderer, ratio) {
		renderer.creationMeshes.forEach(m => {
			// Holder diamonds only — chain/starter nodes and arrows carry
			// no pinAnchor (resolvePinAnchor returns null for them)
			if (!m.userData.creationNode || !m.userData.pinned || !m.userData.pinAnchor || !m.userData.pinOffset) { return; }
			m.userData.pinOffset.multiplyScalar(ratio);
			m.position.copy(m.userData.pinAnchor.position).add(m.userData.pinOffset);
		});
	};
	const scalePinnedKnots = function (renderer, role, ratio) {
		renderer.internalsMeshes.forEach(m => {
			const knot = m.userData.internalNode;
			if (!knot || knot.role !== role || !m.userData.pinned) { return; }
			// Sinks anchored to the Jaeger cone scale their OFFSET — the
			// dynamics writer rewrites position from anchor + offset and
			// would snap a direct position scale back
			if (m.userData.pinAnchor && m.userData.pinOffset) {
				m.userData.pinOffset.x *= ratio;
				m.position.copy(m.userData.pinAnchor.position).add(m.userData.pinOffset);
				return;
			}
			// Sinks/Jaeger sit at −gen0 × offset — the knob governs X only
			m.position.x *= ratio;
		});
	};
	const scalePinnedAmbientBagels = function (renderer, oldBag) {
		const bag = renderer.layerDistances.dive;
		const gen0 = (renderer.depthRadii && renderer.depthRadii.get(0)) || 105;
		const nodeRadius = renderer.nodeRadius3d || 8;
		renderer.wrapperMeshes.forEach(m => {
			// Ambient pins are the anchor-less ones (resolvePinAnchor
			// found nothing at pin time); anchored bagels ride their
			// anchor and need no scaling
			if (!m.userData.wrapperNode || !m.userData.pinned || m.userData.pinAnchor) { return; }
			const generation = m.userData.wrapperNode.generation || 0;
			const oldR = gen0 * oldBag.ambientBase + generation * nodeRadius * oldBag.ambientStep;
			const newR = gen0 * bag.ambientBase + generation * nodeRadius * bag.ambientStep;
			if (oldR < 1e-9) { return; }
			// Radial scaling from the center: direction kept, the slot
			// distance follows the knob
			m.position.multiplyScalar(newR / oldR);
		});
	};

	// Expansion state lives outside: an adjust rebuilds the panel and the
	// open block must stay open across the rebuild
	const expandedLayerControls = new Set(['types']);

	function createLayerControls(data, renderer) {
		const container = document.getElementById('layer-controls-list');
		if (!container || !renderer) return;
		container.innerHTML = '';

		const maxDepth = Math.max(...data.nodes.map(n => n.depth || 0));
		const rebuild = function () {
			renderer.renderGraph(data, d3);
			createLayerControls(data, renderer);
		};

		// One distance knob: label, current-value text, adjust(delta).
		// Multipliers display as ×N.NN, shell radii as px. onChanged (when
		// given) scales the PINNED elements the knob governs, so pins
		// don't make the knob look dead
		const factorParam = function (label, group, key, step, min, onChanged) {
			const param = {
				label   : label,
				step    : step,
				display : function () {
					const value = renderer.layerDistances[group][key];
					const text = '×' + value.toFixed(2);
					return text;
				},
				adjust : function (delta) {
					const bag = renderer.layerDistances[group];
					const oldValue = bag[key];
					bag[key] = Math.max(min, Math.round((bag[key] + delta) * 100) / 100);
					if (onChanged && bag[key] !== oldValue) {
						onChanged(oldValue, bag[key]);
					}
				}
			};
			return param;
		};

		// The types layer exposes the generation shell radii themselves.
		// Adjust cascades OUTWARD (owner semantics from the old
		// adjustGenRadius): growing a shell grows every shell outside it,
		// so shells never cross
		const generationParams = [];
		for (let depth = 0; depth <= maxDepth; depth++) {
			generationParams.push({
				label   : depth === 0 ? 'Roots' : 'Gen ' + depth,
				step    : 15,
				display : function () {
					const radius = (renderer.depthRadii && renderer.depthRadii.get(depth)) || 0;
					const text = Math.round(radius) + 'px';
					return text;
				},
				adjust : function (delta) {
					// Snapshot the shell radii before the cascade —
					// user-placed spheres scale by their shell's ratio below
					const oldRadii = new Map();
					for (let d = depth; d <= maxDepth; d++) {
						oldRadii.set(d, (renderer.depthRadii && renderer.depthRadii.get(d)) || 0);
					}
					for (let d = depth; d <= maxDepth; d++) {
						const current = (renderer.depthRadii && renderer.depthRadii.get(d)) || 0;
						renderer.depthRadii.set(d, Math.max(10, current + delta));
					}
					// User-placed spheres ride the knob (2026-09-05 owner
					// review: "when I increase distances via panel it should
					// also move elements that I re-positioned, Spheres at
					// least — the direction is obvious: there where their
					// arrow directed"). A dragged sphere persists as
					// node.x3d/y3d/z3d — calculatePosition honors it and
					// relaxTypeShells never moves it — so scale the stored
					// position by the shell's radius ratio. Scaling a vector
					// keeps its direction: the sphere moves straight out/in
					// along its own radial line.
					data.nodes.forEach(node => {
						if (node.x3d === undefined) { return; }
						const nodeDepth = node.depth || 0;
						const oldR = oldRadii.get(nodeDepth);
						const newR = renderer.depthRadii.get(nodeDepth);
						if (!oldR || !newR || oldR < 1e-9) { return; }
						const ratio = newR / oldR;
						node.x3d *= ratio;
						node.y3d *= ratio;
						node.z3d *= ratio;
					});
				}
			});
		}

		const layers = [
			{ key: 'types', label: 'types', getGroup: () => renderer.typesGroup, params: generationParams },
			{
				key: 'instrumentation', label: 'instrumentation ◆', getGroup: () => renderer.instrumentationGroup,
				params: [
					factorParam('Holder ring', 'creation', 'holderShell', 0.2, 1.2,
						(oldValue, newValue) => scalePinnedDiamonds(renderer, newValue / oldValue))
				]
			},
			// Wrappers + dive internals + adapter sinks merged into the
			// single Dive graph (dive-layer-redesign-2026-09-04)
			{
				key: 'dive', label: 'dive ◯', getGroup: () => renderer.diveGroup,
				params: [
					factorParam('Ambient ring', 'dive', 'ambientBase', 0.1, 0.5,
						(oldValue) => scalePinnedAmbientBagels(renderer, { ...renderer.layerDistances.dive, ambientBase: oldValue })),
					factorParam('Ambient step', 'dive', 'ambientStep', 0.1, 0,
						(oldValue) => scalePinnedAmbientBagels(renderer, { ...renderer.layerDistances.dive, ambientStep: oldValue })),
					factorParam('Onion gap', 'dive', 'onionStep', 0.05, 0),
					factorParam('Sink offset', 'dive', 'sinkOffset', 0.1, 0.5,
						(oldValue, newValue) => scalePinnedKnots(renderer, 'sink', newValue / oldValue)),
					factorParam('Jaeger offset', 'dive', 'jaegerOffset', 0.1, 0.6,
						(oldValue, newValue) => scalePinnedKnots(renderer, 'external', newValue / oldValue))
				]
			}
		];
		layers.forEach(layer => {
			const header = document.createElement('div');
			header.className = 'gen-control-row layer-header';

			const label = document.createElement('label');
			label.className = 'gen-control-label';
			const checkbox = document.createElement('input');
			checkbox.type = 'checkbox';
			// Read the LIVE visibility — a rebuild must not lie about a
			// layer the user already hid
			const group = layer.getGroup();
			checkbox.checked = group ? group.visible : true;
			checkbox.onchange = function () {
				const liveGroup = layer.getGroup();
				if (liveGroup) {
					liveGroup.visible = checkbox.checked;
				}
				renderer.updateCenterMarkerVisibility();
				renderer.needsRender = true;
			};
			label.appendChild(checkbox);
			label.appendChild(document.createTextNode(' ' + layer.label));
			header.appendChild(label);

			const expanded = expandedLayerControls.has(layer.key);
			const toggle = document.createElement('button');
			toggle.className = 'gen-control-btn layer-toggle';
			toggle.textContent = expanded ? '▾' : '▸';
			toggle.title = 'Show/hide this layer\'s distances';
			toggle.onclick = function () {
				if (expandedLayerControls.has(layer.key)) {
					expandedLayerControls.delete(layer.key);
				} else {
					expandedLayerControls.add(layer.key);
				}
				createLayerControls(data, renderer);
			};
			header.appendChild(toggle);
			container.appendChild(header);

			if (!expanded) { return; }
			layer.params.forEach(param => {
				const row = document.createElement('div');
				row.className = 'gen-control-row layer-distance-row';

				const name = document.createElement('span');
				name.className = 'gen-control-label';
				name.textContent = param.label;
				row.appendChild(name);

				const valueDisplay = document.createElement('span');
				valueDisplay.className = 'gen-control-value';
				valueDisplay.textContent = param.display();
				row.appendChild(valueDisplay);

				const buttons = document.createElement('div');
				buttons.className = 'gen-control-buttons';

				const minusBtn = document.createElement('button');
				minusBtn.className = 'gen-control-btn';
				minusBtn.textContent = '-' + param.step;
				minusBtn.onclick = function () {
					param.adjust(-param.step);
					rebuild();
				};
				buttons.appendChild(minusBtn);

				const plusBtn = document.createElement('button');
				plusBtn.className = 'gen-control-btn';
				plusBtn.textContent = '+' + param.step;
				plusBtn.onclick = function () {
					param.adjust(param.step);
					rebuild();
				};
				buttons.appendChild(plusBtn);

				row.appendChild(buttons);
				container.appendChild(row);
			});
		});
	}

	/**
		* Create generation distance control panel
		*/
	function createGenControls(data, renderer) {
		const container = document.getElementById('gen-controls-list');
		if (!container) return;

		// Clear existing controls
		container.innerHTML = '';

		// Get max depth
		const maxDepth = Math.max(...data.nodes.map(n => n.depth || 0));

		// Create controls for each generation
		for (let depth = 0; depth <= maxDepth; depth++) {
			const row = document.createElement('div');
			row.className = 'gen-control-row';

			// Label
			const label = document.createElement('span');
			label.className = 'gen-control-label';
			label.textContent = depth === 0 ? 'Roots' : 'Gen ' + depth;
			row.appendChild(label);

			// Value display
			const valueDisplay = document.createElement('span');
			valueDisplay.className = 'gen-control-value';
			let currentRadius;
			if (window.genRadii && window.genRadii[depth] !== undefined) {
				currentRadius = window.genRadii[depth];
			} else if (is3D && renderer && renderer.depthRadii) {
				currentRadius = renderer.depthRadii.get(depth);
			} else {
				const radii2D = get2D_Radii(maxDepth);
				currentRadius = radii2D[depth] || (80 + depth * 80);
			}
			valueDisplay.textContent = Math.round(currentRadius) + 'px';
			row.appendChild(valueDisplay);

			// Buttons
			const buttons = document.createElement('div');
			buttons.className = 'gen-control-buttons';

			const minusBtn = document.createElement('button');
			minusBtn.className = 'gen-control-btn';
			minusBtn.textContent = '-15pt';
			minusBtn.onclick = function () {
				adjustGenRadius(depth, -15, renderer, valueDisplay, data);
			};
			buttons.appendChild(minusBtn);

			const plusBtn = document.createElement('button');
			plusBtn.className = 'gen-control-btn';
			plusBtn.textContent = '+15pt';
			plusBtn.onclick = function () {
				adjustGenRadius(depth, 15, renderer, valueDisplay, data);
			};
			buttons.appendChild(plusBtn);

			row.appendChild(buttons);
			container.appendChild(row);
		}
	}

	/**
		* Adjust generation radius and cascade to subsequent generations
		*/
	function adjustGenRadius(depth, delta, renderer, display, data) {
		// Initialize genRadii if not exists
		if (!window.genRadii) {
			window.genRadii = {};
		}

		// Get max depth
		const maxDepth = Math.max(...data.nodes.map(n => n.depth || 0));

		// Apply delta to this generation and all subsequent generations
		for (let d = depth; d <= maxDepth; d++) {
			// Get current or default value
			let currentValue;
			if (is3D && renderer) {
				currentValue = window.genRadii[d] !== undefined
					? window.genRadii[d]
					: renderer.depthRadii.get(d);
			} else {
				// 2D mode - use stored radii or defaults
				const radii = get2D_Radii(maxDepth);
				currentValue = window.genRadii[d] !== undefined
					? window.genRadii[d]
					: radii[d] || (80 + d * 80);
			}

			// Calculate new value (min 10px)
			const newValue = Math.max(10, currentValue + delta);
			window.genRadii[d] = newValue;

			// Update display for this generation
			const row = display.parentElement.parentElement.parentElement;
			const displays = row.parentElement.querySelectorAll('.gen-control-value');
			if (displays[d]) {
				displays[d].textContent = Math.round(newValue) + 'px';
			}

			// Update renderer's depthRadii for 3D
			if (is3D && renderer && renderer.depthRadii) {
				renderer.depthRadii.set(d, newValue);
			}
		}

		// Recalculate positions and re-render
		if (is3D && renderer) {
			renderer.renderGraph(data, d3);
		} else {
			// 2D mode - recalculate positions
			calculate2DPositionsWithRadii(data);
			// Restore coordinates and redraw
			data.nodes.forEach(node => {
				if (node.x2d !== undefined && node.y2d !== undefined) {
					node.x = node.x2d;
					node.y = node.y2d;
				}
			});
			// Re-render 2D
			render2DGraph(data);
		}
	}

	/**
		* Calculate 2D positions using stored genRadii
		* Uses space-filling angular sectors based on subtree sizes
		*/
	function calculate2DPositionsWithRadii(data) {
		const layoutWidth = 800;
		const layoutHeight = 600;
		const centerX = layoutWidth / 2;
		const centerY = layoutHeight / 2;


		// Calculate subtree sizes (total descendants including self)
		function calculateSubtreeSize(node) {
			let size = 1;
			if (node.children && node.children.length > 0) {
				for (const child of node.children) {
					size += calculateSubtreeSize(child);
				}
			}
			node.subtreeSize = size;
			return size;
		}

		// Calculate subtree sizes for all roots
		data.nodes.filter(n => !n.parent).forEach(calculateSubtreeSize);

		// Assign angular sectors
		function assignSectors(node, startAngle, endAngle) {
			node.startAngle = startAngle;
			node.endAngle = endAngle;
			node.angle2d = (startAngle + endAngle) / 2;

			if (node.children && node.children.length > 0) {
				const totalChildSize = node.children.reduce((sum, c) => sum + c.subtreeSize, 0);
				const sectorSize = endAngle - startAngle;

				let currentAngle = startAngle;
				for (const child of node.children) {
					const childSectorSize = (child.subtreeSize / totalChildSize) * sectorSize;
					assignSectors(child, currentAngle, currentAngle + childSectorSize);
					currentAngle += childSectorSize;
				}
			}
		}

		// Assign sectors to roots
		const roots = data.nodes.filter(n => !n.parent);
		const totalRootSize = roots.reduce((sum, r) => sum + r.subtreeSize, 0);
		let currentAngle = 0;

		for (const root of roots) {
			const rootSectorSize = (root.subtreeSize / totalRootSize) * 2 * Math.PI;
			assignSectors(root, currentAngle, currentAngle + rootSectorSize);
			currentAngle += rootSectorSize;
		}

		// Position nodes at their center angles
		const maxDepth = Math.max(...data.nodes.map(n => n.depth || 0));
		const radii = get2D_Radii(maxDepth);
		for (let depth = 0; depth <= maxDepth; depth++) {
			const nodesAtDepth = data.nodes.filter(n => (n.depth || 0) === depth);
			const radius = window.genRadii && window.genRadii[depth] !== undefined
				? window.genRadii[depth]
				: (radii[depth] || 80 + depth * 80);

			nodesAtDepth.forEach(node => {
				const angle = node.angle2d || 0;
				node.x2d = centerX + radius * Math.cos(angle);
				node.y2d = centerY + radius * Math.sin(angle);
			});
		}
	}

	// 3D Renderer Class with human-readable layout
	class Graph3DRenderer {
		constructor(container, initialCameraState = null) {
			this.container = container;
			this.nodeMeshes = new Map();
			this.linkLines = [];
			// EDS path-hit overlay (createsTypes): guaranteed runtime paths
			// from a wrapped scope to the types it constructs. Never-taken
			// hits (source type never instantiated) ride a dimmer material
			this.pathHitLines = [];
			// Layer groups for the toggles — visibility is read by
			// the raycast filter too, so hidden layers are not clickable.
			// instrumentationGroup hosts the creation layer (see
			// buildCreationLayer); it is empty for v1 payloads
			this.typesGroup = null;
			this.instrumentationGroup = null;
			// Creation layer bookkeeping: meshes/lines get disposed in
			// clear(); dynamics re-run from updateLinkPositions so holder
			// tangents follow type spheres when they are dragged
			this.creationMeshes = [];
			this.creationLines = [];
			this.creationGeometries = [];
			this.creationMaterials = [];
			this.creationDynamics = [];
			this.creationMeshById = new Map();
			// The combined Dive graph (dive-layer-redesign-2026-09-04):
			// wrappers (bagels + directed fiber edges), the internals
			// backplane (EDS ring, attachHooks hub + grafts, adapter
			// sinks) — everything lands in the single diveGroup. Same
			// lifecycle as the creation layer (disposed in clear(),
			// dynamics re-run after creation's)
			this.diveGroup = null;
			this.wrapperMeshes = [];
			this.wrapperLines = [];
			this.wrapperGeometries = [];
			this.wrapperMaterials = [];
			this.wrapperDynamics = [];
			this.wrapperMeshById = new Map();
			this.internalsMeshes = [];
			this.internalsLines = [];
			this.internalsGeometries = [];
			this.internalsMaterials = [];
			this.internalsDynamics = [];
			this.internalsMeshById = new Map();
			// Label leaders: one thin line per sign back to its mesh —
			// the sign must never float free of what it signs
			this.leaderLines = [];
			this.leaderMaterial = null;
			// Everything the pointer may grab or click: spheres, creation
			// diamonds, bagels, internals knots (never arrows/lines/labels).
			// Non-sphere drags pin via userData.pinned — RELATIVE pins:
			// anchored elements store pinAnchor + pinOffset and follow
			// their anchor's moves (2026-09-05), anchor-less ones stay put;
			// edges keep following either way
			this.interactive = [];
			// The maroon origin marker — tracked so re-renders dispose it.
			// It belongs to the types layer (updateCenterMarkerVisibility)
			this.centerMarker = null;
			this.animationId = null;
			this.onNodeClick = null;
			this.mouse = { x: 0, y: 0 };
			this.isDragging = false;
			this.previousMousePosition = { x: 0, y: 0 };
			// Restore saved camera state or use defaults
			if (initialCameraState) {
				debugLog('Restoring camera state: ' + JSON.stringify(initialCameraState), 'log');
				this.cameraRotation = { ...initialCameraState.cameraRotation };
				this.zoom = initialCameraState.zoom;
				this.panOffset = { ...initialCameraState.panOffset };
				debugLog('Restored cameraRotation: ' + JSON.stringify(this.cameraRotation), 'log');
				debugLog('Restored zoom: ' + this.zoom, 'log');
				debugLog('Restored panOffset: ' + JSON.stringify(this.panOffset), 'log');
			} else {
				debugLog('No saved camera state, using defaults', 'log');
				this.cameraRotation = { x: 0, y: 0 };
				this.zoom = 500;
				this.panOffset = { x: 0, y: 0, z: 0 };
			}
			this.depthRadii = null; // Will be initialized in renderGraph
			// Per-layer distance knobs for the collapsible Layers &
			// Distances panel (2026-09-05 review). Values feed the layer
			// builders; adjusting re-runs renderGraph, so they live on the
			// renderer and survive relayouts. Multipliers are in nodeRadius
			// (holderShell, onionStep) or gen-0 radius (ambient/sink/jaeger)
			this.layerDistances = {
				creation : {
					// Holder diamonds: dir × nodeRadius × holderShell
					// from the created sphere's center
					holderShell : 2.4
				},
				dive : {
					// Ambient bagels: gen0 × ambientBase +
					// generation × nodeRadius × ambientStep
					ambientBase : 1.4,
					ambientStep : 0.5,
					// Co-located bagels onion out by 1 + k × onionStep
					onionStep   : 0.22,
					// Adapter sinks at −gen0 × sinkOffset, Jaeger
					// leftmost at −gen0 × jaegerOffset
					sinkOffset  : 1.3,
					jaegerOffset : 1.65
				}
			};
			// Focus animation state (sidebar click → rotate/zoom to node)
			this.focusAnim = null;
			this.focusedMesh = null;
			// Live trace flashes (B1.5, retuned 2026-09-01 for human
			// perception): mesh → expiry timestamp for the fire-red pulse
			// fired when a dive-trace edge names this node. 4s decay +
			// scale kick — a 1.2s cyan tint was below the threshold a
			// human can notice (Viktor: sub-250ms events are invisible,
			// small hue shifts don't register; shape change does)
			this.traceFlashes = new Map();
			// Replay (2026-09-01, Wanted #5): a stored trace re-walked at
			// human speed — one flash per edge, ~650ms apart, green for ok
			// and red for errored steps. Unlike ambient flashes these stay
			// VISIBLE in trace mode: the replay runs against the isolated
			// lineage. { mesh → { expiry, color } }
			this.replayFlashes = new Map();
			this.replayTimer = null;
			// Trace mode (names-first tracing, 2026-08-30): while set,
			// the isolated lineage stays green, everything else dimmed,
			// ambient flashes suppressed. { names, meshes, links,
			// dimmed } — dimmed holds the shared materials to restore
			this.traceMode = null;

			// Render-on-demand (2026-09-04): animate() keeps its rAF loop
			// but paints only when this flag is set (scene mutation), a
			// continuous animation is live (focus anim/pulse, trace and
			// replay flashes), or the ~1Hz heartbeat fires as self-heal
			// for a missed invalidation. Idle panel: one frame per second
			// instead of 60 — an open static graph no longer spins the fan
			this.needsRender = true;
			this.lastRenderAt = 0;

			this.init();
		}

		init() {
			debugLog('[3D] init() called', 'log');
			debugLog('[3D] THREE available:', typeof THREE, 'log');
			debugLog('[3D] Container:', this.container, 'log');
			debugLog('[3D] Container size:', this.container.clientWidth, 'x', this.container.clientHeight, 'log');

			// Check WebGL support
			const testCanvas = document.createElement('canvas');
			const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
			debugLog('[3D] WebGL available:', !!gl, 'log');

			// Create scene with lighter background
			this.scene = new THREE.Scene();
			this.scene.background = new THREE.Color(0x2d2d2d);

			// Create camera with better initial position
			const width = this.container.clientWidth || 800;
			const height = this.container.clientHeight || 600;
			debugLog('[3D] Using size:', width, 'x', height, 'log');
			this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 5000);
			// Use existing zoom/panOffset if they were restored, otherwise set defaults
			if (this.zoom === undefined) this.zoom = 600;
			if (this.panOffset === undefined) this.panOffset = { x: 0, y: 0, z: 0 };
			this.isPanning = false;
			this.draggedNode = null;
			// Apply the camera position based on restored/default values
			this.updateCameraPosition();

			// Create renderer
			try {
				this.renderer = new THREE.WebGLRenderer({ antialias: true });
				debugLog('[3D] WebGLRenderer created', 'log');
			} catch (e) {
				debugLog('[3D] WebGLRenderer failed:', e, 'error');
				this.container.innerHTML = '<div class="loading">WebGL not supported</div>';
				return;
			}
			this.renderer.setSize(width, height);
			this.renderer.setPixelRatio(window.devicePixelRatio);
			this.container.appendChild(this.renderer.domElement);

			// Add much brighter lights for better visibility
			const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
			this.scene.add(ambientLight);

			const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
			directionalLight.position.set(200, 200, 200);
			this.scene.add(directionalLight);

			// Add additional point lights for better illumination
			const pointLight1 = new THREE.PointLight(0xffaa00, 0.8, 2000);
			pointLight1.position.set(-200, 200, 200);
			this.scene.add(pointLight1);

			const pointLight2 = new THREE.PointLight(0x00aaff, 0.6, 2000);
			pointLight2.position.set(200, -200, 200);
			this.scene.add(pointLight2);

			// Add fog for depth (matching new background)
			this.scene.fog = new THREE.Fog(0x2d2d2d, 500, 2500);

			// Setup interaction
			this.setupInteraction();

			// Start render loop
			this.animate();
		}

		setupInteraction() {
			const canvas = this.renderer.domElement;

			// Capture mouse events - prevent VS Code from handling them
			canvas.style.cursor = 'grab';

			// Raycaster for click detection
			this.raycaster = new THREE.Raycaster();
			this.mouseVector = new THREE.Vector2();
			this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

			canvas.addEventListener('mousedown', (e) => {
				e.preventDefault();
				e.stopPropagation();
				// User grabbed the scene — cancel any running focus animation
				this.focusAnim = null;
				this.isDragging = false;
				this.isPanning = e.ctrlKey;
				this.previousMousePosition = { x: e.clientX, y: e.clientY };

				// Check if clicking on a node for dragging
				const rect = canvas.getBoundingClientRect();
				this.mouseVector.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
				this.mouseVector.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
				this.raycaster.setFromCamera(this.mouseVector, this.camera);
				const intersects = this.raycaster.intersectObjects(this.interactive);

				const dragHit = firstVisibleIntersect(intersects);
				if (dragHit) {
					this.draggedNode = dragHit.object;
					this.draggedNode.userData.isDragging = true;
					if (!this.draggedNode.userData.node) {
						// Non-sphere element (diamond, bagel, knot): pin it.
						// The pin is RELATIVE (2026-09-05 owner request):
						// elements anchored to a sphere or diamond store
						// their offset from the anchor, and the dynamics
						// writers re-apply anchor + offset — dragging the
						// sphere later carries the whole set along, as if
						// the element was never detached. Anchor-less
						// elements (ambient bagels, internals knots) keep
						// the old absolute pin: nothing to follow
						this.draggedNode.userData.pinned = true;
						const pinAnchor = this.resolvePinAnchor(this.draggedNode);
						if (pinAnchor) {
							this.draggedNode.userData.pinAnchor = pinAnchor;
							this.draggedNode.userData.pinOffset = new THREE.Vector3().subVectors(
								this.draggedNode.position,
								pinAnchor.position
							);
						}
					}
					// Store the intersection point offset from node center
					const intersectPoint = dragHit.point;
					this.dragOffset = new THREE.Vector3().subVectors(
						this.draggedNode.position,
						intersectPoint
					);
					// Store the fixed distance from camera to node for the drag plane
					const nodePos = this.draggedNode.position;
					const cameraDirection = new THREE.Vector3();
					this.camera.getWorldDirection(cameraDirection);
					const camToNode = new THREE.Vector3().subVectors(nodePos, this.camera.position);
					this.dragPlaneDistance = camToNode.dot(cameraDirection);
					if (this.simulation) this.simulation.alphaTarget(0).stop();
					canvas.style.cursor = 'move';
				} else {
					canvas.style.cursor = 'grabbing';
				}
			}, { passive: false });

			canvas.addEventListener('mousemove', (e) => {
				e.preventDefault();
				e.stopPropagation();

				const dx = e.clientX - this.previousMousePosition.x;
				const dy = e.clientY - this.previousMousePosition.y;

				if (e.buttons === 1 && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
					this.isDragging = true;

					if (this.draggedNode) {
						// Stop simulation completely during drag
						if (this.simulation) {
							this.simulation.stop();
						}

						// Get mouse ray
						const rect = canvas.getBoundingClientRect();
						this.mouseVector.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
						this.mouseVector.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
						this.raycaster.setFromCamera(this.mouseVector, this.camera);

						// Create a plane perpendicular to camera at the FIXED drag distance
						const cameraDirection = new THREE.Vector3();
						this.camera.getWorldDirection(cameraDirection);
						// Use the stored fixed distance from drag start
						const planePoint = this.camera.position.clone().add(
							cameraDirection.clone().multiplyScalar(this.dragPlaneDistance)
						);
						const dragPlane = new THREE.Plane();
						dragPlane.setFromNormalAndCoplanarPoint(cameraDirection, planePoint);

						// Find where ray intersects the plane
						const target = new THREE.Vector3();
						this.raycaster.ray.intersectPlane(dragPlane, target);

						if (target) {
							// Position = intersection point + stored offset
							const newPos = target.clone().add(this.dragOffset);

							// Move the dragged node
							this.draggedNode.position.copy(newPos);
							// A relative pin's offset tracks the drag, so the
							// dynamics writer (anchor + offset) lands exactly
							// here — no snap-back mid-drag
							if (this.draggedNode.userData.pinAnchor) {
								this.draggedNode.userData.pinOffset.subVectors(
									this.draggedNode.position,
									this.draggedNode.userData.pinAnchor.position
								);
							}

							// Update node data
							const draggedNodeData = this.draggedNode.userData.node;
							if (draggedNodeData) {
								draggedNodeData.x = newPos.x;
								draggedNodeData.y = newPos.y;
								draggedNodeData.z = newPos.z;
								draggedNodeData.fx = newPos.x;
								draggedNodeData.fy = newPos.y;
								draggedNodeData.fz = newPos.z;
								// Persist as USER-PLACED so a knob relayout
								// keeps this spot: calculatePosition honors
								// x3d, relaxTypeShells skips it
								draggedNodeData.x3d = newPos.x;
								draggedNodeData.y3d = newPos.y;
								draggedNodeData.z3d = newPos.z;
							}

							// Update link positions to follow the node
							this.updateLinkPositions();
							// Update label position to match node
							this.updateLabelPosition(this.draggedNode);
						}
					} else if (e.ctrlKey) {
						// Ctrl+drag: rotate camera around center.
						// No latitude clamp: full over-pole tumble. camera.up
						// flips in updateCameraPosition past the poles, so the
						// roll stays continuous (no 180° snap at the pole).
						// Wrapped into [-π, π] to keep the numbers small.
						this.cameraRotation.y += dx * 0.002;
						this.cameraRotation.x += dy * 0.002;
						const TWO_PI = Math.PI * 2;
						this.cameraRotation.x = ((this.cameraRotation.x + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
						this.updateCameraPosition();
					} else {
						// Regular drag: pan the view (slower speed)
						const panSpeed = this.zoom * 0.0003;
						this.panOffset.x -= dx * panSpeed;
						this.panOffset.y += dy * panSpeed;
						this.updateCameraPosition();
					}
				}

				this.previousMousePosition = { x: e.clientX, y: e.clientY };
				this.updateHover(e);
			}, { passive: false });

			canvas.addEventListener('mouseup', (e) => {
				e.preventDefault();
				e.stopPropagation();
				canvas.style.cursor = 'grab';
	
				if (this.draggedNode) {
					// Keep node position fixed, don't restart simulation
					const node = this.draggedNode.userData.node;
					if (node) {
						node.fx = node.x;
						node.fy = node.y;
						node.fz = node.z;
					}
					this.draggedNode.userData.isDragging = false;
					this.draggedNode = null;
					// Don't restart simulation - keep it stopped
				}
	
				this.isDragging = false;
			});
	
			// Single click on node - show tooltip, click elsewhere - hide tooltip
			canvas.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const rect = canvas.getBoundingClientRect();
				this.mouseVector.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
				this.mouseVector.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
				this.raycaster.setFromCamera(this.mouseVector, this.camera);
				const intersects = this.raycaster.intersectObjects(this.interactive);
				const clickHit = firstVisibleIntersect(intersects);
				if (clickHit) {
					const hitMesh = clickHit.object;
					const node = hitMesh.userData.node;
					if (node) {
						if (liveTraceNames.has(node.name) && vscodeRef) {
							// Sphere with live trace activity: single click
							// picks the trace instead of showing the tooltip
							vscodeRef.postMessage({ command: 'pickTrace', data: { name: node.name } });
						} else {
							this.handleNodeClick3D(e, node);
						}
					} else if (hitMesh.userData.creationNode) {
						this.handleCreationClick(e, hitMesh.userData.creationNode);
					} else if (hitMesh.userData.wrapperNode) {
						this.handleWrapperClick(e, hitMesh.userData.wrapperNode);
					} else if (hitMesh.userData.internalNode) {
						this.handleInternalClick(e, hitMesh.userData.internalNode);
					}
				} else {
					// Click on background - hide tooltip, drop focus glow,
					// leave trace mode
					d3.select('#tooltip').classed('visible', false);
					this.setFocusedMesh(null);
					if (this.traceMode) {
						this.exitTraceMode();
						updateStatusLine();
						if (vscodeRef) {
							vscodeRef.postMessage({ command: 'traceModeExit' });
						}
					}
				}
			});
	
			// Double-click on node - go to definition
			canvas.addEventListener('dblclick', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const rect = canvas.getBoundingClientRect();
				this.mouseVector.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
				this.mouseVector.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
				this.raycaster.setFromCamera(this.mouseVector, this.camera);
				const intersects = this.raycaster.intersectObjects(this.interactive);
				const dblHit = firstVisibleIntersect(intersects);
				if (dblHit) {
					const hitMesh = dblHit.object;
					const node = hitMesh.userData.node;
					if (node) {
						this.handleNodeDoubleClick3D(node, e);
					} else {
						// Diamonds jump to their scope, bagels to the wrap
						// call site; knots cite sources outside the
						// workspace — no jump there
						const jumpNode = hitMesh.userData.creationNode || hitMesh.userData.wrapperNode;
						if (jumpNode && jumpNode.location && vscodeRef) {
							vscodeRef.postMessage({
								command : 'goToDefinition',
								data    : jumpNode.location
							});
						}
					}
				}
			});

			canvas.addEventListener('wheel', (e) => {
				e.preventDefault();
				e.stopPropagation();
				// Manual zoom cancels the focus animation
				this.focusAnim = null;
				this.zoom += e.deltaY * 0.5;
				this.zoom = Math.max(50, Math.min(2500, this.zoom));
				this.updateCameraPosition();
			}, { passive: false });

			// Prevent context menu on right-click
			canvas.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				e.stopPropagation();
			});
		}

		/**
		 * The anchor a dragged element pins RELATIVE to (2026-09-05 owner
		 * request: "move the sphere with all its elements as a set"):
		 *  - holder diamond → its primary created type's sphere
		 *  - bagel → the hosting scope's diamond (the wrapped callback),
		 *    else the wrapped type's sphere (constructor wrap)
		 *  - everything else (chain/starter nodes, ambient bagels,
		 *    internals knots) → null: absolute pin, nothing to follow
		 */
		resolvePinAnchor(mesh) {
			const userData = mesh.userData;
			if (userData.creationNode && Array.isArray(userData.creationNode.creates) && userData.creationNode.creates.length > 0) {
				const primaryPath = userData.creationNode.creates[0].typePath;
				const sphere = this.nodeMeshes.get(primaryPath) || null;
				return sphere;
			}
			if (userData.wrapperNode) {
				const creationId = userData.wrapperNode.callbackScopeId || userData.wrapperNode.holderScopeId;
				const creationMesh = creationId ? this.creationMeshById.get(creationId) : null;
				if (creationMesh) {
					return creationMesh;
				}
				const typeMesh = userData.wrapperNode.wrapsTypePath
					? this.nodeMeshes.get(userData.wrapperNode.wrapsTypePath) || null
					: null;
				return typeMesh;
			}
			if (userData.internalNode) {
				// Adapter sinks anchor to the Jaeger cone (2026-09-05 owner
				// review: "dragging the Jaeger cone should move the
				// connected Adapter elements") — the cone carries its
				// stack, same follow rule as diamonds on spheres. The cone
				// itself, the ring, and the hub keep the absolute pin
				if (userData.internalNode.role === 'sink') {
					const jaeger = this.internalsMeshes.find(m => m.userData.internalNode && m.userData.internalNode.role === 'external');
					return jaeger || null;
				}
				return null;
			}
			return null;
		}

		updateCameraPosition() {
			// panOffset.z is optional: saved camera states from before the
			// z-aware orbit center do not carry it
			const panZ = this.panOffset.z || 0;
			const x = Math.sin(this.cameraRotation.y) * Math.cos(this.cameraRotation.x) * this.zoom + this.panOffset.x;
			const y = Math.sin(this.cameraRotation.x) * this.zoom + this.panOffset.y;
			const z = Math.cos(this.cameraRotation.y) * Math.cos(this.cameraRotation.x) * this.zoom + panZ;
			// Flip the up vector past the poles (|latitude| > 90°): the
			// over-pole tumble stays roll-continuous instead of snapping
			// 180° at the pole. Must precede lookAt — lookAt reads `up`.
			this.camera.up.set(0, Math.cos(this.cameraRotation.x) >= 0 ? 1 : -1, 0);
			this.camera.position.set(x, y, z);
			this.camera.lookAt(this.panOffset.x, this.panOffset.y, panZ);
			// Every camera mutation funnels here (rotate/pan/wheel/zoom/
			// reset/focus-anim ticks), so one flag covers them all
			this.needsRender = true;
		}

		focusNode(id, name) {
			let mesh = this.nodeMeshes.get(id);
			if (!mesh && name) {
				// Fallback: match by short display name
				for (const candidate of this.nodeMeshes.values()) {
					const candidateNode = candidate.userData.node;
					if (candidateNode && candidateNode.name === name) {
						mesh = candidate;
						break;
					}
				}
			}
			if (!mesh) return;

			const node = mesh.userData.node;
			const pos = mesh.position;

			// Rotation target: align the view with the chain direction
			// (parent → node) so the arrow-sphere line faces the viewer.
			// Roots keep the current rotation — nothing to align to.
			let targetRotX = this.cameraRotation.x;
			let targetRotY = this.cameraRotation.y;
			const parentMesh = node && node.parent ? this.nodeMeshes.get(node.parent.id) : null;
			if (parentMesh) {
				const pp = parentMesh.position;
				const dx = pos.x - pp.x;
				const dy = pos.y - pp.y;
				const dz = pos.z - pp.z;
				const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
				if (len > 0.0001) {
					const dirX = dx / len;
					const dirY = dy / len;
					const dirZ = dz / len;
					// Do NOT look straight down the chain axis: the branch
					// nodes stack one behind another and the zoomed sphere
					// occludes its parent. Rotate the view ~80° off-axis
					// (Rodrigues around the chain's perpendicular) so the
					// branch spreads across the frame instead.
					const up = Math.abs(dirY) > 0.95
						? { x: 1, y: 0, z: 0 }
						: { x: 0, y: 1, z: 0 };
					// axis = normalize(cross(dir, up))
					let axisX = dirY * up.z - dirZ * up.y;
					let axisY = dirZ * up.x - dirX * up.z;
					let axisZ = dirX * up.y - dirY * up.x;
					const axisLen = Math.sqrt(axisX * axisX + axisY * axisY + axisZ * axisZ);
					axisX /= axisLen;
					axisY /= axisLen;
					axisZ /= axisLen;
					const theta = 80 * Math.PI / 180;
					const cosT = Math.cos(theta);
					const sinT = Math.sin(theta);
					// cross(axis, dir) for the Rodrigues rotation
					const crossX = axisY * dirZ - axisZ * dirY;
					const crossY = axisZ * dirX - axisX * dirZ;
					const crossZ = axisX * dirY - axisY * dirX;
					const viewX = dirX * cosT + crossX * sinT;
					const viewY = dirY * cosT + crossY * sinT;
					const viewZ = dirZ * cosT + crossZ * sinT;
					// camera sits at node − view·zoom, looking along view
					targetRotX = Math.asin(Math.max(-1, Math.min(1, -viewY)));
					targetRotY = Math.atan2(-viewX, -viewZ);
					// Focus targets stay in the upright band (ctrl+drag
					// allows over-pole tumbling, but a programmatic focus
					// should always land right-side up)
					targetRotX = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, targetRotX));
				}
			}

			// Adaptive zoom: fit the node's neighborhood (parent,
			// siblings, children) into the frame so a focus never ends
			// as a lone sphere with no context. Truly isolated nodes
			// (single-constructor project) fall back to the minimum.
			const neighborhood = [pos];
			if (parentMesh) {
				neighborhood.push(parentMesh.position);
				const siblings = node.parent.children || [];
				for (const sibling of siblings) {
					const siblingMesh = this.nodeMeshes.get(sibling.id);
					if (siblingMesh) {
						neighborhood.push(siblingMesh.position);
					}
				}
			}
			const childNodes = (node && node.children) || [];
			for (const child of childNodes) {
				const childMesh = this.nodeMeshes.get(child.id);
				if (childMesh) {
					neighborhood.push(childMesh.position);
				}
			}
			let neighborhoodRadius = 0;
			for (const point of neighborhood) {
				const distance = pos.distanceTo(point);
				if (distance > neighborhoodRadius) {
					neighborhoodRadius = distance;
				}
			}
			// Frustum fit: use the narrower of the vertical/horizontal
			// half-angles (the pane is often taller than wide); the 1.4
			// margin keeps the label sprites inside the frame
			const vHalf = (this.camera.fov * Math.PI / 180) / 2;
			const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
			const fitHalf = Math.min(vHalf, hHalf);
			const fitZoom = neighborhoodRadius > 0.0001
				? (neighborhoodRadius / Math.tan(fitHalf)) * 1.4
				: 250;
			const targetZoom = Math.max(250, Math.min(800, fitZoom));

			// Already-visible fast path, owner rule: when the node is on
			// screen and unoccluded from the CURRENT camera, switching
			// between tree items must keep the orientation — rotation
			// there is unnecessary and only hides details. Highlight
			// (glow) plus a gentle re-fit zoom/pan is enough. Rotation
			// is reserved for nodes that are off-screen or hidden.
			const alreadyVisible = this.isNodeInCurrentView(mesh);
			if (alreadyVisible) {
				let stayZoom = targetZoom;
				if (!this.isViewClear(this.cameraRotation.x, this.cameraRotation.y, stayZoom, pos, mesh)) {
					// Re-fit would push an occluder in front of the
					// node — keep the current distance instead
					stayZoom = this.zoom;
				}
				this.focusAnim = {
					start : performance.now(),
					duration : 900,
					from : {
						rotX : this.cameraRotation.x,
						rotY : this.cameraRotation.y,
						zoom : this.zoom,
						pan  : { x: this.panOffset.x, y: this.panOffset.y, z: this.panOffset.z || 0 }
					},
					to : {
						rotX : this.cameraRotation.x,
						rotY : this.cameraRotation.y,
						zoom : stayZoom,
						pan  : { x: pos.x, y: pos.y, z: pos.z }
					}
				};
				this.setFocusedMesh(mesh);
				debugLog('[focusNode] ' + id + ' already visible -> highlight only (zoom ' + Math.round(stayZoom) + ')', 'log');
				return;
			}

			// De-occlusion: whatever base view we picked (chain off-axis
			// or the current rotation for roots), another sphere may sit
			// between the camera and the focused node. Rotate the view
			// around the world Y in 20° steps until the target is
			// actually visible — owner rule: smaller spheres are OK,
			// a hidden focused sphere is not.
			const clearView = this.pickClearView(targetRotX, targetRotY, targetZoom, pos, mesh);
			targetRotX = clearView.rotX;
			targetRotY = clearView.rotY;

			// Two-phase animation, owner's order: rotate the chain into
			// view first (0–55% of the timeline), zoom in second
			// (45–100%), phases overlap slightly for a natural feel
			this.focusAnim = {
				start : performance.now(),
				duration : 900,
				from : {
					rotX : this.cameraRotation.x,
					rotY : this.cameraRotation.y,
					zoom : this.zoom,
					pan  : { x: this.panOffset.x, y: this.panOffset.y, z: this.panOffset.z || 0 }
				},
				to : {
					rotX : targetRotX,
					rotY : targetRotY,
					zoom : targetZoom,
					pan  : { x: pos.x, y: pos.y, z: pos.z }
				}
			};
			this.setFocusedMesh(mesh);
			debugLog('[focusNode] ' + id + ' -> anim ' + JSON.stringify(this.focusAnim.to), 'log');
		}

		setFocusedMesh(mesh) {
			if (this.focusedMesh && this.focusedMesh !== mesh) {
				this.restoreFocusGlow(this.focusedMesh);
			}
			this.focusedMesh = mesh || null;
			// Unfocus (background click) restores the old glow while
			// NOTHING is animating anymore — without the flag that
			// restored state would never paint
			this.needsRender = true;
		}

		restoreFocusGlow(mesh) {
			const node = mesh.userData.node;
			if (node && node.isRoot) {
				// Root baseline glow (set at mesh creation)
				mesh.material.emissiveIntensity = 0.3;
			} else {
				mesh.material.emissive = new THREE.Color(0x000000);
				mesh.material.emissiveIntensity = 0;
			}
		}

		updateFocusAnimation() {
			if (!this.focusAnim) return;
			const anim = this.focusAnim;
			const t = Math.min((performance.now() - anim.start) / anim.duration, 1);
			const rotT = easeInOutCubic(Math.min(t / 0.55, 1));
			const zoomT = easeInOutCubic(Math.max(0, (t - 0.45) / 0.55));

			// Shortest path for the yaw angle (wraps across ±π)
			let rotYDelta = anim.to.rotY - anim.from.rotY;
			while (rotYDelta > Math.PI) rotYDelta -= 2 * Math.PI;
			while (rotYDelta < -Math.PI) rotYDelta += 2 * Math.PI;

			this.cameraRotation.x = lerp(anim.from.rotX, anim.to.rotX, rotT);
			this.cameraRotation.y = anim.from.rotY + rotYDelta * rotT;
			this.panOffset.x = lerp(anim.from.pan.x, anim.to.pan.x, rotT);
			this.panOffset.y = lerp(anim.from.pan.y, anim.to.pan.y, rotT);
			this.panOffset.z = lerp(anim.from.pan.z, anim.to.pan.z, rotT);
			this.zoom = lerp(anim.from.zoom, anim.to.zoom, zoomT);
			this.updateCameraPosition();

			if (t >= 1) {
				this.focusAnim = null;
				if (this.focusedMesh) {
					// Self-check the landed view: is the focused sphere
					// actually unoccluded from the final camera?
					const landed = this.isViewClear(
						this.cameraRotation.x, this.cameraRotation.y,
						this.zoom, this.focusedMesh.position, this.focusedMesh
					);
					debugLog('[focusNode] final view clear: ' + landed, landed ? 'log' : 'warn');
				}
			}
		}

		updateFocusPulse() {
			const mesh = this.focusedMesh;
			if (!mesh) return;
			const node = mesh.userData.node;
			const base = node && node.isRoot ? 0.3 : 0;
			if (!node || !node.isRoot) {
				// Non-root materials are created without an emissive
				// color — give the focused one a gold glow
				mesh.material.emissive = new THREE.Color(0xffc040);
			}
			mesh.material.emissiveIntensity = base + 0.5 + 0.35 * Math.sin(performance.now() * 0.006);
		}

		// Node ids are not type names — the name match scan both the
		// trace flash and trace mode use (same fallback focusNode uses)
		findMeshByName(name) {
			let target = this.nodeMeshes.get(name);
			if (!target) {
				for (const candidate of this.nodeMeshes.values()) {
					if (candidate.userData.node && candidate.userData.node.name === name) {
						target = candidate;
						break;
					}
				}
			}
			return target || null;
		}

		// Live trace illumination (B1.5): flash the sphere whose node
		// name matches a dive-trace edge's instanceType. This is the
		// ambient "the server is alive" signal — parsing the stream
		// into structure is a future design session, not B1.
		flashTraceNode(name) {
			const target = this.findMeshByName(name);
			if (!target) return;
			this.traceFlashes.set(target, performance.now() + Graph3DRenderer.FLASH_MS);
		}

		// Fire-red, well above the cyan/calm palette of the rest of the
		// scene, and long enough to catch a human eye
		static get FLASH_COLOR() { return 0xff3300; }
		static get FLASH_MS() { return 5000; }

		updateTraceFlashes() {
			if (this.traceMode) {
				// Ambient flashes are monitoring noise; trace mode
				// isolates ONE trace, so the pulses go quiet. REPLAY
				// flashes are the point of the mode — they keep running.
				this.traceFlashes.forEach((expiry, mesh) => {
					mesh.scale.setScalar(1);
				});
				this.traceFlashes.clear();
			} else {
				this.decayFlashes(this.traceFlashes, false);
			}
			this.decayFlashes(this.replayFlashes, true);
		}

		// Shared flash decay: ambient entries are plain expiries, replay
		// entries are { expiry, color }. On expiry a mesh inside the open
		// trace restores its TRACE color (the path stays lit), everything
		// else returns to its base state.
		decayFlashes(map, isReplay) {
			if (map.size === 0) return;
			const now = performance.now();
			map.forEach((entry, mesh) => {
				if (mesh === this.focusedMesh) {
					// The focus pulse owns this mesh's emissive
					mesh.scale.setScalar(1);
					map.delete(mesh);
					return;
				}
				const node = mesh.userData.node;
				const base = node && node.isRoot ? 0.3 : 0;
				const expiry = isReplay ? entry.expiry : entry;
				const color = isReplay ? entry.color : Graph3DRenderer.FLASH_COLOR;
				const remaining = expiry - now;
				if (remaining <= 0) {
					const mode = this.traceMode;
					if (mode && mode.meshes.indexOf(mesh) !== -1) {
						const nodeName = node && node.name;
						const errored = mode.erroredNames && nodeName && mode.erroredNames.has(nodeName);
						mesh.material.emissive = new THREE.Color(errored
							? Graph3DRenderer.TRACE_ERROR_COLOR
							: Graph3DRenderer.TRACE_COLOR);
						mesh.material.emissiveIntensity = 0.9;
						mesh.scale.setScalar(1);
						map.delete(mesh);
						return;
					}
					// Roots carry a dark-red emissive by default — the
					// flash overwrote the color, so restore it here
					if (node && node.isRoot) {
						mesh.material.emissive = new THREE.Color(0x8B0000);
					}
					mesh.material.emissiveIntensity = base;
					mesh.scale.setScalar(1);
					map.delete(mesh);
					return;
				}
				const life = remaining / Graph3DRenderer.FLASH_MS;
				mesh.material.emissive = new THREE.Color(color);
				mesh.material.emissiveIntensity = base + 1.4 * life;
				// Shape change, not just light: the sphere swells up to
				// +40% at the hit and shrinks back as the flash decays
				mesh.scale.setScalar(1 + 0.4 * life);
			});
		}

		// Replay a stored trace at human speed (Wanted #5): walk the
		// lineage in ring (= chronological) order, one flash per edge,
		// ~650ms apart — the original events run at machine speed, which
		// no human can follow. Errored steps flash red. Callers usually
		// enter trace mode first so the replay walks the isolated path.
		replayTrace(edges) {
			this.cancelReplay();
			const steps = [];
			for (const edge of edges) {
				if (!edge || typeof edge !== 'object') continue;
				const nm = edge.instanceType || (typeof edge.name === 'string' ? edge.name : null);
				if (!nm) continue;
				steps.push({ name: nm, error: edge.status === 'error' });
			}
			let i = 0;
			const step = () => {
				if (i >= steps.length) {
					this.replayTimer = null;
					return;
				}
				const s = steps[i++];
				const mesh = this.findMeshByName(s.name);
				if (mesh) {
					this.replayFlashes.set(mesh, {
						expiry : performance.now() + Graph3DRenderer.FLASH_MS,
						color  : s.error ? Graph3DRenderer.TRACE_ERROR_COLOR : Graph3DRenderer.TRACE_COLOR,
					});
				}
				this.replayTimer = setTimeout(step, 650);
			};
			step();
		}

		cancelReplay() {
			if (this.replayTimer) {
				clearTimeout(this.replayTimer);
				this.replayTimer = null;
			}
			this.replayFlashes.forEach((entry, mesh) => {
				mesh.scale.setScalar(1);
			});
			this.replayFlashes.clear();
		}

		// Green for the isolated trace path; distinct from the fire-red
		// ambient flash and the gold focus pulse. Edges that dive pinned
		// with an error go red instead — the failure must be visible at
		// a glance, not discoverable only by expanding the tree.
		static get TRACE_COLOR() { return 0x40ff80; }
		static get TRACE_ERROR_COLOR() { return 0xff2020; }

		// Enter trace mode: isolate the resolved lineage — path spheres
		// green (red where an edge errored), links between consecutive
		// path nodes green, everything else dimmed.
		// edges = lineage (root → … → descendants).
		enterTraceMode(edges, selectedName) {
			this.exitTraceMode();
			this.traceFlashes.clear();
			this.setFocusedMesh(null);
			const namesInOrder = [];
			const seen = new Set();
			const erroredNames = new Set();
			for (const edge of edges) {
				if (!edge || typeof edge !== 'object') continue;
				const nm = edge.instanceType || (typeof edge.name === 'string' ? edge.name : null);
				if (nm && edge.status === 'error') {
					erroredNames.add(nm);
				}
				if (nm && !seen.has(nm)) {
					seen.add(nm);
					namesInOrder.push(nm);
				}
			}
			const meshes = [];
			for (const nm of namesInOrder) {
				const mesh = this.findMeshByName(nm);
				if (mesh) meshes.push(mesh);
			}
			const inPath = new Set(meshes);
			const dimmed = { line: null, arrow: null };
			this.nodeMeshes.forEach(mesh => {
				const m = mesh.material;
				if (inPath.has(mesh)) {
					const nodeName = mesh.userData.node && mesh.userData.node.name;
					const errored = nodeName !== null && erroredNames.has(nodeName);
					m.emissive = new THREE.Color(errored
						? Graph3DRenderer.TRACE_ERROR_COLOR
						: Graph3DRenderer.TRACE_COLOR);
					m.emissiveIntensity = 0.9;
				} else {
					m.transparent = true;
					m.opacity = 0.25;
					m.emissiveIntensity = 0;
					if (mesh.userData.label) {
						mesh.userData.label.material.opacity = 0.25;
					}
				}
				m.needsUpdate = true;
			});
			// Dim the SHARED link materials (all non-path links ride
			// them); path links get cloned materials so the shared ones
			// stay dimmed underneath
			if (this.linkLines.length > 0) {
				dimmed.line = this.linkLines[0].line.material;
				dimmed.arrow = this.linkLines[0].arrow.material;
				dimmed.line.opacity = 0.15;
				dimmed.arrow.transparent = true;
				dimmed.arrow.opacity = 0.15;
				dimmed.arrow.needsUpdate = true;
			}
			// Path-hit overlay dims with the skeleton (two shared materials:
			// taken + never-taken — dim both, remembering each one's own
			// opacity for the restore)
			if (this.pathHitLines.length > 0) {
				dimmed.pathHit = [];
				this.pathHitLines.forEach(({ line }) => {
					if (!dimmed.pathHit.includes(line.material)) {
						dimmed.pathHit.push(line.material);
					}
				});
				dimmed.pathHit.forEach(m => {
					m.userData.restoreOpacity = m.opacity;
					m.opacity = Math.min(m.opacity, 0.1);
					m.needsUpdate = true;
				});
			}
			const links = [];
			for (let i = 0; i < namesInOrder.length - 1; i++) {
				this.highlightLinkBetween(namesInOrder[i], namesInOrder[i + 1], links);
			}
			this.traceMode = {
				names  : namesInOrder,
				meshes : meshes,
				links  : links,
				dimmed : dimmed,
				erroredNames : erroredNames,
				selectedName : selectedName || null
			};
			// The dim/recolor above is not an animation — flag the paint
			this.needsRender = true;
		}

		// Clone-and-green the graph link connecting two names, if one
		// exists (either direction — AOT link direction need not match
		// runtime lineage). Originals are stashed for exitTraceMode.
		highlightLinkBetween(nameA, nameB, collector) {
			for (const entry of this.linkLines) {
				const s = entry.link.source && entry.link.source.name;
				const t = entry.link.target && entry.link.target.name;
				const match = (s === nameA && t === nameB) || (s === nameB && t === nameA);
				if (!match) continue;
				if (!entry.origLineMaterial) {
					entry.origLineMaterial = entry.line.material;
					entry.origArrowMaterial = entry.arrow.material;
					entry.line.material = entry.line.material.clone();
					entry.arrow.material = entry.arrow.material.clone();
				}
				entry.line.material.color = new THREE.Color(Graph3DRenderer.TRACE_COLOR);
				entry.line.material.opacity = 1;
				entry.arrow.material.color = new THREE.Color(Graph3DRenderer.TRACE_COLOR);
				entry.arrow.material.opacity = 1;
				collector.push(entry);
			}
		}

		// Mid-flight: fresh edges of the open trace arrived — undim and
		// green their nodes, extend the link chain from the current leaf
		extendTraceMode(edges) {
			const mode = this.traceMode;
			if (!mode) return;
			if (!mode.erroredNames) {
				mode.erroredNames = new Set();
			}
			// Late completions: an edge entered green via 'enter' and now
			// arrives errored via 'settle' — recolor the sphere it owns
			for (const edge of edges) {
				if (!edge || typeof edge !== 'object') continue;
				if (edge.status !== 'error') continue;
				const nm = edge.instanceType || (typeof edge.name === 'string' ? edge.name : null);
				if (!nm || mode.erroredNames.has(nm)) continue;
				mode.erroredNames.add(nm);
				const mesh = this.findMeshByName(nm);
				if (mesh) {
					mesh.material.emissive = new THREE.Color(Graph3DRenderer.TRACE_ERROR_COLOR);
					mesh.material.needsUpdate = true;
				}
			}
			const newNames = [];
			for (const edge of edges) {
				if (!edge || typeof edge !== 'object') continue;
				const nm = edge.instanceType || (typeof edge.name === 'string' ? edge.name : null);
				if (nm && mode.names.indexOf(nm) === -1 && newNames.indexOf(nm) === -1) {
					newNames.push(nm);
				}
			}
			let previous = mode.names[mode.names.length - 1];
			for (const nm of newNames) {
				const mesh = this.findMeshByName(nm);
				if (mesh) {
					const m = mesh.material;
					m.transparent = false;
					m.opacity = 1;
					m.emissive = new THREE.Color(mode.erroredNames.has(nm)
						? Graph3DRenderer.TRACE_ERROR_COLOR
						: Graph3DRenderer.TRACE_COLOR);
					m.emissiveIntensity = 0.9;
					m.needsUpdate = true;
					if (mesh.userData.label) {
						mesh.userData.label.material.opacity = 1;
					}
					mode.meshes.push(mesh);
				}
				if (previous) {
					this.highlightLinkBetween(previous, nm, mode.links);
				}
				mode.names.push(nm);
				previous = nm;
			}
			// Late recolors/undims are plain mutations, not animations
			this.needsRender = true;
		}

		// Leave trace mode: restore dimmed spheres/links and the shared
		// materials; focus pulse and ambient flashes resume
		exitTraceMode() {
			const mode = this.traceMode;
			if (!mode) return;
			this.cancelReplay();
			const inPath = new Set(mode.meshes);
			this.nodeMeshes.forEach(mesh => {
				const m = mesh.material;
				const node = mesh.userData.node;
				const isRoot = node && node.isRoot;
				if (node && isRoot) {
					m.emissive = new THREE.Color(0x8B0000);
				}
				m.emissiveIntensity = isRoot ? 0.3 : 0;
				if (!inPath.has(mesh)) {
					m.opacity = 1;
					m.transparent = false;
					if (mesh.userData.label) {
						mesh.userData.label.material.opacity = 1;
					}
				}
				m.needsUpdate = true;
			});
			for (const entry of mode.links) {
				if (entry.origLineMaterial) {
					entry.line.material.dispose();
					entry.arrow.material.dispose();
					entry.line.material = entry.origLineMaterial;
					entry.arrow.material = entry.origArrowMaterial;
					entry.origLineMaterial = null;
					entry.origArrowMaterial = null;
				}
			}
			if (mode.dimmed.line) {
				mode.dimmed.line.opacity = 0.8;
				mode.dimmed.line.needsUpdate = true;
			}
			if (mode.dimmed.arrow) {
				mode.dimmed.arrow.transparent = false;
				mode.dimmed.arrow.opacity = 1;
				mode.dimmed.arrow.needsUpdate = true;
			}
			if (mode.dimmed.pathHit) {
				mode.dimmed.pathHit.forEach(m => {
					m.opacity = m.userData.restoreOpacity ?? 0.5;
					m.needsUpdate = true;
				});
			}
			this.traceMode = null;
			// The restore above mutated materials outside any animation
			this.needsRender = true;
		}

		// Unit view direction (camera → orbit center) for given angles,
		// inverse of the updateCameraPosition spherical placement
		viewFromAngles(rotX, rotY) {
			const result = {
				x : -Math.sin(rotY) * Math.cos(rotX),
				y : -Math.sin(rotX),
				z : -Math.cos(rotY) * Math.cos(rotX)
			};
			return result;
		}

		// True when the node is inside the current frame (with margin
		// for its label) and unoccluded from the live camera — the
		// condition for the highlight-only fast path in focusNode
		isNodeInCurrentView(mesh) {
			const projected = mesh.position.clone().project(this.camera);
			if (projected.z > 1 || projected.z < -1) {
				const offscreen = false;
				return offscreen;
			}
			if (Math.abs(projected.x) > 0.85 || Math.abs(projected.y) > 0.85) {
				const offscreen = false;
				return offscreen;
			}
			const clear = this.isViewClearFrom(this.camera.position, mesh.position, mesh);
			return clear;
		}

		// True when no other sphere blocks the focused node from the
		// camera position implied by these angles and zoom
		isViewClear(rotX, rotY, zoom, nodePos, focusedMesh) {
			const view = this.viewFromAngles(rotX, rotY);
			const camPos = {
				x : nodePos.x - view.x * zoom,
				y : nodePos.y - view.y * zoom,
				z : nodePos.z - view.z * zoom
			};
			const result = this.isViewClearFrom(camPos, nodePos, focusedMesh);
			return result;
		}

		// Occlusion test from an explicit camera position — shared by
		// the hypothetical-camera sweep (isViewClear) and the
		// live-camera visibility check (isNodeInCurrentView)
		isViewClearFrom(camPos, nodePos, focusedMesh) {
			const nx = nodePos.x - camPos.x;
			const ny = nodePos.y - camPos.y;
			const nz = nodePos.z - camPos.z;
			const nodeDist = Math.sqrt(nx * nx + ny * ny + nz * nz);
			if (nodeDist < 0.0001) {
				const atop = true;
				return atop;
			}
			const dirX = nx / nodeDist;
			const dirY = ny / nodeDist;
			const dirZ = nz / nodeDist;
			for (const other of this.nodeMeshes.values()) {
				if (other === focusedMesh) { continue; }
				const ox = other.position.x - camPos.x;
				const oy = other.position.y - camPos.y;
				const oz = other.position.z - camPos.z;
				const dist = Math.sqrt(ox * ox + oy * oy + oz * oz);
				// Only spheres meaningfully closer than the target can occlude it
				if (dist >= nodeDist - 12) { continue; }
				// Behind the camera never occludes
				const toward = (ox * dirX + oy * dirY + oz * dirZ) / dist;
				if (toward <= 0) { continue; }
				// Angular radius of a sphere (diameter ~16) at that distance
				const threshold = Math.cos(Math.atan(16 / dist));
				if (toward > threshold) {
					const blocked = false;
					return blocked;
				}
			}
			const clear = true;
			return clear;
		}

		// Distance from a camera position to the closest sphere OTHER
		// than the focused one — used to prefer views where the
		// selected element is also the nearest, so its caption reads
		// as the biggest in frame
		nearestOtherDistance(camPos, focusedMesh) {
			let nearest = Infinity;
			for (const other of this.nodeMeshes.values()) {
				if (other === focusedMesh) { continue; }
				const ox = other.position.x - camPos.x;
				const oy = other.position.y - camPos.y;
				const oz = other.position.z - camPos.z;
				const dist = Math.sqrt(ox * ox + oy * oy + oz * oz);
				if (dist < nearest) {
					nearest = dist;
				}
			}
			return nearest;
		}

		// Rotate the view around world Y in 20° steps until the focused
		// node is unoccluded; falls back to the original angles with a
		// warning when nothing clears (dense ball of nodes).
		// Two passes, owner's caption rule: the biggest caption in
		// frame should belong to the selected element, so pass 1 only
		// accepts angles where the focused sphere is ALSO the nearest
		// one to the camera; pass 2 falls back to merely unoccluded
		// (dense branches where a child legitimately sits closer)
		pickClearView(rotX, rotY, zoom, nodePos, focusedMesh) {
			const steps = [0, 20, -20, 40, -40, 60, -60, 80, -80, 100, -100, 120, -120, 140, -140, 160, -160, 180];
			const base = this.viewFromAngles(rotX, rotY);
			for (const preferClosest of [true, false]) {
				for (const stepDeg of steps) {
					const step = stepDeg * Math.PI / 180;
					const cosS = Math.cos(step);
					const sinS = Math.sin(step);
					const viewX = base.x * cosS + base.z * sinS;
					const viewZ = -base.x * sinS + base.z * cosS;
					const viewY = base.y;
					const candRotX = Math.asin(Math.max(-1, Math.min(1, -viewY)));
					const candRotY = Math.atan2(-viewX, -viewZ);
					if (!this.isViewClear(candRotX, candRotY, zoom, nodePos, focusedMesh)) { continue; }
					if (preferClosest) {
						const camPos = {
							x : nodePos.x - viewX * zoom,
							y : nodePos.y - viewY * zoom,
							z : nodePos.z - viewZ * zoom
						};
						const nearest = this.nearestOtherDistance(camPos, focusedMesh);
						if (nearest < zoom - 12) { continue; }
					}
					const result = { rotX: candRotX, rotY: candRotY };
					return result;
				}
			}
			debugLog('[focusNode] no occlusion-free angle found, keeping base view', 'warn');
			const fallback = { rotX, rotY };
			return fallback;
		}

		updateHover(event) {
			const rect = this.renderer.domElement.getBoundingClientRect();
			this.mouseVector.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
			this.mouseVector.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

			this.raycaster.setFromCamera(this.mouseVector, this.camera);
			const intersects = this.raycaster.intersectObjects(this.interactive);

			// Reset all emissive to each element's build-time base (except
			// the focused node — its pulse is driven by updateFocusPulse)
			this.interactive.forEach(mesh => {
				if (mesh === this.focusedMesh) return;
				const material = mesh.material;
				if (!material || material.emissiveIntensity === undefined) { return; }
				material.emissiveIntensity = mesh.userData.baseEmissive || 0;
			});

			// Highlight hovered only (no tooltip)
			const hoverHit = firstVisibleIntersect(intersects);
			if (hoverHit) {
				const mesh = hoverHit.object;
				mesh.material.emissiveIntensity = 0.5;
				this.container.style.cursor = 'pointer';
			} else {
				this.container.style.cursor = 'default';
			}
			// The emissive reset loop + hover highlight mutate materials
			this.needsRender = true;
		}

		handleNodeClick3D(event, node) {
			if (!node) return;

			// Single click - show/hide tooltip
			const tooltip = d3.select('#tooltip');
			const existingNodeId = tooltip.attr('data-node-id');
			if (tooltip.classed('visible') && existingNodeId === node.id) {
				tooltip.classed('visible', false);
			} else {
				const props = (node.properties || [])
					.map(p => p.name + ': ' + p.type)
					.join('<br>');
				const edsEntries = node.edsEntries || [];
				const edsRows = edsEntries.map((e, i) => {
					const site = e.parsedLocation;
					const siteHint = site ? ' ' + site.fileName.split('/').pop() + ':' + site.line : '';
					// Same external-scope marker as the 2D tooltip above.
					const scopeHint = e.scope ? ' [' + (e.scope === 'unknown' ? 'module' : e.scope) + ']' : '';
					return '<span class="eds-entry" data-eds-index="' + i + '" style="cursor:pointer;text-decoration:underline">' +
						e.kind + siteHint + scopeHint + '</span>';
				}).join('<br>');
				tooltip
					.attr('data-node-id', node.id)
					.classed('visible', true)
					.html('<strong>' + node.name + '</strong><br>' +
						'<em>depth: ' + node.depth + '</em><br>' +
						(props ? '<hr>' + props : '') +
						(edsRows ? '<hr>' + edsRows : ''))
					.style('left', (event.pageX + 10) + 'px')
					.style('top', (event.pageY - 10) + 'px');

				// Jump to the EDS (wrap/consume/hook) site on entry click
				tooltip.selectAll('.eds-entry').on('click', (event) => {
					event.stopPropagation();
					const entry = edsEntries[+event.currentTarget.getAttribute('data-eds-index')];
					if (entry && entry.parsedLocation) {
						d3.select('#tooltip').classed('visible', false);
						vscode.postMessage({
							command: 'goToDefinition',
							data: entry.parsedLocation
						});
					}
				});
			}
		}

		handleNodeDoubleClick3D(node, _event) {
			// Double click - jump to definition
			if ((node.location || node.definitionLocation) && this.onNodeClick) {
				this.onNodeClick(node);
			}
		}

		/**
		 * Tooltip for a creation-layer diamond: what scope it is, where it
		 * lives, which types it creates. The location row jumps to code —
		 * the same goToDefinition message the sphere EDS entries use
		 */
		handleCreationClick(event, node) {
			const tooltip = d3.select('#tooltip');
			const existingId = tooltip.attr('data-node-id');
			if (tooltip.classed('visible') && existingId === node.id) {
				tooltip.classed('visible', false);
				return;
			}
			const site = node.location;
			const siteText = site ? site.fileName.split('/').pop() + ':' + site.line + ':' + site.column : '';
			const siteRow = site
				? '<span class="jump-entry" style="cursor:pointer;text-decoration:underline">' + siteText + '</span>'
				: '';
			const createsRows = (node.creates || [])
				.map(c => c.typePath.split('.').pop())
				.join(', ');
			tooltip
				.attr('data-node-id', node.id)
				.classed('visible', true)
				.html('<strong>' + node.name + '</strong><br>' +
					'<em>' + node.kind + (node.starter ? ' · starter' : '') + '</em><br>' +
					(siteRow ? 'site: ' + siteRow + '<br>' : '') +
					(createsRows ? '<hr>creates: ' + createsRows : ''))
				.style('left', (event.pageX + 10) + 'px')
				.style('top', (event.pageY - 10) + 'px');
			if (site) {
				tooltip.selectAll('.jump-entry').on('click', (ev) => {
					ev.stopPropagation();
					d3.select('#tooltip').classed('visible', false);
					vscode.postMessage({ command: 'goToDefinition', data: site });
				});
			}
		}

		/**
		 * Tooltip for a wrapper bagel: what it wraps, where the wrap call
		 * site is, how it joins the graph. Joinless bagels are honest:
		 * terminal fibers with no wrapped descendants recorded
		 */
		handleWrapperClick(event, node) {
			const tooltip = d3.select('#tooltip');
			const existingId = tooltip.attr('data-node-id');
			if (tooltip.classed('visible') && existingId === node.id) {
				tooltip.classed('visible', false);
				return;
			}
			const site = node.location;
			const siteText = site ? site.fileName.split('/').pop() + ':' + site.line + ':' + site.column : '';
			const siteRow = site
				? '<span class="jump-entry" style="cursor:pointer;text-decoration:underline">' + siteText + '</span>'
				: '';
			const relations = [];
			if (node.wrapsTypePath) { relations.push('wraps: ' + node.wrapsTypePath); }
			if (node.hostTypePath) { relations.push('produced by: ' + node.hostTypePath); }
			if (node.callbackScopeId || node.holderScopeId) {
				const scopeName = (node.callbackScopeId || node.holderScopeId).split('/').pop();
				relations.push('scope: ' + scopeName);
			}
			if (relations.length === 0) {
				relations.push('<em>ambient — no instance carried; terminal fiber, no wrapped descendants</em>');
			}
			tooltip
				.attr('data-node-id', node.id)
				.classed('visible', true)
				.html('<strong>' + node.name + '</strong><br>' +
					'<em>wrap · generation ' + node.generation + '</em><br>' +
					(siteRow ? 'site: ' + siteRow : '') +
					'<hr>' + relations.join('<br>'))
				.style('left', (event.pageX + 10) + 'px')
				.style('top', (event.pageY - 10) + 'px');
			if (site) {
				tooltip.selectAll('.jump-entry').on('click', (ev) => {
					ev.stopPropagation();
					d3.select('#tooltip').classed('visible', false);
					vscode.postMessage({ command: 'goToDefinition', data: site });
				});
			}
		}

		/**
		 * Tooltip for an internals knot: name, role, and the source it
		 * mirrors. No jump — the citation lives in a sibling package,
		 * outside the analyzed workspace
		 */
		handleInternalClick(event, knot) {
			const tooltip = d3.select('#tooltip');
			const existingId = tooltip.attr('data-node-id');
			if (tooltip.classed('visible') && existingId === knot.id) {
				tooltip.classed('visible', false);
				return;
			}
			tooltip
				.attr('data-node-id', knot.id)
				.classed('visible', true)
				.html('<strong>' + knot.name + '</strong><br>' +
					'<em>' + knot.role + '</em>' +
					(knot.citation ? '<br><em>mirrors: ' + knot.citation + '</em>' : ''))
				.style('left', (event.pageX + 10) + 'px')
				.style('top', (event.pageY - 10) + 'px');
		}

		/**
		 * 3D Layout with human-readable spacing
		 * 
		 * 1. Root spacing based on actual label widths (char count × avg char width)
		 * 2. Generation gaps are smaller and more consistent
		 * 3. Center marker at origin
		 */
		renderGraph(data) {
			// Snapshot user-placed elements BEFORE clear() disposes them,
			// so a knob-driven relayout restores CURRENT positions instead
			// of the initial layout (2026-09-05 review: "increase/decrease
			// must look at current positions, not initial render
			// positions"). Spheres ride node.x3d (the drag writes it);
			// non-sphere pins ride this map, keyed by node id
			const pinnedSnapshot = new Map();
			const snapMesh = (mesh, key) => {
				if (!key || !mesh.userData.pinned) { return; }
				pinnedSnapshot.set(key, {
					hasAnchor : !!mesh.userData.pinAnchor,
					offset    : mesh.userData.pinOffset
						? { x: mesh.userData.pinOffset.x, y: mesh.userData.pinOffset.y, z: mesh.userData.pinOffset.z }
						: null,
					position  : { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }
				});
			};
			this.creationMeshes.forEach(m => snapMesh(m, m.userData.creationNode && m.userData.creationNode.id));
			this.wrapperMeshes.forEach(m => snapMesh(m, m.userData.wrapperNode && m.userData.wrapperNode.id));
			this.internalsMeshes.forEach(m => snapMesh(m, m.userData.internalNode && m.userData.internalNode.id));

			this.clear();

			// Layer groups — the "Layers" checkboxes flip their
			// .visible; one scene, one camera, all rotate together.
			// Wrappers + dive internals + adapter sinks share the single
			// diveGroup — the combined Dive graph
			this.typesGroup = new THREE.Group();
			this.instrumentationGroup = new THREE.Group();
			this.diveGroup = new THREE.Group();
			this.scene.add(this.typesGroup);
			this.scene.add(this.instrumentationGroup);
			this.scene.add(this.diveGroup);

			// Restore 3D coordinates if they exist
			data.nodes.forEach(node => {
				if (node.x3d !== undefined && node.y3d !== undefined) {
					node.x = node.x3d;
					node.y = node.y3d;
					node.z = node.z3d || 0;
				}
			});

			const colors = [
				0x4e79a7, 0xf28e2c, 0xe15759, 0x76b7b2, 0x59a14f,
				0xedc949, 0xaf7aa1, 0xff9da7, 0x9c755f, 0xbab0ab
			];

			// Build node lookup and parent-child relationships
			const nodeMap = new Map();
			data.nodes.forEach(node => {
				nodeMap.set(node.id, node);
				node.children = [];
			});

			// Build tree structure from links and resolve references
			const rootNodes = [];
			data.links.forEach(link => {
				const source = typeof link.source === 'object' ? link.source : nodeMap.get(link.source);
				const target = typeof link.target === 'object' ? link.target : nodeMap.get(link.target);
				if (source && target) {
					// Update link to use node objects
					link.source = source;
					link.target = target;
					source.children.push(target);
					target.parent = source;
				}
			});

			// Find root nodes (no parent)
			data.nodes.forEach(node => {
				if (!node.parent) {
					rootNodes.push(node);
				}
			});

			// Group nodes by depth
			const nodesByDepth = new Map();
			data.nodes.forEach(node => {
				const depth = node.depth || 0;
				if (!nodesByDepth.has(depth)) {
					nodesByDepth.set(depth, []);
				}
				nodesByDepth.get(depth).push(node);
			});

			// Configuration - TRUE 3D SPHERICAL LAYOUT
			const nodeRadius = 8;

			/**
			 * TRUE 3D SPHERICAL LAYOUT
			 * Each generation forms a complete spherical shell
			 * INCREASED distances for better visibility
			 */
			// Use instance depthRadii if available (for adjustments), otherwise use defaults
			// User preference: root ~105px (90-120 range), gen1 ~180px, gen2 ~245px, +65px each
			const maxDepth = Math.max(...data.nodes.map(n => n.depth || 0));
			if (!this.depthRadii) {
				const radii = get3D_Radii(maxDepth).map((r, i) => {
					// Data-driven widening: a crowded shell needs the
					// circumference to fit its nodes with label room
					// (10 nodeRadii of arc per node — 2026-09-05 review:
					// 6 left crowded shells unreadable at a glance).
					// Runs only at init — the Generation Distances
					// sliders own the values afterwards
					const count = (nodesByDepth.get(i) || []).length;
					const needed = count * nodeRadius * 10 / (2 * Math.PI);
					const widened = Math.max(r, needed);
					return widened;
				});
				// Keep shells strictly ordered after widening
				for (let i = 1; i < radii.length; i++) {
					if (radii[i] < radii[i - 1] + 40) { radii[i] = radii[i - 1] + 40; }
				}
				this.depthRadii = new Map(radii.map((r, i) => [i, r]));
			}
			const depthRadii = this.depthRadii;

			/**
			 * Distribute points evenly on a sphere surface
			 * Uses Fibonacci sphere algorithm for uniform distribution
			 */
			function placeOnSphere(radius, index, total) {
				if (total === 1) {
					return { x: radius, y: 0, z: 0 };
				}

				// Golden angle for uniform distribution
				const goldenAngle = Math.PI * (3 - Math.sqrt(5));

				// y goes from 1 to -1 (top to bottom of sphere)
				const y = 1 - (index / (total - 1)) * 2;
				const radiusAtY = Math.sqrt(1 - y * y);
				const theta = goldenAngle * index;

				return {
					x: radius * radiusAtY * Math.cos(theta),
					y: radius * y,
					z: radius * radiusAtY * Math.sin(theta)
				};
			}

			/**
			 * Place children in cone from parent direction
			 */
			function placeInCone(parentPos, childIndex, childCount, radius, maxAngle) {
				const parentR = Math.sqrt(parentPos.x ** 2 + parentPos.y ** 2 + parentPos.z ** 2);

				if (parentR < 0.001) {
					// Parent at center - distribute evenly on sphere
					return placeOnSphere(radius, childIndex, childCount);
				}

				// Parent direction
				const px = parentPos.x / parentR;
				const py = parentPos.y / parentR;
				const pz = parentPos.z / parentR;

				// Even distribution around parent direction
				const angleStep = (2 * Math.PI) / childCount;
				const theta = childIndex * angleStep;
				const deviation = (childIndex / Math.max(childCount - 1, 1)) * maxAngle;

				// Orthonormal basis
				let ux, uy, uz;
				if (Math.abs(px) < 0.9) {
					ux = 0; uy = -pz; uz = py;
				} else {
					ux = -pz; uy = 0; uz = px;
				}
				const ulen = Math.sqrt(ux * ux + uy * uy + uz * uz);
				ux /= ulen; uy /= ulen; uz /= ulen;

				const vx = py * uz - pz * uy;
				const vy = pz * ux - px * uz;
				const vz = px * uy - py * ux;

				// Direction
				const cosD = Math.cos(deviation);
				const sinD = Math.sin(deviation);
				const cosT = Math.cos(theta);
				const sinT = Math.sin(theta);

				const dx = cosD * px + sinD * (cosT * ux + sinT * vx);
				const dy = cosD * py + sinD * (cosT * uy + sinT * vy);
				const dz = cosD * pz + sinD * (cosT * uz + sinT * vz);

				return {
					x: radius * dx,
					y: radius * dy,
					z: radius * dz
				};
			}

			/**
			 * Calculate 3D position
			 * Uses saved x3d/y3d/z3d if available, otherwise calculates.
			 * x3d is ALSO the user-placed marker: the sphere drag writes
			 * it, so dragged spheres survive knob-driven relayouts
			 */
			function calculatePosition(node, depth, index, totalAtDepth) {
				// Check if we have saved 3D coordinates - use them!
				// (mode-switch restore, or a user-dragged sphere)
				if (node.x3d !== undefined && node.y3d !== undefined && node.z3d !== undefined) {
					return { x: node.x3d, y: node.y3d, z: node.z3d };
				}

				const radius = depthRadii.get(depth) || (105 + depth * 75);

				// ROOTS: distributed on sphere surface (not just a circle!)
				if (depth === 0) {
					return placeOnSphere(radius, index, totalAtDepth);
				}

				// CHILDREN: cone from parent
				if (!node.parent || node.parent.x === undefined) {
					return placeOnSphere(radius, index, totalAtDepth);
				}

				const siblings = node.parent.children;
				const siblingIndex = siblings.indexOf(node);
				const siblingCount = siblings.length;

				// 15-degree cone spread (smaller angle = tighter grouping)
				const maxAngle = Math.PI / 12;

				return placeInCone(node.parent, siblingIndex, siblingCount, radius, maxAngle);
			}

			// Add center marker sphere at origin (0,0,0) — the types
			// graph's orientation anchor, labeled with the collection
			// name. The creation layer's own center (a gold diamond)
			// sits tangent to this sphere's right side — both graphs
			// keep their centers, side by side
			const centerGeometry = new THREE.SphereGeometry(nodeRadius * 0.5, 16, 16);
			const centerMaterial = new THREE.MeshPhongMaterial({
				color: 0x800000, // Maroon
				emissive: 0x400000,
				emissiveIntensity: 0.5
			});
			const centerSphere = new THREE.Mesh(centerGeometry, centerMaterial);
			centerSphere.position.set(0, 0, 0);
			this.centerMarker = centerSphere;
			this.scene.add(centerSphere);
			// tactica emits no collection id yet and walks the default
			// collection only — the future collection switcher will
			// source this label from the payload
			this.addLabel(centerSphere, 'defaultTypes', 0.6);
			if (centerSphere.userData.label) {
				this.typesGroup.add(centerSphere.userData.label);
				this.typesGroup.add(centerSphere.userData.leader);
			}
			this.updateCenterMarkerVisibility();

			// Place all nodes
			nodesByDepth.forEach((nodesAtDepth, depth) => {
				nodesAtDepth.forEach((node, index) => {
					const pos = calculatePosition(node, depth, index, nodesAtDepth.length);
					node.x = pos.x;
					node.y = pos.y;
					node.z = pos.z;
					node.fx = node.x;
					node.fy = node.y;
					node.fz = node.z;
				});
			});

			// Create node meshes — one sphere per type node
			const sphereGeometry = new THREE.SphereGeometry(nodeRadius, 32, 32);

			data.nodes.forEach(node => {
				const color = colors[node.depth % colors.length];
				const material = new THREE.MeshPhongMaterial({
					color: color,
					shininess: 100,
					specular: 0x111111
				});

				if (node.isRoot) {
					material.emissive = new THREE.Color(0x8B0000);
					material.emissiveIntensity = 0.3;
				}

				// Diagnostic: no instantiation in usages.json — the type
				// never happens at runtime (the EdsProbe case); dim the
				// sphere. Its outgoing path-hits are never-taken too
				if (node.neverCreated) {
					material.transparent = true;
					material.opacity = 0.35;
				}

				const mesh = new THREE.Mesh(sphereGeometry, material);
				mesh.position.set(node.x, node.y, node.z);
				mesh.userData = { node, baseEmissive: node.isRoot ? 0.3 : 0 };

				this.addLabel(mesh, node.name);

				// addLabel attaches the sprite to the scene — re-parent it
				// into the layer group so the toggle hides labels too
				if (mesh.userData.label) {
					this.typesGroup.add(mesh.userData.label);
					this.typesGroup.add(mesh.userData.leader);
				}
				this.typesGroup.add(mesh);
				this.nodeMeshes.set(node.id, mesh);
			});

			// Create link lines - more visible
			const lineMaterial = new THREE.LineBasicMaterial({
				color: 0xaaaaaa,
				transparent: true,
				opacity: 0.8,
				linewidth: 2
			});

			// Arrow geometry for directional indicators
			const arrowGeometry = new THREE.ConeGeometry(3, 8, 8);
			arrowGeometry.rotateX(Math.PI / 2); // Point along Z axis initially
			const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xaaaaaa });

			data.links.forEach(link => {
				const geometry = new THREE.BufferGeometry();
				const positions = new Float32Array([0, 0, 0, 0, 0, 0]);
				geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
				const line = new THREE.Line(geometry, lineMaterial);
				this.typesGroup.add(line);

				// Add arrowhead
				const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
				this.typesGroup.add(arrow);

				this.linkLines.push({ line, arrow, link });
			});

			// EDS path-hit edges (createsTypes): guaranteed runtime paths from
			// a wrapped scope to the types it constructs. Thin cyan lines with
			// small arrowheads — wrap scope → constructed type. Never-taken
			// hits (the SOURCE type has no instantiation in usages.json — the
			// EdsProbe diagnostic) ride a dimmer material
			this.nodeRadius3d = nodeRadius;
			const pathHitMaterial = new THREE.LineBasicMaterial({
				color: 0x66ccff,
				transparent: true,
				opacity: 0.5
			});
			const pathHitNeverMaterial = new THREE.LineBasicMaterial({
				color: 0x66ccff,
				transparent: true,
				opacity: 0.12
			});
			const pathHitArrowGeometry = new THREE.ConeGeometry(1.8, 5, 8);
			pathHitArrowGeometry.rotateX(Math.PI / 2); // tip along +Z
			const pathHitArrowMaterial = new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.6 });
			(data.execflow || []).forEach(edge => {
				if (edge.kind !== 'edsPathHit') return;
				const source = nodeMap.get(edge.source);
				const target = nodeMap.get(edge.target);
				if (!source || !target) return;
				const geometry = new THREE.BufferGeometry();
				const positions = new Float32Array([0, 0, 0, 0, 0, 0]);
				geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
				const line = new THREE.Line(geometry, edge.neverTaken ? pathHitNeverMaterial : pathHitMaterial);
				const arrow = new THREE.Mesh(pathHitArrowGeometry, pathHitArrowMaterial);
				this.typesGroup.add(line);
				this.typesGroup.add(arrow);
				this.pathHitLines.push({ line, arrow, source, target });
			});

			// Creation graph layer (instrumentation.json v2): call chains
			// from entry points to `new` sites, rendered into the reserved
			// instrumentationGroup — diamonds for the knot scopes that
			// create types, on hidden shells around the created type's sphere
			this.buildCreationLayer(data, nodeMap, placeOnSphere, nodeRadius);

			// Wrappers graph layer (eds.json wrap entries): dive wrap
			// sites as rings, DIRECTED fiber edges between them, joined to
			// the creation diamonds whose scopes they wrap and to the type
			// spheres they wrap.
			// Builds AFTER the creation layer — ring positions hang off
			// live creation meshes
			this.buildWrappersLayer(data, nodeMap, placeOnSphere, nodeRadius);

			// Combined Dive backplane (declared ring/hub/sinks, attachHooks
			// grafts): builds AFTER wrappers — graft endpoints hang off live
			// type spheres, so it needs the nodeMap
			this.buildInternalsLayer(data, nodeMap, nodeRadius);

			// Restore the pins snapshotted before clear(): relative pins
			// re-resolve their (new) anchor mesh and keep their offset,
			// absolute pins land on their stored spot. The dynamics chain
			// below owns them from there
			const restoreMesh = (mesh, key) => {
				const snap = key ? pinnedSnapshot.get(key) : undefined;
				if (!snap) { return; }
				mesh.userData.pinned = true;
				if (snap.hasAnchor && snap.offset) {
					const anchor = this.resolvePinAnchor(mesh);
					if (anchor) {
						mesh.userData.pinAnchor = anchor;
						mesh.userData.pinOffset = new THREE.Vector3(snap.offset.x, snap.offset.y, snap.offset.z);
						mesh.position.copy(anchor.position).add(mesh.userData.pinOffset);
						return;
					}
				}
				mesh.position.set(snap.position.x, snap.position.y, snap.position.z);
			};
			this.creationMeshes.forEach(m => restoreMesh(m, m.userData.creationNode && m.userData.creationNode.id));
			this.wrapperMeshes.forEach(m => restoreMesh(m, m.userData.wrapperNode && m.userData.wrapperNode.id));
			this.internalsMeshes.forEach(m => restoreMesh(m, m.userData.internalNode && m.userData.internalNode.id));

			// Second layout step: deterministic shell-constrained
			// relaxation — spheres slide ON their shells until no two
			// effective discs overlap, then labels alternate above/below
			this.relaxTypeShells(data, nodeRadius);

			// Everything the pointer may grab or click. Rings/knots join
			// by their userData payload (arrows ride the same buckets for
			// disposal but carry none — filtered out). Rebuilt per render
			this.interactive = [
				...Array.from(this.nodeMeshes.values()),
				...this.creationMeshes.filter(m => m.userData.creationNode),
				...this.wrapperMeshes.filter(m => m.userData.wrapperNode),
				...this.internalsMeshes.filter(m => m.userData.internalNode)
			];

			// Update link positions
			this.updateLinkPositions();
		}

		/**
		 * Layout relaxation, the deterministic second step after initial
		 * placement (2026-09-04 review: dense shells crossed figures and
		 * labels). Type spheres repel SLIDING ON THEIR OWN SHELL — the
		 * radial distance (generation geometry) never changes, only the
		 * angular position. A sphere's effective radius grows with its
		 * holder crown (diamonds live at ×2.4 around it) so crowns stop
		 * colliding too. Fixed iteration order, fixed cap: same graph,
		 * same layout, every render. Ends by alternating label sides
		 * (even above, odd below) so neighbouring signs don't stack.
		 * Everything downstream (diamond shells, bagels, edges) follows
		 * through the dynamics chain in updateLinkPositions().
		 */
		relaxTypeShells(data, nodeRadius) {
			const meshes = Array.from(this.nodeMeshes.values());
			if (meshes.length < 2 || !this.depthRadii) { return; }

			// Holder crown sizes from the creation data (primary anchor
			// only — a diamond sits on its primary's shell)
			const crownByType = new Map();
			const creation = data.creation;
			if (creation && Array.isArray(creation.nodes)) {
				creation.nodes.forEach(n => {
					if (!Array.isArray(n.creates) || n.creates.length === 0) { return; }
					const primary = n.creates[0].typePath;
					crownByType.set(primary, (crownByType.get(primary) || 0) + 1);
				});
			}
			const effRadius = meshes.map(mesh => {
				const id = mesh.userData.node ? mesh.userData.node.id : '';
				const crown = crownByType.get(id) || 0;
				// 2026-09-05 review: grown again (1.7 → 2.2 uncrowned,
				// 2.9/0.12 → 3.3/0.15 crowned) — crowded shells must stay
				// readable at a glance, not just non-overlapping
				const r = crown > 0
					? nodeRadius * (3.3 + Math.min(crown, 8) * 0.15)
					: nodeRadius * 2.2;
				return r;
			});
			const shellRadius = meshes.map(mesh => {
				const depth = mesh.userData.node ? (mesh.userData.node.depth || 0) : 0;
				const r = this.depthRadii.get(depth) || mesh.position.length() || 1;
				return r;
			});

			const ITERATIONS = 80;
			const DAMPING = 0.4;
			const EPSILON = 0.05;
			for (let iter = 0; iter < ITERATIONS; iter++) {
				let maxPush = 0;
				for (let i = 0; i < meshes.length; i++) {
					for (let j = i + 1; j < meshes.length; j++) {
						const a = meshes[i].position;
						const b = meshes[j].position;
						const dx = b.x - a.x;
						const dy = b.y - a.y;
						const dz = b.z - a.z;
						const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
						const minD = effRadius[i] + effRadius[j];
						if (d >= minD || d < 1e-9) { continue; }
						const push = (minD - d) * DAMPING;
						const ux = dx / d;
						const uy = dy / d;
						const uz = dz / d;
						// Project the push onto each sphere's own tangent
						// plane (drop the radial component), apply, then
						// renormalize back to the shell radius
						[a, b].forEach((pos, k) => {
							const sign = k === 0 ? -1 : 1;
							const idx = k === 0 ? i : j;
							// User-placed spheres (dragged — x3d set)
							// anchor the layout: they repel neighbours
							// but never move themselves
							const nodeData = meshes[idx].userData.node;
							if (nodeData && nodeData.x3d !== undefined) { return; }
							let mx = sign * ux * push;
							let my = sign * uy * push;
							let mz = sign * uz * push;
							const len = pos.length() || 1;
							const rx = pos.x / len;
							const ry = pos.y / len;
							const rz = pos.z / len;
							const radialPart = mx * rx + my * ry + mz * rz;
							mx -= radialPart * rx;
							my -= radialPart * ry;
							mz -= radialPart * rz;
							pos.x += mx;
							pos.y += my;
							pos.z += mz;
							const newLen = pos.length() || 1;
							pos.multiplyScalar(shellRadius[idx] / newLen);
						});
						if (push > maxPush) { maxPush = push; }
					}
				}
				if (maxPush < EPSILON) { break; }
			}

			// Labels alternate above/below their sphere so neighbouring
			// signs don't stack; the leader lines keep attribution
			meshes.forEach((mesh, i) => {
				if (!mesh.userData.label) { return; }
				const scale = mesh.userData.labelScale || 1;
				mesh.userData.labelOffsetY = (i % 2 === 0 ? 1 : -1) * 35 * scale;
			});
		}

		updateLinkPositions() {
			// Catch-all invalidation: renderGraph, node drag, and the
			// gen-radius relayout all end up here
			this.needsRender = true;
			this.pathHitLines.forEach(({ line, arrow, source, target }) => {
				const positions = line.geometry.attributes.position.array;
				const sx = source.x || 0;
				const sy = source.y || 0;
				const sz = source.z || 0;
				const tx = target.x || 0;
				const ty = target.y || 0;
				const tz = target.z || 0;
				positions[0] = sx;
				positions[1] = sy;
				positions[2] = sz;
				positions[3] = tx;
				positions[4] = ty;
				positions[5] = tz;
				line.geometry.attributes.position.needsUpdate = true;
				// Arrowhead on the target sphere's surface — same ratio
				// trick as the skeleton arrows
				if (arrow) {
					const dx = tx - sx;
					const dy = ty - sy;
					const dz = tz - sz;
					const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
					const nodeRadius = this.nodeRadius3d || 12;
					if (len > nodeRadius) {
						const ratio = (len - nodeRadius) / len;
						arrow.position.set(sx + dx * ratio, sy + dy * ratio, sz + dz * ratio);
						arrow.lookAt(tx, ty, tz);
					}
				}
			});
			this.linkLines.forEach(({ line, arrow, link }) => {
				const positions = line.geometry.attributes.position.array;
				const source = typeof link.source === 'object' ? link.source : null;
				const target = typeof link.target === 'object' ? link.target : null;
				if (source && target) {
					const sx = source.x || 0;
					const sy = source.y || 0;
					const sz = source.z || 0;
					const tx = target.x || 0;
					const ty = target.y || 0;
					const tz = target.z || 0;

					positions[0] = sx;
					positions[1] = sy;
					positions[2] = sz;
					positions[3] = tx;
					positions[4] = ty;
					positions[5] = tz;
					line.geometry.attributes.position.needsUpdate = true;

					// Position arrow at target, pointing from source to target
					if (arrow) {
						// Position arrow slightly before target (to not overlap node)
						const dx = tx - sx;
						const dy = ty - sy;
						const dz = tz - sz;
						const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
						const nodeRadius = 12; // Approximate node radius

						if (len > nodeRadius) {
							// Position arrow before the target node
							const ratio = (len - nodeRadius) / len;
							const ax = sx + dx * ratio;
							const ay = sy + dy * ratio;
							const az = sz + dz * ratio;

							arrow.position.set(ax, ay, az);

							// Orient arrow to point from source to target
							arrow.lookAt(tx, ty, tz);
						}
					}
				}
			});
			// Creation-layer geometry follows type spheres when they move
			// (drag): holder tangents, mid-chain interpolations, and the
			// creation edge lines all recompute from live node coords
			this.creationDynamics.forEach(update => update());
			// Wrapper rings hang off creation meshes, so they update AFTER
			// the creation dynamics have produced fresh holder positions
			this.wrapperDynamics.forEach(update => update());
			// Hookup edges hang off bagel meshes — last in the chain
			this.internalsDynamics.forEach(update => update());
		}

		/**
		 * The creation-graph center node — the main.ts module starter (the
		 * "center sphere" of the creation paradigm), falling back to any
		 * module starter, then any starter, then the first node.
		 */
		findCreationCenter(creation) {
			if (!creation || !Array.isArray(creation.nodes) || creation.nodes.length === 0) {
				return null;
			}
			const nodes = creation.nodes;
			const starters = nodes.filter(n => n.starter);
			const result = starters.find(n => n.kind === 'module' && /\/main\.ts$/.test(n.filePath)) ||
				starters.find(n => n.kind === 'module') ||
				starters[0] ||
				nodes[0];
			return result;
		}

		/**
		 * The maroon collection marker belongs to the types layer: it is
		 * visible exactly when that layer is. The creation layer no longer
		 * replaces it — its center diamond sits tangent to the marker's
		 * right side instead.
		 */
		updateCenterMarkerVisibility() {
			if (!this.centerMarker) {
				return;
			}
			const visible = !this.typesGroup || this.typesGroup.visible;
			this.centerMarker.visible = visible;
			if (this.centerMarker.userData.label) {
				this.centerMarker.userData.label.visible = visible;
			}
			if (this.centerMarker.userData.leader) {
				this.centerMarker.userData.leader.visible = visible;
			}
		}

		/**
		 * Creation graph layer (instrumentation.json v2). Nodes are scopes
		 * on the static call path to `new` sites, edges run caller → callee
		 * with the callee one hop closer to creation. Deterministic pinned
		 * layout mirroring the type shells:
		 *  - the main.ts starter is a gold DIAMOND tangent to the
		 *    collection marker's right side (+X) — both graphs keep their
		 *    own center, side by side
		 *  - other starters occupy normalized sub-rings between the center
		 *    and the gen-0 shell, one ring per hop from the center,
		 *    Fibonacci spread
		 *  - holders (scopes with `new` anchors) are diamonds placed on a
		 *    hidden CONCENTRIC SHELL around their created type's sphere
		 *    (dir × nodeRadius × 2.4 from the sphere center; the first
		 *    holder keeps the +X anchor, co-holders Fibonacci-spread
		 *    over the whole shell); EVERY held type gets a DASHED edge
		 *    with an arrowhead at the sphere tip (diamond → sphere: the
		 *    holder creates the type) — the diamond keeps its shape, the
		 *    links read as invocation edges. Call edges carry arrowheads
		 *    too (caller → callee).
		 *    Holders wired into the call graph (any edge in/out) glow
		 *    cyan; isolated ones (their own entry points) keep orchid
		 *  - mid-chain nodes interpolate between their chain's starter and
		 *    holder positions by relative hop distance
		 * Everything lands in instrumentationGroup — the Layers checkbox
		 * toggles the whole layer, labels included. Creation meshes stay
		 * OUT of nodeMeshes but ride the interactive list: drag pins
		 * them, click shows the scope tooltip, double-click jumps to
		 * the scope's location.
		 */
		buildCreationLayer(data, nodeMap, placeOnSphere, nodeRadius) {
			const creation = data.creation;
			if (!creation || !Array.isArray(creation.nodes) || creation.nodes.length === 0) {
				return;
			}
			const nodes = creation.nodes;
			const links = Array.isArray(creation.links) ? creation.links : [];
			const byId = new Map();
			nodes.forEach(n => byId.set(n.id, n));

			const outgoing = new Map();
			const incoming = new Map();
			links.forEach(link => {
				if (!byId.has(link.source) || !byId.has(link.target)) { return; }
				if (!outgoing.has(link.source)) { outgoing.set(link.source, []); }
				outgoing.get(link.source).push(link.target);
				if (!incoming.has(link.target)) { incoming.set(link.target, []); }
				incoming.get(link.target).push(link.source);
			});

			const center = this.findCreationCenter(creation);

			// Hop depth from the center, walking caller → callee
			const hop = new Map();
			if (center) {
				hop.set(center.id, 0);
				const queue = [center.id];
				while (queue.length) {
					const current = queue.shift();
					const nextHop = hop.get(current) + 1;
					(outgoing.get(current) || []).forEach(next => {
						if (!hop.has(next)) {
							hop.set(next, nextHop);
							queue.push(next);
						}
					});
				}
			}
			const maxHop = Math.max(0, ...hop.values());

			// Starters the center cannot reach are entry points of their
			// own — they land on the outermost sub-ring
			const hasOuterStarterRing = nodes.some(n => n.starter && n !== center && !hop.has(n.id));
			const maxRing = Math.max(maxHop + (hasOuterStarterRing ? 1 : 0), 1);
			const gen0Radius = (this.depthRadii && this.depthRadii.get(0)) || 105;
			const ringRadius = (h) => gen0Radius * h / (maxRing + 1);

			const diamondRadius = nodeRadius * 0.55;

			const positions = new Map();
			if (center) {
				// The creation center is a diamond too, tangent to the
				// collection marker's RIGHT side (+X): both graphs keep
				// their own center, side by side
				positions.set(center.id, { x: nodeRadius * 0.5 + diamondRadius, y: 0, z: 0 });
			}

			// Non-center starters on their sub-rings, Fibonacci spread
			const startersByRing = new Map();
			nodes.forEach(n => {
				if (!n.starter || n === center) { return; }
				const h = hop.has(n.id) ? hop.get(n.id) : maxRing;
				const ring = Math.min(Math.max(h, 1), maxRing);
				if (!startersByRing.has(ring)) { startersByRing.set(ring, []); }
				startersByRing.get(ring).push(n);
			});
			startersByRing.forEach((ringNodes, ring) => {
				const r = ringRadius(ring);
				ringNodes.forEach((n, i) => {
					positions.set(n.id, placeOnSphere(r, i, ringNodes.length));
				});
			});

			// Holder anchors resolve to their type spheres. Co-holders of
			// one type spread over a hidden CONCENTRIC SHELL around the
			// sphere: k=0 keeps the canonical +X anchor, k≥1 walks a
			// golden-angle Fibonacci lattice over the whole shell, so a
			// pile of co-holder labels never hides the sphere
			const goldenAngle = Math.PI * (3 - Math.sqrt(5));
			// Count co-holders per type first (mirroring the resolution
			// guards below) so the lattice knows its total
			const holderCountByType = new Map();
			nodes.forEach(holder => {
				if (!Array.isArray(holder.creates) || holder.creates.length === 0) { return; }
				const seenTypes = new Set();
				holder.creates.forEach(anchor => {
					if (seenTypes.has(anchor.typePath)) { return; }
					seenTypes.add(anchor.typePath);
					const typeNode = nodeMap.get(anchor.typePath);
					if (!typeNode || typeNode.x === undefined) { return; }
					holderCountByType.set(anchor.typePath, (holderCountByType.get(anchor.typePath) || 0) + 1);
				});
			});
			const typeHolderSpread = new Map();
			const holderAnchors = new Map();
			nodes.forEach(holder => {
				if (!Array.isArray(holder.creates) || holder.creates.length === 0) { return; }
				const entries = [];
				const seenTypes = new Set();
				holder.creates.forEach(anchor => {
					if (seenTypes.has(anchor.typePath)) { return; }
					seenTypes.add(anchor.typePath);
					const typeNode = nodeMap.get(anchor.typePath);
					if (!typeNode || typeNode.x === undefined) { return; }
					let spread = typeHolderSpread.get(anchor.typePath);
					if (!spread) { spread = new Set(); typeHolderSpread.set(anchor.typePath, spread); }
					const k = spread.size;
					spread.add(holder.id);
					let dir;
					if (k === 0) {
						dir = new THREE.Vector3(1, 0, 0);
					} else {
						const total = holderCountByType.get(anchor.typePath) || 1;
						const remaining = Math.max(total - 1, 1);
						const y = 1 - ((k - 0.5) / remaining) * 2;
						const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
						const theta = k * goldenAngle;
						dir = new THREE.Vector3(
							radiusAtY * Math.cos(theta), y, radiusAtY * Math.sin(theta)
						).normalize();
					}
					entries.push({ typePath: anchor.typePath, typeNode, dir });
				});
				if (entries.length > 0) {
					// Shallowest shell first, typePath as tie-break — the
					// extremes of this ordering define the bar tips
					entries.sort((a, b) => {
						const dd = (a.typeNode.depth || 0) - (b.typeNode.depth || 0);
						const cmp = dd !== 0 ? dd : (a.typePath < b.typePath ? -1 : (a.typePath > b.typePath ? 1 : 0));
						return cmp;
					});
					holderAnchors.set(holder.id, entries);
				}
			});

			// The connector aims THROUGH the sphere center and ends on the
			// surface point FACING the diamond (2026-09-05 owner review:
			// the old tangent point kept the INITIAL shell-slot direction
			// (entry.dir), so a dragged diamond's arrow read as off-center).
			// Live positions on both ends — the sphere mesh is
			// authoritative (drags, shell relaxation)
			const sphereTipToward = (entry, fromPos) => {
				const sphereMesh = this.nodeMeshes.get(entry.typePath);
				const cx = sphereMesh ? sphereMesh.position.x : (entry.typeNode.x || 0);
				const cy = sphereMesh ? sphereMesh.position.y : (entry.typeNode.y || 0);
				const cz = sphereMesh ? sphereMesh.position.z : (entry.typeNode.z || 0);
				const dx = cx - fromPos.x;
				const dy = cy - fromPos.y;
				const dz = cz - fromPos.z;
				const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
				const result = new THREE.Vector3(
					cx - (dx / len) * nodeRadius,
					cy - (dy / len) * nodeRadius,
					cz - (dz / len) * nodeRadius
				);
				return result;
			};

			// The hidden concentric shell: co-holder diamonds live well off
			// the sphere surface (dir × nodeRadius × SHELL_FACTOR from the
			// sphere center) so their labels stay readable and the sphere
			// behind them stays visible. SHELL_FACTOR is the "Holder ring"
			// knob of the Layers & Distances panel
			const SHELL_FACTOR = this.layerDistances.creation.holderShell;
			const shellPoint = (entry) => {
				const typeNode = entry.typeNode;
				const result = new THREE.Vector3(
					(typeNode.x || 0) + entry.dir.x * nodeRadius * SHELL_FACTOR,
					(typeNode.y || 0) + entry.dir.y * nodeRadius * SHELL_FACTOR,
					(typeNode.z || 0) + entry.dir.z * nodeRadius * SHELL_FACTOR
				);
				return result;
			};

			const starterGeometry = new THREE.SphereGeometry(nodeRadius * 0.42, 16, 16);
			const chainGeometry = new THREE.SphereGeometry(nodeRadius * 0.36, 16, 16);
			const diamondGeometry = new THREE.OctahedronGeometry(diamondRadius);
			this.creationGeometries.push(starterGeometry, chainGeometry, diamondGeometry);

			const centerColor = 0xffd700;
			const starterColor = 0x40c4ff;
			const chainColor = 0x90a4ae;
			// Holder scheme: orchid = isolated (no invocation edges — the
			// scope is its own entry point), cyan = wired into the call
			// graph. Cyan stays in the starter/chain blue family and clear
			// of maroon (collection center) and red (errors)
			const holderColor = 0xda70d6;
			const holderConnectedColor = 0x26c6da;
			const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x8a7ca8, transparent: true, opacity: 0.35 });
			// Held types beyond the primary link to the diamond DASHED —
			// the bar stretch was rejected: the diamond keeps its shape
			// and the connections read as edges of the invocation graph
			const connectorMaterial = new THREE.LineDashedMaterial({
				color: holderColor,
				dashSize: diamondRadius * 0.6,
				gapSize: diamondRadius * 0.4,
				transparent: true,
				opacity: 0.7
			});
			// Arrowhead at the sphere tip of every connector: the holder
			// CREATES the type, so the direction is diamond → sphere
			const connectorArrowGeometry = new THREE.ConeGeometry(1.2, 3.5, 8);
			connectorArrowGeometry.rotateX(Math.PI / 2); // tip along +Z
			const connectorArrowMaterial = new THREE.MeshBasicMaterial({ color: holderColor, transparent: true, opacity: 0.85 });
			this.creationGeometries.push(connectorArrowGeometry);
			this.creationMaterials.push(connectorArrowMaterial);
			this.creationMaterials.push(edgeMaterial, connectorMaterial);

			// Holder meshes: one diamond tangent to the primary held type
			// at exactly one point; every further held type gets a dashed
			// connector edge
			const holderRecords = new Map();
			holderAnchors.forEach((entries, holderId) => {
				const holder = byId.get(holderId);
				// Connected holders (any invocation edge in/out) glow cyan;
				// isolated ones keep the orchid they had
				const connected = incoming.has(holderId) || outgoing.has(holderId);
				const baseColor = connected ? holderConnectedColor : holderColor;
				const material = new THREE.MeshPhongMaterial({
					color: baseColor,
					emissive: baseColor,
					emissiveIntensity: 0.25,
					shininess: 60,
					specular: 0x222222
				});
				const mesh = new THREE.Mesh(diamondGeometry, material);
				mesh.userData = { creationNode: holder, baseEmissive: 0.25 };
				const record = { holder, mesh, entries, connectors: [] };
				const primary = entries[0];
				// A vertex of the octahedron FACES the sphere: local +Y
				// rotated onto the direction pointing AWAY from it
				mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), primary.dir.clone().negate());
				mesh.position.copy(shellPoint(primary));
				// EVERY held type gets a dashed connector — the primary too:
				// a dragged diamond must stay attributable to what it creates
				entries.forEach(entry => {
					const geometry = new THREE.BufferGeometry();
					geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
					const line = new THREE.Line(geometry, connectorMaterial);
					this.instrumentationGroup.add(line);
					this.creationLines.push(line);
					const arrow = new THREE.Mesh(connectorArrowGeometry, connectorArrowMaterial);
					arrow.userData = {};
					this.instrumentationGroup.add(arrow);
					this.creationMeshes.push(arrow);
					record.connectors.push({ line, entry, arrow });
				});
				this.instrumentationGroup.add(mesh);
				this.creationMeshes.push(mesh);
				this.creationMeshById.set(holderId, mesh);
				this.addLabel(mesh, holder.name, 0.55);
				if (mesh.userData.label) {
					this.instrumentationGroup.add(mesh.userData.label);
					this.instrumentationGroup.add(mesh.userData.leader);
				}
				positions.set(holderId, { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z });
				holderRecords.set(holderId, record);
			});

			// Mid-chain placement: nearest upstream starter and nearest
			// downstream holder, interpolated by relative hop distance
			const starterIds = new Set(nodes.filter(n => n.starter).map(n => n.id));
			const bfsTo = (startId, nextMap, accept) => {
				const dist = new Map([[startId, 0]]);
				const queue = [startId];
				while (queue.length) {
					const current = queue.shift();
					const d = dist.get(current);
					if (d > 0 && accept(current)) {
						const found = { id: current, dist: d };
						return found;
					}
					(nextMap.get(current) || []).forEach(next => {
						if (!dist.has(next)) {
							dist.set(next, d + 1);
							queue.push(next);
						}
					});
				}
				return null;
			};

			const chainRecords = [];
			const fallbackByRing = new Map();
			nodes.forEach(n => {
				if (positions.has(n.id)) { return; }
				const up = bfsTo(n.id, incoming, id => starterIds.has(id));
				const down = bfsTo(n.id, outgoing, id => holderRecords.has(id));
				if (up && down) {
					chainRecords.push({ node: n, upId: up.id, holderId: down.id, t: up.dist / (up.dist + down.dist), mesh: null });
				} else {
					const h = hop.has(n.id) ? hop.get(n.id) : maxRing;
					const ring = Math.min(Math.max(h, 1), maxRing);
					if (!fallbackByRing.has(ring)) { fallbackByRing.set(ring, []); }
					fallbackByRing.get(ring).push(n);
				}
			});
			fallbackByRing.forEach((ringNodes, ring) => {
				const r = ringRadius(ring);
				ringNodes.forEach((n, i) => {
					positions.set(n.id, placeOnSphere(r, i, ringNodes.length));
				});
			});

			chainRecords.forEach(record => {
				const a = positions.get(record.upId);
				const b = holderRecords.get(record.holderId).mesh.position;
				const mesh = new THREE.Mesh(chainGeometry, new THREE.MeshPhongMaterial({ color: chainColor, shininess: 40 }));
				mesh.userData = { creationNode: record.node };
				mesh.position.set(
					a.x + (b.x - a.x) * record.t,
					a.y + (b.y - a.y) * record.t,
					a.z + (b.z - a.z) * record.t
				);
				record.mesh = mesh;
				this.instrumentationGroup.add(mesh);
				this.creationMeshes.push(mesh);
				this.creationMeshById.set(record.node.id, mesh);
				this.addLabel(mesh, record.node.name, 0.55);
				if (mesh.userData.label) {
					this.instrumentationGroup.add(mesh.userData.label);
					this.instrumentationGroup.add(mesh.userData.leader);
				}
				positions.set(record.node.id, { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z });
			});

			// Center (a diamond — the diamond graph's own center), starter,
			// and fallback meshes
			nodes.forEach(n => {
				if (this.creationMeshById.has(n.id)) { return; }
				const pos = positions.get(n.id) || { x: 0, y: 0, z: 0 };
				const isCenter = center && n.id === center.id;
				const geometry = isCenter ? diamondGeometry : (n.starter ? starterGeometry : chainGeometry);
				const color = isCenter ? centerColor : (n.starter ? starterColor : chainColor);
				const material = new THREE.MeshPhongMaterial({
					color: color,
					shininess: 60,
					emissive: isCenter ? 0x8a6d00 : 0x000000,
					emissiveIntensity: isCenter ? 0.5 : 0
				});
				const mesh = new THREE.Mesh(geometry, material);
				mesh.userData = { creationNode: n, baseEmissive: isCenter ? 0.5 : 0 };
				mesh.position.set(pos.x, pos.y, pos.z);
				this.instrumentationGroup.add(mesh);
				this.creationMeshes.push(mesh);
				this.creationMeshById.set(n.id, mesh);
				this.addLabel(mesh, n.name, isCenter ? 0.7 : 0.55);
				if (mesh.userData.label) {
					this.instrumentationGroup.add(mesh.userData.label);
					this.instrumentationGroup.add(mesh.userData.leader);
				}
			});

			// Call edges as one LineSegments; endpoints are rewritten from
			// live mesh positions by the dynamic updater
			const pairs = [];
			links.forEach(link => {
				const from = this.creationMeshById.get(link.source);
				const to = this.creationMeshById.get(link.target);
				if (from && to) {
					pairs.push({ from, to });
				}
			});
			const edgePositions = new Float32Array(pairs.length * 6);
			const edgeGeometry = new THREE.BufferGeometry();
			edgeGeometry.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
			const edgeSegments = new THREE.LineSegments(edgeGeometry, edgeMaterial);
			this.instrumentationGroup.add(edgeSegments);
			this.creationLines.push(edgeSegments);

			// Direction matters (caller → callee): one arrowhead cone per
			// call edge, rewritten together with the segment endpoints.
			// Arrows ride creationMeshes for disposal but carry no
			// creationNode, so the interactive filter never grabs them
			const callArrowGeometry = new THREE.ConeGeometry(1.4, 4, 8);
			callArrowGeometry.rotateX(Math.PI / 2); // tip along +Z
			const callArrowMaterial = new THREE.MeshBasicMaterial({ color: 0x8a7ca8, transparent: true, opacity: 0.85 });
			this.creationGeometries.push(callArrowGeometry);
			this.creationMaterials.push(callArrowMaterial);
			const callArrows = pairs.map(pair => {
				const arrow = new THREE.Mesh(callArrowGeometry, callArrowMaterial);
				arrow.userData = {};
				this.instrumentationGroup.add(arrow);
				this.creationMeshes.push(arrow);
				const entry = { arrow, pair };
				return entry;
			});

			this.creationDynamics.push(() => {
				holderRecords.forEach(record => {
					const primary = record.entries[0];
					// A pinned diamond keeps the user's chosen OFFSET from
					// its primary sphere (2026-09-05): dragging the sphere
					// carries the diamond along, as if never detached.
					// Anchor-less pins stay absolute. Connectors below
					// still follow from wherever it lands
					if (record.mesh.userData.pinned) {
						if (record.mesh.userData.pinAnchor) {
							record.mesh.position.copy(record.mesh.userData.pinAnchor.position).add(record.mesh.userData.pinOffset);
						}
					} else {
						record.mesh.position.copy(shellPoint(primary));
					}
					this.updateLabelPosition(record.mesh);
					record.connectors.forEach(({ line, entry, arrow }) => {
						const p = line.geometry.attributes.position.array;
						p[0] = record.mesh.position.x;
						p[1] = record.mesh.position.y;
						p[2] = record.mesh.position.z;
						const tip = sphereTipToward(entry, record.mesh.position);
						p[3] = tip.x;
						p[4] = tip.y;
						p[5] = tip.z;
						line.geometry.attributes.position.needsUpdate = true;
						// LineDashedMaterial needs fresh distances after
						// every position rewrite or the dash pattern breaks
						line.computeLineDistances();
						// Arrowhead rides just off the sphere surface tip
						const a = record.mesh.position;
						const dx = tip.x - a.x;
						const dy = tip.y - a.y;
						const dz = tip.z - a.z;
						const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
						const gap = 2;
						arrow.visible = len > gap * 2;
						if (arrow.visible) {
							const ratio = (len - gap) / len;
							arrow.position.set(a.x + dx * ratio, a.y + dy * ratio, a.z + dz * ratio);
							arrow.lookAt(tip.x, tip.y, tip.z);
						}
					});
				});
				chainRecords.forEach(record => {
					const upMesh = this.creationMeshById.get(record.upId);
					if (!upMesh || !record.mesh) { return; }
					// A pinned chain scope keeps the user's drop spot
					// (2026-09-05 owner review: app.module.ts snapped back
					// mid-drag — this interpolation rewrote its position on
					// every update, so it read as "not movable" next to the
					// freely draggable main.ts center diamond). Same
					// absolute-pin rule as anchor-less holders
					if (record.mesh.userData.pinned) {
						this.updateLabelPosition(record.mesh);
						return;
					}
					const b = holderRecords.get(record.holderId).mesh.position;
					record.mesh.position.set(
						upMesh.position.x + (b.x - upMesh.position.x) * record.t,
						upMesh.position.y + (b.y - upMesh.position.y) * record.t,
						upMesh.position.z + (b.z - upMesh.position.z) * record.t
					);
					this.updateLabelPosition(record.mesh);
				});
				const ep = edgeSegments.geometry.attributes.position.array;
				pairs.forEach((pair, i) => {
					ep[i * 6] = pair.from.position.x;
					ep[i * 6 + 1] = pair.from.position.y;
					ep[i * 6 + 2] = pair.from.position.z;
					ep[i * 6 + 3] = pair.to.position.x;
					ep[i * 6 + 4] = pair.to.position.y;
					ep[i * 6 + 5] = pair.to.position.z;
				});
				edgeSegments.geometry.attributes.position.needsUpdate = true;
				callArrows.forEach(({ arrow, pair }) => {
					const a = pair.from.position;
					const b = pair.to.position;
					const dx = b.x - a.x;
					const dy = b.y - a.y;
					const dz = b.z - a.z;
					const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
					const gap = nodeRadius * 0.7;
					arrow.visible = len > gap;
					if (arrow.visible) {
						const ratio = (len - gap) / len;
						arrow.position.set(a.x + dx * ratio, a.y + dy * ratio, a.z + dz * ratio);
						arrow.lookAt(b.x, b.y, b.z);
					}
				});
			});

			// Place everything before the first frame paints
			this.creationDynamics.forEach(update => update());
		}

		/**
		 * Wrappers graph layer (eds.json wrap entries) — the bagels of the
		 * combined Dive graph. One ring (torus — the dive "wrap" made
		 * visible) per wrap call site. A bagel ENCIRCLES the element it
		 * wraps, drawn vertical (the EDS ring at the origin stays the
		 * horizontal-tilted one):
		 *  - joined to a creation scope: centered on that scope's
		 *    DIAMOND, snug (the wrapped element is the callback —
		 *    wrap(fn, instance) wraps fn; the instance is context)
		 *  - else, with no scope to host it, wraps a type's constructor
		 *    (wrapsTypePath — dive('T', wrap(fn), scope) at define
		 *    time): centered on the type SPHERE, snug
		 *  - else ambient: the outer shell past gen-0, Fibonacci spread
		 * Several bagels on one target onion out: radius × (1 + k·0.22),
		 * the vertical axis rotated k·goldenAngle around Y — a gyroscope
		 * shell, never a stack.
		 * Fiber edges are DIRECTED (arrowheads on the target): solid amber
		 * for `via` generation chains, dashed light-amber for `ctor`
		 * construction-mediated hops, salmon diamond → bagel for the scope
		 * the wrap is called in, warm orange sphere → bagel for the type
		 * whose handler PRODUCED the wrap (hostTypePath). Everything lands
		 * in diveGroup — the single "dive" Layers checkbox toggles the
		 * whole combined graph. Rings are interactive (drag pins them,
		 * click shows the wrap tooltip, double-click jumps to the site)
		 * but stay OUT of nodeMeshes.
		 */
		buildWrappersLayer(data, nodeMap, placeOnSphere, nodeRadius) {
			const wrappers = data.wrappers;
			if (!wrappers || !Array.isArray(wrappers.nodes) || wrappers.nodes.length === 0) {
				return;
			}
			const nodes = wrappers.nodes;
			const links = Array.isArray(wrappers.links) ? wrappers.links : [];
			const byId = new Map();
			nodes.forEach(n => byId.set(n.id, n));

			// Unit torus, scaled per ring — onion shells need per-ring radii,
			// so the geometry stays shared and the mesh carries the scale.
			// Tube ratio 0.12 keeps big rings slender
			const ringGeometry = new THREE.TorusGeometry(1, 0.12, 12, 32);
			this.wrapperGeometries.push(ringGeometry);

			// Amber family for the wrap itself; salmon for the join from a
			// creation diamond; warm orange for the host-type edge (the
			// instance's handler produced the wrap). ctor fiber links are
			// dashed light-amber, distinct from the solid via amber. All
			// stay clear of the creation layer's orchid/cyan, the maroon
			// center, and the red error color
			const wrapColor = 0xffb300;
			const ctorColor = 0xffd54f;
			const hostColor = 0xf9a825;
			const creationLinkMaterial = new THREE.LineBasicMaterial({ color: 0xff8a65, transparent: true, opacity: 0.7 });
			const hostLinkMaterial = new THREE.LineBasicMaterial({ color: hostColor, transparent: true, opacity: 0.75 });
			const viaMaterial = new THREE.LineBasicMaterial({ color: wrapColor, transparent: true, opacity: 0.8 });
			const ctorMaterial = new THREE.LineDashedMaterial({ color: ctorColor, transparent: true, opacity: 0.9, dashSize: 4, gapSize: 3 });
			this.wrapperMaterials.push(creationLinkMaterial, hostLinkMaterial, viaMaterial, ctorMaterial);

			// Direction is the point of the fiber edges: one cone per link,
			// landed on the target by the dynamic updater
			const arrowGeometry = new THREE.ConeGeometry(1.8, 5, 8);
			arrowGeometry.rotateX(Math.PI / 2); // tip along +Z
			const viaArrowMaterial = new THREE.MeshBasicMaterial({ color: wrapColor, transparent: true, opacity: 0.9 });
			const ctorArrowMaterial = new THREE.MeshBasicMaterial({ color: ctorColor, transparent: true, opacity: 0.9 });
			const joinArrowMaterial = new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.6 });
			const hostArrowMaterial = new THREE.MeshBasicMaterial({ color: hostColor, transparent: true, opacity: 0.9 });
			this.wrapperGeometries.push(arrowGeometry);
			this.wrapperMaterials.push(viaArrowMaterial, ctorArrowMaterial, joinArrowMaterial, hostArrowMaterial);

			const gen0Radius = (this.depthRadii && this.depthRadii.get(0)) || 105;
			// Dive distances are panel knobs (Layers & Distances → dive ◯):
			// read live so dynamics see adjustments without a rebuild
			const diveDist = this.layerDistances.dive;
			const ambientStep = nodeRadius * diveDist.ambientStep;
			const ambientRadius = (generation) => gen0Radius * diveDist.ambientBase + generation * ambientStep;
			const goldenAngle = Math.PI * (3 - Math.sqrt(5));

			// One record per node: the mesh plus the encirclement target
			// (or the ambient direction) the dynamic updater needs.
			// Encirclement precedence: the scope diamond FIRST — the
			// wrapped element is the callback (wrap(fn, instance) wraps
			// fn; the instance is only the context carried along) — then
			// the type sphere, only when there is no scope to host the
			// wrap (genuine constructor wrap at define time)
			const records = [];
			const ambient = [];
			const onionByTarget = new Map();
			const nextOnion = (key) => {
				const k = onionByTarget.get(key) || 0;
				onionByTarget.set(key, k + 1);
				return k;
			};
			nodes.forEach(node => {
				const creationId = node.callbackScopeId || node.holderScopeId;
				const creationMesh = creationId ? this.creationMeshById.get(creationId) : null;
				const typeMesh = node.wrapsTypePath ? this.nodeMeshes.get(node.wrapsTypePath) : null;
				const hostMesh = node.hostTypePath ? this.nodeMeshes.get(node.hostTypePath) : null;
				const record = { node, mesh: null, creationMesh, typeMesh, hostMesh, dir: null, ringR: 0 };
				if (creationMesh) {
					// Snug: just bigger than the diamond (its radius is
					// nodeRadius × 0.55), one tight onion step per
					// co-located bagel
					const k = nextOnion('creation:' + creationId);
					record.ringR = nodeRadius * 0.55 * 1.35 * (1 + k * diveDist.onionStep);
					record.onionK = k;
					records.push(record);
					return;
				}
				if (typeMesh) {
					// Constructor wrap with no hosting scope: encircle the
					// type's sphere, again just bigger than it
					const k = nextOnion('type:' + node.wrapsTypePath);
					record.ringR = nodeRadius * 1.25 * (1 + k * diveDist.onionStep);
					record.onionK = k;
					records.push(record);
					return;
				}
				ambient.push(record);
			});
			ambient.forEach((record, i) => {
				const pos = placeOnSphere(ambientRadius(record.node.generation), i, ambient.length);
				// placeOnSphere returns a plain {x, y, z} — the direction
				// has to be a real Vector3 for the dynamic updater
				record.dir = new THREE.Vector3(pos.x, pos.y, pos.z).normalize();
				if (record.dir.lengthSq() === 0) { record.dir.set(1, 0, 0); }
				record.ringR = nodeRadius * 0.42;
				record.onionK = 0;
				records.push(record);
			});

			const ringMaterial = new THREE.MeshPhongMaterial({
				color: wrapColor,
				emissive: wrapColor,
				emissiveIntensity: 0.3,
				shininess: 60,
				specular: 0x222222
			});
			this.wrapperMaterials.push(ringMaterial);

			records.forEach(record => {
				const mesh = new THREE.Mesh(ringGeometry, ringMaterial);
				// Unit torus scaled to the ring radius; vertical by
				// default (torus plane XY, Y up), onion rings fan around Y
				mesh.scale.set(record.ringR, record.ringR, record.ringR);
				mesh.rotation.y = record.onionK * goldenAngle;
				mesh.userData = {
					wrapperNode  : record.node,
					baseEmissive : 0.3,
					ringOuter    : record.ringR * 1.12,
					// Co-centered onion labels must not stack: one text
					// line per onion level on top of the ring's radius
					labelOffsetY : record.ringR + 6 + record.onionK * 14
				};
				record.mesh = mesh;
				// Initial position — the dynamics writer owns it from here.
				// Same precedence as the ring sizing: scope diamond first,
				// type sphere only when no scope hosts the wrap
				if (record.creationMesh) {
					mesh.position.copy(record.creationMesh.position);
				} else if (record.typeMesh) {
					mesh.position.copy(record.typeMesh.position);
				} else {
					mesh.position.copy(record.dir).multiplyScalar(ambientRadius(record.node.generation));
				}
				this.diveGroup.add(mesh);
				this.wrapperMeshes.push(mesh);
				this.wrapperMeshById.set(record.node.id, mesh);
				this.addLabel(mesh, record.node.name, 0.5);
				if (mesh.userData.label) {
					this.diveGroup.add(mesh.userData.label);
					this.diveGroup.add(mesh.userData.leader);
				}
			});

			// Fiber edges (bagel → bagel) and join edges (to creation
			// meshes / type spheres) as LineSegments; one arrowhead cone
			// per edge. Endpoints are rewritten from live positions by the
			// dynamic updater
			const buildSegments = (pairs, material, dashed) => {
				const positions = new Float32Array(pairs.length * 6);
				const geometry = new THREE.BufferGeometry();
				geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
				const segments = new THREE.LineSegments(geometry, material);
				this.diveGroup.add(segments);
				this.wrapperLines.push(segments);
				const entry = { segments, pairs, dashed };
				return entry;
			};
			const viaPairs = [];
			const ctorPairs = [];
			links.forEach(link => {
				const from = this.wrapperMeshById.get(link.source);
				const to = this.wrapperMeshById.get(link.target);
				if (!from || !to) { return; }
				const pair = { from, to };
				if (link.kind === 'ctor') { ctorPairs.push(pair); } else { viaPairs.push(pair); }
			});
			const creationPairs = [];
			const hostPairs = [];
			records.forEach(record => {
				// The scope CALLS the wrap: directed diamond → bagel.
				// While the bagel encircles that very diamond the pair is
				// co-centered — zero-length, invisible; drag the bagel out
				// and the edge reappears, keeping attribution
				if (record.creationMesh) {
					creationPairs.push({ from: record.creationMesh, to: record.mesh });
				}
				// The instance's handler PRODUCED the wrap: directed
				// sphere → bagel. Skipped when the bagel already encircles
				// that very sphere — encirclement says it
				if (record.hostMesh && record.hostMesh !== record.typeMesh) {
					hostPairs.push({ from: record.hostMesh, to: record.mesh });
				}
			});
			const viaSegments = buildSegments(viaPairs, viaMaterial, false);
			const ctorSegments = buildSegments(ctorPairs, ctorMaterial, true);
			const creationSegments = buildSegments(creationPairs, creationLinkMaterial, false);
			const hostSegments = buildSegments(hostPairs, hostLinkMaterial, false);

			// Arrowheads join wrapperMeshes for disposal (shared geometry/
			// material, no label); positions follow the live endpoints.
			// Every fiber edge here lands ON a bagel — the updater reads
			// the target ring's outer radius as the gap
			const fiberArrows = [];
			const addArrows = (pairs, material) => {
				pairs.forEach(pair => {
					const arrow = new THREE.Mesh(arrowGeometry, material);
					this.diveGroup.add(arrow);
					this.wrapperMeshes.push(arrow);
					fiberArrows.push({ arrow, pair });
				});
			};
			addArrows(viaPairs, viaArrowMaterial);
			addArrows(ctorPairs, ctorArrowMaterial);
			addArrows(creationPairs, joinArrowMaterial);
			addArrows(hostPairs, hostArrowMaterial);

			const writePairs = (entry) => {
				const p = entry.segments.geometry.attributes.position.array;
				entry.pairs.forEach((pair, i) => {
					p[i * 6] = pair.from.position.x;
					p[i * 6 + 1] = pair.from.position.y;
					p[i * 6 + 2] = pair.from.position.z;
					p[i * 6 + 3] = pair.to.position.x;
					p[i * 6 + 4] = pair.to.position.y;
					p[i * 6 + 5] = pair.to.position.z;
				});
				entry.segments.geometry.attributes.position.needsUpdate = true;
				if (entry.dashed) {
					// LineDashedMaterial needs fresh distances after every
					// position rewrite or the dash pattern breaks
					entry.segments.computeLineDistances();
				}
			};

			this.wrapperDynamics.push(() => {
				records.forEach(record => {
					const { node, mesh, dir } = record;
					if (mesh.userData.pinned) {
						// Relative pin: keep the user's offset from the
						// anchor (scope diamond / type sphere) — the set
						// moves as one when the anchor moves. Anchor-less
						// (ambient) pins stay absolute
						if (mesh.userData.pinAnchor) {
							mesh.position.copy(mesh.userData.pinAnchor.position).add(mesh.userData.pinOffset);
						}
					} else {
						// Encircling bagels follow their target's live
						// position — scope diamond first (the callback is
						// the wrapped element), type sphere only when no
						// scope hosts the wrap; ambient hold their slot
						if (record.creationMesh) {
							mesh.position.copy(record.creationMesh.position);
						} else if (record.typeMesh) {
							mesh.position.copy(record.typeMesh.position);
						} else {
							mesh.position.copy(dir).multiplyScalar(ambientRadius(node.generation));
						}
					}
					this.updateLabelPosition(mesh);
				});
				writePairs(viaSegments);
				writePairs(ctorSegments);
				writePairs(creationSegments);
				writePairs(hostSegments);
				// Arrowheads land a `gap` short of the target center (the
				// target bagel's rim) and point along travel. Degenerate
				// co-centered pairs (two bagels on one target) hide their
				// arrow — the onion reads as the relation
				fiberArrows.forEach(({ arrow, pair }) => {
					const a = pair.from.position;
					const b = pair.to.position;
					const gap = pair.to.userData.ringOuter || nodeRadius;
					const dx = b.x - a.x;
					const dy = b.y - a.y;
					const dz = b.z - a.z;
					const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
					if (len > gap) {
						const ratio = (len - gap) / len;
						arrow.visible = true;
						arrow.position.set(a.x + dx * ratio, a.y + dy * ratio, a.z + dz * ratio);
						arrow.lookAt(b.x, b.y, b.z);
					} else {
						arrow.visible = false;
					}
				});
			});

			// Place everything before the first frame paints
			this.wrapperDynamics.forEach(update => update());
		}

		/**
		 * Combined Dive backplane (declared — src/graph/internals-manifest.ts;
		 * declared, not discovered: the calls completing the fiber chain live
		 * inside the dive/adapter packages, no workspace analyzer can see
		 * them).
		 *
		 *  - The EDS RING encircles the collection marker at the origin —
		 *    dive records everything the collection constructs
		 *  - The attachHooks HUB (steel-blue octahedron) sits at the ring's
		 *    right side; CURVED grafts run from it to every constructed
		 *    type's sphere after-position — bootstrap wiring firing
		 *    pre/post/err hooks per construction (never-created types get
		 *    no graft: hooks never fire for them)
		 *  - Adapter SINKS (violet boxes) stack vertically at the LEFT mid
		 *    of the scene (deterministic, -X side): the ALS provider, the
		 *    OTEL provider, the exception filter — where a fiber's data
		 *    leaves. Directed edges: ring → sinks → Jaeger
		 *  - JAEGER (gold cone) leftmost of all — outside the system
		 * Everything lands in diveGroup — the single "dive" toggle.
		 */
		buildInternalsLayer(data, nodeMap, nodeRadius) {
			const internals = data.internals;
			if (!internals || !Array.isArray(internals.nodes) || internals.nodes.length === 0) {
				return;
			}
			const links = Array.isArray(internals.links) ? internals.links : [];
			const grafts = Array.isArray(internals.grafts) ? internals.grafts : [];
			const gen0Radius = (this.depthRadii && this.depthRadii.get(0)) || 105;
			const knotRadius = nodeRadius * 0.5;

			const diveColor = 0x7aa2f7;
			const adapterColor = 0xb48ead;
			const jaegerColor = 0xf0c674;
			const slate = 0x8a8f98;

			// Shared geometries/materials — one per shape, disposed once
			const octaGeometry = new THREE.OctahedronGeometry(knotRadius);
			const boxGeometry = new THREE.BoxGeometry(knotRadius * 1.4, knotRadius * 1.4, knotRadius * 1.4);
			const coneGeometry = new THREE.ConeGeometry(knotRadius * 0.9, knotRadius * 1.8, 20);
			// The EDS ring is no shell knot: a thin, wide torus built to
			// ENCIRCLE the maroon collection marker at the origin
			const edsRingGeometry = new THREE.TorusGeometry(nodeRadius * 0.9, nodeRadius * 0.08, 12, 48);
			const arrowGeometry = new THREE.ConeGeometry(1.8, 5, 8);
			arrowGeometry.rotateX(Math.PI / 2); // tip along +Z
			this.internalsGeometries.push(octaGeometry, boxGeometry, coneGeometry, edsRingGeometry, arrowGeometry);

			const diveMaterial = new THREE.MeshPhongMaterial({
				color: diveColor, emissive: diveColor, emissiveIntensity: 0.35, shininess: 60, specular: 0x222222
			});
			const adapterMaterial = new THREE.MeshPhongMaterial({
				color: adapterColor, emissive: adapterColor, emissiveIntensity: 0.35, shininess: 60, specular: 0x222222
			});
			const jaegerMaterial = new THREE.MeshPhongMaterial({
				color: jaegerColor, emissive: jaegerColor, emissiveIntensity: 0.45, shininess: 60, specular: 0x222222
			});
			const sinkLinkMaterial = new THREE.LineBasicMaterial({ color: slate, transparent: true, opacity: 0.55 });
			const hookupLinkMaterial = new THREE.LineDashedMaterial({
				color: slate, transparent: true, opacity: 0.85, dashSize: 6, gapSize: 4
			});
			// Grafts are whisper-thin: hundreds of constructions all pass
			// through the one hub, the curve must not shout
			const graftMaterial = new THREE.LineBasicMaterial({ color: diveColor, transparent: true, opacity: 0.22 });
			const sinkArrowMaterial = new THREE.MeshBasicMaterial({ color: slate, transparent: true, opacity: 0.8 });
			this.internalsMaterials.push(diveMaterial, adapterMaterial, jaegerMaterial, sinkLinkMaterial, hookupLinkMaterial, graftMaterial, sinkArrowMaterial);

			// The EDS ring is the third CENTER alongside the collection
			// marker (instances) and the main.ts diamond (invocations) —
			// all three are convergence points keyed by paths. It
			// ENCIRCLES the maroon sphere: dive records everything the
			// collection constructs
			const ringNode = internals.nodes.find(n => n.role === 'ring');
			if (ringNode) {
				const ringMesh = new THREE.Mesh(edsRingGeometry, diveMaterial);
				ringMesh.position.set(0, 0, 0);
				// Saturn tilt: reads as encircling, clears the +X tangent diamond
				ringMesh.rotation.set(1.15, 0, 0.35);
				ringMesh.userData = { internalNode: ringNode, baseEmissive: 0.35 };
				this.diveGroup.add(ringMesh);
				this.internalsMeshes.push(ringMesh);
				this.internalsMeshById.set(ringNode.id, ringMesh);
				this.addLabel(ringMesh, ringNode.name, 0.5);
				if (ringMesh.userData.label) {
					// The marker's own label sits above — the ring's goes below
					ringMesh.userData.labelOffsetY = -35 * 0.5;
					this.updateLabelPosition(ringMesh);
					this.diveGroup.add(ringMesh.userData.label);
					this.diveGroup.add(ringMesh.userData.leader);
				}
			}

			// The attachHooks hub at the ring's right side (+X) — the same
			// side convention the creation center diamond uses
			const hubNode = internals.nodes.find(n => n.role === 'hub');
			let hubMesh = null;
			if (hubNode) {
				hubMesh = new THREE.Mesh(octaGeometry, diveMaterial);
				hubMesh.position.set(nodeRadius * 1.6, 0, 0);
				hubMesh.userData = { internalNode: hubNode, baseEmissive: 0.35 };
				this.diveGroup.add(hubMesh);
				this.internalsMeshes.push(hubMesh);
				this.internalsMeshById.set(hubNode.id, hubMesh);
				this.addLabel(hubMesh, hubNode.name, 0.5);
				if (hubMesh.userData.label) {
					this.diveGroup.add(hubMesh.userData.label);
					this.diveGroup.add(hubMesh.userData.leader);
				}
			}

			// Sinks and the external: the terminal zone where fiber data
			// leaves the trace system
			const placeKnot = (node, pos) => {
				const geometry = node.role === 'external' ? coneGeometry : boxGeometry;
				const material = node.role === 'external' ? jaegerMaterial : adapterMaterial;
				const mesh = new THREE.Mesh(geometry, material);
				mesh.position.set(pos.x, pos.y, pos.z);
				mesh.userData = { internalNode: node, baseEmissive: node.role === 'external' ? 0.45 : 0.35 };
				this.diveGroup.add(mesh);
				this.internalsMeshes.push(mesh);
				this.internalsMeshById.set(node.id, mesh);
				this.addLabel(mesh, node.name, 0.5);
				if (mesh.userData.label) {
					this.diveGroup.add(mesh.userData.label);
					this.diveGroup.add(mesh.userData.leader);
				}
			};
			// Terminal zone is DETERMINISTIC and NEAR (2026-09-04 review):
			// just outside the gen-0 shell on the LEFT, the Jaeger cone
			// leftmost, the adapter sinks in a tight vertical stack right
			// of it — close enough to read together with the ring.
			// Offsets are panel knobs (Layers & Distances → dive ◯)
			const sinkOffset = this.layerDistances.dive.sinkOffset;
			const jaegerOffset = this.layerDistances.dive.jaegerOffset;
			const sinkNodes = internals.nodes.filter(n => n.role === 'sink');
			sinkNodes.forEach((node, i) => {
				const pos = {
					x: -gen0Radius * sinkOffset,
					y: (i - (sinkNodes.length - 1) / 2) * gen0Radius * 0.5,
					z: 0
				};
				placeKnot(node, pos);
			});
			const externalNodes = internals.nodes.filter(n => n.role === 'external');
			externalNodes.forEach((node, i) => {
				const pos = { x: -gen0Radius * jaegerOffset, y: i * gen0Radius * 0.5, z: 0 };
				placeKnot(node, pos);
			});

			// Sinks pin RELATIVE to the Jaeger cone (2026-09-05 owner
			// review: "if I dragged Jaeger cone it should also move
			// connected Adapter's elements"). Re-apply anchor + offset on
			// every dynamics tick so dragging the cone carries the stack —
			// as if never detached, the same rule diamonds follow on their
			// spheres. Must run BEFORE writeSinks: the sink edges read live
			// positions and would lag a frame otherwise
			this.internalsDynamics.push(() => {
				this.internalsMeshes.forEach(m => {
					const knot = m.userData.internalNode;
					if (!knot || knot.role !== 'sink' || !m.userData.pinned || !m.userData.pinAnchor || !m.userData.pinOffset) { return; }
					m.position.copy(m.userData.pinAnchor.position).add(m.userData.pinOffset);
					this.updateLabelPosition(m);
				});
			});

			// Sink edges — directed as DATA flows: ring → providers/filter
			// → Jaeger. Endpoints are draggable knots, so the edges and
			// arrowheads ride internalsDynamics (sticky, like every other
			// layer's links)
			const sinkPairs = [];
			const sinkArrows = [];
			links.forEach(link => {
				if (link.kind !== 'sink') { return; }
				const from = this.internalsMeshById.get(link.source);
				const to = this.internalsMeshById.get(link.target);
				if (!from || !to) { return; }
				sinkPairs.push({ from, to });
				const arrow = new THREE.Mesh(arrowGeometry, sinkArrowMaterial);
				this.diveGroup.add(arrow);
				// Arrows ride internalsMeshes for disposal (shared
				// geometry/material, no label)
				this.internalsMeshes.push(arrow);
				sinkArrows.push({ arrow, from, to });
			});
			if (sinkPairs.length > 0) {
				const sinkPositions = new Float32Array(sinkPairs.length * 6);
				const sinkGeometry = new THREE.BufferGeometry();
				sinkGeometry.setAttribute('position', new THREE.BufferAttribute(sinkPositions, 3));
				const sinkSegments = new THREE.LineSegments(sinkGeometry, sinkLinkMaterial);
				this.diveGroup.add(sinkSegments);
				this.internalsLines.push(sinkSegments);
				const writeSinks = () => {
					sinkPairs.forEach((pair, i) => {
						sinkPositions[i * 6] = pair.from.position.x;
						sinkPositions[i * 6 + 1] = pair.from.position.y;
						sinkPositions[i * 6 + 2] = pair.from.position.z;
						sinkPositions[i * 6 + 3] = pair.to.position.x;
						sinkPositions[i * 6 + 4] = pair.to.position.y;
						sinkPositions[i * 6 + 5] = pair.to.position.z;
					});
					sinkGeometry.attributes.position.needsUpdate = true;
					sinkArrows.forEach(({ arrow, from, to }) => {
						const a = from.position;
						const b = to.position;
						const dx = b.x - a.x;
						const dy = b.y - a.y;
						const dz = b.z - a.z;
						const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
						const gap = knotRadius * 1.6;
						arrow.visible = len > gap;
						if (arrow.visible) {
							const ratio = (len - gap) / len;
							arrow.position.set(a.x + dx * ratio, a.y + dy * ratio, a.z + dz * ratio);
							arrow.lookAt(b.x, b.y, b.z);
						}
					});
				};
				writeSinks();
				this.internalsDynamics.push(writeSinks);
			}

			// The collection → hub hookup (dashed): attachHooks wires the
			// whole collection. The marker sits at the origin; rewritten on
			// dynamics together with the grafts
			const hookupLink = links.find(l => l.kind === 'hookup');
			let hookupLine = null;
			if (hookupLink && hubMesh && this.centerMarker) {
				const hookupGeometry = new THREE.BufferGeometry();
				hookupGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
				hookupLine = new THREE.Line(hookupGeometry, hookupLinkMaterial);
				this.diveGroup.add(hookupLine);
				this.internalsLines.push(hookupLine);
			}

			// attachHooks grafts: CURVES from the hub to each constructed
			// type's after-position (just past the sphere, radially out).
			// The graft IS the hooks firing: preCreation enters the parent
			// context, postCreation records the create edge, creationError
			// pins the failure — per construction
			const GRAFT_POINTS = 20;
			const graftEntries = [];
			if (hubMesh) {
				grafts.forEach(typeId => {
					const target = nodeMap.get(typeId);
					if (!target) { return; }
					const graftGeometry = new THREE.BufferGeometry();
					graftGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GRAFT_POINTS * 3), 3));
					const line = new THREE.Line(graftGeometry, graftMaterial);
					this.diveGroup.add(line);
					this.internalsLines.push(line);
					graftEntries.push({ line, target });
				});
			}

			const writeGrafts = () => {
				if (hubMesh) {
					const hubPos = hubMesh.position;
					graftEntries.forEach(({ line, target }) => {
						const tx = target.x || 0;
						const ty = target.y || 0;
						const tz = target.z || 0;
						const radial = new THREE.Vector3(tx, ty, tz);
						if (radial.lengthSq() === 0) { radial.set(1, 0, 0); }
						radial.normalize();
						const end = new THREE.Vector3(tx, ty, tz).add(radial.clone().multiplyScalar(nodeRadius * 1.15));
						const mid = hubPos.clone().lerp(end, 0.5);
						// Bow outward from the origin so the graft clears the ring
						const bow = mid.clone().normalize().multiplyScalar(Math.max(mid.length() * 0.35, 1));
						const control = mid.clone().add(bow);
						const curve = new THREE.QuadraticBezierCurve3(hubPos.clone(), control, end);
						const points = curve.getPoints(GRAFT_POINTS - 1);
						const p = line.geometry.attributes.position.array;
						points.forEach((pt, i) => {
							p[i * 3] = pt.x;
							p[i * 3 + 1] = pt.y;
							p[i * 3 + 2] = pt.z;
						});
						line.geometry.attributes.position.needsUpdate = true;
					});
				}
				if (hookupLine && hubMesh) {
					const p = hookupLine.geometry.attributes.position.array;
					p[0] = this.centerMarker.position.x;
					p[1] = this.centerMarker.position.y;
					p[2] = this.centerMarker.position.z;
					p[3] = hubMesh.position.x;
					p[4] = hubMesh.position.y;
					p[5] = hubMesh.position.z;
					hookupLine.geometry.attributes.position.needsUpdate = true;
					// LineDashedMaterial needs fresh distances after every rewrite
					hookupLine.computeLineDistances();
				}
			};

			// Graft endpoints hang off live type spheres — rewrite after the
			// wrappers pass (drags and gen-radius relayouts move them)
			writeGrafts();
			this.internalsDynamics.push(writeGrafts);
		}

		addLabel(mesh, text, scale = 1) {
			const canvas = document.createElement('canvas');
			const ctx = canvas.getContext('2d');
			canvas.width = 1024;
			canvas.height = 256;

			ctx.clearRect(0, 0, canvas.width, canvas.height);

			ctx.font = 'bold 64px Arial, sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';

			ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
			ctx.lineWidth = 12;
			ctx.strokeText(text, 512, 128);

			ctx.fillStyle = '#ffffff';
			ctx.fillText(text, 512, 128);

			const texture = new THREE.CanvasTexture(canvas);
			texture.minFilter = THREE.LinearFilter;
			const spriteMaterial = new THREE.SpriteMaterial({
				map: texture,
				transparent: true,
				alphaTest: 0.5,
				// Signs must never be hidden by spheres — owner rule,
				// holds on manual rotations too since it needs no
				// per-frame work (sprites are billboards: they always
				// face the camera; only depth testing could hide them)
				depthTest: false,
				depthWrite: false
			});
			const sprite = new THREE.Sprite(spriteMaterial);
			// Drawn after every sphere
			sprite.renderOrder = 999;
			// Position sprite in world space above the node
			sprite.position.set(mesh.position.x, mesh.position.y + 35 * scale, mesh.position.z);
			sprite.scale.set(100 * scale, 25 * scale, 1);

			// Store sprite reference on mesh for updates (labelScale lets
			// updateLabelPosition keep the smaller creation-label offset)
			mesh.userData.label = sprite;
			mesh.userData.labelScale = scale;
			this.scene.add(sprite);

			// Every sign gets a leader line back to what it signs — when
			// labels outrun their mesh (dense clusters) the connection
			// must stay visible. Shared material, per-label geometry
			if (!this.leaderMaterial) {
				this.leaderMaterial = new THREE.LineBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.35 });
			}
			const leaderGeometry = new THREE.BufferGeometry();
			leaderGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
				mesh.position.x, mesh.position.y, mesh.position.z,
				sprite.position.x, sprite.position.y, sprite.position.z
			]), 3));
			const leader = new THREE.Line(leaderGeometry, this.leaderMaterial);
			leader.renderOrder = 998;
			mesh.userData.leader = leader;
			this.leaderLines.push(leader);
			this.scene.add(leader);
		}

		updateLabelPosition(mesh) {
			if (mesh.userData.label) {
				const label = mesh.userData.label;
				const scale = mesh.userData.labelScale || 1;
				const offsetY = mesh.userData.labelOffsetY !== undefined ? mesh.userData.labelOffsetY : 35 * scale;
				label.position.x = mesh.position.x;
				label.position.y = mesh.position.y + offsetY;
				label.position.z = mesh.position.z;
			}
			if (mesh.userData.leader) {
				const positions = mesh.userData.leader.geometry.attributes.position;
				positions.setXYZ(0, mesh.position.x, mesh.position.y, mesh.position.z);
				const anchor = mesh.userData.label ? mesh.userData.label.position : mesh.position;
				positions.setXYZ(1, anchor.x, anchor.y, anchor.z);
				positions.needsUpdate = true;
			}
		}

		zoomIn() {
			this.zoom = Math.max(100, this.zoom * 0.7);
			this.updateCameraPosition();
		}

		zoomOut() {
			this.zoom = Math.min(2500, this.zoom * 1.3);
			this.updateCameraPosition();
		}

		reset() {
			this.cameraRotation = { x: 0, y: 0 };
			this.panOffset = { x: 0, y: 0, z: 0 };
			this.zoom = 600;
			this.updateCameraPosition();
		}

		resize(width, height) {
			this.camera.aspect = width / height;
			this.camera.updateProjectionMatrix();
			this.renderer.setSize(width, height);
			this.needsRender = true;
		}

		setOnNodeClick(handler) {
			this.onNodeClick = handler;
		}

		animate() {
			this.animationId = requestAnimationFrame(() => this.animate());
			// Render-on-demand gate: paint only when something changed.
			// The "was" snapshot matters — the updaters below can END an
			// animation on this very tick (last flash decayed, focus anim
			// landing), and that settle frame must still paint
			const wasAnimating = Boolean(this.focusAnim || this.focusedMesh ||
				this.traceFlashes.size > 0 || this.replayFlashes.size > 0);
			this.updateFocusAnimation();
			this.updateFocusPulse();
			this.updateTraceFlashes();
			const animating = wasAnimating || Boolean(this.focusAnim || this.focusedMesh ||
				this.traceFlashes.size > 0 || this.replayFlashes.size > 0);
			const now = performance.now();
			// ~1Hz heartbeat: self-heal for an invalidation site that
			// forgot the flag — worst case the frame is one second late
			const heartbeat = now - this.lastRenderAt >= 1000;
			if (this.needsRender || animating || heartbeat) {
				this.needsRender = false;
				this.lastRenderAt = now;
				this.renderer.render(this.scene, this.camera);
			}
		}

		clear() {
			this.focusAnim = null;
			this.focusedMesh = null;
			// Flashes and the trace path point at meshes about to be
			// disposed — no restore needed, renderGraph rebuilds all
			this.traceFlashes.clear();
			this.traceMode = null;
			this.nodeMeshes.forEach(mesh => {
				// Remove label if exists — meshes and labels live inside
				// the layer groups now, so remove from the ACTUAL parent
				// (scene.remove is a no-op for non-direct children)
				if (mesh.userData.label) {
					const label = mesh.userData.label;
					if (label.parent) {
						label.parent.remove(label);
					}
					label.material.map.dispose();
					label.material.dispose();
				}
				if (mesh.parent) {
					mesh.parent.remove(mesh);
				}
				mesh.geometry.dispose();
				mesh.material.dispose();
			});
			this.nodeMeshes.clear();

			this.linkLines.forEach(({ line, arrow }) => {
				if (line.parent) {
					line.parent.remove(line);
				}
				line.geometry.dispose();
				if (arrow) {
					if (arrow.parent) {
						arrow.parent.remove(arrow);
					}
					arrow.geometry.dispose();
					arrow.material.dispose();
				}
			});
			this.linkLines = [];

			this.pathHitLines.forEach(({ line, arrow }) => {
				if (line.parent) {
					line.parent.remove(line);
				}
				line.geometry.dispose();
				line.material.dispose();
				if (arrow) {
					if (arrow.parent) {
						arrow.parent.remove(arrow);
					}
					// Shared cone geometry/material — idempotent dispose,
					// same pattern as the skeleton linkLines arrows
					arrow.geometry.dispose();
					arrow.material.dispose();
				}
			});
			this.pathHitLines = [];

			// Creation layer — meshes carry per-mesh materials and labels;
			// geometries/materials are shared and disposed once
			this.creationMeshes.forEach(mesh => {
				if (mesh.userData.label) {
					const label = mesh.userData.label;
					if (label.parent) {
						label.parent.remove(label);
					}
					label.material.map.dispose();
					label.material.dispose();
				}
				if (mesh.parent) {
					mesh.parent.remove(mesh);
				}
				mesh.material.dispose();
			});
			this.creationMeshes = [];
			this.creationMeshById = new Map();
			this.creationLines.forEach(line => {
				if (line.parent) {
					line.parent.remove(line);
				}
				line.geometry.dispose();
			});
			this.creationLines = [];
			this.creationGeometries.forEach(geometry => geometry.dispose());
			this.creationGeometries = [];
			this.creationMaterials.forEach(material => material.dispose());
			this.creationMaterials = [];
			this.creationDynamics = [];

			// Wrappers layer — ring meshes share their geometry and
			// material (disposed once below); labels are per-mesh
			this.wrapperMeshes.forEach(mesh => {
				if (mesh.userData.label) {
					const label = mesh.userData.label;
					if (label.parent) {
						label.parent.remove(label);
					}
					label.material.map.dispose();
					label.material.dispose();
				}
				if (mesh.parent) {
					mesh.parent.remove(mesh);
				}
			});
			this.wrapperMeshes = [];
			this.wrapperMeshById = new Map();
			this.wrapperLines.forEach(line => {
				if (line.parent) {
					line.parent.remove(line);
				}
				line.geometry.dispose();
			});
			this.wrapperLines = [];
			this.wrapperGeometries.forEach(geometry => geometry.dispose());
			this.wrapperGeometries = [];
			this.wrapperMaterials.forEach(material => material.dispose());
			this.wrapperMaterials = [];
			this.wrapperDynamics = [];

			// Internals backplane — same lifecycle: meshes share the
			// per-shape geometries/materials (disposed once below), labels
			// are per-mesh
			this.internalsMeshes.forEach(mesh => {
				if (mesh.userData.label) {
					const label = mesh.userData.label;
					if (label.parent) {
						label.parent.remove(label);
					}
					label.material.map.dispose();
					label.material.dispose();
				}
				if (mesh.parent) {
					mesh.parent.remove(mesh);
				}
			});
			this.internalsMeshes = [];
			this.internalsMeshById = new Map();
			this.internalsLines.forEach(line => {
				if (line.parent) {
					line.parent.remove(line);
				}
				line.geometry.dispose();
			});
			this.internalsLines = [];
			this.internalsGeometries.forEach(geometry => geometry.dispose());
			this.internalsGeometries = [];
			this.internalsMaterials.forEach(material => material.dispose());
			this.internalsMaterials = [];
			this.internalsDynamics = [];

			if (this.centerMarker) {
				this.scene.remove(this.centerMarker);
				if (this.centerMarker.userData.label) {
					const label = this.centerMarker.userData.label;
					if (label.parent) {
						label.parent.remove(label);
					}
					label.material.map.dispose();
					label.material.dispose();
				}
				this.centerMarker.geometry.dispose();
				this.centerMarker.material.dispose();
				this.centerMarker = null;
			}

			// Label leaders: per-label geometries, one shared material
			this.leaderLines.forEach(line => {
				if (line.parent) {
					line.parent.remove(line);
				}
				line.geometry.dispose();
			});
			this.leaderLines = [];
			if (this.leaderMaterial) {
				this.leaderMaterial.dispose();
				this.leaderMaterial = null;
			}
			this.interactive = [];

			// Layer groups are rebuilt by renderGraph
			if (this.typesGroup) {
				this.scene.remove(this.typesGroup);
				this.typesGroup = null;
			}
			if (this.instrumentationGroup) {
				this.scene.remove(this.instrumentationGroup);
				this.instrumentationGroup = null;
			}
			if (this.diveGroup) {
				this.scene.remove(this.diveGroup);
				this.diveGroup = null;
			}

			if (this.simulation) {
				this.simulation.stop();
				this.simulation = null;
			}
		}

		dispose() {
			this.clear();
			if (this.animationId) {
				cancelAnimationFrame(this.animationId);
				this.animationId = null;
			}
			if (this.renderer) {
				this.renderer.dispose();
				if (this.renderer.domElement.parentNode === this.container) {
					this.container.removeChild(this.renderer.domElement);
				}
			}
		}
	}
})();

