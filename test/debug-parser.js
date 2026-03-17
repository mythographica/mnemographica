'use strict';

const fs = require('fs');
const content = fs.readFileSync('.tactica/types.ts', 'utf-8');
const lines = content.split('\n');
const regex = /export\s+type\s+(\w+)\s*=\s*(?:(\w+)\s*&|ProtoFlat<(\w+),)?/;

console.log('Lines matching regex:');
for (let i = 0; i < lines.length; i++) {
	const match = regex.exec(lines[i]);
	if (match) {
		console.log(`Line ${i + 1}: ${lines[i].trim().substring(0, 60)}...`);
		console.log(`  name: ${match[1]}, parent2: ${match[2]}, parent3: ${match[3]}`);
	}
}
