'use strict';

// The read-once law: one load of a project reads each of the seven lethe
// contract files exactly ONCE; a second consumer (the panel), a graph
// rebuild and a collection switch read NOTHING; a store reload reads each
// exactly once again. The generator-internal files (types.ts,
// instrumentation.json, modules.json, scopes.json) are never read.

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { define } = require('mnemonica');
const topologicaLoader = require('@mnemonica/topologica');

// Mock the LoggerService before requiring Registry (it needs vscode)
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

// Count .tactica file reads by contract kind
const readCounts = new Map();
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function(filePath, ...rest) {
	const text = String(filePath);
	if (text.includes('.tactica')) {
		const base = path.basename(text);
		readCounts.set(base, (readCounts.get(base) || 0) + 1);
	}
	return originalReadFileSync.apply(this, [filePath, ...rest]);
};

const modelsPath = path.join(__dirname, '..', 'out', 'src', 'models');
topologicaLoader.default(modelsPath, define);

const { GraphBuilder } = require('../out/src/core/GraphBuilder');
const {
	getProjectRegistry,
	reloadProjectRegistry,
	peekProjectRegistry,
	onProjectRegistryReload,
	clearProjectRegistries
} = require('../out/src/core/registryStore');

const fixturesPath = path.join(__dirname, 'fixtures-v2');
const CONTRACT_FILES = [
	'hierarchy.json', 'definitions.json', 'collections.json',
	'usages.json', 'flow.json', 'eds.json', 'control.json'
];
const INTERNAL_FILES = [
	'types.ts', 'registry.ts', 'instrumentation.json', 'modules.json', 'scopes.json'
];

async function runTests() {
	console.log('\n=== Testing registryStore read-once law ===\n');

	// Test 1: one load — sidebar + panel + a graph rebuild + a collection
	// switch read each contract file exactly once, internals never
	console.log('Test 1: one load, many consumers, one read per file');
	clearProjectRegistries();
	readCounts.clear();

	const sidebarRegistry = await getProjectRegistry(fixturesPath);
	assert.ok(sidebarRegistry, 'sidebar registry loaded');
	const panelRegistry = await getProjectRegistry(fixturesPath);
	assert.strictEqual(panelRegistry, sidebarRegistry, 'the panel gets the SAME instance');
	// graph rebuild + collection switch (the collection argument changes
	// the builder's pick — both must read nothing)
	GraphBuilder.buildFromRegistry(sidebarRegistry);
	GraphBuilder.buildFromRegistry(sidebarRegistry, 'collection_1');

	for (const file of CONTRACT_FILES) {
		assert.strictEqual(readCounts.get(file) || 0, 1, `${file} read exactly once (got ${readCounts.get(file) || 0})`);
	}
	for (const file of INTERNAL_FILES) {
		assert.strictEqual(readCounts.get(file) || 0, 0, `${file} never read (got ${readCounts.get(file) || 0})`);
	}
	console.log('  ✓ seven contract files read once, internals never\n');

	// Test 2: a store reload re-reads each file exactly once (in place —
	// the instance identity survives)
	console.log('Test 2: reload reads each file exactly once again');
	readCounts.clear();
	const reloaded = await reloadProjectRegistry(fixturesPath, 'test');
	assert.strictEqual(reloaded, sidebarRegistry, 'reload keeps the same instance');
	for (const file of CONTRACT_FILES) {
		assert.strictEqual(readCounts.get(file) || 0, 1, `${file} re-read exactly once (got ${readCounts.get(file) || 0})`);
	}
	console.log('  ✓ reload: one read per file, same instance\n');

	// Test 3: a project without .tactica resolves to undefined and is not
	// cached (tactica may generate one later)
	console.log('Test 3: missing .tactica is undefined, uncached');
	const emptyDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mnemo-empty-'));
	const missing = await getProjectRegistry(emptyDir);
	assert.strictEqual(missing, undefined, 'no registry without .tactica');
	fs.mkdirSync(path.join(emptyDir, '.tactica'));
	fs.copyFileSync(path.join(fixturesPath, '.tactica', 'hierarchy.json'), path.join(emptyDir, '.tactica', 'hierarchy.json'));
	fs.copyFileSync(path.join(fixturesPath, '.tactica', 'definitions.json'), path.join(emptyDir, '.tactica', 'definitions.json'));
	const appeared = await getProjectRegistry(emptyDir);
	assert.ok(appeared, 'a later-created .tactica loads (the miss was not cached)');
	fs.rmSync(emptyDir, { recursive: true, force: true });
	console.log('  ✓ miss not cached\n');

	await testKeyNormalization();
	await testSidebarPlusFollowPanel();

	console.log('=== All Tests Passed ===');
}

// Test 4: store keys are normalized — two spellings of one directory
// share one entry (no double load)
async function testKeyNormalization() {
	console.log('Test 4: two spellings of one directory share one entry');
	clearProjectRegistries();
	readCounts.clear();
	const plain = await getProjectRegistry(fixturesPath);
	const dotted = await getProjectRegistry(path.join(fixturesPath, '.'));
	const trailed = await getProjectRegistry(fixturesPath + path.sep);
	assert.ok(plain, 'loaded');
	assert.strictEqual(dotted, plain, 'dot-suffixed path resolves to the same instance');
	assert.strictEqual(trailed, plain, 'trailing-slash path resolves to the same instance');
	assert.strictEqual(readCounts.get('hierarchy.json') || 0, 1, 'hierarchy.json read once across all spellings');
	console.log('  ✓ one entry for all spellings\n');
}

// Test 5: one watcher-driven reload with the sidebar + one follow panel
// on the same project — each contract file read exactly once, both
// consumers rebuild from the loaded Registry (zero reads there)
async function testSidebarPlusFollowPanel() {
	console.log('Test 5: sidebar + follow panel — one reload, one read per file');
	clearProjectRegistries();
	await getProjectRegistry(fixturesPath);

	let sidebarRebuilds = 0;
	let panelRebuilds = 0;
	onProjectRegistryReload((sourceRoot, origin) => {
		if (sourceRoot !== path.resolve(fixturesPath)) { return; }
		// the sidebar refreshes itself on its own refreshes; a watcher or
		// panel reload re-pulls its trees — either way: no file reads
		if (origin !== 'sidebar') {
			const registry = peekProjectRegistry(fixturesPath);
			GraphBuilder.buildFromRegistry(registry);
			sidebarRebuilds++;
		}
		// the follow panel rebuilds from the same loaded entry
		const panelRegistry = peekProjectRegistry(fixturesPath);
		GraphBuilder.buildFromRegistry(panelRegistry);
		panelRebuilds++;
	});

	readCounts.clear();
	await reloadProjectRegistry(fixturesPath, 'watcher');
	for (const file of CONTRACT_FILES) {
		assert.strictEqual(readCounts.get(file) || 0, 1, `${file} read exactly once (got ${readCounts.get(file) || 0})`);
	}
	assert.strictEqual(sidebarRebuilds, 1, 'the sidebar rebuilt once');
	assert.strictEqual(panelRebuilds, 1, 'the follow panel rebuilt once');
	console.log('  ✓ one reload, one read per file, both consumers rebuilt\n');
}

runTests().catch(err => {
	console.error('Test failed:', err);
	process.exit(1);
});
