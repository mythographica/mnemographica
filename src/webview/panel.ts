import * as vscode from 'vscode';
import type { GraphData, WebviewMessage } from '../types/index.js';
import { getLogger } from '../services/LoggerService';

// Get logger instance once at module level
const logger = getLogger();

export class GraphPanel {
	public static currentPanel: GraphPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];

	public static createOrShow (extensionUri: vscode.Uri, graphData: GraphData | null) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		if (GraphPanel.currentPanel) {
			GraphPanel.currentPanel.panel.reveal(column);
			if (graphData) {
				GraphPanel.currentPanel.updateGraph(graphData);
			}
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'mnemonicaGraph',
			'Mnemonica Graph',
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(extensionUri, 'media')
				]
			}
		);

		GraphPanel.currentPanel = new GraphPanel(panel, extensionUri, graphData);
	}

	public static updateGraph (graphData: GraphData | null) {
		if (GraphPanel.currentPanel && graphData) {
			GraphPanel.currentPanel.updateGraph(graphData);
		}
	}

	private constructor (
		panel: vscode.WebviewPanel,
		extensionUri: vscode.Uri,
		graphData: GraphData | null
	) {
		this.panel = panel;

		// Set initial content
		this.panel.webview.html = this.getWebviewContent(graphData, extensionUri);

		// Handle messages from webview
		this.panel.webview.onDidReceiveMessage(
			async (message: WebviewMessage) => {
				switch (message.command) {
				case 'goToDefinition':
					if (message.data &&
						typeof message.data === 'object' &&
						'filePath' in message.data &&
						'line' in message.data &&
						'column' in message.data) {
						await this.handleGoToDefinition(message.data as {
							filePath: string;
							line: number;
							column: number;
						});
					}
					break;
				case 'ready':
					// Webview is ready, send data if we have it
					if (graphData) {
						this.updateGraph(graphData);
					}
					break;
				case 'log':
					// Forward webview logs to LoggerService
					if (message.data &&
						typeof message.data === 'object' &&
						'message' in message.data) {
						const logType = 'type' in message.data ? String(message.data.type) : 'info';
						const logMsg = String(message.data.message);
						if (logType === 'error') {
							logger.error('[Webview]', logMsg);
						} else if (logType === 'warn') {
							logger.warn('[Webview]', logMsg);
						} else {
							logger.info('[Webview]', logMsg);
						}
					}
					break;
				}
			},
			null,
			this.disposables
		);

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
	}

	private updateGraph (graphData: GraphData) {
		void this.panel.webview.postMessage({
			command: 'updateGraph',
			data: graphData
		});
	}

	private async handleGoToDefinition (location: {
		filePath: string;
		line: number;
		column: number;
	}) {
		try {
			const document = await vscode.workspace.openTextDocument(location.filePath);
			const editor = await vscode.window.showTextDocument(document);
			const position = new vscode.Position(location.line - 1, location.column - 1);
			editor.selection = new vscode.Selection(position, position);
			editor.revealRange(new vscode.Range(position, position));
		} catch (error) {
			void vscode.window.showErrorMessage(`Failed to open file: ${String(error)}`);
		}
	}

	private getWebviewContent (_graphData: GraphData | null, extensionUri: vscode.Uri): string {
		const config = vscode.workspace.getConfiguration('mnemographica');
		const showProperties = config.get<boolean>('showProperties', true);

		// Get URIs for local resources
		const styleUri = this.panel.webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'media', 'webview.css')
		);
		const scriptUri = this.panel.webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'media', 'webview.js')
		);

		// D3.js CDN
		const d3Uri = 'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js';
		// Three.js CDN
		const threeUri = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Mnemonica Graph</title>
	<link rel="stylesheet" href="${String(styleUri)}">
	<script src="${d3Uri}"></script>
	<script src="${threeUri}"></script>
</head>
<body>
	<div id="controls">
		<button id="zoom-in" title="Zoom In">+</button>
		<button id="zoom-out" title="Zoom Out">−</button>
		<button id="reset" title="Reset View">⟲</button>
		<button id="toggle-3d" title="Toggle 2D/3D">2D</button>
	</div>
	<div id="gen-controls" style="display: none;">
		<div class="gen-controls-header">Generation Distances</div>
		<div id="gen-controls-list"></div>
	</div>
	<div id="graph"></div>
	<div id="tooltip"></div>
	<div id="status"></div>

	<script>
		// Pass configuration to the webview script
		const SHOW_PROPERTIES_PLACEHOLDER = ${showProperties};
	</script>
	<script src="${String(scriptUri)}"></script>
</body>
</html>`;
	}

	public dispose () {
		GraphPanel.currentPanel = undefined;

		this.panel.dispose();

		while (this.disposables.length) {
			const x = this.disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}
}
