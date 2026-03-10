'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const vscode = {
	TreeItem: class TreeItem {
		constructor(label, collapsibleState) {
			this.label = label;
			this.collapsibleState = collapsibleState;
		}
	},
	TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
	ThemeIcon: class ThemeIcon { constructor(name) { this.name = name; } },
	Uri: { file: (p) => p },
	Range: class Range { constructor(sL, sC, eL, eC) {} }
};

class MnemonicaTreeItem extends vscode.TreeItem {
	constructor(data, collapsibleState) {
		super(data.label, collapsibleState);
		this.data = data;
	}
}

class TestTreeProvider {
	constructor() {
		this.definitions = new Map();
		this.types = new Map();
	}

	async getChildren(element) {
		if (!element) {
			return [
				new MnemonicaTreeItem({ label: 'Definitions', type: 'root' }, vscode.TreeItemCollapsibleState.Expanded),
			];
		}

		console.log('=== getChildren debug ===');
		console.log('element.data:', JSON.stringify(element.data));
		console.log('element.data.isDefinition:', element.data.isDefinition);
		console.log('element.data.isDefinition === true:', element.data.isDefinition === true);
		console.log('typeof element.data.isDefinition:', typeof element.data.isDefinition);
		console.log('========================');

		if (element.data.label === 'Definitions') {
			const typesDef = {
				id: 'Types:5:22',
				name: 'Types',
				fullPath: '/test/Types.ts',
				parent: undefined,
				line: 5,
				column: 22
			};
			return [this.createDefinitionItem(typesDef)];
		}

		// For Definition items
		if (element.data.isDefinition) {
			console.log('✅ ENTERED isDefinition block');
			return [];
		}

		console.log('❌ Did NOT enter isDefinition block');
		return [];
	}

	createDefinitionItem(def) {
		return new MnemonicaTreeItem(
			{
				label: def.name,
				type: 'type',
				fullPath: def.fullPath,
				line: def.line,
				column: def.column,
				isDefinition: true,
				fullName: def.name
			},
			vscode.TreeItemCollapsibleState.Collapsed
		);
	}
}

async function runTest() {
	const provider = new TestTreeProvider();
	
	// Get Definitions section
	const roots = await provider.getChildren(undefined);
	const definitionsSection = roots[0];
	
	// Get children of Definitions
	const defChildren = await provider.getChildren(definitionsSection);
	console.log('\nDefinition children:', defChildren.map(c => c.data));
	
	// Now expand Types
	console.log('\n=== EXPANDING Types ===');
	const typesDef = defChildren[0];
	console.log('Before calling getChildren on typesDef:');
	console.log('typesDef.data:', typesDef.data);
	console.log('typesDef.data.isDefinition:', typesDef.data.isDefinition);
	
	await provider.getChildren(typesDef);
}

runTest().catch(console.error);
