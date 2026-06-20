'use strict';

import * as vscode from 'vscode';
import { getLogger } from '../services/LoggerService';
import type { GraphData, D3Node } from '../types';

export class GenTreeItem extends vscode.TreeItem {
	constructor(
		public readonly id: string,
		public readonly label: string,
		public readonly gen: number,
		public readonly nodeData?: D3Node,
		collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
	) {
		super(label, collapsibleState);
		this.tooltip = `${id} (gen ${gen})`;
		this.iconPath = new vscode.ThemeIcon(this.getIconForGen(gen));
		if (nodeData?.location) {
			this.command = {
				command: 'mnemographica.navigateToLocation',
				title: 'Go to Definition',
				arguments: [{
					filePath: nodeData.location.fileName,
					line: nodeData.location.line,
					column: nodeData.location.column
				}]
			};
		}
	}

	private getIconForGen(gen: number): string {
		switch (gen) {
			case 0: return 'circle-filled';      // root
			case 1: return 'circle-outline';     // gen 1
			case 2: return 'primitive-dot';      // gen 2
			default: return 'symbol-dot';        // deeper
		}
	}
}

export class GenTreeProvider implements vscode.TreeDataProvider<GenTreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<GenTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private graphData: GraphData | undefined;
	private logger = getLogger();

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	setGraphData(data: GraphData): void {
		this.graphData = data;
		this.logger.info(`[GenTree] Loaded ${data.nodes.length} nodes across ${this.getMaxGen(data)} generations`);
		this.refresh();
	}

	getTreeItem(element: GenTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: GenTreeItem): GenTreeItem[] {
		if (!this.graphData) {
			return [
				new GenTreeItem('loading', 'Loading graph data...', -1, undefined, vscode.TreeItemCollapsibleState.None)
			];
		}

		if (this.graphData.nodes.length === 0) {
			return [
				new GenTreeItem('empty', 'No types found', -1, undefined, vscode.TreeItemCollapsibleState.None)
			];
		}

		if (!element) {
			// Root level: generation groups
			const maxGen = this.getMaxGen(this.graphData);
			this.logger.info(`[GenTree] Building groups: ${this.graphData.nodes.length} nodes, maxGen=${maxGen}`);
			const items: GenTreeItem[] = [];
			for (let g = 0; g <= maxGen; g++) {
				const nodesAtGen = this.graphData.nodes.filter(n => (n.depth || 0) === g);
				const label = g === 0 ? `Roots (${nodesAtGen.length})` : `Gen ${g} (${nodesAtGen.length})`;
				items.push(new GenTreeItem(
					`gen-${g}`,
					label,
					g,
					undefined,
					nodesAtGen.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
				));
			}
			return items;
		}

		// Children of a generation group: the actual nodes at that depth
		if (element.id.startsWith('gen-')) {
			const gen = element.gen;
			const nodesAtGen = this.graphData.nodes
				.filter(n => (n.depth || 0) === gen)
				.sort((a, b) => a.name.localeCompare(b.name));
			return nodesAtGen.map(n => new GenTreeItem(
				n.id,
				n.name,
				gen,
				n
			));
		}

		return [];
	}

	private getMaxGen(data: GraphData): number {
		if (!data.nodes.length) return 0;
		return Math.max(...data.nodes.map(n => n.depth || 0));
	}

	clear(): void {
		this.graphData = undefined;
		this.refresh();
	}
}
