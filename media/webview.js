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
		vscode.postMessage({ command: 'ready' });
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
			// of jumping to the file (extension gates on 3D being visible)
			if (is3D && renderer3D && message.data) {
				renderer3D.focusNode(message.data.id, message.data.name);
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

		// Create generation distance controls
		createGenControls(data, renderer3D);
		createLayerControls(renderer3D);

		debugLog('[Mnemonica] 3D Graph rendered successfully', 'log');
	}

	/**
		* Create the layer toggles — types (spheres) and the reserved
		* instrumentation slot switch on/off independently, purely local
		* to the webview (nothing posted to the extension host)
		*/
	function createLayerControls(renderer) {
		const container = document.getElementById('layer-controls-list');
		if (!container || !renderer) return;
		container.innerHTML = '';

		const layers = [
			{ key: 'types', label: 'types', getGroup: () => renderer.typesGroup },
			{ key: 'instrumentation', label: 'instrumentation ◆', getGroup: () => renderer.instrumentationGroup }
		];
		layers.forEach(layer => {
			const row = document.createElement('div');
			row.className = 'gen-control-row';

			const label = document.createElement('label');
			label.className = 'gen-control-label';
			const checkbox = document.createElement('input');
			checkbox.type = 'checkbox';
			checkbox.checked = true;
			checkbox.onchange = function () {
				const group = layer.getGroup();
				if (group) {
					group.visible = checkbox.checked;
				}
			};
			label.appendChild(checkbox);
			label.appendChild(document.createTextNode(' ' + layer.label));
			row.appendChild(label);
			container.appendChild(row);
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
			// from a wrapped scope to the types it constructs
			this.pathHitLines = [];
			// Layer groups for the two toggles — visibility is read by
			// the raycast filter too, so hidden layers are not clickable.
			// instrumentationGroup is the reserved slot for the upcoming
			// EDS/instrumentation layer (empty until that lands)
			this.typesGroup = null;
			this.instrumentationGroup = null;
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
				const intersects = this.raycaster.intersectObjects(Array.from(this.nodeMeshes.values()));

				const dragHit = firstVisibleIntersect(intersects);
				if (dragHit) {
					this.draggedNode = dragHit.object;
					this.draggedNode.userData.isDragging = true;
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

							// Update node data
							const draggedNodeData = this.draggedNode.userData.node;
							if (draggedNodeData) {
								draggedNodeData.x = newPos.x;
								draggedNodeData.y = newPos.y;
								draggedNodeData.z = newPos.z;
								draggedNodeData.fx = newPos.x;
								draggedNodeData.fy = newPos.y;
								draggedNodeData.fz = newPos.z;
							}

							// Update link positions to follow the node
							this.updateLinkPositions();
							// Update label position to match node
							this.updateLabelPosition(this.draggedNode);
						}
					} else if (e.ctrlKey) {
						// Ctrl+drag: rotate camera around center
						this.cameraRotation.y += dx * 0.002;
						this.cameraRotation.x += dy * 0.002;
						this.cameraRotation.x = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.cameraRotation.x));
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
				const intersects = this.raycaster.intersectObjects(Array.from(this.nodeMeshes.values()));
				const clickHit = firstVisibleIntersect(intersects);
				if (clickHit) {
					const node = clickHit.object.userData.node;
					if (node) {
						if (liveTraceNames.has(node.name) && vscodeRef) {
							// Sphere with live trace activity: single click
							// picks the trace instead of showing the tooltip
							vscodeRef.postMessage({ command: 'pickTrace', data: { name: node.name } });
						} else {
							this.handleNodeClick3D(e, node);
						}
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
				const intersects = this.raycaster.intersectObjects(Array.from(this.nodeMeshes.values()));
				const dblHit = firstVisibleIntersect(intersects);
				if (dblHit) {
					const node = dblHit.object.userData.node;
					if (node) {
						this.handleNodeDoubleClick3D(node, e);
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

		updateCameraPosition() {
			// panOffset.z is optional: saved camera states from before the
			// z-aware orbit center do not carry it
			const panZ = this.panOffset.z || 0;
			const x = Math.sin(this.cameraRotation.y) * Math.cos(this.cameraRotation.x) * this.zoom + this.panOffset.x;
			const y = Math.sin(this.cameraRotation.x) * this.zoom + this.panOffset.y;
			const z = Math.cos(this.cameraRotation.y) * Math.cos(this.cameraRotation.x) * this.zoom + panZ;
			this.camera.position.set(x, y, z);
			this.camera.lookAt(this.panOffset.x, this.panOffset.y, panZ);
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
					// Same clamp as the ctrl+drag rotation
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
			// Path-hit overlay dims with the skeleton (shared material)
			if (this.pathHitLines.length > 0) {
				dimmed.pathHit = this.pathHitLines[0].line.material;
				dimmed.pathHit.opacity = 0.1;
				dimmed.pathHit.needsUpdate = true;
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
				mode.dimmed.pathHit.opacity = 0.5;
				mode.dimmed.pathHit.needsUpdate = true;
			}
			this.traceMode = null;
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
			const intersects = this.raycaster.intersectObjects(Array.from(this.nodeMeshes.values()));

			// Reset all emissive (except the focused node — its pulse
			// is driven by updateFocusPulse)
			this.nodeMeshes.forEach(mesh => {
				if (mesh === this.focusedMesh) return;
				const material = mesh.material;
				if (mesh.userData.node.isRoot) {
					material.emissiveIntensity = 0.3;
				} else {
					material.emissiveIntensity = 0;
				}
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
		 * 3D Layout with human-readable spacing
		 * 
		 * 1. Root spacing based on actual label widths (char count × avg char width)
		 * 2. Generation gaps are smaller and more consistent
		 * 3. Center marker at origin
		 */
		renderGraph(data) {
			this.clear();

			// Layer groups — the two "Layers" checkboxes flip their
			// .visible; one scene, one camera, both rotate together
			this.typesGroup = new THREE.Group();
			this.instrumentationGroup = new THREE.Group();
			this.scene.add(this.typesGroup);
			this.scene.add(this.instrumentationGroup);

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
				this.depthRadii = new Map(get3D_Radii(maxDepth).map((r, i) => [i, r]));
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
			 * Uses saved x3d/y3d/z3d if available, otherwise calculates
			 */
			function calculatePosition(node, depth, index, totalAtDepth) {
				// Check if we have saved 3D coordinates - use them!
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

			// Add center marker sphere at origin (0,0,0)
			const centerGeometry = new THREE.SphereGeometry(nodeRadius * 0.5, 16, 16);
			const centerMaterial = new THREE.MeshPhongMaterial({
				color: 0x800000, // Maroon
				emissive: 0x400000,
				emissiveIntensity: 0.5
			});
			const centerSphere = new THREE.Mesh(centerGeometry, centerMaterial);
			centerSphere.position.set(0, 0, 0);
			this.scene.add(centerSphere);

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

				const mesh = new THREE.Mesh(sphereGeometry, material);
				mesh.position.set(node.x, node.y, node.z);
				mesh.userData = { node };

				this.addLabel(mesh, node.name);

				// addLabel attaches the sprite to the scene — re-parent it
				// into the layer group so the toggle hides labels too
				if (mesh.userData.label) {
					this.typesGroup.add(mesh.userData.label);
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
			// a wrapped scope to the types it constructs. Thin cyan lines, no
			// arrowheads — visually distinct from the inheritance skeleton.
			const pathHitMaterial = new THREE.LineBasicMaterial({
				color: 0x66ccff,
				transparent: true,
				opacity: 0.5
			});
			(data.execflow || []).forEach(edge => {
				if (edge.kind !== 'edsPathHit') return;
				const source = nodeMap.get(edge.source);
				const target = nodeMap.get(edge.target);
				if (!source || !target) return;
				const geometry = new THREE.BufferGeometry();
				const positions = new Float32Array([0, 0, 0, 0, 0, 0]);
				geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
				const line = new THREE.Line(geometry, pathHitMaterial);
				this.typesGroup.add(line);
				this.pathHitLines.push({ line, source, target });
			});

			// Update link positions
			this.updateLinkPositions();
		}

		updateLinkPositions() {
			this.pathHitLines.forEach(({ line, source, target }) => {
				const positions = line.geometry.attributes.position.array;
				positions[0] = source.x || 0;
				positions[1] = source.y || 0;
				positions[2] = source.z || 0;
				positions[3] = target.x || 0;
				positions[4] = target.y || 0;
				positions[5] = target.z || 0;
				line.geometry.attributes.position.needsUpdate = true;
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
		}

		addLabel(mesh, text) {
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
			sprite.position.set(mesh.position.x, mesh.position.y + 35, mesh.position.z);
			sprite.scale.set(100, 25, 1);

			// Store sprite reference on mesh for updates
			mesh.userData.label = sprite;
			this.scene.add(sprite);
		}

		updateLabelPosition(mesh) {
			if (mesh.userData.label) {
				const label = mesh.userData.label;
				label.position.x = mesh.position.x;
				label.position.y = mesh.position.y + 35;
				label.position.z = mesh.position.z;
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
		}

		setOnNodeClick(handler) {
			this.onNodeClick = handler;
		}

		animate() {
			this.animationId = requestAnimationFrame(() => this.animate());
			this.updateFocusAnimation();
			this.updateFocusPulse();
			this.updateTraceFlashes();
			this.renderer.render(this.scene, this.camera);
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

			this.pathHitLines.forEach(({ line }) => {
				if (line.parent) {
					line.parent.remove(line);
				}
				line.geometry.dispose();
				line.material.dispose();
			});
			this.pathHitLines = [];

			// Layer groups are rebuilt by renderGraph
			if (this.typesGroup) {
				this.scene.remove(this.typesGroup);
				this.typesGroup = null;
			}
			if (this.instrumentationGroup) {
				this.scene.remove(this.instrumentationGroup);
				this.instrumentationGroup = null;
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

