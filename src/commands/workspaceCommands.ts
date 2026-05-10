'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { MnemonicaTreeProvider } from '../views/treeProvider';
import { MnemonicaReferenceProvider } from '../providers/referenceProvider';
import { MainOrchestrator } from '../core/MainOrchestrator';
import { getLogger } from '../services/LoggerService';

type WorkspaceQuickPickItem = {
	label: string;
	description: string;
	detail: string;
	workspacePath: string;
};

export function registerWorkspaceCommands(
	treeProvider: MnemonicaTreeProvider,
	referenceProvider: MnemonicaReferenceProvider,
	mainOrchestrator: MainOrchestrator
): vscode.Disposable[] {
	const disposables: vscode.Disposable[] = [];

	disposables.push(
		vscode.commands.registerCommand('mnemographica.selectWorkspace', async () => {
			await selectWorkspace(treeProvider, referenceProvider, mainOrchestrator);
		})
	);

	return disposables;
}

async function selectWorkspace(
	treeProvider: MnemonicaTreeProvider,
	referenceProvider: MnemonicaReferenceProvider,
	mainOrchestrator: MainOrchestrator
): Promise<void> {
	const workspaces = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Scanning for Mnemonica workspaces...',
			cancellable: false
		},
		async () => findWorkspacesWithTactica(treeProvider)
	);

	const browseOption: WorkspaceQuickPickItem = {
		label: '$(folder-opened) Browse for .tactica directory...',
		description: 'Select a directory containing .tactica folder',
		detail: 'Browse',
		workspacePath: '__browse__'
	};

	const quickPickItems = workspaces.length > 0 ? [...workspaces, browseOption] : [browseOption];

	const selected = await vscode.window.showQuickPick(quickPickItems, {
		placeHolder: 'Select a workspace to load',
		matchOnDescription: true,
		matchOnDetail: true
	});

	if (!selected) { return; }

	if (selected.workspacePath === '__browse__') {
		await browseForWorkspace(treeProvider, referenceProvider, mainOrchestrator);
		return;
	}

	await loadWorkspace(selected.workspacePath, selected.label, treeProvider, referenceProvider, mainOrchestrator);
}

async function browseForWorkspace(
	treeProvider: MnemonicaTreeProvider,
	referenceProvider: MnemonicaReferenceProvider,
	mainOrchestrator: MainOrchestrator
): Promise<void> {
	const folderUri = await vscode.window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		openLabel: 'Select .tactica Directory',
		title: 'Select a directory containing .tactica folder'
	});

	if (!folderUri || folderUri.length === 0) { return; }

	let selectedPath = folderUri[0].fsPath;
	const tacticaPath = path.basename(selectedPath) === '.tactica'
		? selectedPath
		: path.join(selectedPath, '.tactica');

	if (path.basename(selectedPath) === '.tactica') {
		selectedPath = path.dirname(selectedPath);
	}

	if (!fs.existsSync(tacticaPath)) {
		vscode.window.showWarningMessage(`No .tactica folder found in ${selectedPath}`);
		return;
	}

	await loadWorkspace(selectedPath, path.basename(selectedPath), treeProvider, referenceProvider, mainOrchestrator);
}

async function loadWorkspace(
	workspacePath: string,
	label: string,
	treeProvider: MnemonicaTreeProvider,
	referenceProvider: MnemonicaReferenceProvider,
	mainOrchestrator: MainOrchestrator
): Promise<void> {
	const logger = getLogger();

	try {
		treeProvider.setWorkspace(workspacePath);
		await mainOrchestrator.loadWorkspace(workspacePath);
		treeProvider.setRegistry(mainOrchestrator.getRegistry());
		await treeProvider.loadFromRegistry();
		treeProvider.refresh();

		if (referenceProvider) {
			referenceProvider.clear();
			await referenceProvider.loadUsages(workspacePath);
		}

		vscode.window.showInformationMessage(`Loaded workspace: ${label}`);
		logger.info('[selectWorkspace] Workspace loaded successfully');
	} catch (err) {
		logger.error('[selectWorkspace] Failed to load workspace:', err);
		vscode.window.showErrorMessage(`Failed to load workspace: ${err}`);
	}
}

async function findWorkspacesWithTactica(treeProvider: MnemonicaTreeProvider): Promise<WorkspaceQuickPickItem[]> {
	const logger = getLogger();
	const workspaces: WorkspaceQuickPickItem[] = [];
	const scannedPaths = new Set<string>();

	const scanRoots: string[] = [];

	const currentWorkspace = treeProvider.getCurrentWorkspace();
	if (currentWorkspace) {
		scanRoots.push(path.dirname(currentWorkspace));
	}

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders) {
		for (const folder of workspaceFolders) {
			scanRoots.push(folder.uri.fsPath);
			scanRoots.push(path.dirname(folder.uri.fsPath));
		}
	}

	for (const scanRoot of scanRoots) {
		if (!scanRoot || scannedPaths.has(scanRoot)) { continue; }
		scannedPaths.add(scanRoot);

		try {
			if (!fs.existsSync(scanRoot)) { continue; }

			const entries = fs.readdirSync(scanRoot, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) { continue; }

				const fullPath = path.join(scanRoot, entry.name);
				const tacticaPath = path.join(fullPath, '.tactica');

				if (fs.existsSync(tacticaPath)) {
					const hasTypes = fs.existsSync(path.join(tacticaPath, 'types.ts'));
					const hasDefinitions = fs.existsSync(path.join(tacticaPath, 'definitions.json'));

					if (hasTypes || hasDefinitions) {
						workspaces.push({
							label: entry.name,
							description: fullPath,
							detail: hasTypes && hasDefinitions ? 'Types + Definitions' : (hasTypes ? 'Types only' : 'Definitions only'),
							workspacePath: fullPath
						});
					}
				}
			}
		} catch (err) {
			logger.debug('[findWorkspaces] Error scanning:', scanRoot, err);
		}
	}

	workspaces.sort((a, b) => a.label.localeCompare(b.label));
	return workspaces;
}
