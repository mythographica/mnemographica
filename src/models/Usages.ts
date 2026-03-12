'use strict';

import { define } from 'mnemonica';

export type usage = {
	id: string;
	typeName: string;
	filePath: string;
	line: number;
	column: number;
	context: string
};

export type usageEntry = InstanceType<typeof UsageEntry>;

export const Usages = define('Usages', class {
	createdAt: number;
	private map: Map<string, Array<object>>;
	constructor() {
		this.createdAt = Date.now();
		this.map = new Map();
	}
	get size() {
		return this.map.size;
	}
	get(name: string): Array<usageEntry> {
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
