'use strict';

import * as vscode from 'vscode';
import { getLogger } from '../services/LoggerService';
import { parseTacticaLocation, shortLocation } from '../utils/paths';
import { PathTrieNode, findInPathTrie, insertIntoPathTrie, newPathTrieNode, subtreeEntryCount } from './pathTrie';
import type { Registry } from '../../.tactica/types';

// Mirrors rawEDSEntry from models/EDS.ts (wrap-kind fields only) —
// declared locally, same decoupling pattern as FlowTreeProvider
interface WrapEntryData {
	/** EDS map key — the scope the wrap call site lives in (a type
	 *  fullPath when the wrap sits inside that type's define handler) */
	scopeKey: string;
	location: string;
	kind: string;
	code: string;
	label?: string;
	via?: string;
	createsTypes?: string[];
	callbackScopeId?: string;
	scopeId?: string;
	instanceArg?: string;
	wrapsTypePath?: string;
}

// Trie node: one segment of a dot-joined type path. Wrap sites hang
// off the node whose fullPath is the type the bagel belongs to.
type TrieNode = PathTrieNode<WrapEntryData>;

type BagelsNodeType = 'segment' | 'wrap' | 'info';

interface BagelsTreeNodeData {
	label: string;
	type: BagelsNodeType;
	// segment nodes:
	fullPath?: string;
	wrapCount?: number;
	// wrap nodes:
	wrap?: WrapEntryData;
	generation?: number;
}

// Trie bucket for wraps with no attributable type context
const UNGROUPED = '(no type context)';

export class BagelsTreeItem extends vscode.TreeItem {
	constructor(
		public readonly data: BagelsTreeNodeData,
		collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(data.label, collapsibleState);

		if (data.type === 'segment') {
			this.id = `bagel-seg:${data.fullPath || data.label}`;
			this.iconPath = new vscode.ThemeIcon('symbol-class');
			this.tooltip = data.fullPath || data.label;
			this.contextValue = 'bagelSegment';
			return;
		}

		if (data.type === 'wrap' && data.wrap) {
			const wrap = data.wrap;
			this.id = `bagel:${wrap.location}`;
			// The via-generation (GraphBuilder's wrapper generation walk)
			// distinguishes wrap sites whose labels repeat
			this.description = `gen ${data.generation ?? 0} · ${shortLocation(wrap.location)}`;
			this.iconPath = new vscode.ThemeIcon('circle-outline');
			const lines: string[] = [];
			if (wrap.code) { lines.push(wrap.code); }
			if (wrap.wrapsTypePath) { lines.push(`wraps instance of ${wrap.wrapsTypePath}`); }
			lines.push(`called in: ${wrap.scopeKey}`);
			if (wrap.via) { lines.push(`via: ${shortLocation(wrap.via)}`); }
			if (wrap.createsTypes && wrap.createsTypes.length > 0) {
				lines.push(`creates: ${wrap.createsTypes.join(', ')}`);
			}
			lines.push(wrap.location);
			this.tooltip = lines.join('\n');
			this.contextValue = 'navigable';
			const parsed = parseTacticaLocation(wrap.location);
			if (parsed) {
				this.command = {
					command: 'mnemographica.navigateToLocation',
					title: 'Go to Wrap Site',
					arguments: [{
						filePath: parsed.fileName,
						line: parsed.line,
						column: parsed.column
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

export class BagelsTreeProvider implements vscode.TreeDataProvider<BagelsTreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<BagelsTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private trieRoot: TrieNode = newPathTrieNode('', '');
	private generations: Map<string, number> = new Map();
	private status: 'ok' | 'no-registry' | 'no-eds' | 'empty' = 'no-registry';
	private registry: Registry | undefined;
	private logger = getLogger();

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	setRegistry(registry: Registry): void {
		this.registry = registry;
		this.loadFromRegistry();
	}

	loadFromRegistry(): void {
		this.trieRoot = newPathTrieNode('', '');
		this.generations.clear();

		if (!this.registry) {
			this.status = 'no-registry';
			this.refresh();
			return;
		}

		const eds = this.registry.getEDS();
		if (!eds) {
			this.status = 'no-eds';
			this.refresh();
			return;
		}

		const types = this.registry.getTypes();
		const wraps: WrapEntryData[] = [];
		for (const [scopeKey, entries] of eds.entries()) {
			for (const entry of entries) {
				if (entry.kind !== 'wrap') { continue; }
				// Explicit field copy — no spread of a mnemonica instance
				wraps.push({
					scopeKey,
					location: entry.location,
					kind: entry.kind,
					code: entry.code,
					label: entry.label,
					via: entry.via,
					createsTypes: entry.createsTypes ? [...entry.createsTypes] : undefined,
					callbackScopeId: entry.callbackScopeId,
					scopeId: entry.scopeId,
					instanceArg: entry.instanceArg,
					wrapsTypePath: entry.wrapsTypePath
				});
			}
		}

		if (wraps.length === 0) {
			this.status = 'empty';
			this.refresh();
			return;
		}

		// Via-generation per wrap site, GraphBuilder's memoized walk:
		// a wrap with no known parent is gen-0, every child one past its
		// parent. Cycle-guarded — a via loop collapses to gen-0.
		const byId = new Map<string, WrapEntryData>();
		for (const wrap of wraps) {
			if (!byId.has(wrap.location)) {
				byId.set(wrap.location, wrap);
			}
		}
		const generationOf = (id: string, trail: Set<string>): number => {
			const cached = this.generations.get(id);
			if (cached !== undefined) { return cached; }
			if (trail.has(id)) { return 0; }
			trail.add(id);
			const wrap = byId.get(id);
			let generation = 0;
			if (wrap && wrap.via !== undefined && byId.has(wrap.via)) {
				generation = generationOf(wrap.via, trail) + 1;
			}
			this.generations.set(id, generation);
			return generation;
		};

		for (const wrap of wraps) {
			generationOf(wrap.location, new Set());
			this.insertWrap(wrap, types);
		}

		this.status = 'ok';
		this.logger.info(`[BagelsTree] Loaded ${wraps.length} wrap sites`);
		this.refresh();
	}

	private insertWrap(wrap: WrapEntryData, types: { has(name: string): boolean } | undefined): void {
		// Trie anchor: the type the bagel BELONGS to — the wrapped
		// instance's type when known (bagel encircles the sphere), else
		// the type whose define handler produced the wrap (the EDS map
		// key when it names a known type), else the ungrouped bucket
		let path = wrap.wrapsTypePath;
		if (!path && types && types.has(wrap.scopeKey)) {
			path = wrap.scopeKey;
		}
		if (!path) {
			path = UNGROUPED;
		}

		insertIntoPathTrie(this.trieRoot, path, wrap);
	}

	private segmentItems(node: TrieNode): BagelsTreeItem[] {
		const items: BagelsTreeItem[] = [];
		for (const child of node.children.values()) {
			const count = subtreeEntryCount(child);
			items.push(new BagelsTreeItem(
				{
					label: `${child.segment} (${count})`,
					type: 'segment',
					fullPath: child.fullPath,
					wrapCount: count
				},
				vscode.TreeItemCollapsibleState.Collapsed
			));
		}
		return items.sort((a, b) => a.data.label.localeCompare(b.data.label));
	}

	getTreeItem(element: BagelsTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: BagelsTreeItem): BagelsTreeItem[] {
		if (!element) {
			if (this.status === 'no-registry') {
				return [new BagelsTreeItem(
					{ label: 'No workspace loaded', type: 'info' },
					vscode.TreeItemCollapsibleState.None
				)];
			}
			if (this.status === 'no-eds') {
				return [new BagelsTreeItem(
					{ label: 'No EDS data in registry', type: 'info' },
					vscode.TreeItemCollapsibleState.None
				)];
			}
			if (this.status === 'empty') {
				return [new BagelsTreeItem(
					{ label: 'No wrap sites found (eds.json)', type: 'info' },
					vscode.TreeItemCollapsibleState.None
				)];
			}
			return this.segmentItems(this.trieRoot);
		}

		const data = element.data;
		if (data.type !== 'segment' || !data.fullPath) { return []; }
		const node = findInPathTrie(this.trieRoot, data.fullPath);
		if (!node) { return []; }

		// Child type segments first, then the wrap sites of THIS type
		const items = this.segmentItems(node);
		const sortedWraps = [...node.entries].sort((a, b) => a.location.localeCompare(b.location));
		for (const wrap of sortedWraps) {
			items.push(new BagelsTreeItem(
				{
					label: wrap.label || shortLocation(wrap.location),
					type: 'wrap',
					wrap,
					generation: this.generations.get(wrap.location) ?? 0
				},
				vscode.TreeItemCollapsibleState.None
			));
		}
		return items;
	}

	clear(): void {
		this.trieRoot = newPathTrieNode('', '');
		this.generations.clear();
		this.status = 'no-registry';
		this.refresh();
	}
}
