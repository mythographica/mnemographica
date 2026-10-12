'use strict';


import { Backend, setProps } from './collections';
import { getLogger } from '../services/LoggerService';

// One own field of a type (definitions.json `fields`), declaration order
export type rawDefinitionField = {
	name: string;
	type: string;
	optional: boolean;
};

// One constructor parameter (definitions.json `args`), declaration order;
// the receiver is never listed, a rest parameter carries kind 'rest' and
// no optional
export type rawDefinitionArg = {
	name: string;
	type: string;
	optional?: boolean;
	kind?: string;
};

export type rawDefinitionEntry = {
	name: string;
	location: string;
	kind: string;
	parent: string | null;
	strictChain: boolean;
	blockErrors: boolean;
	// Absent means the generator did not record them; empty means none.
	// args are carried for the model, not displayed (display is undecided)
	fields?: rawDefinitionField[];
	args?: rawDefinitionArg[];
};

// definitions.json file envelope (lethe contract)
export type rawDefinitionsFile = {
	version: string;
	generatedAt?: string;
	definitions: Record<string, rawDefinitionEntry>;
};

export type DefinitionEntryInstance = InstanceType<typeof DefinitionEntry>;

export const Definitions = Backend.define('Definitions', class {
	createdAt: number;
	private map: Map<string, DefinitionEntryInstance> = new Map();
	private logger = getLogger();

	constructor () {
		// test
		this.createdAt = Date.now();
		this.logger.info(`[Definitions] : constructed at ${this.createdAt}`);
	}

	get size () {
		return this.map.size;
	}

	get (name: string): DefinitionEntryInstance | undefined {
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

export const DefinitionEntry = Definitions.define('DefinitionEntry', function (
	this: rawDefinitionEntry,
	data: rawDefinitionEntry
) {
	setProps(this, data);
});

export default Definitions;
