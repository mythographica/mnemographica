import * as vscode from 'vscode';
import * as path from 'path';
import { GraphPanel } from './webview/panel';
import { GraphProvider } from './graph/provider';
import { MnemonicaActivityBarProvider } from './activityBar';
import { MnemonicaTreeProvider, MnemonicaTreeItem } from './views/treeProvider';
import { MnemonicaDefinitionProvider } from './providers/definitionProvider';
import { MnemonicaReferenceProvider } from './providers/referenceProvider';
import { StrategyServer } from './strategy';
import { getLogger } from './services/LoggerService';
import { loadModels, modelsLoaded } from './topologica/bootstrap';

let graphProvider: GraphProvider;
let treeProvider: MnemonicaTreeProvider;
let treeView: vscode.TreeView<MnemonicaTreeItem>;
let definitionProvider: MnemonicaDefinitionProvider;
let referenceProvider: MnemonicaReferenceProvider;
let strategyServer: StrategyServer;
let statusBarItem: vscode.StatusBarItem;


export function activate(context: vscode.ExtensionContext) {
	// Initialize logger first so we can capture all subsequent logs
	const logger = getLogger();
	logger.initialize(context);

	logger.info('Mnemonica Graphica extension activated');

	// Initialize graph provider
	graphProvider = new GraphProvider();

	// Initialize tree provider
	treeProvider = new MnemonicaTreeProvider();
	logger.info('TreeProvider created');

	// Create tree view with explicit TreeView reference for programmatic control
	treeView = vscode.window.createTreeView('mnemonicaTypes', {
		treeDataProvider: treeProvider,
		canSelectMany: false
	});
	context.subscriptions.push(treeView);

	// Navigate to definition when item is selected
	treeView.onDidChangeSelection(async (event) => {
		const selected = event.selection[0];
		if (!selected || !selected.data.fullPath) return;

		try {
			const document = await vscode.workspace.openTextDocument(selected.data.fullPath);
			const editor = await vscode.window.showTextDocument(document);

			// Navigate to the specific line and column if available
			if (selected.data.line !== undefined) {
				let line, column;

				if (selected.data.isDefinition) {
					line = selected.data.line > 0 ? selected.data.line - 1 : 0;
					const _column = selected.data.column ?? 0;
					column = _column > 0 ? _column - 1 : 0;
				} else {
					line = selected.data.line;
					column = selected.data.column ?? 0;
				}

				const position = new vscode.Position(line, column);
				editor.selection = new vscode.Selection(position, position);
				editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.Default);
			}
		} catch (err) {
			logger.error('Failed to open file:', selected.data.fullPath, err);
		}
	});

	// Optional: Log expand/collapse events for debugging
	treeView.onDidExpandElement((event) => {
		logger.debug('Tree item expanded:', event.element.data.label);
	});

	treeView.onDidCollapseElement((event) => {
		logger.debug('Tree item collapsed:', event.element.data.label);
	});

	// Initialize and register navigation providers
	definitionProvider = new MnemonicaDefinitionProvider();
	referenceProvider = new MnemonicaReferenceProvider();

	// Register definition provider for TypeScript files
	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider(
			{ scheme: 'file', language: 'typescript' },
			definitionProvider
		)
	);

	// Register reference provider for TypeScript files
	context.subscriptions.push(
		vscode.languages.registerReferenceProvider(
			{ scheme: 'file', language: 'typescript' },
			referenceProvider
		)
	);

	logger.info('Navigation providers registered');

	// Initialize and start Strategy MCP server
	strategyServer = new StrategyServer(9230, 9231);
	strategyServer.start().catch((err: Error) => {
		logger.error('Failed to start Strategy server:', err);
	});

	// Register server cleanup on deactivation
	context.subscriptions.push({
		dispose: () => {
			strategyServer.stop();
		}
	});

	logger.info('Strategy MCP server initialized');

	// Load mnemonica models using topologica
	loadModels(context.extensionPath);
	logger.info('Models loaded via topologica bootstrap');


	// Load definitions from workspace if available
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders && modelsLoaded) {
		const workspacePath = workspaceFolders[0].uri.fsPath;
		logger.info('Loading tree definitions from:', workspacePath);
		treeProvider.loadDefinitions(workspacePath).catch((err: Error) => {
			logger.error('Failed to load tree definitions:', err);
		});

		// Load navigation provider data
		logger.info('Loading navigation providers data...');
		definitionProvider.loadDefinitions(workspacePath).catch((err: Error) => {
			logger.error('Failed to load definitions:', err);
		});
		referenceProvider.loadUsages(workspacePath).catch((err: Error) => {
			logger.error('Failed to load usages:', err, err.stack);
		});
	} else {
		logger.warn('No workspace folders found, skipping data load');
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
	statusBarItem.text = 'Ψ';
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

	// Register open tree item command (for context menu)
	const openTreeItemCommand = vscode.commands.registerCommand(
		'mnemographica.openTreeItem',
		async (item: MnemonicaTreeItem) => {
			if (item.data.fullPath) {
				const document = await vscode.workspace.openTextDocument(item.data.fullPath);
				const editor = await vscode.window.showTextDocument(document);
				// Navigate to the specific line and column if available
				if (item.data.line !== undefined) {
					const line = item.data.line;
					const column = item.data.column ?? 0;
					const position = new vscode.Position(line, column);
					editor.selection = new vscode.Selection(position, position);
					editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
				}
			}
		}
	);
	context.subscriptions.push(openTreeItemCommand);

	// Register show usages command (for context menu)
	type UsageQuickPickItem = {
		label: string;
		description: string;
		detail: string;
		index: number;
		usage: { filePath: string; line: number; column: number; context?: string };
	};

	const showUsagesCommand = vscode.commands.registerCommand(
		'mnemographica.showUsages',
		async (item: MnemonicaTreeItem) => {
			if (!item) return;

			// Get the type name to lookup usages
			const typeName = item.data.fullName || item.data.label;
			logger.info('Showing usages for:', typeName);
			
			const searchName = typeName.replace(/Instance$/, '');
			logger.info('Showing usages for:', searchName);

			// Use referenceProvider to get usages
			const usages = referenceProvider.getUsagesForType(searchName);

			if (!usages || usages.length === 0) {
				vscode.window.showInformationMessage(`No usages found for ${typeName}`);
				return;
			}

			// Create quick pick items from usages
			const quickPickItems: UsageQuickPickItem[] = usages.map((usage, index) => ({
				label: `$(file-code) ${path.basename(usage.filePath)}`,
				description: `${usage.filePath}:${usage.line}:${usage.column}`,
				detail: usage.context || 'No context available',
				index,
				usage
			}));

			// Show quick pick
			const selected = await vscode.window.showQuickPick(quickPickItems, {
				placeHolder: `Select a usage of ${typeName} (${usages.length} found)`,
				matchOnDescription: true,
				matchOnDetail: true
			});

			if (selected) {
				// Navigate to the selected usage
				try {
					const document = await vscode.workspace.openTextDocument(selected.usage.filePath);
					const editor = await vscode.window.showTextDocument(document);

					const line = selected.usage.line > 0 ? selected.usage.line - 1 : 0;
					const column = selected.usage.column > 0 ? selected.usage.column - 1 : 0;
					const position = new vscode.Position(line, column);
					editor.selection = new vscode.Selection(position, position);
					editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.Default);
				} catch (err) {
					logger.error('Failed to open usage file:', selected.usage.filePath, err);
				}
			}
		}
	);
	context.subscriptions.push(showUsagesCommand);

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

	// Register show strategy status command
	const strategyStatusCommand = vscode.commands.registerCommand(
		'mnemographica.showStrategyStatus',
		async () => {
			const status = strategyServer.getStatus();
			logger.info('Strategy server status:', status);
			vscode.window.showInformationMessage(
				`Strategy MCP: ${status.running ? 'Running' : 'Stopped'} (HTTP: ${status.httpPort}, WS: ${status.wsPort})`
			);
		}
	);
	context.subscriptions.push(strategyStatusCommand);

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

async function showTypeGraph(context: vscode.ExtensionContext) {
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

async function refreshTypeGraph(_context: vscode.ExtensionContext) {
	const logger = getLogger();
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		return;
	}

	const workspacePath = workspaceFolders[0].uri.fsPath;

	// Clear cache and reload
	graphProvider.clearCache();

	// Refresh tree view as well
	if (treeProvider) {
		treeProvider.clear();
		treeProvider.loadDefinitions(workspacePath);
	}

	// Refresh navigation providers
	if (definitionProvider) {
		definitionProvider.clear();
		definitionProvider.loadDefinitions(workspacePath);
	}
	if (referenceProvider) {
		referenceProvider.clear();
		referenceProvider.loadUsages(workspacePath);
	}

	logger.info('Type graph refreshed');
	vscode.window.showInformationMessage('Type graph refreshed');
}

let debounceTimer: NodeJS.Timeout | null = null;

async function handleFileChange(context: vscode.ExtensionContext) {
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

export function deactivate() {
	// Clean up
	const logger = getLogger();
	logger.info('Mnemonica Graphica extension deactivated');
}
