import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { GraphData, WebviewMessage } from '../types/index.js';
import type { traceEdge } from '../core/MainOrchestrator';
import { loadGraphDataFor } from '../core/graphDataLoader';
import { getLogger } from '../services/LoggerService';

// Get logger instance once at module level
const logger = getLogger();

export class GraphPanel {
	// Panels keyed by .tactica SOURCE ROOT (2026-09-12, owner item 8):
	// one tab per project, each bound for life to the graph it was
	// opened for — "when I switch to the other tactica it still holds
	// what it was rendered for". Re-invoking on an open source reveals
	// its tab instead of duplicating. A panel's data changes only via
	// its own Refresh button or its explicitly opted-in follow watcher;
	// the global refresh path never touches panels anymore.
	public static panels = new Map<string, GraphPanel>();
	// The workspace-primary source (the sidebar trees' Registry root).
	// Sidebar-driven focus belongs to THIS panel — the sidebar renders
	// the primary Registry, so its nodes live in that graph
	public static primarySource: string | null = null;
	// Trace/focus/view routing target for app-driven events: the panel
	// the user interacted with most recently. One connection serves one
	// app's analysis per window — flashes go where the user is looking
	private static lastActivePanel: GraphPanel | undefined;

	private readonly panel: vscode.WebviewPanel;
	private readonly sourceRoot: string;
	private readonly sourceName: string;
	// Connection-style opt-in (owner review 2026-09-12: "having so many
	// watchers on filesystem is discouraging"): exists only while the
	// panel's follow checkbox is checked, for THIS panel's source only
	private followWatcher: vscode.FileSystemWatcher | undefined;
	private readonly disposables: vscode.Disposable[] = [];
	// Mirrors the webview's render mode ('modeChanged' messages); the
	// webview starts in 3D
	private currentMode: '2D' | '3D' = '3D';

	public static createOrShow (extensionUri: vscode.Uri, sourceRoot: string) {
		const existing = GraphPanel.panels.get(sourceRoot);
		if (existing) {
			const column = vscode.window.activeTextEditor
				? vscode.window.activeTextEditor.viewColumn
				: undefined;
			existing.panel.reveal(column);
			return;
		}

		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;
		const panel = vscode.window.createWebviewPanel(
			'mnemonicaGraph',
			`Ψ ${path.basename(sourceRoot)}`,
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(extensionUri, 'media')
				]
			}
		);

		const graphPanel = new GraphPanel(panel, extensionUri, sourceRoot);
		GraphPanel.panels.set(sourceRoot, graphPanel);
		GraphPanel.lastActivePanel = graphPanel;
	}

	public static hasOpenPanel (): boolean {
		const open = GraphPanel.panels.size > 0;
		return open;
	}

	/**
	 * Focus the 3D camera on a graph node (sidebar click → rotate, not
	 * file jump). Returns true when a panel is open, visible, and in
	 * 3D mode — callers fall back to file navigation on false.
	 *
	 * The latest request is remembered in pendingFocus: on a freshly
	 * created panel the webview has not posted 'ready' yet and the
	 * message can be lost — the 'ready' handler flushes it. Arrivals
	 * after 'ready' but before the first render are stashed webview-side
	 * (pendingFocusNode in webview.js).
	 */
	private static pendingFocus: { panel: GraphPanel; id: string; name: string } | null = null;

	public static focusNode (data: { id: string; name: string }): boolean {
		const target = GraphPanel.focusTarget();
		if (!target || !target.panel.visible || target.currentMode !== '3D') {
			return false;
		}
		GraphPanel.pendingFocus = { panel: target, id: data.id, name: data.name };
		void target.panel.webview.postMessage({
			command : 'focusNode',
			data
		});
		return true;
	}

	// Sidebar-driven focus belongs to the primary source's panel (the
	// sidebar renders the primary Registry, so its nodes live in that
	// graph); fall back to the panel the user is looking at
	private static focusTarget (): GraphPanel | undefined {
		if (GraphPanel.primarySource) {
			const primary = GraphPanel.panels.get(GraphPanel.primarySource);
			if (primary) {
				return primary;
			}
		}
		return GraphPanel.lastActivePanel;
	}

	// App-driven events (trace isolate/replay/flash, view queries) go to
	// the panel the user is looking at; fall back to the primary one
	private static activeTarget (): GraphPanel | undefined {
		if (GraphPanel.lastActivePanel) {
			return GraphPanel.lastActivePanel;
		}
		if (GraphPanel.primarySource) {
			const primary = GraphPanel.panels.get(GraphPanel.primarySource);
			return primary;
		}
		return undefined;
	}

	// Trace mode state (names-first tracing, 2026-08-30): which dive
	// trace edge the open panel is isolating, plus the resolver hooks
	// into the orchestrator's ring (wired from extension.ts — the panel
	// has no orchestrator of its own)
	private static traceResolver: {
		resolve: (name: string) => { selectedId: number; edges: traceEdge[] } | null;
		resolveByRoot?: (rootId: number) => { selectedId: number; edges: traceEdge[] } | null;
		continue: (rootId: number, edges: traceEdge[]) => traceEdge[];
	} | null = null;
	private static traceMode: { edgeId: number; name: string } | null = null;

	public static setTraceResolver (resolver: {
		resolve: (name: string) => { selectedId: number; edges: traceEdge[] } | null;
		resolveByRoot?: (rootId: number) => { selectedId: number; edges: traceEdge[] } | null;
		continue: (rootId: number, edges: traceEdge[]) => traceEdge[];
	}): void {
		GraphPanel.traceResolver = resolver;
	}

	/**
	 * Open trace mode from OUTSIDE the webview (Live Trace sidebar,
	 * 2026-09-01): same resolution path as the webview's pickTrace, but
	 * invoked by command. When the caller carries the trace's rootId the
	 * by-root resolver wins — name resolution can bind to a DIFFERENT
	 * trace that happens to end on the same type name. Returns false
	 * when no panel is open or the trace is no longer in the ring — the
	 * caller decides whether to open the panel first.
	 */
	public static openTraceMode (name: string, rootId?: number): boolean {
		const current = GraphPanel.activeTarget();
		if (!current || !GraphPanel.traceResolver) {
			return false;
		}
		const resolved = (typeof rootId === 'number' && GraphPanel.traceResolver.resolveByRoot)
			? GraphPanel.traceResolver.resolveByRoot(rootId)
			: GraphPanel.traceResolver.resolve(name);
		if (!resolved) {
			return false;
		}
		GraphPanel.traceMode = { edgeId: resolved.selectedId, name };
		// The sidebar click is a request to SEE the trace — surface the
		// panel tab when it sits behind other editors (Wanted #3)
		current.panel.reveal();
		void current.panel.webview.postMessage({
			command : 'traceModeEnter',
			data    : { edges: resolved.edges, name }
		});
		return true;
	}

	/**
	 * Replay a stored trace at human speed (Wanted #5, 2026-09-01):
	 * isolate the lineage, then the webview re-walks its spheres one
	 * flash per edge (~650ms apart). Resolution matches openTraceMode —
	 * by rootId when the caller carries it.
	 */
	public static replayTrace (name: string, rootId?: number): boolean {
		const current = GraphPanel.activeTarget();
		if (!current || !GraphPanel.traceResolver) {
			return false;
		}
		const resolved = (typeof rootId === 'number' && GraphPanel.traceResolver.resolveByRoot)
			? GraphPanel.traceResolver.resolveByRoot(rootId)
			: GraphPanel.traceResolver.resolve(name);
		if (!resolved) {
			return false;
		}
		GraphPanel.traceMode = { edgeId: resolved.selectedId, name };
		current.panel.reveal();
		void current.panel.webview.postMessage({
			command : 'traceReplay',
			data    : { edges: resolved.edges, name }
		});
		return true;
	}

	/**
	 * Forward freshly-ingested trace edges into the open panel (B1.5
	 * live illumination). Posted in both modes — the webview flashes
	 * matching spheres in 3D and otherwise just advances its live
	 * counter. Returns false when no panel exists. While trace mode is
	 * open, batch members belonging to the isolated trace are also
	 * pushed as traceModeExtend (mid-flight continuation).
	 */
	public static pushTraceEdges (edges: traceEdge[]): boolean {
		const current = GraphPanel.activeTarget();
		if (!current || edges.length === 0) {
			return false;
		}
		void current.panel.webview.postMessage({
			command : 'traceEvent',
			data    : { edges }
		});
		if (GraphPanel.traceMode && GraphPanel.traceResolver) {
			const continuation = GraphPanel.traceResolver.continue(GraphPanel.traceMode.edgeId, edges);
			if (continuation.length > 0) {
				void current.panel.webview.postMessage({
					command : 'traceModeExtend',
					data    : { edges: continuation }
				});
			}
		}
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
	 * when no panel exists; on a webview timeout the panel facts still
	 * answer, with `view: null`.
	 */
	public static async queryViewState (): Promise<unknown> {
		const current = GraphPanel.activeTarget();
		if (!current) {
			const closed = { open: false };
			return closed;
		}
		const facts = {
			open    : true,
			visible : current.panel.visible,
			mode    : current.currentMode,
			// Which project's graph answered — with N panels the caller
			// cannot otherwise tell
			source  : current.sourceRoot
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
		sourceRoot: string
	) {
		this.panel = panel;
		this.sourceRoot = sourceRoot;
		this.sourceName = path.basename(sourceRoot);

		// Set initial content
		this.panel.title = `Ψ ${this.sourceName}`;
		this.panel.webview.html = this.getWebviewContent(extensionUri);

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
					// Webview is ready — load THIS panel's source and push.
					// The tab holds its render afterwards; data changes only
					// via the Refresh button or the follow opt-in
					await this.reloadGraph();
					// Flush a focus request that predated the webview load
					// (Show on Graph opened the panel just now)
					if (GraphPanel.pendingFocus && GraphPanel.pendingFocus.panel === this) {
						const pending = GraphPanel.pendingFocus;
						GraphPanel.pendingFocus = null;
						void this.panel.webview.postMessage({
							command : 'focusNode',
							data    : { id: pending.id, name: pending.name }
						});
					}
					break;
				case 'refreshGraph':
					// The Refresh button (2026-09-12, owner item 8:
					// auto-refresh died — "it would better be separate
					// button"): re-read THIS panel's .tactica and rebuild
					await this.reloadGraph();
					break;
				case 'followTactica':
					if (message.data && typeof message.data === 'object' && 'on' in message.data) {
						this.setFollowTactica(Boolean(message.data.on));
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
						this.panel.title = mode === '3D' ? `Ψ ${this.sourceName}` : `${this.sourceName} 2D`;
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
				case 'pickTrace': {
					// Trace mode (2026-08-30): user clicked a sphere with
					// live trace activity — resolve the lineage and open
					// the isolated path view in the webview
					if (message.data && typeof message.data === 'object' && 'name' in message.data) {
						const name = String(message.data.name);
						const resolved = GraphPanel.traceResolver ? GraphPanel.traceResolver.resolve(name) : null;
						if (resolved) {
							GraphPanel.traceMode = { edgeId: resolved.selectedId, name };
							void this.panel.webview.postMessage({
								command : 'traceModeEnter',
								data    : { edges: resolved.edges, name }
							});
						}
					}
					break;
				}
				case 'saveLayout':
					// The Save button (2026-09-06 owner request): the
					// webview cannot write files — it posts the collected
					// layout here and the host persists it
					await this.handleSaveLayout(message.data);
					break;
				case 'traceModeExit':
					GraphPanel.traceMode = null;
					break;
				}
			},
			null,
			this.disposables
		);

		this.panel.onDidChangeViewState(
			(event) => {
				if (event.webviewPanel.active) {
					GraphPanel.lastActivePanel = this;
				}
			},
			null,
			this.disposables
		);

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
	}

	// (Re)read THIS panel's .tactica and push the fresh graph. A missing
	// source keeps the tab's last render — an accidental regen wipe must
	// never blank the user's arranged view
	private async reloadGraph () {
		const graphData = await loadGraphDataFor(this.sourceRoot);
		if (!graphData) {
			void vscode.window.showWarningMessage(`No .tactica found at ${this.sourceRoot} — the tab keeps its last render`);
			return;
		}
		this.updateGraph(graphData);
	}

	private setFollowTactica (on: boolean) {
		if (this.followWatcher) {
			this.followWatcher.dispose();
			this.followWatcher = undefined;
		}
		if (!on) {
			return;
		}
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(this.sourceRoot, '.tactica/types.ts')
		);
		watcher.onDidChange(() => {
			void this.reloadGraph();
		});
		watcher.onDidCreate(() => {
			void this.reloadGraph();
		});
		this.followWatcher = watcher;
	}

	private updateGraph (graphData: GraphData) {
		void this.panel.webview.postMessage({
			command : 'updateGraph',
			data    : graphData,
			// The saved layout rides along so render3DGraph can apply it
			// around renderGraph; null when no save exists yet
			layout  : this.readSavedLayout()
		});
	}

	// The Save button's backing file (2026-09-06 owner request; per-source
	// since the 2026-09-12 multi-panel refactor): the arrangement belongs
	// to the PROJECT — <sourceRoot>/.mnemographica/layout.json, next to
	// the .tactica it arranges
	private getLayoutFilePath (): string {
		const filePath = path.join(this.sourceRoot, '.mnemographica', 'layout.json');
		return filePath;
	}

	private readSavedLayout (): unknown {
		const filePath = this.getLayoutFilePath();
		if (!fs.existsSync(filePath)) {
			return null;
		}
		try {
			const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
			return parsed;
		} catch (error) {
			logger.warn('[GraphPanel] Failed to read saved layout:', String(error));
			return null;
		}
	}

	private async handleSaveLayout (data: unknown) {
		const filePath = this.getLayoutFilePath();
		try {
			fs.mkdirSync(path.dirname(filePath), { recursive: true });
			fs.writeFileSync(filePath, JSON.stringify(data, null, '\t'));
			void this.panel.webview.postMessage({
				command : 'layoutSaved',
				data    : { path: filePath }
			});
		} catch (error) {
			void vscode.window.showErrorMessage(`Failed to save layout: ${String(error)}`);
		}
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

	private getWebviewContent (extensionUri: vscode.Uri): string {
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
		<button id="save-layout" title="Save layout to .mnemographica/layout.json">Save</button>
		<button id="refresh-graph" title="Re-read this project's .tactica and rebuild the graph">⟳ Refresh</button>
	</div>
	<div id="gen-controls" style="display: block;">
		<div class="gen-controls-header">Layers &amp; Distances</div>
		<div id="layer-controls-list"></div>
	</div>
	<div id="dive-legend">
		<div class="gen-controls-header" id="dive-legend-header"><span>Legend</span><span id="dive-legend-toggle">▾</span></div>
		<div class="legend-row"><span class="legend-swatch" style="color:#ef9a9a">●</span> type sphere (color = generation)</div>
		<div class="legend-row"><span class="legend-swatch legend-dim" style="color:#ef9a9a">●</span> type never created (usages.json)</div>
		<div class="legend-row"><span class="legend-swatch" style="color:#ce93d8">◆</span> creation scope (instrumentation)</div>
		<div class="legend-row"><span class="legend-swatch" style="color:#ffb300">◯</span> wrap site (dive) — encircles what it wraps</div>
		<div class="legend-row"><span class="legend-swatch" style="color:#aaaaaa">→</span> inheritance / invocation</div>
		<div class="legend-row"><span class="legend-swatch" style="color:#66ccff">─</span> path-hit: AoT-guaranteed construction</div>
		<div class="legend-row"><span class="legend-swatch legend-dim" style="color:#66ccff">─</span> path-hit never taken at runtime</div>
		<div class="legend-row"><span class="legend-swatch" style="color:#ffb300">→</span> fiber: wrap → wrap (via)</div>
		<div class="legend-row"><span class="legend-swatch" style="color:#ffd54f">⇢</span> fiber via construction (T → W2)</div>
		<div class="legend-row"><span class="legend-swatch" style="color:#f9a825">→</span> wrap produced by type's handler</div>
		<div class="legend-row"><span class="legend-swatch" style="color:#da70d6">⇢</span> holder diamond creates this type (dashed)</div>
		<div class="legend-row"><span class="legend-swatch" style="color:#7aa2f7">◎</span> EDS ring (dive storage)</div>
		<div class="legend-row"><span class="legend-swatch" style="color:#7aa2f7">⬡</span> attachHooks — grafts fire per construction</div>
		<div class="legend-row"><span class="legend-swatch" style="color:#b48ead">■</span> adapter sink (fiber data leaves)</div>
		<div class="legend-row"><span class="legend-swatch" style="color:#f0c674">▲</span> Jaeger — outside the system</div>
		<div class="legend-row"><span class="legend-swatch" style="color:#9aa0a6">╱</span> label leader · drag pins · click info · dblclick jumps to code</div>
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
		GraphPanel.panels.delete(this.sourceRoot);
		if (GraphPanel.lastActivePanel === this) {
			GraphPanel.lastActivePanel = undefined;
		}
		if (this.followWatcher) {
			this.followWatcher.dispose();
			this.followWatcher = undefined;
		}
		GraphPanel.traceMode = null;

		this.panel.dispose();

		while (this.disposables.length) {
			const x = this.disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}
}
