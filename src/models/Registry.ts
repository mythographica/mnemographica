'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { define, lookupTyped } from 'mnemonica';
import { getLogger } from '../services/LoggerService';
import type { Definitions, Types, Usages, Trie } from '~tactica/types';
import type { EDS } from './EDS';

import type { rawDefinitionEntry } from './Definition';
import type { rawTypeEntry } from './Types';
import type { rawEDSEntry } from './EDS';

export type registryEntry = {
	id: string;
	name: string;
	filePath: string;
	line: number;
	column: number;
};

export const Registry = define('Registry', class {
	createdAt: number;
	private map: Map<string, object> = new Map();
	private logger = getLogger();

	// Model instances
	private definitionsInstance: Definitions | undefined;
	private typesInstance: Types | undefined;
	private usagesInstance: Usages | undefined;
	private edsInstance: InstanceType<typeof EDS> | undefined;
	private trieInstance: Trie | undefined;

	// Workspace path for reload operations
	private workspacePath: string | undefined;

	makeProperty(name: string, value: unknown) {
		Object.defineProperty(this, name, {
			get() {
				return value;
			},
			configurable: true,
			enumerable: true
		});
	}


	constructor() {
		this.createdAt = Date.now();
		this.logger.info(`[Registry] : constructed at ${this.createdAt}`);
	}

	get size() {
		return this.map.size;
	}

	get(name: string): object | undefined {
		return this.map.get(name);
	}

	has(name: string): boolean {
		return this.map.has(name);
	}

	set(name: string, entry: object): void {
		this.map.set(name, entry);
	}

	keys(): MapIterator<string> {
		return this.map.keys() as unknown as MapIterator<string>;
	}

	values(): MapIterator<object> {
		return this.map.values() as unknown as MapIterator<object>;
	}

	clear(): void {
		this.map.clear();
		this.definitionsInstance = undefined;
		this.typesInstance = undefined;
		this.usagesInstance = undefined;
		this.edsInstance = undefined;
		this.trieInstance = undefined;
		this.workspacePath = undefined;
		this.logger.info('[Registry] : cleared all data');
	}

	/**
	 * Load all models from the .tactica/ directory in the workspace
	 */
	async loadFromWorkspace(workspacePath: string): Promise<void> {
		this.workspacePath = workspacePath;
		const tacticaPath = path.join(workspacePath, '.tactica');

		this.logger.info(`[Registry] : loading from workspace ${workspacePath}`);
		this.logger.info(`[Registry] : .tactica path ${tacticaPath}`);

		// Verify .tactica directory exists
		if (!fs.existsSync(tacticaPath)) {
			this.logger.warn(`[Registry] : .tactica directory not found at ${tacticaPath}`);
			return;
		}

		try {
			// Load Definitions
			await this.loadDefinitions(tacticaPath);

			// Load Types
			await this.loadTypes(tacticaPath);

			// Load Usages
			await this.loadUsages(tacticaPath);

			// Load EDS
			await this.loadEDS(tacticaPath);

			// Initialize Trie (no file to load, just create instance)
			await this.loadTrie();

			this.logger.info('[Registry] : all models loaded successfully');
		} catch (error) {
			this.logger.error('[Registry] : failed to load models',
				(error as unknown as InstanceType<typeof Error>).stack);
			throw error;
		}
	}

	/**
	 * Load Definitions from definitions.json using lookupTyped
	 */
	private async loadDefinitions(tacticaPath: string): Promise<void> {
		this.logger.info('[Registry] : loading Definitions');

		try {
			const DefinitionsConstructor = lookupTyped('Definitions');
			const definitionsInstance = new DefinitionsConstructor();
			this.makeProperty('definitionsInstance', definitionsInstance);

			const definitionsPath = path.join(tacticaPath, 'definitions.json');
			if (fs.existsSync(definitionsPath)) {
				const content = fs.readFileSync(definitionsPath, 'utf-8');
				const data = JSON.parse(content);
				if (data.definitions) {
					for (const [key, value] of Object.entries(data.definitions)) {
						try {
							const entry = new definitionsInstance.DefinitionEntry(value as rawDefinitionEntry);
							definitionsInstance.set(key, entry);
						} catch (error) {
							const { stack } = error as unknown as InstanceType<typeof Error>;
							this.logger.error(stack as string);
						}
					}
				}
				this.logger.info(`[Registry] : Definitions loaded with ${definitionsInstance.size} entries`);
			} else {
				this.logger.warn(`[Registry] : definitions.json not found at ${definitionsPath}`);
			}
		} catch (error) {
			this.logger.error('[Registry] : failed to load Definitions',
				(error as unknown as InstanceType<typeof Error>).stack);
			throw error;
		}
	}

	/**
	 * Load Types from types.ts using lookupTyped
	 */
	private async loadTypes(tacticaPath: string): Promise<void> {
		this.logger.info('[Registry] : loading Types');

		try {
			const TypesConstructor = lookupTyped('Types');
			const typesInstance = new TypesConstructor();
			this.makeProperty('typesInstance', typesInstance);

			const typesPath = path.join(tacticaPath, 'types.ts');
			if (fs.existsSync(typesPath)) {
				const content = fs.readFileSync(typesPath, 'utf-8');
				const lines = content.split('\n');

				// Parse: export type TypeName = ProtoFlat<Parent, { ... }>
				// OR: export type TypeName = Parent & { ... }
				// OR: export type TypeName = { ... } (root types, no parent)
				const typeRegex = /export\s+type\s+(\w+)\s*=\s*(?:(?:ProtoFlat<(\w+),)|(?:(\w+)\s*&))?[\s\n]*\{/;

				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					const match = typeRegex.exec(line);
					if (match) {
						const name = match[1];
						let parent: string | undefined;

						if (match[2]) {
							// ProtoFlat<Parent, ...> - match[2] is the parent
							parent = match[2];
						} else if (match[3]) {
							// Parent & { ... } - match[3] is the parent
							parent = match[3];
						}

						// Validate: if parent equals name, it's self-referential (bug)
						if (parent === name) {
							this.logger.warn(`[Registry] : Skipping self-referential type ${name} at line ${i + 1}`);
							continue;
						}

						try {
							const entry = new typesInstance.TypeEntry({
								name,
								fullPath: typesPath,
								parent,
								properties: new Map(),
								lineNumber: i
							} as rawTypeEntry);
							typesInstance.set(name, entry);
						} catch (error) {
							const { stack } = error as unknown as InstanceType<typeof Error>;
							this.logger.error(stack as string);
						}

					}
				}

				this.logger.info(`[Registry] : Types loaded with ${typesInstance.size} entries`);
			} else {
				this.logger.warn(`[Registry] : types.ts not found at ${typesPath}`);
			}
		} catch (error) {
			this.logger.error('[Registry] : failed to load Types',
				(error as unknown as InstanceType<typeof Error>).stack);
			throw error;
		}
	}

	/**
	 * Load Usages from usages.json using lookupTyped
	 */
	private async loadUsages(tacticaPath: string): Promise<void> {
		this.logger.info('[Registry] : loading Usages');

		try {
			const UsagesConstructor = lookupTyped('Usages');
			const usagesInstance = new UsagesConstructor();
			this.makeProperty('usagesInstance', usagesInstance);

			// Note: Usages doesn't have loadFromFile, we need to populate it manually
			const usagesPath = path.join(tacticaPath, 'usages.json');
			if (fs.existsSync(usagesPath)) {
				const content = fs.readFileSync(usagesPath, 'utf-8');
				const data = JSON.parse(content);

				if (data.usages) {
					for (const [key, value] of Object.entries(data.usages)) {
						usagesInstance.set(key, value as never[]);
					}
				}
				this.logger.info(`[Registry] : Usages loaded with ${usagesInstance.size} entries`);
			} else {
				this.logger.warn(`[Registry] : usages.json not found at ${usagesPath}`);
			}
		} catch (error) {
			this.logger.error('[Registry] : failed to load Usages', error);
			throw error;
		}
	}

	/**
	 * Load EDS from eds.json using lookupTyped
	 */
	private async loadEDS(tacticaPath: string): Promise<void> {
		this.logger.info('[Registry] : loading EDS');

		try {
			const EDSConstructor = lookupTyped('EDS');
			const edsInstance = new EDSConstructor();
			this.makeProperty('edsInstance', edsInstance);

			const edsPath = path.join(tacticaPath, 'eds.json');
			if (fs.existsSync(edsPath)) {
				const content = fs.readFileSync(edsPath, 'utf-8');
				const data = JSON.parse(content);

				if (data.eds) {
					for (const [key, value] of Object.entries(data.eds)) {
						const entries = (value as rawEDSEntry[]).map((e: rawEDSEntry) => {
							return new edsInstance.EDSEntry(e);
						});
						edsInstance.set(key, entries);
					}
				}
				this.logger.info(`[Registry] : EDS loaded with ${edsInstance.size} entries`);
			} else {
				this.logger.warn(`[Registry] : eds.json not found at ${edsPath}`);
			}
		} catch (error) {
			this.logger.error('[Registry] : failed to load EDS', error);
			throw error;
		}
	}

	/**
	 * Initialize Trie using lookupTyped
	 */
	private async loadTrie(): Promise<void> {
		this.logger.info('[Registry] : loading Trie');

		try {
			const TrieConstructor = lookupTyped('Trie');
			const trieInstance = new TrieConstructor();
			this.makeProperty('trieInstance', trieInstance);
			this.logger.info('[Registry] : Trie initialized');
		} catch (error) {
			this.logger.error('[Registry] : failed to load Trie', error);
			throw error;
		}
	}

	/**
	 * Get the Definitions instance
	 */
	getDefinitions(): Definitions | undefined {
		return this.definitionsInstance;
	}

	/**
	 * Get the Types instance
	 */
	getTypes(): Types | undefined {
		return this.typesInstance;
	}

	/**
	 * Get the Usages instance
	 */
	getUsages(): Usages | undefined {
		return this.usagesInstance;
	}

	/**
	 * Get the EDS instance
	 */
	getEDS(): InstanceType<typeof EDS> | undefined {
		return this.edsInstance;
	}

	/**
	 * Get the Trie instance
	 */
	getTrie(): Trie | undefined {
		return this.trieInstance;
	}

	/**
	 * Refresh all models by reloading from workspace
	 */
	async refresh(): Promise<void> {
		if (!this.workspacePath) {
			this.logger.warn('[Registry] : cannot refresh, no workspace path set');
			return;
		}

		this.logger.info('[Registry] : refreshing all models');
		// this.clear();
		await this.loadFromWorkspace(this.workspacePath);
		this.logger.info('[Registry] : refresh complete');
	}
});

const setProps = (to: object, from: object) => {
	Object.defineProperties(to, Object.getOwnPropertyDescriptors(from));
};

export const RegistryEntry = Registry.define('RegistryEntry', function (
	this: registryEntry,
	data: registryEntry
) {
	setProps(this, data);
});

// Export singleton instance
export const registry = new Registry();

export default Registry;
