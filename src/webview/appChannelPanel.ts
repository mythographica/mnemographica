'use strict';

import * as vscode from 'vscode';
import { AppChannelClient, fetchDiscovery } from '../strategy/appChannelClient';
import { GraphPanel } from './panel';
import { LiveTraceTreeProvider } from '../views/liveTraceTreeProvider';
import type { MainOrchestrator } from '../core/MainOrchestrator';

/**
 * App Channel tab (Strategy reframe, 2026-09-01): connect Mnemographica
 * DIRECTLY to an application's self-hosted strategy WS channel — the app's
 * own `.start()` (startStrategyClient), no CDP, no strategy MCP in the
 * middle. Discovery URL or manual host/port/token; on connect the client
 * traceSubscribe's and the edges feed the same ingest path the
 * strategy-driven push uses (orchestrator → 3D panel + Live Trace).
 */

interface ConnectMessage {
	type: 'connect';
	host: string;
	port: number;
	token: string;
}

interface DiscoveryMessage {
	type: 'discover';
	url: string;
}

export class AppChannelPanel {
	private static current: AppChannelPanel | undefined;
	private static orchestrator: MainOrchestrator | null = null;
	private readonly panel: vscode.WebviewPanel;
	private readonly client: AppChannelClient;
	private readonly disposables: vscode.Disposable[] = [];

	static setOrchestrator (orchestrator: MainOrchestrator): void {
		AppChannelPanel.orchestrator = orchestrator;
	}

	static createOrShow (): void {
		if (AppChannelPanel.current) {
			AppChannelPanel.current.panel.reveal();
			AppChannelPanel.current.pushState();
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			'mnemographicaAppChannel',
			'Mnemonica App Channel',
			vscode.ViewColumn.One,
			{ enableScripts: true }
		);
		AppChannelPanel.current = new AppChannelPanel(panel);
	}

	private constructor (panel: vscode.WebviewPanel) {
		this.panel = panel;
		this.client = new AppChannelClient({
			ingest : (edges: unknown[], session: string) => {
				const orchestrator = AppChannelPanel.orchestrator;
				if (!orchestrator) {
					return;
				}
				// Same landing as strategy's trace/ingest: ring + 3D + tree
				const result = orchestrator.ingestTrace(edges, session);
				GraphPanel.pushTraceEdges(result.edges);
				LiveTraceTreeProvider.noteIngest();
				this.pushState();
			},
		});
		this.panel.webview.html = this.getHtml();
		this.panel.onDidDispose(() => {
			this.client.disconnect();
			AppChannelPanel.current = undefined;
		}, null, this.disposables);
		this.panel.webview.onDidReceiveMessage((message: ConnectMessage | DiscoveryMessage | { type: string }) => {
			void this.handleMessage(message);
		}, null, this.disposables);
		this.pushState();
	}

	private async handleMessage (message: ConnectMessage | DiscoveryMessage | { type: string }): Promise<void> {
		if (message.type === 'connect') {
			const m = message as ConnectMessage;
			await this.client.connect(m.host, m.port, m.token);
			this.pushState();
			return;
		}
		if (message.type === 'discover') {
			const m = message as DiscoveryMessage;
			try {
				const discovery = await fetchDiscovery(m.url);
				if (!discovery.available || typeof discovery.port !== 'number' || !discovery.token) {
					void this.panel.webview.postMessage({ type: 'error', text: 'channel not available at ' + m.url });
					return;
				}
				const url = new URL(m.url);
				await this.client.connect(url.hostname, discovery.port, discovery.token, discovery.pid);
			} catch (err) {
				const text = err instanceof Error ? err.message : String(err);
				void this.panel.webview.postMessage({ type: 'error', text });
			}
			this.pushState();
			return;
		}
		if (message.type === 'disconnect') {
			this.client.disconnect();
			this.pushState();
		}
	}

	private pushState (): void {
		const status = this.client.getStatus();
		void this.panel.webview.postMessage({ type: 'state', status });
	}

	private getHtml (): string {
		const config = vscode.workspace.getConfiguration('mnemographica');
		const defaultDiscovery = config.get<string>('appChannelDiscoveryUrl', 'http://127.0.0.1:3000/strategy/channel');
		const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Mnemonica App Channel</title>
<style>
	body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); }
	input { width: 46ch; margin: 2px 0; }
	button { margin: 4px 8px 4px 0; padding: 4px 14px; }
	fieldset { margin: 10px 0; border: 1px solid var(--vscode-panel-border); }
	#status { margin: 10px 0; font-weight: bold; }
	#error { color: var(--vscode-errorForeground); white-space: pre-wrap; }
</style>
</head>
<body>
	<h2>App Channel (direct, no CDP)</h2>
	<fieldset>
		<legend>Discovery</legend>
		<input id="discoveryUrl" value="${defaultDiscovery}"><br>
		<button id="discover">Discover &amp; Connect</button>
	</fieldset>
	<fieldset>
		<legend>Manual</legend>
		<input id="host" value="127.0.0.1" placeholder="host"><br>
		<input id="port" placeholder="port"><br>
		<input id="token" placeholder="token"><br>
		<button id="connect">Connect</button>
	</fieldset>
	<button id="disconnect">Disconnect</button>
	<div id="status">disconnected</div>
	<div id="error"></div>
	<script>
		const vscode = acquireVsCodeApi();
		const statusEl = document.getElementById('status');
		const errorEl = document.getElementById('error');
		document.getElementById('discover').addEventListener('click', () => {
			errorEl.textContent = '';
			vscode.postMessage({ type: 'discover', url: document.getElementById('discoveryUrl').value });
		});
		document.getElementById('connect').addEventListener('click', () => {
			errorEl.textContent = '';
			vscode.postMessage({
				type  : 'connect',
				host  : document.getElementById('host').value,
				port  : Number(document.getElementById('port').value),
				token : document.getElementById('token').value,
			});
		});
		document.getElementById('disconnect').addEventListener('click', () => {
			vscode.postMessage({ type: 'disconnect' });
		});
		window.addEventListener('message', (event) => {
			const message = event.data;
			if (message.type === 'state') {
				const s = message.status;
				statusEl.textContent = s.connected
					? ('connected to ' + s.host + ':' + s.port + ' (pid ' + s.pid + ') — ' + s.batchesReceived + ' batches, ' + s.edgesReceived + ' edges')
					: ('disconnected' + (s.lastError ? ' — ' + s.lastError : ''));
			}
			if (message.type === 'error') {
				errorEl.textContent = message.text;
			}
		});
	</script>
</body>
</html>`;
		return html;
	}
}
