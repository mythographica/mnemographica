'use strict';

import { spawn, ChildProcess } from 'node:child_process';
import { Socket } from 'node:net';
import * as net from 'node:net';

/**
 * Owns the Strategy MCP child process (Strategy reframe, 2026-09-01).
 *
 * Mnemographica can RUN strategy itself: spawn `lib/cli.js` from the
 * installed @mnemonica/strategy package with STRATEGY_LOG_PORT set, then
 * mirror the child's log socket into the Strategy tab. stdout of the child
 * is the MCP protocol stream — never read it here; stderr stays piped to
 * the child's own stderr handling (logged). The log socket is the
 * observable surface.
 */

export interface StrategyProcessStatus {
	running: boolean;
	pid: number | null;
	logPort: number;
	command: string | null;
}

type LogListener = (line: string) => void;

let child: ChildProcess | null = null;
let logSocket: Socket | null = null;
let logListener: LogListener | null = null;
let currentLogPort = 0;
let currentCommand: string | null = null;

export function setStrategyLogListener (listener: LogListener | null): void {
	logListener = listener;
}

function emitLog (line: string): void {
	if (logListener) {
		logListener(line);
	}
}

function attachLogSocket (logPort: number): void {
	let attempts = 0;
	const tryConnect = (): void => {
		if (!child) {
			return;
		}
		attempts += 1;
		const socket = net.createConnection(logPort, '127.0.0.1');
		socket.on('connect', () => {
			logSocket = socket;
			emitLog('[mnemographica] attached to strategy log socket');
		});
		let rest = '';
		socket.on('data', (data) => {
			rest += String(data);
			const lines = rest.split('\n');
			rest = lines.pop() || '';
			for (const line of lines) {
				if (line.length > 0) {
					emitLog(line);
				}
			}
		});
		socket.on('error', () => {
			// The child may need a moment to open the socket — retry a few times
			if (child && attempts < 20) {
				setTimeout(tryConnect, 500);
			}
		});
		socket.on('close', () => {
			if (logSocket === socket) {
				logSocket = null;
			}
		});
	};
	tryConnect();
}

export function startStrategyProcess (strategyDir: string, logPort: number): StrategyProcessStatus {
	if (child) {
		const already = getStrategyProcessStatus();
		return already;
	}
	currentLogPort = logPort;
	// resolve the CLI inside the installed package: <dir>/lib/cli.js
	const cliPath = `${strategyDir}/lib/cli.js`;
	currentCommand = cliPath;
	const spawned = spawn(process.execPath, [cliPath], {
		env : {
			...process.env,
			STRATEGY_LOG_PORT : String(logPort),
		},
		stdio : ['ignore', 'pipe', 'pipe'],
	});
	child = spawned;
	spawned.stderr.on('data', (data) => {
		const text = String(data).trim();
		if (text.length > 0) {
			emitLog(`[stderr] ${text}`);
		}
	});
	spawned.on('exit', (code) => {
		emitLog(`[mnemographica] strategy exited (code ${String(code)})`);
		child = null;
		if (logSocket) {
			logSocket.destroy();
			logSocket = null;
		}
	});
	attachLogSocket(logPort);
	const status = getStrategyProcessStatus();
	return status;
}

export function stopStrategyProcess (): void {
	if (child) {
		child.kill();
		child = null;
	}
	if (logSocket) {
		logSocket.destroy();
		logSocket = null;
	}
}

export function getStrategyProcessStatus (): StrategyProcessStatus {
	const status: StrategyProcessStatus = {
		running  : child !== null,
		pid      : child && child.pid ? child.pid : null,
		logPort  : currentLogPort,
		command  : currentCommand,
	};
	return status;
}
