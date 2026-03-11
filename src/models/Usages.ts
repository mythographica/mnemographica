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

export const Usages = define('Usages', class extends Map {
	createdAt: number;
	constructor() {
		super();
		this.createdAt = Date.now();
	}
	clear() {
		super.clear();
	}
	get(name: string): usage[] {
		return super.get(name);
	}
	set(name: string, value: usage[]) {
		super.set(name, value);
		return this;
	}
});

export const UsageEntry = Usages.define('UsageEntry', function (
	this: usage,
	data: usage
) {
	Object.defineProperties(this, Object.getOwnPropertyDescriptors(data));
});

export default Usages;
