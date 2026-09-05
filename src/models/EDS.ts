'use strict';

import { define } from 'mnemonica';
import { getLogger } from '../services/LoggerService';

export type rawEDSEntry = {
	typeName: string;
	location: string;
	kind: string;
	code: string;
	targetType?: string;
	scope?: string;
	via?: string;
	createsTypes?: string[];
	/** Label string literal of wrap(fn, …, 'label') when statically visible */
	label?: string;
	/** scopeId (scopes.json) of the wrapped callback's own scope */
	callbackScopeId?: string;
	/** Identifier passed as the instance/context argument */
	instanceArg?: string;
	/** scopeId of the scope holding the wrap call site */
	scopeId?: string;
	/** Mnemonica fullPath of the wrapped instance argument */
	wrapsTypePath?: string;
};

export type EDSEntryInstance = InstanceType<typeof EDSEntry>;

export const EDS = define('EDS', class {
	createdAt: number;
	private map: Map<string, EDSEntryInstance[]> = new Map();
	private logger = getLogger();

	constructor () {
		this.createdAt = Date.now();
		this.logger.info(`[EDS] : constructed at ${this.createdAt}`);
	}

	get size () {
		return this.map.size;
	}

	get (name: string): EDSEntryInstance[] | undefined {
		return this.map.get(name);
	}

	has (name: string): boolean {
		return this.map.has(name);
	}

	set (name: string, entry: EDSEntryInstance[]): void {
		this.map.set(name, entry);
	}

	keys (): MapIterator<string> {
		return this.map.keys() as unknown as MapIterator<string>;
	}

	values (): MapIterator<EDSEntryInstance[]> {
		return this.map.values() as unknown as MapIterator<EDSEntryInstance[]>;
	}

	entries (): MapIterator<[string, EDSEntryInstance[]]> {
		return this.map.entries() as unknown as MapIterator<[string, EDSEntryInstance[]]>;
	}

	clear (): void {
		return this.map.clear();
	}
});

const setProps = (to: object, from: object) => {
	Object.defineProperties(to, Object.getOwnPropertyDescriptors(from));
};

export const EDSEntry = EDS.define('EDSEntry', function (
	this: rawEDSEntry,
	data: rawEDSEntry
) {
	setProps(this, data);
});

export default EDS;
