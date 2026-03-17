'use strict';

import * as fs from 'fs';
import { define } from 'mnemonica';
import { getLogger } from '../services/LoggerService';

export type definitionEntry = {
	name: string;
	location: string;
	kind: string;
	parent: string | null;
	strictChain: boolean;
	blockErrors: boolean;
};

export type DefinitionEntryInstance = InstanceType<typeof DefinitionEntry>;

export const Definitions = define('Definitions', class {
	createdAt: number;
	private map: Map<string, DefinitionEntryInstance> = new Map();
	private logger = getLogger();

	constructor () {
		this.createdAt = Date.now();
		this.logger.info(`[Definitions] : constructed at ${this.createdAt}`);
	}

	get size () {
		return this.map.size;
	}

	get (name: string): DefinitionEntryInstance | undefined {
		this.logger.info('Definitions keys: ', ...this.map.keys());
		this.logger.info('Definitions size: ', this.map.size);
		return this.map.get(name);
	}

	has (name: string): boolean {
		return this.map.has(name);
	}

	set (name: string, entry: DefinitionEntryInstance): void {
		this.map.set(name, entry);
	}

	keys (): MapIterator<string> {
		return this.map.keys() as unknown as MapIterator<string>;
	}

	values (): MapIterator<DefinitionEntryInstance> {
		return this.map.values() as unknown as MapIterator<DefinitionEntryInstance>;
	}

	clear (): void {
		return this.map.clear();
	}

	async loadFromFile (filePath: string): Promise<void> {
		this.logger.info(`[Definitions] : loading from ${filePath}`);
		try {
			const content = fs.readFileSync(filePath, 'utf-8');
			const data = JSON.parse(content);
			
			if (data.definitions) {
				for (const [key, value] of Object.entries(data.definitions)) {
					const entry = new (this as unknown as { DefinitionEntry: typeof DefinitionEntry }).DefinitionEntry(value as definitionEntry);
					this.map.set(key, entry);
				}
			}
			
			this.logger.info(`[Definitions] : loaded ${this.map.size} definitions`);
		} catch (error) {
			this.logger.error(`[Definitions] : failed to load from ${filePath}`, error);
			throw error;
		}
	}
});

const setProps = (to: object, from: object) => {
	Object.defineProperties(to, Object.getOwnPropertyDescriptors(from));
};

export const DefinitionEntry = Definitions.define('DefinitionEntry', function (
	this: definitionEntry,
	data: definitionEntry
) {
	setProps(this, data);
});

export default Definitions;
