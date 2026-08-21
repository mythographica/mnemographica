'use strict';

import * as vscode from 'vscode';
import { VSCodeNavigation } from '../services/NavigationAdapter';
import { MnemonicaTreeProvider, MnemonicaTreeItem } from '../views/treeProvider';
import { UsagesTreeProvider, UsageTreeItem } from '../views/usagesTreeProvider';
import { getLogger } from '../services/LoggerService';
import * as path from 'path';
import * as fs from 'fs';

export function registerNavigationCommands(
	treeProvider: MnemonicaTreeProvider,
	usagesProvider: UsagesTreeProvider
): vscode.Disposable[] {
	const logger = getLogger();
	const disposables: vscode.Disposable[] = [];

	disposables.push(
		vscode.commands.registerCommand('mnemographica.openTreeItem', async (item: MnemonicaTreeItem) => {
			let targetPath = item.data.fullPath;
			let targetLine = item.data.line;
			let targetColumn = item.data.column;

			if (!item.data.isDefinition && treeProvider) {
				const fullName = item.data.fullName || item.data.label;
				const definitionName = fullName.replace(/_/g, '.');
				const definition = treeProvider.getDefinition(definitionName);
				if (definition) {
					targetPath = definition.fullPath;
					targetLine = definition.line;
					targetColumn = definition.column;
				}
			}

			if (targetPath) {
				await VSCodeNavigation.goTo(targetPath, targetLine || 0, targetColumn || 0);
			}
		})
	);

	disposables.push(
		vscode.commands.registerCommand('mnemographica.openType', async (item: MnemonicaTreeItem) => {
			let targetPath = item.data.fullPath;
			let targetLine = item.data.line;
			let targetColumn = item.data.column;

			if (item.data.isDefinition && treeProvider) {
				const fullName = item.data.fullName || item.data.label;
				// types are keyed by dot-joined full path, same as definitions
				const typeInfo = treeProvider.getType(fullName);
				if (typeInfo) {
					targetPath = typeInfo.fullPath;
					targetLine = typeInfo.line;
					targetColumn = typeInfo.column;
				}
			}

			if (targetPath) {
				await VSCodeNavigation.goTo(targetPath, targetLine || 0, targetColumn || 0);
			}
		})
	);

	disposables.push(
		vscode.commands.registerCommand('mnemographica.goToUsage', async (item: UsageTreeItem) => {
			if (item?.usage) {
				await VSCodeNavigation.goTo(item.usage.filePath, item.usage.line, item.usage.column);
			}
		})
	);

	disposables.push(
		vscode.commands.registerCommand('mnemographica.goToType', async (item: UsageTreeItem) => {
			if (!item?.typeName) { return; }

			const workspacePath = item.workspacePath || usagesProvider.getWorkspacePath();
			if (!workspacePath) { return; }

			const typesTsPath = path.join(workspacePath, '.tactica', 'types.ts');
			if (!fs.existsSync(typesTsPath)) {
				vscode.window.showWarningMessage('types.ts not found. Run tactica first.');
				return;
			}

			try {
				const content = fs.readFileSync(typesTsPath, 'utf-8');
				const lines = content.split('\n');
				const typeName = item.typeName.replace(/Instance$/, '');
				const searchPattern = new RegExp(`export\\s+type\\s+${typeName}\\s*=`);

				let targetLine = 0;
				for (let i = 0; i < lines.length; i++) {
					if (searchPattern.test(lines[i])) {
						targetLine = i + 1;
						break;
					}
				}

				await VSCodeNavigation.goTo(typesTsPath, targetLine, 1);
			} catch (err) {
				logger.error('Failed to open types.ts:', err);
			}
		})
	);

	disposables.push(
		vscode.commands.registerCommand('mnemographica.goToDefinition', async (item: UsageTreeItem) => {
			if (!item?.typeName) { return; }

			const workspacePath = item.workspacePath || usagesProvider.getWorkspacePath();
			if (!workspacePath) { return; }

			const definitionsPath = path.join(workspacePath, '.tactica', 'definitions.json');
			if (!fs.existsSync(definitionsPath)) {
				vscode.window.showWarningMessage('definitions.json not found. Run tactica first.');
				return;
			}

			try {
				const content = fs.readFileSync(definitionsPath, 'utf-8');
				const definitions = JSON.parse(content);
				const typeName = item.typeName.replace(/Instance$/, '');

				let definition = definitions[typeName] || definitions[`${typeName}Instance`];

				if (!definition && typeName.includes('.')) {
					const parts = typeName.split('.');
					for (let i = 0; i < parts.length; i++) {
						const candidate = parts.slice(i).join('.');
						definition = definitions[candidate] || definitions[`${candidate}Instance`];
						if (definition) { break; }
					}
				}

				if (!definition?.location) {
					vscode.window.showWarningMessage(`Definition not found for ${typeName}`);
					return;
				}

				const match = definition.location.match(/^(.+):(\d+):(\d+)$/);
				if (match) {
					await VSCodeNavigation.goTo(match[1], parseInt(match[2]), parseInt(match[3]));
				}
			} catch (err) {
				logger.error('Failed to navigate to definition:', err);
			}
		})
	);

	disposables.push(
		vscode.commands.registerCommand('mnemographica.navigateToUsage', async (usageData: { filePath: string; line: number; column: number }) => {
			await VSCodeNavigation.goTo(usageData.filePath, usageData.line, usageData.column);
		})
	);

	disposables.push(
		vscode.commands.registerCommand('mnemographica.revealInExplorer', async (item: UsageTreeItem) => {
			if (item?.usage?.filePath) {
				const uri = vscode.Uri.file(item.usage.filePath);
				await vscode.commands.executeCommand('revealInExplorer', uri);
			}
		})
	);

	return disposables;
}
