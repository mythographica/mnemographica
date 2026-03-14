'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../services/LoggerService';

type TreeNodeType = 'root' | 'type' | 'subtype' | 'definition';

type MnemonicaTreeItemData = {
	label: string;
	type: TreeNodeType;
	fullPath?: string;
	line?: number;
	column?: number;
	// Track which section this item belongs to for proper child lookup
	isDefinition?: boolean;
	// Full definition name for lookup (needed when label is shortened for display)
	fullName?: string;
};

type DefinitionData = {
	id: string;
	name: string;
	fullPath: string;
	parent?: string;
	line: number;
	column: number;
	// Full hierarchical name for child lookups (e.g., "Scene2D.GraphNode2D")
	fullName: string;
};

type TypeData = {
	name: string;
	fullName: string;  // Full hierarchical name for usage lookup
	parent?: string;
	fullPath?: string;
	line?: number;
};

export class MnemonicaTreeItem extends vscode.TreeItem {
	constructor (
		public readonly data: MnemonicaTreeItemData,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(data.label, collapsibleState);
		this.iconPath = this.getIconPath(data.type);
		this.tooltip = `${data.type}: ${data.label}`;

		// Set contextValue for all navigable items (those with fullPath)
		// Right-click context menu uses this
		if (data.fullPath) {
			this.contextValue = 'navigable';
		}

		// Note: Double-click detection is handled in extension.ts via onDidChangeSelection
		// Single clicks let VS Code handle selection and expand/collapse naturally
	}

	private getIconPath (type: TreeNodeType): vscode.ThemeIcon {
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

export class MnemonicaTreeProvider implements vscode.TreeDataProvider<MnemonicaTreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<MnemonicaTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private definitions: Map<string, DefinitionData> = new Map();
	private types: Map<string, TypeData> = new Map();
	private debug = true; // Enable debug logging
	private logger = getLogger();

	refresh (): void {
		this._onDidChangeTreeData.fire();
	}

	async loadDefinitions (workspacePath: string): Promise<void> {
		this.definitions.clear();
		this.types.clear();

		// Load definitions
		const definitionsPath = path.join(workspacePath, '.tactica', 'definitions.json');
		if (fs.existsSync(definitionsPath)) {
			const content = fs.readFileSync(definitionsPath, 'utf-8');
			const data = JSON.parse(content) as {
				definitions: Record<string, {
					name: string;
					location: string;
					kind: string;
					parent: string | null;
					strictChain: boolean;
					blockErrors: boolean;
				}>
			};

			for (const [key, info] of Object.entries(data.definitions)) {
				// Parse location: "/path/to/file.ts:line:column"
				const locationMatch = info.location.match(/^(.+):(\d+):(\d+)$/);
				const filePath = locationMatch ? locationMatch[1] : info.location;
				const line = locationMatch ? parseInt(locationMatch[2], 10) : 0;
				const column = locationMatch ? parseInt(locationMatch[3], 10) : 0;

				// Store with the full key as fullName for proper hierarchical lookups
				this.definitions.set(key, {
					id: `${key}:${line}:${column}`,
					name: info.name,
					fullPath: filePath,
					parent: info.parent || undefined,
					line,
					column,
					fullName: key  // This is the full hierarchical name like "Scene2D.GraphNode2D"
				});
			}

			if (this.debug) {
				this.logger.info(`[MnemonicaTree] Loaded ${this.definitions.size} definitions`);
				this.logger.info(`[MnemonicaTree] Definitions: ${Array.from(this.definitions.keys()).join(', ')}`);
			}
		}

		// Load types hierarchy from types.ts
		const typesPath = path.join(workspacePath, '.tactica', 'types.ts');
		if (fs.existsSync(typesPath)) {
			const content = fs.readFileSync(typesPath, 'utf-8');
			const lines = content.split('\n');

			// Parse: export type TypeName = Parent & { ... }
			// OR: export type TypeName = ProtoFlat<Parent, { ... }>
			const typeRegex = /export\s+type\s+(\w+)\s*=\s*(?:(\w+)\s*&|ProtoFlat<(\w+),)?/;

			for (let i = 0; i < lines.length; i++) {
				const match = typeRegex.exec(lines[i]);
				if (match) {
					const parent = match[2] || match[3] || undefined;
					this.types.set(match[1], {
						name: match[1],
						fullName: match[1],  // Root types use name as fullName
						parent,
						fullPath: typesPath,
						line: i  // 0-based, will be converted to 0-based for vscode Range
					});
				}
			}

			if (this.debug) {
				this.logger.info(`[MnemonicaTree] Loaded ${this.types.size} types`);
			}
		}

		this.refresh();
	}

	getTreeItem (element: MnemonicaTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren (element?: MnemonicaTreeItem): Promise<MnemonicaTreeItem[]> {
		if (!element) {
			// Root level - return section roots
			return [
				new MnemonicaTreeItem({ label: 'Definitions', type: 'root' }, vscode.TreeItemCollapsibleState.Expanded),
				new MnemonicaTreeItem({ label: 'Types', type: 'root' }, vscode.TreeItemCollapsibleState.Collapsed)
			];
		}

		// Definitions section root
		if (element.data.label === 'Definitions') {
			const roots = this.getRootDefinitions();
			if (this.debug) {
				this.logger.info(`[MnemonicaTree] Root definitions: ${roots.map(r => r.name).join(', ')}`);
			}
			return roots.map(def => this.createDefinitionItem(def));
		}

		// Types section root - only match if type is 'root'
		if (element.data.label === 'Types' && element.data.type === 'root') {
			return this.getRootTypes().map(type => this.createTypeItem(type));
		}

		// For Definition items - check using definition parent relationships
		// Use fullName for lookup, fallback to label if fullName not set
		if (element.data.isDefinition) {
			const lookupName = element.data.fullName || element.data.label;
			const defChildren = this.getChildDefinitions(lookupName);

			if (this.debug) {
				this.logger.info(`[MnemonicaTree] getChildren for definition "${lookupName}": found ${defChildren.length} children`);
				this.logger.info(`[MnemonicaTree]   Children: ${defChildren.map(c => c.name).join(', ')}`);
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

	private getRootDefinitions (): DefinitionData[] {
		const roots: DefinitionData[] = [];
		for (const def of this.definitions.values()) {
			if (!def.parent) {
				roots.push(def);
			}
		}
		return roots.sort((a, b) => a.name.localeCompare(b.name));
	}

	private getChildDefinitions (parentName: string): DefinitionData[] {
		const children: DefinitionData[] = [];
		for (const def of this.definitions.values()) {
			if (def.parent === parentName) {
				children.push(def);
			}
		}
		return children.sort((a, b) => a.name.localeCompare(b.name));
	}

	private getRootTypes (): TypeData[] {
		const roots: TypeData[] = [];
		for (const type of this.types.values()) {
			if (!type.parent) {
				roots.push(type);
			}
		}
		return roots.sort((a, b) => a.name.localeCompare(b.name));
	}

	private getChildTypes (parentName: string): TypeData[] {
		const children: TypeData[] = [];
		for (const type of this.types.values()) {
			// Match by exact parent name (types use full Instance names)
			if (type.parent === parentName) {
				children.push(type);
			}
		}
		return children.sort((a, b) => a.name.localeCompare(b.name));
	}

	private createDefinitionItem (def: DefinitionData): MnemonicaTreeItem {
		const shortName = def.name.includes('.') ? def.name.split('.').pop()! : def.name;
		const hasChildren = this.getChildDefinitions(def.fullName).length > 0;

		if (this.debug) {
			this.logger.info(`[MnemonicaTree] createDefinitionItem: ${def.name} (short: ${shortName}), fullName: ${def.fullName}, hasChildren: ${hasChildren}`);
		}

		return new MnemonicaTreeItem(
			{
				label: shortName,
				type: hasChildren ? 'type' : 'definition',
				fullPath: def.fullPath,
				line: def.line,
				column: def.column,
				isDefinition: true,
				fullName: def.fullName  // Use fullName (the key) for lookups
			},
			hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
		);
	}

	private createTypeItem (type: TypeData): MnemonicaTreeItem {
		const shortName = type.name.includes('_') ? type.name.split('_').pop()! : type.name;
		const hasChildren = this.getChildTypes(type.name).length > 0;
		return new MnemonicaTreeItem(
			{
				label: shortName,
				type: hasChildren ? 'type' : 'subtype',
				isDefinition: false,
				fullPath: type.fullPath,
				line: type.line,
				column: 0,
				fullName: type.fullName  // Pass fullName for usage lookup
			},
			hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
		);
	}

	clear (): void {
		this.definitions.clear();
		this.types.clear();
		this.refresh();
	}
}
