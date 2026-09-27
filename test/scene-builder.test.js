'use strict';

// SceneBuilder → Scene3D: the host-side logical scene mirrors what the
// webview renderer is about to draw. GraphData stays the transfer shape;
// the scene records the census — every sphere, edge, diamond, bagel,
// sink, ring, hub, cone and caption as mnemonica instances parented on
// the one scene root. Also pins the Registry's load-time side effects
// the scene work introduced: the Trie model filled from hierarchy.json
// and the RegistryEntry flat index on the Registry's own map.

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
const { buildSceneFor } = require('../out/src/core/SceneBuilder');

const fixturesV2Path = path.join(__dirname, 'fixtures-v2');
const fixturesPath = path.join(__dirname, 'fixtures');

async function runTests() {
	console.log('\n=== Testing SceneBuilder → Scene3D ===\n');

	const registry = new Registry();
	await registry.loadFromWorkspace(fixturesV2Path);
	const data = GraphBuilder.buildFromRegistry(registry);
	const scene = buildSceneFor(fixturesV2Path, data);

	// Test 1: the census — one scene entry per element the renderer draws
	console.log('Test 1: scene census matches the GraphData sections');
	assert.strictEqual(scene.nodeCount, 19, 'one GraphNode3D per type node');
	assert.strictEqual(scene.diamondCount, 39, 'one Diamond3D per creation scope');
	assert.strictEqual(scene.bagelCount, 14, 'one Bagel3D per wrap site');
	assert.strictEqual(scene.sinkCount, 3, 'asyncFlow, otel, exceptionFilter sinks');
	assert.ok(scene.ring, 'the EDS store knot');
	assert.strictEqual(scene.ring.id, 'dive:edsRing');
	assert.ok(scene.hub, 'the attachHooks hub knot');
	assert.strictEqual(scene.hub.id, 'adapter:attachHooks');
	assert.ok(scene.cone, 'the Jaeger cone knot');
	assert.strictEqual(scene.cone.id, 'adapter:jaeger');
	// captions: 19 type nodes + 39 creation scopes + 14 wraps + 6 knots
	assert.strictEqual(scene.captionCount, 78, 'one Caption3D per scene element');
	assert.strictEqual(scene.sourceRoot, fixturesV2Path, 'the scene knows its .tactica source');
	console.log(`  ✓ ${scene.nodeCount} nodes, ${scene.diamondCount} diamonds, ${scene.bagelCount} bagels, ${scene.captionCount} captions\n`);

	// Test 2: the link census. The kind mapping is SceneBuilder's own
	// logic — TS `private` is a compile-time fence, and this plain-node
	// test reads the runtime property to pin the kinds, not just the sum
	console.log('Test 2: link census and kind mapping');
	const linkTotal = 14 + data.execflow.length + 57 + 42 + 6;
	assert.strictEqual(scene.linkCount, linkTotal,
		'inheritance + execflow + creation + fiber + internals links');
	const byKind = new Map();
	for (const link of scene.linkList) {
		byKind.set(link.kind, (byKind.get(link.kind) || 0) + 1);
	}
	assert.strictEqual(byKind.get('inheritance'), 14, 'inheritance links');
	assert.strictEqual(byKind.get('creation'), 57, 'creation call links');
	assert.strictEqual(byKind.get('fiber-via'), 1, 'the via generation chain');
	assert.strictEqual(byKind.get('fiber-ctor'), 41, 'construction-mediated fiber hops');
	assert.strictEqual(byKind.get('sink'), 5, 'ring → consumers, otel + filter → Jaeger');
	assert.strictEqual(byKind.get('hookup'), 1, 'the collection hookup');
	const execflowKinds = new Set(data.execflow.map(l => l.kind));
	for (const kind of execflowKinds) {
		const expected = data.execflow.filter(l => l.kind === kind).length;
		assert.strictEqual(byKind.get(kind), expected, `execflow kind ${kind} carried over`);
	}
	for (const link of scene.linkList) {
		assert.strictEqual(typeof link.source, 'string', 'link source normalized to an id');
		assert.strictEqual(typeof link.target, 'string', 'link target normalized to an id');
	}
	console.log(`  ✓ ${scene.linkCount} links, kinds: ${[...byKind.entries()].map(([k, n]) => `${k}×${n}`).join(', ')}\n`);

	// Test 3: sphere content — id/label/depth/isRoot survive the mapping
	console.log('Test 3: GraphNode3D content');
	const userEntity = scene.getNode('UserEntity');
	assert.ok(userEntity, 'UserEntity sphere exists');
	assert.strictEqual(userEntity.label, 'UserEntity');
	assert.strictEqual(userEntity.depth, 0, 'UserEntity is a root');
	assert.strictEqual(userEntity.isRoot, true);
	const consciousness = scene.getNode('Sentience.Consciousness');
	assert.ok(consciousness, 'nested sphere exists');
	assert.strictEqual(consciousness.depth, 1, 'nested depth');
	assert.strictEqual(consciousness.isRoot, false);
	assert.strictEqual(scene.getNode('No.Such.Type'), undefined, 'unknown ids stay absent');
	console.log('  ✓ spheres carry id, label, depth, isRoot\n');

	// Test 4: bagel anchors — callback scope's diamond first, else the
	// holder's, else the wrapped type's sphere; the two deliberate
	// no-instance wraps stay ambient (anchor null)
	console.log('Test 4: bagel anchors resolve or are honestly null');
	const bagels = [...scene.bagelMap.values()];
	const anchored = bagels.filter(b => b.anchor !== null);
	assert.strictEqual(anchored.length, 12, '12 wraps join a scope or a type');
	const ambient = bagels.filter(b => b.anchor === null).map(b => b.name).sort();
	assert.deepStrictEqual(ambient, [ 'chaos:mid-sleep-timer', 'chaos:pure-error' ],
		'only the two deliberate no-instance wraps stay ambient');
	for (const bagel of anchored) {
		const joinsDiamond = scene.diamondMap.has(bagel.anchor);
		const joinsSphere = scene.nodeMap.has(bagel.anchor);
		assert.ok(joinsDiamond || joinsSphere,
			`bagel ${bagel.name} anchor ${bagel.anchor} should name a scene element`);
	}
	const gen1 = bagels.find(b => b.generation === 1);
	assert.ok(gen1, 'the gen-1 nested wrap');
	assert.strictEqual(gen1.name, 'chaos:nested:inner');
	console.log(`  ✓ ${anchored.length} anchored, ${ambient.length} ambient, 0 dangling\n`);

	// Test 5: the interactive shapes construct from their parents —
	// Camera3D from the scene (what panel.ts does with a saved layout),
	// Tube3D from the scene, Tooltip3D from the sphere instance it
	// describes (the prototype chain ties tooltip → node → scene)
	console.log('Test 5: camera, tube and tooltip construct like the panel does');
	scene.camera = new scene.Camera3D({
		x: 1, y: 2, z: 3, zoom: 450, rotationX: 0.5, rotationY: -0.5
	});
	assert.strictEqual(scene.camera.zoom, 450);
	assert.strictEqual(scene.camera.rotationY, -0.5);
	const focusId = 'Sentience.Consciousness';
	const chain = focusId.split('.').map((segment, index, parts) => parts.slice(0, index + 1).join('.'));
	scene.tube = new scene.Tube3D({ id: focusId, chain });
	assert.deepStrictEqual(scene.tube.chain, [ 'Sentience', 'Sentience.Consciousness' ],
		'the tube threads the dot-joined ancestor prefixes');
	const sphere = scene.getNode(focusId);
	scene.tooltip = new sphere.Tooltip3D({ targetNode: focusId, content: 'Consciousness', visible: true });
	assert.strictEqual(scene.tooltip.targetNode, focusId);
	assert.strictEqual(scene.tooltip.visible, true);
	console.log('  ✓ camera, tube, tooltip constructed from their parent instances\n');

	// Test 6: the Registry's load-time side effects — the Trie model
	// filled from hierarchy.json (one GraphNodeTrie per type, one
	// LinkTrie per parent edge) and the RegistryEntry flat index
	console.log('Test 6: Trie model and RegistryEntry flat index');
	const trie = registry.getTrie();
	assert.ok(trie, 'the trie exists');
	assert.strictEqual(trie.nodeCount, 19, 'one GraphNodeTrie per type');
	assert.strictEqual(trie.linkCount, 14, 'one LinkTrie per parent edge');
	const trieNode = trie.getNode('Sentience.Consciousness');
	assert.ok(trieNode, 'trie node for a nested type');
	assert.strictEqual(trieNode.depth, 1);
	assert.strictEqual(trieNode.isLeaf, false, 'Consciousness has children');
	assert.strictEqual(trie.getNode('Sentience.Memory').isLeaf, true, 'Memory is a leaf');
	assert.strictEqual(trie.getNode('UserEntity').isLeaf, false, 'UserEntity has children');
	assert.strictEqual(registry.size, 19, 'one RegistryEntry per type');
	const entry = registry.get('UserEntity');
	assert.ok(entry, 'RegistryEntry for UserEntity');
	assert.strictEqual(entry.name, 'UserEntity');
	assert.ok(entry.filePath.endsWith('user.entity.ts'), 'entry file path');
	assert.ok(entry.line > 0, 'entry line is 1-based positive');
	console.log(`  ✓ trie ${trie.nodeCount} nodes / ${trie.linkCount} links, registry index ${registry.size} entries\n`);

	// Test 7: v1 payloads build a scene without the creation section —
	// no diamonds, no creation links; the backplane knots still assemble
	console.log('Test 7: v1 payload builds a reduced scene');
	const registryV1 = new Registry();
	await registryV1.loadFromWorkspace(fixturesPath);
	const dataV1 = GraphBuilder.buildFromRegistry(registryV1);
	const sceneV1 = buildSceneFor(fixturesPath, dataV1);
	assert.strictEqual(sceneV1.nodeCount, 4, 'v1 type graph');
	assert.strictEqual(sceneV1.diamondCount, 0, 'no creation section in v1');
	assert.strictEqual(sceneV1.bagelCount, 2, 'the two v1 wraps');
	assert.strictEqual(sceneV1.sinkCount, 3, 'same declared sinks');
	assert.ok(sceneV1.ring && sceneV1.hub && sceneV1.cone, 'same declared knots');
	// captions: 4 type nodes + 2 wraps + 6 knots
	assert.strictEqual(sceneV1.captionCount, 12, 'v1 caption census');
	const v1LinkTotal = dataV1.links.length + dataV1.execflow.length + 0 + 0 + 6;
	assert.strictEqual(sceneV1.linkCount, v1LinkTotal,
		'no creation or fiber links in a v1 scene');
	console.log(`  ✓ v1 scene: ${sceneV1.nodeCount} nodes, ${sceneV1.bagelCount} bagels, ${sceneV1.linkCount} links\n`);

	console.log('=== All Tests Passed ===');
}

runTests().catch(err => {
	console.error('Test failed:', err);
	process.exit(1);
});
