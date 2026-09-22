'use strict';

// GraphBuilder collections: tactica keys custom-collection types by a
// `collectionId::`-prefixed fullPath. The builder renders ONE
// collection's universe per payload, reports the inventory
// (GraphData.collections), and falls back default-if-present /
// first-seen otherwise. fixtures-collections mixes the default
// collection with one custom collection and carries a collections.json
// manifest (id → display name); fixtures-collections-only carries no
// default collection and no manifest at all.

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

// Mock the LoggerService before requiring Registry/GraphBuilder
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
topologicaLoader.default(modelsPath, define);

const { Registry } = require('../out/src/models/Registry');
const { GraphBuilder } = require('../out/src/core/GraphBuilder');
const { ALL_COLLECTIONS } = require('../out/src/utils/collections');

const fixturesMixedPath = path.join(__dirname, 'fixtures-collections');
const fixturesOnlyPath = path.join(__dirname, 'fixtures-collections-only');

async function runTests() {
	console.log('\n=== Testing GraphBuilder collections ===\n');

	// Test 1: no selection renders the combined all-collections view when
	// the project holds more than one collection
	console.log('Test 1: default selection is the combined all-collections view');
	const registryMixed = new Registry();
	await registryMixed.loadFromWorkspace(fixturesMixedPath);
	const dataDefault = GraphBuilder.buildFromRegistry(registryMixed);
	assert.strictEqual(dataDefault.collection, ALL_COLLECTIONS, 'multi-collection projects default to the combined view');
	assert.deepStrictEqual(dataDefault.nodes.map(n => n.id).sort(), [
		'Widget', 'Widget.Button', 'collection_1::Product', 'collection_1::Product.Category'
	], 'every universe\'s type nodes');
	assert.strictEqual(dataDefault.links.length, 2, 'both universes keep their inheritance links');
	console.log(`  ✓ ${dataDefault.nodes.length} nodes, ${dataDefault.links.length} links, collection=${dataDefault.collection}\n`);

	// Test 2: the inventory lists every collection in first-seen order,
	// with display names resolved from the collections.json manifest
	console.log('Test 2: collections inventory with per-collection counts and names');
	assert.deepStrictEqual(dataDefault.collections, [
		{ id: 'defaultTypes', count: 2, name: 'defaultTypes' },
		{ id: 'collection_1', count: 2, name: 'Shop' }
	], 'inventory in types-walk order, names from collections.json');
	console.log('  ✓ inventory: defaultTypes×2, collection_1(Shop)×2\n');

	// Test 2b: the Registry exposes the manifest map itself — the default
	// collection's null id lands under the 'defaultTypes' key
	console.log('Test 2b: collections manifest map');
	assert.deepStrictEqual(Array.from(registryMixed.getCollectionNames().entries()), [
		['defaultTypes', 'defaultTypes'],
		['collection_1', 'Shop']
	], 'id → name, default collection keyed defaultTypes');
	console.log('  ✓ defaultTypes → defaultTypes, collection_1 → Shop\n');

	// Test 3: explicit selection renders that collection's universe
	console.log('Test 3: explicit collection selection');
	const registryShop = new Registry();
	await registryShop.loadFromWorkspace(fixturesMixedPath);
	const dataShop = GraphBuilder.buildFromRegistry(registryShop, 'collection_1');
	assert.strictEqual(dataShop.collection, 'collection_1', 'the requested collection is rendered');
	assert.deepStrictEqual(dataShop.nodes.map(n => n.id).sort(),
		['collection_1::Product', 'collection_1::Product.Category'],
		'only the custom collection\'s types');
	assert.strictEqual(dataShop.links.length, 1, 'the custom universe\'s own inheritance link');
	const shopRoot = dataShop.nodes.find(n => n.id === 'collection_1::Product');
	assert.strictEqual(shopRoot.depth, 0, 'a collection root is generation 0 of its own universe');
	assert.strictEqual(shopRoot.isRoot, true, 'collection root stays a root');
	console.log(`  ✓ ${dataShop.nodes.length} nodes, root depth ${shopRoot.depth}\n`);

	// Test 4: the instantiation census is per-universe — Product is
	// constructed, Category is not, and the default universe's census
	// must not leak across
	console.log('Test 4: instantiation census is per-universe');
	assert.strictEqual(dataShop.nodes.find(n => n.id === 'collection_1::Product').neverCreated, undefined,
		'Product is instantiated');
	assert.strictEqual(dataShop.nodes.find(n => n.id === 'collection_1::Product.Category').neverCreated, true,
		'Category is never created');
	assert.strictEqual(dataDefault.nodes.find(n => n.id === 'Widget').neverCreated, undefined,
		'Widget is instantiated');
	assert.strictEqual(dataDefault.nodes.find(n => n.id === 'Widget.Button').neverCreated, true,
		'Button is never created');
	console.log('  ✓ census keyed by fullPath, no cross-collection leak\n');

	// Test 5: an unknown selection falls back to the combined view when
	// the project holds more than one collection
	console.log('Test 5: unknown selection falls back to all collections');
	const registryFallback = new Registry();
	await registryFallback.loadFromWorkspace(fixturesMixedPath);
	const dataFallback = GraphBuilder.buildFromRegistry(registryFallback, 'collection_nope');
	assert.strictEqual(dataFallback.collection, ALL_COLLECTIONS, 'the combined view wins over an unknown id');
	assert.strictEqual(dataFallback.nodes.length, 4, 'every universe rendered');
	console.log('  ✓ fallback → all collections\n');

	// Test 6: a project with NO default collection falls back to the
	// first-seen collection instead of rendering empty. This fixture has
	// no collections.json either — the inventory entry carries no name,
	// pinning the absent-manifest tolerance (tactica < 0.4.1 output)
	console.log('Test 6: no default collection — first-seen wins');
	const registryOnly = new Registry();
	await registryOnly.loadFromWorkspace(fixturesOnlyPath);
	const dataOnly = GraphBuilder.buildFromRegistry(registryOnly);
	assert.strictEqual(dataOnly.collection, 'collection_1', 'first-seen collection selected');
	assert.deepStrictEqual(dataOnly.nodes.map(n => n.id), ['collection_1::Product'],
		'the only universe renders');
	assert.deepStrictEqual(dataOnly.collections, [{ id: 'collection_1', count: 1 }],
		'inventory holds the single collection');
	console.log('  ✓ fallback → collection_1\n');

	// Test 7: the combined all-collections view renders every universe —
	// no type-node filtering, both inheritance links survive
	console.log('Test 7: all-collections view renders every universe');
	const registryAll = new Registry();
	await registryAll.loadFromWorkspace(fixturesMixedPath);
	const dataAll = GraphBuilder.buildFromRegistry(registryAll, ALL_COLLECTIONS);
	assert.strictEqual(dataAll.collection, ALL_COLLECTIONS, 'the combined marker rides the payload');
	assert.deepStrictEqual(dataAll.nodes.map(n => n.id).sort(), [
		'Widget', 'Widget.Button', 'collection_1::Product', 'collection_1::Product.Category'
	], 'every universe present');
	assert.strictEqual(dataAll.links.length, 2, 'both universes keep their inheritance links');
	console.log(`  ✓ ${dataAll.nodes.length} nodes, ${dataAll.links.length} links, one center\n`);

	console.log('=== All Tests Passed ===');
}

runTests().catch(err => {
	console.error('Test failed:', err);
	process.exit(1);
});
