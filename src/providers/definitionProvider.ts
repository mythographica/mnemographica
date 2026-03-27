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
 * VS Code DefinitionProvider for mnemonica types
 * Enables Go to Definition (Ctrl+Click/F12) on:
 * 1. Type paths in lookupTyped('TypeName') calls
 * 2. Type references that would navigate to generated .tactica/types.ts
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
			return new Map();
		}

		const definitionsPath = path.join(tacticaDir, 'definitions.json');
		if (!fs.existsSync(definitionsPath)) {
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
			logger.info(`[DefinitionProvider] Loaded ${definitionsMap.size} definitions`);
		} catch (err) {
			logger.error('[DefinitionProvider] Failed to load definitions:', err);
		}

		// Cache the result
		this.definitionsCache.set(filePath, definitionsMap);
		return definitionsMap;
	}

	/**
	 * Convert instance type name to full type path
	 * e.g., "Sentience_Memory" -> "Sentience.Memory"
	 * e.g., "RootAsync_ResultFromDecorate" -> "RootAsync.ResultFromDecorate"
	 */
	private instanceTypeNameToPath(typeName: string): string | undefined {
		// Split by underscore and join with dots
		// Handle nested types like Sentience_Consciousness_Curiosity
		return typeName.replace(/_/g, '.');
	}

	/**
	 * Provide definition for various mnemonica type references
	 */
	public provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken
	): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
		logger.info(`[DefinitionProvider] Called at ${document.fileName}:${position.line}:${position.character}`);

		// Case 1: Check if this is inside a lookupTyped('TypeName') call
		const lookupTypedResult = this.handleLookupTyped(document, position);
		if (lookupTypedResult) {
			return lookupTypedResult;
		}

		// Case 2: Check if this is a type reference in .tactica/types.ts
		if (document.fileName.includes('.tactica/types.ts')) {
			const typeRefResult = this.handleTypeReferenceInGeneratedTypes(document, position);
			if (typeRefResult) {
				return typeRefResult;
			}
		}

		// Case 3: Check if this is any type reference that might map to a mnemonica type
		const generalTypeResult = this.handleGeneralTypeReference(document, position);
		if (generalTypeResult) {
			return generalTypeResult;
		}

		return null;
	}

	/**
	 * Handle lookupTyped('TypeName') calls
	 */
	private handleLookupTyped(
		document: vscode.TextDocument,
		position: vscode.Position
	): vscode.Location | null {
		// Get the word range at position
		const wordRange = document.getWordRangeAtPosition(position, /['"`][^'"`]*['"`]/);
		if (!wordRange) {
			return null;
		}

		// Extract the string content
		const text = document.getText(wordRange);
		const typePath = text.slice(1, -1); // Remove quotes

		// Check if this is inside a lookupTyped call
		if (!this.isInsideLookupTyped(document, position)) {
			return null;
		}

		logger.info(`[DefinitionProvider] lookupTyped: ${typePath}`);

		// Load definitions for this file
		const definitionsMap = this.loadDefinitionsForFile(document.fileName);

		// Look up the definition
		const definition = definitionsMap.get(typePath);
		if (!definition) {
			logger.info(`[DefinitionProvider] No definition for ${typePath}`);
			return null;
		}

		logger.info(`[DefinitionProvider] Found: ${definition.filePath}:${definition.line}:${definition.column}`);

		// Create location
		const uri = vscode.Uri.file(definition.filePath);
		const pos = new vscode.Position(definition.line - 1, definition.column - 1); // 0-based
		return new vscode.Location(uri, pos);
	}

	/**
	 * Handle type references in generated .tactica/types.ts file
	 * Redirects to actual source definition
	 */
	private handleTypeReferenceInGeneratedTypes(
		document: vscode.TextDocument,
		position: vscode.Position
	): vscode.Location | null {
		// Get the word at position
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return null;
		}

		const typeName = document.getText(wordRange);
		logger.info(`[DefinitionProvider] Type reference in types.ts: ${typeName}`);

		// Convert instance type name to full path
		const typePath = this.instanceTypeNameToPath(typeName);
		if (!typePath) {
			return null;
		}

		// Load definitions
		const definitionsMap = this.loadDefinitionsForFile(document.fileName);

		// Try to find the definition
		const definition = definitionsMap.get(typePath);
		if (!definition) {
			logger.info(`[DefinitionProvider] No definition for ${typePath}`);
			return null;
		}

		logger.info(`[DefinitionProvider] Redirecting to: ${definition.filePath}:${definition.line}:${definition.column}`);

		// Create location
		const uri = vscode.Uri.file(definition.filePath);
		const pos = new vscode.Position(definition.line - 1, definition.column - 1); // 0-based
		return new vscode.Location(uri, pos);
	}

	/**
	 * Handle general type references that might be mnemonica types
	 */
	private handleGeneralTypeReference(
		document: vscode.TextDocument,
		position: vscode.Position
	): vscode.Location | null {
		// Get the word at position
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return null;
		}

		const typeName = document.getText(wordRange);
		logger.info(`[DefinitionProvider] Checking word: ${typeName}`);

		// Load definitions
		const definitionsMap = this.loadDefinitionsForFile(document.fileName);
		if (definitionsMap.size === 0) {
			return null;
		}

		// Try 1: Check if it looks like an instance type (contains underscores)
		// e.g., Sentience_Memory, RootAsync_ResultFromDecorate
		if (typeName.includes('_')) {
			const typePath = this.instanceTypeNameToPath(typeName);
			if (typePath) {
				const definition = definitionsMap.get(typePath);
				if (definition) {
					logger.info(`[DefinitionProvider] Found instance type: ${typePath}`);
					const uri = vscode.Uri.file(definition.filePath);
					const pos = new vscode.Position(definition.line - 1, definition.column - 1);
					return new vscode.Location(uri, pos);
				}
			}
		}

		// Try 2: Check if it's a simple type name that exists in definitions
		// e.g., ResultFromDecorate might be in definitions as RootAsync.ResultFromDecorate
		for (const [typePath, definition] of definitionsMap) {
			// Check if the typePath ends with the typeName
			if (typePath.endsWith(`.${typeName}`) || typePath === typeName) {
				logger.info(`[DefinitionProvider] Found nested type: ${typePath}`);
				const uri = vscode.Uri.file(definition.filePath);
				const pos = new vscode.Position(definition.line - 1, definition.column - 1);
				return new vscode.Location(uri, pos);
			}
		}

		return null;
	}

	/**
	 * Check if the position is inside a lookupTyped() call
	 */
	private isInsideLookupTyped(document: vscode.TextDocument, position: vscode.Position): boolean {
		// Get the line text up to the cursor position
		const lineText = document.lineAt(position.line).text;
		const textBeforeCursor = lineText.substring(0, position.character);

		// Simple heuristic: check if lookupTyped( appears before the cursor
		const lookupTypedIndex = textBeforeCursor.lastIndexOf('lookupTyped');
		if (lookupTypedIndex === -1) {
			return false;
		}

		// Check if there's an opening paren after lookupTyped
		const afterLookupTyped = textBeforeCursor.substring(lookupTypedIndex + 'lookupTyped'.length);
		return afterLookupTyped.trim().startsWith('(');
	}

	/**
	 * Clear cache (call when .tactica/definitions.json changes)
	 */
	public clearCache(): void {
		this.definitionsCache.clear();
	}
}
