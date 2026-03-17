'use strict';

import { define } from 'mnemonica';
import { getLogger } from '../services/LoggerService';

export type rawTypeEntry = {
	name: string;
	fullPath: string;
	parent?: string;
	properties: Map<string, string>;
	lineNumber: number;
};

export type TypeEntryInstance = InstanceType<typeof TypeEntry>;

export const Types = define('Types', class {
	createdAt: number;
	private map: Map<string, TypeEntryInstance> = new Map();
	private logger = getLogger();

	constructor () {
		this.createdAt = Date.now();
		this.logger.info(`[Types] : constructed at ${this.createdAt}`);
	}

	get size () {
		return this.map.size;
	}

	get (name: string): TypeEntryInstance | undefined {
		this.logger.info('Types keys: ', ...this.map.keys());
		this.logger.info('Types size: ', this.map.size);
		return this.map.get(name);
	}

	has (name: string): boolean {
		return this.map.has(name);
	}

	set (name: string, entry: TypeEntryInstance): void {
		this.map.set(name, entry);
	}

	keys (): MapIterator<string> {
		return this.map.keys() as unknown as MapIterator<string>;
	}

	values (): MapIterator<TypeEntryInstance> {
		return this.map.values() as unknown as MapIterator<TypeEntryInstance>;
	}

	clear (): void {
		return this.map.clear();
	}

	getLineForType (typeName: string): number | undefined {
		const entry = this.map.get(typeName);
		return entry?.lineNumber;
	}
});

const setProps = (to: object, from: object) => {
	Object.defineProperties(to, Object.getOwnPropertyDescriptors(from));
};

export const TypeEntry = Types.define('TypeEntry', function (
	this: rawTypeEntry,
	data: rawTypeEntry
) {
	setProps(this, data);
});

export default Types;
