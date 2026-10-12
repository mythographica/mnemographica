'use strict';

import { Backend, setProps } from './collections';
import { getLogger } from '../services/LoggerService';

export type usage = {
	typeName: string;
	kind: string,
	code: string,
	location: string
};

// usages.json file envelope (lethe contract); tactica's entries carry no
// typeName — the map key is stamped on at load
export type rawUsagesFile = {
	version: string;
	generatedAt?: string;
	usages: Record<string, Array<Omit<usage, 'typeName'>>>;
};

export type usageEntry = InstanceType<typeof UsageEntry>;


export const Usages = Backend.define('Usages', class {
	createdAt: number;
	private map: Map<string, usageEntry[]> = new Map();
	private logger = getLogger()
	constructor() {
		this.createdAt = Date.now();
		this.logger.info(`[Usages] : constructed at ${this.createdAt}`);
	}
	get size() {
		return this.map.size;
	}
	get(name: string): usageEntry[] | undefined {
		return this.map.get(name);
	}
	has(name: string) {
		return this.map.has(name);
	}
	set(name: string, entry: usageEntry[]) {
		this.map.set(name, entry);
	}
	keys(): MapIterator<string> {
		return this.map.keys() as unknown as MapIterator<string>;
	}
	values(): MapIterator<usageEntry[]> {
		return this.map.values() as unknown as MapIterator<usageEntry[]>;
	}

	entries(): MapIterator<[string, usageEntry[]]> {
		return this.map.entries() as unknown as MapIterator<[string, usageEntry[]]>;
	}

	clear(): void {
		return this.map.clear();
	}

});

export const UsageEntry = Usages.define('UsageEntry', function (
	this: usage,
	usages: usage
) {
	setProps(this, usages);
});

export default Usages;
