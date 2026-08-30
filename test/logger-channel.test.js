'use strict';

// Logger channel (2026-08-30): LoggerService ring bound +
// getRecentLogs plain-object mapping — the pieces the strategy WS
// state/query 'logs' subject is built on.

const assert = require('assert');

// LoggerService imports 'vscode' (only exists in the extension host) —
// stub it; everything else (mnemonica, topologica models) loads for real
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
	if (id === 'vscode') {
		return {
			window: {
				createOutputChannel: () => ({
					appendLine : () => {},
					show       : () => {},
					clear      : () => {},
					dispose    : () => {}
				})
			}
		};
	}
	return originalRequire.apply(this, arguments);
};

const path = require('path');
const { define } = require('mnemonica');
const topologicaLoader = require('@mnemonica/topologica');

// Go through the REAL bootstrap: LoggerService.ensureLoggerTab gates on
// bootstrap's modelsLoaded flag, which only loadModels() sets
const { loadModels } = require('../out/src/topologica/bootstrap');
loadModels(path.join(__dirname, '..'));

const { LoggerService } = require('../out/src/services/LoggerService');

const logger = LoggerService.getInstance();
// Minimal initialize: no real ExtensionContext needed, just the flag +
// a log path under os.tmpdir so the file write is real but harmless
logger.initialize({
	subscriptions  : [],
	extensionPath  : require('os').tmpdir()
});

console.log('Test 1: getRecentLogs returns plain JSON-safe objects, newest last');
{
	logger.info('hello %s', 'world');
	logger.error('boom');
	logger.warn('careful');
	const recent = logger.getRecentLogs(2);
	assert.strictEqual(recent.length, 2, 'sample limits to the newest N');
	assert.strictEqual(recent[1].level, 'warn');
	assert.strictEqual(recent[1].message, 'careful');
	assert.strictEqual(typeof recent[1].timestamp, 'number');
	// No mnemonica internals leak across the mapping
	assert.strictEqual(recent[1].__proto__.constructor.name, 'Object');
	console.log('  ✓ plain objects, sample honored');
}

console.log('Test 2: level filter');
{
	const errors = logger.getRecentLogs(50, 'error');
	assert.ok(errors.length >= 1);
	assert.ok(errors.every(e => e.level === 'error'), 'only error entries');
	console.log('  ✓ level filter works');
}

console.log('Test 3: ring is bounded at LOG_ENTRIES_LIMIT');
{
	const before = logger.getLogCount();
	for (let i = 0; i < 2100; i++) {
		logger.debug('flood ' + i);
	}
	const after = logger.getLogCount();
	assert.ok(after <= 2000, `bounded (was ${before}, now ${after})`);
	const tail = logger.getRecentLogs(1);
	assert.strictEqual(tail[0].message, 'flood 2099', 'ring keeps the newest');
	console.log('  ✓ 2100 in → 2000 held, tail intact');
}

console.log('\n=== All Tests Passed ===');
