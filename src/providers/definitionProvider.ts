import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getLogger } from '../services/LoggerService';

const logger = getLogger();

/**
 * Find .tactica directory by walking up from the given file path
 */
function findTacticaDir(startPath: string): string | undefined {
	let currentDir = path.dirname(startPath);
	const root = path.parse(currentDir).root;

	while (currentDir !== root) {
		const tacticaPath = path.join(currentDir, '.tactica');
		if (fs.existsSync(tacticaPath) && fs.statSync(tacticaPath).isDirectory()) {
			return tacticaPath;
		}
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			break;
		}
		currentDir = parentDir;
	}

	return undefined;
}

/**
 * VS Code DefinitionProvider for mnemonica's lookupTyped() calls
 * Enables Go to Definition (Ctrl+Click/F12) on type paths in lookupTyped('TypeName')
 */
export class MnemonicaDefinitionProvider implements vscode.DefinitionProvider {
	private definitionsCache: Map<string, Map<string, { filePath: string; line: number; column: number }>> = new Map();

	/**
	 * Load definitions from .tactica/definitions.json for the given file
	 */
	private loadDefinitionsForFile(filePath: string): Map<string, { filePath: string; line: number; column: number }> {
		// Check cache first
		if (this.definitionsCache.has(filePath)) {
			return this.definitionsCache.get(filePath)!;
		}

		// Find .tactica directory by walking up from the file
		const tacticaDir = findTacticaDir(filePath);
		if (!tacticaDir) {
			logger.info(`[DefinitionProvider] No .tactica directory found for ${filePath}`);
			return new Map();
		}

		const definitionsPath = path.join(tacticaDir, 'definitions.json');
		if (!fs.existsSync(definitionsPath)) {
			logger.info(`[DefinitionProvider] No definitions.json found at ${definitionsPath}`);
			return new Map();
		}

		const definitionsMap = new Map<string, { filePath: string; line: number; column: number }>();

		try {
			const content = fs.readFileSync(definitionsPath, 'utf-8');
			const data = JSON.parse(content);
			if (data.definitions) {
				for (const [typePath, def] of Object.entries(data.definitions)) {
					const { location } = def as { location: string };
					// Parse location format: file.ts:line:column
					const match = location.match(/^(.+):(\d+):(\d+)$/);
					if (match) {
						const filePathFromLoc = match[1];
						// Handle both absolute and relative paths
						const resolvedPath = path.isAbsolute(filePathFromLoc)
							? filePathFromLoc
							: path.join(path.dirname(tacticaDir), filePathFromLoc);
						definitionsMap.set(typePath, {
							filePath: resolvedPath,
							line: parseInt(match[2], 10),
							column: parseInt(match[3], 10),
						});
					}
				}
			}
			logger.info(`[DefinitionProvider] Loaded ${definitionsMap.size} definitions from ${definitionsPath}`);
			// Debug: log first few definitions
			const entries = Array.from(definitionsMap.entries()).slice(0, 5);
			for (const [key, value] of entries) {
				logger.info(`[DefinitionProvider]   ${key} -> ${value.filePath}:${value.line}:${value.column}`);
			}
		} catch (err) {
			logger.error('[DefinitionProvider] Failed to load definitions:', err);
		}

		// Cache the result
		this.definitionsCache.set(filePath, definitionsMap);
		return definitionsMap;
	}

	/**
	 * Provide definition for lookupTyped('TypeName') calls
	 */
	public provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken
	): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
		logger.info(`[DefinitionProvider] provideDefinition called at ${document.fileName}:${position.line}:${position.character}`);

		// Get the word range at position
		const wordRange = document.getWordRangeAtPosition(position, /['"`][^'"`]*['"`]/);
		if (!wordRange) {
			logger.info('[DefinitionProvider] No string literal at position');
			return null;
		}

		// Extract the string content
		const text = document.getText(wordRange);
		const typePath = text.slice(1, -1); // Remove quotes
		logger.info(`[DefinitionProvider] String literal: ${text}, typePath: ${typePath}`);

		// Check if this is inside a lookupTyped call
		if (!this.isInsideLookupTyped(document, position)) {
			logger.info('[DefinitionProvider] Not inside lookupTyped call');
			return null;
		}

		// Load definitions for this file (walk up to find .tactica)
		const definitionsMap = this.loadDefinitionsForFile(document.fileName);

		// Look up the definition
		const definition = definitionsMap.get(typePath);
		if (!definition) {
			logger.info(`[DefinitionProvider] No definition found for ${typePath}`);
			return null;
		}

		logger.info(`[DefinitionProvider] Found definition: ${definition.filePath}:${definition.line}:${definition.column}`);

		// Create location
		const uri = vscode.Uri.file(definition.filePath);
		const pos = new vscode.Position(definition.line - 1, definition.column - 1); // 0-based
		return new vscode.Location(uri, pos);
	}

	/**
	 * Check if the position is inside a lookupTyped() call
	 */
	private isInsideLookupTyped(document: vscode.TextDocument, position: vscode.Position): boolean {
		// Get the line text up to the cursor position
		const lineText = document.lineAt(position.line).text;
		const textBeforeCursor = lineText.substring(0, position.character);

		logger.info(`[DefinitionProvider] Checking line: ${lineText}`);

		// Simple heuristic: check if lookupTyped( appears before the cursor
		// and there's no closing paren after it (we're inside the call)
		const lookupTypedIndex = textBeforeCursor.lastIndexOf('lookupTyped');
		if (lookupTypedIndex === -1) {
			return false;
		}

		// Check if there's an opening paren after lookupTyped
		const afterLookupTyped = textBeforeCursor.substring(lookupTypedIndex + 'lookupTyped'.length);
		if (!afterLookupTyped.trim().startsWith('(')) {
			return false;
		}

		logger.info('[DefinitionProvider] Inside lookupTyped call');
		return true;
	}

	/**
	 * Clear cache (call when .tactica/definitions.json changes)
	 */
	public clearCache(): void {
		this.definitionsCache.clear();
	}
}
