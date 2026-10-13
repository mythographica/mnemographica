'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { Backend, setProps } from './collections';
import { define } from 'mnemonica';
import { getLogger } from '../services/LoggerService';
import { parseTacticaLocation, tacticaDirOf, resolveWorkspacePaths } from '../utils/paths';
import { validateTacticaFile, type tacticaContractKind } from '../utils/letheValidation';
import { DEFAULT_COLLECTION } from '../utils/collections';
import type { BackendRegistry_Definitions as Definitions, BackendRegistry_Types as Types, BackendRegistry_Usages as Usages, BackendRegistry_Trie as Trie, BackendRegistry_EDS as EDS, BackendRegistry_Flow as Flow, BackendRegistry_Control as Control, Registry as RegistryModel } from '~tactica/types';

import type { rawDefinitionsFile } from './Definition';
import type { rawTypeEntry } from './Types';
import type { rawUsagesFile } from './Usages';
import type { rawEDSFile } from './EDS';
import type { rawFlowFile } from './Flow';
import type { rawControlFile } from './Control';

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

// hierarchy.json file envelope (lethe contract)
type hierarchyFile = {
	version: string;
	generatedAt?: string;
	roots: hierarchyNode[];
};

// collections.json manifest entry (lethe contract, format 1.2: no
// registryInterface, language required). Only the id and the display
// name are read — the labels are cosmetic.
type collectionsManifestEntry = {
	id: string | null;
	name: string;
	location: string | null;
	language: string;
};

// collections.json file envelope (lethe contract)
type collectionsFile = {
	version: string;
	generatedAt?: string;
	collections: collectionsManifestEntry[];
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
	private controlInstance: Control | undefined;
	private trieInstance: Trie | undefined;

	// Collection id → display name, from collections.json (tactica
	// ≥ 0.4.1). Empty when the manifest is absent — consumers fall back
	// to raw ids.
	private collectionNames: Map<string, string> = new Map();

	// Per-file generatedAt stamps, recorded by readTacticaJson — the
	// freshness memory that keeps every file single-read per load
	private generatedAts: Map<string, string> = new Map();

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

	set(name: string, entry: object): void {
		this.map.set(name, entry);
	}

	clear(): void {
		this.map.clear();
		this.definitionsInstance = undefined;
		this.typesInstance = undefined;
		this.usagesInstance = undefined;
		this.edsInstance = undefined;
		this.flowInstance = undefined;
		this.controlInstance = undefined;
		this.trieInstance = undefined;
		this.collectionNames.clear();
		this.generatedAts.clear();
		this.logger.info('[Registry] : cleared all data');
	}

	/**
	 * Read one .tactica contract file: existence check, JSON parse, lethe
	 * schema validation. Returns undefined on any failure — a missing or
	 * invalid file is a logged warning naming the file (and, for schema
	 * failures, the first errors); the model for it stays empty and the
	 * load never crashes. The parsed payload is path-resolved against the
	 * directory holding .tactica before return.
	 */
	private readTacticaJson<T extends { generatedAt?: string }>(tacticaPath: string, kind: tacticaContractKind): T | undefined {
		const filePath = path.join(tacticaPath, `${kind}.json`);
		if (!fs.existsSync(filePath)) {
			this.logger.warn(`[Registry] : ${kind}.json not found at ${filePath}`);
			return undefined;
		}
		let data: T;
		try {
			const content = fs.readFileSync(filePath, 'utf-8');
			// JSON.parse's any is the container boundary: the schema
			// validation right below is what makes the T honest
			data = JSON.parse(content);
		} catch (error) {
			this.logger.warn(`[Registry] : ${kind}.json unreadable at ${filePath} — skipping (${(error as Error).message})`);
			return undefined;
		}
		if (!validateTacticaFile(kind, filePath, data)) {
			return undefined;
		}
		// Every contract file is read exactly once per load: the freshness
		// stamp stays on the instance so stale guards and the layout guard
		// never re-read a file
		if (typeof data.generatedAt === 'string') {
			this.generatedAts.set(kind, data.generatedAt);
		}
		const resolved = resolveWorkspacePaths(data, path.dirname(tacticaPath));
		return resolved;
	}

	/**
	 * The loaded file's generatedAt stamp (set by readTacticaJson) —
	 * freshness checks read this, never the file again
	 */
	getGeneratedAt(kind: tacticaContractKind): string | undefined {
		return this.generatedAts.get(kind);
	}

	/**
	 * Load all models from the .tactica/ directory in the workspace
	 */
	async loadFromWorkspace(workspacePath: string): Promise<void> {
		const tacticaPath = tacticaDirOf(workspacePath);

		this.logger.info(`[Registry] : loading from workspace ${workspacePath}`);
		this.logger.info(`[Registry] : .tactica path ${tacticaPath}`);

		// Verify .tactica directory exists
		if (!fs.existsSync(tacticaPath)) {
			this.logger.warn(`[Registry] : .tactica directory not found at ${tacticaPath}`);
			return;
		}

		try {
			// Load Definitions
			this.loadDefinitions(tacticaPath);

			// Trie holds the hierarchy trie — it must exist before
			// loadTypes walks hierarchy.json (it has no file of its own)
			this.loadTrie();

			// Load Types
			this.loadTypes(tacticaPath);

			// Load Usages
			this.loadUsages(tacticaPath);

			// Load EDS
			this.loadEDS(tacticaPath);

			// Load Flow
			this.loadFlow(tacticaPath);

			// Load Control (callers graph + framework points, the diamond layer)
			this.loadControl(tacticaPath);

			// Load the collections manifest (id → display name labels)
			this.loadCollections(tacticaPath);

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
	private loadDefinitions(tacticaPath: string): void {
		this.logger.info('[Registry] : loading Definitions');

		try {
			const DefinitionsConstructor = Backend.lookup('Definitions');
			const definitionsInstance = new DefinitionsConstructor();
			this.definitionsInstance = definitionsInstance;

			const data = this.readTacticaJson<rawDefinitionsFile>(tacticaPath, 'definitions');
			if (data) {
				if (data.definitions) {
					for (const [key, value] of Object.entries(data.definitions)) {
						try {
							const entry = new definitionsInstance.DefinitionEntry(value);
							definitionsInstance.set(key, entry);
						} catch (error) {
							const { stack } = error as Error;
							this.logger.error(stack as string);
						}
					}
				}
				this.logger.info(`[Registry] : Definitions loaded with ${definitionsInstance.size} entries`);
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
	 * keys), parents, and 1-based define()-site locations. Property
	 * signatures come from definitions.json `fields` (the type's own
	 * fields in declaration order — the same source tactica renders
	 * types.ts from).
	 */
	private loadTypes(tacticaPath: string): void {
		this.logger.info('[Registry] : loading Types');

		try {
			const TypesConstructor = Backend.lookup('Types');
			const typesInstance = new TypesConstructor();
			this.typesInstance = typesInstance;

			const hierarchy = this.readTacticaJson<hierarchyFile>(tacticaPath, 'hierarchy');
			if (!hierarchy) {
				this.logger.warn('[Registry] : no usable hierarchy.json — regenerate .tactica with a current tactica');
				return;
			}

			const propertiesByType = this.readDefinitionsFields();

			const visit = (node: hierarchyNode, parent: string | undefined): void => {
				// Validate: self-referential entries are a bug, skip them
				if (node.fullPath === parent) {
					this.logger.warn(`[Registry] : Skipping self-referential type ${node.fullPath}`);
					return;
				}

				const parsed = parseTacticaLocation(node.location);
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

				// The Trie model mirrors the same hierarchy: one
				// GraphNodeTrie per type, one LinkTrie per parent edge —
				// the link is constructed from its child node, so its
				// prototype chain ties it there
				const trie = this.trieInstance;
				if (trie) {
					const trieNode = new trie.GraphNodeTrie({
						id     : node.fullPath,
						name   : node.name,
						path   : node.fullPath,
						depth  : parent ? parent.split('.').length : 0,
						isLeaf : !node.children || node.children.length === 0
					});
					trie.addNode(node.fullPath, trieNode);
					if (parent) {
						const link = new trieNode.LinkTrie({
							parent,
							child    : node.fullPath,
							relation : 'subtype'
						});
						trie.addLink(link);
					}
				}

				// The flat type index the Registry's map API always
				// promised: one RegistryEntry per type, keyed by fullPath.
				// The class body cannot see the runtime-installed subtype
				// constructor, so `this` re-grounds to the tactica
				// Registry type at this one boundary — the same file that
				// defines the model
				const self = this as unknown as RegistryModel;
				const registryEntry = new self.RegistryEntry({
					id       : node.fullPath,
					name     : node.name,
					filePath : parsed ? parsed.fileName : '',
					line     : parsed ? parsed.line : 0,
					column   : parsed ? parsed.column : 0
				});
				self.set(node.fullPath, registryEntry);

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
	 * Property signatures from the already-loaded Definitions model
	 * (`fields` — the type's own fields in declaration order, the same
	 * source tactica renders types.ts from). Zero file reads: definitions
	 * load before types in loadFromWorkspace. Keyed by the definitions map
	 * key (the dot-joined fullPath), so it joins with hierarchy.json
	 * fullPaths.
	 */
	private readDefinitionsFields(): Map<string, Map<string, { name: string; type: string; optional: boolean }>> {
		const result = new Map<string, Map<string, { name: string; type: string; optional: boolean }>>();

		const definitions = this.definitionsInstance;
		if (!definitions) {
			return result;
		}

		for (const [key, entry] of definitions.entries()) {
			const properties = new Map<string, { name: string; type: string; optional: boolean }>();
			for (const field of entry.fields ?? []) {
				properties.set(field.name, {
					name     : field.name,
					type     : field.type,
					optional : field.optional
				});
			}
			result.set(key, properties);
		}

		return result;
	}

	/**
	 * Load Usages from usages.json using lookup
	 */
	private loadUsages(tacticaPath: string): void {
		this.logger.info('[Registry] : loading Usages');

		try {
			const UsagesConstructor = Backend.lookup('Usages');
			const usagesInstance = new UsagesConstructor();
			this.usagesInstance = usagesInstance;

			// Note: Usages doesn't have loadFromFile, we need to populate it manually
			const data = this.readTacticaJson<rawUsagesFile>(tacticaPath, 'usages');
			if (data) {
				this.loadKeyedEntries('Usages', data.usages, usagesInstance, (raw) => {
					const entry = new usagesInstance.UsageEntry(raw);
					return entry;
				});
			}
		} catch (error) {
			this.logger.error('[Registry] : failed to load Usages', error);
			throw error;
		}
	}

	/**
	 * Load EDS from eds.json using lookup
	 */
	private loadEDS(tacticaPath: string): void {
		this.logger.info('[Registry] : loading EDS');

		try {
			const EDSConstructor = Backend.lookup('EDS');
			const edsInstance = new EDSConstructor();
			this.edsInstance = edsInstance;

			const data = this.readTacticaJson<rawEDSFile>(tacticaPath, 'eds');
			if (!data) {
				return;
			}

			// tactica only writes eds.json when EDS data exists, so a
			// stale file can linger after the data is gone (audit B11).
			// When both files carry generatedAt, an eds.json older
			// than definitions.json is skipped as stale. The stamp of
			// the already-loaded definitions.json is reused — no re-read.
			if (data.generatedAt) {
				const definitionsGeneratedAt = this.generatedAts.get('definitions');
				if (definitionsGeneratedAt && data.generatedAt < definitionsGeneratedAt) {
					this.logger.warn('[Registry] : eds.json is older than definitions.json — skipping as stale');
					return;
				}
			}

			this.loadKeyedEntries('EDS', data.eds, edsInstance, (raw) => {
				const entry = new edsInstance.EDSEntry(raw);
				return entry;
			});
		} catch (error) {
			this.logger.error('[Registry] : failed to load EDS', error);
			throw error;
		}
	}

	/**
	 * Load Flow from flow.json using lookup
	 */
	private loadFlow(tacticaPath: string): void {
		this.logger.info('[Registry] : loading Flow');

		try {
			const FlowConstructor = Backend.lookup('Flow');
			const flowInstance = new FlowConstructor();
			this.flowInstance = flowInstance;

			const data = this.readTacticaJson<rawFlowFile>(tacticaPath, 'flow');
			if (data) {
				this.loadKeyedEntries('Flow', data.flow, flowInstance, (raw) => {
					const entry = new flowInstance.FlowEntry(raw);
					return entry;
				});
			}
		} catch (error) {
			this.logger.error('[Registry] : failed to load Flow', error);
			throw error;
		}
	}

	/**
	 * One body for the type-keyed contract files (usages / eds / flow):
	 * tactica's entries carry no typeName (audit B7) — the map key is
	 * stamped on; each entry is wrapped as the model's *Entry subtype and
	 * set under the key (the same shape the reference provider builds, B8).
	 */
	private loadKeyedEntries<Entry, Raw extends object>(
		label: string,
		section: Record<string, Array<Raw>> | undefined,
		model: { set (key: string, entries: Entry[]): void; readonly size: number },
		makeEntry: (stamped: Raw & { typeName: string }) => Entry
	): void {
		if (!section) {
			return;
		}
		for (const [key, value] of Object.entries(section)) {
			const entries = value.map((raw) => makeEntry(Object.assign({ typeName: key }, raw)));
			model.set(key, entries);
		}
		this.logger.info(`[Registry] : ${label} loaded with ${model.size} entries`);
	}

	/**
	 * Load Control from control.json using lookup: the callers graph (call
	 * paths from entry points down to every `new` site) and the
	 * plugin-supplied framework points. instrumentation.json is never read
	 * — control.json is the lethe-contract rendering of that data.
	 */
	private loadControl(tacticaPath: string): void {
		this.logger.info('[Registry] : loading Control');

		try {
			const ControlConstructor = Backend.lookup('Control');
			const controlInstance = new ControlConstructor();
			this.controlInstance = controlInstance;

			const data = this.readTacticaJson<rawControlFile>(tacticaPath, 'control');
			if (!data) {
				controlInstance.setCallersAbsentReason('missing');
				return;
			}

			// Same stale guard as eds.json: a file older than
			// definitions.json belongs to a previous analysis pass. The
			// stamp of the already-loaded definitions.json is reused — no
			// re-read.
			if (data.generatedAt) {
				const definitionsGeneratedAt = this.generatedAts.get('definitions');
				if (definitionsGeneratedAt && data.generatedAt < definitionsGeneratedAt) {
					this.logger.warn('[Registry] : control.json is older than definitions.json — skipping as stale');
					controlInstance.setCallersAbsentReason('stale');
					return;
				}
			}

			if (Array.isArray(data.points)) {
				const entries = data.points.map((p) => {
					return new controlInstance.ControlPoint(p);
				});
				controlInstance.set(entries);
			}

			// The schema guarantees callers.nodes/edges/anchors — a file
			// without them failed validation above and never reaches here
			controlInstance.setCallers(data.callers);
			this.logger.info(`[Registry] : callers loaded with ${data.callers.nodes.length} nodes, ${data.callers.edges.length} edges, ${data.callers.anchors.length} anchors`);
			this.logger.info(`[Registry] : Control loaded with ${controlInstance.size} points`);
		} catch (error) {
			this.logger.error('[Registry] : failed to load Control', error);
			throw error;
		}
	}

	/**
	 * Load the collections manifest from collections.json (collection id →
	 * display name). Tolerant: the labels are cosmetic, so a missing or
	 * invalid manifest only means the panel shows raw ids — never a failed
	 * load.
	 */
	private loadCollections(tacticaPath: string): void {
		const data = this.readTacticaJson<collectionsFile>(tacticaPath, 'collections');
		if (!data) {
			return;
		}
		try {
			for (const entry of data.collections) {
				// The default collection's manifest id is null; the graph
				// keys it 'defaultTypes' (unprefixed fullPaths ARE its
				// identity)
				const key = entry.id === null ? DEFAULT_COLLECTION : entry.id;
				this.collectionNames.set(key, entry.name);
			}
			this.logger.info(`[Registry] : collections manifest loaded with ${this.collectionNames.size} entries`);
		} catch (error) {
			this.logger.warn(`[Registry] : collections.json unreadable — labels fall back to raw ids (${(error as Error).message})`);
		}
	}

	/**
	 * Initialize Trie using lookup
	 */
	private loadTrie(): void {
		this.logger.info('[Registry] : loading Trie');

		try {
			const TrieConstructor = Backend.lookup('Trie');
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
	 * Get the Control instance
	 */
	getControl(): Control | undefined {
		return this.controlInstance;
	}

	/**
	 * Get the Trie instance
	 */
	getTrie(): Trie | undefined {
		return this.trieInstance;
	}

	/**
	 * Collection id → display name from collections.json. Empty when the
	 * manifest is absent — consumers fall back to raw ids.
	 */
	getCollectionNames(): Map<string, string> {
		return this.collectionNames;
	}
});

export const RegistryEntry = Registry.define('RegistryEntry', function (
	this: registryEntry,
	data: registryEntry
) {
	setProps(this, data);
});

export default Registry;
