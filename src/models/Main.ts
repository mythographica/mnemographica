'use strict';

import { define } from 'mnemonica';

export const Main = define('Main', function (
	this: {
		extensionVersion: string;
		createdAt: number;
		// Live-trace landing zone (B1.3): the runtime channel from
		// strategy. Data ONLY — bounding/dedupe behavior lives in
		// MainOrchestrator.ingestTrace. Parsing the stream into
		// structure is a future design session (next-loop plan B1.4).
		// Generated .tactica types flatten this to Array<unknown>;
		// MainOrchestrator re-grounds it to traceEdge at the cast.
		traceBuffer: Array<{
			id: number;
			parentId: number | null;
			name: string;
			kind: string;
			status: string;
			duration: number | null;
			ts: number;
			instanceType: string | null;
			instanceSource?: 'explicit' | 'ambient' | null;
		}>;
		traceLastId: number;
		traceReceivedTotal: number;
		// Source session marker (2026-08-30): pushers tag each ingest
		// batch with the target's identity (pid). A CHANGED marker means
		// the source process restarted — its edge ids restart from 1 and
		// the monotonic dedup would drop them all, so ingestTrace
		// auto-wipes first (VACUUM rule, Viktor 2026-08-30).
		traceSession: string | undefined;
	},
	extensionVersion: string
) {
	this.extensionVersion = extensionVersion;
	this.createdAt = Date.now();
	this.traceBuffer = [];
	this.traceLastId = 0;
	this.traceReceivedTotal = 0;
	this.traceSession = undefined;
});

export const Adapter = Main.define('Adapter', function (
	this: { name: string; domain: string; enabled: boolean; createdAt: number },
	data: { name: string; domain: string; enabled: boolean }
) {
	this.name = data.name;
	this.domain = data.domain;
	this.enabled = data.enabled;
	this.createdAt = Date.now();
});

export default Main;
