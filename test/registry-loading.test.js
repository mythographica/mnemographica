'use strict';

const assert = require('assert');
const path = require('path');
const { define } = require('mnemonica');
const topologicaLoader = require('@mnemonica/topologica');

// We need a mock logger because LoggerService tries to use vscode
const mockLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	initialize: () => {},
	show: () => {}
};

// Mock the LoggerService before requiring Registry
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
	if (id.endsWith('LoggerService') || id.includes('/services/LoggerService')) {
		return { getLogger: () => mockLogger };
	}
	return originalRequire.apply(this, arguments);
};

// Load models via topologica (same as extension bootstrap)
const modelsPath = path.join(__dirname, '..', 'out', 'src', 'models');
console.log('[Test Setup] Loading models from:', modelsPath);

const result = topologicaLoader.default(modelsPath, define);
if (result.logs) {
	result.logs.forEach(log => console.log('[Topologica]', ...log));
}

const typeCount = result.topology ? Object.keys(result.topology).length : 0;
console.log(`[Test Setup] Loaded ${typeCount} root types`);

// Now require Registry (after topologica loaded models)
const { Registry, registry } = require('../out/src/models/Registry');

// Test fixture path
const fixturesPath = path.join(__dirname, 'fixtures');

async function runTests() {
	console.log('\n=== Testing Registry.loadDefinitions and Registry.loadTypes ===\n');

	// Test 1: Registry instance can be created
	console.log('Test 1: Create Registry instance');
	const testRegistry = new Registry();
	assert.ok(testRegistry, 'Registry instance should be created');
	console.log('  ✓ Registry created\n');

	// Test 2: Load from workspace
	console.log('Test 2: Load from workspace');
	await testRegistry.loadFromWorkspace(fixturesPath);
	console.log('  ✓ Workspace loaded\n');

	// Test 3: Definitions loaded
	console.log('Test 3: Definitions loaded');
	const definitions = testRegistry.getDefinitions();
	assert.ok(definitions, 'Definitions should be loaded');
	assert.strictEqual(definitions.size, 3, 'Should have 3 definitions');
	console.log(`  ✓ Definitions loaded: ${definitions.size} entries\n`);

	// Test 4: Definitions methods work
	console.log('Test 4: Definitions methods work');
	assert.strictEqual(definitions.has('UserEntity'), true, 'Should have UserEntity');
	assert.strictEqual(definitions.has('AdminEntity'), true, 'Should have AdminEntity');
	assert.strictEqual(definitions.has('OrderEntity'), true, 'Should have OrderEntity');
	assert.strictEqual(definitions.has('NonExistent'), false, 'Should not have NonExistent');

	const userDef = definitions.get('UserEntity');
	assert.ok(userDef, 'UserEntity definition should exist');
	assert.strictEqual(userDef.name, 'UserEntity', 'Name should match');
	assert.strictEqual(userDef.kind, 'entity', 'Kind should be entity');
	assert.strictEqual(userDef.parent, null, 'Parent should be null');
	assert.strictEqual(userDef.strictChain, true, 'strictChain should be true');
	console.log('  ✓ Definitions methods work correctly\n');

	// Test 5: Definitions keys/entries work
	console.log('Test 5: Definitions keys/entries work');
	const defKeys = Array.from(definitions.keys());
	assert.strictEqual(defKeys.length, 3, 'Should have 3 keys');
	assert.ok(defKeys.includes('UserEntity'), 'Should include UserEntity');

	const defEntries = Array.from(definitions.entries());
	assert.strictEqual(defEntries.length, 3, 'Should have 3 entries');
	console.log('  ✓ Definitions keys/entries work\n');

	// Test 6: Types loaded
	console.log('Test 6: Types loaded');
	const types = testRegistry.getTypes();
	assert.ok(types, 'Types should be loaded');
	assert.strictEqual(types.size, 4, 'Should have 4 types');
	console.log(`  ✓ Types loaded: ${types.size} entries\n`);

	// Test 7: Types methods work
	console.log('Test 7: Types methods work');
	assert.strictEqual(types.has('UserEntity'), true, 'Should have UserEntity');
	assert.strictEqual(types.has('UserEntity.AdminEntity'), true, 'Should have UserEntity.AdminEntity');
	assert.strictEqual(types.has('OrderEntity'), true, 'Should have OrderEntity');
	assert.strictEqual(types.has('OrderEntity.OrderItem'), true, 'Should have OrderEntity.OrderItem');

	const userType = types.get('UserEntity');
	assert.ok(userType, 'UserEntity type should exist');
	assert.strictEqual(userType.name, 'UserEntity', 'Name should match');
	assert.strictEqual(userType.parent, undefined, 'Parent should be undefined for root type');
	assert.strictEqual(typeof userType.lineNumber, 'number', 'lineNumber should be a number');
	assert.ok(userType.lineNumber >= 0, 'lineNumber should be >= 0');

	// Properties are parsed from the generated types.ts bodies (audit B2)
	assert.ok(userType.properties instanceof Map, 'properties should be a Map');
	assert.strictEqual(userType.properties.size, 3, 'UserEntity should have 3 properties');
	assert.strictEqual(userType.properties.get('id').type, 'string', 'id should be a string');

	const adminType = types.get('UserEntity.AdminEntity');
	assert.ok(adminType, 'UserEntity.AdminEntity type should exist');
	assert.strictEqual(adminType.parent, 'UserEntity', 'AdminEntity parent should be UserEntity');

	const orderItemType = types.get('OrderEntity.OrderItem');
	assert.ok(orderItemType, 'OrderEntity.OrderItem type should exist');
	assert.strictEqual(orderItemType.parent, 'OrderEntity', 'OrderItem parent should be OrderEntity');
	console.log('  ✓ Types methods work correctly\n');

	// Test 8: Types keys/entries work
	console.log('Test 8: Types keys/entries work');
	const typeKeys = Array.from(types.keys());
	assert.strictEqual(typeKeys.length, 4, 'Should have 4 type keys');

	const typeEntries = Array.from(types.entries());
	assert.strictEqual(typeEntries.length, 4, 'Should have 4 type entries');
	console.log('  ✓ Types keys/entries work\n');

	// Test 9: getLineForType works
	console.log('Test 9: getLineForType works');
	const userLine = types.getLineForType('UserEntity');
	assert.ok(typeof userLine === 'number', 'getLineForType should return a number');
	assert.ok(userLine >= 0, 'Line should be >= 0');
	console.log(`  ✓ UserEntity is at line ${userLine}\n`);

	// Test 10: No self-referential types
	console.log('Test 10: No self-referential types');
	let selfRefCount = 0;
	for (const name of types.keys()) {
		const entry = types.get(name);
		if (entry?.parent === name) {
			selfRefCount++;
			console.log(`  ✗ ${name} is self-referential!`);
		}
	}
	assert.strictEqual(selfRefCount, 0, `Found ${selfRefCount} self-referential types`);
	console.log('  ✓ No self-referential types found\n');

	// Test 11: Usages loaded
	console.log('Test 11: Usages loaded');
	const usages = testRegistry.getUsages();
	assert.ok(usages, 'Usages should be loaded');
	assert.strictEqual(usages.size, 3, 'Should have 3 usage entries');
	console.log(`  ✓ Usages loaded: ${usages.size} entries\n`);

	// Test 12: Usages methods work
	console.log('Test 12: Usages methods work');
	const userUsages = usages.get('UserEntity');
	assert.ok(userUsages, 'UserEntity usages should exist');
	assert.strictEqual(userUsages.length, 2, 'UserEntity should have 2 usages');
	assert.strictEqual(userUsages[0].kind, 'instantiation', 'First usage should be instantiation');
	console.log('  ✓ Usages methods work correctly\n');

	// Test 13: EDS loaded
	console.log('Test 13: EDS loaded');
	const eds = testRegistry.getEDS();
	assert.ok(eds, 'EDS should be loaded');
	assert.strictEqual(eds.size, 3, 'Should have 3 EDS entries');
	console.log(`  ✓ EDS loaded: ${eds.size} entries\n`);

	// Test 14: EDS methods work
	console.log('Test 14: EDS methods work');
	assert.strictEqual(eds.has('UserEntity'), true, 'Should have UserEntity EDS');
	assert.strictEqual(eds.has('AdminEntity'), true, 'Should have AdminEntity EDS');
	assert.strictEqual(eds.has('OrderEntity'), true, 'Should have OrderEntity EDS');
	assert.strictEqual(eds.has('NonExistent'), false, 'Should not have NonExistent');

	const userEDS = eds.get('UserEntity');
	assert.ok(userEDS, 'UserEntity EDS should exist');
	assert.strictEqual(userEDS.length, 2, 'UserEntity should have 2 EDS entries');
	assert.strictEqual(userEDS[0].kind, 'wrap', 'First EDS should be wrap');
	assert.strictEqual(userEDS[0].targetType, 'UserEntity', 'targetType should match');
	assert.ok(userEDS[0].location, 'EDS entry should have location');
	console.log('  ✓ EDS methods work correctly\n');

	// Test 15: EDS keys/entries work
	console.log('Test 15: EDS keys/entries work');
	const edsKeys = Array.from(eds.keys());
	assert.strictEqual(edsKeys.length, 3, 'Should have 3 EDS keys');

	const edsEntries = Array.from(eds.entries());
	assert.strictEqual(edsEntries.length, 3, 'Should have 3 EDS entries');
	console.log('  ✓ EDS keys/entries work\n');

	// Test 16: clear() must not throw after a successful load
	// (regression: getter-only instance properties used to make clear()
	// throw a TypeError, which killed every refresh — audit B1)
	console.log('Test 16: clear() works after load');
	testRegistry.clear();
	assert.strictEqual(testRegistry.getTypes(), undefined, 'Types should be cleared');
	console.log('  ✓ clear() succeeded\n');

	// Test 17: reload after clear — the actual refresh path
	console.log('Test 17: reload after clear');
	await testRegistry.loadFromWorkspace(fixturesPath);
	const reloadedTypes = testRegistry.getTypes();
	assert.ok(reloadedTypes, 'Types should reload after clear');
	assert.strictEqual(reloadedTypes.size, 4, 'Should have 4 types after reload');
	console.log('  ✓ Reload after clear works\n');

	console.log('=== All Tests Passed ===');
}

runTests().catch(err => {
	console.error('Test failed:', err);
	process.exit(1);
});
