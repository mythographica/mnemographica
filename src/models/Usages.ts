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
		// console.log('usages instanceof Usages :::', this instanceof Usages);
		// const ogp = Object.getPrototypeOf;
		// console.log('Usages 0 :::', this.constructor.name, ogp(this));
		// console.log('Usages 1 :::', ogp(this).constructor.name, ogp(this));
		// console.log('Usages 2 :::', ogp(ogp(this)).constructor.name, ogp(ogp(this)));
		// console.log('Usages 3 :::', ogp(ogp(ogp(this))).constructor.name, ogp(ogp(ogp(this))));
		// console.log('Usages 4 :::', ogp(ogp(ogp(ogp(this)))).constructor.name, ogp(ogp(ogp(ogp(this)))));
		// console.log('Usages 5 :::', ogp(ogp(ogp(ogp(ogp(this))))).constructor.name, ogp(ogp(ogp(ogp(ogp(this))))));
		// console.log('Usages 6 :::', ogp(ogp(ogp(ogp(ogp(ogp(this)))))).constructor.name, ogp(ogp(ogp(ogp(ogp(ogp(this)))))));
		// console.log('Usages 7 :::', ogp(ogp(ogp(ogp(ogp(ogp(ogp(this))))))).constructor.name, ogp(ogp(ogp(ogp(ogp(ogp(ogp(this))))))));
		// console.log('Usages 8 :::', ogp(ogp(ogp(ogp(ogp(ogp(ogp(ogp(this)))))))));
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
	keys(): MapIterator<string> {
		return this.map.keys() as unknown as MapIterator<string>;
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
	usages: usage
) {
	setProps(this, usages);
	// console.log('usage instanceof UsageEntry', this instanceof UsageEntry);
	// console.log('usage instanceof Usages', this instanceof Usages);
	// console.log('usages instanceof Usages :::', this instanceof Usages);
	// console.log('UsagesEntry 0 :::', this.constructor.name, ogp(this));
	// const ogp = Object.getPrototypeOf;
	// console.log('UsagesEntry 1 :::', ogp(this).constructor.name, ogp(this));
	// console.log('UsagesEntry 2 :::', ogp(ogp(this)).constructor.name, ogp(ogp(this)));
	// console.log('UsagesEntry 3 :::', ogp(ogp(ogp(this))).constructor.name, ogp(ogp(ogp(this))));
	// console.log('UsagesEntry 4 :::', ogp(ogp(ogp(ogp(this)))).constructor.name, ogp(ogp(ogp(ogp(this)))));
	// console.log('UsagesEntry 5 :::', ogp(ogp(ogp(ogp(ogp(this))))).constructor.name, ogp(ogp(ogp(ogp(ogp(this))))));
	// console.log('UsagesEntry 6 :::', ogp(ogp(ogp(ogp(ogp(ogp(this)))))).constructor.name, ogp(ogp(ogp(ogp(ogp(ogp(this)))))));
	// console.log('UsagesEntry 7 :::', ogp(ogp(ogp(ogp(ogp(ogp(ogp(this))))))).constructor.name, ogp(ogp(ogp(ogp(ogp(ogp(ogp(this))))))));
	// console.log('UsagesEntry 8 :::', ogp(ogp(ogp(ogp(ogp(ogp(ogp(ogp(this)))))))));
	// console.log('UsagesEntry 9 :::', ogp(ogp(ogp(ogp(ogp(ogp(ogp(ogp(ogp(this))))))))));
});

export default Usages;
