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

const ogp = Object.getPrototypeOf;

export const Definitions = define('Definitions', class {
	createdAt: number;
	private map: Map<string, DefinitionEntryInstance> = new Map();
	private logger = getLogger();

	constructor () {
		this.createdAt = Date.now();
		this.logger.info(`[Definitions] : constructed at ${this.createdAt}`);
		console.log('definitions instanceof DefinitionEntry', this instanceof Definitions);
		console.log('Definitions :::', this);
		console.log('Definitions 0 :::', this.constructor.name, ogp(this));
		console.log('Definitions 1 :::', ogp(this).constructor.name, ogp(this));
		console.log('Definitions 2 :::', ogp(ogp(this)).constructor.name, ogp(ogp(this)));
		console.log('Definitions 3 :::', ogp(ogp(ogp(this))).constructor.name, ogp(ogp(ogp(this))));
		console.log('Definitions 4 :::', ogp(ogp(ogp(ogp(this)))).constructor.name, ogp(ogp(ogp(ogp(this)))));
		console.log('Definitions 5 :::', ogp(ogp(ogp(ogp(ogp(this))))).constructor.name, ogp(ogp(ogp(ogp(ogp(this))))));
		console.log('Definitions 6 :::', ogp(ogp(ogp(ogp(ogp(ogp(this)))))).constructor.name, ogp(ogp(ogp(ogp(ogp(ogp(this)))))));
		console.log('Definitions 7 :::', ogp(ogp(ogp(ogp(ogp(ogp(ogp(this))))))).constructor.name, ogp(ogp(ogp(ogp(ogp(ogp(ogp(this))))))));
		console.log('Definitions 8 :::', ogp(ogp(ogp(ogp(ogp(ogp(ogp(ogp(this)))))))));
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
	console.log('definitionEntry instanceof DefinitionEntry', this instanceof DefinitionEntry);
	console.log('definitionEntry instanceof Definitions', this instanceof Definitions);
	setProps(this, data);
	console.log('definitionEntry instanceof DefinitionEntry', this instanceof DefinitionEntry);
	console.log('definitionEntry instanceof Definitions', this instanceof Definitions);
	console.log('DefinitionEntry :::', this);
	console.log('DefinitionEntry 0 :::', this.constructor.name, ogp(this));
	console.log('DefinitionEntry 1 :::', ogp(this).constructor.name, ogp(this));
	console.log('DefinitionEntry 2 :::', ogp(ogp(this)).constructor.name, ogp(ogp(this)));
	console.log('DefinitionEntry 3 :::', ogp(ogp(ogp(this))).constructor.name, ogp(ogp(ogp(this))));
	console.log('DefinitionEntry 4 :::', ogp(ogp(ogp(ogp(this)))).constructor.name, ogp(ogp(ogp(ogp(this)))));
	console.log('DefinitionEntry 5 :::', ogp(ogp(ogp(ogp(ogp(this))))).constructor.name, ogp(ogp(ogp(ogp(ogp(this))))));
	console.log('DefinitionEntry 6 :::', ogp(ogp(ogp(ogp(ogp(ogp(this)))))).constructor.name, ogp(ogp(ogp(ogp(ogp(ogp(this)))))));
	console.log('DefinitionEntry 7 :::', ogp(ogp(ogp(ogp(ogp(ogp(ogp(this))))))).constructor.name, ogp(ogp(ogp(ogp(ogp(ogp(ogp(this))))))));
	console.log('DefinitionEntry 8 :::', ogp(ogp(ogp(ogp(ogp(ogp(ogp(ogp(this)))))))));
	console.log('DefinitionEntry 9 :::', ogp(ogp(ogp(ogp(ogp(ogp(ogp(ogp(ogp(this))))))))));

	// try {
		const _stack = {} as InstanceType<typeof Error>;
		Error.captureStackTrace(_stack);
	// } catch (error) {
		// const { stack } = error as InstanceType<typeof Error>;
		const { stack } = _stack;
		if (stack?.length) {
			console.log(stack);
		}
	// }
});

export default Definitions;
