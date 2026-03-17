'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { define, lookupTyped } from 'mnemonica';
import { getLogger } from '../services/LoggerService';
import type { Definitions, Types, Usages, Trie } from '~tactica/types';

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
	private trieInstance: Trie | undefined;

	// Workspace path for reload operations
	private workspacePath: string | undefined;

	constructor () {
		this.createdAt = Date.now();
		this.logger.info(`[Registry] : constructed at ${this.createdAt}`);
	}

	get size () {
		return this.map.size;
	}

	get (name: string): object | undefined {
		return this.map.get(name);
	}

	has (name: string): boolean {
		return this.map.has(name);
	}

	set (name: string, entry: object): void {
		this.map.set(name, entry);
	}

	keys (): MapIterator<string> {
		return this.map.keys() as unknown as MapIterator<string>;
	}

	values (): MapIterator<object> {
		return this.map.values() as unknown as MapIterator<object>;
	}

	clear (): void {
		this.map.clear();
		this.definitionsInstance = undefined;
		this.typesInstance = undefined;
		this.usagesInstance = undefined;
		this.trieInstance = undefined;
		this.workspacePath = undefined;
		this.logger.info('[Registry] : cleared all data');
	}

	/**
	 * Load all models from the .tactica/ directory in the workspace
	 */
	async loadFromWorkspace (workspacePath: string): Promise<void> {
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

			// Initialize Trie (no file to load, just create instance)
			await this.loadTrie();

			this.logger.info('[Registry] : all models loaded successfully');
		} catch (error) {
			this.logger.error('[Registry] : failed to load models', error);
			throw error;
		}
	}

	/**
	 * Load Definitions from definitions.json using lookupTyped
	 */
	private async loadDefinitions (tacticaPath: string): Promise<void> {
		this.logger.info('[Registry] : loading Definitions');

		try {
			const DefinitionsConstructor = lookupTyped('Definitions');
			this.definitionsInstance = new DefinitionsConstructor();

			const definitionsPath = path.join(tacticaPath, 'definitions.json');
			if (fs.existsSync(definitionsPath)) {
				await this.definitionsInstance.loadFromFile(definitionsPath);
				this.logger.info(`[Registry] : Definitions loaded with ${this.definitionsInstance.size} entries`);
			} else {
				this.logger.warn(`[Registry] : definitions.json not found at ${definitionsPath}`);
			}
		} catch (error) {
			this.logger.error('[Registry] : failed to load Definitions', error);
			throw error;
		}
	}

	/**
	 * Load Types from types.ts using lookupTyped
	 */
	private async loadTypes (tacticaPath: string): Promise<void> {
		this.logger.info('[Registry] : loading Types');

		try {
			const TypesConstructor = lookupTyped('Types');
			this.typesInstance = new TypesConstructor();

			const typesPath = path.join(tacticaPath, 'types.ts');
			if (fs.existsSync(typesPath)) {
				await this.typesInstance.loadFromFile(typesPath);
				this.logger.info(`[Registry] : Types loaded with ${this.typesInstance.size} entries`);
			} else {
				this.logger.warn(`[Registry] : types.ts not found at ${typesPath}`);
			}
		} catch (error) {
			this.logger.error('[Registry] : failed to load Types', error);
			throw error;
		}
	}

	/**
	 * Load Usages from usages.json using lookupTyped
	 */
	private async loadUsages (tacticaPath: string): Promise<void> {
		this.logger.info('[Registry] : loading Usages');

		try {
			const UsagesConstructor = lookupTyped('Usages');
			this.usagesInstance = new UsagesConstructor();

			// Note: Usages doesn't have loadFromFile, we need to populate it manually
			const usagesPath = path.join(tacticaPath, 'usages.json');
			if (fs.existsSync(usagesPath)) {
				const content = fs.readFileSync(usagesPath, 'utf-8');
				const data = JSON.parse(content);

				if (data.usages) {
					for (const [key, value] of Object.entries(data.usages)) {
						this.usagesInstance.set(key, value as never[]);
					}
				}
				this.logger.info(`[Registry] : Usages loaded with ${this.usagesInstance.size} entries`);
			} else {
				this.logger.warn(`[Registry] : usages.json not found at ${usagesPath}`);
			}
		} catch (error) {
			this.logger.error('[Registry] : failed to load Usages', error);
			throw error;
		}
	}

	/**
	 * Initialize Trie using lookupTyped
	 */
	private async loadTrie (): Promise<void> {
		this.logger.info('[Registry] : loading Trie');

		try {
			const TrieConstructor = lookupTyped('Trie');
			this.trieInstance = new TrieConstructor();
			this.logger.info('[Registry] : Trie initialized');
		} catch (error) {
			this.logger.error('[Registry] : failed to load Trie', error);
			throw error;
		}
	}

	/**
	 * Get the Definitions instance
	 */
	getDefinitions (): Definitions | undefined {
		return this.definitionsInstance;
	}

	/**
	 * Get the Types instance
	 */
	getTypes (): Types | undefined {
		return this.typesInstance;
	}

	/**
	 * Get the Usages instance
	 */
	getUsages (): Usages | undefined {
		return this.usagesInstance;
	}

	/**
	 * Get the Trie instance
	 */
	getTrie (): Trie | undefined {
		return this.trieInstance;
	}

	/**
	 * Refresh all models by reloading from workspace
	 */
	async refresh (): Promise<void> {
		if (!this.workspacePath) {
			this.logger.warn('[Registry] : cannot refresh, no workspace path set');
			return;
		}

		this.logger.info('[Registry] : refreshing all models');
		this.clear();
		await this.loadFromWorkspace(this.workspacePath);
		this.logger.info('[Registry] : refresh complete');
	}
});

const setProps = (to: object, from: object) => {
	Object.defineProperties(to, Object.getOwnPropertyDescriptors(from));
};

export const DefinitionEntry = Registry.define('DefinitionEntry', function (
	this: registryEntry,
	data: registryEntry
) {
	setProps(this, data);
});

// Export singleton instance
export const registry = new Registry();

export default Registry;
