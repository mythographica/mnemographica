'use strict';

import * as fs from 'fs';
import { define } from 'mnemonica';
import { getLogger } from '../services/LoggerService';

export type typeEntry = {
	name: string;
	fullPath: string;
	properties: Map<string, string>;
	parent?: string;
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

	async loadFromFile (filePath: string): Promise<void> {
		this.logger.info(`[Types] : loading from ${filePath}`);
		try {
			const content = fs.readFileSync(filePath, 'utf-8');
			const lines = content.split('\n');
			
			// Parse: export type TypeName = ProtoFlat<Parent, { ... }>
			// OR: export type TypeName = Parent & { ... }
			// OR: export type TypeName = { ... } (root types, no parent)
			const typeRegex = /export\s+type\s+(\w+)\s*=\s*(?:(?:ProtoFlat<(\w+),)|(?:(\w+)\s*&))?[\s\n]*\{/;
			
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const match = typeRegex.exec(line);
				if (match) {
					const name = match[1];
					// Check if it's ProtoFlat<Parent, ...> or Parent & { ... } or plain { }
					let parent: string | undefined;
					
					if (match[2]) {
						// ProtoFlat<Parent, ...> - match[2] is the parent
						parent = match[2];
					} else if (match[3]) {
						// Parent & { ... } - match[3] is the parent
						parent = match[3];
					}
					// If neither match[2] nor match[3], it's a root type (parent stays undefined)
					// If neither match[2] nor match[3], it's a root type (parent stays undefined)
					
					// Validate: if parent equals name, it's self-referential (bug)
					if (parent === name) {
						this.logger.warn(`[Types] : Skipping self-referential type ${name} at line ${i + 1}`);
						continue;
					}
					
					const entry = new (this as unknown as { TypeEntry: typeof TypeEntry }).TypeEntry({
						name,
						fullPath: filePath,
						parent,
						properties: new Map() // Properties can be added later if needed
					});
					this.map.set(name, entry);
				}
			}
			
			this.logger.info(`[Types] : loaded ${this.map.size} types`);
		} catch (error) {
			this.logger.error(`[Types] : failed to load from ${filePath}`, error);
			throw error;
		}
	}

	getLineForType (typeName: string): number | undefined {
		const entry = this.map.get(typeName);
		if (!entry) return undefined;
		
		// Re-parse to find line number
		const content = fs.readFileSync(entry.fullPath, 'utf-8');
		const lines = content.split('\n');
		const searchPattern = new RegExp(`export\\s+type\\s+${typeName}\\s*=`);
		
		for (let i = 0; i < lines.length; i++) {
			if (searchPattern.test(lines[i])) {
				return i;
			}
		}
		return undefined;
	}
});

const setProps = (to: object, from: object) => {
	Object.defineProperties(to, Object.getOwnPropertyDescriptors(from));
};

export const TypeEntry = Types.define('TypeEntry', function (
	this: typeEntry,
	data: typeEntry
) {
	setProps(this, data);
});

export default Types;
