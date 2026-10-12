'use strict';

import * as vscode from 'vscode';
import { getLogger } from '../services/LoggerService';
import { parseTacticaLocation, shortLocation } from '../utils/paths';
import type { Registry } from '../../.tactica/types';

// Icon per flow kind
const kindIcons: Record<string, string> = {
	propertyRead: 'eye',
	propertyWrite: 'edit',
	methodCall: 'run',
	destructureRead: 'symbol-field',
	passAsArg: 'arrow-right',
	return: 'arrow-left',
	spread: 'diff-added',
	elementAccess: 'search',
	reassignment: 'sync',
	conditionalAccess: 'question',
	arrayElement: 'list-tree',
	instantiation: 'debug-start'
};

type FlowTreeNodeType = 'kind' | 'type' | 'entry';

interface FlowEntryData {
	typeName: string;
	kind: string;
	code: string;
	location: string;
	propertyName?: string;
	context?: string;
}

interface FlowTreeNodeData {
	label: string;
	type: FlowTreeNodeType;
	// For 'entry' nodes:
	location?: string;
	code?: string;
	// For type nodes: the kind this type belongs to
	kind?: string;
	// For type nodes: the actual type name (not display label)
	typeName?: string;
}

export class FlowTreeItem extends vscode.TreeItem {
	constructor(
		public readonly data: FlowTreeNodeData,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(data.label, collapsibleState);
		this.iconPath = this.getIcon(data.type, data.kind || data.label);
		this.tooltip = this.buildTooltip();
		this.contextValue = data.type === 'entry' ? 'navigable' : 'flowGroup';

		if (data.type === 'entry' && data.location) {
			const parsed = parseTacticaLocation(data.location);
			if (parsed) {
				// The location tail rides the row as description —
				// otherwise identical labels (".value" × 8 under one
				// type) carry no way to tell entries apart
				this.description = shortLocation(data.location);
				this.command = {
					command: 'mnemographica.navigateToLocation',
					title: 'Go to Flow',
					arguments: [{
						filePath: parsed.fileName,
						line: parsed.line,
						column: parsed.column
					}]
				};
			}
		}
	}

	private getIcon(nodeType: FlowTreeNodeType, label: string): vscode.ThemeIcon {
		if (nodeType === 'kind') {
			const icon = kindIcons[label] || 'symbol-misc';
			return new vscode.ThemeIcon(icon);
		}
		if (nodeType === 'type') {
			return new vscode.ThemeIcon('symbol-class');
		}
		// entry
		return new vscode.ThemeIcon('circle-outline');
	}

	private buildTooltip(): string {
		if (this.data.type === 'entry') {
			return `${this.data.code || ''}\n${this.data.location || ''}`;
		}
		return this.data.label;
	}
}

export class FlowTreeProvider implements vscode.TreeDataProvider<FlowTreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<FlowTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private flowData: Map<string, FlowEntryData[]> = new Map();
	private registry: Registry | undefined;
	private logger = getLogger();

	// Filter state
	private filterType: string = '';  // empty = no filter (show all)
	private showAll: boolean = true;  // when true, ignore filterType

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	setRegistry(registry: Registry): void {
		this.registry = registry;
		this.loadFromRegistry();
	}

	loadFromRegistry(): void {
		this.flowData.clear();

		if (!this.registry) {
			this.logger.warn('[FlowTree] No registry set');
			return;
		}

		const flowModel = this.registry.getFlow();
		if (!flowModel) {
			this.logger.warn('[FlowTree] No flow data in registry');
			return;
		}

		// Iterate using keys() + get() — same pattern as treeProvider
		for (const typeName of flowModel.keys()) {
			const entries = flowModel.get(typeName);
			if (!entries) { continue; }
			const typedEntries = entries as unknown as FlowEntryData[];
			this.flowData.set(typeName, typedEntries);
		}

		this.logger.info(`[FlowTree] Loaded ${this.flowData.size} types with flow data`);
		this.refresh();
	}

	// Filter by selected type (called from context menu)
	setFilterType(typeName: string): void {
		// typeName is the exact key the tree rows carry — used as is
		this.filterType = typeName;
		this.showAll = false;
		this.logger.info(`[FlowTree] Filter set to: ${typeName}`);
		this.refresh();
	}

	// Clear filter and show all
	clearFilter(): void {
		this.filterType = '';
		this.showAll = true;
		this.logger.info('[FlowTree] Filter cleared, showing all');
		this.refresh();
	}

	getTreeItem(element: FlowTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: FlowTreeItem): FlowTreeItem[] {
		if (!element) {
			// Root level — group by flow kind
			return this.getRootKinds();
		}

		if (element.data.type === 'kind') {
			// Kind node — show types under this kind
			return this.getTypesForKind(element.data.kind!);
		}

		if (element.data.type === 'type') {
			// Show flow entries for this type+kind
			return this.getEntriesForType(element.data.kind!, element.data.typeName!);
		}

		return [];
	}

	private getActiveFlowData(): Map<string, FlowEntryData[]> {
		if (this.showAll || !this.filterType) {
			return this.flowData;
		}

		// Filter to only entries matching filterType
		const filtered = new Map<string, FlowEntryData[]>();
		for (const [typeName, entries] of this.flowData) {
			if (typeName === this.filterType || typeName.startsWith(this.filterType + '.')) {
				filtered.set(typeName, entries);
			}
		}
		return filtered;
	}

	// "Show Flows" for one type opens its tree fully — the filtered view is
	// small and read whole; the unfiltered all-types view stays collapsed
	private groupState(): vscode.TreeItemCollapsibleState {
		const state = this.filterType && !this.showAll
			? vscode.TreeItemCollapsibleState.Expanded
			: vscode.TreeItemCollapsibleState.Collapsed;
		return state;
	}

	private getRootKinds(): FlowTreeItem[] {
		const activeData = this.getActiveFlowData();

		// Collect all unique kinds and count entries per kind
		const kindCounts = new Map<string, number>();
		for (const entries of activeData.values()) {
			for (const entry of entries) {
				const count = kindCounts.get(entry.kind) || 0;
				kindCounts.set(entry.kind, count + 1);
			}
		}

		const items: FlowTreeItem[] = [];
		for (const [kind, count] of kindCounts) {
			items.push(new FlowTreeItem(
				{ label: `${kind} (${count})`, type: 'kind', kind },
				this.groupState()
			));
		}

		return items.sort((a, b) => a.data.label.localeCompare(b.data.label));
	}

	private getTypesForKind(kind: string): FlowTreeItem[] {
		const activeData = this.getActiveFlowData();

		// Find all types that have this kind
		const typeCounts = new Map<string, number>();
		for (const [typeName, entries] of activeData) {
			const matching = entries.filter(e => e.kind === kind);
			if (matching.length > 0) {
				typeCounts.set(typeName, matching.length);
			}
		}

		const items: FlowTreeItem[] = [];
		for (const [typeName, count] of typeCounts) {
			// Short name for display
			const shortName = typeName.includes('.') ? typeName.split('.').pop()! : typeName;
			items.push(new FlowTreeItem(
				{
					label: `${shortName} (${count})`,
					type: 'type',
					kind,
					typeName
				},
				this.groupState()
			));
		}

		return items.sort((a, b) => a.data.label.localeCompare(b.data.label));
	}

	private getEntriesForType(kind: string, typeName: string): FlowTreeItem[] {
		const entries = this.flowData.get(typeName);
		if (!entries) { return []; }

		const matching = entries.filter(e => e.kind === kind);
		return matching.map(entry => {
			const label = entry.propertyName
				? `.${entry.propertyName}`
				: (entry.context || entry.code.slice(0, 40));

			return new FlowTreeItem(
				{
					label,
					type: 'entry',
					location: entry.location,
					code: entry.code
				},
				vscode.TreeItemCollapsibleState.None
			);
		});
	}

	clear(): void {
		this.flowData.clear();
		this.filterType = '';
		this.showAll = true;
		this.refresh();
	}
}
