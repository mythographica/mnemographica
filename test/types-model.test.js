'use strict';

const assert = require('assert');
const path = require('path');
const { Types } = require('../out/src/models/Types');

// Test suite for Types model parsing
async function runTests () {
	console.log('=== Testing Types Model Parsing ===\n');
	
	const types = new Types();
	const typesPath = path.join(__dirname, '../.tactica/types.ts');
	
	// Test 1: Load from file
	console.log('Test 1: Load types from file');
	await types.loadFromFile(typesPath);
	assert.strictEqual(types.size > 0, true, 'Should load at least one type');
	console.log(`  ✓ Loaded ${types.size} types\n`);
	
	// Test 2: Check root types exist
	console.log('Test 2: Check root types exist');
	const rootTypes = ['Definition', 'LoggerTab', 'Main', 'Registry', 'Scene2D', 'Scene3D', 'Trie', 'Types', 'Usages'];
	for (const typeName of rootTypes) {
		assert.strictEqual(types.has(typeName), true, `Should have ${typeName}`);
		const entry = types.get(typeName);
		assert.ok(entry, `Entry for ${typeName} should exist`);
		console.log(`  ✓ ${typeName} (parent: ${entry?.parent || 'none'})`);
	}
	console.log('');
	
	// Test 3: Check nested types (Scene2D hierarchy)
	console.log('Test 3: Check Scene2D nested types');
	const scene2dNested = ['Scene2D_Camera2D', 'Scene2D_GraphNode2D'];
	for (const typeName of scene2dNested) {
		assert.strictEqual(types.has(typeName), true, `Should have ${typeName}`);
		const entry = types.get(typeName);
		assert.strictEqual(entry?.parent, 'Scene2D', `${typeName} should have parent Scene2D`);
		console.log(`  ✓ ${typeName} (parent: ${entry?.parent})`);
	}
	console.log('');
	
	// Test 4: Check deep nested types (GraphNode2D children)
	console.log('Test 4: Check GraphNode2D deep nested types');
	const graphNode2dNested = ['Scene2D_GraphNode2D_Link2D', 'Scene2D_GraphNode2D_Tooltip2D'];
	for (const typeName of graphNode2dNested) {
		assert.strictEqual(types.has(typeName), true, `Should have ${typeName}`);
		const entry = types.get(typeName);
		assert.strictEqual(entry?.parent, 'Scene2D_GraphNode2D', `${typeName} should have parent Scene2D_GraphNode2D`);
		console.log(`  ✓ ${typeName} (parent: ${entry?.parent})`);
	}
	console.log('');
	
	// Test 5: Check getLineForType
	console.log('Test 5: Check getLineForType');
	const line = types.getLineForType('Scene2D');
	assert.ok(typeof line === 'number', 'getLineForType should return a number');
	assert.ok(line >= 0, 'Line number should be >= 0');
	console.log(`  ✓ Scene2D is at line ${line}\n`);
	
	// Test 6: Verify no self-recursive entries
	console.log('Test 6: Verify no self-recursive entries');
	let selfRefCount = 0;
	for (const name of types.keys()) {
		const entry = types.get(name);
		if (entry?.parent === name) {
			selfRefCount++;
			console.log(`  ✗ ${name} is self-referential!`);
		}
	}
	assert.strictEqual(selfRefCount, 0, `Found ${selfRefCount} self-referential types`);
	console.log('  ✓ No self-recursive entries found\n');
	
	console.log('=== All Tests Passed ===');
}

runTests().catch(err => {
	console.error('Test failed:', err);
	process.exit(1);
});
