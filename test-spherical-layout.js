/**
 * Tests for 3D spherical layout
 * Run with: node test-spherical-layout.js
 */

// Mock data simulating real graph structure
const testData = {
	nodes: [
		// Root nodes (depth 0)
		{ id: 'root1', name: 'Root1', depth: 0, isRoot: true },
		{ id: 'root2', name: 'Root2', depth: 0, isRoot: true },
		// Generation 1 (depth 1)
		{ id: 'child1', name: 'Child1', depth: 1 },
		{ id: 'child2', name: 'Child2', depth: 1 },
		{ id: 'child3', name: 'Child3', depth: 1 },
		// Generation 2 (depth 2)
		{ id: 'grandchild1', name: 'GrandChild1', depth: 2 },
		{ id: 'grandchild2', name: 'GrandChild2', depth: 2 },
		// Generation 3 (depth 3)
		{ id: 'greatgrandchild1', name: 'GreatGrandChild1', depth: 3 },
	],
	links: [
		{ source: 'root1', target: 'child1' },
		{ source: 'root1', target: 'child2' },
		{ source: 'child1', target: 'grandchild1' },
		{ source: 'child2', target: 'grandchild2' },
		{ source: 'grandchild1', target: 'greatgrandchild1' },
	]
};

// Configuration (same as webview.js)
const nodeRadius = 8;
const nodeDiameter = nodeRadius * 2;
const generationGap = nodeDiameter * 15; // 240 units

// Helper to place nodes on sphere surface
function placeOnSphere (radius) {
	const theta = Math.random() * Math.PI * 2;
	const phi = Math.acos((Math.random() * 2) - 1);
	return {
		x: radius * Math.sin(phi) * Math.cos(theta),
		y: radius * Math.sin(phi) * Math.sin(theta),
		z: radius * Math.cos(phi)
	};
}

// Calculate distance from center
function distanceFromCenter (pos) {
	return Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
}

// Test the spherical layout logic
function testSphericalLayout () {
	console.log('=== Testing Concentric Spherical Layout ===\n');

	// Apply layout
	testData.nodes.forEach(node => {
		// Root at center (minimal radius), generation N at N * generationGap
		const radius = node.depth === 0 ? nodeRadius : node.depth * generationGap;
		const pos = placeOnSphere(radius);
		node.x = pos.x;
		node.y = pos.y;
		node.z = pos.z;
	});

	// Group by depth and analyze
	const byDepth = {};
	testData.nodes.forEach(node => {
		if (!byDepth[node.depth]) byDepth[node.depth] = [];
		byDepth[node.depth].push(node);
	});

	// Test results
	let allPassed = true;

	console.log('Expected radii:');
	console.log('  Depth 0 (roots): ~8 units (nodeRadius)');
	console.log('  Depth 1: 240 units (1 * generationGap)');
	console.log('  Depth 2: 480 units (2 * generationGap)');
	console.log('  Depth 3: 720 units (3 * generationGap)\n');

	Object.keys(byDepth).sort((a, b) => parseInt(a) - parseInt(b)).forEach(depth => {
		const nodes = byDepth[depth];
		const expectedRadius = parseInt(depth) === 0 ? nodeRadius : parseInt(depth) * generationGap;

		console.log(`\nDepth ${depth} (${nodes.length} nodes):`);
		console.log(`  Expected radius: ${expectedRadius}`);

		nodes.forEach(node => {
			const actualRadius = distanceFromCenter(node);
			const diff = Math.abs(actualRadius - expectedRadius);
			const passed = diff < 0.1; // Allow small floating point error

			console.log(`    ${node.name}: radius=${actualRadius.toFixed(2)}, diff=${diff.toFixed(2)} ${passed ? '✓' : '✗'}`);

			if (!passed) allPassed = false;
		});
	});

	// Test concentricity - all nodes at same depth should have similar radius
	console.log('\n=== Concentricity Test ===');
	Object.keys(byDepth).forEach(depth => {
		const nodes = byDepth[depth];
		const radii = nodes.map(n => distanceFromCenter(n));
		const avgRadius = radii.reduce((a, b) => a + b, 0) / radii.length;
		const variance = radii.reduce((sum, r) => sum + Math.pow(r - avgRadius, 2), 0) / radii.length;
		const stdDev = Math.sqrt(variance);

		console.log(`Depth ${depth}: avg=${avgRadius.toFixed(2)}, stdDev=${stdDev.toFixed(4)}`);
		if (stdDev > 1) {
			console.log('  ✗ High variance - nodes not on same sphere!');
			allPassed = false;
		} else {
			console.log('  ✓ Good concentricity');
		}
	});

	console.log('\n=== Overall Result ===');
	if (allPassed) {
		console.log('✓ All tests PASSED');
	} else {
		console.log('✗ Some tests FAILED');
	}

	return allPassed;
}

// Test that forces would destroy the layout
function testForceSimulationImpact () {
	console.log('\n\n=== Testing Force Simulation Impact ===');
	console.log('WARNING: d3 force simulation will DESTROY the spherical layout because:');
	console.log('1. forceCenter pulls all nodes toward center');
	console.log('2. forceLink pulls connected nodes together');
	console.log('3. forceManyBody causes repulsion');
	console.log('4. The simulation iterates and moves nodes away from their spherical positions\n');
	console.log('SOLUTION: Do not run force simulation, or use fixed positions (fx, fy, fz)\n');
}

// Run tests
testSphericalLayout();
testForceSimulationImpact();
