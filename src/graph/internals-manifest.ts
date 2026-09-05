/**
 * Internals backplane manifest — the DECLARED hub and sinks of the
 * combined Dive graph.
 *
 * Why declared, not discovered: eds.json/instrumentation.json only see
 * the analyzed workspace. The calls that complete the fiber chain live
 * INSIDE @mnemonica/dive and @mnemonica/nestjs (attachHooks calls
 * enterContext/recordCreation/…, the OTEL provider subscribes via
 * registerHook) — no analyzer over the consumer's sources can ever
 * surface them. We own both packages, so the truthful source is a
 * hand-declared manifest with a source citation per knot.
 *
 * Shape (Viktor's structure review, plans/graph-structure-review-2026-09-04.md):
 * dive's internal functions are NOT knots — recordCreation / enterContext /
 * wrapConstructorArg / upgradeConstructorArg / wrapInstanceMethods /
 * isWrappedFunction / current / setTraceLimit are event chunks of the
 * attachHooks hub firing (or bootstrap config), so they fold into the
 * per-type grafts the GraphBuilder computes. getFlow / getErrorInstance
 * survive only as the label on the filter's read-back edge. What remains
 * declared: the EDS ring (center storage), the attachHooks hub, and the
 * adapter sinks a fiber's data leaves through — Jaeger the only terminal
 * outside the system.
 *
 * Every edge below was verified against the cited source on 2026-09-04.
 * When dive or the adapter change, update the manifest — it is a mirror,
 * not a derivation.
 *
 * Terminology (Viktor, 2026-09-04): EDS = dive's ring storage (runtime);
 * Fiber = one context segment of the ring; Trace = the bigger
 * linear-order chain the Adapter constructs. Trace ⊃ Fiber ⊃ EDS.
 */

export type rawInternalKnot = {
	/** Stable id, e.g. 'dive:edsRing', 'adapter:attachHooks', 'adapter:jaeger' */
	id: string;
	/** Display name */
	name: string;
	/** Structural role in the combined Dive graph */
	role: 'ring' | 'hub' | 'sink' | 'external';
	/** Repo-relative source citation (path:line); absent for the external */
	citation?: string;
};

export type rawInternalEdge = {
	source: string;
	target: string;
	/** Edge annotation (the read-back edge names the read APIs) */
	label?: string;
};

/**
 * The ring and the hub. The ring is dive's runtime storage — every fiber
 * lands there; the hub is attachHooks, bootstrap-time wiring whose hooks
 * fire at every construction of the collection (preCreation enters the
 * parent context and wraps function args; postCreation records the create
 * edge and wraps instance methods; creationError pins the failure).
 */
const CORE_KNOTS: rawInternalKnot[] = [
	{ id: 'dive:edsRing',        name: 'Dive: EDS ring',        role: 'ring' },
	{ id: 'adapter:attachHooks', name: 'Adapter: attachHooks',  role: 'hub', citation: 'nestjs-adapter/src/hooks/attach-hooks.ts' },
];

/**
 * Adapter sinks — where a fiber's data leaves the trace system. The ALS
 * provider pins FlowFrames ("the adapter is the Node boundary where ALS
 * is free"), the OTEL provider turns ring events into spans, the
 * exception filter reads the ring back at the error boundary and emits
 * its own span. Jaeger is outside the system — the only true terminal.
 */
const SINK_KNOTS: rawInternalKnot[] = [
	{ id: 'adapter:asyncFlow',       name: 'Adapter: AsyncFlowProvider (ALS)', role: 'sink', citation: 'nestjs-adapter/src/providers/async-flow.provider.ts' },
	{ id: 'adapter:otel',            name: 'Adapter: DiveOtelProvider',        role: 'sink', citation: 'nestjs-adapter/src/providers/dive-otel.provider.ts' },
	{ id: 'adapter:exceptionFilter', name: 'Adapter: TraceExceptionFilter',    role: 'sink', citation: 'nestjs-adapter/src/filters/mnemonica-exception.filter.ts' },
	{ id: 'adapter:jaeger',          name: 'Jaeger (OTEL)',                    role: 'external' },
];

export const INTERNAL_KNOTS: rawInternalKnot[] = [ ...CORE_KNOTS, ...SINK_KNOTS ];

/**
 * The export path, directed as DATA flows: every fiber lands in the ring
 * (recorders write edges there); the providers consume ring events; the
 * filter reads the flow back via getFlow/getErrorInstance; spans leave
 * the process to Jaeger over HTTP.
 */
export const INTERNAL_EDGES: rawInternalEdge[] = [
	{ source: 'dive:edsRing', target: 'adapter:asyncFlow' },
	{ source: 'dive:edsRing', target: 'adapter:otel' },
	{ source: 'dive:edsRing', target: 'adapter:exceptionFilter', label: 'getFlow / getErrorInstance' },
	{ source: 'adapter:otel',            target: 'adapter:jaeger' },
	{ source: 'adapter:exceptionFilter', target: 'adapter:jaeger' },
];

/** The collection marker's hookup: attachHooks wires a whole collection */
export const COLLECTION_HOOKUP_EDGE: rawInternalEdge = {
	source : 'collection',
	target : 'adapter:attachHooks',
};
