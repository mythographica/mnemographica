'use strict';

import * as vscode from 'vscode';
import { MnemonicaTreeProvider } from '../views/treeProvider';
import { UsagesTreeProvider } from '../views/usagesTreeProvider';
import { MnemonicaReferenceProvider } from '../providers/referenceProvider';
import { registry } from '../models/Registry';

export function registerTreeCommands(
	treeProvider: MnemonicaTreeProvider,
	_usagesProvider: UsagesTreeProvider,
	referenceProvider: MnemonicaReferenceProvider
): vscode.Disposable[] {
	const disposables: vscode.Disposable[] = [];

	disposables.push(
		vscode.commands.registerCommand('mnemographica.refreshTree', async () => {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (workspaceFolders) {
				await registry.refresh();
				treeProvider.refresh();
			}
		})
	);

	disposables.push(
		vscode.commands.registerCommand('mnemographica.showTreeView', async () => {
			await vscode.commands.executeCommand('workbench.view.explorer');
			await vscode.commands.executeCommand('mnemonicaTypes.focus');
		})
	);

	disposables.push(
		vscode.commands.registerCommand('mnemographica.showUsages', async (item: { data: { fullName?: string; label: string } }) => {
			if (!item) { return; }

			const typeName = item.data.fullName || item.data.label;
			const searchName = typeName.replace(/Instance$/, '');

			const usages = referenceProvider.getUsagesForType(searchName);

			if (!usages || usages.length === 0) {
				vscode.window.showInformationMessage(`No usages found for ${typeName}`);
				return;
			}

			const quickPickItems = usages.map((usage, index) => ({
				label: `$(file-code) ${usage.filePath.split('/').pop() || usage.filePath}`,
				description: `${usage.filePath}:${usage.line}:${usage.column}`,
				detail: usage.context || 'No context available',
				index,
				usage
			}));

			const selected = await vscode.window.showQuickPick(quickPickItems, {
				placeHolder: `Select a usage of ${typeName} (${usages.length} found)`,
				matchOnDescription: true,
				matchOnDetail: true
			});

			if (selected) {
				await vscode.commands.executeCommand('mnemographica.navigateToUsage', {
					filePath: selected.usage.filePath,
					line: selected.usage.line,
					column: selected.usage.column
				});
			}
		})
	);

	disposables.push(
		vscode.commands.registerCommand('mnemographica.openUsage', async (usageData: { filePath: string; line: number; column: number }) => {
			await vscode.commands.executeCommand('mnemographica.navigateToUsage', usageData);
		})
	);

	return disposables;
}
