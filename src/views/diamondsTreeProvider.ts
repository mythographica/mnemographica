'use strict';

import * as vscode from 'vscode';
import { getLogger } from '../services/LoggerService';
import type { Registry } from '../../.tactica/types';

// Mirrors rawCreationGraphNode / rawCreationGraphAnchor from
// models/Instrumentation.ts — declared locally (same decoupling
// pattern as FlowTreeProvider's FlowEntryData) so the view layer does
// not depend on model internals
interface CreationScopeData {
	scopeId: string;
	name: string;
	kind: 'module' | 'function' | 'method' | 'arrow';
	filePath: string;
	location: string;
	starter: boolean;
}

interface CreationAnchorData {
	location: string;
	holderScopeId: string;
	typePath: string;
	constructorText?: string;
	variable?: string;
}

// Trie node: one segment of a dot-joined type path. Anchors (the `new`
// sites) hang off the node whose fullPath IS the created type.
interface TrieNode {
	segment: string;
	fullPath: string;
	children: Map<string, TrieNode>;
	anchors: CreationAnchorData[];
}

type DiamondsNodeType = 'segment' | 'anchor' | 'info';

interface DiamondsTreeNodeData {
	label: string;
	type: DiamondsNodeType;
	// segment nodes:
	fullPath?: string;
	anchorCount?: number;
	// anchor nodes:
	anchor?: CreationAnchorData;
	scope?: CreationScopeData;
}

const scopeIcons: Record<string, string> = {
	module: 'symbol-module',
	function: 'symbol-function',
	method: 'symbol-method',
	arrow: 'symbol-function'
};

const shortLocation = (location: string): string => {
	const match = location.match(/^(.+):(\d+):(\d+)$/);
	if (!match) { return location; }
	const tail = match[1].split('/').pop() || match[1];
	return `${tail}:${match[2]}`;
};

export class DiamondsTreeItem extends vscode.TreeItem {
	constructor(
		public readonly data: DiamondsTreeNodeData,
		collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(data.label, collapsibleState);

		if (data.type === 'segment') {
			this.id = `diamond-seg:${data.fullPath || data.label}`;
			this.iconPath = new vscode.ThemeIcon('symbol-class');
			this.tooltip = data.fullPath || data.label;
			this.contextValue = 'diamondSegment';
			return;
		}

		if (data.type === 'anchor' && data.anchor) {
			const anchor = data.anchor;
			const scope = data.scope;
			this.id = `diamond:${anchor.location}`;
			// The location tail distinguishes identical scope names —
			// one scope can construct the same type at several lines
			this.description = shortLocation(anchor.location);
			const iconName = scope
				? (scope.starter ? 'debug-start' : (scopeIcons[scope.kind] || 'symbol-function'))
				: 'symbol-function';
			this.iconPath = new vscode.ThemeIcon(iconName);
			const scopeLine = scope
				? `${scope.name} (${scope.kind}${scope.starter ? ', entry point' : ''})`
				: 'unknown scope';
			const codeLine = anchor.constructorText || `new ${anchor.typePath}(…)`;
			this.tooltip = `${scopeLine}\n${codeLine}\n${anchor.location}`;
			this.contextValue = 'navigable';
			const match = anchor.location.match(/^(.+):(\d+):(\d+)$/);
			if (match) {
				this.command = {
					command: 'mnemographica.navigateToLocation',
					title: 'Go to Creation Site',
					arguments: [{
						filePath: match[1],
						line: parseInt(match[2], 10),
						column: parseInt(match[3], 10)
					}]
				};
			}
			return;
		}

		// info rows
		this.iconPath = new vscode.ThemeIcon('info');
		this.contextValue = 'info';
	}
}

export class DiamondsTreeProvider implements vscode.TreeDataProvider<DiamondsTreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<DiamondsTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private trieRoot: TrieNode = DiamondsTreeProvider.newTrieNode('', '');
	private scopesById: Map<string, CreationScopeData> = new Map();
	private status: 'ok' | 'no-registry' | 'no-graph' | 'empty' = 'no-registry';
	private registry: Registry | undefined;
	private logger = getLogger();

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	setRegistry(registry: Registry): void {
		this.registry = registry;
		this.loadFromRegistry();
	}

	private static newTrieNode(segment: string, fullPath: string): TrieNode {
		const node: TrieNode = { segment, fullPath, children: new Map(), anchors: [] };
		return node;
	}

	loadFromRegistry(): void {
		this.trieRoot = DiamondsTreeProvider.newTrieNode('', '');
		this.scopesById.clear();

		if (!this.registry) {
			this.status = 'no-registry';
			this.refresh();
			return;
		}

		const instrumentation = this.registry.getInstrumentation();
		if (!instrumentation || !instrumentation.hasCreationGraph()) {
			// instrumentation.json v1 carries no creationGraph — say so
			// instead of rendering an empty pane
			this.status = 'no-graph';
			this.refresh();
			return;
		}

		const graph = instrumentation.getCreationGraph();
		if (!graph) {
			this.status = 'no-graph';
			this.refresh();
			return;
		}

		for (const scope of graph.nodes) {
			this.scopesById.set(scope.scopeId, scope);
		}
		const sortedAnchors = [...graph.anchors].sort((a, b) => a.location.localeCompare(b.location));
		for (const anchor of sortedAnchors) {
			this.insertAnchor(anchor);
		}

		this.status = graph.anchors.length > 0 ? 'ok' : 'empty';
		this.logger.info(`[DiamondsTree] Loaded ${graph.anchors.length} creation sites across ${graph.nodes.length} scopes`);
		this.refresh();
	}

	private insertAnchor(anchor: CreationAnchorData): void {
		const segments = anchor.typePath.split('.');
		let node = this.trieRoot;
		let path = '';
		for (const segment of segments) {
			path = path ? `${path}.${segment}` : segment;
			let child = node.children.get(segment);
			if (!child) {
				child = DiamondsTreeProvider.newTrieNode(segment, path);
				node.children.set(segment, child);
			}
			node = child;
		}
		node.anchors.push(anchor);
	}

	private subtreeAnchorCount(node: TrieNode): number {
		let count = node.anchors.length;
		for (const child of node.children.values()) {
			count += this.subtreeAnchorCount(child);
		}
		return count;
	}

	private segmentItems(node: TrieNode): DiamondsTreeItem[] {
		const items: DiamondsTreeItem[] = [];
		for (const child of node.children.values()) {
			const count = this.subtreeAnchorCount(child);
			items.push(new DiamondsTreeItem(
				{
					label: `${child.segment} (${count})`,
					type: 'segment',
					fullPath: child.fullPath,
					anchorCount: count
				},
				vscode.TreeItemCollapsibleState.Collapsed
			));
		}
		return items.sort((a, b) => a.data.label.localeCompare(b.data.label));
	}

	private findNode(fullPath: string): TrieNode | undefined {
		let node = this.trieRoot;
		for (const segment of fullPath.split('.')) {
			const child = node.children.get(segment);
			if (!child) { return undefined; }
			node = child;
		}
		return node;
	}

	getTreeItem(element: DiamondsTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: DiamondsTreeItem): DiamondsTreeItem[] {
		if (!element) {
			if (this.status === 'no-registry') {
				return [new DiamondsTreeItem(
					{ label: 'No workspace loaded', type: 'info' },
					vscode.TreeItemCollapsibleState.None
				)];
			}
			if (this.status === 'no-graph') {
				return [new DiamondsTreeItem(
					{ label: 'No creation graph — regenerate .tactica with tactica v2', type: 'info' },
					vscode.TreeItemCollapsibleState.None
				)];
			}
			if (this.status === 'empty') {
				return [new DiamondsTreeItem(
					{ label: 'No creation sites found', type: 'info' },
					vscode.TreeItemCollapsibleState.None
				)];
			}
			return this.segmentItems(this.trieRoot);
		}

		const data = element.data;
		if (data.type !== 'segment' || !data.fullPath) { return []; }
		const node = this.findNode(data.fullPath);
		if (!node) { return []; }

		// Child type segments first, then the scopes creating THIS type
		const items = this.segmentItems(node);
		for (const anchor of node.anchors) {
			const scope = this.scopesById.get(anchor.holderScopeId);
			items.push(new DiamondsTreeItem(
				{
					label: scope ? scope.name : 'unknown scope',
					type: 'anchor',
					anchor,
					scope
				},
				vscode.TreeItemCollapsibleState.None
			));
		}
		return items;
	}

	clear(): void {
		this.trieRoot = DiamondsTreeProvider.newTrieNode('', '');
		this.scopesById.clear();
		this.status = 'no-registry';
		this.refresh();
	}
}
