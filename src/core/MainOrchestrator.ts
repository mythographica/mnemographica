'use strict';

import { lookup } from 'mnemonica';
import type { Main as MainType, Registry } from '../../.tactica/types';
import { StateManager } from './StateManager';
import { GraphBuilder } from './GraphBuilder';
import { GraphData } from '../types';

// One edge of a dive execution-flow trace, as mapped by strategy's
// cdp-scripts/dive-trace.js for the JSON crossing (live instance
// references cannot cross returnByValue, hence the flat shape) and
// pushed to us over the strategy WS channel (trace/ingest). Main's
// traceBuffer holds exactly these — typed loosely as Array<unknown>
// in the generated .tactica types, so the casts below re-ground them.
export type traceEdge = {
	id: number;
	parentId: number | null;
	name: string;
	kind: string;
	status: string;
	duration: number | null;
	ts: number;
	instanceType: string | null;
	// OTEL trace id of the span this edge became in the target (adapter
	// records edgeId→traceId in-target, strategy forwards it). Null when
	// the target exports no OTEL spans — the Jaeger jump hides then.
	traceId?: string | null;
	// dive >= 0.8.3 provenance: 'explicit' attribution is trusted;
	// 'ambient' means dive's newest-wins lastContext fallback guessed the
	// instance — possibly a FOREIGN flow's. Never light a bulb on ambient
	// alone. Absent on older dive/strategy — treat as explicit (the
	// pre-flag world trusted everything).
	instanceSource?: 'explicit' | 'ambient' | null;
};

export class MainOrchestrator {
	private main: MainType;
	private stateManager: StateManager;
	private registry: Registry;
	private currentGraphData: GraphData | undefined;

	constructor(version: string) {
		const Main = lookup('Main');
		this.main = new Main(version);
		this.stateManager = new StateManager();
		const Registry = lookup('Registry');
		this.registry = new Registry();
	}

	getStateManager(): StateManager {
		return this.stateManager;
	}

	getRegistry() {
		return this.registry;
	}

	async loadWorkspace(workspacePath: string): Promise<void> {
		this.stateManager.setLoading(true);
		this.stateManager.clearError();

		try {
			this.stateManager.setWorkspacePath(workspacePath);
			await this.registry.loadFromWorkspace(workspacePath);

			this.currentGraphData = GraphBuilder.buildFromRegistry(this.registry);

			this.stateManager.setLoading(false);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.stateManager.setError(message);
			this.stateManager.setLoading(false);
			throw error;
		}
	}

	async refresh(): Promise<void> {
		const workspacePath = this.stateManager.getState().workspacePath;
		if (!workspacePath) { return; }
		this.registry.clear();
		await this.loadWorkspace(workspacePath);
	}

	getGraphData(): GraphData | undefined {
		return this.currentGraphData;
	}

	getGraphStats(): { nodeCount: number; linkCount: number; maxDepth: number } | undefined {
		if (!this.currentGraphData) { return undefined; }
		return GraphBuilder.getStats(this.currentGraphData);
	}

	getMain(): MainType {
		return this.main;
	}

	// Bounded ring for the live dive-trace stream (B1.3). 1000rps
	// ambient volume is fine in memory (owner: JS holds millions of
	// records); the bound exists so a runaway source cannot grow it
	// without limit.
	private static readonly TRACE_BUFFER_LIMIT = 5000;

	// Id → buffered edge index for the upsert path: 'leave'/'settle'
	// re-publish an edge id already ingested via 'enter', carrying its
	// completion (status + duration). Without this index the monotonic
	// dedupe below would drop every completion as a replay and call
	// edges would stay 'running' forever (2026-09-01).
	private traceById = new Map<number, traceEdge>();

	/**
	 * Land a batch of trace edges pushed by strategy (trace/ingest).
	 * Dedupe rule: the delta channel is monotonic per source process
	 * (ids only grow), so ids at or below the last seen are replays
	 * — EXCEPT lifecycle completions: a re-published id already in the
	 * ring is upserted in place (status/duration/ts merge) and counted
	 * as `updated`, not dropped. A source RESTART resets its ids — tag
	 * the batch with `session` (the pusher's target pid) and a changed
	 * marker auto-wipes before ingest (VACUUM rule, 2026-08-30);
	 * untagged batches keep the old explicit-reset behavior.
	 */
	ingestTrace(edges: unknown, session?: unknown): {
		accepted: number;
		updated: number;
		lastId: number;
		buffered: number;
		edges: traceEdge[];
		sessionReset: boolean;
		dropped: number;
	} {
		const main = this.main;
		let sessionReset = false;
		let dropped = 0;
		if (typeof session === 'string' && session.length > 0) {
			if (main.traceSession !== undefined && main.traceSession !== session) {
				// New source process: its ids restart from 1 and the
				// watermark would silently drop every one of them.
				const wiped = this.resetTrace();
				sessionReset = true;
				dropped = wiped.dropped;
			}
			main.traceSession = session;
		}
		const buffer = main.traceBuffer as unknown as traceEdge[];
		const acceptedEdges: traceEdge[] = [];
		let updated = 0;
		if (Array.isArray(edges)) {
			for (const edge of edges) {
				if (!edge || typeof edge !== 'object') { continue; }
				const candidate = edge as { id?: unknown };
				if (typeof candidate.id !== 'number') { continue; }
				if (candidate.id <= main.traceLastId) {
					// Lifecycle completion (leave/settle) or a replay: merge
					// the terminal fields into the buffered copy when the id
					// is still in the ring; true replays merge identically.
					const existing = this.traceById.get(candidate.id);
					if (existing) {
						const incoming = edge as Partial<traceEdge>;
						if (typeof incoming.status === 'string') { existing.status = incoming.status; }
						if (typeof incoming.duration === 'number') { existing.duration = incoming.duration; }
						if (typeof incoming.ts === 'number') { existing.ts = incoming.ts; }
						if (typeof incoming.traceId === 'string') { existing.traceId = incoming.traceId; }
						updated++;
						// Forward the merged edge too — the open panel and
						// the Live Trace tree must see completions, not
						// just arrivals.
						acceptedEdges.push(existing);
					}
					continue;
				}
				const landed = edge as traceEdge;
				buffer.push(landed);
				this.traceById.set(landed.id, landed);
				acceptedEdges.push(landed);
				main.traceLastId = candidate.id;
			}
		}
		const accepted = acceptedEdges.length - updated;
		main.traceReceivedTotal += accepted;
		if (buffer.length > MainOrchestrator.TRACE_BUFFER_LIMIT) {
			const evicted = buffer.splice(0, buffer.length - MainOrchestrator.TRACE_BUFFER_LIMIT);
			for (const old of evicted) {
				this.traceById.delete(old.id);
			}
		}
		const result = {
			accepted,
			updated,
			lastId   : main.traceLastId,
			buffered : buffer.length,
			// The freshly-landed (and freshly-completed) edges, so the WS
			// layer can forward exactly these to an open panel (B1.5 live
			// illumination)
			edges    : acceptedEdges,
			sessionReset,
			dropped
		};
		return result;
	}

	/**
	 * Trace readback for state/query — counters plus the newest
	 * `sample` edges (default 5) so a caller can eyeball the stream
	 * without draining the whole buffer.
	 */
	getTraceState(sample = 5): {
		buffered: number;
		receivedTotal: number;
		lastId: number;
		latest: traceEdge[];
	} {
		const main = this.main;
		const buffer = main.traceBuffer as unknown as traceEdge[];
		const latest = buffer.slice(-sample);
		const result = {
			buffered      : buffer.length,
			receivedTotal : main.traceReceivedTotal,
			lastId        : main.traceLastId,
			latest
		};
		return result;
	}

	/**
	 * trace/reset (2026-08-30): wipe the trace buffer and the id
	 * watermark. The ingest dedup is monotonic per source process (ids at
	 * or below traceLastId are dropped as replays), so a RESTARTED source
	 * — ids from 1 again — is silently dropped without this. Resetting is
	 * the supported way to begin a fresh trace session against a new
	 * target process.
	 */
	resetTrace(): { reset: true; dropped: number } {
		const main = this.main;
		const buffer = main.traceBuffer as unknown as traceEdge[];
		const dropped = buffer.length;
		buffer.length = 0;
		this.traceById.clear();
		main.traceLastId = 0;
		main.traceReceivedTotal = 0;
		const result = { reset: true as const, dropped };
		return result;
	}

	/**
	 * Names-first trace resolution (trace mode, 2026-08-30): the latest
	 * edge carrying this type name, its ancestor chain (root →
	 * selected), and any descendants already in the ring. Returns null
	 * when the name never traced. Parentage is dive's data-flow
	 * lineage; ids evicted from the ring simply truncate the walk.
	 */
	getTraceLineage(name: string): { selectedId: number; edges: traceEdge[] } | null {
		const main = this.main;
		const buffer = main.traceBuffer as unknown as traceEdge[];
		let selected: traceEdge | undefined;
		for (let i = buffer.length - 1; i >= 0; i--) {
			const edge = buffer[i];
			if (edge.instanceType === name || edge.name === name) {
				selected = edge;
				break;
			}
		}
		if (!selected) { return null; }
		const byId = new Map<number, traceEdge>();
		for (const edge of buffer) { byId.set(edge.id, edge); }
		const ancestors: traceEdge[] = [];
		let cursor: traceEdge | undefined = selected;
		while (cursor) {
			ancestors.unshift(cursor);
			cursor = cursor.parentId !== null ? byId.get(cursor.parentId) : undefined;
		}
		const selectedId = selected.id;
		const descendants = buffer.filter(edge => {
			const isDescendant = edge.id > selectedId && this.hasAncestor(edge, selectedId, byId);
			return isDescendant;
		});
		const result = { selectedId, edges: ancestors.concat(descendants) };
		return result;
	}

	/**
	 * Root-first trace resolution (Live Trace sidebar, 2026-09-01):
	 * every edge in the ring whose ancestor walk reaches rootId, root
	 * included, in ring order. The tree row carries the exact rootId of
	 * the trace it renders — resolving by NAME would pick the latest
	 * edge with that name, possibly from a different trace, and the 3D
	 * isolation would light the wrong branch.
	 */
	getTraceLineageByRoot(rootId: number): { selectedId: number; edges: traceEdge[] } | null {
		const main = this.main;
		const buffer = main.traceBuffer as unknown as traceEdge[];
		if (!this.traceById.has(rootId)) { return null; }
		const byId = new Map<number, traceEdge>();
		for (const edge of buffer) { byId.set(edge.id, edge); }
		const members = buffer.filter(edge => {
			const belongs = this.hasAncestor(edge, rootId, byId);
			return belongs;
		});
		if (members.length === 0) { return null; }
		const result = { selectedId: rootId, edges: members };
		return result;
	}

	/**
	 * Mid-flight continuation: from a freshly-accepted batch, the edges
	 * whose lineage passes through rootId — those extend the open trace.
	 * Call AFTER the batch landed in the ring (the walk resolves
	 * parents against the buffer).
	 */
	getTraceContinuation(rootId: number, newEdges: traceEdge[]): traceEdge[] {
		const main = this.main;
		const buffer = main.traceBuffer as unknown as traceEdge[];
		const byId = new Map<number, traceEdge>();
		for (const edge of buffer) { byId.set(edge.id, edge); }
		const result = newEdges.filter(edge => {
			const belongs = this.hasAncestor(edge, rootId, byId);
			return belongs;
		});
		return result;
	}

	private hasAncestor(edge: traceEdge, rootId: number, byId: Map<number, traceEdge>): boolean {
		let cursor: traceEdge | undefined = edge;
		while (cursor) {
			if (cursor.id === rootId) { return true; }
			cursor = cursor.parentId !== null ? byId.get(cursor.parentId) : undefined;
		}
		return false;
	}

	/**
	 * Live Trace view (2026-09-01): the newest `windowSize` edges grouped
	 * into traces by root ancestor, newest activity first. Humans can't
	 * track a millisecond event stream, so the sidebar collects it: one
	 * row per trace with its edge count, expandable to the edges.
	 * Parentage walks the FULL ring (ancestors may predate the window);
	 * membership is window-only. count includes the root itself.
	 */
	getTraceGroups(maxTraces = 50, windowSize = 1000): Array<{
		rootId: number;
		name: string;
		count: number;
		latest: number;
		edges: traceEdge[];
		hasError: boolean;
		unknownError: boolean;
	}> {
		const main = this.main;
		const buffer = main.traceBuffer as unknown as traceEdge[];
		const byId = new Map<number, traceEdge>();
		for (const edge of buffer) { byId.set(edge.id, edge); }
		const windowed = buffer.slice(-windowSize);
		const groups = new Map<number, { rootId: number; name: string; count: number; latest: number; edges: traceEdge[]; hasError: boolean; unknownError: boolean }>();
		for (const edge of windowed) {
			let root = edge;
			let cursor = edge;
			while (cursor.parentId !== null) {
				const parent = byId.get(cursor.parentId);
				if (!parent) { break; }
				cursor = parent;
				root = parent;
			}
			let group = groups.get(root.id);
			if (!group) {
				const name = root.instanceType || root.name;
				group = { rootId: root.id, name, count: 0, latest: 0, edges: [], hasError: false, unknownError: false };
				groups.set(root.id, group);
			}
			group.edges.push(edge);
			group.count++;
			if (edge.status === 'error') { group.hasError = true; }
			if (edge.ts > group.latest) { group.latest = edge.ts; }
		}
		// Error tiers (2026-09-02, Viktor's choice): errored traces pin above
		// healthy ones, and UNKNOWN errors — no create edge in the trace, so
		// no mnemonica instance to pin the failure to — rank above known ones.
		// Newest-first inside each tier.
		for (const group of groups.values()) {
			group.unknownError = group.hasError && !group.edges.some(edge => edge.kind === 'create');
		}
		const tierOf = (group: { hasError: boolean; unknownError: boolean }): number => {
			const tier = group.unknownError ? 0 : group.hasError ? 1 : 2;
			return tier;
		};
		const ordered = Array.from(groups.values())
			.sort((a, b) => {
				const tier = tierOf(a) - tierOf(b);
				const result = tier !== 0 ? tier : b.latest - a.latest;
				return result;
			})
			.slice(0, maxTraces);
		return ordered;
	}

	/**
	 * Graph readback for state/query — stats plus a flat node list so
	 * view control can address nodes without opening the panel.
	 */
	getGraphSummary(): {
		workspacePath: string | undefined;
		stats: { nodeCount: number; linkCount: number; maxDepth: number } | undefined;
		nodes: Array<{ id: string; name: string; isRoot: boolean }>;
	} {
		const nodes = (this.currentGraphData ? this.currentGraphData.nodes : []).map(node => {
			const summary = { id: node.id, name: node.name, isRoot: node.isRoot };
			return summary;
		});
		const result = {
			workspacePath : this.stateManager.getState().workspacePath,
			stats         : this.getGraphStats(),
			nodes
		};
		return result;
	}

	dispose(): void {
		this.currentGraphData = undefined;
		this.registry.clear();
	}
}
