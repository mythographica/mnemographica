'use strict';

import { define } from 'mnemonica';
import { getLogger } from '../services/LoggerService';

export type rawFlowEntry = {
	typeName: string;
	kind: string;
	code: string;
	location: string;
	propertyName?: string;
	context?: string;
};

export type FlowEntryInstance = InstanceType<typeof FlowEntry>;

export const Flow = define('Flow', class {
	createdAt: number;
	private map: Map<string, FlowEntryInstance[]> = new Map();
	private logger = getLogger();

	constructor () {
		this.createdAt = Date.now();
		this.logger.info(`[Flow] : constructed at ${this.createdAt}`);
	}

	get size () {
		return this.map.size;
	}

	get (name: string): FlowEntryInstance[] | undefined {
		return this.map.get(name) as unknown as FlowEntryInstance[];
	}

	has (name: string): boolean {
		return this.map.has(name);
	}

	set (name: string, entry: FlowEntryInstance[]): void {
		this.map.set(name, entry);
	}

	keys (): MapIterator<string> {
		return this.map.keys() as unknown as MapIterator<string>;
	}

	values (): MapIterator<FlowEntryInstance[]> {
		return this.map.values() as unknown as MapIterator<FlowEntryInstance[]>;
	}

	entries (): MapIterator<[string, FlowEntryInstance[]]> {
		return this.map.entries() as unknown as MapIterator<[string, FlowEntryInstance[]]>;
	}

	clear (): void {
		return this.map.clear();
	}
});

const setProps = (to: object, from: object) => {
	Object.defineProperties(to, Object.getOwnPropertyDescriptors(from));
};

export const FlowEntry = Flow.define('FlowEntry', function (
	this: rawFlowEntry,
	data: rawFlowEntry
) {
	setProps(this, data);
});

export default Flow;
