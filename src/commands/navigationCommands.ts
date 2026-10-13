'use strict';

import * as vscode from 'vscode';
import { VSCodeNavigation } from '../services/NavigationAdapter';
import { MnemonicaTreeItem } from '../views/treeProvider';
import { UsagesTreeProvider, UsageTreeItem } from '../views/usagesTreeProvider';
import { getLogger } from '../services/LoggerService';
import { getProjectRegistry } from '../core/registryStore';
import { parseTacticaLocation } from '../utils/paths';

export function registerNavigationCommands(
	usagesProvider: UsagesTreeProvider
): vscode.Disposable[] {
	const logger = getLogger();
	const disposables: vscode.Disposable[] = [];

	disposables.push(
		vscode.commands.registerCommand('mnemographica.openTreeItem', async (item: MnemonicaTreeItem) => {
			// Definitions rows navigate to the define() site they carry
			const targetPath = item.data.fullPath;
			const targetLine = item.data.line;
			const targetColumn = item.data.column;

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
		vscode.commands.registerCommand('mnemographica.goToDefinition', async (item: UsageTreeItem) => {
			if (!item?.typeName) { return; }

			const workspacePath = item.workspacePath || usagesProvider.getWorkspacePath();
			if (!workspacePath) { return; }

			// The store's loaded Registry — definitions.json was read and
			// validated once at load; nothing is re-read here
			const registry = await getProjectRegistry(workspacePath);
			const definitions = registry?.getDefinitions();
			if (!definitions) {
				vscode.window.showWarningMessage('definitions.json not loaded. Run tactica first.');
				return;
			}

			try {
				// item.typeName IS the exact definitions.json key (the
				// tree rows carry it) — a direct lookup, no probing
				const entry = definitions.get(item.typeName);

				if (!entry?.location) {
					vscode.window.showWarningMessage(`Definition not found for ${item.typeName}`);
					return;
				}

				const parsed = parseTacticaLocation(entry.location);
				if (parsed) {
					await VSCodeNavigation.goTo(parsed.fileName, parsed.line, parsed.column);
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
