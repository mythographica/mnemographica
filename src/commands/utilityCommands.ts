'use strict';

import * as vscode from 'vscode';
import { StrategyServer } from '../strategy/server';
import { getLogger } from '../services/LoggerService';

export function registerUtilityCommands(strategyServer: StrategyServer): vscode.Disposable[] {
	const logger = getLogger();
	const disposables: vscode.Disposable[] = [];

	disposables.push(
		vscode.commands.registerCommand('mnemographica.showLogger', async () => {
			logger.show();
		})
	);

	disposables.push(
		vscode.commands.registerCommand('mnemographica.showStrategyStatus', async () => {
			const status = strategyServer.getStatus();
			logger.info('Strategy server status:', status);
			vscode.window.showInformationMessage(
				`Strategy MCP: ${status.running ? 'Running' : 'Stopped'} (HTTP: ${status.httpPort}, WS: ${status.wsPort})`
			);
		})
	);

	return disposables;
}
