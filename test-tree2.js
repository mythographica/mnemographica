'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// The EXACT same data object as createDefinitionItem creates
const testData = {
    label: 'Types',
    type: 'type',
    fullPath: '/test/Types.ts',
    line: 5,
    column: 22,
    isDefinition: true,
    fullName: 'Types'
};

console.log('Test data:', testData);
console.log('typeof isDefinition:', typeof testData.isDefinition);
console.log('isDefinition === true:', testData.isDefinition === true);
console.log('Boolean(isDefinition):', Boolean(testData.isDefinition));

if (testData.isDefinition) {
    console.log('✅ ENTERED isDefinition block');
} else {
    console.log('❌ DID NOT ENTER isDefinition block');
}

// Now test with undefined parent (like in definitions.json)
const definitions = new Map();
definitions.set('Types', {
    id: 'Types:5:22',
    name: 'Types',
    fullPath: '/test/Types.ts',
    parent: undefined,  // This is the key!
    line: 5,
    column: 22
});
definitions.set('Types.TypeEntry', {
    id: 'Types.TypeEntry:9:26',
    name: 'TypeEntry',
    fullPath: '/test/Types.ts',
    parent: 'Types',
    line: 9,
    column: 26
});

console.log('\n=== Checking getChildDefinitions ===');
const parentName = 'Types';
for (const [key, def] of definitions.entries()) {
    console.log(`Checking ${key}: parent="${def.parent}" vs lookup="${parentName}" -> match=${def.parent === parentName}`);
}
