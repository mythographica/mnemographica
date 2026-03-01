/* eslint-env browser */
/* global THREE, d3, acquireVsCodeApi */
/* eslint-disable @typescript-eslint/no-unused-vars */

(function () {
	'use strict';

	// ===== Debug Console Overlay =====
	const debugLogs = [];
	let debugConsoleEnabled = false;

	function initDebugConsole () {
		const consoleDiv = document.createElement('div');
		consoleDiv.id = 'debug-console';
		consoleDiv.innerHTML = `
			<div id="debug-header">
				<span>Debug Console</span>
				<button id="debug-clear">Clear</button>
				<button id="debug-close">×</button>
			</div>
			<div id="debug-content"></div>
			<div id="debug-toolbar">
				<button id="debug-test-toggle">Auto-toggle 10×</button>
				<button id="debug-test-nodes">Log Nodes</button>
				<button id="debug-test-state">Log State</button>
			</div>
		`;
		document.body.appendChild(consoleDiv);

		// Make draggable
		let isDragging = false;
		let dragOffset = { x: 0, y: 0 };
		const header = document.getElementById('debug-header');

		header.addEventListener('mousedown', (e) => {
			isDragging = true;
			dragOffset.x = e.clientX - consoleDiv.offsetLeft;
			dragOffset.y = e.clientY - consoleDiv.offsetTop;
		});

		document.addEventListener('mousemove', (e) => {
			if (!isDragging) return;
			consoleDiv.style.left = (e.clientX - dragOffset.x) + 'px';
			consoleDiv.style.top = (e.clientY - dragOffset.y) + 'px';
		});

		document.addEventListener('mouseup', () => {
			isDragging = false;
		});

		// Button handlers
		document.getElementById('debug-clear').addEventListener('click', () => {
			debugLogs.length = 0;
			updateDebugDisplay();
		});

		document.getElementById('debug-close').addEventListener('click', () => {
			consoleDiv.style.display = 'none';
			debugConsoleEnabled = false;
		});

		document.getElementById('debug-test-toggle').addEventListener('click', runAutoToggleTest);
		document.getElementById('debug-test-nodes').addEventListener('click', logNodeInfo);
		document.getElementById('debug-test-state').addEventListener('click', logStateInfo);

		debugConsoleEnabled = true;
		debugLog('Debug console initialized', 'info');
	}

	function debugLog (message, type = 'log') {
		const entry = {
			time: new Date().toLocaleTimeString(),
			message: String(message),
			type: type
		};
		debugLogs.push(entry);
		if (debugLogs.length > 100) debugLogs.shift();
		updateDebugDisplay();
	}

	function updateDebugDisplay () {
		const content = document.getElementById('debug-content');
		if (!content) return;
		content.innerHTML = debugLogs.map(log =>
			`<div class="debug-log debug-${log.type}">[${log.time}] ${escapeHtml(log.message)}</div>`
		).join('');
		content.scrollTop = content.scrollHeight;
	}

	function escapeHtml (text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	// Override console methods
	const originalLog = console.log;
	const originalWarn = console.warn;
	const originalError = console.error;

	console.log = function (...args) {
		originalLog.apply(console, args);
		debugLog(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), 'log');
	};

	console.warn = function (...args) {
		originalWarn.apply(console, args);
		debugLog(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), 'warn');
	};

	console.error = function (...args) {
		originalError.apply(console, args);
		debugLog(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), 'error');
	};

	// Test functions
	async function runAutoToggleTest () {
		debugLog('Starting auto-toggle test (10 switches)...', 'info');
		for (let i = 0; i < 10; i++) {
			debugLog(`Toggle ${i + 1}/10: switching to ${is3D ? '2D' : '3D'}`);
			toggle3DMode();
			await sleep(500);
		}
		debugLog('Auto-toggle test complete', 'info');
	}

	function logNodeInfo () {
		if (!currentData) {
			debugLog('No graph data available', 'warn');
			return;
		}
		debugLog(`Nodes: ${currentData.nodes.length}, Links: ${currentData.links.length}`, 'info');
		currentData.nodes.slice(0, 5).forEach(n => {
			debugLog(`  - ${n.name} (depth: ${n.depth}, root: ${n.isRoot})`);
		});
	}

	function logStateInfo () {
		debugLog(`State: is3D=${is3D}, simulation=${!!simulation}, svg=${!!svg}, renderer3D=${!!renderer3D}`, 'info');
	}

	function sleep (ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	// Keyboard shortcut to toggle debug console
	document.addEventListener('keydown', (e) => {
		if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'D')) {
			e.preventDefault();
			const consoleDiv = document.getElementById('debug-console');
			if (consoleDiv) {
				consoleDiv.style.display = consoleDiv.style.display === 'none' ? 'block' : 'none';
				debugConsoleEnabled = consoleDiv.style.display === 'block';
			}
		}
	});

	// ===== Main Application Code =====
	console.log('[Mnemonica] Script starting...');
	console.log('[Mnemonica] THREE available:', typeof THREE);

	const vscode = acquireVsCodeApi();
	// eslint-disable-next-line no-undef
	const showProperties = SHOW_PROPERTIES_PLACEHOLDER;
	let simulation = null;
	let svg = null;
	let g = null;
	let zoom = null;
	let currentData = null;
	let is3D = false;
	let renderer3D = null;
	let clickTimeout = null;
	let resizeHandler3D = null;
	let saved3DCameraState = null; // Stores camera state when switching to 2D

	// Initialize when DOM is ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}

	function init () {
		console.log('[Mnemonica] DOM ready, d3 available:', typeof d3 !== 'undefined');
		console.log('[Mnemonica] THREE available:', typeof THREE !== 'undefined');
		console.log('[Mnemonica] Requesting data from extension...');
		initDebugConsole();
		setupEventListeners();
		vscode.postMessage({ command: 'ready' });
	}

	function setupEventListeners () {
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

		document.getElementById('toggle-3d').addEventListener('click', function () {
			toggle3DMode();
		});
	}

	function toggle3DMode () {
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
		is3D = !is3D;
		const btn = document.getElementById('toggle-3d');
		btn.textContent = is3D ? '3D' : '2D';
		btn.classList.toggle('active', is3D);

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

		// Clear any pending click timeouts
		if (clickTimeout) {
			clearTimeout(clickTimeout);
			clickTimeout = null;
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
			console.error('[Mnemonica] Error toggling mode:', err);
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
	});

	function render2DGraph (data) {
		console.log('[Mnemonica] Rendering 2D graph with', data.nodes.length, 'nodes and', data.links.length, 'links');

		if (!data || data.nodes.length === 0) {
			console.warn('[Mnemonica] No data to render');
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
			console.error('[Mnemonica] Graph container not found!');
			return;
		}

		container.innerHTML = '';

		const width = container.clientWidth || 800;
		const height = container.clientHeight || 600;

		console.log('[Mnemonica] Container size:', width, 'x', height);

		// Create SVG
		svg = d3.select('#graph')
			.append('svg')
			.attr('width', width)
			.attr('height', height)
			.attr('viewBox', [0, 0, width, height])
			.style('width', '100%')
			.style('height', '100%');

		// Center the graph in the viewport
		const offsetX = (width - 800) / 2;
		const offsetY = (height - 600) / 2;
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

		// Node circles
		node.append('circle')
			.attr('r', function (d) { return 12 + (d.properties ? d.properties.length : 0); })
			.attr('fill', function (d) { return colors[d.depth % colors.length]; })
			.style('cursor', 'pointer');

		// Node labels
		node.append('text')
			.attr('dx', 15)
			.attr('dy', 4)
			.text(function (d) { return d.name; })
			.style('pointer-events', 'none');

		// Track drag start position to distinguish click from drag
		let dragStartPos = null;
		const CLICK_THRESHOLD = 5; // pixels

		// Add drag behavior using raw mouse events
		node.on('mousedown', function (event, d) {
			event.stopPropagation();
			isDragging2D = true;
			draggedNode2D = d;
			dragStartPos = { x: event.clientX, y: event.clientY };
			d3.select(this).style('cursor', 'move');
		});

		// Global mouse handlers for dragging
		svg.on('mousemove', function (event) {
			if (isDragging2D && draggedNode2D) {
				const transform = d3.zoomTransform(svg.node());
				const x = (event.offsetX - transform.x) / transform.k;
				const y = (event.offsetY - transform.y) / transform.k;

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

		svg.on('mouseup', function (event) {
			if (isDragging2D && draggedNode2D) {
				// Check if it was a click or a drag
				const dx = event.clientX - dragStartPos.x;
				const dy = event.clientY - dragStartPos.y;
				const distance = Math.sqrt(dx * dx + dy * dy);

				if (distance < CLICK_THRESHOLD) {
					// It was a click, handle click/double-click
					if (clickTimeout) {
						clearTimeout(clickTimeout);
						clickTimeout = null;
						// Double click - jump to definition
						if (draggedNode2D.location) {
							vscode.postMessage({
								command: 'goToDefinition',
								data: draggedNode2D.location
							});
						}
					} else {
						// Single click - toggle tooltip (capture node before timeout)
						const clickedNode = draggedNode2D;
						clickTimeout = setTimeout(function () {
							clickTimeout = null;
							const tooltip = d3.select('#tooltip');
							const existingNodeId = tooltip.attr('data-node-id');
							if (tooltip.classed('visible') && existingNodeId === clickedNode.id) {
								// Hide if already showing for same node
								tooltip.classed('visible', false);
							} else {
								// Show tooltip for clicked node
								const d = clickedNode;
								const props = (d.properties || [])
									.map(function (p) { return p.name + ': ' + p.type; })
									.join('<br>');

								tooltip
									.attr('data-node-id', d.id)
									.classed('visible', true)
									.html('<strong>' + d.name + '</strong><br>' +
										'<em>depth: ' + d.depth + '</em><br>' +
										(props ? '<hr>' + props : ''))
									.style('left', (event.pageX + 10) + 'px')
									.style('top', (event.pageY - 10) + 'px');
							}
						}, 250);
					}
				}
			}

			isDragging2D = false;
			draggedNode2D = null;
			node.style('cursor', 'pointer');
		});

		svg.on('mouseleave', function () {
			isDragging2D = false;
			draggedNode2D = null;
			node.style('cursor', 'pointer');
		});

		// Click on background to close popup
		svg.on('click', function (event) {
			if (event.target.tagName === 'svg') {
				d3.select('#properties-panel').remove();
			}
		});

		function updateLinks () {
			link
				.attr('x1', function (d) { return d.source.x; })
				.attr('y1', function (d) { return d.source.y; })
				.attr('x2', function (d) { return d.target.x; })
				.attr('y2', function (d) { return d.target.y; });
		}

		// Initial draw of links (no simulation, fixed positions)
		updateLinks();

		// Update 2D coordinates when dragging
		function updateNodePosition (d) {
			d.x2d = d.x;
			d.y2d = d.y;
		}

		function handleNodeHover (event, d) {
			const tooltip = d3.select('#tooltip');
			const props = (d.properties || [])
				.map(function (p) { return p.name + ': ' + p.type; })
				.join('<br>');

			tooltip
				.classed('visible', true)
				.html('<strong>' + d.name + '</strong><br>' +
					'<em>depth: ' + d.depth + '</em><br>' +
					(props ? '<hr>' + props : ''))
				.style('left', (event.pageX + 10) + 'px')
				.style('top', (event.pageY - 10) + 'px');
		}

		function handleNodeLeave () {
			d3.select('#tooltip').classed('visible', false);
		}

		// Update status
		const status = document.getElementById('status');
		if (status) {
			status.textContent = data.nodes.length + ' types | ' +
				data.links.length + ' relationships';
		}

		// Create generation distance controls for 2D too
		createGenControls(data, null);

		console.log('[Mnemonica] 2D Graph rendered successfully');
	}

	/**
		* Calculate 2D concentric circle positions
		* Uses space-filling angular sectors based on subtree sizes
		* Prevents line crossings by allocating exclusive angular wedges
		*/
	function calculate2DPositions (data) {
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
		const depthRadii = new Map([
			[0, 80],   // Roots
			[1, 160],  // Gen 1
			[2, 240],  // Gen 2
			[3, 320],  // Gen 3
			[4, 400],  // Gen 4
			[5, 480]   // Gen 5
		]);

		// Calculate subtree sizes (total descendants including self)
		function calculateSubtreeSize (node) {
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
		function assignSectors (node, startAngle, endAngle) {
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
		const maxDepth = Math.max(...data.nodes.map(n => n.depth || 0));
		for (let depth = 0; depth <= maxDepth; depth++) {
			const nodesAtDepth = data.nodes.filter(n => (n.depth || 0) === depth);
			const radius = depthRadii.get(depth) || (80 + depth * 80);

			nodesAtDepth.forEach(node => {
				const angle = node.angle2d || 0;
				node.x2d = centerX + radius * Math.cos(angle);
				node.y2d = centerY + radius * Math.sin(angle);
			});
		}
	}

	// Show properties panel for a node
	function showPropertiesPanel (d) {
		// Remove any existing panel
		d3.select('#properties-panel').remove();


		const panel = d3.select('body').append('div')
			.attr('id', 'properties-panel')
			.attr('data-node-id', d.id)
			.style('position', 'absolute')
			.style('top', '50px')
			.style('right', '10px')
			.style('width', '280px')
			.style('max-height', '400px')
			.style('overflow-y', 'auto')
			.style('background', 'var(--vscode-editorHoverWidget-background)')
			.style('border', '1px solid var(--vscode-editorHoverWidget-border)')
			.style('border-radius', '4px')
			.style('padding', '10px')
			.style('z-index', '1000')
			.style('box-shadow', '0 4px 12px rgba(0,0,0,0.3)');

		// Header
		panel.append('div')
			.style('font-weight', 'bold')
			.style('font-size', '14px')
			.style('margin-bottom', '8px')
			.style('border-bottom', '1px solid var(--vscode-editorHoverWidget-border)')
			.style('padding-bottom', '5px')
			.text(d.name);

		// Table
		const table = panel.append('table')
			.style('width', '100%')
			.style('border-collapse', 'collapse')
			.style('font-size', '11px');

		// Table header
		const thead = table.append('thead');
		const headerRow = thead.append('tr');
		headerRow.append('th')
			.style('text-align', 'left')
			.style('padding', '4px')
			.style('border-bottom', '1px solid var(--vscode-editorHoverWidget-border)')
			.text('Field');
		headerRow.append('th')
			.style('text-align', 'left')
			.style('padding', '4px')
			.style('border-bottom', '1px solid var(--vscode-editorHoverWidget-border)')
			.text('Type');

		// Table body
		const tbody = table.append('tbody');
		d.properties.forEach(function (prop) {
			const row = tbody.append('tr');

			// Field name
			row.append('td')
				.style('padding', '4px')
				.style('vertical-align', 'top')
				.style('font-family', 'var(--vscode-editor-font-family)')
				.text(prop.name);

			// Type - truncate if too long
			let typeText = prop.type || 'unknown';
			// Check if it's a primitive type
			const isPrimitive = /^(string|number|boolean|null|undefined|unknown|any|void|never|bigint|symbol)$/.test(typeText);
			if (!isPrimitive && typeText.length > 25) {
				typeText = typeText.substring(0, 22) + '...';
			}

			row.append('td')
				.style('padding', '4px')
				.style('vertical-align', 'top')
				.style('font-family', 'var(--vscode-editor-font-family)')
				.style('color', isPrimitive ? 'var(--vscode-symbolIcon-colorForeground)' : 'var(--vscode-foreground)')
				.text(typeText);
		});

		// Close button
		panel.append('div')
			.style('margin-top', '8px')
			.style('text-align', 'right')
			.style('border-top', '1px solid var(--vscode-editorHoverWidget-border)')
			.style('padding-top', '5px')
			.append('button')
			.style('padding', '4px 12px')
			.style('font-size', '11px')
			.style('background', 'var(--vscode-button-background)')
			.style('color', 'var(--vscode-button-foreground)')
			.style('border', 'none')
			.style('border-radius', '3px')
			.style('cursor', 'pointer')
			.text('Close')
			.on('click', function () {
				d3.select('#properties-panel').remove();
			});

		// Also close when clicking outside
		setTimeout(function () {
			d3.select('body').on('click.properties-panel', function (e) {
				if (!e.target.closest('#properties-panel')) {
					d3.select('#properties-panel').remove();
					d3.select('body').on('click.properties-panel', null);
				}
			});
		}, 100);
	}

	function render3DGraph (data, initialCameraState = null) {
		console.log('[Mnemonica] Rendering 3D graph with', data.nodes.length, 'nodes and', data.links.length, 'links');
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
			console.warn('[Mnemonica] No data to render');
			document.getElementById('graph').innerHTML = '<div class="loading">No type data found</div>';
			return;
		}

		const container = document.getElementById('graph');
		if (!container) {
			console.error('[Mnemonica] Graph container not found!');
			return;
		}

		container.innerHTML = '';

		// Create 3D renderer
		renderer3D = new Graph3DRenderer(container, initialCameraState);
		renderer3D.setOnNodeClick(function (node) {
			console.log('[Mnemonica] 3D Node clicked:', node.name);
			if (node.location) {
				vscode.postMessage({
					command: 'goToDefinition',
					data: node.location
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
		const status = document.getElementById('status');
		if (status) {
			status.textContent = data.nodes.length + ' types | ' +
				data.links.length + ' relationships (3D)';
		}

		// Create generation distance controls
		createGenControls(data, renderer3D);

		console.log('[Mnemonica] 3D Graph rendered successfully');
	}

	/**
		* Create generation distance control panel
		*/
	function createGenControls (data, renderer) {
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
			// Default radii for 2D mode
			const defaults2D = [80, 160, 240, 320, 400, 480];
			let currentRadius;
			if (window.genRadii && window.genRadii[depth] !== undefined) {
				currentRadius = window.genRadii[depth];
			} else if (is3D && renderer && renderer.depthRadii) {
				currentRadius = renderer.depthRadii.get(depth);
			} else {
				currentRadius = defaults2D[depth] || (80 + depth * 80);
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
	function adjustGenRadius (depth, delta, renderer, display, data) {
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
				const defaults = [80, 160, 240, 320, 400, 480];
				currentValue = window.genRadii[d] !== undefined
					? window.genRadii[d]
					: defaults[d] || (80 + d * 80);
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
	function calculate2DPositionsWithRadii (data) {
		const layoutWidth = 800;
		const layoutHeight = 600;
		const centerX = layoutWidth / 2;
		const centerY = layoutHeight / 2;

		// Default radii
		const defaults = [80, 160, 240, 320, 400, 480];

		// Calculate subtree sizes (total descendants including self)
		function calculateSubtreeSize (node) {
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
		function assignSectors (node, startAngle, endAngle) {
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
		for (let depth = 0; depth <= maxDepth; depth++) {
			const nodesAtDepth = data.nodes.filter(n => (n.depth || 0) === depth);
			const radius = window.genRadii && window.genRadii[depth] !== undefined
				? window.genRadii[depth]
				: (defaults[depth] || 80 + depth * 80);

			nodesAtDepth.forEach(node => {
				const angle = node.angle2d || 0;
				node.x2d = centerX + radius * Math.cos(angle);
				node.y2d = centerY + radius * Math.sin(angle);
			});
		}
	}

	// 3D Renderer Class with human-readable layout
	class Graph3DRenderer {
		constructor (container, initialCameraState = null) {
			this.container = container;
			this.nodeMeshes = new Map();
			this.linkLines = [];
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
				this.panOffset = { x: 0, y: 0 };
			}
			this.depthRadii = null; // Will be initialized in renderGraph

			this.init();
		}

		init () {
			console.log('[3D] init() called');
			console.log('[3D] THREE available:', typeof THREE);
			console.log('[3D] Container:', this.container);
			console.log('[3D] Container size:', this.container.clientWidth, 'x', this.container.clientHeight);

			// Check WebGL support
			const testCanvas = document.createElement('canvas');
			const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
			console.log('[3D] WebGL available:', !!gl);

			// Create scene with lighter background
			this.scene = new THREE.Scene();
			this.scene.background = new THREE.Color(0x2d2d2d);

			// Create camera with better initial position
			const width = this.container.clientWidth || 800;
			const height = this.container.clientHeight || 600;
			console.log('[3D] Using size:', width, 'x', height);
			this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 5000);
			// Use existing zoom/panOffset if they were restored, otherwise set defaults
			if (this.zoom === undefined) this.zoom = 600;
			if (this.panOffset === undefined) this.panOffset = { x: 0, y: 0 };
			this.isPanning = false;
			this.draggedNode = null;
			// Apply the camera position based on restored/default values
			this.updateCameraPosition();

			// Create renderer
			try {
				this.renderer = new THREE.WebGLRenderer({ antialias: true });
				console.log('[3D] WebGLRenderer created');
			} catch (e) {
				console.error('[3D] WebGLRenderer failed:', e);
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

		setupInteraction () {
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
				this.isDragging = false;
				this.isPanning = e.ctrlKey;
				this.previousMousePosition = { x: e.clientX, y: e.clientY };

				// Check if clicking on a node for dragging
				const rect = canvas.getBoundingClientRect();
				this.mouseVector.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
				this.mouseVector.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
				this.raycaster.setFromCamera(this.mouseVector, this.camera);
				const intersects = this.raycaster.intersectObjects(Array.from(this.nodeMeshes.values()));

				if (intersects.length > 0 && !e.ctrlKey) {
					this.draggedNode = intersects[0].object;
					this.draggedNode.userData.isDragging = true;
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

						// Drag node in 3D space
						const rect = canvas.getBoundingClientRect();
						this.mouseVector.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
						this.mouseVector.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
						this.raycaster.setFromCamera(this.mouseVector, this.camera);

						// Intersect with a plane at the node's current depth
						const nodeZ = this.draggedNode.position.z;
						const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -nodeZ);
						const target = new THREE.Vector3();
						this.raycaster.ray.intersectPlane(dragPlane, target);

						if (target) {
							// Move the dragged node
							this.draggedNode.position.x = target.x;
							this.draggedNode.position.y = target.y;

							// Update node data and fix position
							const draggedNodeData = this.draggedNode.userData.node;
							if (draggedNodeData) {
								draggedNodeData.x = target.x;
								draggedNodeData.y = target.y;
								draggedNodeData.fx = target.x;
								draggedNodeData.fy = target.y;
								// Also fix Z to prevent drift
								draggedNodeData.z = nodeZ;
								draggedNodeData.fz = nodeZ;
							}

							// Update link positions to follow the node
							this.updateLinkPositions();
						}
					} else if (e.ctrlKey) {
						// Ctrl+drag: rotate camera around center
						this.cameraRotation.y += dx * 0.005;
						this.cameraRotation.x += dy * 0.005;
						this.cameraRotation.x = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.cameraRotation.x));
						this.updateCameraPosition();
					} else {
						// Regular drag: pan the view
						const panSpeed = this.zoom * 0.001;
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

				if (!this.isDragging) {
					this.handleClick(e);
				}
			});

			canvas.addEventListener('wheel', (e) => {
				e.preventDefault();
				e.stopPropagation();
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

		updateCameraPosition () {
			const x = Math.sin(this.cameraRotation.y) * Math.cos(this.cameraRotation.x) * this.zoom + this.panOffset.x;
			const y = Math.sin(this.cameraRotation.x) * this.zoom + this.panOffset.y;
			const z = Math.cos(this.cameraRotation.y) * Math.cos(this.cameraRotation.x) * this.zoom;
			this.camera.position.set(x, y, z);
			this.camera.lookAt(this.panOffset.x, this.panOffset.y, 0);
		}

		updateHover (event) {
			const rect = this.renderer.domElement.getBoundingClientRect();
			this.mouseVector.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
			this.mouseVector.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

			this.raycaster.setFromCamera(this.mouseVector, this.camera);
			const intersects = this.raycaster.intersectObjects(Array.from(this.nodeMeshes.values()));

			// Reset all emissive
			this.nodeMeshes.forEach(mesh => {
				const material = mesh.material;
				if (mesh.userData.node.isRoot) {
					material.emissiveIntensity = 0.3;
				} else {
					material.emissiveIntensity = 0;
				}
			});

			// Highlight hovered only (no tooltip)
			if (intersects.length > 0) {
				const mesh = intersects[0].object;
				mesh.material.emissiveIntensity = 0.5;
				this.container.style.cursor = 'pointer';
			} else {
				this.container.style.cursor = 'default';
			}
		}

		handleClick (event) {
			const rect = this.renderer.domElement.getBoundingClientRect();
			this.mouseVector.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
			this.mouseVector.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

			this.raycaster.setFromCamera(this.mouseVector, this.camera);
			const intersects = this.raycaster.intersectObjects(Array.from(this.nodeMeshes.values()));

			if (intersects.length > 0) {
				const node = intersects[0].object.userData.node;
				if (node) {
					// Use the same click/double-click logic as 2D
					this.handleNodeClick3D(node, event);
				}
			}
		}

		handleNodeClick3D (node, event) {
			if (!this.clickTimeout) {
				// First click - wait for potential double click
				this.clickTimeout = setTimeout(() => {
					this.clickTimeout = null;
					// Single click - show tooltip (same style as 2D hover)
					const tooltip = d3.select('#tooltip');
					const existingNodeId = tooltip.attr('data-node-id');
					if (tooltip.classed('visible') && existingNodeId === node.id) {
						tooltip.classed('visible', false);
					} else {
						const props = (node.properties || [])
							.map(p => p.name + ': ' + p.type)
							.join('<br>');
						tooltip
							.attr('data-node-id', node.id)
							.classed('visible', true)
							.html('<strong>' + node.name + '</strong><br>' +
								'<em>depth: ' + node.depth + '</em><br>' +
								(props ? '<hr>' + props : ''))
							.style('left', (event.pageX + 10) + 'px')
							.style('top', (event.pageY - 10) + 'px');
					}
				}, 250);
			} else {
				// Double click - clear timeout and jump to definition
				clearTimeout(this.clickTimeout);
				this.clickTimeout = null;
				if (node.location && this.onNodeClick) {
					this.onNodeClick(node);
				}
			}
		}

		/**
		 * 3D Layout with human-readable spacing
		 * 
		 * 1. Root spacing based on actual label widths (char count × avg char width)
		 * 2. Generation gaps are smaller and more consistent
		 * 3. Center marker at origin
		 */
		renderGraph (data, d3) {
			this.clear();

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
			const nodeDiameter = nodeRadius * 2; // 16px

			/**
			 * TRUE 3D SPHERICAL LAYOUT
			 * Each generation forms a complete spherical shell
			 * INCREASED distances for better visibility
			 */
			// Calculate root radius based on number of roots to prevent label overlap
			// Need enough circumference for all root node labels
			const rootCount = rootNodes.length;
			const avgLabelWidth = 60; // Average width needed per label (smaller, labels can overlap slightly)
			const minRootRadius = 60;  // Minimum radius
			// Use square root scaling for better distribution
			// More roots = larger radius, but not linearly
			const calculatedRootRadius = Math.max(minRootRadius, 60 + Math.sqrt(rootCount) * 30);
			
			// Use instance depthRadii if available (for adjustments), otherwise use defaults
			if (!this.depthRadii) {
				this.depthRadii = new Map([
					[0, calculatedRootRadius],   // Roots: dynamic based on count
					[1, calculatedRootRadius + 60],   // Gen 1: +60px
					[2, calculatedRootRadius + 110],  // Gen 2: +110px
					[3, calculatedRootRadius + 160],  // Gen 3: +160px
					[4, calculatedRootRadius + 210],  // Gen 4: +210px
					[5, calculatedRootRadius + 260]   // Gen 5: +260px
				]);
			}
			const depthRadii = this.depthRadii;

			/**
			 * Distribute points evenly on a sphere surface
			 * Uses Fibonacci sphere algorithm for uniform distribution
			 */
			function placeOnSphere (radius, index, total) {
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
			function placeInCone (parentPos, childIndex, childCount, radius, maxAngle) {
				const parentR = Math.sqrt(parentPos.x**2 + parentPos.y**2 + parentPos.z**2);
				
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
				const ulen = Math.sqrt(ux*ux + uy*uy + uz*uz);
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
			function calculatePosition (node, depth, index, totalAtDepth) {
				// Check if we have saved 3D coordinates - use them!
				if (node.x3d !== undefined && node.y3d !== undefined && node.z3d !== undefined) {
					return { x: node.x3d, y: node.y3d, z: node.z3d };
				}
				
				const radius = depthRadii.get(depth) || (180 + (depth - 6) * 26);
				
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

			// Create node spheres
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

				const sphere = new THREE.Mesh(sphereGeometry, material);
				sphere.position.set(node.x, node.y, node.z);
				sphere.userData = { node };

				this.addLabel(sphere, node.name);

				this.scene.add(sphere);
				this.nodeMeshes.set(node.id, sphere);
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
				this.scene.add(line);

				// Add arrowhead
				const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
				this.scene.add(arrow);

				this.linkLines.push({ line, arrow, link });
			});

			// Update link positions
			this.updateLinkPositions();
		}

		updateLinkPositions () {
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
						const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
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

		addLabel (mesh, text) {
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
				alphaTest: 0.5
			});
			const sprite = new THREE.Sprite(spriteMaterial);
			sprite.position.set(0, 35, 0);
			sprite.scale.set(100, 25, 1);

			mesh.add(sprite);
		}

		zoomIn () {
			this.zoom = Math.max(100, this.zoom * 0.7);
			this.updateCameraPosition();
		}

		zoomOut () {
			this.zoom = Math.min(2500, this.zoom * 1.3);
			this.updateCameraPosition();
		}

		reset () {
			this.cameraRotation = { x: 0, y: 0 };
			this.panOffset = { x: 0, y: 0 };
			this.zoom = 600;
			this.updateCameraPosition();
		}

		resize (width, height) {
			this.camera.aspect = width / height;
			this.camera.updateProjectionMatrix();
			this.renderer.setSize(width, height);
		}

		setOnNodeClick (handler) {
			this.onNodeClick = handler;
		}

		animate () {
			this.animationId = requestAnimationFrame(() => this.animate());
			this.renderer.render(this.scene, this.camera);
		}

		clear () {
			this.nodeMeshes.forEach(mesh => {
				this.scene.remove(mesh);
				mesh.geometry.dispose();
				mesh.material.dispose();
			});
			this.nodeMeshes.clear();

			this.linkLines.forEach(({ line, arrow }) => {
				this.scene.remove(line);
				line.geometry.dispose();
				if (arrow) {
					this.scene.remove(arrow);
					arrow.geometry.dispose();
					arrow.material.dispose();
				}
			});
			this.linkLines = [];

			if (this.simulation) {
				this.simulation.stop();
				this.simulation = null;
			}
		}

		dispose () {
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
