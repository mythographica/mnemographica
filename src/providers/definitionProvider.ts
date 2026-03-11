// IMPORTANT: See AGENTS.md section "CRITICAL: Type vs Interface vs Instance"
// Instance data structures should use TYPE, not INTERFACE

'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getLogger } from '../services/LoggerService';
import { lookupTyped } from 'mnemonica';
import { modelsLoaded } from '../topologica/bootstrap';

type DefinitionInfo = {
	filePath: string;
	line: number;
	column: number;
};

export class MnemonicaDefinitionProvider implements vscode.DefinitionProvider {
	private definitions: Map<string, DefinitionInfo> = new Map();
	private logger = getLogger();

	async loadDefinitions (workspacePath: string): Promise<void> {
		this.definitions.clear();

		const definitionsPath = path.join(workspacePath, '.tactica', 'definitions.json');
		if (!fs.existsSync(definitionsPath)) {
			this.logger.warn('No definitions.json found at:', definitionsPath);
			return;
		}

		try {
			const content = fs.readFileSync(definitionsPath, 'utf-8');
			const data = JSON.parse(content);

			// Parse definitions from JSON
				const definitions = (data.definitions || data) as Record<string, unknown>;
	
				// Get DefinitionEntry model for creating instances
				const DefinitionEntry = modelsLoaded ? lookupTyped('Registry.DefinitionEntry') : null;
	
				for (const [typeName, defInfo] of Object.entries(definitions)) {
					if (typeof defInfo === 'object' && defInfo !== null &&
						'filePath' in defInfo && 'line' in defInfo) {
						const info = defInfo as { filePath: string; line: number; column?: number };
						this.definitions.set(typeName, {
							filePath: info.filePath,
							line: info.line,
							column: info.column || 0
						});
	
						// Create mnemonica instance for tracking if models available
						if (DefinitionEntry) {
							try {
								new DefinitionEntry({
									id: `${typeName}:${info.filePath}:${info.line}`,
									name: typeName,
									filePath: info.filePath,
									line: info.line,
									column: info.column || 0
								});
							} catch (err) {
								// Instance creation failed, but we still have the definition
								this.logger.debug('DefinitionEntry creation skipped for:', typeName);
							}
						}
					}
				}

			this.logger.info(`Loaded ${this.definitions.size} definitions`);
		} catch (error) {
			this.logger.error('Failed to load definitions:', error);
		}
	}

	provideDefinition (
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken
	): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) return null;

		const word = document.getText(wordRange);
		const logger = getLogger();

		logger.debug(`Looking up definition for: ${word}`);

		// Try exact match first
		let defInfo = this.definitions.get(word);

		// Try with different prefixes/suffixes for nested types
		if (!defInfo) {
			// Check if word is part of a type path (e.g., "User" in "User.Admin")
			const lineText = document.lineAt(position.line).text;
			const typeMatch = this.extractTypeFromContext(lineText, position.character, word);
			if (typeMatch) {
				defInfo = this.definitions.get(typeMatch);
			}
		}

		if (!defInfo) {
			logger.debug(`No definition found for: ${word}`);
			return null;
		}

		// Resolve relative paths
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
		let filePath = defInfo.filePath;
		if (workspaceFolder && !path.isAbsolute(filePath)) {
			filePath = path.join(workspaceFolder.uri.fsPath, filePath);
		}

		logger.debug(`Found definition at: ${filePath}:${defInfo.line}`);

		const uri = vscode.Uri.file(filePath);
		const pos = new vscode.Position(defInfo.line - 1, defInfo.column);

		return new vscode.Location(uri, pos);
	}

	private extractTypeFromContext (lineText: string, charPos: number, _word: string): string | null {
		// Check for property access pattern (UserType.SubType)
		const beforeCursor = lineText.substring(0, charPos);

		// Look for prefix pattern (e.g., "Parent.Child" where cursor is on "Child")
		const prefixMatch = beforeCursor.match(/([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*)\.[A-Za-z0-9_]*$/);
		if (prefixMatch) {
			const fullPath = prefixMatch[1];
			// Try the full path first
			if (this.definitions.has(fullPath)) {
				return fullPath;
			}
		}

		return null;
	}

	clear (): void {
		this.definitions.clear();
	}

	getStats (): { count: number } {
		return { count: this.definitions.size };
	}
}
