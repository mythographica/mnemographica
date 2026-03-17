'use strict';

const fs = require('fs');
const path = require('path');

const workspacePath = path.join(__dirname, '..');
const definitionsPath = path.join(workspacePath, '.tactica', 'definitions.json');

const content = fs.readFileSync(definitionsPath, 'utf-8');
const data = JSON.parse(content);

console.log('=== All Definitions ===');
for (const [key, info] of Object.entries(data.definitions)) {
    console.log(`${key}: parent=${info.parent}`);
}

console.log('\n=== Children of "Definitions" ===');
for (const [key, info] of Object.entries(data.definitions)) {
    if (info.parent === 'Definitions') {
        console.log(`${key}: parent=${info.parent}`);
    }
}

console.log('\n=== Root Definitions (parent=null) ===');
for (const [key, info] of Object.entries(data.definitions)) {
    if (info.parent === null) {
        console.log(`${key}: parent=${info.parent}`);
    }
}
