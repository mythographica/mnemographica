'use strict';

import * as http from 'http';
import * as ws from 'ws';
import * as vscode from 'vscode';
import { getLogger } from '../services/LoggerService';

// WebSocket types from ws package
import type { WebSocket } from 'ws';

interface MCPRequest {
	jsonrpc: '2.0';
	id: number | string | null;
	method: string;
	params?: unknown;
}

interface MCPResponse {
	jsonrpc: '2.0';
	id: number | string | null;
	result?: unknown;
	error?: {
		code: number;
		message: string;
		data?: unknown;
	};
}

interface StrategyTool {
	name: string;
	description: string;
	inputSchema: unknown;
}

/**
 * StrategyServer - HTTP + WebSocket server for Strategy MCP integration
 * Runs inside the VS Code extension and exposes mnemonica analysis tools
 */
export class StrategyServer {
	private httpServer: http.Server | null = null;
	private wsServer: ws.Server | null = null;
	private port: number;
	private wsPort: number;
	private logger = getLogger();
	private tools: Map<string, StrategyTool> = new Map();

	constructor (port = 9230, wsPort = 9231) {
		this.port = port;
		this.wsPort = wsPort;
		this.registerDefaultTools();
	}

	/**
	 * Register built-in tools
	 */
	private registerDefaultTools (): void {
		this.tools.set('execute', {
			name: 'execute',
			description: 'Execute a command in specified context (MCP, RPC, RUN)',
			inputSchema: {
				type: 'object',
				properties: {
					context: {
						type: 'string',
						enum: ['MCP', 'RPC', 'RUN'],
						description: 'Execution context'
					},
					command: {
						type: 'string',
						description: 'Command name to execute'
					},
					message: {
						type: 'string',
						description: 'Command message or arguments'
					}
				},
				required: ['context', 'command', 'message']
			}
		});

		this.tools.set('list', {
			name: 'list',
			description: 'List all available commands grouped by context and folder',
			inputSchema: {
				type: 'object',
				properties: {}
			}
		});

		this.tools.set('help', {
			name: 'help',
			description: 'Get help for a specific command',
			inputSchema: {
				type: 'object',
				properties: {
					command: {
						type: 'string',
						description: 'Command name to get help for'
					}
				},
				required: ['command']
			}
		});

		this.tools.set('discover-types', {
			name: 'discover-types',
			description: 'Discover mnemonica types from the current workspace',
			inputSchema: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Path to workspace folder'
					}
				}
			}
		});
	}

	/**
	 * Start the HTTP and WebSocket servers
	 */
	async start (): Promise<void> {
		await this.startHTTPServer();
		await this.startWebSocketServer();
		this.logger.info(`Strategy MCP servers started on ports ${this.port} (HTTP) and ${this.wsPort} (WebSocket)`);
	}

	/**
	 * Stop the servers
	 */
	async stop (): Promise<void> {
		if (this.httpServer) {
			this.httpServer.close();
			this.httpServer = null;
		}
		if (this.wsServer) {
			this.wsServer.close();
			this.wsServer = null;
		}
		this.logger.info('Strategy MCP servers stopped');
	}

	/**
	 * Start HTTP server for MCP protocol
	 */
	private async startHTTPServer (): Promise<void> {
		return new Promise((resolve, reject) => {
			this.httpServer = http.createServer((req, res) => {
				this.handleHTTPRequest(req, res);
			});

			// Loopback only: there is no auth on this server, so
			// listening on 0.0.0.0 exposed every command to the LAN
			// (audit B17)
			this.httpServer.listen(this.port, '127.0.0.1', () => {
				this.logger.info(`HTTP server listening on port ${this.port}`);
				resolve();
			});

			this.httpServer.on('error', (err: Error) => {
				this.logger.error('HTTP server error:', err);
				reject(err);
			});
		});
	}

	/**
	 * Start WebSocket server for bidirectional communication
	 */
	private async startWebSocketServer (): Promise<void> {
		return new Promise((resolve, reject) => {
			// Loopback only, same as the HTTP server (audit B17)
			this.wsServer = new ws.Server({ port: this.wsPort, host: '127.0.0.1' });

			this.wsServer.on('connection', (client: WebSocket) => {
				this.logger.debug('WebSocket client connected');

				client.on('message', (data: ws.RawData) => {
					try {
						const message = JSON.parse(data.toString()) as MCPRequest;
						this.handleWebSocketMessage(client, message);
					} catch (err) {
						this.logger.error('Failed to parse WebSocket message:', err);
						client.send(JSON.stringify({
							jsonrpc: '2.0',
							id: null,
							error: {
								code: -32700,
								message: 'Parse error'
							}
						}));
					}
				});

				client.on('close', () => {
					this.logger.debug('WebSocket client disconnected');
				});
			});

			this.wsServer.on('listening', () => {
				this.logger.info(`WebSocket server listening on port ${this.wsPort}`);
				resolve();
			});

			this.wsServer.on('error', (err: Error) => {
				this.logger.error('WebSocket server error:', err);
				reject(err);
			});
		});
	}

	/**
	 * Handle HTTP request
	 */
	private async handleHTTPRequest (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		// Enable CORS
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

		if (req.method === 'OPTIONS') {
			res.writeHead(200);
			res.end();
			return;
		}

		if (req.method !== 'POST') {
			res.writeHead(405);
			res.end('Method not allowed');
			return;
		}

		let body = '';
		req.on('data', (chunk: Buffer) => {
			body += chunk.toString();
		});

		req.on('end', async () => {
			try {
				const request = JSON.parse(body) as MCPRequest;
				const response = await this.handleMCPRequest(request);
				res.setHeader('Content-Type', 'application/json');
				res.writeHead(200);
				res.end(JSON.stringify(response));
			} catch (err) {
				this.logger.error('Failed to handle HTTP request:', err);
				const errorResponse: MCPResponse = {
					jsonrpc: '2.0',
					id: null,
					error: {
						code: -32603,
						message: 'Internal error'
					}
				};
				res.setHeader('Content-Type', 'application/json');
				res.writeHead(500);
				res.end(JSON.stringify(errorResponse));
			}
		});
	}

	/**
	 * Handle WebSocket message
	 */
	private async handleWebSocketMessage (client: WebSocket, request: MCPRequest): Promise<void> {
		const response = await this.handleMCPRequest(request);
		client.send(JSON.stringify(response));
	}

	/**
	 * Handle MCP JSON-RPC request
	 */
	private async handleMCPRequest (request: MCPRequest): Promise<MCPResponse> {
		const { id, method, params } = request;

		try {
			switch (method) {
				case 'tools/list':
					return {
						jsonrpc: '2.0',
						id,
						result: {
							tools: Array.from(this.tools.values())
						}
					};

				case 'tools/call': {
					const toolParams = params as { name: string; arguments?: Record<string, unknown> } | undefined;
					if (!toolParams?.name) {
						return {
							jsonrpc: '2.0',
							id,
							error: {
								code: -32602,
								message: 'Invalid params: missing tool name'
							}
						};
					}
					const result = await this.executeTool(toolParams.name, toolParams.arguments || {});
					return {
						jsonrpc: '2.0',
						id,
						result
					};
				}

				case 'initialize':
					return {
						jsonrpc: '2.0',
						id,
						result: {
							protocolVersion: '2024-11-05',
							serverInfo: {
								name: 'mnemographica-strategy',
								version: '0.1.0'
							},
							capabilities: {
								tools: {}
							}
						}
					};

				default:
					return {
						jsonrpc: '2.0',
						id,
						error: {
							code: -32601,
							message: `Method not found: ${method}`
						}
					};
			}
		} catch (err) {
			this.logger.error('Error handling MCP request:', err);
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: -32603,
					message: err instanceof Error ? err.message : 'Internal error'
				}
			};
		}
	}

	/**
	 * Execute a tool by name
	 */
	private async executeTool (name: string, args: Record<string, unknown>): Promise<unknown> {
		switch (name) {
			case 'execute':
				return this.handleExecute(args);

			case 'list':
				return this.handleList();

			case 'help':
				return this.handleHelp(args);

			case 'discover-types':
				return this.handleDiscoverTypes(args);

			default:
				throw new Error(`Unknown tool: ${name}`);
		}
	}

	/**
	 * Handle execute tool
	 */
	private async handleExecute (args: Record<string, unknown>): Promise<unknown> {
		const context = args.context as string;
		const command = args.command as string;
		const message = args.message as string;

		this.logger.info(`Executing command: ${command} in context: ${context}`);

		// TODO: Integrate with actual command execution from strategy module
		// For now, return a placeholder
		return {
			context,
			command,
			message,
			status: 'executed',
			timestamp: Date.now()
		};
	}

	/**
	 * Handle list tool
	 */
	private async handleList (): Promise<unknown> {
		return {
			contexts: {
				MCP: ['execute', 'list', 'help'],
				RPC: ['discover-types', 'analyze-hierarchy', 'fetch-memories'],
				RUN: ['go-to-definition', 'find-references', 'refresh-graph']
			}
		};
	}

	/**
	 * Handle help tool
	 */
	private async handleHelp (args: Record<string, unknown>): Promise<unknown> {
		const command = args.command as string;
		const tool = this.tools.get(command);

		if (!tool) {
			return { error: `Command not found: ${command}` };
		}

		return {
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema,
			examples: [
				{
					name: tool.name,
					params: {}
				}
			]
		};
	}

	/**
	 * Handle discover-types tool
	 */
	private async handleDiscoverTypes (args: Record<string, unknown>): Promise<unknown> {
		const workspacePath = args.path as string | undefined;

		if (!workspacePath) {
			const folders = vscode.workspace.workspaceFolders;
			if (!folders || folders.length === 0) {
				return { error: 'No workspace folder open' };
			}
		}

		// Trigger type discovery via VS Code command
		await vscode.commands.executeCommand('mnemographica.refreshGraph');

		return {
			status: 'discovery_triggered',
			path: workspacePath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
			timestamp: Date.now()
		};
	}

	/**
	 * Check if server is running
	 */
	isRunning (): boolean {
		return this.httpServer !== null && this.wsServer !== null;
	}

	/**
	 * Get server status
	 */
	getStatus (): { httpPort: number; wsPort: number; running: boolean } {
		return {
			httpPort: this.port,
			wsPort: this.wsPort,
			running: this.isRunning()
		};
	}
}
