'use strict';

import { define } from 'mnemonica';
import { getLogger } from '../services/LoggerService';

// One entry of tactica's instrumentation.json (framework lifecycle
// crossroads, detected syntactically — see tactica AGENTS.md output
// contract). Unlike EDS/Flow, points are a FLAT list, not keyed by type.
export type rawInstrumentationPoint = {
	kind: string;
	className: string;
	location: string;
	code: string;
	scope: string;
	targets?: string[];
};

// instrumentation.json v2 `creationGraph` section — tactica's static
// extraction of the call chains from each entry point down to every
// `new SomeType()` site. scopeId identity: the file path for module
// scopes, "file:line:col" (1-based) for function scopes.
export type rawCreationGraphNode = {
	scopeId: string;
	name: string;
	kind: 'module' | 'function' | 'method' | 'arrow';
	filePath: string;
	location: string;
	starter: boolean;
};

// caller → callee; the callee sits one step closer to a creation site
export type rawCreationGraphEdge = {
	caller: string;
	callee: string;
};

// A `new` site: the holder scope constructs typePath at location
export type rawCreationGraphAnchor = {
	location: string;
	holderScopeId: string;
	typePath: string;
	constructorText?: string;
	rooted?: boolean;
	variable?: string;
	terminatedAt?: string;
};

// Kept as plain transfer data — unlike points the graph is consumed
// whole (by GraphBuilder), never per-entry, so no *Entry subtype
export type rawCreationGraph = {
	nodes: rawCreationGraphNode[];
	edges: rawCreationGraphEdge[];
	anchors: rawCreationGraphAnchor[];
};

export type InstrumentationPointInstance = InstanceType<typeof InstrumentationPoint>;

export const Instrumentation = define('Instrumentation', class {
	createdAt: number;
	private points: InstrumentationPointInstance[] = [];
	private creationGraph: rawCreationGraph | undefined;
	// Why there is no creation graph (2026-09-07): the Diamonds pane must
	// say WHICH — 'missing' (no instrumentation.json at all), 'stale'
	// (the file exists but is older than definitions.json, so the guard
	// skipped it), 'v1' (loaded fine, but predates tactica v2 — or its
	// graph section was malformed)
	private creationGraphAbsentReason: 'missing' | 'stale' | 'v1' | undefined;
	private logger = getLogger();

	constructor () {
		this.createdAt = Date.now();
		this.logger.info(`[Instrumentation] : constructed at ${this.createdAt}`);
	}

	get size () {
		return this.points.length;
	}

	all (): InstrumentationPointInstance[] {
		return this.points;
	}

	set (points: InstrumentationPointInstance[]): void {
		this.points = points;
	}

	setCreationGraph (graph: rawCreationGraph): void {
		this.creationGraph = graph;
		this.creationGraphAbsentReason = undefined;
	}

	getCreationGraph (): rawCreationGraph | undefined {
		return this.creationGraph;
	}

	hasCreationGraph (): boolean {
		return this.creationGraph !== undefined;
	}

	setCreationGraphAbsentReason (reason: 'missing' | 'stale' | 'v1'): void {
		this.creationGraphAbsentReason = reason;
	}

	getCreationGraphAbsentReason (): 'missing' | 'stale' | 'v1' | undefined {
		return this.creationGraphAbsentReason;
	}

	clear (): void {
		this.points = [];
		this.creationGraph = undefined;
		this.creationGraphAbsentReason = undefined;
	}
});

const setProps = (to: object, from: object) => {
	Object.defineProperties(to, Object.getOwnPropertyDescriptors(from));
};

export const InstrumentationPoint = Instrumentation.define('InstrumentationPoint', function (
	this: rawInstrumentationPoint,
	data: rawInstrumentationPoint
) {
	setProps(this, data);
});

export default Instrumentation;
