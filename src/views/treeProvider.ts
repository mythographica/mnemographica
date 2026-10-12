'use strict';

import * as vscode from 'vscode';
import { getLogger } from '../services/LoggerService';
import { parseTacticaLocation } from '../utils/paths';
import type { Registry } from '../../.tactica/types';

type TreeNodeType = 'root' | 'type' | 'subtype' | 'definition';

export type MnemonicaTreeItemData = {
	label: string;
	type: TreeNodeType;
	fullPath?: string;
	line?: number;
	column?: number;
	// Full definition name for lookup (needed when label is shortened for display)
	fullName?: string;
};

// The stable item id — shared by the MnemonicaTreeItem constructor and
// the provider's click-to-expand lookup, which must reproduce the id
// from the command's bare data payload
const treeItemId = function (data: MnemonicaTreeItemData): string {
	const id = data.type === 'root'
		? `root:${data.label}`
		: `def:${data.fullName || data.label}`;
	return id;
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

export class MnemonicaTreeItem extends vscode.TreeItem {
	constructor (
		public readonly data: MnemonicaTreeItemData,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(data.label, collapsibleState);
		this.iconPath = this.getIconPath(data.type);
		this.tooltip = `${data.type}: ${data.label}`;

		// Stable id: TreeView.reveal (used by agent automation via the
		// debug handle) resolves items by identity
		this.id = treeItemId(data);

		// Set contextValue for all navigable items (those with fullPath)
		// Right-click context menu uses this
		if (data.fullPath) {
			this.contextValue = 'navigable';
			// onDidChangeSelection never fires when the ALREADY-SELECTED row
			// is clicked again, so the focus/selection action also rides an
			// item command — it executes on EVERY click, and a re-click
			// re-selects the item's path in the 3D graph. The action itself
			// lives in extension.ts behind 'mnemographica.treeItemClick'
			this.command = {
				command   : 'mnemographica.treeItemClick',
				title     : 'Focus Type',
				arguments : [data]
			};
		}

		// Selection and the click action live in extension.ts
		// (onDidChangeSelection + the treeItemClick command above). With a
		// command set, single-click expansion is twistie-only — a
		// double-click on the label still toggles it
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
	// Displayed items by their stable id — the treeItemClick command
	// carries only the data payload, so click-to-expand resolves the
	// live item here (TreeView.reveal needs the instance)
	private itemsById: Map<string, MnemonicaTreeItem> = new Map();
	// Off by default: the gated per-item/per-expansion logs below are
	// debug-era noise (hundreds of lines per boot). Flip to true when
	// working on the tree itself.
	private debug = false;
	private logger = getLogger();
	private currentWorkspacePath: string | undefined;
	private registry: Registry | undefined;

	refresh (): void {
		// The tree re-fetches displayed items after this — cached
		// instances from before the refresh would fail reveal's
		// identity resolution
		this.itemsById.clear();
		this._onDidChangeTreeData.fire();
	}

	setWorkspace (workspacePath: string): void {
		this.currentWorkspacePath = workspacePath;
		this.logger.info('[MnemonicaTree] Workspace set to:', workspacePath);
	}

	getCurrentWorkspace (): string | undefined {
		return this.currentWorkspacePath;
	}

	setRegistry (registry: Registry): void {
		this.registry = registry;
		this.logger.info('[MnemonicaTree] Registry set');
	}

	async loadFromRegistry (): Promise<void> {
		if (!this.registry) {
			this.logger.warn('[MnemonicaTree] No registry set, cannot load');
			return;
		}

		this.definitions.clear();

		// Load definitions from registry
		const definitionsModel = this.registry.getDefinitions();
		if (definitionsModel) {
			for (const [key, entry] of definitionsModel.entries()) {
				// Type from .tactica/types.ts: Definitions_DefinitionEntry
				const info = entry as unknown as {
					name: string;
					location: string;
					parent: string | unknown;
				};

				// Parse location: "/path/to/file.ts:line:column"; a bare
				// path (no :line:col) still navigates, from the top
				const parsed = parseTacticaLocation(info.location);
				const filePath = parsed ? parsed.fileName : info.location;
				const line = parsed ? parsed.line : 0;
				const column = parsed ? parsed.column : 0;

				// Store with the full key as fullName for proper hierarchical lookups
				this.definitions.set(key, {
					id: `${key}:${line}:${column}`,
					name: info.name,
					fullPath: filePath,
					parent: typeof info.parent === 'string' ? info.parent : undefined,
					line,
					column,
					fullName: key  // This is the full hierarchical name like "Scene2D.GraphNode2D"
				});
			}

			if (this.debug) {
				this.logger.info(`[MnemonicaTree] Loaded ${this.definitions.size} definitions from registry`);
			}
		}

		this.refresh();
	}

	getTreeItem (element: MnemonicaTreeItem): vscode.TreeItem {
		return element;
	}

	// Required for TreeView.reveal — walks the same parent links the
	// children lookups use
	async getParent (element: MnemonicaTreeItem): Promise<MnemonicaTreeItem | undefined> {
		if (element.data.type === 'root') {
			return undefined;
		}
		const def = this.definitions.get(element.data.fullName || element.data.label);
		if (def && def.parent) {
			const parentDef = this.definitions.get(def.parent);
			if (parentDef) {
				const parentItem = this.createDefinitionItem(parentDef);
				return parentItem;
			}
		}
		const rootItem = new MnemonicaTreeItem({ label: 'Definitions', type: 'root' }, vscode.TreeItemCollapsibleState.Expanded);
		return rootItem;
	}

	// The live item for a command's data payload, when currently
	// displayed — TreeView.reveal resolves by instance identity, and
	// the treeItemClick command carries only the data
	getCachedItem (data: MnemonicaTreeItemData): MnemonicaTreeItem | undefined {
		const item = this.itemsById.get(treeItemId(data));
		return item;
	}

	async getChildren (element?: MnemonicaTreeItem): Promise<MnemonicaTreeItem[]> {
		if (!element) {
			// Root level - the Definitions section (define() sites)
			return [
				new MnemonicaTreeItem({ label: 'Definitions', type: 'root' }, vscode.TreeItemCollapsibleState.Expanded)
			];
		}

		// Definitions section root - only match if type is 'root'
		if (element.data.label === 'Definitions' && element.data.type === 'root') {
			const roots = this.getRootDefinitions();
			if (this.debug) {
				this.logger.info(`[MnemonicaTree] Root definitions: ${roots.map(r => r.name).join(', ')}`);
			}
			return roots.map(def => this.createDefinitionItem(def));
		}

		// For Definition items - check using definition parent relationships
		// Use fullName for lookup, fallback to label if fullName not set
		const lookupName = element.data.fullName || element.data.label;
		const defChildren = this.getChildDefinitions(lookupName);

		if (this.debug) {
			this.logger.info(`[MnemonicaTree] getChildren for definition "${lookupName}": found ${defChildren.length} children`);
			this.logger.info(`[MnemonicaTree]   Children: ${defChildren.map(c => c.name).join(', ')}`);
		}

		return defChildren.map(def => this.createDefinitionItem(def));
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

	private createDefinitionItem (def: DefinitionData): MnemonicaTreeItem {
		const shortName = def.name.includes('.') ? def.name.split('.').pop()! : def.name;
		const hasChildren = this.getChildDefinitions(def.fullName).length > 0;

		if (this.debug) {
			this.logger.info(`[MnemonicaTree] createDefinitionItem: ${def.name} (short: ${shortName}), fullName: ${def.fullName}, hasChildren: ${hasChildren}`);
		}

		const item = new MnemonicaTreeItem(
			{
				label: shortName,
				type: hasChildren ? 'type' : 'definition',
				fullPath: def.fullPath,
				line: def.line,
				column: def.column + 9, // define(' === 9
				fullName: def.fullName  // Use fullName (the key) for lookups
			},
			hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
		);
		// Cache by stable id so the treeItemClick command's data payload
		// can resolve back to the live instance for click-to-expand
		this.itemsById.set(treeItemId(item.data), item);
		return item;
	}

	clear (): void {
		this.definitions.clear();
		this.refresh();
	}
}
