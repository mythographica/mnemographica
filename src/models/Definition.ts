'use strict';


import { define } from 'mnemonica';
import { getLogger } from '../services/LoggerService';

export type rawDefinitionEntry = {
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

	entries (): MapIterator<[string, DefinitionEntryInstance]> {
		return this.map.entries() as unknown as MapIterator<[string, DefinitionEntryInstance]>;
	}

	clear (): void {
		return this.map.clear();
	}

	// Note: loadFromFile action moved to Registry - Definitions is pure data container
});

const setProps = (to: object, from: object) => {
	Object.defineProperties(to, Object.getOwnPropertyDescriptors(from));
};

export const DefinitionEntry = Definitions.define('DefinitionEntry', function (
	this: rawDefinitionEntry,
	data: rawDefinitionEntry
) {
	setProps(this, data);
});

export default Definitions;
