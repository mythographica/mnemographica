'use strict';

// B1.3 trace channel: MainOrchestrator.ingestTrace / getTraceState —
// dedupe on replayed ids, bounded ring, readback sample.

const assert = require('assert');

// Mock the LoggerService before requiring the orchestrator (it pulls in
// 'vscode', which only exists inside the extension host)
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

const path = require('path');
const { define } = require('mnemonica');
const topologicaLoader = require('@mnemonica/topologica');

const modelsPath = path.join(__dirname, '..', 'out', 'src', 'models');
const result = topologicaLoader.default(modelsPath, define);
if (result.logs) {
	result.logs.forEach(log => console.log('[Topologica]', ...log));
}

const { MainOrchestrator } = require('../out/src/core/MainOrchestrator');

const edge = (id) => ({
	id,
	parentId: id > 1 ? id - 1 : null,
	name: 'edge-' + id,
	kind: 'create',
	status: 'ok',
	duration: null,
	ts: 1000 + id,
	instanceType: 'SyncBase'
});

console.log('Test 1: ingest accepts new edges and dedupes replays');
{
	const orchestrator = new MainOrchestrator('0.0.0-test');
	const first = orchestrator.ingestTrace([edge(1), edge(2), edge(3)]);
	assert.strictEqual(first.accepted, 3, 'three fresh edges accepted');
	assert.strictEqual(first.lastId, 3);
	assert.strictEqual(first.buffered, 3);

	// Replay of already-seen ids must be dropped (delta channel is
	// monotonic per source process)
	const replay = orchestrator.ingestTrace([edge(2), edge(3), edge(4)]);
	assert.strictEqual(replay.accepted, 1, 'only the genuinely new edge accepted');
	assert.strictEqual(replay.lastId, 4);
	assert.strictEqual(replay.buffered, 4);
	console.log('  ✓ dedupe + counters');
}

console.log('Test 2: malformed entries are skipped, not fatal');
{
	const orchestrator = new MainOrchestrator('0.0.0-test');
	const mixed = orchestrator.ingestTrace([null, 'junk', { name: 'no-id' }, edge(7)]);
	assert.strictEqual(mixed.accepted, 1, 'only the well-formed edge lands');
	const notArray = orchestrator.ingestTrace(undefined);
	assert.strictEqual(notArray.accepted, 0);
	console.log('  ✓ malformed input tolerated');
}

console.log('Test 3: ring buffer is bounded');
{
	const orchestrator = new MainOrchestrator('0.0.0-test');
	const batch = [];
	for (let i = 1; i <= 5100; i++) {
		batch.push(edge(i));
	}
	const ingested = orchestrator.ingestTrace(batch);
	assert.strictEqual(ingested.accepted, 5100);
	assert.strictEqual(ingested.buffered, 5000, 'buffer capped at the ring limit');
	const state = orchestrator.getTraceState(3);
	assert.strictEqual(state.receivedTotal, 5100, 'lifetime counter survives trimming');
	assert.strictEqual(state.lastId, 5100);
	assert.strictEqual(state.latest.length, 3);
	assert.strictEqual(state.latest[2].id, 5100, 'latest sample is the tail');
	console.log('  ✓ 5100 in → 5000 held, total counted, sample = tail');
}

console.log('Test 4: graph summary without a loaded workspace');
{
	const orchestrator = new MainOrchestrator('0.0.0-test');
	const summary = orchestrator.getGraphSummary();
	assert.strictEqual(summary.stats, undefined);
	assert.deepStrictEqual(summary.nodes, []);
	console.log('  ✓ empty graph summary is well-formed');
}

console.log('Test 5: result carries the freshly-accepted edges (B1.5 panel push)');
{
	const orchestrator = new MainOrchestrator('0.0.0-test');
	const first = orchestrator.ingestTrace([edge(1), edge(2)]);
	assert.strictEqual(first.edges.length, 2, 'accepted edges returned for forwarding');
	assert.strictEqual(first.edges[1].id, 2);
	// Replays are deduped out of the forwarded set too
	const second = orchestrator.ingestTrace([edge(2), edge(3)]);
	assert.strictEqual(second.edges.length, 1, 'replays are not forwarded');
	assert.strictEqual(second.edges[0].id, 3);
	const empty = orchestrator.ingestTrace(undefined);
	assert.deepStrictEqual(empty.edges, [], 'malformed input forwards nothing');
	console.log('  ✓ accepted edges ride the result');
}

console.log('Test 6: trace mode lineage + mid-flight continuation');
{
	// edge() parents each id on id-1, so 1→2→3→4→5 is one chain
	const orchestrator = new MainOrchestrator('0.0.0-test');
	orchestrator.ingestTrace([edge(1), edge(2), edge(3), edge(4), edge(5)]);

	const lineage = orchestrator.getTraceLineage('edge-4');
	assert.ok(lineage, 'name resolves');
	assert.strictEqual(lineage.selectedId, 4);
	// ancestors root→selected plus the descendant already in the ring
	assert.deepStrictEqual(lineage.edges.map(e => e.id), [1, 2, 3, 4, 5]);

	const none = orchestrator.getTraceLineage('never-traced');
	assert.strictEqual(none, null, 'unknown name resolves to null');

	const orphan = Object.assign(edge(9), { parentId: null });
	const cont = orchestrator.getTraceContinuation(3, [edge(6), orphan]);
	assert.strictEqual(cont.length, 1, 'only the batch member whose chain passes 3 continues');
	assert.strictEqual(cont[0].id, 6);
	console.log('  ✓ lineage root→leaf + continuation filter');
}

console.log('Test 7: trace/reset wipes buffer and watermark (source restart)');
{
	const orchestrator = new MainOrchestrator('0.0.0-test');
	orchestrator.ingestTrace([edge(1), edge(2), edge(3)]);

	// a restarted source resends from id 1 — dropped as replay
	const dropped = orchestrator.ingestTrace([edge(1), edge(2)]);
	assert.strictEqual(dropped.accepted, 0, 'restarted ids are deduped before reset');

	const reset = orchestrator.resetTrace();
	assert.strictEqual(reset.reset, true);
	assert.strictEqual(reset.dropped, 3, 'reports the wiped buffer size');
	const state = orchestrator.getTraceState();
	assert.strictEqual(state.buffered, 0);
	assert.strictEqual(state.lastId, 0);
	assert.strictEqual(state.receivedTotal, 0);

	const fresh = orchestrator.ingestTrace([edge(1), edge(2)]);
	assert.strictEqual(fresh.accepted, 2, 'the restarted source lands after reset');
	console.log('  ✓ reset re-opens the channel for a restarted source');
}

console.log('\n=== All Tests Passed ===');
