import * as vscode from 'vscode';
import type { GraphData, WebviewMessage } from '../types/index.js';
import { getLogger } from '../services/LoggerService';

const logger = getLogger();

export class GraphPanel25D {
	public static currentPanel: GraphPanel25D | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];

	public static createOrShow (extensionUri: vscode.Uri, graphData: GraphData | null) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		if (GraphPanel25D.currentPanel) {
			GraphPanel25D.currentPanel.panel.reveal(column);
			if (graphData) {
				GraphPanel25D.currentPanel.updateGraph(graphData);
			}
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'mnemonicaGraph25D',
			'Mnemonica Graph 2.5D',
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(extensionUri, 'media')
				]
			}
		);

		GraphPanel25D.currentPanel = new GraphPanel25D(panel, extensionUri, graphData);
	}

	public static updateGraph (graphData: GraphData | null) {
		if (GraphPanel25D.currentPanel && graphData) {
			GraphPanel25D.currentPanel.updateGraph(graphData);
		}
	}

	private constructor (
		panel: vscode.WebviewPanel,
		extensionUri: vscode.Uri,
		graphData: GraphData | null
	) {
		this.panel = panel;
		this.panel.webview.html = this.getWebviewContent(graphData, extensionUri);

		this.panel.webview.onDidReceiveMessage(
			async (message: WebviewMessage) => {
				switch (message.command) {
				case 'goToDefinition':
					if (message.data &&
						typeof message.data === 'object' &&
						'fileName' in message.data &&
						'line' in message.data) {
						await this.handleGoToDefinition(message.data as {
							fileName: string;
							line: number;
							column: number;
						});
					}
					break;
				case 'ready':
					if (graphData) {
						this.updateGraph(graphData);
					}
					break;
				case 'log':
					if (message.data &&
						typeof message.data === 'object' &&
						'message' in message.data) {
						const logType = 'type' in message.data ? String(message.data.type) : 'info';
						const logMsg = String(message.data.message);
						if (logType === 'error') {
							logger.error('[Webview25D]', logMsg);
						} else if (logType === 'warn') {
							logger.warn('[Webview25D]', logMsg);
						} else {
							logger.info('[Webview25D]', logMsg);
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
		fileName: string;
		line: number;
		column: number;
	}) {
		try {
			const document = await vscode.workspace.openTextDocument(location.fileName);
			const editor = await vscode.window.showTextDocument(document);
			const position = new vscode.Position(location.line - 1, location.column - 1);
			editor.selection = new vscode.Selection(position, position);
			editor.revealRange(new vscode.Range(position, position));
		} catch (error) {
			void vscode.window.showErrorMessage(`Failed to open file: ${String(error)}`);
		}
	}

	private getWebviewContent (_graphData: GraphData | null, extensionUri: vscode.Uri): string {
		const styleUri = this.panel.webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'media', 'webview-25d.css')
		);
		const scriptUri = this.panel.webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'media', 'webview-25d.js')
		);

		return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Mnemonica Graph 2.5D</title>
	<link rel="stylesheet" href="${String(styleUri)}">
</head>
<body>
	<div id="graph-container">
		<canvas id="scene"></canvas>

		<div class="toolbar-overlay">
			<div class="brand">
				<div class="glyph"></div>
				<span class="name">Mnemonica Graphica</span>
			</div>
			<div class="spacer"></div>
			<div class="btn-row">
				<button id="dim-2d" class="tbtn">2D</button>
				<button id="dim-3d" class="tbtn active">3D</button>
			</div>
			<button id="zoom-out" class="tbtn" title="Zoom Out">−</button>
			<button id="zoom-in" class="tbtn" title="Zoom In">+</button>
			<button id="theme-btn" class="tbtn">Dark</button>
			<button id="reset-btn" class="tbtn" title="Reset View">Reset</button>
		</div>

		<div class="controls-panel">
			<div class="ctrl-row">
				<span class="ctrl-label">2D → 3D</span>
				<input type="range" id="r-mode" min="0" max="100" value="100">
				<span class="ctrl-val" id="v-mode">3D</span>
			</div>
			<div class="ctrl-row">
				<span class="ctrl-label">Angular</span>
				<input type="range" id="r-spread" min="50" max="200" value="100">
				<span class="ctrl-val" id="v-spread">1.0x</span>
			</div>
			<div class="ctrl-row">
				<span class="ctrl-label">Spacing</span>
				<input type="range" id="r-spacing" min="50" max="200" value="100">
				<span class="ctrl-val" id="v-spacing">1.0x</span>
			</div>
			<div class="ctrl-row">
				<span class="ctrl-label">3D depth</span>
				<input type="range" id="r-depth" min="50" max="400" value="165">
				<span class="ctrl-val" id="v-depth">165</span>
			</div>
		</div>

		<div class="status-bar">
			<span id="status">Loading...</span>
			<span>Drag to orbit / pan · Scroll to zoom · Click node to go to definition</span>
		</div>
	</div>

	<script src="${String(scriptUri)}"></script>
</body>
</html>`;
	}

	public dispose () {
		GraphPanel25D.currentPanel = undefined;
		this.panel.dispose();
		while (this.disposables.length) {
			const x = this.disposables.pop();
			if (x) { x.dispose(); }
		}
	}
}
