'use strict';

import * as vscode from 'vscode';
import * as path from 'path';

interface UsageInfo {
	filePath: string;
	line: number;
	column: number;
	context?: string;
}

export class UsageTreeItem extends vscode.TreeItem {
	constructor(
		public readonly usage: UsageInfo,
		public readonly workspacePath: string,
		public readonly typeName: string = ''
	) {
		// Show relative path and line number
		const relativePath = path.relative(workspacePath, usage.filePath);
		const label = `${relativePath}:${usage.line}`;
		
		super(label, vscode.TreeItemCollapsibleState.None);
		
		this.tooltip = `${relativePath}\nLine: ${usage.line}, Column: ${usage.column}${usage.context ? '\n\n' + usage.context : ''}`;
		this.description = usage.context || `Line ${usage.line}`;
		this.command = {
			command: 'mnemographica.openUsage',
			title: 'Open Usage',
			arguments: [usage]
		};
		
		// Set contextValue for usage items to enable context menu
		this.contextValue = 'usageItem';
		
		// Use file icon based on extension
		const ext = path.extname(usage.filePath).slice(1);
		this.iconPath = new vscode.ThemeIcon(ext === 'ts' ? 'typescript' : ext === 'js' ? 'javascript' : 'file');
		this.resourceUri = vscode.Uri.file(usage.filePath);
	}
}

export class UsagesTreeProvider implements vscode.TreeDataProvider<UsageTreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<UsageTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	
	private usages: UsageInfo[] = [];
	private currentTypeName: string = '';
	private workspacePath: string = '';
	
	refresh(): void {
		this._onDidChangeTreeData.fire();
	}
	
	setUsages(typeName: string, usages: UsageInfo[], workspacePath: string): void {
		this.currentTypeName = typeName;
		this.usages = usages;
		this.workspacePath = workspacePath;
		this.refresh();
	}
	
	setType(typeName: string, usages: { filePath: string; line: number; column: number; context: string; kind: string }[], workspacePath?: string): void {
		this.currentTypeName = typeName;
		this.usages = usages.map(u => ({
			filePath: u.filePath,
			line: u.line,
			column: u.column,
			context: u.context
		}));
		if (workspacePath) {
			this.workspacePath = workspacePath;
		}
		this.refresh();
	}
	
	clear(): void {
		this.currentTypeName = '';
		this.usages = [];
		this.refresh();
	}
	
	getTreeItem(element: UsageTreeItem): vscode.TreeItem {
		return element;
	}
	
	getChildren(element?: UsageTreeItem): Thenable<UsageTreeItem[]> {
		if (element) {
			return Promise.resolve([]);
		}
		
		if (this.usages.length === 0) {
			// Show a placeholder item when no usages
			if (this.currentTypeName) {
				const emptyItem = new vscode.TreeItem('No usages found');
				emptyItem.description = this.currentTypeName;
				return Promise.resolve([emptyItem as UsageTreeItem]);
			}
			return Promise.resolve([]);
		}
		
		return Promise.resolve(
			this.usages.map(usage => new UsageTreeItem(usage, this.workspacePath, this.currentTypeName))
		);
	}
	
	getSelectedType(): string {
		return this.currentTypeName;
	}
	
	getWorkspacePath(): string {
		return this.workspacePath;
	}
}
