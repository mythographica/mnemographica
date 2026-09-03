'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { define, lookup } from 'mnemonica';
import { getLogger } from '../services/LoggerService';
import type { Definitions, Types, Usages, Trie, EDS, Flow, Instrumentation } from '~tactica/types';

import type { rawDefinitionEntry } from './Definition';
import type { rawTypeEntry } from './Types';
import type { usage } from './Usages';
import type { rawEDSEntry } from './EDS';
import type { rawFlowEntry } from './Flow';
import type { rawInstrumentationPoint } from './Instrumentation';

export type registryEntry = {
	id: string;
	name: string;
	filePath: string;
	line: number;
	column: number;
};

// hierarchy.json node shape, as written by tactica
type hierarchyNode = {
	name: string;
	fullPath: string;
	location?: string;
	children?: hierarchyNode[];
};

const parseLocationString = function (location?: string): { fileName: string; line: number; column: number } | undefined {
	if (!location) { return undefined; }
	const match = location.match(/^(.+):(\d+):(\d+)$/);
	if (!match) { return undefined; }
	return {
		fileName: match[1],
		line: parseInt(match[2], 10),
		column: parseInt(match[3], 10)
	};
};

export const Registry = define('Registry', class {
	createdAt: number;
	private map: Map<string, object> = new Map();
	private logger = getLogger();

	// Model instances. Plain private fields — an earlier incarnation
	// redefined them as getter-only accessor properties via
	// Object.defineProperty, which made clear() throw a TypeError in
	// strict mode and killed every refresh (audit B1).
	private definitionsInstance: Definitions | undefined;
	private typesInstance: Types | undefined;
	private usagesInstance: Usages | undefined;
	private edsInstance: EDS | undefined;
	private flowInstance: Flow | undefined;
	private instrumentationInstance: Instrumentation | undefined;
	private trieInstance: Trie | undefined;

	// Workspace path for reload operations
	private workspacePath: string | undefined;

	constructor() {
		this.createdAt = Date.now();
		this.logger.info(`[Registry] : constructed at ${this.createdAt}`);
	}

	get size() {
		return this.map.size;
	}

	get(name: string): object | undefined {
		return this.map.get(name);
	}

	has(name: string): boolean {
		return this.map.has(name);
	}

	set(name: string, entry: object): void {
		this.map.set(name, entry);
	}

	keys(): MapIterator<string> {
		return this.map.keys() as unknown as MapIterator<string>;
	}

	values(): MapIterator<object> {
		return this.map.values() as unknown as MapIterator<object>;
	}

	clear(): void {
		this.map.clear();
		this.definitionsInstance = undefined;
		this.typesInstance = undefined;
		this.usagesInstance = undefined;
		this.edsInstance = undefined;
		this.flowInstance = undefined;
		this.instrumentationInstance = undefined;
		this.trieInstance = undefined;
		this.workspacePath = undefined;
		this.logger.info('[Registry] : cleared all data');
	}

	/**
	 * Load all models from the .tactica/ directory in the workspace
	 */
	async loadFromWorkspace(workspacePath: string): Promise<void> {
		this.workspacePath = workspacePath;
		const tacticaPath = path.join(workspacePath, '.tactica');

		this.logger.info(`[Registry] : loading from workspace ${workspacePath}`);
		this.logger.info(`[Registry] : .tactica path ${tacticaPath}`);

		// Verify .tactica directory exists
		if (!fs.existsSync(tacticaPath)) {
			this.logger.warn(`[Registry] : .tactica directory not found at ${tacticaPath}`);
			return;
		}

		try {
			// Load Definitions
			await this.loadDefinitions(tacticaPath);

			// Load Types
			await this.loadTypes(tacticaPath);

			// Load Usages
			await this.loadUsages(tacticaPath);

			// Load EDS
			await this.loadEDS(tacticaPath);

			// Load Flow
			await this.loadFlow(tacticaPath);

			// Load Instrumentation (NestJS lifecycle crossroads, diamond graph)
			await this.loadInstrumentation(tacticaPath);

			// Initialize Trie (no file to load, just create instance)
			await this.loadTrie();

			this.logger.info('[Registry] : all models loaded successfully');
		} catch (error) {
			this.logger.error('[Registry] : failed to load models',
				(error as Error).stack);
			throw error;
		}
	}

	/**
	 * Load Definitions from definitions.json using lookup
	 */
	private async loadDefinitions(tacticaPath: string): Promise<void> {
		this.logger.info('[Registry] : loading Definitions');

		try {
			const DefinitionsConstructor = lookup('Definitions');
			const definitionsInstance = new DefinitionsConstructor();
			this.definitionsInstance = definitionsInstance;

			const definitionsPath = path.join(tacticaPath, 'definitions.json');
			if (fs.existsSync(definitionsPath)) {
				const content = fs.readFileSync(definitionsPath, 'utf-8');
				const data = JSON.parse(content);
				if (data.definitions) {
					for (const [key, value] of Object.entries(data.definitions)) {
						try {
							const entry = new definitionsInstance.DefinitionEntry(value as rawDefinitionEntry);
							definitionsInstance.set(key, entry);
						} catch (error) {
							const { stack } = error as Error;
							this.logger.error(stack as string);
						}
					}
				}
				this.logger.info(`[Registry] : Definitions loaded with ${definitionsInstance.size} entries`);
			} else {
				this.logger.warn(`[Registry] : definitions.json not found at ${definitionsPath}`);
			}
		} catch (error) {
			this.logger.error('[Registry] : failed to load Definitions',
				(error as Error).stack);
			throw error;
		}
	}

	/**
	 * Load Types from hierarchy.json using lookup.
	 *
	 * hierarchy.json is authoritative for structure: dot-joined fullPaths
	 * ("Scene2D.GraphNode2D", same convention as definitions/usages/flow
	 * keys), parents, and 1-based define()-site locations. The former
	 * types.ts regex parse produced underscore keys, missed properties
	 * entirely, and stored 0-based lines pointing at the generated file
	 * (audit B4/B9/B10). Property signatures are still read from the
	 * generated types.ts bodies, the only place they exist (audit B2).
	 */
	private async loadTypes(tacticaPath: string): Promise<void> {
		this.logger.info('[Registry] : loading Types');

		try {
			const TypesConstructor = lookup('Types');
			const typesInstance = new TypesConstructor();
			this.typesInstance = typesInstance;

			const hierarchyPath = path.join(tacticaPath, 'hierarchy.json');
			if (!fs.existsSync(hierarchyPath)) {
				this.logger.warn(`[Registry] : hierarchy.json not found at ${hierarchyPath} — regenerate .tactica with a current tactica`);
				return;
			}

			const propertiesByType = this.parseTypesProperties(tacticaPath);

			const hierarchyContent = fs.readFileSync(hierarchyPath, 'utf-8');
			const hierarchy = JSON.parse(hierarchyContent) as { roots?: hierarchyNode[] };

			const visit = (node: hierarchyNode, parent: string | undefined): void => {
				// Validate: self-referential entries are a bug, skip them
				if (node.fullPath === parent) {
					this.logger.warn(`[Registry] : Skipping self-referential type ${node.fullPath}`);
					return;
				}

				const parsed = parseLocationString(node.location);
				try {
					const entry = new typesInstance.TypeEntry({
						name: node.name,
						fullPath: node.fullPath,
						parent,
						properties: propertiesByType.get(node.fullPath) || new Map(),
						lineNumber: parsed ? parsed.line : 0,
						location: node.location
					} as rawTypeEntry);
					typesInstance.set(node.fullPath, entry);
				} catch (error) {
					const { stack } = error as Error;
					this.logger.error(stack as string);
				}

				for (const child of node.children || []) {
					visit(child, node.fullPath);
				}
			};

			for (const root of hierarchy.roots || []) {
				visit(root, undefined);
			}

			this.logger.info(`[Registry] : Types loaded with ${typesInstance.size} entries`);
		} catch (error) {
			this.logger.error('[Registry] : failed to load Types',
				(error as Error).stack);
			throw error;
		}
	}

	/**
	 * Parse property signatures from the generated types.ts bodies.
	 * Type aliases there are underscore-joined ("Scene2D_GraphNode2D");
	 * the returned map is keyed by dot-joined full path so it joins with
	 * hierarchy.json fullPaths.
	 */
	private parseTypesProperties(
		tacticaPath: string
	): Map<string, Map<string, { name: string; type: string; optional: boolean }>> {
		const result = new Map<string, Map<string, { name: string; type: string; optional: boolean }>>();

		const typesPath = path.join(tacticaPath, 'types.ts');
		if (!fs.existsSync(typesPath)) {
			this.logger.warn(`[Registry] : types.ts not found at ${typesPath}, properties skipped`);
			return result;
		}

		const content = fs.readFileSync(typesPath, 'utf-8');
		const lines = content.split('\n');

		// export type TypeName = ProtoFlat<Parent, { ... }>
		// OR: export type TypeName = Parent & { ... }
		// OR: export type TypeName = { ... } (root types, no parent)
		const typeRegex = /export\s+type\s+(\w+)\s*=\s*(?:(?:ProtoFlat<(\w+),)|(?:(\w+)\s*&))?[\s\n]*\{/;
		const propertyRegex = /^\s*(\w+)(\?)?\s*:\s*([^;]+);?\s*$/;

		for (let i = 0; i < lines.length; i++) {
			const match = typeRegex.exec(lines[i]);
			if (!match) { continue; }

			const alias = match[1];
			const properties = new Map<string, { name: string; type: string; optional: boolean }>();

			// Walk the body until its closing brace; depth is tracked so
			// inline object types do not end the block early
			let depth = 1;
			for (let j = i + 1; j < lines.length && depth > 0; j++) {
				const bodyLine = lines[j];
				depth += (bodyLine.match(/\{/g) || []).length;
				depth -= (bodyLine.match(/\}/g) || []).length;
				if (depth <= 0) { break; }
				const propertyMatch = propertyRegex.exec(bodyLine);
				if (propertyMatch) {
					properties.set(propertyMatch[1], {
						name: propertyMatch[1],
						type: propertyMatch[3].trim(),
						optional: Boolean(propertyMatch[2])
					});
				}
			}

			result.set(alias.replace(/_/g, '.'), properties);
		}

		return result;
	}

	/**
	 * Load Usages from usages.json using lookup
	 */
	private async loadUsages(tacticaPath: string): Promise<void> {
		this.logger.info('[Registry] : loading Usages');

		try {
			const UsagesConstructor = lookup('Usages');
			const usagesInstance = new UsagesConstructor();
			this.usagesInstance = usagesInstance;

			// Note: Usages doesn't have loadFromFile, we need to populate it manually
			const usagesPath = path.join(tacticaPath, 'usages.json');
			if (fs.existsSync(usagesPath)) {
				const content = fs.readFileSync(usagesPath, 'utf-8');
				const data = JSON.parse(content);

				if (data.usages) {
					for (const [key, value] of Object.entries(data.usages)) {
						// Stamp the map key as typeName and wrap entries as
						// UsageEntry instances — the same shape the reference
						// provider builds (audit B8)
						const entries = (value as Array<object>).map((u) => {
							const stamped = Object.assign({ typeName: key }, u) as usage;
							return new usagesInstance.UsageEntry(stamped);
						});
						usagesInstance.set(key, entries);
					}
				}
				this.logger.info(`[Registry] : Usages loaded with ${usagesInstance.size} entries`);
			} else {
				this.logger.warn(`[Registry] : usages.json not found at ${usagesPath}`);
			}
		} catch (error) {
			this.logger.error('[Registry] : failed to load Usages', error);
			throw error;
		}
	}

	/**
	 * Load EDS from eds.json using lookup
	 */
	private async loadEDS(tacticaPath: string): Promise<void> {
		this.logger.info('[Registry] : loading EDS');

		try {
			const EDSConstructor = lookup('EDS');
			const edsInstance = new EDSConstructor();
			this.edsInstance = edsInstance;

			const edsPath = path.join(tacticaPath, 'eds.json');
			if (fs.existsSync(edsPath)) {
				const content = fs.readFileSync(edsPath, 'utf-8');
				const data = JSON.parse(content);

				// tactica only writes eds.json when EDS data exists, so a
				// stale file can linger after the data is gone (audit B11).
				// When both files carry generatedAt, an eds.json older
				// than definitions.json is skipped as stale.
				if (data.generatedAt) {
					const definitionsPath = path.join(tacticaPath, 'definitions.json');
					if (fs.existsSync(definitionsPath)) {
						const definitionsData = JSON.parse(fs.readFileSync(definitionsPath, 'utf-8'));
						if (definitionsData.generatedAt && data.generatedAt < definitionsData.generatedAt) {
							this.logger.warn('[Registry] : eds.json is older than definitions.json — skipping as stale');
							return;
						}
					}
				}

				if (data.eds) {
					for (const [key, value] of Object.entries(data.eds)) {
						const entries = (value as rawEDSEntry[]).map((e: rawEDSEntry) => {
							// Stamp the map key as typeName — tactica's EDSInfo
							// has no typeName field (audit B7)
							return new edsInstance.EDSEntry(
								Object.assign({ typeName: key }, e)
							);
						});
						edsInstance.set(key, entries);
					}
				}
				this.logger.info(`[Registry] : EDS loaded with ${edsInstance.size} entries`);
			} else {
				this.logger.warn(`[Registry] : eds.json not found at ${edsPath}`);
			}
		} catch (error) {
			this.logger.error('[Registry] : failed to load EDS', error);
			throw error;
		}
	}

	/**
	 * Load Flow from flow.json using lookup
	 */
	private async loadFlow(tacticaPath: string): Promise<void> {
		this.logger.info('[Registry] : loading Flow');

		try {
			const FlowConstructor = lookup('Flow');
			const flowInstance = new FlowConstructor();
			this.flowInstance = flowInstance;

			const flowPath = path.join(tacticaPath, 'flow.json');
			if (fs.existsSync(flowPath)) {
				const content = fs.readFileSync(flowPath, 'utf-8');
				const data = JSON.parse(content);

				if (data.flow) {
					for (const [key, value] of Object.entries(data.flow)) {
						const entries = (value as rawFlowEntry[]).map((e: rawFlowEntry) => {
							// Stamp the map key as typeName — tactica's FlowInfo
							// has no typeName field (audit B7)
							return new flowInstance.FlowEntry(
								Object.assign({ typeName: key }, e)
							);
						});
						flowInstance.set(key, entries);
					}
				}
				this.logger.info(`[Registry] : Flow loaded with ${flowInstance.size} entries`);
			} else {
				this.logger.warn(`[Registry] : flow.json not found at ${flowPath}`);
			}
		} catch (error) {
			this.logger.error('[Registry] : failed to load Flow', error);
			throw error;
		}
	}

	/**
	 * Load Instrumentation from instrumentation.json using lookup
	 */
	private async loadInstrumentation(tacticaPath: string): Promise<void> {
		this.logger.info('[Registry] : loading Instrumentation');

		try {
			const InstrumentationConstructor = lookup('Instrumentation');
			const instrumentationInstance = new InstrumentationConstructor();
			this.instrumentationInstance = instrumentationInstance;

			const instrumentationPath = path.join(tacticaPath, 'instrumentation.json');
			if (fs.existsSync(instrumentationPath)) {
				const content = fs.readFileSync(instrumentationPath, 'utf-8');
				const data = JSON.parse(content);

				// Same stale guard as eds.json: a file older than
				// definitions.json belongs to a previous analysis pass.
				if (data.generatedAt) {
					const definitionsPath = path.join(tacticaPath, 'definitions.json');
					if (fs.existsSync(definitionsPath)) {
						const definitionsData = JSON.parse(fs.readFileSync(definitionsPath, 'utf-8'));
						if (definitionsData.generatedAt && data.generatedAt < definitionsData.generatedAt) {
							this.logger.warn('[Registry] : instrumentation.json is older than definitions.json — skipping as stale');
							return;
						}
					}
				}

				if (Array.isArray(data.points)) {
					const entries = (data.points as rawInstrumentationPoint[]).map((p: rawInstrumentationPoint) => {
						return new instrumentationInstance.InstrumentationPoint(p);
					});
					instrumentationInstance.set(entries);
				}
				this.logger.info(`[Registry] : Instrumentation loaded with ${instrumentationInstance.size} points`);
			} else {
				this.logger.warn(`[Registry] : instrumentation.json not found at ${instrumentationPath}`);
			}
		} catch (error) {
			this.logger.error('[Registry] : failed to load Instrumentation', error);
			throw error;
		}
	}

	/**
	 * Initialize Trie using lookup
	 */
	private async loadTrie(): Promise<void> {
		this.logger.info('[Registry] : loading Trie');

		try {
			const TrieConstructor = lookup('Trie');
			const trieInstance = new TrieConstructor();
			this.trieInstance = trieInstance;
			this.logger.info('[Registry] : Trie initialized');
		} catch (error) {
			this.logger.error('[Registry] : failed to load Trie', error);
			throw error;
		}
	}

	/**
	 * Get the Definitions instance
	 */
	getDefinitions(): Definitions | undefined {
		return this.definitionsInstance;
	}

	/**
	 * Get the Types instance
	 */
	getTypes(): Types | undefined {
		return this.typesInstance;
	}

	/**
	 * Get the Usages instance
	 */
	getUsages(): Usages | undefined {
		return this.usagesInstance;
	}

	/**
	 * Get the EDS instance
	 */
	getEDS(): EDS | undefined {
		return this.edsInstance;
	}

	/**
	 * Get the Flow instance
	 */
	getFlow(): Flow | undefined {
		return this.flowInstance;
	}

	/**
	 * Get the Instrumentation instance
	 */
	getInstrumentation(): Instrumentation | undefined {
		return this.instrumentationInstance;
	}

	/**
	 * Get the Trie instance
	 */
	getTrie(): Trie | undefined {
		return this.trieInstance;
	}

	/**
	 * Refresh all models by reloading from workspace
	 */
	async refresh(): Promise<void> {
		if (!this.workspacePath) {
			this.logger.warn('[Registry] : cannot refresh, no workspace path set');
			return;
		}

		this.logger.info('[Registry] : refreshing all models');
		this.clear();
		await this.loadFromWorkspace(this.workspacePath);
		this.logger.info('[Registry] : refresh complete');
	}
});

const setProps = (to: object, from: object) => {
	Object.defineProperties(to, Object.getOwnPropertyDescriptors(from));
};

export const RegistryEntry = Registry.define('RegistryEntry', function (
	this: registryEntry,
	data: registryEntry
) {
	setProps(this, data);
});

// Export singleton instance
export const registry = new Registry();

export default Registry;
