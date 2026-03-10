import * as vscode from 'vscode';
import { GraphPanel } from './webview/panel';
import { GraphProvider } from './graph/provider';
import { MnemonicaActivityBarProvider } from './activityBar';
import { MnemonicaTreeProvider } from './views/treeProvider';
import { getLogger } from './services/LoggerService';

let graphProvider: GraphProvider;
let treeProvider: MnemonicaTreeProvider;
let statusBarItem: vscode.StatusBarItem;

export function activate (context: vscode.ExtensionContext) {
	// Initialize logger first so we can capture all subsequent logs
	const logger = getLogger();
	logger.initialize(context);
	logger.show();

	logger.info('Mnemonica Graphica extension activated');

	// Initialize graph provider
	graphProvider = new GraphProvider();

	// Initialize and register tree provider
	treeProvider = new MnemonicaTreeProvider();
	logger.info('TreeProvider created');
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('mnemonicaTypes', treeProvider)
	);

	// Load definitions from workspace if available
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders) {
		logger.info('Loading tree definitions from:', workspaceFolders[0].uri.fsPath);
		treeProvider.loadDefinitions(workspaceFolders[0].uri.fsPath).catch((err: Error) => {
			logger.error('Failed to load tree definitions:', err);
		});
	} else {
		logger.warn('No workspace folders found, skipping tree load');
	}

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

	// Register refresh graph command
	const refreshCommand = vscode.commands.registerCommand(
		'mnemographica.refreshGraph',
		async () => {
			await refreshTypeGraph(context);
		}
	);
	context.subscriptions.push(refreshCommand);

	// Register refresh tree command
	const refreshTreeCommand = vscode.commands.registerCommand(
		'mnemographica.refreshTree',
		async () => {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (workspaceFolders) {
				treeProvider.loadDefinitions(workspaceFolders[0].uri.fsPath);
			}
		}
	);
	context.subscriptions.push(refreshTreeCommand);

	// Register show tree view command
	const showTreeCommand = vscode.commands.registerCommand(
		'mnemographica.showTreeView',
		async () => {
			await vscode.commands.executeCommand('workbench.view.explorer');
			await vscode.commands.executeCommand('mnemonicaTypes.focus');
		}
	);
	context.subscriptions.push(showTreeCommand);

	// Register show logger command
	const showLoggerCommand = vscode.commands.registerCommand(
		'mnemographica.showLogger',
		async () => {
			logger.show();
		}
	);
	context.subscriptions.push(showLoggerCommand);

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
		logger.info('.tactica/types.ts changed, refreshing graph...');
		await refreshTypeGraph(context);
	});
	tacticaWatcher.onDidCreate(async () => {
		logger.info('.tactica/types.ts created, refreshing graph...');
		await refreshTypeGraph(context);
	});
	context.subscriptions.push(tacticaWatcher);
}

async function showTypeGraph (context: vscode.ExtensionContext) {
	const logger = getLogger();
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		vscode.window.showWarningMessage('No workspace folder open');
		return;
	}

	try {
		// Load graph data
		const graphData = await graphProvider.loadGraph(workspaceFolders[0].uri.fsPath);
		logger.info(`Loaded graph with ${graphData.nodes.length} nodes and ${graphData.links.length} links`);

		// Create or show panel
		GraphPanel.createOrShow(context.extensionUri, graphData);
	} catch (error) {
		logger.error('Failed to load type graph:', error);
		vscode.window.showErrorMessage('Failed to load type graph. Make sure tactica has generated types.');
	}
}

async function refreshTypeGraph (_context: vscode.ExtensionContext) {
	const logger = getLogger();
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		return;
	}

	// Clear cache and reload
	graphProvider.clearCache();

	// Refresh tree view as well
	if (treeProvider) {
		treeProvider.clear();
		treeProvider.loadDefinitions(workspaceFolders[0].uri.fsPath);
	}

	logger.info('Type graph refreshed');
	vscode.window.showInformationMessage('Type graph refreshed');
}

let debounceTimer: NodeJS.Timeout | null = null;

async function handleFileChange (context: vscode.ExtensionContext) {
	const logger = getLogger();
	// Debounce the refresh
	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}

	logger.debug('File change detected, scheduling refresh...');
	debounceTimer = setTimeout(async () => {
		await refreshTypeGraph(context);
	}, 2000);
}

export function deactivate () {
	// Clean up
	const logger = getLogger();
	logger.info('Mnemonica Graphica extension deactivated');
}
