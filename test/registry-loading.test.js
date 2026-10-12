'use strict';

const assert = require('assert');
const path = require('path');
const { define } = require('mnemonica');
const topologicaLoader = require('@mnemonica/topologica');

// We need a mock logger because LoggerService tries to use vscode
const loggedWarnings = [];
const mockLogger = {
	info: () => {},
	warn: (...args) => { loggedWarnings.push(args.join(' ')); },
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
const { Registry } = require('../out/src/models/Registry');

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

	// Test 18: Control loaded (control.json: callers graph + flat points list)
	console.log('Test 18: Control loaded');
	const control = testRegistry.getControl();
	assert.ok(control, 'Control should be loaded');
	assert.strictEqual(control.size, 3, 'Should have 3 control points');
	const points = control.all();
	assert.strictEqual(points[0].kind, 'pipe', 'First point should be a pipe');
	assert.strictEqual(points[0].className, 'ValidationPipe', 'className should match');
	assert.strictEqual(points[0].scope, 'method:UserController.createUser', 'scope should match');
	assert.deepStrictEqual(points[1].targets, [], 'global interceptor has no targets');
	console.log(`  ✓ Control loaded: ${control.size} points\n`);

	// Test 19: clear() also drops the control model (the field must reset,
	// or a refresh keeps stale points from the previous workspace)
	console.log('Test 19: clear() resets control');
	testRegistry.clear();
	assert.strictEqual(testRegistry.getControl(), undefined, 'Control should be cleared');
	console.log('  ✓ clear() resets control\n');

	// Test 20: control.json — the callers graph loads
	// (fixtures-v2 mirrors real tactica 1.2 output from tactica-nestjs)
	console.log('Test 20: callers (control.json) loads');
	const fixturesV2Path = path.join(__dirname, 'fixtures-v2');
	const registryV2 = new Registry();
	await registryV2.loadFromWorkspace(fixturesV2Path);
	const controlV2 = registryV2.getControl();
	assert.ok(controlV2, 'Control should load from fixtures-v2');
	assert.strictEqual(controlV2.size, 9, 'Should have 9 control points');
	assert.strictEqual(controlV2.hasCallers(), true, 'control.json carries the callers graph');
	assert.strictEqual(controlV2.getCallersAbsentReason(), undefined, 'a loaded graph carries no absence reason');
	const callers = controlV2.getCallers();
	assert.strictEqual(callers.nodes.length, 40, 'callers should have 40 nodes');
	assert.strictEqual(callers.edges.length, 57, 'callers should have 57 edges');
	assert.strictEqual(callers.anchors.length, 64, 'callers should have 64 anchors');
	const starters = callers.nodes.filter(n => n.starter);
	assert.strictEqual(starters.length, 7, 'Should have 7 starter scopes');
	const mainStarter = starters.find(n => n.kind === 'module' && n.filePath.endsWith('/main.ts'));
	assert.ok(mainStarter, 'main.ts module starter should exist');
	console.log(`  ✓ callers loaded: ${callers.nodes.length} nodes, ${callers.edges.length} edges, ${callers.anchors.length} anchors\n`);

	// Test 21: no usable control.json — the absence reason is 'missing'
	console.log('Test 21: missing control.json reads as missing');
	const os = require('os');
	const fs = require('fs');
	const missingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemo-missing-'));
	fs.mkdirSync(path.join(missingDir, '.tactica'));
	fs.copyFileSync(
		path.join(fixturesV2Path, '.tactica', 'definitions.json'),
		path.join(missingDir, '.tactica', 'definitions.json')
	);
	const missingRegistry = new Registry();
	await missingRegistry.loadFromWorkspace(missingDir);
	const missingControl = missingRegistry.getControl();
	assert.ok(missingControl, 'Control instance exists even with no control.json');
	assert.strictEqual(missingControl.hasCallers(), false, 'no callers graph without control.json');
	assert.strictEqual(missingControl.getCallers(), undefined, 'getCallers() returns undefined');
	assert.strictEqual(missingControl.getCallersAbsentReason(), 'missing', 'the absence is explained');
	console.log('  ✓ missing control.json explained\n');

	// Test 22: the stale guard — a control.json older than
	// definitions.json is skipped whole
	console.log('Test 22: stale control.json is skipped');
	const staleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemo-stale-'));
	const staleTactica = path.join(staleDir, '.tactica');
	fs.mkdirSync(staleTactica);
	const staleDefs = JSON.parse(fs.readFileSync(path.join(fixturesV2Path, '.tactica', 'definitions.json'), 'utf-8'));
	const staleControl = JSON.parse(fs.readFileSync(path.join(fixturesV2Path, '.tactica', 'control.json'), 'utf-8'));
	staleDefs.generatedAt = '2999-01-01T00:00:00.000Z';
	staleControl.generatedAt = '2020-01-01T00:00:00.000Z';
	fs.writeFileSync(path.join(staleTactica, 'definitions.json'), JSON.stringify(staleDefs));
	fs.writeFileSync(path.join(staleTactica, 'control.json'), JSON.stringify(staleControl));
	const staleRegistry = new Registry();
	await staleRegistry.loadFromWorkspace(staleDir);
	const staleControlModel = staleRegistry.getControl();
	assert.ok(staleControlModel, 'Control instance exists even when stale');
	assert.strictEqual(staleControlModel.size, 0, 'Stale points are skipped');
	assert.strictEqual(staleControlModel.hasCallers(), false, 'Stale callers graph is skipped');
	assert.strictEqual(staleControlModel.getCallersAbsentReason(), 'stale', 'the stale skip is explained');
	console.log('  ✓ stale control.json skipped\n');

	// Test 23: Control.clear() drops the callers graph together with the
	// points (the model-level reset behind Registry.clear())
	console.log('Test 23: Control.clear() resets points and callers');
	controlV2.clear();
	assert.strictEqual(controlV2.size, 0, 'Points should be cleared');
	assert.strictEqual(controlV2.hasCallers(), false, 'callers should be cleared');
	assert.strictEqual(controlV2.getCallersAbsentReason(), undefined, 'the absence reason clears with the graph');
	registryV2.clear();
	console.log('  ✓ model clear() resets the callers graph\n');

	// Test 24: relative paths (portable tactica output) resolve against
	// the workspace root at load time; type-name keys stay untouched
	console.log('Test 24: relative .tactica paths resolve against the workspace root');
	const relDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemo-rel-'));
	const relTactica = path.join(relDir, '.tactica');
	fs.mkdirSync(relTactica);
	const fixtureFiles = [
		'definitions.json', 'hierarchy.json', 'usages.json',
		'eds.json', 'flow.json', 'control.json'
	];
	for (const file of fixtureFiles) {
		const source = path.join(fixturesV2Path, '.tactica', file);
		if (!fs.existsSync(source)) { continue; }
		const raw = fs.readFileSync(source, 'utf-8');
		// simulate portable tactica output: the old machine root is
		// stripped, exactly what the writer emits now
		const relativized = raw.split('/code/mnemonica/tactica-nestjs/').join('');
		fs.writeFileSync(path.join(relTactica, file), relativized);
	}
	const relRegistry = new Registry();
	await relRegistry.loadFromWorkspace(relDir);
	const relDefinitions = relRegistry.getDefinitions();
	assert.ok(relDefinitions.size > 0, 'definitions load from relative payloads');
	let resolvedLocations = 0;
	for (const key of relDefinitions.keys()) {
		assert.ok(!key.startsWith(relDir), `type-name key stays untouched: ${key}`);
		const entry = relDefinitions.get(key);
		if (!entry.location) { continue; }
		assert.ok(path.isAbsolute(entry.location), `location resolves absolute: ${entry.location}`);
		assert.ok(entry.location.startsWith(relDir + path.sep), 'location anchors at the workspace root');
		resolvedLocations++;
	}
	assert.ok(resolvedLocations > 0, 'at least one definition location was checked');
	const relGraph = relRegistry.getControl().getCallers();
	assert.ok(relGraph, 'callers graph loads from relative payloads');
	for (const node of relGraph.nodes) {
		assert.ok(node.filePath.startsWith(relDir + path.sep), `node filePath resolves absolute: ${node.filePath}`);
	}
	for (const anchor of relGraph.anchors) {
		assert.ok(anchor.location.startsWith(relDir + path.sep), `anchor location resolves absolute: ${anchor.location}`);
	}
	console.log(`  ✓ ${resolvedLocations} definitions + ${relGraph.nodes.length} creation nodes resolve against the workspace root\n`);

	// Test 25: schema validation at load — an invalid contract file is
	// rejected with a logged warning naming the file, its model stays
	// empty, and the load never crashes
	console.log('Test 25: invalid contract file is rejected with a warning');
	const invalidDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemo-invalid-'));
	const invalidTactica = path.join(invalidDir, '.tactica');
	fs.mkdirSync(invalidTactica);
	// version is required and must be "1.2" — this file is pre-1.2 shaped
	const invalidDefs = JSON.parse(fs.readFileSync(path.join(fixturesV2Path, '.tactica', 'definitions.json'), 'utf-8'));
	delete invalidDefs.version;
	fs.writeFileSync(path.join(invalidTactica, 'definitions.json'), JSON.stringify(invalidDefs));
	// a valid control.json alongside proves the other models still load
	fs.copyFileSync(
		path.join(fixturesV2Path, '.tactica', 'control.json'),
		path.join(invalidTactica, 'control.json')
	);
	loggedWarnings.length = 0;
	const invalidRegistry = new Registry();
	await invalidRegistry.loadFromWorkspace(invalidDir);
	const invalidDefinitions = invalidRegistry.getDefinitions();
	assert.ok(invalidDefinitions, 'Definitions instance exists');
	assert.strictEqual(invalidDefinitions.size, 0, 'invalid definitions.json leaves the model empty');
	assert.ok(
		loggedWarnings.some(w => w.includes('definitions.json') && w.includes('failed the definitions schema')),
		'the rejection warning names the file and the schema'
	);
	const invalidControl = invalidRegistry.getControl();
	assert.ok(invalidControl.hasCallers(), 'a valid sibling file still loads');
	console.log('  ✓ invalid definitions.json rejected, warning logged, no crash\n');

	console.log('=== All Tests Passed ===');
}

runTests().catch(err => {
	console.error('Test failed:', err);
	process.exit(1);
});
