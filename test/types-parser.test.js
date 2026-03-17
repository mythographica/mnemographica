'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Simple test of the types.ts parser logic (without VS Code dependencies)
function testTypesParser () {
	console.log('=== Testing Types.ts Parser Logic ===\n');

	const typesPath = path.join(__dirname, '../.tactica/types.ts');
	const content = fs.readFileSync(typesPath, 'utf-8');
	const lines = content.split('\n');

	// Same regex as Types.ts (updated to handle root types)
	const typeRegex = /export\s+type\s+(\w+)\s*=\s*(?:(?:ProtoFlat<(\w+),)|(?:(\w+)\s*&))?[\s\n]*\{/;

	const types = new Map();
	const selfReferential = [];

	console.log('Parsing types.ts...\n');

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const match = typeRegex.exec(line);
		if (match) {
			const name = match[1];
			// match[2] = ProtoFlat parent, match[3] = & parent
			let parent = match[2] || match[3] || undefined;

			// Check for self-reference
			if (parent === name) {
				selfReferential.push({ name, line: i + 1 });
				console.log(`⚠️  Self-referential: ${name} at line ${i + 1}`);
				continue;
			}

			types.set(name, { name, parent, line: i + 1 });
		}
	}

	console.log(`\n✓ Parsed ${types.size} types`);
	console.log(`⚠️  Skipped ${selfReferential.length} self-referential types\n`);

	// Test 1: Root types
	console.log('Test 1: Root types (no parent)');
	const rootTypes = ['Definitions', 'LoggerTab', 'Main', 'Registry', 'Scene2D', 'Scene3D', 'Trie', 'Types', 'Usages'];
	for (const name of rootTypes) {
		const type = types.get(name);
		assert.ok(type, `Should have ${name}`);
		assert.strictEqual(type.parent, undefined, `${name} should have no parent`);
		console.log(`  ✓ ${name}`);
	}

	// Test 2: Nested types
	console.log('\nTest 2: Scene2D nested types');
	const scene2dNested = ['Scene2D_Camera2D', 'Scene2D_GraphNode2D'];
	for (const name of scene2dNested) {
		const type = types.get(name);
		assert.ok(type, `Should have ${name}`);
		assert.strictEqual(type.parent, 'Scene2D', `${name} parent should be Scene2D`);
		console.log(`  ✓ ${name} → parent: ${type.parent}`);
	}

	// Test 3: Deep nested types
	console.log('\nTest 3: GraphNode2D deep nested types');
	const graphNode2dNested = ['Scene2D_GraphNode2D_Link2D', 'Scene2D_GraphNode2D_Tooltip2D'];
	for (const name of graphNode2dNested) {
		const type = types.get(name);
		assert.ok(type, `Should have ${name}`);
		assert.strictEqual(type.parent, 'Scene2D_GraphNode2D', `${name} parent should be Scene2D_GraphNode2D`);
		console.log(`  ✓ ${name} → parent: ${type.parent}`);
	}

	// Test 4: No self-referential types
	console.log('\nTest 4: No self-referential types in output');
	assert.strictEqual(selfReferential.length, 0, 'Should have no self-referential types');
	console.log('  ✓ No self-referential types found');

	console.log('\n=== All Tests Passed ===');
}

testTypesParser();
