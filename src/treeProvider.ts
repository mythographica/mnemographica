import * as vscode from 'vscode';
import { TypeNode } from './types';

export class MnemonicaTreeProvider implements vscode.TreeDataProvider<MnemonicaTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<MnemonicaTreeItem | undefined | null | void> = new vscode.EventEmitter<MnemonicaTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<MnemonicaTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	private typeNodes: TypeNode[] = [];

	refresh (nodes: TypeNode[]): void {
		this.typeNodes = nodes;
		this._onDidChangeTreeData.fire();
	}

	getTreeItem (element: MnemonicaTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren (element?: MnemonicaTreeItem): MnemonicaTreeItem[] {
		if (!element) {
			// Root level - return root types (no parent)
			return this.typeNodes
				.filter(node => !node.parent)
				.map(node => new MnemonicaTreeItem(node));
		}

		// Return children of this node
		const children = Array.from(element.node.children.values());
		return children.map(child => new MnemonicaTreeItem(child));
	}
}

class MnemonicaTreeItem extends vscode.TreeItem {
	constructor (public readonly node: TypeNode) {
		super(
			node.name,
			node.children.size > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
		);

		const propCount = node.properties.size;
		this.tooltip = `${node.name}\nProperties: ${propCount}\nSource: ${node.sourceFile}:${node.line}`;
		this.description = `(${propCount} props)`;

		// Set icon based on whether it has children
		if (node.children.size > 0) {
			this.iconPath = new vscode.ThemeIcon('symbol-class', new vscode.ThemeColor('symbolIcon.classForeground'));
		} else {
			this.iconPath = new vscode.ThemeIcon('symbol-interface', new vscode.ThemeColor('symbolIcon.interfaceForeground'));
		}

		// Command to jump to definition
		this.command = {
			command: 'vscode.open',
			title: 'Go to Definition',
			arguments: [
				vscode.Uri.file(node.sourceFile),
				{ selection: new vscode.Range(node.line - 1, node.column, node.line - 1, node.column) }
			]
		};
	}
}
