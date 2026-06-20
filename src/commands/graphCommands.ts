'use strict';

import * as vscode from 'vscode';
import { GraphPanel } from '../webview/panel';
import { GraphPanel25D } from '../webview/panel25d';
import { GraphProvider } from '../graph/provider';
import { MnemonicaTreeProvider } from '../views/treeProvider';
import { GenTreeProvider } from '../views/genTreeProvider';
import { getLogger } from '../services/LoggerService';

export function registerGraphCommands(
	context: vscode.ExtensionContext,
	graphProvider: GraphProvider,
	treeProvider: MnemonicaTreeProvider,
	genProvider: GenTreeProvider
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
				genProvider.setGraphData(graphData);
			} catch (error) {
				logger.error('Failed to load type graph:', error);
				vscode.window.showErrorMessage('Failed to load type graph. Make sure tactica has generated types.');
			}
		})
	);

	disposables.push(
		vscode.commands.registerCommand('mnemographica.showTypeGraph25D', async () => {
			const workspacePath = treeProvider?.getCurrentWorkspace() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!workspacePath) {
				vscode.window.showWarningMessage('No workspace selected. Please select a workspace first.');
				return;
			}
			try {
				const graphData = await graphProvider.loadGraph(workspacePath);
				logger.info(`Loaded graph for 2.5D with ${graphData.nodes.length} nodes and ${graphData.links.length} links + ${graphData.execflow?.length || 0} exec flows`);
				GraphPanel25D.createOrShow(context.extensionUri, graphData);
				genProvider.setGraphData(graphData);
			} catch (error) {
				logger.error('Failed to load type graph for 2.5D:', error);
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

	disposables.push(
		vscode.commands.registerCommand('mnemographica.refreshGenTree', async () => {
			const workspacePath = treeProvider?.getCurrentWorkspace() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!workspacePath) {
				vscode.window.showWarningMessage('No workspace selected.');
				return;
			}
			try {
				const graphData = await graphProvider.loadGraph(workspacePath);
				genProvider.setGraphData(graphData);
				logger.info(`[GenTree] Refreshed with ${graphData.nodes.length} nodes`);
				vscode.window.showInformationMessage(`By Generation: ${graphData.nodes.length} types loaded`);
			} catch (error) {
				logger.error('Failed to refresh gen tree:', error);
				vscode.window.showErrorMessage('Failed to refresh generation tree.');
			}
		})
	);

	return disposables;
}
