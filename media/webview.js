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

	const vscode = acquireVsCodeApi();
	vscodeRef = vscode;
	let simulation = null;
	let svg = null;
	let g = null;
	let zoom = null;
	let currentData = null;
	let is3D = false;
	let renderer3D = null;
	let resizeHandler3D = null;
	let saved3DCameraState = null; // Stores camera state when switching to 2D

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

		document.getElementById('toggle-3d').addEventListener('click', function () {
			toggle3DMode();
		});
	}

	function toggle3DMode() {
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
			tooltip
				.attr('data-node-id', d.id)
				.classed('visible', true)
				.html('<strong>' + d.name + '</strong><br>' +
					'<em>depth: ' + d.depth + '</em><br>' +
					(props ? '<hr>' + props : ''))
				.style('left', (event.pageX + 10) + 'px')
				.style('top', (event.pageY - 10) + 'px');
		});

		// Double-click on node - go to definition
		node.on('dblclick', function (event, d) {
			event.stopPropagation();
			// Hide tooltip on navigation
			d3.select('#tooltip').classed('visible', false);
			if (d.location) {
				vscode.postMessage({
					command: 'goToDefinition',
					data: d.location
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
		const status = document.getElementById('status');
		if (status) {
			status.textContent = data.nodes.length + ' types | ' +
				data.links.length + ' relationships';
		}

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
		renderer3D.setOnNodeClick(function (node) {
			debugLog('[Mnemonica] 3D Node clicked:', node.name, 'log');
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

		debugLog('[Mnemonica] 3D Graph rendered successfully', 'log');
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
			if (this.panOffset === undefined) this.panOffset = { x: 0, y: 0 };
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
				this.isDragging = false;
				this.isPanning = e.ctrlKey;
				this.previousMousePosition = { x: e.clientX, y: e.clientY };

				// Check if clicking on a node for dragging
				const rect = canvas.getBoundingClientRect();
				this.mouseVector.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
				this.mouseVector.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
				this.raycaster.setFromCamera(this.mouseVector, this.camera);
				const intersects = this.raycaster.intersectObjects(Array.from(this.nodeMeshes.values()));

				if (intersects.length > 0) {
					this.draggedNode = intersects[0].object;
					this.draggedNode.userData.isDragging = true;
					// Store the intersection point offset from node center
					const intersectPoint = intersects[0].point;
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
				if (intersects.length > 0) {
					const node = intersects[0].object.userData.node;
					if (node) {
						this.handleNodeClick3D(e, node);
					}
				} else {
					// Click on background - hide tooltip
					d3.select('#tooltip').classed('visible', false);
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
				if (intersects.length > 0) {
					const node = intersects[0].object.userData.node;
					if (node) {
						this.handleNodeDoubleClick3D(node, e);
					}
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

		updateCameraPosition() {
			const x = Math.sin(this.cameraRotation.y) * Math.cos(this.cameraRotation.x) * this.zoom + this.panOffset.x;
			const y = Math.sin(this.cameraRotation.x) * this.zoom + this.panOffset.y;
			const z = Math.cos(this.cameraRotation.y) * Math.cos(this.cameraRotation.x) * this.zoom;
			this.camera.position.set(x, y, z);
			this.camera.lookAt(this.panOffset.x, this.panOffset.y, 0);
		}

		updateHover(event) {
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
				tooltip
					.attr('data-node-id', node.id)
					.classed('visible', true)
					.html('<strong>' + node.name + '</strong><br>' +
						'<em>depth: ' + node.depth + '</em><br>' +
						(props ? '<hr>' + props : ''))
					.style('left', (event.pageX + 10) + 'px')
					.style('top', (event.pageY - 10) + 'px');
			}
		}

		handleNodeDoubleClick3D(node, _event) {
			// Double click - jump to definition
			if (node.location && this.onNodeClick) {
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

		updateLinkPositions() {
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
				alphaTest: 0.5
			});
			const sprite = new THREE.Sprite(spriteMaterial);
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
			this.panOffset = { x: 0, y: 0 };
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
			this.renderer.render(this.scene, this.camera);
		}

		clear() {
			this.nodeMeshes.forEach(mesh => {
				// Remove label if exists
				if (mesh.userData.label) {
					this.scene.remove(mesh.userData.label);
					mesh.userData.label.material.map.dispose();
					mesh.userData.label.material.dispose();
				}
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

