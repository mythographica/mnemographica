'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Definition } from '../models';

type TreeNodeType = 'root' | 'type' | 'subtype' | 'definition';

type MnemonicaTreeItemData = {
	label: string;
	type: TreeNodeType;
	fullPath?: string;
	line?: number;
	column?: number;
	children?: MnemonicaTreeItemData[];
};

/**
 * Tree view item for Mnemonica type hierarchy
 */
export class MnemonicaTreeItem extends vscode.TreeItem {
	constructor (
		public readonly data: MnemonicaTreeItemData,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(data.label, collapsibleState);

		// Set icon based on type
		this.iconPath = this.getIconPath(data.type);

		// Set tooltip
		this.tooltip = `${data.type}: ${data.label}`;

		// Set command for navigation (if definition)
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

	private getIconPath (type: TreeNodeType): vscode.ThemeIcon {
		switch (type) {
			case 'root':
				return new vscode.ThemeIcon('symbol-namespace');
			case 'type':
				return new vscode.ThemeIcon('symbol-class');
			case 'subtype':
				return new vscode.ThemeIcon('symbol-interface');
			case 'definition':
				return new vscode.ThemeIcon('go-to-file');
			default:
				return new vscode.ThemeIcon('symbol-field');
		}
	}
}

/**
 * Tree data provider for Mnemonica types
 */
export class MnemonicaTreeProvider implements vscode.TreeDataProvider<MnemonicaTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<MnemonicaTreeItem | undefined | null | void> = new vscode.EventEmitter<MnemonicaTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<MnemonicaTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	private definitions: Map<string, InstanceType<typeof Definition>> = new Map();

	/**
	 * Refresh the tree view
	 */
	refresh (): void {
		this._onDidChangeTreeData.fire();
	}

	/**
	 * Load definitions from .tactica/definitions.json
	 */
	async loadDefinitions (workspacePath: string): Promise<void> {
		const definitionsPath = path.join(workspacePath, '.tactica', 'definitions.json');

		if (!fs.existsSync(definitionsPath)) {
			console.log('[MnemonicaTreeProvider] No definitions.json found');
			return;
		}

		const content = fs.readFileSync(definitionsPath, 'utf-8');
		const data: { definitions: Record<string, {
			name: string;
			filePath: string;
			line: number;
			column: number;
			parent?: string;
		}> } = JSON.parse(content);

		// Create Definition instances for tree nodes
		for (const [name, info] of Object.entries(data.definitions)) {
			const def = new Definition({
				id: `${name}:${info.line}:${info.column}`,
				name: info.name,
				fullPath: info.filePath,
				properties: new Map()
			});
			this.definitions.set(name, def);
		}

		console.log('[MnemonicaTreeProvider] Loaded', this.definitions.size, 'definitions');
		this.refresh();
	}

	/**
	 * Get tree item for element
	 */
	getTreeItem (element: MnemonicaTreeItem): vscode.TreeItem {
		return element;
	}

	/**
	 * Get children of element
	 */
	async getChildren (element?: MnemonicaTreeItem): Promise<MnemonicaTreeItem[]> {
		// Root level - show type categories
		if (!element) {
			return this.getRootItems();
		}

		// Show children based on type
		return this.getChildItems(element);
	}

	/**
	 * Get root level items (type categories)
	 */
	private getRootItems (): MnemonicaTreeItem[] {
		const roots: MnemonicaTreeItem[] = [];

		// Add Definition root
		roots.push(new MnemonicaTreeItem(
			{
				label: 'Definitions',
				type: 'root',
				children: []
			},
			vscode.TreeItemCollapsibleState.Expanded
		));

		// Add Types root
		roots.push(new MnemonicaTreeItem(
			{
				label: 'Types',
				type: 'root',
				children: []
			},
			vscode.TreeItemCollapsibleState.Collapsed
		));

		return roots;
	}

	/**
	 * Get child items for a tree node
	 */
	private getChildItems (parent: MnemonicaTreeItem): MnemonicaTreeItem[] {
		const children: MnemonicaTreeItem[] = [];

		if (parent.data.label === 'Definitions') {
			// Show all definitions
			for (const [name, def] of this.definitions) {
				children.push(new MnemonicaTreeItem(
					{
						label: name,
						type: 'definition',
						fullPath: def.fullPath,
						line: 0,
						column: 0
					},
					vscode.TreeItemCollapsibleState.None
				));
			}
		}

		// Sort by label
		return children.sort((a, b) => a.data.label.localeCompare(b.data.label));
	}

	/**
	 * Clear loaded definitions
	 */
	clear (): void {
		this.definitions.clear();
		this.refresh();
	}
}
