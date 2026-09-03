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
	// Re-published ids still in the ring are lifecycle completions
	// (leave/settle, 2026-09-01): upserted in place AND forwarded, so the
	// panel and the Live Trace tree see the completion, not just arrivals
	const completion = Object.assign(edge(2), { status: 'ok', duration: 5 });
	const second = orchestrator.ingestTrace([completion, edge(3)]);
	assert.strictEqual(second.accepted, 1, 'only the genuinely new edge is new');
	assert.strictEqual(second.updated, 1, 'the re-published id merged');
	assert.strictEqual(second.edges.length, 2, 'completions forward alongside arrivals');
	assert.strictEqual(second.edges[0].id, 2, 'the merged edge rides first');
	const state = orchestrator.getTraceState(3);
	const merged = state.latest.find(e => e.id === 2);
	assert.strictEqual(merged.duration, 5, 'buffered copy carries the completion');
	const empty = orchestrator.ingestTrace(undefined);
	assert.deepStrictEqual(empty.edges, [], 'malformed input forwards nothing');
	console.log('  ✓ accepted + completed edges ride the result');
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

console.log('Test 8: session tag auto-wipes on source restart (VACUUM rule)');
{
	const orchestrator = new MainOrchestrator('0.0.0-test');
	orchestrator.ingestTrace([edge(1), edge(2), edge(3)], 'pid-100');

	// same session: dedup only, never a wipe
	const same = orchestrator.ingestTrace([edge(2), edge(4)], 'pid-100');
	assert.strictEqual(same.sessionReset, false);
	assert.strictEqual(same.accepted, 1, 'only the genuinely new edge lands');

	// a NEW session marker: the source process restarted, its ids
	// restarted from 1 — wipe first, then land them
	const restarted = orchestrator.ingestTrace([edge(1), edge(2)], 'pid-200');
	assert.strictEqual(restarted.sessionReset, true);
	assert.strictEqual(restarted.dropped, 4, 'the wipe reports what it dropped');
	assert.strictEqual(restarted.accepted, 2, 'restarted ids land immediately');

	// untagged batches keep the old explicit-reset behavior
	const untagged = orchestrator.ingestTrace([edge(3)]);
	assert.strictEqual(untagged.sessionReset, false);
	assert.strictEqual(untagged.accepted, 1);
	console.log('  ✓ session change auto-wipes; same/untagged sessions do not');
}

console.log('Test 9: by-root lineage isolates exactly one trace');
{
	const orchestrator = new MainOrchestrator('0.0.0-test');
	orchestrator.ingestTrace([edge(1), edge(2), edge(3)]);
	const root2 = Object.assign(edge(10), { parentId: null, instanceType: 'Other' });
	const child2 = Object.assign(edge(11), { parentId: 10, instanceType: 'Other' });
	orchestrator.ingestTrace([root2, child2]);

	const byRoot = orchestrator.getTraceLineageByRoot(10);
	assert.ok(byRoot, 'root resolves');
	assert.strictEqual(byRoot.selectedId, 10);
	assert.deepStrictEqual(byRoot.edges.map(e => e.id), [10, 11], 'only this trace — no cross-contamination from the 1→3 chain');

	const missing = orchestrator.getTraceLineageByRoot(999);
	assert.strictEqual(missing, null, 'unknown root resolves to null');
	console.log('  ✓ by-root lineage is exact');
}

console.log('\n=== All Tests Passed ===');
