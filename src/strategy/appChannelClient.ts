'use strict';

import * as http from 'node:http';
import { dirname, join } from 'node:path';
import type { WSSession as WSSessionType } from '@mnemonica/strategy';

/**
 * Direct app-channel client (Strategy reframe, 2026-09-01).
 *
 * Connects Mnemographica STRAIGHT to an application's self-hosted strategy
 * WS channel (startStrategyClient in the app — no CDP, no strategy MCP in
 * the middle). Discovery: the app exposes GET <discoveryUrl> reporting
 * { available, port, token, pid }; manual host/port/token works too.
 * Once connected, traceSubscribe turns the channel into a push source and
 * the edges land on the orchestrator exactly like the strategy-driven
 * trace/ingest path.
 *
 * WSSession is loaded by ABSOLUTE path from the strategy package's
 * submodule (lib/ws-session) — loading the package root would pull the
 * MCP SDK into the extension host. (Historical second reason, from the
 * `file:../strategy` era: a name-based require resolved against the
 * symlink's realpath, escaping the extension's module root. The dep is a
 * registry install now; the absolute path stays — both reasons say so.)
 */

const strategyPkgPath = require.resolve('@mnemonica/strategy/package.json');
const wsSessionPath = join(dirname(strategyPkgPath), 'lib', 'ws-session.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { WSSession } = require(wsSessionPath) as {
	WSSession: {
		connect: (host: string, port: number, token: string) => Promise<WSSessionType>;
	};
};

export interface AppChannelDiscovery {
	available: boolean;
	port?: number;
	token?: string;
	pid?: number;
}

export interface AppChannelStatus {
	connected: boolean;
	host: string;
	port: number;
	pid: number | null;
	edgesReceived: number;
	batchesReceived: number;
	lastError: string | null;
}

export interface TraceEdgeSink {
	ingest: (edges: unknown[], session: string) => void;
}

export function fetchDiscovery (discoveryUrl: string, timeoutMs = 4000): Promise<AppChannelDiscovery> {
	const result = new Promise<AppChannelDiscovery>((resolve, reject) => {
		const request = http.get(discoveryUrl, (response) => {
			let body = '';
			response.on('data', (chunk) => {
				body += String(chunk);
			});
			response.on('end', () => {
				try {
					const parsed = JSON.parse(body) as AppChannelDiscovery;
					resolve(parsed);
				} catch (err) {
					reject(err instanceof Error ? err : new Error(String(err)));
				}
			});
		});
		request.on('error', reject);
		request.setTimeout(timeoutMs, () => {
			request.destroy(new Error(`discovery timeout after ${timeoutMs}ms`));
		});
	});
	return result;
}

export class AppChannelClient {
	private session: WSSessionType | null = null;
	private sink: TraceEdgeSink;
	private edgesReceived = 0;
	private batchesReceived = 0;
	private lastError: string | null = null;
	private host = '127.0.0.1';
	private port = 0;
	private targetPid: number | null = null;

	constructor (sink: TraceEdgeSink) {
		this.sink = sink;
	}

	async connect (host: string, port: number, token: string, pid?: number): Promise<AppChannelStatus> {
		if (this.session) {
			this.disconnect();
		}
		this.host = host;
		this.port = port;
		this.targetPid = typeof pid === 'number' ? pid : null;
		this.edgesReceived = 0;
		this.batchesReceived = 0;
		this.lastError = null;
		try {
			const session = await WSSession.connect(host, port, token);
			this.session = session;
			session.setNotificationHandler('trace', (params: unknown) => {
				const edges = (params as { edges?: unknown[] } | null)?.edges;
				if (Array.isArray(edges)) {
					this.edgesReceived += edges.length;
					this.batchesReceived += 1;
					// The pid tags the batch so a restarted app auto-wipes the
					// ring (monotonic dedup watermark resets with the source).
					const sessionTag = `app-channel:${String(this.targetPid || 'unknown')}`;
					this.sink.ingest(edges, sessionTag);
				}
			});
			await session.request('traceSubscribe', { events: ['enter', 'create', 'leave', 'settle'] });
		} catch (err) {
			this.lastError = err instanceof Error ? err.message : String(err);
			this.session = null;
		}
		const status = this.getStatus();
		return status;
	}

	disconnect (): void {
		if (this.session) {
			this.session.close();
			this.session = null;
		}
	}

	getStatus (): AppChannelStatus {
		const status: AppChannelStatus = {
			connected       : this.session !== null && this.session.isOpen,
			host            : this.host,
			port            : this.port,
			pid             : this.targetPid,
			edgesReceived   : this.edgesReceived,
			batchesReceived : this.batchesReceived,
			lastError       : this.lastError,
		};
		return status;
	}
}
