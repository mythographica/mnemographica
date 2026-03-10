'use strict';

import * as vscode from 'vscode';

/**
 * LoggerService - Centralized logging service for Mnemonica Graphica
 * Wraps VS Code OutputChannel to provide consistent logging across the extension
 */
export class LoggerService {
	private static instance: LoggerService;
	private outputChannel: vscode.OutputChannel;
	private isInitialized = false;

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
	 */
	initialize (context: vscode.ExtensionContext): void {
		if (this.isInitialized) {
			return;
		}

		this.outputChannel = vscode.window.createOutputChannel('Mnemonica Logger');
		context.subscriptions.push(this.outputChannel);

		this.isInitialized = true;
		this.info('Mnemonica Logger initialized');
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
	 */
	dispose (): void {
		if (this.outputChannel) {
			this.outputChannel.dispose();
		}
		this.isInitialized = false;
	}

	/**
	 * Write a log message with timestamp and level
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
