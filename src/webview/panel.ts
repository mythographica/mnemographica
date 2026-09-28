import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { GraphData, WebviewMessage } from '../types/index.js';
import type { traceEdge } from '../core/MainOrchestrator';
import { loadGraphDataFor } from '../core/graphDataLoader';
import { buildSceneFor } from '../core/SceneBuilder';
import type { FrontendRegistry_Scene3D as Scene3D, FrontendRegistry_Scene3D_GraphNode3D as Scene3D_GraphNode3D } from '../../.tactica/types';
import { getLogger } from '../services/LoggerService';

// Get logger instance once at module level
const logger = getLogger();

// layout.json's camera shape (the renderer's initialCameraState):
// { orbitQuat: {x,y,z,w}, cameraRotation: {x,y} (derived from the
// quaternion for census/legacy readers), zoom, panOffset: {x,y,z} }.
// The Camera3D model carries the same state as x/y/z pan +
// rotationX/rotationY + zoom
const cameraDataFromLayout = function (layout: unknown): {
	x: number; y: number; z: number; zoom: number; rotationX: number; rotationY: number;
} | null {
	if (!layout || typeof layout !== 'object') {
		const missing = null;
		return missing;
	}
	const camera = (layout as { camera?: unknown }).camera;
	if (!camera || typeof camera !== 'object') {
		const missing = null;
		return missing;
	}
	const cam = camera as {
		cameraRotation?: { x?: unknown; y?: unknown };
		zoom?: unknown;
		panOffset?: { x?: unknown; y?: unknown; z?: unknown };
	};
	const num = (value: unknown): number => {
		const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
		return n;
	};
	const data = {
		x         : num(cam.panOffset?.x),
		y         : num(cam.panOffset?.y),
		z         : num(cam.panOffset?.z),
		zoom      : num(cam.zoom),
		rotationX : num(cam.cameraRotation?.x),
		rotationY : num(cam.cameraRotation?.y)
	};
	return data;
};

export class GraphPanel {
	// Panels keyed by .tactica SOURCE ROOT: one tab per project, each
	// bound for life to the graph it was opened for. Re-invoking on an
	// open source reveals its tab instead of duplicating. A panel's data
	// changes only via its own Refresh button or the follow watcher (the
	// global `mnemographica.followTacticaChanges` setting); the global
	// refresh path never touches panels.
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
	// Global persisted opt-in (`mnemographica.followTacticaChanges`):
	// exists only while the setting is on, for THIS panel's source only
	private followWatcher: vscode.FileSystemWatcher | undefined;
	private readonly disposables: vscode.Disposable[] = [];
	// Mirrors the webview's render mode ('modeChanged' messages); the
	// webview starts in 3D
	private currentMode: '2D' | '3D' = '3D';
	// The collection this panel renders ('defaultTypes' or a tactica
	// `collectionId::` id). undefined until the first payload answers —
	// the builder picks default-if-present, and every reload re-sends it
	// so the webview's selector pick survives Refresh and follow-watches
	private currentCollection: string | undefined;
	// The panel's logical scene: the Scene3D model tree SceneBuilder
	// derives from every pushed GraphData; camera/tooltip/tube update as
	// view events arrive. queryViewState reports its census.
	private scene: Scene3D | undefined;

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
		target.noteFocus(data.id, data.name);
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

	// Trace mode state (names-first tracing): which dive trace edge the
	// open panel is isolating, plus the resolver hooks into the
	// orchestrator's ring (wired from extension.ts — the panel has no
	// orchestrator of its own)
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
	 * Open trace mode from OUTSIDE the webview (Live Trace sidebar):
	 * same resolution path as the webview's pickTrace, but
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
	 * Replay a stored trace at human speed (Wanted #5):
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
			source  : current.sourceRoot,
			// The panel's logical scene as a census — sizes only, the
			// instances themselves never cross the wire
			scene   : current.scene ? {
				nodes    : current.scene.nodeCount,
				links    : current.scene.linkCount,
				diamonds : current.scene.diamondCount,
				bagels   : current.scene.bagelCount,
				sinks    : current.scene.sinkCount,
				captions : current.scene.captionCount,
				ring     : current.scene.ring !== null,
				hub      : current.scene.hub !== null,
				cone     : current.scene.cone !== null,
				camera   : current.scene.camera !== null
			} : null
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

	// The UI settings the webview mirrors from `mnemographica.*` config:
	// read fresh on every push, so a settings edit reaches open panels
	private static readUiSettings () {
		const config = vscode.workspace.getConfiguration('mnemographica');
		const settings = {
			invocationPathFilter         : config.get<string>('invocationPathFilter', ''),
			alwaysShowCollectionSelector : config.get<boolean>('alwaysShowCollectionSelector', true)
		};
		return settings;
	}

	public static pushUiSettings () {
		const settings = GraphPanel.readUiSettings();
		for (const panel of GraphPanel.panels.values()) {
			void panel.panel.webview.postMessage({
				command : 'settings',
				data    : settings
			});
		}
	}

	public static applyFollowSetting (on: boolean) {
		for (const panel of GraphPanel.panels.values()) {
			panel.setFollowTactica(on);
		}
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
					// The Refresh button: re-read THIS panel's .tactica
					// and rebuild
					await this.reloadGraph();
					break;
				case 'selectCollection':
					// The collection selector: one universe per render —
					// record the pick and re-read THIS panel's .tactica,
					// the same path the Refresh button takes
					if (message.data && typeof message.data === 'object' && 'id' in message.data) {
						this.currentCollection = String(message.data.id);
						await this.reloadGraph();
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
						this.noteViewState(message.data);
					}
					break;
				case 'pickTrace': {
					// Trace mode: user clicked a sphere with live trace
					// activity — resolve the lineage and open the isolated
					// path view in the webview
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
					// The Save button: the webview cannot write files —
					// it posts the collected layout here and the host
					// persists it
					await this.handleSaveLayout(message.data);
					break;
				case 'exportHtml':
					// The Export button: the webview assembled a
					// self-contained page (its own script + stylesheet +
					// three/d3 + the current graph and arrangement
					// inlined) — the host only writes the file
					if (typeof message.data === 'string' && message.data.length > 0) {
						await this.handleExportHtml(message.data);
					}
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

		// The follow watcher is a global persisted setting — apply it at
		// birth so a panel opened mid-session matches the others
		this.setFollowTactica(vscode.workspace.getConfiguration('mnemographica').get<boolean>('followTacticaChanges', false));
	}

	// (Re)read THIS panel's .tactica and push the fresh graph. A missing
	// source keeps the tab's last render — an accidental regen wipe must
	// never blank the user's arranged view
	private async reloadGraph () {
		const graphData = await loadGraphDataFor(this.sourceRoot, this.currentCollection);
		if (!graphData) {
			void vscode.window.showWarningMessage(`No .tactica found at ${this.sourceRoot} — the tab keeps its last render`);
			return;
		}
		// The builder's actual pick (default-if-present fallback) becomes
		// this panel's collection from now on
		this.currentCollection = graphData.collection;
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
		// The saved layout rides along so render3DGraph can apply it
		// around renderGraph; null when no save exists yet
		const layout = this.readSavedLayout();
		// The host-side logical scene mirrors what the webview is about
		// to draw; a saved camera becomes the scene's Camera3D
		this.scene = buildSceneFor(this.sourceRoot, graphData);
		const cameraData = cameraDataFromLayout(layout);
		if (cameraData) {
			this.scene.camera = new this.scene.Camera3D(cameraData);
		}
		void this.panel.webview.postMessage({
			command  : 'updateGraph',
			data     : graphData,
			layout   : layout,
			settings : GraphPanel.readUiSettings()
		});
	}

	// The Save button's backing file (per-source): the arrangement
	// belongs to the PROJECT — <sourceRoot>/.mnemographica/layout.json,
	// next to the .tactica it arranges
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
			// Stale guard (the instrumentation.json idiom): a layout
			// predating the last .tactica regeneration arranges a graph
			// that no longer exists — skip it entirely
			const hierarchyPath = path.join(this.sourceRoot, '.tactica', 'hierarchy.json');
			if (fs.existsSync(hierarchyPath)) {
				const savedAtMs = Date.parse(parsed?.savedAt as string) || fs.statSync(filePath).mtimeMs;
				if (fs.statSync(hierarchyPath).mtimeMs > savedAtMs) {
					logger.info('[GraphPanel] Saved layout predates the last .tactica regeneration — ignoring it');
					return null;
				}
			}
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
			// The saved camera is the scene's camera from now on
			const cameraData = cameraDataFromLayout(data);
			if (this.scene && cameraData) {
				this.scene.camera = new this.scene.Camera3D(cameraData);
			}
			void this.panel.webview.postMessage({
				command : 'layoutSaved',
				data    : { path: filePath }
			});
		} catch (error) {
			void vscode.window.showErrorMessage(`Failed to save layout: ${String(error)}`);
		}
	}

	// The Export button's backing: the webview posts the assembled
	// self-contained page; the host asks where to put it and writes it
	private async handleExportHtml (html: string) {
		const target = await vscode.window.showSaveDialog({
			defaultUri : vscode.Uri.file(path.join(this.sourceRoot, `${this.sourceName}-graph.html`)),
			filters    : { HTML: ['html'] }
		});
		if (!target) {
			return;
		}
		try {
			fs.writeFileSync(target.fsPath, html, 'utf-8');
			void this.panel.webview.postMessage({
				command : 'exportSaved',
				data    : { path: target.fsPath }
			});
		} catch (error) {
			void vscode.window.showErrorMessage(`Failed to export graph: ${String(error)}`);
		}
	}

	/**
	 * Record a focus event on the scene model: the selection glow tube
	 * (the dot-joined id's prefixes ARE the ancestor chain it threads)
	 * and the tooltip bound to the focused sphere — the Tooltip3D is
	 * constructed FROM the sphere instance, so the prototype chain ties
	 * tooltip → node → scene.
	 */
	private noteFocus (id: string, name: string) {
		const scene = this.scene;
		if (!scene) { return; }
		const chain = id.split('.').map((segment, index, parts) => {
			void segment;
			return parts.slice(0, index + 1).join('.');
		});
		scene.tube = new scene.Tube3D({ id, chain });
		const sphere = scene.getNode(id) as Scene3D_GraphNode3D | undefined;
		if (sphere) {
			scene.tooltip = new sphere.Tooltip3D({ targetNode: id, content: name, visible: true });
		}
	}

	/**
	 * Fold a viewState answer into the scene model: the live camera and,
	 * when the webview has a focused node, the tooltip for it.
	 */
	private noteViewState (data: unknown) {
		const scene = this.scene;
		if (!scene || !data || typeof data !== 'object') { return; }
		const state = data as {
			camera?: { rotX?: unknown; rotY?: unknown; zoom?: unknown; pan?: { x?: unknown; y?: unknown; z?: unknown } };
			focusedNode?: { id?: unknown; name?: unknown } | null;
		};
		const num = (value: unknown): number => {
			const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
			return n;
		};
		if (state.camera && typeof state.camera === 'object') {
			const cam = state.camera;
			scene.camera = new scene.Camera3D({
				x         : num(cam.pan?.x),
				y         : num(cam.pan?.y),
				z         : num(cam.pan?.z),
				zoom      : num(cam.zoom),
				rotationX : num(cam.rotX),
				rotationY : num(cam.rotY)
			});
		}
		const focused = state.focusedNode;
		if (focused && typeof focused.id === 'string' && typeof focused.name === 'string') {
			this.noteFocus(focused.id, focused.name);
		}
	}

	/**
	 * The panel's logical scene (automation/tests read its census through
	 * queryViewState; direct access is for the debug handle)
	 */
	public getScene (): Scene3D | undefined {
		const scene = this.scene;
		return scene;
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

	/**
	 * The export page is the panel's own HTML with every external resource
	 * swapped for an inline placeholder the webview fills at export time:
	 * the stylesheet, three.js, d3, the app script itself, and the config
	 * script (which becomes the boot stub + the recorded graph stream).
	 * Keeping the skeleton derived from the live template means the export
	 * can never drift from the page it packs.
	 */
	private buildExportSkeleton (
		html: string,
		styleUri: string,
		d3Uri: string,
		threeUri: string,
		scriptUri: string,
		configScript: string
	): string {
		return html
			.replace(`<link rel="stylesheet" href="${styleUri}">`, '<style>\n/*__MNEMO_CSS__*/\n</style>')
			.replace(`<script src="${d3Uri}"></script>`, '<script>\n/*__MNEMO_D3__*/\n</script>')
			.replace(`<script src="${threeUri}"></script>`, '<script>\n/*__MNEMO_THREE__*/\n</script>')
			.replace(`<script src="${scriptUri}"></script>`, '<script>\n/*__MNEMO_APP__*/\n</script>')
			.replace(configScript, '<script>\n/*__MNEMO_BOOT__*/\n</script>');
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

		// The config script the app reads (SHOW_PROPERTIES). Served as a
		// constant so the export skeleton can swap it for the boot stub by
		// exact match — one template, no duplicated markup
		const configScript = `<script>
		// Pass configuration to the webview script
		const SHOW_PROPERTIES_PLACEHOLDER = ${showProperties};
	</script>`;

		// The export page is THIS page with every external resource swapped
		// for an inline placeholder the webview fills at export time. The
		// webview (which holds the current graph + arrangement) assembles
		// the file; the host only writes it. The skeleton derives from the
		// composed HTML below (same body markup, placeholders for resources)
		// — build the html in two passes so both share one template
		// The export page is THIS page with every external resource swapped
		// for an inline placeholder the webview fills at export time (see
		// buildExportSkeleton). The webview — which holds the current graph
		// and arrangement — assembles the file; the host only writes it.
		// The skeleton derives from the very HTML served here, so the
		// export can never drift from the page it packs
		const withSkeletonSlot = `<!DOCTYPE html>
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
	<!-- the collection selector pins to the top-LEFT corner, away from
	     the top-right button bar -->
	<select id="collection-select" title="Type collection (or all collections combined)" style="display:none"></select>
	<div id="controls">
		<!-- the wheel is the zoom; the invocation path filter lives in
		     the native Settings UI (the gear button on the Usages view) -->
		<button id="reset" title="Reset View">⟲ Reset</button>
		<button id="refresh-graph" title="Re-read this project's .tactica and rebuild the graph">⟳ Refresh</button>
		<button id="save-layout" title="Save layout to .mnemographica/layout.json">💾 Save</button>
		<button id="export-html" title="Export the current graph as a single self-contained HTML page (embeddable in slides, works offline)">⤓ Export</button>
	</div>
	<div id="gen-controls" style="display: block;">
		<div class="gen-controls-header" id="gen-controls-header"><span>Layers &amp; Distances</span><span id="gen-controls-toggle">▾</span></div>
		<div id="layer-controls-list"></div>
	</div>
	<!-- folded by default — the legend is a reference, not a dashboard -->
	<div id="dive-legend" class="collapsed">
		<div class="gen-controls-header" id="dive-legend-header"><span>Legend</span><span id="dive-legend-toggle">▸</span></div>
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
		<div class="legend-row"><span class="legend-swatch" style="color:#7aa2f7">◎</span> EDS (dive storage)</div>
		<div class="legend-row"><span class="legend-swatch" style="color:#7aa2f7">⬡</span> attachHooks — grafts fire per construction</div>
		<div class="legend-row"><span class="legend-swatch" style="color:#b48ead">■</span> adapter sink (fiber data leaves)</div>
		<div class="legend-row"><span class="legend-swatch" style="color:#f0c674">▲</span> Jaeger — outside the system</div>
		<div class="legend-row"><span class="legend-swatch" style="color:#9aa0a6">╱</span> label leader · drag pins · click info · dblclick jumps to code</div>
	</div>
	<div id="graph"></div>
	<div id="tooltip"></div>
	<div id="status"></div>

	<!--__MNEMO_SKELETON_SCRIPT__-->
	${configScript}
	<script src="${String(scriptUri)}"></script>
</body>
</html>`;

		const skeleton = this.buildExportSkeleton(
			withSkeletonSlot, String(styleUri), d3Uri, threeUri, String(scriptUri), configScript
		);
		const skeletonScript = `\t<script>\n\t\twindow.__MNEMO_EXPORT_SKELETON__ = ${JSON.stringify(skeleton).replace(/</g, '\\u003c')};\n\t</script>`;
		const result = withSkeletonSlot.replace('<!--__MNEMO_SKELETON_SCRIPT__-->', () => skeletonScript);
		return result;
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
		this.scene = undefined;

		this.panel.dispose();

		while (this.disposables.length) {
			const x = this.disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}
}
