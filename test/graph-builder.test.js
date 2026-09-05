'use strict';

// GraphBuilder → GraphData: the optional sections sourced from
// instrumentation.json v2 (`creation`), eds.json (`wrappers` fiber links)
// and the declared internals backplane (`internals` — knots, sink edges,
// attachHooks grafts, the never-created usages census). v2 fixtures are
// real tactica output from tactica-nestjs; v1 fixtures pin the absence
// of the newer sections.

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

const fixturesV2Path = path.join(__dirname, 'fixtures-v2');
const fixturesPath = path.join(__dirname, 'fixtures');

async function runTests() {
	console.log('\n=== Testing GraphBuilder creation section ===\n');

	const registry = new Registry();
	await registry.loadFromWorkspace(fixturesV2Path);
	const data = GraphBuilder.buildFromRegistry(registry);

	// Test 1: the type graph is built as before, with creation attached
	console.log('Test 1: GraphData carries the creation section');
	assert.strictEqual(data.nodes.length, 19, 'Should have 19 type nodes');
	assert.strictEqual(data.links.length, 14, 'Should have 14 inheritance links');
	assert.ok(data.execflow.length > 0, 'Should have execflow edges');
	assert.ok(data.creation, 'creation section should be present for v2 payloads');
	assert.strictEqual(data.creation.nodes.length, 39, 'Should have 39 creation nodes');
	assert.strictEqual(data.creation.links.length, 57, 'Should have 57 creation links');
	console.log(`  ✓ creation: ${data.creation.nodes.length} nodes, ${data.creation.links.length} links\n`);

	// Test 2: anchors join to holders, nothing dangles
	console.log('Test 2: holder anchors join to graph nodes');
	const holders = data.creation.nodes.filter(n => n.creates.length > 0);
	assert.strictEqual(holders.length, 33, 'Should have 33 holder scopes');
	const totalCreates = data.creation.nodes.reduce((sum, n) => sum + n.creates.length, 0);
	assert.strictEqual(totalCreates, 46, 'All 46 anchors resolve to known types');
	const typeIds = new Set(data.nodes.map(n => n.id));
	data.creation.nodes.forEach(n => {
		n.creates.forEach(c => {
			assert.ok(typeIds.has(c.typePath), `creates typePath ${c.typePath} must be a graph node`);
			assert.ok(c.location && typeof c.location.line === 'number', 'anchor location should be parsed');
		});
	});
	console.log(`  ✓ ${holders.length} holders, ${totalCreates} anchors, 0 dangling\n`);

	// Test 3: display names are shortened (module basenames, anonymous
	// function scopes become "basename:line")
	console.log('Test 3: creation node display names');
	const mainModule = data.creation.nodes.find(n => n.kind === 'module' && n.filePath.endsWith('/main.ts'));
	assert.ok(mainModule, 'main.ts module node should exist');
	assert.strictEqual(mainModule.name, 'main.ts', 'Module name should be the file basename');
	assert.strictEqual(mainModule.starter, true, 'main.ts module is a starter');
	const anonFn = data.creation.nodes.find(n => n.id.endsWith('/main.ts:153:33'));
	assert.ok(anonFn, 'anonymous function scope should exist');
	assert.strictEqual(anonFn.name, 'main.ts:153', 'Anonymous function name should be basename:line');
	const methodNode = data.creation.nodes.find(n => n.id.endsWith('/async.controller.ts:196:2'));
	assert.strictEqual(methodNode.name, 'AsyncController.getSubDecorate', 'Method names stay untouched');
	console.log('  ✓ names shortened for modules and anonymous scopes\n');

	// Test 4: creation nodes do not leak into type stats or node ids
	console.log('Test 4: creation nodes stay out of the type graph');
	const stats = GraphBuilder.getStats(data);
	assert.strictEqual(stats.nodeCount, 19, 'getStats counts type nodes only');
	assert.strictEqual(stats.maxDepth, 3, 'maxDepth unaffected by creation nodes');
	const creationIds = new Set(data.creation.nodes.map(n => n.id));
	data.nodes.forEach(n => {
		assert.ok(!creationIds.has(n.id), `type node ${n.id} must not collide with creation ids`);
	});
	console.log('  ✓ stats and ids unaffected\n');

	// Test 5: every creation link endpoint is a known scope
	console.log('Test 5: creation link endpoints resolve');
	data.creation.links.forEach(link => {
		assert.ok(creationIds.has(link.source), `link source ${link.source} should be a creation node`);
		assert.ok(creationIds.has(link.target), `link target ${link.target} should be a creation node`);
	});
	console.log('  ✓ all link endpoints resolve\n');

	// Test 6: v1 payloads leave the section absent (backward compatibility)
	console.log('Test 6: v1 payload builds without a creation section');
	const registryV1 = new Registry();
	await registryV1.loadFromWorkspace(fixturesPath);
	const dataV1 = GraphBuilder.buildFromRegistry(registryV1);
	assert.strictEqual(dataV1.creation, undefined, 'creation section must be absent for v1 payloads');
	assert.strictEqual(dataV1.nodes.length, 4, 'v1 type graph still builds');
	console.log('  ✓ v1 build unchanged\n');

	// Test 7: the module-importer bridge survives the GraphData mapping —
	// main.ts hands AppModule to the framework as a VALUE, so only the
	// import relation connects the entry module to the Nest component
	console.log('Test 7: module-importer bridge links');
	const bridge = (a, b) => data.creation.links.some(link =>
		link.source.endsWith('/' + a) && link.target.endsWith('/' + b));
	assert.ok(bridge('main.ts', 'app.module.ts'), 'main.ts → app.module.ts bridge link');
	assert.ok(bridge('app.module.ts', 'user.controller.ts'), 'app.module.ts → user.controller.ts bridge link');
	const appModule = data.creation.nodes.find(n => n.kind === 'module' && n.filePath.endsWith('/app.module.ts'));
	assert.strictEqual(appModule.starter, false, 'app.module is no longer a starter — main.ts calls it');
	console.log('  ✓ bridge links present, app.module starter flag cleared\n');

	// Test 8: the wrappers section (eds.json wrap entries) — one node per
	// wrap call site, label-named. Two link kinds: the `via` generation
	// chain (chaos:nested:inner is gen-1, parented by chaos:nested:outer)
	// and the construction-mediated `ctor` fiber hops — a wrap whose
	// createsTypes holds T is the runtime ancestor of every wrap hosted
	// by T's define handler or wrapping a T instance
	console.log('Test 8: wrappers section with generation chain');
	assert.ok(data.wrappers, 'wrappers section should be present when eds.json carries wraps');
	assert.strictEqual(data.wrappers.nodes.length, 14, 'Should have 14 wrapper nodes');
	const viaLinks = data.wrappers.links.filter(l => l.kind === 'via');
	const ctorLinks = data.wrappers.links.filter(l => l.kind === 'ctor');
	assert.strictEqual(viaLinks.length, 1, 'Should have 1 via generation link');
	assert.strictEqual(ctorLinks.length, 41, 'Should have 41 ctor fiber hops (4 creators × UserEntity-hosted wraps)');
	assert.strictEqual(data.wrappers.links.length, 42, 'via + ctor links');
	const labeled = data.wrappers.nodes.filter(n => n.label && n.name === n.label);
	assert.strictEqual(labeled.length, 13, 'Labeled wraps are named by their label');
	const gen1 = data.wrappers.nodes.find(n => n.generation === 1);
	assert.ok(gen1, 'a gen-1 wrap should exist');
	assert.strictEqual(gen1.name, 'chaos:nested:inner', 'the nested demo inner wrap is gen-1');
	const genLink = viaLinks.find(l => l.target === gen1.id);
	assert.ok(genLink, 'gen-1 node should have an incoming via link');
	const parent = data.wrappers.nodes.find(n => n.id === genLink.source);
	assert.ok(parent, 'via link source should be a wrapper node');
	assert.strictEqual(parent.generation, 0, 'parent is gen-0');
	assert.strictEqual(parent.name, 'chaos:nested:outer', 'parent is the outer nested wrap');
	// ctor hops: endpoints resolve, viaType is a graph node, no duplicate
	// (source, target, viaType) triples; the EdsProbe wrap creating
	// UserEntity is a known creator of the UserEntity-hosted chaos wraps
	const wrapperIds8 = new Set(data.wrappers.nodes.map(n => n.id));
	const ctorSeen = new Set();
	ctorLinks.forEach(l => {
		assert.ok(wrapperIds8.has(l.source) && wrapperIds8.has(l.target), `ctor ${l.source} → ${l.target} endpoints resolve`);
		assert.ok(typeIds.has(l.viaType), `ctor viaType ${l.viaType} should be a graph node`);
		assert.strictEqual(l.viaType, 'UserEntity', 'all fixture ctor hops are mediated by UserEntity');
		const key = `${l.source}→${l.target}@${l.viaType}`;
		assert.ok(!ctorSeen.has(key), `duplicate ctor hop ${key}`);
		ctorSeen.add(key);
	});
	const ctorSources = new Set(ctorLinks.map(l => l.source));
	assert.strictEqual(ctorSources.size, 4, 'four wraps create UserEntity (eds-probe + three chaos scopes)');
	const edsProbeWrap = data.wrappers.nodes.find(n => n.id.includes('/eds-probe.entity.ts:'));
	assert.ok(edsProbeWrap, 'the EdsProbe wrap site should exist');
	assert.ok(ctorSources.has(edsProbeWrap.id), 'the EdsProbe wrap is a UserEntity creator');
	console.log(`  ✓ ${data.wrappers.nodes.length} wraps, chain ${parent.name} → ${gen1.name}, ${ctorLinks.length} ctor hops over ${ctorSources.size} creators\n`);

	// Test 9: wrapper joins never dangle — creation joins name known
	// creation scopes, type joins name known type nodes; the two joinless
	// wraps are the deliberate ones (pure-error has NO instance by design,
	// mid-sleep-timer wraps a timer holding no instance). The host-type
	// join (scope key IS a type — the instance produced the wrap) is a
	// third honest relation, pinned on the EdsProbe probe wrap
	console.log('Test 9: wrapper joins resolve or are honestly absent');
	const withCreationJoin = data.wrappers.nodes.filter(n => n.callbackScopeId || n.holderScopeId);
	const withTypeJoin = data.wrappers.nodes.filter(n => n.wrapsTypePath);
	assert.strictEqual(withCreationJoin.length, 11, 'Should have 11 creation joins');
	assert.strictEqual(withTypeJoin.length, 11, 'Should have 11 type joins');
	withCreationJoin.forEach(n => {
		const join = n.callbackScopeId || n.holderScopeId;
		assert.ok(creationIds.has(join), `wrapper ${n.name} creation join ${join} should be a creation node`);
	});
	withTypeJoin.forEach(n => {
		assert.ok(typeIds.has(n.wrapsTypePath), `wrapper ${n.name} type join ${n.wrapsTypePath} should be a type node`);
	});
	const withHostJoin = data.wrappers.nodes.filter(n => n.hostTypePath);
	assert.strictEqual(withHostJoin.length, 1, 'one wrap is hosted by a known type scope');
	assert.strictEqual(withHostJoin[0].name, 'probe:fire', 'the EdsProbe probe wrap');
	assert.strictEqual(withHostJoin[0].hostTypePath, 'EdsProbe');
	assert.ok(typeIds.has(withHostJoin[0].hostTypePath), 'hostTypePath should resolve to a type node');
	const joinless = data.wrappers.nodes.filter(n => !n.callbackScopeId && !n.holderScopeId && !n.wrapsTypePath && !n.hostTypePath);
	assert.deepStrictEqual(joinless.map(n => n.name).sort(), [ 'chaos:mid-sleep-timer', 'chaos:pure-error' ], 'only the two deliberate no-instance wraps stay ambient');
	console.log(`  ✓ ${withCreationJoin.length} creation joins, ${withTypeJoin.length} type joins, ${withHostJoin.length} host join, 0 dangling, 2 ambient\n`);

	// Test 10: the combined Dive backplane (declared knots from
	// graph/internals-manifest.ts) rides along whenever wraps exist — the
	// EDS ring and attachHooks hub, the adapter sinks, the directed export
	// path to Jaeger, and the per-type attachHooks grafts (only types that
	// really get constructed — hooks never fire for never-created ones)
	console.log('Test 10: internals backplane — ring, hub, sinks, grafts');
	assert.ok(data.internals, 'internals section should be present when wraps exist');
	assert.strictEqual(data.internals.nodes.length, 6, 'ring + hub + 3 sinks + the external');
	const byRole = (role) => data.internals.nodes.filter(n => n.role === role);
	assert.strictEqual(byRole('ring').length, 1, 'one ring knot');
	assert.strictEqual(byRole('ring')[0].id, 'dive:edsRing', 'the ring is dive:edsRing');
	assert.strictEqual(byRole('hub').length, 1, 'one hub knot');
	assert.strictEqual(byRole('hub')[0].id, 'adapter:attachHooks', 'the hub is Adapter:attachHooks');
	assert.strictEqual(byRole('sink').length, 3, 'asyncFlow, otel, exceptionFilter');
	assert.strictEqual(byRole('external').length, 1, 'Jaeger is the only external');
	assert.strictEqual(byRole('external')[0].id, 'adapter:jaeger', 'the external is Jaeger');
	const sinkLinks = data.internals.links.filter(l => l.kind === 'sink');
	const hookupLinks = data.internals.links.filter(l => l.kind === 'hookup');
	assert.strictEqual(sinkLinks.length, 5, 'ring → 3 consumers, otel + filter → Jaeger');
	assert.strictEqual(hookupLinks.length, 1, 'the collection hookup only');
	assert.strictEqual(hookupLinks[0].source, 'collection', 'hookup sources on the collection marker');
	assert.strictEqual(hookupLinks[0].target, 'adapter:attachHooks', 'hookup targets the attachHooks hub');
	const sinkPairs = new Set(sinkLinks.map(l => `${l.source}→${l.target}`));
	[
		'dive:edsRing→adapter:asyncFlow',
		'dive:edsRing→adapter:otel',
		'dive:edsRing→adapter:exceptionFilter',
		'adapter:otel→adapter:jaeger',
		'adapter:exceptionFilter→adapter:jaeger'
	].forEach(pair => assert.ok(sinkPairs.has(pair), `sink edge ${pair} should be declared`));
	const filterEdge = sinkLinks.find(l => l.target === 'adapter:exceptionFilter');
	assert.strictEqual(filterEdge.label, 'getFlow / getErrorInstance', 'the read-back edge names the read APIs');
	const knotIds = new Set(data.internals.nodes.map(n => n.id));
	data.internals.links.forEach(l => {
		assert.ok(knotIds.has(l.target), `internals link target ${l.target} should be a knot`);
		const sourceOk = knotIds.has(l.source) || l.source === 'collection';
		assert.ok(sourceOk, `internals link source ${l.source} should resolve (knot or collection)`);
	});
	// Grafts + the instantiation census: 13 constructed types get a graft;
	// the 6 never-created ones (the Consciousness subtree, EdsProbe) do not
	assert.strictEqual(data.internals.grafts.length, 13, 'one graft per really-constructed type');
	const neverCreated = data.nodes.filter(n => n.neverCreated).map(n => n.id).sort();
	assert.deepStrictEqual(neverCreated, [
		'EdsProbe',
		'Sentience.Consciousness',
		'Sentience.Consciousness.Curiosity',
		'Sentience.Consciousness.Empathy',
		'Sentience.Consciousness.Empathy.Gratitude',
		'Sentience.Consciousness.Sympathy'
	], 'usages.json pins the never-created set');
	data.internals.grafts.forEach(g => {
		assert.ok(typeIds.has(g), `graft ${g} should name a graph node`);
		assert.ok(!neverCreated.includes(g), `graft ${g} must be a constructed type`);
	});
	assert.ok(data.internals.grafts.includes('Sentience'), 'Sentience is constructed — grafted');
	// The EdsProbe diagnostic: its wrap provably creates UserEntity, yet the
	// path-hit is never taken — EdsProbe itself is never constructed
	const pathHits = data.execflow.filter(e => e.kind === 'edsPathHit');
	assert.strictEqual(pathHits.length, 1, 'one graph-node-sourced path-hit');
	assert.strictEqual(pathHits[0].source, 'EdsProbe');
	assert.strictEqual(pathHits[0].target, 'UserEntity');
	assert.strictEqual(pathHits[0].neverTaken, true, 'the EdsProbe path-hit is flagged never-taken');
	console.log(`  ✓ ${data.internals.nodes.length} knots, ${sinkLinks.length} sink + ${hookupLinks.length} hookup edges, ${data.internals.grafts.length} grafts, ${neverCreated.length} never-created\n`);

	// Test 11: v1 payloads assemble the same backplane — no via/ctor fiber
	// links exist (the v1 fixture carries 2 unrelated wraps), grafts cover
	// exactly the constructed types (backward compatibility)
	console.log('Test 11: v1 payload builds the backplane without fiber links');
	assert.ok(dataV1.internals, 'v1 fixtures carry 2 wraps, so the backplane assembles');
	assert.strictEqual(dataV1.internals.nodes.length, 6, 'same declared knots');
	assert.strictEqual(dataV1.internals.links.length, 6, '5 sink + 1 hookup');
	assert.strictEqual(dataV1.wrappers.links.length, 0, 'no via/ctor links in the v1 fixture');
	assert.deepStrictEqual(dataV1.internals.grafts.sort(), [ 'OrderEntity', 'UserEntity' ], 'grafts cover the constructed roots only');
	const v1Never = dataV1.nodes.filter(n => n.neverCreated).map(n => n.id).sort();
	assert.deepStrictEqual(v1Never, [ 'OrderEntity.OrderItem', 'UserEntity.AdminEntity' ], 'v1 nested types stay never-created');
	console.log('  ✓ v1 backplane assembled, grafts census-driven\n');

	console.log('=== All Tests Passed ===');
}

runTests().catch(err => {
	console.error('Test failed:', err);
	process.exit(1);
});
