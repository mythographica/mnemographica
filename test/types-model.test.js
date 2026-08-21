'use strict';

const assert = require('assert');

// Mock the LoggerService before requiring models (it pulls in 'vscode',
// which only exists inside the extension host)
const mockLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	initialize: () => {},
	show: () => {}
};
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
	if (id.endsWith('LoggerService') || id.includes('/services/LoggerService')) {
		return { getLogger: () => mockLogger };
	}
	return originalRequire.apply(this, arguments);
};

const { Types } = require('../out/src/models/Types');

// Test suite for the Types model.
// Types is a pure data container (model layer): file loading lives in
// Registry (controller), covered by registry-loading.test.js.
async function runTests () {
	console.log('=== Testing Types Model (pure data container) ===\n');

	// Test 1: construct empty
	console.log('Test 1: Types instance constructs empty');
	const types = new Types();
	assert.ok(types, 'Types instance should be created');
	assert.strictEqual(types.size, 0, 'Should start empty');
	console.log('  ✓ constructed, size 0\n');

	// Test 2: set/get/has with nested entries
	console.log('Test 2: set/get/has');
	// entries are subtypes: construct them from the parent instance
	// (same pattern as Registry: `new this.typesInstance.TypeEntry(...)`)
	const scene2d = new types.TypeEntry({
		name: 'Scene2D',
		fullPath: '/types.ts',
		properties: new Map(),
		lineNumber: 150
	});
	const graphNode = new types.TypeEntry({
		name: 'Scene2D_GraphNode2D',
		fullPath: '/types.ts',
		parent: 'Scene2D',
		properties: new Map(),
		lineNumber: 160
	});
	const tooltip = new types.TypeEntry({
		name: 'Scene2D_GraphNode2D_Tooltip2D',
		fullPath: '/types.ts',
		parent: 'Scene2D_GraphNode2D',
		properties: new Map(),
		lineNumber: 170
	});
	types.set('Scene2D', scene2d);
	types.set('Scene2D_GraphNode2D', graphNode);
	types.set('Scene2D_GraphNode2D_Tooltip2D', tooltip);
	assert.strictEqual(types.size, 3, 'Should have 3 entries');
	assert.strictEqual(types.has('Scene2D'), true, 'Should have Scene2D');
	assert.strictEqual(types.has('NonExistent'), false, 'Should not have NonExistent');
	const fetched = types.get('Scene2D_GraphNode2D_Tooltip2D');
	assert.ok(fetched, 'Entry should exist');
	assert.strictEqual(fetched.parent, 'Scene2D_GraphNode2D', 'Deep nested parent should match');
	console.log('  ✓ set/get/has with deep nesting\n');

	// Test 3: keys/values/entries
	console.log('Test 3: keys/values/entries');
	const keys = Array.from(types.keys());
	assert.strictEqual(keys.length, 3, 'Should have 3 keys');
	assert.ok(keys.includes('Scene2D'), 'Keys should include Scene2D');
	const values = Array.from(types.values());
	assert.strictEqual(values.length, 3, 'Should have 3 values');
	const entries = Array.from(types.entries());
	assert.strictEqual(entries.length, 3, 'Should have 3 entries');
	console.log('  ✓ keys/values/entries\n');

	// Test 4: getLineForType uses the lineNumber stored during parsing
	console.log('Test 4: getLineForType');
	const line = types.getLineForType('Scene2D');
	assert.strictEqual(line, 150, 'Should return stored lineNumber');
	const missing = types.getLineForType('NonExistent');
	assert.strictEqual(missing, undefined, 'Unknown type should give undefined');
	console.log(`  ✓ Scene2D at line ${line}\n`);

	// Test 5: no self-referential entries in stored data
	console.log('Test 5: no self-referential entries');
	let selfRefCount = 0;
	for (const name of types.keys()) {
		const entry = types.get(name);
		if (entry?.parent === name) {
			selfRefCount++;
			console.log(`  ✗ ${name} is self-referential!`);
		}
	}
	assert.strictEqual(selfRefCount, 0, `Found ${selfRefCount} self-referential types`);
	console.log('  ✓ No self-referential entries\n');

	// Test 6: clear
	console.log('Test 6: clear');
	types.clear();
	assert.strictEqual(types.size, 0, 'Should be empty after clear');
	console.log('  ✓ cleared\n');

	console.log('=== All Tests Passed ===');
}

runTests().catch(err => {
	console.error('Test failed:', err);
	process.exit(1);
});
