// IMPORTANT: See AGENTS.md section "CRITICAL: Type vs Interface vs Instance"
// Instance data structures should use TYPE, not INTERFACE

'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getLogger } from '../services/LoggerService';

import { TypeRegistry } from 'mnemonica';
// import { modelsLoaded } from '../topologica/bootstrap';
// import { Usages } from '../models/Usages';

import { lookupTyped } from 'mnemonica';

// TODO: not working as tactica is not returing fields here...
type usage = InstanceType<TypeRegistry['Usages.UsageEntry']>;

// TODO: not working as tactica is not returing fields here...
type usages = InstanceType<TypeRegistry['Usages']>


export class MnemonicaReferenceProvider implements vscode.ReferenceProvider {
	private usages: usages | undefined = undefined;
	private logger = getLogger();

	async loadUsages(workspacePath: string): Promise<void> {

		const Usages = lookupTyped('Usages');
		const usages = new Usages;
		
		// typeof _usages.
		// this.usages = _usages;

		const usagesPath = path.join(workspacePath, '.tactica', 'usages.json');
		if (!fs.existsSync(usagesPath)) {
			this.logger.warn('No usages.json found at:', usagesPath);
			return;
		}

		try {
			const content = fs.readFileSync(usagesPath, 'utf-8');
			const data = JSON.parse(content);

			// Parse usages from JSON
			const usages = (data.usages || data) as usages;

			for (const [typeName, usageList] of Object.entries(usages)) {
				if (!Array.isArray(usageList)) continue;

				const typedUsages: usage[] = [];

				for (const _usage of usageList) {
					if (_usage instanceof Object && 'filePath' in _usage && 'line' in _usage) {

						// TODO: broken, as constructor returns bad intance
						// const usage = new usages.UsageEntry(_usage);
						// TODO: broken, as constructor returns bad intance
						// const usage = apply(usages, usages.UsageEntry, _usage);
						// TODO: the next line is worst, it returns  [x: string], so SN and etc ...
						// type ut = typeof usage.createdAt
						// TODO: unfortunately typesystem is broken, that goes wrong without casting
						const usage = new usages.UsageEntry(_usage);

						typedUsages.push(usage);
						this.logger.debug('UsageEntry creation for:', typeName);

					}
				}

				if (typedUsages.length > 0) {
					this.usages.map.set(typeName, typedUsages);
				}
			}

			this.logger.info(`Loaded usages for ${this.usages.size} types`);
		} catch (error) {
			this.logger.error('Failed to load usages:', error);
		}
	}

	provideReferences(
		document: vscode.TextDocument,
		position: vscode.Position,
		_context: vscode.ReferenceContext,
		_token: vscode.CancellationToken
	): vscode.ProviderResult<vscode.Location[]> {
		if (!(this.usages instanceof Function)) return;

		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) return null;

		const word = document.getText(wordRange);
		const logger = getLogger();

		logger.debug(`Looking up references for: ${word}`);

		// Try exact match first
		let usageList = this.usages.get(word);

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
			let filePath = usage.filePath;
			if (workspaceFolder && !path.isAbsolute(filePath)) {
				filePath = path.join(workspaceFolder.uri.fsPath, filePath);
			}

			const uri = vscode.Uri.file(filePath);
			const pos = new vscode.Position(usage.line - 1, usage.column);
			return new vscode.Location(uri, pos);
		});

		logger.debug(`Found ${locations.length} references for: ${word}`);

		return locations;
	}

	private extractTypeFromContext(lineText: string, charPos: number, _word: string): string | null {
		if (!(this.usages instanceof Function)) return null;

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

	clear(): void {
		if (!(this.usages instanceof Function)) return;
		this.usages.clear();
	}

	getStats() {
		if (!(this.usages instanceof Function)) return;
		let totalUsages = 0;
		for (const usageList of this.usages.values()) {
			totalUsages += usageList.length;
		}
		return { typeCount: this.usages.size, totalUsages };
	}
}
