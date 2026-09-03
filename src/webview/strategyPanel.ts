'use strict';

import * as vscode from 'vscode';
import * as path from 'node:path';
import {
	startStrategyProcess,
	stopStrategyProcess,
	getStrategyProcessStatus,
	setStrategyLogListener,
} from '../strategy/processManager';

/**
 * Strategy tab (Strategy reframe, 2026-09-01): run/stop the Strategy MCP
 * server as a child process and watch its log socket live. The child's
 * stdout is the MCP protocol — never surfaced here; the log socket
 * (STRATEGY_LOG_PORT) is the observability surface.
 */

export class StrategyPanel {
	private static current: StrategyPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];

	static createOrShow (): void {
		if (StrategyPanel.current) {
			StrategyPanel.current.panel.reveal();
			StrategyPanel.current.pushState();
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			'mnemographicaStrategy',
			'Mnemonica Strategy',
			vscode.ViewColumn.One,
			{ enableScripts: true }
		);
		StrategyPanel.current = new StrategyPanel(panel);
	}

	private constructor (panel: vscode.WebviewPanel) {
		this.panel = panel;
		this.panel.webview.html = this.getHtml();
		this.panel.onDidDispose(() => {
			setStrategyLogListener(null);
			StrategyPanel.current = undefined;
		}, null, this.disposables);
		this.panel.webview.onDidReceiveMessage((message: { type?: string }) => {
			if (message && message.type === 'start') {
				this.start();
			}
			if (message && message.type === 'stop') {
				stopStrategyProcess();
				this.pushState();
			}
		}, null, this.disposables);
		setStrategyLogListener((line: string) => {
			void this.panel.webview.postMessage({ type: 'log', line });
		});
		this.pushState();
	}

	private start (): void {
		const config = vscode.workspace.getConfiguration('mnemographica');
		const logPort = config.get<number>('strategyLogPort', 9250);
		let strategyDir: string;
		try {
			const pkgPath = require.resolve('@mnemonica/strategy/package.json');
			strategyDir = path.dirname(pkgPath);
		} catch {
			void this.panel.webview.postMessage({
				type : 'log',
				line : '[mnemographica] @mnemonica/strategy is not installed — cannot start the MCP server',
			});
			return;
		}
		startStrategyProcess(strategyDir, logPort);
		this.pushState();
	}

	private pushState (): void {
		const status = getStrategyProcessStatus();
		void this.panel.webview.postMessage({ type: 'state', status });
	}

	private getHtml (): string {
		const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Mnemonica Strategy</title>
<style>
	body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); }
	button { margin-right: 8px; padding: 4px 14px; }
	#status { margin: 10px 0; font-weight: bold; }
	#log { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border);
		padding: 8px; height: 70vh; overflow-y: auto; white-space: pre-wrap;
		font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
</style>
</head>
<body>
	<h2>Strategy MCP</h2>
	<div>
		<button id="start">Start</button>
		<button id="stop">Stop</button>
	</div>
	<div id="status">stopped</div>
	<div id="log"></div>
	<script>
		const vscode = acquireVsCodeApi();
		const statusEl = document.getElementById('status');
		const logEl = document.getElementById('log');
		document.getElementById('start').addEventListener('click', () => vscode.postMessage({ type: 'start' }));
		document.getElementById('stop').addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
		window.addEventListener('message', (event) => {
			const message = event.data;
			if (message.type === 'state') {
				const s = message.status;
				statusEl.textContent = s.running
					? ('running — pid ' + s.pid + ', log port ' + s.logPort)
					: 'stopped';
			}
			if (message.type === 'log') {
				logEl.textContent += message.line + '\\n';
				logEl.scrollTop = logEl.scrollHeight;
			}
		});
	</script>
</body>
</html>`;
		return html;
	}
}
