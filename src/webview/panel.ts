import * as vscode from 'vscode';
import type { GraphData, WebviewMessage } from '../types/index.js';
import { getLogger } from '../services/LoggerService';

// Get logger instance once at module level
const logger = getLogger();

export class GraphPanel {
	public static currentPanel: GraphPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];
	// Mirrors the webview's render mode ('modeChanged' messages); the
	// webview starts in 3D
	private currentMode: '2D' | '3D' = '3D';

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

	/**
	 * Focus the 3D camera on a graph node (sidebar click → rotate, not
	 * file jump). Returns true when the panel is open, visible, and in
	 * 3D mode — callers fall back to file navigation on false.
	 */
	public static focusNode (data: { id: string; name: string }): boolean {
		const current = GraphPanel.currentPanel;
		if (!current || !current.panel.visible || current.currentMode !== '3D') {
			return false;
		}
		void current.panel.webview.postMessage({
			command : 'focusNode',
			data
		});
		return true;
	}

	// Pending view-state roundtrips (state/query 'view'): the camera
	// lives in the webview, so a query posts 'queryViewState' and waits
	// for the matching 'viewState' response (resolved in the message
	// handler above).
	private static viewStateRequests = new Map<number, {
		resolve: (data: unknown) => void;
		timer: ReturnType<typeof setTimeout>;
	}>();
	private static viewStateRequestSeq = 0;

	/**
	 * Read back the live 3D view state (camera rotation/zoom/pan,
	 * focused node) for strategy's state-query. Returns { open: false }
	 * when the panel does not exist; on a webview timeout the panel
	 * facts still answer, with `view: null`.
	 */
	public static async queryViewState (): Promise<unknown> {
		const current = GraphPanel.currentPanel;
		if (!current) {
			const closed = { open: false };
			return closed;
		}
		const facts = {
			open    : true,
			visible : current.panel.visible,
			mode    : current.currentMode
		};
		if (!current.panel.visible || current.currentMode !== '3D') {
			const noView = Object.assign({ view: null }, facts);
			return noView;
		}
		const requestId = ++GraphPanel.viewStateRequestSeq;
		const view = await new Promise<unknown>((resolve) => {
			const timer = setTimeout(() => {
				GraphPanel.viewStateRequests.delete(requestId);
				resolve(null);
			}, 2000);
			GraphPanel.viewStateRequests.set(requestId, { resolve, timer });
			void current.panel.webview.postMessage({
				command : 'queryViewState',
				data    : { requestId }
			});
		});
		const result = Object.assign({ view }, facts);
		return result;
	}

	private constructor (
		panel: vscode.WebviewPanel,
		extensionUri: vscode.Uri,
		graphData: GraphData | null
	) {
		this.panel = panel;

		// Set initial content
		this.panel.title = 'Mnemonica Graph 3D';
		this.panel.webview.html = this.getWebviewContent(graphData, extensionUri);

		// Handle messages from webview
		this.panel.webview.onDidReceiveMessage(
			async (message: WebviewMessage) => {
				switch (message.command) {
				case 'goToDefinition':
					if (message.data &&
						typeof message.data === 'object' &&
						'fileName' in message.data &&
						'line' in message.data &&
						'column' in message.data) {
						await this.handleGoToDefinition(message.data as {
							fileName: string;
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
				case 'modeChanged':
					if (message.data && typeof message.data === 'object' && 'mode' in message.data) {
						const mode = String(message.data.mode);
						this.currentMode = mode === '3D' ? '3D' : '2D';
						this.panel.title = mode === '3D' ? 'Mnemonica Graph 3D' : 'Mnemonica Graph 2D';
					}
					break;
				case 'viewState':
					// Response to a queryViewState roundtrip (B1.3 state
					// readback) — resolve the pending request by id
					if (message.data && typeof message.data === 'object' && 'requestId' in message.data) {
						const requestId = Number(message.data.requestId);
						const pending = GraphPanel.viewStateRequests.get(requestId);
						if (pending) {
							GraphPanel.viewStateRequests.delete(requestId);
							clearTimeout(pending.timer);
							pending.resolve(message.data);
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
	</div>
	<div id="gen-controls" style="display: block;">
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
