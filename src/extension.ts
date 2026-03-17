import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GraphPanel } from './webview/panel';
import { GraphProvider } from './graph/provider';
import { MnemonicaActivityBarProvider } from './activityBar';
import { MnemonicaTreeProvider, MnemonicaTreeItem } from './views/treeProvider';
import { UsagesTreeProvider, UsageTreeItem } from './views/usagesTreeProvider';
// DefinitionProvider removed - will be re-implemented
import { MnemonicaReferenceProvider } from './providers/referenceProvider';
import { StrategyServer } from './strategy';
import { getLogger } from './services/LoggerService';
import { loadModels, modelsLoaded } from './topologica/bootstrap';

type WorkspaceQuickPickItem = {
	label: string;
	description: string;
	detail: string;
	workspacePath: string;
};

let graphProvider: GraphProvider;
let treeProvider: MnemonicaTreeProvider;
let treeView: vscode.TreeView<MnemonicaTreeItem>;
let usagesProvider: UsagesTreeProvider;
let usagesTreeView: vscode.TreeView<UsageTreeItem>;
// definitionProvider removed - will be re-implemented
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

	// Initialize usages tree provider
	usagesProvider = new UsagesTreeProvider();
	logger.info('UsagesTreeProvider created');

	// Create usages tree view positioned above main tree
	usagesTreeView = vscode.window.createTreeView('mnemonicaUsages', {
		treeDataProvider: usagesProvider,
		canSelectMany: false
	});
	context.subscriptions.push(usagesTreeView);

	// Register navigate to usage command
	const navigateToUsageCommand = vscode.commands.registerCommand(
		'mnemographica.navigateToUsage',
		async (usageData: { filePath: string; line: number; column: number }) => {
			try {
				const document = await vscode.workspace.openTextDocument(usageData.filePath);
				const editor = await vscode.window.showTextDocument(document);

				const line = usageData.line > 0 ? usageData.line - 1 : 0;
				const column = usageData.column > 0 ? usageData.column - 1 : 0;
				const position = new vscode.Position(line, column);
				editor.selection = new vscode.Selection(position, position);
				editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.Default);
			} catch (err) {
				logger.error('Failed to navigate to usage:', usageData.filePath, err);
			}
		}
	);
	context.subscriptions.push(navigateToUsageCommand);

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
	// definitionProvider removed - will be re-implemented
	referenceProvider = new MnemonicaReferenceProvider();

	// DefinitionProvider registration removed

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
		// definitionProvider.loadDefinitions removed - will be re-implemented
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
			logger.info('Showing usages for:', typeName, JSON.stringify(item.data), '|');
			
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

	// Register select workspace command
	const selectWorkspaceCommand = vscode.commands.registerCommand(
		'mnemographica.selectWorkspace',
		async () => {
			await selectWorkspace();
		}
	);
	context.subscriptions.push(selectWorkspaceCommand);

	// Register show logger command
	const showLoggerCommand = vscode.commands.registerCommand(
		'mnemographica.showLogger',
		async () => {
			logger.show();
		}
	);
	context.subscriptions.push(showLoggerCommand);

	// Register open usage command (used by usage tree items)
	const openUsageCommand = vscode.commands.registerCommand(
		'mnemographica.openUsage',
		async (usageData: { filePath: string; line: number; column: number }) => {
			try {
				const document = await vscode.workspace.openTextDocument(usageData.filePath);
				const editor = await vscode.window.showTextDocument(document);

				const line = usageData.line > 0 ? usageData.line - 1 : 0;
				const column = usageData.column > 0 ? usageData.column - 1 : 0;
				const position = new vscode.Position(line, column);
				editor.selection = new vscode.Selection(position, position);
				editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.Default);
			} catch (err) {
				logger.error('Failed to open usage:', usageData.filePath, err);
			}
		}
	);
	context.subscriptions.push(openUsageCommand);

	// Register reveal in explorer command
	const revealInExplorerCommand = vscode.commands.registerCommand(
		'mnemographica.revealInExplorer',
		async (item: UsageTreeItem) => {
			if (item?.usage?.filePath) {
				const uri = vscode.Uri.file(item.usage.filePath);
				await vscode.commands.executeCommand('revealInExplorer', uri);
			}
		}
	);
	context.subscriptions.push(revealInExplorerCommand);

	// Register go to usage command
	const goToUsageCommand = vscode.commands.registerCommand(
		'mnemographica.goToUsage',
		async (item: UsageTreeItem) => {
			if (item?.usage) {
				try {
					const document = await vscode.workspace.openTextDocument(item.usage.filePath);
					const editor = await vscode.window.showTextDocument(document);

					const line = item.usage.line > 0 ? item.usage.line - 1 : 0;
					const column = item.usage.column > 0 ? item.usage.column - 1 : 0;
					const position = new vscode.Position(line, column);
					editor.selection = new vscode.Selection(position, position);
					editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.Default);
				} catch (err) {
					logger.error('Failed to navigate to usage:', item.usage.filePath, err);
				}
			}
		}
	);
	context.subscriptions.push(goToUsageCommand);

	// Register go to type command (navigates to types.ts)
	const goToTypeCommand = vscode.commands.registerCommand(
		'mnemographica.goToType',
		async (item: UsageTreeItem) => {
			if (!item?.typeName) {
				logger.warn('No type name available for navigation');
				return;
			}

			const workspacePath = item.workspacePath || usagesProvider.getWorkspacePath();
			if (!workspacePath) {
				logger.warn('No workspace path available');
				return;
			}

			const typesTsPath = path.join(workspacePath, '.tactica', 'types.ts');
			if (!fs.existsSync(typesTsPath)) {
				logger.warn('types.ts not found at:', typesTsPath);
				vscode.window.showWarningMessage('types.ts not found. Run tactica first.');
				return;
			}

			try {
				// Read types.ts to find the type definition line
				const content = fs.readFileSync(typesTsPath, 'utf-8');
				const lines = content.split('\n');

				// Look for type export (e.g., "export type TypeName = {" or "export type TypeName = ProtoFlat<...")
				const typeName = item.typeName.replace(/Instance$/, '');
				const searchPattern = new RegExp(`export\\s+type\\s+${typeName}\\s*=`);

				let targetLine = 0;
				for (let i = 0; i < lines.length; i++) {
					if (searchPattern.test(lines[i])) {
						targetLine = i;
						break;
					}
				}

				const document = await vscode.workspace.openTextDocument(typesTsPath);
				const editor = await vscode.window.showTextDocument(document);

				const position = new vscode.Position(targetLine, 0);
				editor.selection = new vscode.Selection(position, position);
				editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.Default);
			} catch (err) {
				logger.error('Failed to open types.ts:', typesTsPath, err);
			}
		}
	);
	context.subscriptions.push(goToTypeCommand);

	// Register go to definition command (navigates to definitions.json location)
	const goToDefinitionCommand = vscode.commands.registerCommand(
		'mnemographica.goToDefinition',
		async (item: UsageTreeItem) => {
			if (!item?.typeName) {
				logger.warn('No type name available for navigation');
				return;
			}

			const workspacePath = item.workspacePath || usagesProvider.getWorkspacePath();
			if (!workspacePath) {
				logger.warn('No workspace path available');
				return;
			}

			const definitionsPath = path.join(workspacePath, '.tactica', 'definitions.json');
			if (!fs.existsSync(definitionsPath)) {
				logger.warn('definitions.json not found at:', definitionsPath);
				vscode.window.showWarningMessage('definitions.json not found. Run tactica first.');
				return;
			}

			try {
				// Read definitions.json to find the type definition
				const content = fs.readFileSync(definitionsPath, 'utf-8');
				const definitions = JSON.parse(content);

				const typeName = item.typeName.replace(/Instance$/, '');

				// Find the definition - definitions are keyed by type name
				let definition = definitions[typeName];

				// Also try with Instance suffix
				if (!definition && definitions[`${typeName}Instance`]) {
					definition = definitions[`${typeName}Instance`];
				}

				// Try nested path format (e.g., "Scene2D.GraphNode2D")
				if (!definition && typeName.includes('.')) {
					const parts = typeName.split('.');
					for (let i = 0; i < parts.length; i++) {
						const candidate = parts.slice(i).join('.');
						if (definitions[candidate]) {
							definition = definitions[candidate];
							break;
						}
						// Try with Instance suffix
						if (definitions[`${candidate}Instance`]) {
							definition = definitions[`${candidate}Instance`];
							break;
						}
					}
				}

				if (!definition || !definition.fullPath) {
					logger.warn('Definition not found for type:', typeName);
					vscode.window.showWarningMessage(`Definition not found for ${typeName}`);
					return;
				}

				const document = await vscode.workspace.openTextDocument(definition.fullPath);
				const editor = await vscode.window.showTextDocument(document);

				const line = definition.line > 0 ? definition.line - 1 : 0;
				const column = definition.column > 0 ? definition.column - 1 : 0;
				const position = new vscode.Position(line, column);
				editor.selection = new vscode.Selection(position, position);
				editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.Default);
			} catch (err) {
				logger.error('Failed to navigate to definition:', err);
			}
		}
	);
	context.subscriptions.push(goToDefinitionCommand);

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

async function findWorkspacesWithTactica (): Promise<WorkspaceQuickPickItem[]> {
	const logger = getLogger();
	const workspaces: WorkspaceQuickPickItem[] = [];
	const scannedPaths = new Set<string>();

	// Get starting points for scanning
	const scanRoots: string[] = [];

	// Add current workspace if available
	const currentWorkspace = treeProvider.getCurrentWorkspace();
	if (currentWorkspace) {
		scanRoots.push(path.dirname(currentWorkspace));
	}

	// Add VS Code workspace folders
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders) {
		for (const folder of workspaceFolders) {
			scanRoots.push(folder.uri.fsPath);
			// Also scan parent directories
			scanRoots.push(path.dirname(folder.uri.fsPath));
		}
	}

	// Add known workspace locations
	const knownPaths = [
		'/code/mnemonica',
		'/home/went/code/mnemonica',
		path.join(process.env.HOME || '', 'code', 'mnemonica'),
		path.join(process.env.HOME || '', 'projects', 'mnemonica')
	];
	scanRoots.push(...knownPaths);

	logger.info('[findWorkspaces] Scan roots:', scanRoots);

	for (const scanRoot of scanRoots) {
		if (!scanRoot || scannedPaths.has(scanRoot)) {
			continue;
		}
		scannedPaths.add(scanRoot);

		try {
			if (!fs.existsSync(scanRoot)) {
				continue;
			}

			const entries = fs.readdirSync(scanRoot, { withFileTypes: true });

			for (const entry of entries) {
				if (!entry.isDirectory()) {
					continue;
				}

				const fullPath = path.join(scanRoot, entry.name);
				const tacticaPath = path.join(fullPath, '.tactica');

				if (fs.existsSync(tacticaPath)) {
					// Check if it has the required files
					const hasTypes = fs.existsSync(path.join(tacticaPath, 'types.ts'));
					const hasDefinitions = fs.existsSync(path.join(tacticaPath, 'definitions.json'));

					if (hasTypes || hasDefinitions) {
						workspaces.push({
							label: entry.name,
							description: fullPath,
							detail: hasTypes && hasDefinitions ? 'Types + Definitions' : (hasTypes ? 'Types only' : 'Definitions only'),
							workspacePath: fullPath
						});
						logger.info('[findWorkspaces] Found workspace:', fullPath);
					}
				}
			}
		} catch (err) {
			logger.debug('[findWorkspaces] Error scanning:', scanRoot, err);
		}
	}

	// Sort by name
	workspaces.sort((a, b) => a.label.localeCompare(b.label));

	return workspaces;
}

async function selectWorkspace (): Promise<void> {
	const logger = getLogger();
	logger.info('[selectWorkspace] Scanning for workspaces...');

	// Show progress while scanning
	const workspaces = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Scanning for Mnemonica workspaces...',
			cancellable: false
		},
		async () => {
			return await findWorkspacesWithTactica();
		}
	);

	if (workspaces.length === 0) {
		vscode.window.showWarningMessage('No Mnemonica workspaces found with .tactica directories');
		return;
	}

	logger.info('[selectWorkspace] Found', workspaces.length, 'workspaces');

	// Show quick pick with found workspaces
	const selected = await vscode.window.showQuickPick(workspaces, {
		placeHolder: 'Select a workspace to load',
		matchOnDescription: true,
		matchOnDetail: true
	});

	if (!selected) {
		logger.info('[selectWorkspace] User cancelled selection');
		return;
	}

	logger.info('[selectWorkspace] Selected workspace:', selected.workspacePath);

	try {
		// Update tree provider
		treeProvider.setWorkspace(selected.workspacePath);
		await treeProvider.loadDefinitions(selected.workspacePath);
		treeProvider.refresh();

		// Update navigation providers
		// definitionProvider removed - will be re-implemented
		if (referenceProvider) {
			referenceProvider.clear();
			await referenceProvider.loadUsages(selected.workspacePath);
		}

		vscode.window.showInformationMessage(`Loaded workspace: ${selected.label}`);
		logger.info('[selectWorkspace] Workspace loaded successfully');
	} catch (err) {
		logger.error('[selectWorkspace] Failed to load workspace:', err);
		vscode.window.showErrorMessage(`Failed to load workspace: ${err}`);
	}
}

async function showTypeGraph(context: vscode.ExtensionContext) {
	const logger = getLogger();

	// Use the tree provider's current workspace, or fall back to first workspace folder
	const workspacePath = treeProvider?.getCurrentWorkspace() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

	if (!workspacePath) {
		vscode.window.showWarningMessage('No workspace selected. Please select a workspace first.');
		return;
	}

	try {
		// Load graph data from the selected workspace
		const graphData = await graphProvider.loadGraph(workspacePath);
		logger.info(`Loaded graph with ${graphData.nodes.length} nodes and ${graphData.links.length} links from ${workspacePath}`);

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
	// definitionProvider removed - will be re-implemented
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
