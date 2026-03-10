'use strict';

// Standalone test to diagnose tree provider issues
// Run with: node test-tree.js

const fs = require('fs');
const path = require('path');
const os = require('os');

// Simple mock for vscode
const vscode = {
	TreeItem: class TreeItem {
		constructor(label, collapsibleState) {
			this.label = label;
			this.collapsibleState = collapsibleState;
		}
	},
	TreeItemCollapsibleState: {
		None: 0,
		Collapsed: 1,
		Expanded: 2
	},
	ThemeIcon: class ThemeIcon {
		constructor(name) { this.name = name; }
	},
	Uri: { file: (path) => path },
	Range: class Range {
		constructor(sL, sC, eL, eC) {
			this.start = { line: sL, character: sC };
			this.end = { line: eL, character: eC };
		}
	}
};

// Copy of MnemonicaTreeItem from treeProvider.ts
class MnemonicaTreeItem extends vscode.TreeItem {
	constructor(data, collapsibleState) {
		super(data.label, collapsibleState);
		this.data = data;
		this.iconPath = this.getIconPath(data.type);
		this.tooltip = `${data.type}: ${data.label}`;

		if (data.type === 'definition' && data.fullPath) {
			this.command = {
				command: 'vscode.open',
				title: 'Open Definition',
				arguments: [
					vscode.Uri.file(data.fullPath),
					{
						selection: new vscode.Range(
							data.line ?? 0,
							data.column ?? 0,
							data.line ?? 0,
							data.column ?? 0
						)
					}
				]
			};
		}
	}

	getIconPath(type) {
		switch (type) {
			case 'root':
				return new vscode.ThemeIcon('folder');
			case 'type':
				return new vscode.ThemeIcon('symbol-class');
			case 'subtype':
				return new vscode.ThemeIcon('symbol-type-parameter');
			case 'definition':
				return new vscode.ThemeIcon('symbol-method');
			default:
				return new vscode.ThemeIcon('symbol-misc');
		}
	}
}

// Simplified version of MnemonicaTreeProvider for testing
class TestTreeProvider {
	constructor() {
		this.definitions = new Map();
		this.types = new Map();
		this.debug = true;
	}

	async loadDefinitions(workspacePath) {
		this.definitions.clear();
		this.types.clear();

		// Load definitions
		const definitionsPath = path.join(workspacePath, '.tactica', 'definitions.json');
		if (fs.existsSync(definitionsPath)) {
			const content = fs.readFileSync(definitionsPath, 'utf-8');
			const data = JSON.parse(content);

			for (const [key, info] of Object.entries(data.definitions)) {
				const locationMatch = info.location.match(/^(.+):(\d+):(\d+)$/);
				const filePath = locationMatch ? locationMatch[1] : info.location;
				const line = locationMatch ? parseInt(locationMatch[2], 10) : 0;
				const column = locationMatch ? parseInt(locationMatch[3], 10) : 0;

				this.definitions.set(key, {
					id: `${key}:${line}:${column}`,
					name: info.name,
					fullPath: filePath,
					parent: info.parent || undefined,
					line,
					column
				});
			}

			if (this.debug) {
				console.log(`[TestTree] Loaded ${this.definitions.size} definitions`);
				console.log(`[TestTree] Definitions: ${Array.from(this.definitions.keys()).join(', ')}`);
			}
		}

		// Load types hierarchy from types.ts
		const typesPath = path.join(workspacePath, '.tactica', 'types.ts');
		if (fs.existsSync(typesPath)) {
			const content = fs.readFileSync(typesPath, 'utf-8');
			const typeRegex = /export\s+type\s+(\w+)\s*=\s*(\w+)?\s*&?\s*\{/g;
			let match;
			while ((match = typeRegex.exec(content)) !== null) {
				this.types.set(match[1], {
					name: match[1],
					parent: match[2] || undefined
				});
			}

			if (this.debug) {
				console.log(`[TestTree] Loaded ${this.types.size} types`);
			}
		}
	}

	async getChildren(element) {
		if (!element) {
			return [
				new MnemonicaTreeItem({ label: 'Definitions', type: 'root' }, vscode.TreeItemCollapsibleState.Expanded),
				new MnemonicaTreeItem({ label: 'Types', type: 'root' }, vscode.TreeItemCollapsibleState.Collapsed)
			];
		}

		if (this.debug) {
			console.log(`[TestTree] getChildren called for:`, JSON.stringify(element.data));
			console.log(`[TestTree] typeof isDefinition: ${typeof element.data.isDefinition}, value: ${element.data.isDefinition}`);
		}

		// Definitions section root
		if (element.data.label === 'Definitions') {
			const roots = this.getRootDefinitions();
			if (this.debug) {
				console.log(`[TestTree] Root definitions: ${roots.map(r => r.name).join(', ')}`);
			}
			return roots.map(def => this.createDefinitionItem(def));
		}

		// Types section root
		if (element.data.label === 'Types') {
			return this.getRootTypes().map(type => this.createTypeItem(type));
		}

		// For Definition items - check using definition parent relationships
		// Use fullName for lookup, fallback to label if fullName not set
		if (element.data.isDefinition) {
			const lookupName = element.data.fullName || element.data.label;
			const defChildren = this.getChildDefinitions(lookupName);

			if (this.debug) {
				console.log(`[TestTree] getChildren for definition "${lookupName}": found ${defChildren.length} children`);
				console.log(`[TestTree]   Children: ${defChildren.map(c => c.name).join(', ')}`);
			}

			if (defChildren.length > 0) {
				return defChildren.map(def => this.createDefinitionItem(def));
			}
			// Definition items should not fall through to type lookup
			return [];
		}

		// For Type items - check using type parent relationships
		const typeChildren = this.getChildTypes(element.data.label);
		if (typeChildren.length > 0) {
			return typeChildren.map(type => this.createTypeItem(type));
		}

		return [];
	}

	getRootDefinitions() {
		const roots = [];
		for (const def of this.definitions.values()) {
			if (!def.parent) {
				roots.push(def);
			}
		}
		return roots.sort((a, b) => a.name.localeCompare(b.name));
	}

	getChildDefinitions(parentName) {
		const children = [];
		if (this.debug) {
			console.log(`[TestTree] Looking for children of "${parentName}"`);
			console.log(`[TestTree] All definitions:`, Array.from(this.definitions.entries()).map(([k, v]) => `${k} (parent=${v.parent})`).join(', '));
		}
		for (const [key, def] of this.definitions.entries()) {
			if (this.debug) {
				console.log(`[TestTree] Checking ${key}: parent="${def.parent}" vs lookup="${parentName}" -> match=${def.parent === parentName}`);
			}
			if (def.parent === parentName) {
				children.push(def);
			}
		}
		if (this.debug) {
			console.log(`[TestTree] Found ${children.length} children: ${children.map(c => c.name).join(', ')}`);
		}
		return children.sort((a, b) => a.name.localeCompare(b.name));
	}

	getRootTypes() {
		const roots = [];
		for (const type of this.types.values()) {
			if (!type.parent) {
				roots.push(type);
			}
		}
		return roots.sort((a, b) => a.name.localeCompare(b.name));
	}

	getChildTypes(parentName) {
		const children = [];
		for (const type of this.types.values()) {
			if (type.parent === parentName) {
				children.push(type);
			}
		}
		return children.sort((a, b) => a.name.localeCompare(b.name));
	}

	createDefinitionItem(def) {
		const shortName = def.name.includes('.') ? def.name.split('.').pop() : def.name;
		const hasChildren = this.getChildDefinitions(def.name).length > 0;

		if (this.debug) {
			console.log(`[TestTree] createDefinitionItem: ${def.name} (short: ${shortName}), hasChildren: ${hasChildren}`);
		}

		return new MnemonicaTreeItem(
			{
				label: shortName,
				type: hasChildren ? 'type' : 'definition',
				fullPath: def.fullPath,
				line: def.line,
				column: def.column,
				isDefinition: true,
				fullName: def.name
			},
			hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
		);
	}

	createTypeItem(type) {
		const hasChildren = this.getChildTypes(type.name).length > 0;
		return new MnemonicaTreeItem(
			{ label: type.name, type: hasChildren ? 'type' : 'subtype', isDefinition: false },
			hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
		);
	}
}

async function runTests() {
	console.log('=== Testing MnemonicaTreeProvider ===\n');

	const provider = new TestTreeProvider();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemonica-test-'));

	// Create mock definitions.json
	const tacticaDir = path.join(tempDir, '.tactica');
	fs.mkdirSync(tacticaDir, { recursive: true });

	const definitions = {
		version: '1.0',
		generatedAt: new Date().toISOString(),
		definitions: {
			'Types': {
				name: 'Types',
				location: '/test/Types.ts:5:22',
				kind: 'define',
				parent: null,
				strictChain: true,
				blockErrors: false
			},
			'Types.TypeEntry': {
				name: 'TypeEntry',
				location: '/test/Types.ts:9:26',
				kind: 'define',
				parent: 'Types',
				strictChain: true,
				blockErrors: false
			}
		}
	};

	fs.writeFileSync(
		path.join(tacticaDir, 'definitions.json'),
		JSON.stringify(definitions, null, 2)
	);

	// Create mock types.ts
	fs.writeFileSync(
		path.join(tacticaDir, 'types.ts'),
		`export type TypesInstance = { createdAt: number; }
export type TypeEntryInstance = TypesInstance & { id: string; }`
	);

	// Load definitions
	await provider.loadDefinitions(tempDir);

	// Get root children
	console.log('\n=== Test: Get Definitions section ===');
	const roots = await provider.getChildren(undefined);
	const definitionsSection = roots[0];
	console.log(`Definitions section: ${definitionsSection.data.label}`);

	// Get Definitions section children
	const defChildren = await provider.getChildren(definitionsSection);
	console.log(`\nDefinition children: ${defChildren.map(r => `${r.data.label} (isDef=${r.data.isDefinition}, fullName=${r.data.fullName})`).join(', ')}`);

	// Find Types definition
	const typesDef = defChildren.find(c => c.data.label === 'Types');
	console.log(`\n=== Test: EXPAND Types definition (BUG CHECK) ===`);
	console.log(`Types item: label="${typesDef.data.label}", type="${typesDef.data.type}", isDefinition=${typesDef.data.isDefinition}, fullName="${typesDef.data.fullName}"`);

	const typesChildren = await provider.getChildren(typesDef);
	console.log(`\nChildren of Types definition:`);
	typesChildren.forEach(c => {
		console.log(`  - ${c.data.label} (isDef=${c.data.isDefinition})`);
	});

	// Check if we got the right result
	if (typesChildren.some(c => c.data.label === 'TypeEntryInstance')) {
		console.log('\n❌ BUG CONFIRMED: Got TypeEntryInstance (type) instead of TypeEntry (definition)');
		console.log('❌ This means isDefinition check is NOT working correctly');
	} else if (typesChildren.some(c => c.data.label === 'TypeEntry')) {
		console.log('\n✅ PASSED: Got TypeEntry (definition) as expected');
	} else {
		console.log(`\n⚠️  UNEXPECTED: Got ${typesChildren.map(c => c.data.label).join(', ')}`);
	}

	// Cleanup
	fs.rmSync(tempDir, { recursive: true, force: true });

	console.log('\n=== Test Complete ===');
}

runTests().catch(console.error);
