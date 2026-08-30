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

console.log('\n=== All Tests Passed ===');
