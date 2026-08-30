import * as vscode from 'vscode';
import { MnemonicaActivityBarProvider } from './activityBar';
import { MnemonicaTreeProvider, MnemonicaTreeItem } from './views/treeProvider';
import { UsagesTreeProvider, UsageTreeItem } from './views/usagesTreeProvider';
import { FlowTreeProvider, FlowTreeItem } from './views/flowTreeProvider';
import { GenTreeProvider, GenTreeItem } from './views/genTreeProvider';
import { MnemonicaDefinitionProvider } from './providers/definitionProvider';
import { MnemonicaReferenceProvider } from './providers/referenceProvider';
import { StrategyServer } from './strategy';
import { getLogger } from './services/LoggerService';
import { VSCodeNavigation } from './services/NavigationAdapter';
import { loadModels, modelsLoaded } from './topologica/bootstrap';
import { MainOrchestrator } from './core/MainOrchestrator';
import { GraphPanel } from './webview/panel';
import { registerNavigationCommands } from './commands/navigationCommands';
import { registerTreeCommands } from './commands/treeCommands';
import { registerUtilityCommands } from './commands/utilityCommands';
import { registerWorkspaceCommands } from './commands/workspaceCommands';

let treeProvider: MnemonicaTreeProvider;
let treeView: vscode.TreeView<MnemonicaTreeItem>;
let usagesProvider: UsagesTreeProvider;
let usagesTreeView: vscode.TreeView<UsageTreeItem>;
let flowProvider: FlowTreeProvider;
let flowTreeView: vscode.TreeView<FlowTreeItem>;
let genProvider: GenTreeProvider;
let genTreeView: vscode.TreeView<GenTreeItem>;
let definitionProvider: MnemonicaDefinitionProvider;
let referenceProvider: MnemonicaReferenceProvider;
let strategyServer: StrategyServer;
let statusBarItem: vscode.StatusBarItem;
let mainOrchestrator: MainOrchestrator;

export function activate(context: vscode.ExtensionContext) {
	// Initialize logger first so we can capture all subsequent logs
	const logger = getLogger();
	logger.initialize(context);

	logger.info('Mnemonica Graphica extension activated');

	// Initialize tree provider
	treeProvider = new MnemonicaTreeProvider();
	logger.info('TreeProvider created');

	// Create tree view with explicit TreeView reference for programmatic control
	treeView = vscode.window.createTreeView('mnemonicaTypes', {
		treeDataProvider: treeProvider,
		canSelectMany: false
	});
	context.subscriptions.push(treeView);

	// Initialize usages tree provider
	usagesProvider = new UsagesTreeProvider();
	logger.info('UsagesTreeProvider created');

	// Create usages tree view positioned above main tree
	usagesTreeView = vscode.window.createTreeView('mnemonicaUsages', {
		treeDataProvider: usagesProvider,
		canSelectMany: false
	});
	context.subscriptions.push(usagesTreeView);

	// Initialize flow tree provider
	flowProvider = new FlowTreeProvider();
	logger.info('FlowTreeProvider created');

	// Create flow tree view
	flowTreeView = vscode.window.createTreeView('mnemonicaFlow', {
		treeDataProvider: flowProvider,
		canSelectMany: false
	});
	context.subscriptions.push(flowTreeView);

	// Initialize generation tree provider
	genProvider = new GenTreeProvider();
	logger.info('GenTreeProvider created');

	// Create generation tree view
	genTreeView = vscode.window.createTreeView('mnemonicaGen', {
		treeDataProvider: genProvider,
		canSelectMany: false
	});
	context.subscriptions.push(genTreeView);

	// Register navigation command for flow entries
	// NOTE: VSCodeNavigation.goTo converts 1-based locations to 0-based
	// internally — pass the raw 1-based line/column from flow.json through.
	context.subscriptions.push(
		vscode.commands.registerCommand('mnemographica.navigateToLocation', async (location: { filePath: string; line: number; column: number }) => {
			try {
				await VSCodeNavigation.goTo(location.filePath, location.line, location.column);
			} catch (err) {
				logger.error('Failed to navigate to:', location.filePath, err);
			}
		})
	);

	// Register focus-or-navigate command (By Generation panel clicks):
	// rotate the 3D graph when it is on screen, jump to file otherwise
	context.subscriptions.push(
		vscode.commands.registerCommand('mnemographica.focusOrNavigate', async (target: {
			id: string;
			name: string;
			filePath?: string;
			line?: number;
			column?: number;
		}) => {
			if (!target) { return; }
			const rotated = GraphPanel.focusNode({ id: target.id, name: target.name });
			if (rotated) { return; }
			if (target.filePath) {
				try {
					await VSCodeNavigation.goTo(target.filePath, target.line ?? 0, target.column ?? 0);
				} catch (err) {
					logger.error('Failed to navigate to:', target.filePath, err);
				}
			}
		})
	);

	// Register show flows command (right-click on type/definition)
	context.subscriptions.push(
		vscode.commands.registerCommand('mnemographica.showFlows', (item: { data: { fullName?: string; label: string } }) => {
			if (!item || !item.data) { return; }
			const typeName = item.data.fullName || item.data.label;
			const searchName = typeName.replace(/Instance$/, '').replace(/_/g, '.');
			flowProvider.setFilterType(searchName);
			// Focus the Flow panel
			vscode.commands.executeCommand('mnemonicaFlow.focus');
			logger.info(`[Extension] Show flows for: ${searchName}`);
		})
	);

	// Register clear flow filter command (toolbar button in Flow panel)
	context.subscriptions.push(
		vscode.commands.registerCommand('mnemographica.clearFlowFilter', () => {
			flowProvider.clearFilter();
			logger.info('[Extension] Flow filter cleared');
		})
	);

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

	// Create main orchestrator
	mainOrchestrator = new MainOrchestrator(context.extension.packageJSON.version || '0.1.0');
	// The strategy server's trace-ingest/state-query read through it
	strategyServer.setOrchestrator(mainOrchestrator);
	// Reference provider reads usages from the orchestrator's Registry —
	// no private disk copy (single load path, model audit)
	referenceProvider.setOrchestrator(mainOrchestrator);
	logger.info('MainOrchestrator created');

	// Register commands from command files (all deps now initialized)
	const navigationCommands = registerNavigationCommands(treeProvider, usagesProvider);
	const treeCommands = registerTreeCommands(treeProvider, usagesProvider, referenceProvider, mainOrchestrator);
	const utilityCommands = registerUtilityCommands(strategyServer);
	const workspaceCommands = registerWorkspaceCommands(treeProvider, referenceProvider, flowProvider, mainOrchestrator);

	navigationCommands.forEach(cmd => context.subscriptions.push(cmd));
	treeCommands.forEach(cmd => context.subscriptions.push(cmd));
	utilityCommands.forEach(cmd => context.subscriptions.push(cmd));
	workspaceCommands.forEach(cmd => context.subscriptions.push(cmd));

	// Graph commands (formerly commands/graphCommands.ts). The 2.5D panel
	// was retired by owner decision; the 2D/3D webview panel remains and
	// feeds straight from the orchestrator, same as the generation view.
	context.subscriptions.push(
		vscode.commands.registerCommand('mnemographica.showTypeGraph', async () => {
			const workspacePath = treeProvider?.getCurrentWorkspace() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!workspacePath) {
				vscode.window.showWarningMessage('No workspace selected. Please select a workspace first.');
				return;
			}
			const graphData = mainOrchestrator.getGraphData();
			if (!graphData) {
				vscode.window.showErrorMessage('No graph data available. Load a workspace first.');
				return;
			}
			logger.info(`Loaded graph with ${graphData.nodes.length} nodes and ${graphData.links.length} links`);
			GraphPanel.createOrShow(context.extensionUri, graphData);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('mnemographica.refreshGraph', async () => {
			await refreshTypeGraph(context);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('mnemographica.refreshGenTree', async () => {
			const graphData = mainOrchestrator.getGraphData();
			if (!graphData) {
				vscode.window.showWarningMessage('No graph data available. Load a workspace first.');
				return;
			}
			genProvider.setGraphData(graphData);
			logger.info(`[GenTree] Refreshed with ${graphData.nodes.length} nodes`);
			vscode.window.showInformationMessage(`By Generation: ${graphData.nodes.length} types loaded`);
		})
	);

	// Navigate to definition when item is selected and update usages view
	treeView.onDidChangeSelection(async (event) => {
		const selected = event.selection[0];
		if (!selected || !selected.data.fullPath) {
			// Clear usages when nothing is selected
			usagesProvider.clear();
			return;
		}

		// Update usages view with usages for the selected type
		const typeName = selected.data.fullName || selected.data.label;
		const searchName = typeName.replace(/Instance$/, '').replace(/_/g, '.');
		logger.info(`[Extension] Selection changed to: ${typeName}, searching usages for: ${searchName}`);

		// Get usages from reference provider
		const usages = referenceProvider.getUsagesForType(searchName);
		if (usages && usages.length > 0) {
			// Convert to UsageItemData format
			const usageItems = usages.map(u => ({
				filePath: u.filePath,
				line: u.line,
				column: u.column,
				context: u.context || '',
				kind: 'reference' // Default kind, can be enhanced later
			}));
			usagesProvider.setType(typeName, usageItems);
			logger.info(`[Extension] Loaded ${usageItems.length} usages for ${typeName}`);
		} else {
			usagesProvider.clear();
			logger.info(`[Extension] No usages found for ${typeName}`);
		}

		// Navigate to the selected item — unless the 3D graph is on screen,
		// in which case rotate the graph to the node instead of stealing
		// the editor (owner decision 2026-08-29: rotate when 3D open,
		// jump to file when it is closed/hidden)
		if (selected.data.fullPath) {
			const nodeId = selected.data.fullName || selected.data.label;
			const rotated = GraphPanel.focusNode({ id: nodeId, name: selected.data.label });
			if (rotated) {
				return;
			}
			try {
				await VSCodeNavigation.goTo(
					selected.data.fullPath,
					selected.data.line ?? 0,
					selected.data.column ?? 0
				);
			} catch (err) {
				logger.error('Failed to navigate to:', selected.data.fullPath, err);
			}
		}
	});

	// Optional: Log expand/collapse events for debugging
	treeView.onDidExpandElement((event) => {
		logger.debug('Tree item expanded:', event.element.data.label);
	});

	treeView.onDidCollapseElement((event) => {
		logger.debug('Tree item collapsed:', event.element.data.label);
	});

	// Load definitions from workspace if available
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders && modelsLoaded) {
		const workspacePath = workspaceFolders[0].uri.fsPath;
		logger.info('Loading tree definitions from:', workspacePath);

		// Load all models through MainOrchestrator
		mainOrchestrator.loadWorkspace(workspacePath).then(async () => {
			logger.info('Workspace loaded successfully via MainOrchestrator');
			// Load navigation provider data — MUST run after the
			// orchestrator load: the reference provider no longer reads
			// usages.json itself, it reads the Registry's Usages
			// instance (single load path)
			logger.info('Loading navigation providers data...');
			referenceProvider.loadUsages();

			// Update tree provider with registry data
			treeProvider.setWorkspace(workspacePath);
			treeProvider.setRegistry(mainOrchestrator.getRegistry());
			await treeProvider.loadFromRegistry();
			treeProvider.refresh();
			// Update flow provider
			flowProvider.setRegistry(mainOrchestrator.getRegistry());
			// Feed the generation tree view and the graph panel (if open)
			const graphData = mainOrchestrator.getGraphData();
			if (graphData) {
				logger.info(`[Extension] Graph data: ${graphData.nodes.length} nodes, ${graphData.links.length} links, ${graphData.execflow.length} exec links`);
				genProvider.setGraphData(graphData);
				GraphPanel.updateGraph(graphData);
			}
		}).catch((err: Error) => {
			logger.error('Failed to load workspace:', err);
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
	statusBarItem.tooltip = 'Show Mnemonica Types';
	statusBarItem.command = 'mnemonicaTypes.focus';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

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

	// Debug handle for agent-driven automation (Strategy/CDP channel).
	// Deliberately global: the extension host exposes no other
	// reachable entrypoint for external tooling.
	const debugHandle = {
		version : context.extension.packageJSON.version as string,
		treeProvider,
		treeView,
		usagesProvider,
		flowProvider,
		genProvider,
		mainOrchestrator,
		strategyServer
	};
	(globalThis as { __mnemographica?: unknown }).__mnemographica = debugHandle;
}

async function refreshTypeGraph(_context: vscode.ExtensionContext) {
	const logger = getLogger();
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		return;
	}

	// Refresh registry and tree view
	if (treeProvider && mainOrchestrator) {
		await mainOrchestrator.refresh();
		treeProvider.refresh();
		const graphData = mainOrchestrator.getGraphData();
		if (graphData) {
			genProvider.setGraphData(graphData);
			GraphPanel.updateGraph(graphData);
		}
	}

	// Refresh navigation providers. Both caches must go: the definition
	// cache used to survive tactica regeneration, so Ctrl+Click resolved
	// against stale locations until window reload (audit B5).
	if (definitionProvider) {
		definitionProvider.clearCache();
	}
	if (referenceProvider) {
		referenceProvider.clear();
		await referenceProvider.loadUsages();
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
