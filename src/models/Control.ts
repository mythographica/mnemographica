'use strict';

import { Backend, setProps } from './collections';
import { getLogger } from '../services/LoggerService';

// One point of tactica's control.json (a framework step around an entry
// point, supplied by generator plugins — see the lethe tactica contract).
// Mirrors the schema exactly, including the required `targets`. Unlike
// EDS/Flow, points are a FLAT list, not keyed by type.
export type rawControlPoint = {
	kind: string;
	className: string;
	location: string;
	code: string;
	scope: string;
	targets: string[];
};

// control.json `callers` section — tactica's static extraction of the
// call paths from each entry point down to every `new SomeType()` site.
// scopeId identity: the file path for module scopes, "file:line:col"
// (1-based) for function scopes.
export type rawCallersNode = {
	scopeId: string;
	name: string;
	kind: string;
	filePath: string;
	location: string;
	starter: boolean;
};

// caller → callee; the callee sits one step closer to a creation site
export type rawCallersEdge = {
	caller: string;
	callee: string;
};

// A `new` site: the holder scope constructs typePath at location
export type rawCallersAnchor = {
	location: string;
	holderScopeId: string;
	typePath: string;
	constructorText?: string;
	rooted?: boolean;
	variable?: string;
	terminatedAt?: string;
};

// Kept as plain transfer data — unlike points the callers graph is
// consumed whole (by GraphBuilder), never per-entry, so no *Entry subtype
export type rawCallers = {
	nodes: rawCallersNode[];
	edges: rawCallersEdge[];
	anchors: rawCallersAnchor[];
};

export type ControlPointInstance = InstanceType<typeof ControlPoint>;

// control.json file envelope (lethe contract, format 1.2)
export type rawControlFile = {
	version: string;
	generatedAt?: string;
	callers: rawCallers;
	points?: rawControlPoint[];
};

export const Control = Backend.define('Control', class {
	createdAt: number;
	private points: ControlPointInstance[] = [];
	private callers: rawCallers | undefined;
	// Why there is no callers graph: the Diamonds pane must say WHICH —
	// 'missing' (no control.json at all), 'stale' (the file exists but is
	// older than definitions.json, so the guard skipped it). An invalid
	// file fails schema validation at load and reads as 'missing' — the
	// warn already named the file and the errors.
	private callersAbsentReason: 'missing' | 'stale' | undefined;
	private logger = getLogger();

	constructor () {
		this.createdAt = Date.now();
		this.logger.info(`[Control] : constructed at ${this.createdAt}`);
	}

	get size () {
		return this.points.length;
	}

	all (): ControlPointInstance[] {
		return this.points;
	}

	set (points: ControlPointInstance[]): void {
		this.points = points;
	}

	setCallers (callers: rawCallers): void {
		this.callers = callers;
		this.callersAbsentReason = undefined;
	}

	getCallers (): rawCallers | undefined {
		return this.callers;
	}

	hasCallers (): boolean {
		return this.callers !== undefined;
	}

	setCallersAbsentReason (reason: 'missing' | 'stale'): void {
		this.callersAbsentReason = reason;
	}

	getCallersAbsentReason (): 'missing' | 'stale' | undefined {
		return this.callersAbsentReason;
	}

	clear (): void {
		this.points = [];
		this.callers = undefined;
		this.callersAbsentReason = undefined;
	}
});

export const ControlPoint = Control.define('ControlPoint', function (
	this: rawControlPoint,
	data: rawControlPoint
) {
	setProps(this, data);
});

export default Control;
