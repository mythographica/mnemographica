import * as vscode from 'vscode';
import * as path from 'path';
import { getProjectRegistry } from '../core/registryStore';
import { parseTacticaLocation, tacticaRootOfFile } from '../utils/paths';

type definitionTarget = { filePath: string; line: number; column: number };

/**
 * VS Code DefinitionProvider for mnemonica types
 * Enables Go to Definition (Ctrl+Click/F12) on type paths in
 * lookup('TypeName') calls and on type identifiers. Navigation targets
 * are always the define() sites from definitions.json — never the
 * generated types.ts.
 */
export class MnemonicaDefinitionProvider implements vscode.DefinitionProvider {
	/**
	 * Definitions for the project the file belongs to, from the
	 * registryStore's loaded Registry — the store read and validated
	 * definitions.json once; nothing is read or cached per file here
	 */
	private async loadDefinitionsForFile(filePath: string): Promise<Map<string, definitionTarget>> {
		const definitionsMap = new Map<string, definitionTarget>();

		// Find the .tactica directory by walking up from the file
		const tacticaDir = tacticaRootOfFile(filePath);
		if (!tacticaDir) {
			return definitionsMap;
		}

		const registry = await getProjectRegistry(path.dirname(tacticaDir));
		const definitions = registry?.getDefinitions();
		if (!definitions) {
			return definitionsMap;
		}

		for (const [typePath, entry] of definitions.entries()) {
			// Locations are already absolute — the Registry path-resolves at load
			const parsed = parseTacticaLocation(entry.location);
			if (parsed) {
				definitionsMap.set(typePath, {
					filePath : parsed.fileName,
					line     : parsed.line,
					column   : parsed.column,
				});
			}
		}

		return definitionsMap;
	}

	/**
	 * Provide definition for various mnemonica type references
	 */
	public async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken
	): Promise<vscode.Definition | vscode.LocationLink[] | null> {
		// No per-request logging here: VS Code calls this on every
		// Ctrl+hover — per-request logging is pure noise. Detail is
		// reachable via the inspector when needed.

		const definitionsMap = await this.loadDefinitionsForFile(document.fileName);

		// Case 1: Check if this is inside a lookup('TypeName') call
		const lookupResult = this.handleLookup(document, position, definitionsMap);
		if (lookupResult) {
			return lookupResult;
		}

		// Case 2: Check if this is any type reference that might map to a mnemonica type
		const generalTypeResult = this.handleGeneralTypeReference(document, position, definitionsMap);
		if (generalTypeResult) {
			return generalTypeResult;
		}

		return null;
	}

	/**
	 * Handle lookup('TypeName') calls
	 */
	private handleLookup(
		document: vscode.TextDocument,
		position: vscode.Position,
		definitionsMap: Map<string, definitionTarget>
	): vscode.Location | null {
		// Get the word range at position
		const wordRange = document.getWordRangeAtPosition(position, /['"`][^'"`]*['"`]/);
		if (!wordRange) {
			return null;
		}

		// Extract the string content
		const text = document.getText(wordRange);
		const typePath = text.slice(1, -1); // Remove quotes

		// Check if this is inside a lookup call
		if (!this.isInsideLookup(document, position)) {
			return null;
		}

		// Look up the definition
		const definition = definitionsMap.get(typePath);
		if (!definition) {
			return null;
		}

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
		position: vscode.Position,
		definitionsMap: Map<string, definitionTarget>
	): vscode.Location | null {
		// Get the word at position
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return null;
		}

		const typeName = document.getText(wordRange);

		if (definitionsMap.size === 0) {
			return null;
		}

		// Try 1: instance-style alias (underscores = nesting):
		// Sentience_Memory → Sentience.Memory
		if (typeName.includes('_')) {
			const typePath = typeName.replace(/_/g, '.');
			const definition = definitionsMap.get(typePath);
			if (definition) {
				const uri = vscode.Uri.file(definition.filePath);
				const pos = new vscode.Position(definition.line - 1, definition.column - 1);
				return new vscode.Location(uri, pos);
			}
		}

		// Try 2: Check if it's a simple type name that exists in definitions
		// e.g., ResultFromDecorate might be in definitions as RootAsync.ResultFromDecorate
		for (const [typePath, definition] of definitionsMap) {
			// Check if the typePath ends with the typeName
			if (typePath.endsWith(`.${typeName}`) || typePath === typeName) {
				const uri = vscode.Uri.file(definition.filePath);
				const pos = new vscode.Position(definition.line - 1, definition.column - 1);
				return new vscode.Location(uri, pos);
			}
		}

		return null;
	}

	/**
	 * Check if the position is inside a lookup() call
	 */
	private isInsideLookup(document: vscode.TextDocument, position: vscode.Position): boolean {
		// Get the line text up to the cursor position
		const lineText = document.lineAt(position.line).text;
		const textBeforeCursor = lineText.substring(0, position.character);

		// Simple heuristic: check if lookup( appears before the cursor
		const lookupIndex = textBeforeCursor.lastIndexOf('lookup');
		if (lookupIndex === -1) {
			return false;
		}

		// Check if there's an opening paren after lookup
		const afterLookupTyped = textBeforeCursor.substring(lookupIndex + 'lookup'.length);
		return afterLookupTyped.trim().startsWith('(');
	}
}
