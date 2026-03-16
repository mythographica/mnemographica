// IMPORTANT: See AGENTS.md section "CRITICAL: Type vs Interface vs Instance"
// Instance data structures should use TYPE, not INTERFACE

'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getLogger } from '../services/LoggerService';

import { TypeRegistry } from 'mnemonica';
import { modelsLoaded } from '../topologica/bootstrap';

import { lookupTyped } from 'mnemonica';

type usage = InstanceType<TypeRegistry['Usages.UsageEntry']>;
type usages = InstanceType<TypeRegistry['Usages']>


export class MnemonicaReferenceProvider implements vscode.ReferenceProvider {
	private usages: usages | undefined = undefined;
	private logger = getLogger();

	async loadUsages(workspacePath: string): Promise<void> {

		this.logger.info(`[Usages][modelsLoaded] : ${modelsLoaded}`);
		this.logger.info(`[Usages][lookupTyped] typeof ${lookupTyped}`);
		const Usages = lookupTyped('Usages');
		this.logger.info(`[Usages] typeof ${Usages}`);

		const usages = new Usages;
		usages.createdAt;

		this.usages = usages;

		const usagesPath = path.join(workspacePath, '.tactica', 'usages.json');
		if (!fs.existsSync(usagesPath)) {
			this.logger.warn('No usages.json found at:', usagesPath);
			return;
		}

		try {
			const content = fs.readFileSync(usagesPath, 'utf-8');
			const data = JSON.parse(content);

			type usage_from_file = {
				kind: string,
				code: string,
				location: string
			};

			// Parse usages from JSON
			const jsonUsages = data.usages as { [key: string]: usage_from_file[] };


			const entries = Object.entries(jsonUsages);

			for (const [typeName, usageList] of entries) {
				if (!Array.isArray(usageList)) continue;

				this.logger.info('loading usages for', typeName);


				const typedUsages: usage[] = [];

				for (const _usage of usageList) {

					const pushed = Object.assign({
						typeName,
					}, _usage);

					const usage = new usages.UsageEntry(pushed);

					typedUsages.push(usage);
					this.logger.debug('UsageEntry creation for:', typeName, JSON.stringify(usage));

				}

				if (typedUsages.length > 0) {
					this.usages.set(typeName, typedUsages);
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

		if (!this.usages) return null;

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

	getUsagesForType(typeName: string): Array<{ filePath: string; line: number; column: number; context?: string }> {
		this.logger.info('getUsagesForType: 165')
		if (!(this.usages?.get instanceof Function)) return [];
		this.logger.info('getUsagesForType: 167')

		const usageList = this.usages.get(typeName.replace('_', '.'));
		this.logger.info('getUsagesForType: 170: ', typeName, Array.isArray(usageList), typeof usageList);
		if (!usageList) return [];
		this.logger.info('getUsagesForType: 172');

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
