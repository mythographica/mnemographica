import * as vscode from 'vscode';
import { GraphData, WebviewMessage } from '../types';

export class GraphPanel {
	public static currentPanel: GraphPanel | undefined;
	private static readonly viewType = 'mnemonicaGraph';

	private readonly panel: vscode.WebviewPanel;
	private disposables: vscode.Disposable[] = [];
	private graphData: GraphData | null = null;

	public static createOrShow (extensionUri: vscode.Uri, graphData: GraphData | null) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// If we already have a panel, show it and update data
		if (GraphPanel.currentPanel) {
			GraphPanel.currentPanel.panel.reveal(column);
			if (graphData) {
				GraphPanel.currentPanel.updateGraph(graphData);
			}
			return;
		}

		// Otherwise, create a new panel
		const panel = vscode.window.createWebviewPanel(
			GraphPanel.viewType,
			'Mnemonica Type Graph',
			column || vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
			}
		);

		GraphPanel.currentPanel = new GraphPanel(panel, extensionUri, graphData);
	}

	public static updateGraph (graphData: GraphData | null) {
		if (GraphPanel.currentPanel && graphData) {
			GraphPanel.currentPanel.updateGraph(graphData);
		}
	}

	private constructor (
		panel: vscode.WebviewPanel,
		extensionUri: vscode.Uri,
		graphData: GraphData | null
	) {
		this.panel = panel;
		this.graphData = graphData;

		// Set the webview's initial html content
		this.panel.webview.html = this.getWebviewContent(graphData, extensionUri);

		// Listen for when the panel is disposed
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

		// Handle messages from the webview
		this.panel.webview.onDidReceiveMessage(
			async (message: WebviewMessage) => {
				switch (message.command) {
				case 'goToDefinition':
					await this.handleGoToDefinition(message.data as {
						fileName: string;
						line: number;
						column: number;
					});
					break;
				case 'ready':
					// Webview is ready, send initial data
					console.log('[Mnemonica Extension] Webview ready, sending data...');
					if (this.graphData) {
						this.panel.webview.postMessage({
							command: 'updateGraph',
							data: this.graphData
						});
					}
					break;
				}
			},
			null,
			this.disposables
		);
	}

	private updateGraph (graphData: GraphData) {
		this.graphData = graphData;

		// Send data to webview
		this.panel.webview.postMessage({
			command: 'updateGraph',
			data: graphData
		});
	}

	private async handleGoToDefinition (location: {
		fileName: string;
		line: number;
		column: number;
	}) {
		try {
			const document = await vscode.workspace.openTextDocument(location.fileName);
			const editor = await vscode.window.showTextDocument(document);
			const position = new vscode.Position(location.line - 1, location.column);
			editor.selection = new vscode.Selection(position, position);
			editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
		} catch (error) {
			console.error('[Mnemonica Extension] Failed to open file:', error);
			vscode.window.showErrorMessage(`Could not open ${location.fileName}`);
		}
	}

	private getWebviewContent (graphData: GraphData | null, extensionUri: vscode.Uri): string {
		const config = vscode.workspace.getConfiguration('mnemographica');
		const showProperties = config.get<boolean>('showProperties', true);

		// Get local resource URIs
		const d3Uri = this.panel.webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'media', 'd3.v7.min.js')
		);

		// Use UMD build for Three.js (creates global THREE)
		const threeUri = this.panel.webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'media', 'three.umd.js')
		);

		const statusText = graphData
			? `${graphData.nodes.length} types | ${graphData.links.length} relationships`
			: 'Loading...';

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-eval' 'unsafe-inline' blob: ${this.panel.webview.cspSource}; style-src 'unsafe-inline'; img-src data: blob:;">
	<title>Mnemonica Type Graph</title>
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}

		body {
			font-family: var(--vscode-font-family);
			background: var(--vscode-editor-background);
			color: var(--vscode-foreground);
			overflow: hidden;
			width: 100vw;
			height: 100vh;
		}

		#graph {
			width: 100%;
			height: 100%;
			perspective: 1000px;
			transform-style: preserve-3d;
		}

		#graph svg {
			transform-style: preserve-3d;
			transition: transform 0.1s ease-out;
		}

		#graph.rotating {
			cursor: move;
		}

		#rotation-hint {
			position: absolute;
			bottom: 30px;
			left: 10px;
			font-size: 10px;
			color: var(--vscode-descriptionForeground);
			opacity: 0.7;
			z-index: 100;
		}

		.node circle {
			cursor: pointer;
			stroke: var(--vscode-editor-background);
			stroke-width: 2px;
			transition: all 0.2s ease;
		}

		.node circle:hover {
			stroke: var(--vscode-focusBorder);
			stroke-width: 3px;
			filter: brightness(1.2);
		}

		.node.root circle {
			stroke: #8B0000;
			stroke-width: 6px;
			stroke-dasharray: 4px 2px;
		}

		.node.root circle:hover {
			stroke: #A52A2A;
			stroke-width: 7px;
		}

		.node text {
			font-size: 12px;
			fill: var(--vscode-foreground);
			pointer-events: none;
			text-shadow: 0 0 3px var(--vscode-editor-background);
		}

		.link {
			stroke: var(--vscode-foreground);
			stroke-opacity: 0.8;
			stroke-width: 2.5px;
		}

		.link:hover {
			stroke: var(--vscode-focusBorder);
			stroke-opacity: 1;
			stroke-width: 3px;
		}

		#tooltip {
			position: absolute;
			padding: 10px;
			background: var(--vscode-editorHoverWidget-background);
			border: 1px solid var(--vscode-editorHoverWidget-border);
			border-radius: 4px;
			color: var(--vscode-editorHoverWidget-foreground);
			font-size: 11px;
			font-family: var(--vscode-editor-font-family);
			pointer-events: none;
			opacity: 0;
			transition: opacity 0.2s;
			max-width: 300px;
			z-index: 1000;
		}

		#tooltip.visible {
			opacity: 1;
		}

		#controls {
			position: absolute;
			top: 10px;
			right: 10px;
			display: flex;
			gap: 5px;
			z-index: 100;
		}

		.control-btn {
			padding: 6px 12px;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			border-radius: 3px;
			cursor: pointer;
			font-size: 11px;
		}

		.control-btn:hover {
			background: var(--vscode-button-hoverBackground);
		}

		.control-btn.active {
			background: var(--vscode-button-hoverBackground);
			box-shadow: inset 0 0 0 1px var(--vscode-focusBorder);
		}

		#status {
			position: absolute;
			bottom: 10px;
			left: 10px;
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			z-index: 100;
		}

		.loading {
			display: flex;
			align-items: center;
			justify-content: center;
			height: 100%;
			font-size: 14px;
			color: var(--vscode-descriptionForeground);
		}

		/* 3D Canvas styles */
		#graph canvas {
			display: block;
			width: 100%;
			height: 100%;
		}
	</style>
</head>
<body>
	<div id="controls">
		<button class="control-btn" id="zoom-in">Zoom In</button>
		<button class="control-btn" id="zoom-out">Zoom Out</button>
		<button class="control-btn" id="reset">Reset</button>
		<button class="control-btn" id="toggle-3d" title="Toggle 2D/3D">2D</button>
	</div>
	<div id="graph">
		<div class="loading">Loading graph...</div>
	</div>
	<div id="tooltip"></div>
	<div id="status">${statusText}</div>

	<script src="${d3Uri}"></script>
	<script src="${threeUri}"></script>
	<script>
		(function() {
			'use strict';

			console.log('[Mnemonica] Script starting...');
			console.log('[Mnemonica] THREE available:', typeof THREE);

			const vscode = acquireVsCodeApi();
			const showProperties = ${showProperties};
			let simulation = null;
			let svg = null;
			let g = null;
			let zoom = null;
			let currentData = null;
			let is3D = false;
			let renderer3D = null;

			// Initialize when DOM is ready
			if (document.readyState === 'loading') {
				document.addEventListener('DOMContentLoaded', init);
			} else {
				init();
			}

			function init() {
				console.log('[Mnemonica] DOM ready, d3 available:', typeof d3 !== 'undefined');
				console.log('[Mnemonica] THREE available:', typeof THREE !== 'undefined');
				console.log('[Mnemonica] Requesting data from extension...');
				setupEventListeners();
				vscode.postMessage({ command: 'ready' });
			}

			function setupEventListeners() {
				// Control buttons
				document.getElementById('zoom-in').addEventListener('click', function() {
					if (is3D && renderer3D) {
						renderer3D.zoomIn();
					} else if (svg && zoom) {
						svg.transition().call(zoom.scaleBy, 1.3);
					}
				});

				document.getElementById('zoom-out').addEventListener('click', function() {
					if (is3D && renderer3D) {
						renderer3D.zoomOut();
					} else if (svg && zoom) {
						svg.transition().call(zoom.scaleBy, 0.7);
					}
				});

				document.getElementById('reset').addEventListener('click', function() {
					if (is3D && renderer3D) {
						renderer3D.reset();
					} else {
						if (svg && zoom) svg.transition().call(zoom.transform, d3.zoomIdentity);
						if (simulation) {
							// Release all fixed positions and restart simulation briefly
							currentData.nodes.forEach(function(d) {
								d.fx = null;
								d.fy = null;
							});
							simulation.alpha(1).restart();
							// Stop after 2 seconds
							setTimeout(function() {
								if (simulation) simulation.stop();
							}, 2000);
						}
					}
				});

				document.getElementById('toggle-3d').addEventListener('click', function() {
					toggle3DMode();
				});
			}

			function toggle3DMode() {
				console.log('[Mnemonica] Toggling 3D mode, current is3D:', is3D);
				is3D = !is3D;
				const btn = document.getElementById('toggle-3d');
				btn.textContent = is3D ? '3D' : '2D';
				btn.classList.toggle('active', is3D);

				const container = document.getElementById('graph');
				container.innerHTML = '';

				// Clean up previous mode
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

				// Re-render in new mode
				if (currentData) {
					if (is3D) {
						console.log('[Mnemonica] Switching to 3D, THREE available:', typeof THREE);
						// Wait for THREE to be ready
						if (typeof THREE !== 'undefined') {
							console.log('[Mnemonica] THREE is ready, rendering 3D graph');
							render3DGraph(currentData);
						} else {
							console.log('[Mnemonica] THREE not ready, waiting...');
							container.innerHTML = '<div class="loading">Loading 3D engine...</div>';
							const checkThree = setInterval(function() {
								console.log('[Mnemonica] Checking THREE...', typeof THREE);
								if (typeof THREE !== 'undefined') {
									clearInterval(checkThree);
									console.log('[Mnemonica] THREE is now ready');
									render3DGraph(currentData);
								}
							}, 100);
							setTimeout(function() {
								clearInterval(checkThree);
								if (typeof THREE === 'undefined') {
									console.error('[Mnemonica] THREE failed to load after timeout');
									container.innerHTML = '<div class="loading">3D engine failed to load (timeout)</div>';
								}
							}, 5000);
						}
					} else {
						render2DGraph(currentData);
					}
				}
			}

			// Handle messages from extension
			window.addEventListener('message', function(event) {
				const message = event.data;
				console.log('[Mnemonica] Received message:', message.command);

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
				console.log('[Mnemonica] Rendering 2D graph with', data.nodes.length, 'nodes and', data.links.length, 'links');

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

				g = svg.append('g');

				zoom = d3.zoom()
					.scaleExtent([0.1, 4])
					.on('zoom', function(event) {
						g.attr('transform', event.transform);
					});

				svg.call(zoom);

				// Handle resize
				window.addEventListener('resize', function() {
					if (is3D) return;
					const newWidth = container.clientWidth || 800;
					const newHeight = container.clientHeight || 600;
					svg.attr('width', newWidth).attr('height', newHeight)
					   .attr('viewBox', [0, 0, newWidth, newHeight]);
					if (simulation) {
						simulation.force('center', d3.forceCenter(newWidth / 2, newHeight / 2));
						simulation.alpha(0.3).restart();
					}
				});

				// Color scale
				const colors = ['#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f',
					'#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab'];

				// Force simulation with closer initial layout
				simulation = d3.forceSimulation(data.nodes)
					.force('link', d3.forceLink(data.links)
						.id(function(d) { return d.id; })
						.distance(40))
					.force('charge', d3.forceManyBody().strength(-100))
					.force('center', d3.forceCenter(width / 2, height / 2))
					.force('collision', d3.forceCollide()
						.radius(function(d) { return 12 + (d.properties ? d.properties.length : 0); }));

				// Stop simulation after initial layout (2 seconds)
				setTimeout(function() {
					if (simulation) {
						simulation.stop();
					}
				}, 2000);

				// Draw links (behind nodes)
				const link = g.insert('g', ':first-child')
					.attr('class', 'links')
					.selectAll('line')
					.data(data.links)
					.enter().append('line')
					.attr('class', 'link');

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
					.attr('transform', function(d) {
						return 'translate(' + d.x + ',' + d.y + ')';
					})
					.style('cursor', 'pointer');

				// Add root class to root nodes
				node.filter(function(d) { return d.isRoot; })
					.classed('root', true);

				// Track click state
				let clickTimeout = null;

				// Node circles
				node.append('circle')
					.attr('r', function(d) { return 12 + (d.properties ? d.properties.length : 0); })
					.attr('fill', function(d) { return colors[d.depth % colors.length]; })
					.style('cursor', 'pointer');

				// Node labels
				node.append('text')
					.attr('dx', 15)
					.attr('dy', 4)
					.text(function(d) { return d.name; })
					.style('pointer-events', 'none');

				// Track drag start position to distinguish click from drag
				let dragStartPos = null;
				const CLICK_THRESHOLD = 5; // pixels

				// Add drag behavior using raw mouse events
				node.on('mousedown', function(event, d) {
					event.stopPropagation();
					isDragging2D = true;
					draggedNode2D = d;
					dragStartPos = { x: event.clientX, y: event.clientY };
					d3.select(this).style('cursor', 'move');
				});

				// Global mouse handlers for dragging
				svg.on('mousemove', function(event) {
					if (isDragging2D && draggedNode2D) {
						const transform = d3.zoomTransform(svg.node());
						const x = (event.offsetX - transform.x) / transform.k;
						const y = (event.offsetY - transform.y) / transform.k;

						draggedNode2D.x = x;
						draggedNode2D.y = y;
						draggedNode2D.fx = x;
						draggedNode2D.fy = y;

						// Update visual position
						const nodeSelection = node.filter(function(n) { return n.id === draggedNode2D.id; });
						nodeSelection.attr('transform', 'translate(' + x + ',' + y + ')');

						// Update links
						updateLinks();
					}
				});

				svg.on('mouseup', function(event) {
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
								clickTimeout = setTimeout(function() {
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
											.map(function(p) { return p.name + ': ' + p.type; })
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

				svg.on('mouseleave', function() {
					isDragging2D = false;
					draggedNode2D = null;
					node.style('cursor', 'pointer');
				});

				// Click on background to close popup
				svg.on('click', function(event) {
					if (event.target.tagName === 'svg') {
						d3.select('#properties-panel').remove();
					}
				});

				function updateLinks() {
					link
						.attr('x1', function(d) { return d.source.x; })
						.attr('y1', function(d) { return d.source.y; })
						.attr('x2', function(d) { return d.target.x; })
						.attr('y2', function(d) { return d.target.y; });
				}

				// Update positions on tick (only during initial simulation)
				simulation.on('tick', function() {
					// Only update nodes that aren't being dragged
					node.filter(function(d) { return d !== draggedNode2D; })
						.attr('transform', function(d) {
							return 'translate(' + d.x + ',' + d.y + ')';
						});

					updateLinks();
				});

				function handleNodeHover(event, d) {
					const tooltip = d3.select('#tooltip');
					const props = (d.properties || [])
						.map(function(p) { return p.name + ': ' + p.type; })
						.join('<br>');

					tooltip
						.classed('visible', true)
						.html('<strong>' + d.name + '</strong><br>' +
							'<em>depth: ' + d.depth + '</em><br>' +
							(props ? '<hr>' + props : ''))
						.style('left', (event.pageX + 10) + 'px')
						.style('top', (event.pageY - 10) + 'px');
				}

				function handleNodeLeave() {
					d3.select('#tooltip').classed('visible', false);
				}

				// Update status
				const status = document.getElementById('status');
				if (status) {
					status.textContent = data.nodes.length + ' types | ' +
						data.links.length + ' relationships';
				}

				console.log('[Mnemonica] 2D Graph rendered successfully');
			}

			// Show properties panel for a node
			function showPropertiesPanel(d) {
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
				d.properties.forEach(function(prop) {
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
					.on('click', function() {
						d3.select('#properties-panel').remove();
					});

				// Also close when clicking outside
				setTimeout(function() {
					d3.select('body').on('click.properties-panel', function(e) {
						if (!e.target.closest('#properties-panel')) {
							d3.select('#properties-panel').remove();
							d3.select('body').on('click.properties-panel', null);
						}
					});
				}, 100);
			}

			function render3DGraph(data) {
				console.log('[Mnemonica] Rendering 3D graph with', data.nodes.length, 'nodes and', data.links.length, 'links');

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
				renderer3D = new Graph3DRenderer(container);
				renderer3D.setOnNodeClick(function(node) {
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
				const resizeHandler = function() {
					if (!is3D || !renderer3D) return;
					const newWidth = container.clientWidth || 800;
					const newHeight = container.clientHeight || 600;
					renderer3D.resize(newWidth, newHeight);
				};
				window.addEventListener('resize', resizeHandler);

				// Update status
				const status = document.getElementById('status');
				if (status) {
					status.textContent = data.nodes.length + ' types | ' +
						data.links.length + ' relationships (3D)';
				}

				console.log('[Mnemonica] 3D Graph rendered successfully');
			}

			// 3D Renderer Class (inline implementation)
			class Graph3DRenderer {
				constructor(container) {
					this.container = container;
					this.nodeMeshes = new Map();
					this.linkLines = [];
					this.animationId = null;
					this.onNodeClick = null;
					this.mouse = { x: 0, y: 0 };
					this.isDragging = false;
					this.previousMousePosition = { x: 0, y: 0 };
					this.cameraRotation = { x: 0, y: 0 };
					this.zoom = 500;

					this.init();
				}

				init() {
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
					this.zoom = 600;
					this.panOffset = { x: 0, y: 0 };
					this.isPanning = false;
					this.draggedNode = null;
					this.camera.position.set(0, 0, this.zoom);
					this.camera.lookAt(0, 0, 0);

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

				handleClick(event) {
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

				handleNodeClick3D(node, event) {
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

				renderGraph(data, d3) {
					this.clear();

					const colors = [
						0x4e79a7, 0xf28e2c, 0xe15759, 0x76b7b2, 0x59a14f,
						0xedc949, 0xaf7aa1, 0xff9da7, 0x9c755f, 0xbab0ab
					];

					// Initialize node positions in 3D (closer together)
					data.nodes.forEach(node => {
						if (!node.x) node.x = (Math.random() - 0.5) * 100;
						if (!node.y) node.y = (Math.random() - 0.5) * 100;
						if (!node.z) node.z = node.depth * 30 - 60;
					});

					// Create node spheres
					const sphereGeometry = new THREE.SphereGeometry(8, 32, 32);

					data.nodes.forEach(node => {
						const color = colors[node.depth % colors.length];
						const material = new THREE.MeshPhongMaterial({
							color: color,
							shininess: 100,
							specular: 0x111111
						});

						// Root nodes get a glow effect
						if (node.isRoot) {
							material.emissive = new THREE.Color(0x8B0000);
							material.emissiveIntensity = 0.3;
						}

						const sphere = new THREE.Mesh(sphereGeometry, material);
						sphere.position.set(node.x, node.y, node.z);
						sphere.userData = { node };

						// Add label sprite
						this.addLabel(sphere, node.name);

						this.scene.add(sphere);
						this.nodeMeshes.set(node.id, sphere);
					});

					// Create link lines
					const lineMaterial = new THREE.LineBasicMaterial({
						color: 0x888888,
						transparent: true,
						opacity: 0.6
					});

					data.links.forEach(link => {
						const geometry = new THREE.BufferGeometry();
						const positions = new Float32Array([0, 0, 0, 0, 0, 0]);
						geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
						const line = new THREE.Line(geometry, lineMaterial);
						this.scene.add(line);
						this.linkLines.push({ line, link });
					});

					// Setup 3D force simulation using d3-force-3d concepts
					this.setupForceSimulation(data);
				}

				setupForceSimulation(data) {
					// Initialize Z positions for 3D spread before starting simulation
					data.nodes.forEach(node => {
						if (!node.z) node.z = node.depth * 30 - 60;
					});

					// Use d3's force simulation but extend to 3D with closer distances
					this.simulation = d3.forceSimulation(data.nodes)
						.force('charge', d3.forceManyBody().strength(-100))
						.force('link', d3.forceLink(data.links)
							.id(d => d.id)
							.distance(30))
						.force('collision', d3.forceCollide().radius(12))
						.force('center', d3.forceCenter(0, 0))
						.on('tick', () => this.updatePositions(data));

					// Stop simulation after initial layout (2 seconds)
					setTimeout(() => {
						if (this.simulation) {
							this.simulation.stop();
						}
					}, 2000);
				}

				updatePositions(data) {
					// Update node positions
					data.nodes.forEach(node => {
						const mesh = this.nodeMeshes.get(node.id);
						if (mesh) {
							mesh.position.set(node.x || 0, node.y || 0, node.z || 0);
						}
					});

					// Update link positions
					this.linkLines.forEach(({ line, link }) => {
						const positions = line.geometry.attributes.position.array;
						const source = typeof link.source === 'object' ? link.source : data.nodes.find(n => n.id === link.source);
						const target = typeof link.target === 'object' ? link.target : data.nodes.find(n => n.id === link.target);
						if (source && target) {
							positions[0] = source.x || 0;
							positions[1] = source.y || 0;
							positions[2] = source.z || 0;
							positions[3] = target.x || 0;
							positions[4] = target.y || 0;
							positions[5] = target.z || 0;
							line.geometry.attributes.position.needsUpdate = true;
						}
					});
				}

				updateLinkPositions() {
					// Update link positions to follow nodes during drag
					this.linkLines.forEach(({ line, link }) => {
						const positions = line.geometry.attributes.position.array;
						const source = typeof link.source === 'object' ? link.source : null;
						const target = typeof link.target === 'object' ? link.target : null;
						if (source && target) {
							positions[0] = source.x || 0;
							positions[1] = source.y || 0;
							positions[2] = source.z || 0;
							positions[3] = target.x || 0;
							positions[4] = target.y || 0;
							positions[5] = target.z || 0;
							line.geometry.attributes.position.needsUpdate = true;
						}
					});
				}

				addLabel(mesh, text) {
					const canvas = document.createElement('canvas');
					const ctx = canvas.getContext('2d');
					canvas.width = 1024;
					canvas.height = 256;

					// Clear with transparent background
					ctx.clearRect(0, 0, canvas.width, canvas.height);

					// Draw text with outline for better visibility (larger font)
					ctx.font = 'bold 64px Arial, sans-serif';
					ctx.textAlign = 'center';
					ctx.textBaseline = 'middle';

					// Draw outline
					ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
					ctx.lineWidth = 12;
					ctx.strokeText(text, 512, 128);

					// Draw text
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
					if (this.simulation) {
						this.simulation.alpha(1).restart();
					}
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
						this.scene.remove(mesh);
						mesh.geometry.dispose();
						mesh.material.dispose();
					});
					this.nodeMeshes.clear();

					this.linkLines.forEach(({ line }) => {
						this.scene.remove(line);
						line.geometry.dispose();
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
						this.container.removeChild(this.renderer.domElement);
					}
				}
			}
		})();
	</script>
</body>
</html>`;
	}

	public dispose () {
		GraphPanel.currentPanel = undefined;

		this.panel.dispose();

		while (this.disposables.length) {
			const x = this.disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}
}
