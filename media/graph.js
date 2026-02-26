// Mnemonica Graphica - D3 Graph Visualization
(function() {
	'use strict';

	// Wait for VS Code API
	const vscode = acquireVsCodeApi();

	// State
	let simulation = null;
	let svg = null;
	let g = null;
	let zoom = null;
	let currentData = null;

	// Initialize when DOM is ready
	document.addEventListener('DOMContentLoaded', function() {
		console.log('[Mnemonica Graphica] DOM ready, requesting data...');
		vscode.postMessage({ command: 'ready' });
	});

	// Handle messages from extension
	window.addEventListener('message', function(event) {
		const message = event.data;
		console.log('[Mnemonica Graphica] Received message:', message.command);

		switch (message.command) {
		case 'updateGraph':
			renderGraph(message.data);
			break;
		}
	});

	function renderGraph(data) {
		console.log('[Mnemonica Graphica] Rendering graph with', 
			data.nodes.length, 'nodes and', data.links.length, 'links');

		currentData = data;

		const container = document.getElementById('graph');
		if (!container) {
			console.error('[Mnemonica Graphica] Graph container not found!');
			return;
		}

		// Clear existing
		container.innerHTML = '';

		const width = container.clientWidth;
		const height = container.clientHeight;

		// Create SVG
		svg = d3.select('#graph')
			.append('svg')
			.attr('width', width)
			.attr('height', height)
			.attr('viewBox', [0, 0, width, height]);

		// Add zoom behavior
		g = svg.append('g');

		zoom = d3.zoom()
			.scaleExtent([0.1, 4])
			.on('zoom', function(event) {
				g.attr('transform', event.transform);
			});

		svg.call(zoom);

		// Color scale by depth
		const colorScale = d3.scaleOrdinal()
			.domain([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
			.range(d3.schemeTableau10 || [
				'#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f',
				'#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab'
			]);

		// Force simulation
		simulation = d3.forceSimulation(data.nodes)
			.force('link', d3.forceLink(data.links)
				.id(function(d) { return d.id; })
				.distance(100))
			.force('charge', d3.forceManyBody()
				.strength(-400))
			.force('center', d3.forceCenter(width / 2, height / 2))
			.force('collision', d3.forceCollide()
				.radius(function(d) { return 15 + d.properties.length * 2; }));

		// Draw links
		const link = g.append('g')
			.attr('class', 'links')
			.selectAll('line')
			.data(data.links)
			.enter().append('line')
			.attr('class', 'link');

		// Draw nodes
		const node = g.append('g')
			.attr('class', 'nodes')
			.selectAll('g')
			.data(data.nodes)
			.enter().append('g')
			.attr('class', 'node')
			.call(d3.drag()
				.on('start', dragstarted)
				.on('drag', dragged)
				.on('end', dragended));

		// Node circles
		node.append('circle')
			.attr('r', function(d) { return 10 + d.properties.length * 2; })
			.attr('fill', function(d) { return colorScale(d.depth % 10); })
			.on('click', handleNodeClick)
			.on('mouseover', handleNodeHover)
			.on('mouseout', handleNodeLeave);

		// Labels
		node.append('text')
			.attr('dx', 15)
			.attr('dy', 4)
			.text(function(d) { return d.name; });

		// Update positions on tick
		simulation.on('tick', function() {
			link
				.attr('x1', function(d) { return d.source.x; })
				.attr('y1', function(d) { return d.source.y; })
				.attr('x2', function(d) { return d.target.x; })
				.attr('y2', function(d) { return d.target.y; });

			node.attr('transform', function(d) {
				return 'translate(' + d.x + ',' + d.y + ')';
			});
		});

		// Drag functions
		function dragstarted(event, d) {
			if (!event.active) simulation.alphaTarget(0.3).restart();
			d.fx = d.x;
			d.fy = d.y;
		}

		function dragged(event, d) {
			d.fx = event.x;
			d.fy = event.y;
		}

		function dragended(event, d) {
			if (!event.active) simulation.alphaTarget(0);
			d.fx = null;
			d.fy = null;
		}

		// Click handler - Go to definition
		function handleNodeClick(event, d) {
			event.stopPropagation();
			console.log('[Mnemonica Graphica] Node clicked:', d.name);
			if (d.location) {
				vscode.postMessage({
					command: 'goToDefinition',
					data: d.location
				});
			}
		}

		// Hover handler - Show tooltip
		function handleNodeHover(event, d) {
			var tooltip = d3.select('#tooltip');

			var props = d.properties
				.map(function(p) { return p.name + ': ' + p.type; })
				.join('<br>');

			tooltip
				.classed('visible', true)
				.html('<strong>' + d.name + '</strong><br>' +
					'<em>depth: ' + d.depth + '</em><br>' +
					'<em>properties: ' + d.properties.length + '</em><br>' +
					(props ? '<hr>' + props : ''))
				.style('left', (event.pageX + 10) + 'px')
				.style('top', (event.pageY - 10) + 'px');
		}

		function handleNodeLeave() {
			d3.select('#tooltip').classed('visible', false);
		}

		// Update status
		var status = document.getElementById('status');
		if (status) {
			status.textContent = data.nodes.length + ' types | ' + 
				data.links.length + ' relationships';
		}

		console.log('[Mnemonica Graphica] Graph rendered successfully');
	}

	// Control buttons
	document.getElementById('zoom-in').addEventListener('click', function() {
		svg.transition().call(zoom.scaleBy, 1.3);
	});

	document.getElementById('zoom-out').addEventListener('click', function() {
		svg.transition().call(zoom.scaleBy, 0.7);
	});

	document.getElementById('reset').addEventListener('click', function() {
		svg.transition().call(zoom.transform, d3.zoomIdentity);
		if (simulation) {
			simulation.alpha(1).restart();
		}
	});
})();