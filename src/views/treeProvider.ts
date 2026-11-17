'use strict';

import * as vscode from 'vscode';
import { getLogger } from '../services/LoggerService';
import { parseTacticaLocation } from '../utils/paths';
import { createdTypes } from '../core/GraphBuilder';
import type { Registry } from '../../.tactica/types';

type TreeNodeType = 'root' | 'type' | 'definition';

// The Types view's usage filter (the title-bar toggle cycles them):
// 'unused' — only the types the construction census never sees created
// (the transparent spheres), 'used' — those hidden, 'all' — no filter
export type UsageMode = 'all' | 'unused' | 'used';

export type MnemonicaTreeItemData = {
	label: string;
	type: TreeNodeType;
	fullPath?: string;
	line?: number;
	column?: number;
	// Full definition name for lookup (needed when label is shortened for display)
	fullName?: string;
	// The Types filter key the item was built under: the text, plus the
	// usage mode when it filters ('' or absent: none)
	filter?: string;
};

// The stable item id — shared by the MnemonicaTreeItem constructor and
// the provider's click-to-expand lookup, which must reproduce the id
// from the command's bare data payload. Definition ids carry the filter
// text: VS Code keeps a row's expansion state by id and ignores the
// provider's collapsibleState for an id it already knows, so a filtered
// tree gets fresh ids (the path down to every match opens) and clearing
// the filter brings back the unfiltered rows' own expansion state
const treeItemId = function (data: MnemonicaTreeItemData): string {
	const name = data.fullName || data.label;
	const defId = data.filter
		? `def:${name}|filter:${data.filter}`
		: `def:${name}`;
	const id = data.type === 'root'
		? `root:${data.label}`
		: defId;
	return id;
};

type DefinitionData = {
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
	// The Types filter: a case-insensitive substring of the dotted
	// fullName. Every matching type shows with its whole family — its
	// ancestors (the path down to it, opened) and all its descendants.
	// '' shows everything
	private filterText = '';
	// The usage filter, combined with the text: a type matches when it
	// passes both. `created` is the census, re-read on every load
	// (undefined: no usages loaded, nothing counts as unused)
	private usageMode: UsageMode = 'all';
	private created: Set<string> | undefined;
	private filterVisible: Set<string> | undefined;
	private filterOpen: Set<string> = new Set();
	private filterMatchCount = 0;

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

	loadFromRegistry (): void {
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

		this.created = createdTypes(this.registry);

		// A reload keeps the filter text and usage mode and recomputes
		// their families
		this.computeFilter();
		this.refresh();
	}

	setFilter (text: string): void {
		this.filterText = text.trim();
		this.computeFilter();
		this.refresh();
	}

	getFilter (): string {
		return this.filterText;
	}

	setUsageMode (mode: UsageMode): void {
		this.usageMode = mode;
		this.computeFilter();
		this.refresh();
	}

	getUsageMode (): UsageMode {
		return this.usageMode;
	}

	// The key the item ids carry: a change of text or usage mode gives
	// the rows fresh ids (see treeItemId)
	private filterKey (): string {
		const key = this.usageMode === 'all'
			? this.filterText
			: `${this.filterText}|usage:${this.usageMode}`;
		return key;
	}

	private matchesUsage (def: DefinitionData): boolean {
		const unused = this.created !== undefined && !this.created.has(def.fullName);
		const matches = this.usageMode === 'all'
			|| (this.usageMode === 'unused' && unused)
			|| (this.usageMode === 'used' && !unused);
		return matches;
	}

	getFilterMatchCount (): number {
		return this.filterMatchCount;
	}

	// The item TreeView.reveal needs for a type's dotted fullName — the
	// 3D view's sphere ids are the same keys. undefined when the type is
	// unknown or hidden by the current filter
	getItemForName (fullName: string): MnemonicaTreeItem | undefined {
		const def = this.definitions.get(fullName);
		const item = def && this.isFilterVisible(def)
			? this.createDefinitionItem(def)
			: undefined;
		return item;
	}

	hasType (fullName: string): boolean {
		const known = this.definitions.has(fullName);
		return known;
	}

	private computeFilter (): void {
		this.filterOpen = new Set();
		this.filterMatchCount = 0;
		if (!this.filterText && this.usageMode === 'all') {
			this.filterVisible = undefined;
			return;
		}
		// A descendant's fullName extends its ancestor's dotted fullName,
		// so every descendant of a text match is itself a text match: the
		// family below a match needs no walk of its own. The usage mode
		// then keeps only the family members that pass it
		const needle = this.filterText.toLowerCase();
		// The path down to each match opens when the filter narrows the
		// tree (text, or only the unused); hiding the unused keeps most
		// rows, and opening every path would unfold the whole tree
		const openPaths = this.filterText !== '' || this.usageMode === 'unused';
		const visible: Set<string> = new Set();
		const walked: Set<string> = new Set();
		for (const def of this.definitions.values()) {
			if (!def.fullName.toLowerCase().includes(needle) || !this.matchesUsage(def)) {
				continue;
			}
			this.filterMatchCount++;
			visible.add(def.fullName);
			// the ancestors, shown (and opened) whatever their own usage:
			// the path down to the match; an ancestor already walked has
			// its whole chain done above it
			let parent = def.parent;
			while (parent && !walked.has(parent)) {
				walked.add(parent);
				visible.add(parent);
				if (openPaths) {
					this.filterOpen.add(parent);
				}
				const parentDef = this.definitions.get(parent);
				parent = parentDef ? parentDef.parent : undefined;
			}
		}
		this.filterVisible = visible;
	}

	getTreeItem (element: MnemonicaTreeItem): vscode.TreeItem {
		return element;
	}

	// Required for TreeView.reveal — walks the same parent links the
	// children lookups use
	getParent (element: MnemonicaTreeItem): MnemonicaTreeItem | undefined {
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
			if (!def.parent && this.isFilterVisible(def)) {
				roots.push(def);
			}
		}
		return roots.sort((a, b) => a.name.localeCompare(b.name));
	}

	private getChildDefinitions (parentName: string): DefinitionData[] {
		const children: DefinitionData[] = [];
		for (const def of this.definitions.values()) {
			if (def.parent === parentName && this.isFilterVisible(def)) {
				children.push(def);
			}
		}
		return children.sort((a, b) => a.name.localeCompare(b.name));
	}

	private isFilterVisible (def: DefinitionData): boolean {
		const visible = !this.filterVisible || this.filterVisible.has(def.fullName);
		return visible;
	}

	private createDefinitionItem (def: DefinitionData): MnemonicaTreeItem {
		const shortName = def.name.includes('.') ? def.name.split('.').pop()! : def.name;
		const hasChildren = this.getChildDefinitions(def.fullName).length > 0;
		// under a filter, the path down to every match opens
		const openState = this.filterOpen.has(def.fullName)
			? vscode.TreeItemCollapsibleState.Expanded
			: vscode.TreeItemCollapsibleState.Collapsed;
		const collapsibleState = hasChildren ? openState : vscode.TreeItemCollapsibleState.None;

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
				fullName: def.fullName,  // Use fullName (the key) for lookups
				filter: this.filterKey()
			},
			collapsibleState
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
