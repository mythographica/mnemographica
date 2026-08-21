'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { lookup } from 'mnemonica';
import { modelsLoaded } from '../topologica/bootstrap';
import type { LoggerTab, LoggerTab_LogEntry } from '~tactica/types';

// Type aliases for cleaner code
// Using imports from .tactica/types.ts instead of InstanceType<TypeRegistry>

/**
 * LoggerService - Centralized logging service for Mnemonica Graphica
 * Wraps VS Code OutputChannel to provide consistent logging across the extension
 * Also writes to a file for debugging without user interaction
 *
 * Phase 1 Self-Referential: Log entries stored as Mnemonica instances
 */
export class LoggerService {
	private static instance: LoggerService;
	private outputChannel: vscode.OutputChannel;
	private isInitialized = false;
	private logFilePath: string | undefined;

	// Phase 1: Mnemonica data storage
	private loggerTab: LoggerTab | undefined;
	private logEntries: LoggerTab_LogEntry[] = [];

	private constructor () {
		// Output channel will be created on first use
		this.outputChannel = null as unknown as vscode.OutputChannel;
	}

	static getInstance (): LoggerService {
		if (!LoggerService.instance) {
			LoggerService.instance = new LoggerService();
		}
		return LoggerService.instance;
	}

	/**
	 * Initialize the output channel
	 * Must be called from extension activate()
	 * Phase 1: Also initializes Mnemonica LoggerTab data storage
	 */
	initialize (context: vscode.ExtensionContext): void {
		if (this.isInitialized) {
			return;
		}

		this.outputChannel = vscode.window.createOutputChannel('Mnemonica Logger');
		context.subscriptions.push(this.outputChannel);

		// Set up file logging for self-service debugging
		const logDir = path.join(context.extensionPath, 'logs');
		if (!fs.existsSync(logDir)) {
			fs.mkdirSync(logDir, { recursive: true });
		}
		this.logFilePath = path.join(logDir, 'server.log');

		// Phase 1 storage starts lazily on first write() — models are
		// not loaded yet at this point (see ensureLoggerTab)
		this.isInitialized = true;
		this.info('Mnemonica Logger initialized');
	}

	/**
	 * Lazily resolve the LoggerTab mnemonica type on first write.
	 * initialize() is called before loadModels(), so the lookup must
	 * happen here, once models actually exist.
	 */
	private ensureLoggerTab (): void {
		if (this.loggerTab || !modelsLoaded) {
			return;
		}
		const LoggerTabConstructor = lookup('LoggerTab');
		if (LoggerTabConstructor) {
			this.loggerTab = new LoggerTabConstructor();
		}
	}

	/**
	 * Log a message at info level
	 */
	log (message: string, ...args: unknown[]): void {
		this.write('LOG', message, args);
	}

	/**
	 * Log a message at info level
	 */
	info (message: string, ...args: unknown[]): void {
		this.write('INFO', message, args);
	}

	/**
	 * Log a message at warn level
	 */
	warn (message: string, ...args: unknown[]): void {
		this.write('WARN', message, args);
	}

	/**
	 * Log a message at error level
	 */
	error (message: string, ...args: unknown[]): void {
		this.write('ERROR', message, args);
	}

	/**
	 * Log a debug message (only in development)
	 */
	debug (message: string, ...args: unknown[]): void {
		this.write('DEBUG', message, args);
	}

	/**
	 * Show the output channel
	 */
	show (): void {
		if (this.outputChannel) {
			this.outputChannel.show();
		}
	}

	/**
	 * Hide the output channel
	 */
	hide (): void {
		if (this.outputChannel) {
			// VS Code doesn't have a hide method, but we can show a different channel
			// or just leave it visible
		}
	}

	/**
	 * Clear all log messages
	 */
	clear (): void {
		if (this.outputChannel) {
			this.outputChannel.clear();
		}
	}

	/**
	 * Dispose the logger
	 * Phase 1: Also clears Mnemonica data
	 */
	dispose (): void {
		if (this.outputChannel) {
			this.outputChannel.dispose();
		}
		this.isInitialized = false;
		// Phase 1: Reset Mnemonica data
		this.logEntries = [];
		this.loggerTab = undefined;
	}

	/**
	 * Get all log entries as Mnemonica instances
	 * Phase 1: Allows introspection of logged data
	 */
	getLogEntries (): LoggerTab_LogEntry[] {
		return [...this.logEntries];
	}

	/**
	 * Get log entries by level
	 * Phase 1: Filter logs by severity level
	 */
	getLogsByLevel (level: 'info' | 'warning' | 'error'): LoggerTab_LogEntry[] {
		return this.logEntries.filter(entry => entry.level === level);
	}

	/**
	 * Get count of stored log entries
	 * Phase 1: Statistics for the Mnemonica data
	 */
	getLogCount (): number {
		return this.logEntries.length;
	}

	/**
	 * Write a log message with timestamp and level
	 * Phase 1: Also stores as Mnemonica LogEntry instance
	 */
	private write (level: string, message: string, args: unknown[]): void {
		const timestamp = new Date().toISOString();
		const prefix = `[${timestamp}] [${level}]`;

		// Format the main message
		let formattedMessage = message;
		if (args.length > 0) {
			formattedMessage = this.formatMessage(message, args);
		}

		const logline = `${prefix} ${formattedMessage}`;

		// Write to file for self-service debugging
		if (this.logFilePath) {
			try {
				fs.appendFileSync(this.logFilePath, logline + '\n', 'utf-8');
			} catch {
				// Silent fail - file logging is best-effort
			}
		}

		// Phase 1: Create Mnemonica LogEntry instance for data storage.
		// loggerTab is resolved lazily here: initialize() runs before
		// loadModels(), so the eager lookup there always failed (audit B6).
		this.ensureLoggerTab();
		if (this.loggerTab) {
			const entry = new this.loggerTab.LogEntry({
				level: level.toLowerCase() as 'info' | 'warning' | 'error',
				message: formattedMessage,
				timestamp: Date.now(),
				args: args.length > 0 ? args : undefined
			});
			this.logEntries.push(entry);
		}

		// Write to output channel if initialized, otherwise log to console
		if (this.isInitialized && this.outputChannel) {
			this.outputChannel.appendLine(logline);
		} else {
			// Fallback to console when output channel not ready
			// eslint-disable-next-line no-console
			console.log(logline);
		}
	}

	/**
	 * Format a message with arguments (similar to console.log)
	 */
	private formatMessage (message: string, args: unknown[]): string {
		// Convert args to strings
		const argStrings = args.map(arg => {
			if (typeof arg === 'object') {
				try {
					return JSON.stringify(arg);
				} catch {
					return String(arg);
				}
			}
			return String(arg);
		});

		// If message has % placeholders, try to replace them
		if (message.includes('%')) {
			let result = message;
			let argIndex = 0;
			result = result.replace(/%[sdjifoO]/g, () => {
				if (argIndex < argStrings.length) {
					return argStrings[argIndex++];
				}
				return '%s';
			});
			// Append any remaining args
			if (argIndex < argStrings.length) {
				result += ' ' + argStrings.slice(argIndex).join(' ');
			}
			return result;
		}

		// Otherwise just append args
		return message + ' ' + argStrings.join(' ');
	}
}

/**
 * Convenience function to get the logger instance
 */
export function getLogger (): LoggerService {
	return LoggerService.getInstance();
}
