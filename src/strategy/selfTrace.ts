/**
 * Self-instrumentation (2026-09-06, owner request: "instrument
 * MnemoGraphica itself"). dive runs IN the extension host; its edge
 * lifecycle events land directly on the orchestrator's ingestTrace —
 * the same landing point as the WS trace/ingest (server.ts), no socket
 * in between. The payload → edge mapping mirrors strategy's
 * cdp-scripts/ws-server.js mapTraceEdge (one mapping contract); the
 * OTEL traceId still reads the adapter-owned global map when present
 * (in-process it usually is not).
 *
 * Ring semantics: the trace ring is single-source — a changed session
 * marker VACUUMs it (MainOrchestrator.ingestTrace). Self batches tag
 * themselves `self:<pid>`, so alternating between an app channel and
 * self-trace wipes the ring per that existing rule; self-trace is meant
 * for watching mnemographica's OWN workspace.
 */
import { getProps } from 'mnemonica';
import { getLogger } from '../services/LoggerService';
import type { MainOrchestrator, traceEdge } from '../core/MainOrchestrator';
import { GraphPanel } from '../webview/panel';
import { LiveTraceTreeProvider } from '../views/liveTraceTreeProvider';

type diveModule = typeof import('@mnemonica/dive');
type diveHookPayload = { edge?: unknown };

const FLUSH_MS = 250;

let diveModuleRef: diveModule | null = null;
let detachHooks: Array<() => void> = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let edgeBuffer: traceEdge[] = [];

// Same resolution as ws-server.js instanceTypeOf: the live instance
// cannot cross into the ring, its mnemonica TypeName is what the panel
// matches bulbs by
const instanceTypeOf = function (instance: unknown): string | null {
	if (!instance || typeof instance !== 'object') {
		return null;
	}
	try {
		const props = getProps(instance) as { __type__?: { TypeName?: string } } | undefined;
		const type = props && props.__type__;
		const name = type && type.TypeName;
		return name || null;
	} catch {
		return null;
	}
};

const mapEdge = function (edge: traceEdge & { instance?: unknown }): traceEdge {
	// Wanted #2 contract: the adapter records edgeId → OTEL traceId on a
	// global map; absent in-process, probed anyway
	const traceIds = (globalThis as { __mnemonicaDiveTraceIds?: { get (id: number): string | undefined } }).__mnemonicaDiveTraceIds;
	const traceId = traceIds ? (traceIds.get(edge.id) || null) : null;
	const mapped: traceEdge = {
		id            : edge.id,
		parentId      : edge.parentId,
		name          : edge.name,
		kind          : edge.kind,
		status        : edge.status,
		duration      : edge.duration === undefined ? null : edge.duration,
		ts            : edge.ts,
		instanceType  : instanceTypeOf(edge.instance),
		// dive >= 0.8.3: the panel distrusts ambient bulbs
		instanceSource: edge.instanceSource || null,
		traceId       : traceId
	};
	return mapped;
};

/**
 * Attach dive's edge-lifecycle hooks and pump mapped edges into the
 * orchestrator. Fire-and-forget from activate(): a dive load failure
 * (EH too old for require(ESM)) disables self-tracing without breaking
 * the extension.
 */
export async function startSelfTrace (orchestrator: MainOrchestrator): Promise<void> {
	const logger = getLogger();
	if (detachHooks.length > 0) {
		return;
	}
	try {
		diveModuleRef = await import('@mnemonica/dive');
	} catch (error) {
		logger.warn('[SelfTrace] @mnemonica/dive not loadable — self-instrumentation off:', String(error));
		return;
	}
	const dive = diveModuleRef;

	const onEdge = function (payload: diveHookPayload) {
		const edge = payload && payload.edge as (traceEdge & { instance?: unknown }) | undefined;
		if (!edge || typeof edge.id !== 'number') {
			return;
		}
		edgeBuffer.push(mapEdge(edge));
	};

	// enter/create alone would leave call edges 'running' forever —
	// leave/settle carry the completion (ws-server's default set);
	// 'create' is probed: an older dive throws on registration, which is
	// contained and reported, same as the ws-server precedent
	const events: Array<'enter' | 'create' | 'leave' | 'settle'> = ['enter', 'create', 'leave', 'settle'];
	const register = dive.registerHook as (event: string, hook: (payload: diveHookPayload) => void) => () => void;
	events.forEach(event => {
		try {
			const detach = register(event, onEdge);
			detachHooks.push(detach);
		} catch {
			logger.info(`[SelfTrace] dive has no '${event}' hook — skipped`);
		}
	});
	if (detachHooks.length === 0) {
		logger.warn('[SelfTrace] no dive hooks registered — self-instrumentation off');
		return;
	}

	// The in-process session tag for the orchestrator's per-source
	// monotonic dedup: the extension host IS the source process here
	const session = `self:${process.pid}`;
	flushTimer = setInterval(() => {
		if (edgeBuffer.length === 0) {
			return;
		}
		const batch = edgeBuffer;
		edgeBuffer = [];
		const result = orchestrator.ingestTrace(batch, session);
		// The same downstream the WS trace/ingest drives (server.ts):
		// panel bulbs + the Live Trace sidebar
		GraphPanel.pushTraceEdges(result.edges);
		LiveTraceTreeProvider.noteIngest();
	}, FLUSH_MS);
	logger.info('[SelfTrace] dive hooks attached — mnemographica is tracing itself');
}

/**
 * Wrap a function for self-tracing. Returns the function unchanged when
 * dive failed to load — instrumentation must never break the flow it
 * observes. The wrap SITE is also what tactica's eds.json sees.
 */
export function wrapForSelfTrace<A extends unknown[], R> (fn: (...args: A) => R, context: object, label: string): (...args: A) => R {
	const dive = diveModuleRef;
	if (!dive) {
		return fn;
	}
	const wrapped = dive.wrap(fn as (...args: unknown[]) => unknown, context, label);
	return wrapped as (...args: A) => R;
}

export function stopSelfTrace (): void {
	if (flushTimer) {
		clearInterval(flushTimer);
		flushTimer = null;
	}
	detachHooks.forEach(detach => {
		try {
			detach();
		} catch { /* teardown best-effort */ }
	});
	detachHooks = [];
	edgeBuffer = [];
	diveModuleRef = null;
}
