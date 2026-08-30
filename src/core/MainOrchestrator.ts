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

	/**
	 * Land a batch of trace edges pushed by strategy (trace/ingest).
	 * Dedupe rule: the delta channel is monotonic per source process
	 * (ids only grow), so ids at or below the last seen are replays
	 * and are dropped. A source RESTART resets its ids — that needs a
	 * fresh session, a documented B1 limitation.
	 */
	ingestTrace(edges: unknown): { accepted: number; lastId: number; buffered: number } {
		const main = this.main;
		const buffer = main.traceBuffer as unknown as traceEdge[];
		let accepted = 0;
		if (Array.isArray(edges)) {
			for (const edge of edges) {
				if (!edge || typeof edge !== 'object') { continue; }
				const candidate = edge as { id?: unknown };
				if (typeof candidate.id !== 'number') { continue; }
				if (candidate.id <= main.traceLastId) { continue; }
				buffer.push(edge as traceEdge);
				main.traceLastId = candidate.id;
				accepted++;
			}
		}
		main.traceReceivedTotal += accepted;
		if (buffer.length > MainOrchestrator.TRACE_BUFFER_LIMIT) {
			buffer.splice(0, buffer.length - MainOrchestrator.TRACE_BUFFER_LIMIT);
		}
		const result = {
			accepted,
			lastId   : main.traceLastId,
			buffered : buffer.length
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
