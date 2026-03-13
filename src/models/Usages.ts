'use strict';

import { define } from 'mnemonica';
import { getLogger } from '../services/LoggerService';

export type usage = {
	typeName: string;
	kind: string,
	code: string,
	location: string
};

export type usageEntry = InstanceType<typeof UsageEntry>;

export const Usages = define('Usages', class {
	createdAt: number;
	private map: Map<string, Array<object>> = new Map();
	private logger = getLogger()
	constructor() {
		this.createdAt = Date.now();
		this.logger.info(`[Usages] : constructed at ${this.createdAt}`);
	}
	get size() {
		return this.map.size;
	}
	get(name: string): Array<usageEntry> {
		this.logger.info('Usages keys: ', ...this.map.keys());
		this.logger.info('Usages size: ', this.map.size);
		return this.map.get(name) as unknown as Array<usageEntry>;
	}
	has(name: string) {
		return this.map.has(name);
	}
	set(name: string, entry: Array<usageEntry>) {
		this.map.set(name, entry);
	}
	values(): MapIterator<Array<usageEntry>> {
		return this.map.values() as unknown as MapIterator<Array<usageEntry>>;
	}
	clear(): void {
		return this.map.clear();
	}

});

const setProps = (to: object, from: object) => {
	Object.defineProperties(to, Object.getOwnPropertyDescriptors(from));
}

export const UsageEntry = Usages.define('UsageEntry', function (
	this: usage,
	data: usage
) {
	setProps(this, data);
});

export default Usages;
