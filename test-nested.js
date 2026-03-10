'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Test nested definitions lookup
const definitions = new Map();

definitions.set('Scene2D', {
    name: 'Scene2D',
    fullPath: '/test/Scene2D.ts',
    parent: undefined,
    line: 5, column: 24
});

definitions.set('Scene2D.GraphNode2D', {
    name: 'GraphNode2D',
    fullPath: '/test/Scene2D.ts',
    parent: 'Scene2D',
    line: 18, column: 28
});

definitions.set('Scene2D.GraphNode2D.Link2D', {
    name: 'Link2D',
    fullPath: '/test/Scene2D.ts',
    parent: 'Scene2D.GraphNode2D',
    line: 30, column: 23
});

definitions.set('Scene2D.GraphNode2D.Tooltip2D', {
    name: 'Tooltip2D',
    fullPath: '/test/Scene2D.ts',
    parent: 'Scene2D.GraphNode2D',
    line: 39, column: 26
});

console.log('All definitions:');
for (const [key, def] of definitions.entries()) {
    console.log(`  ${key}: name="${def.name}", parent="${def.parent}"`);
}

function getChildDefinitions(parentName) {
    const children = [];
    console.log(`\nLooking for children of "${parentName}"`);
    for (const [key, def] of definitions.entries()) {
        const match = def.parent === parentName;
        console.log(`  Checking ${key}: parent="${def.parent}" vs "${parentName}" -> ${match}`);
        if (match) {
            children.push(def);
        }
    }
    console.log(`Found ${children.length} children: ${children.map(c => c.name).join(', ')}`);
    return children;
}

// Test: Get children of Scene2D
console.log('\n=== Get children of Scene2D ===');
getChildDefinitions('Scene2D');

// Test: Get children of Scene2D.GraphNode2D
console.log('\n=== Get children of Scene2D.GraphNode2D ===');
getChildDefinitions('Scene2D.GraphNode2D');
