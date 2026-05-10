'use strict';

import * as vscode from 'vscode';
import { GraphPanel } from '../webview/panel';
import { GraphProvider } from '../graph/provider';
import { MnemonicaTreeProvider } from '../views/treeProvider';
import { getLogger } from '../services/LoggerService';

export function registerGraphCommands(
	context: vscode.ExtensionContext,
	graphProvider: GraphProvider,
	treeProvider: MnemonicaTreeProvider
): vscode.Disposable[] {
	const logger = getLogger();
	const disposables: vscode.Disposable[] = [];

	disposables.push(
		vscode.commands.registerCommand('mnemographica.showTypeGraph', async () => {
			const workspacePath = treeProvider?.getCurrentWorkspace() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

			if (!workspacePath) {
				vscode.window.showWarningMessage('No workspace selected. Please select a workspace first.');
				return;
			}

			try {
				const graphData = await graphProvider.loadGraph(workspacePath);
				logger.info(`Loaded graph with ${graphData.nodes.length} nodes and ${graphData.links.length} links`);
				GraphPanel.createOrShow(context.extensionUri, graphData);
			} catch (error) {
				logger.error('Failed to load type graph:', error);
				vscode.window.showErrorMessage('Failed to load type graph. Make sure tactica has generated types.');
			}
		})
	);

	disposables.push(
		vscode.commands.registerCommand('mnemographica.refreshGraph', async () => {
			graphProvider.clearCache();
			logger.info('Type graph refreshed');
			vscode.window.showInformationMessage('Type graph refreshed');
		})
	);

	return disposables;
}
