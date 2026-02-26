import * as vscode from 'vscode';
import { GraphPanel } from './webview/panel';
import { GraphProvider } from './graph/provider';
import { MnemonicaActivityBarProvider } from './activityBar';
import { GraphData } from './types';

let graphProvider: GraphProvider;
let statusBarItem: vscode.StatusBarItem;

export function activate (context: vscode.ExtensionContext) {
	console.log('Mnemonica Graphica extension activated');

	// Initialize graph provider
	graphProvider = new GraphProvider();

	// Register Activity Bar webview provider
	const activityBarProvider = new MnemonicaActivityBarProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(MnemonicaActivityBarProvider.viewType, activityBarProvider)
	);

	// Create status bar item
	statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100
	);
	statusBarItem.text = 'ψ';
	statusBarItem.tooltip = 'Show Mnemonica Type Graph';
	statusBarItem.command = 'mnemographica.showTypeGraph';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	// Register show graph command
	const showGraphCommand = vscode.commands.registerCommand(
		'mnemographica.showTypeGraph',
		async () => {
			await showTypeGraph(context);
		}
	);
	context.subscriptions.push(showGraphCommand);

	// Register refresh command
	const refreshCommand = vscode.commands.registerCommand(
		'mnemographica.refreshGraph',
		async () => {
			await refreshTypeGraph(context);
		}
	);
	context.subscriptions.push(refreshCommand);

	// Set up file watcher for .ts files
	const watcher = vscode.workspace.createFileSystemWatcher('**/*.ts');
	watcher.onDidChange(async () => {
		await handleFileChange(context);
	});
	watcher.onDidCreate(async () => {
		await handleFileChange(context);
	});
	context.subscriptions.push(watcher);

	// Set up watcher for .tactica output
	const tacticaWatcher = vscode.workspace.createFileSystemWatcher('**/.tactica/types.ts');
	tacticaWatcher.onDidChange(async () => {
		console.log('.tactica/types.ts changed, refreshing graph...');
		await refreshTypeGraph(context);
	});
	context.subscriptions.push(tacticaWatcher);
}

async function showTypeGraph (context: vscode.ExtensionContext) {
	try {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			vscode.window.showErrorMessage('No workspace folder open');
			return;
		}

		// Load graph data
		const graphData = await vscode.window.withProgress<GraphData | null>(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Loading mnemonica type graph...',
				cancellable: false
			},
			async () => {
				return await graphProvider.loadGraph(workspaceFolders[0].uri.fsPath);
			}
		);

		// Check if we got any data
		if (!graphData || graphData.nodes.length === 0) {
			const result = await vscode.window.showWarningMessage(
				'No mnemonica types found. Make sure you have run "tactica" to generate .tactica/types.ts',
				'Run Tactica',
				'Open Example'
			);
			if (result === 'Run Tactica') {
				// Could open terminal and run tactica
				const terminal = vscode.window.createTerminal('Tactica');
				terminal.sendText('npx tactica');
				terminal.show();
			}
			return;
		}

		// Show the graph panel
		GraphPanel.createOrShow(context.extensionUri, graphData);

		// Also update the tree view
		// Convert D3 nodes back to TypeNode format for tree view
		// For now, we'll need to get the raw TypeNodes from the provider
		// This is a simplified approach - ideally the provider would expose the raw TypeNode[]
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		vscode.window.showErrorMessage(`Failed to load type graph: ${message}`);
	}
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function refreshTypeGraph (_context: vscode.ExtensionContext) {
	try {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			return;
		}

		// Clear cache and reload
		graphProvider.clearCache();
		await graphProvider.loadGraph(workspaceFolders[0].uri.fsPath);

		// Update panel if visible
		GraphPanel.updateGraph(graphProvider.getGraphData());
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		vscode.window.showErrorMessage(`Failed to refresh graph: ${message}`);
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let debounceTimer: any = null;

async function handleFileChange (context: vscode.ExtensionContext) {
	// Debounce file changes
	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}

	debounceTimer = setTimeout(async () => {
		const config = vscode.workspace.getConfiguration('mnemographica');
		const autoRefresh = config.get<boolean>('autoRefresh', true);

		if (autoRefresh && GraphPanel.currentPanel) {
			await refreshTypeGraph(context);
		}
	}, 1000);
}

export function deactivate () {
	if (statusBarItem) {
		statusBarItem.dispose();
	}
}