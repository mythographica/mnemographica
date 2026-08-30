// IMPORTANT: See AGENTS.md section "CRITICAL: Type vs Interface vs Instance"
// Instance data structures should use TYPE, not INTERFACE

'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import { getLogger } from '../services/LoggerService';

import type { Usages } from '~tactica/types';
import type { MainOrchestrator } from '../core/MainOrchestrator';

// Type alias using a clean import from .tactica/types.ts
type usages = Usages;


export class MnemonicaReferenceProvider implements vscode.ReferenceProvider {
	private usages: usages | undefined = undefined;
	private logger = getLogger();
	// Single load path (model audit): usages live in the orchestrator's
	// Registry; this provider READS that instance instead of keeping a
	// private copy parsed from disk
	private orchestrator: MainOrchestrator | undefined;

	setOrchestrator(orchestrator: MainOrchestrator): void {
		this.orchestrator = orchestrator;
	}

	/**
	 * Re-point the provider at the Registry's Usages instance. Call
	 * only AFTER the orchestrator finished loading the workspace —
	 * before that the instance does not exist.
	 */
	async loadUsages(): Promise<void> {
		if (!this.orchestrator) {
			this.logger.error('[Usages] orchestrator not wired — cannot load usages');
			return;
		}
		const registry = this.orchestrator.getRegistry();
		const loaded = registry.getUsages();
		if (!loaded) {
			this.logger.warn('[Usages] Registry has no Usages instance yet');
			return;
		}
		this.usages = loaded;
		this.logger.info(`Loaded usages for ${this.usages.size} types (from Registry)`);
	}

	provideReferences(
		document: vscode.TextDocument,
		position: vscode.Position,
		_context: vscode.ReferenceContext,
		_token: vscode.CancellationToken
	): vscode.ProviderResult<vscode.Location[]> {

		if (!this.usages) { return null; }

		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) return null;

		const word = document.getText(wordRange);
		const logger = getLogger();

		logger.debug(`Looking up references for: ${word}`);


		// Try exact match first
		let usageList = this.usages!.get(word);

		// Try with different prefixes/suffixes for nested types
		if (!usageList) {
			const lineText = document.lineAt(position.line).text;
			const typeMatch = this.extractTypeFromContext(lineText, position.character, word);
			if (typeMatch) {
				usageList = this.usages.get(typeMatch);
			}
		}

		if (!usageList || usageList.length === 0) {
			logger.debug(`No references found for: ${word}`);
			return null;
		}

		const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

		const locations: vscode.Location[] = usageList.map(usage => {
			// Resolve relative paths
			const [_filePath, line, column] = usage.location.split(':') as [string, string, string];
			let filePath = _filePath;
			if (workspaceFolder && !path.isAbsolute(filePath)) {
				filePath = path.join(workspaceFolder.uri.fsPath, filePath);
			}
			const uri = vscode.Uri.file(filePath);
			const pos = new vscode.Position(Number(line) - 1, Number(column));
			return new vscode.Location(uri, pos);
		});

		logger.debug(`Found ${locations.length} references for: ${word}`);

		return locations;
	}

	private extractTypeFromContext(lineText: string, charPos: number, _word: string): string | null {
		if (!this.usages) { return null; }

		// Check for property access pattern (UserType.SubType)
		const beforeCursor = lineText.substring(0, charPos);

		// Look for prefix pattern (e.g., "Parent.Child" where cursor is on "Child")
		const prefixMatch = beforeCursor.match(/([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*)\.[A-Za-z0-9_]*$/);
		if (prefixMatch) {
			const fullPath = prefixMatch[1];
			// Try the full path first
			if (this.usages.has(fullPath)) {
				return fullPath;
			}
		}

		return null;
	}

	getUsagesForType(typeName: string): Array<{ filePath: string; line: number; column: number; context?: string }> {
		if (!this.usages) { return []; }

		const usageList = this.usages.get(typeName.replace('_', '.'));
		if (!usageList) { return []; }

		return usageList.map(usage => {
			const [filePath, line, column] = usage.location.split(':') as [string, string, string];
			return {
				filePath,
				line: Number(line),
				column: Number(column),
				context: usage.typeName
			}
		});
	}

	clear(): void {
		// Drop the reference only — the Usages instance belongs to the
		// Registry, which clears itself on reload
		this.usages = undefined;
	}

	getStats() {
		if (!this.usages) { return; }
		let totalUsages = 0;
		for (const usageList of this.usages.values()) {
			totalUsages += usageList.length;
		}
		return { typeCount: this.usages.size, totalUsages };
	}
}
