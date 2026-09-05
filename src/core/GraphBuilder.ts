'use strict';

import { GraphData, D3CreationNode, D3CreationLink, D3WrapperNode, D3WrapperLink, D3InternalNode, D3InternalLink } from '../types';
import { GraphConverter } from '../graph/converter';
import { INTERNAL_KNOTS, INTERNAL_EDGES, COLLECTION_HOOKUP_EDGE } from '../graph/internals-manifest';
import { TypeNode } from '../types/tactica-types';
import type { Registry } from '../../.tactica/types';
import type { rawCreationGraph } from '../models/Instrumentation';
import { getLogger } from '../services/LoggerService';

/**
 * Pure graph builder - constructs graph data from registry without VS Code dependencies
 */
export class GraphBuilder {
	/**
	 * Build graph data from registry's type definitions
	 */
	static buildFromRegistry(registry: Registry): GraphData {
		const logger = getLogger();
		const types = registry.getTypes();
		if (!types) {
			logger.warn('[GraphBuilder] registry.getTypes() returned undefined');
			return { nodes: [], links: [], execflow: [] };
		}

		let typeCount = 0;
		try {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			for (const _entry of types.entries()) { typeCount++; }
		} catch {
			// some mnemonica entries() may not be iterable directly
		}
		logger.info(`[GraphBuilder] types.entries() count: ${typeCount}, types.size: ${(types as unknown as { size?: number }).size ?? 'unknown'}`);

		// Pass 1: create all TypeNodes
		const nodeMap = new Map<string, TypeNode>();
		const typeNodes: TypeNode[] = [];
		for (const [name, entry] of types.entries()) {
			const typeNode = this.buildTypeNode(name, entry as unknown as Record<string, unknown>);
			if (typeNode) {
				nodeMap.set(name, typeNode);
				typeNodes.push(typeNode);
			}
		}
		logger.info(`[GraphBuilder] built ${typeNodes.length} typeNodes`);

		// Pass 2: wire parent-child relationships
		for (const [name, entry] of types.entries()) {
			const node = nodeMap.get(name);
			if (!node) { continue; }

			const info = entry as unknown as { parent?: string };
			if (info.parent) {
				const parentNode = nodeMap.get(info.parent);
				if (parentNode) {
					node.parent = parentNode;
					parentNode.children.set(name, node);
				}
			}
		}

		const graphData = GraphConverter.convert(typeNodes);

		// Instantiation census (usages.json): a type with zero `new` sites
		// is never created at runtime — the EdsProbe diagnostic. Path-hits
		// sourced on such types are never taken, and attachHooks grafts
		// skip them (hooks only fire on real constructions).
		const usages = registry.getUsages();
		const instantiated = new Set<string>();
		if (usages) {
			for (const [typeName, usageEntries] of usages.entries()) {
				const list = usageEntries as unknown as Array<Record<string, unknown>>;
				if (!Array.isArray(list)) { continue; }
				if (list.some((u) => u.kind === 'instantiation')) {
					instantiated.add(typeName);
				}
			}
			for (const node of graphData.nodes) {
				if (!instantiated.has(node.id)) {
					node.neverCreated = true;
				}
			}
		}

		// Enrich nodes with EDS status
		const eds = registry.getEDS();
		if (eds) {
			// Dedupe path-hit edges: several wrap entries on one node may
			// construct the same type
			const pathHitSeen = new Set<string>();
			for (const node of graphData.nodes) {
				const edsEntries = eds.get(node.id);
				if (edsEntries && edsEntries.length > 0) {
					// Determine primary EDS kind (first entry's kind)
					const primaryKind = edsEntries[0].kind;
					node.edsStatus = this.mapEDSKind(primaryKind);
					node.edsEntries = edsEntries.map((e: unknown) => {
						const entry = e as Record<string, string>;
						return {
							kind: entry.kind,
							location: entry.location,
							code: entry.code,
							parsedLocation: this.parseLocation(entry.location)
						};
					});
					// Guaranteed path hits (tactica createsTypes): types this
					// node's wrapped scopes provably construct at runtime —
					// muscle-layer edges, rendered as the path-hit overlay
					for (const e of edsEntries) {
						const info = e as unknown as Record<string, unknown>;
						const creates = info.createsTypes;
						if (!Array.isArray(creates)) { continue; }
						for (const target of creates) {
							if (typeof target !== 'string' || !nodeMap.has(target)) { continue; }
							const dedupeKey = `${node.id}→${target}`;
							if (pathHitSeen.has(dedupeKey)) { continue; }
							pathHitSeen.add(dedupeKey);
							const hit = {
								source: node.id,
								target,
								kind: 'edsPathHit',
								location: info.location as string | undefined,
								code: info.code as string | undefined,
								neverTaken: usages ? !instantiated.has(node.id) : undefined
							};
							graphData.execflow.push(hit);
						}
					}
				} else {
					node.edsStatus = 'none';
				}
			}

			// Second pass: wrap entries whose scope is NOT a graph node
			// (module scope, non-mnemonica classes — tactica keys them
			// 'unknown' or by a foreign class name). Their createsTypes
			// knowledge is still guaranteed, but there is no source node
			// to draw a path-hit edge FROM — surface them on the CREATED
			// type's tooltip instead of dropping them silently.
			const d3ById = new Map(graphData.nodes.map((n) => [n.id, n]));
			const externalSeen = new Set<string>();
			for (const [scope, scopeEntries] of eds.entries()) {
				if (nodeMap.has(scope)) { continue; }
				for (const e of scopeEntries) {
					const info = e as unknown as Record<string, unknown>;
					const creates = info.createsTypes;
					if (!Array.isArray(creates)) { continue; }
					for (const target of creates) {
						if (typeof target !== 'string') { continue; }
						const targetNode = d3ById.get(target);
						if (!targetNode) { continue; }
						const location = info.location as string | undefined;
						const dedupeKey = `${target}←${scope}@${location ?? ''}`;
						if (externalSeen.has(dedupeKey)) { continue; }
						externalSeen.add(dedupeKey);
						const row = {
							kind     : (info.kind as string) ?? 'wrap',
							location : location ?? '',
							code     : (info.code as string) ?? '',
							scope,
							parsedLocation : location ? this.parseLocation(location) : undefined
						};
						targetNode.edsEntries = targetNode.edsEntries ?? [];
						targetNode.edsEntries.push(row);
						if (!targetNode.edsStatus || targetNode.edsStatus === 'none') {
							targetNode.edsStatus = this.mapEDSKind(row.kind);
						}
					}
				}
			}
		}

		// Enrich nodes with definition location (actual define() site).
		// definitions.json keys and node ids are both dot-joined full
		// paths, so no normalization is needed here anymore (audit B9).
		const defs = registry.getDefinitions();
		if (defs) {
			for (const node of graphData.nodes) {
				const def = defs.get(node.id);
				if (def) {
					const info = def as unknown as { location?: string };
					if (info.location) {
						const parsed = this.parseLocation(info.location);
						if (parsed) {
							node.definitionLocation = parsed;
						}
					}
				}
			}
		}

		// Populate the execflow ("muscle") layer from flow.json — edges
		// between known mnemonica types only. Flow keys or targetTypes
		// that do not resolve to graph nodes (natives like Date, or
		// classes outside the type system) are skipped (audit B3/B7).
		const flow = registry.getFlow();
		if (flow) {
			for (const [typeName, entries] of flow.entries()) {
				if (!nodeMap.has(typeName)) { continue; }
				for (const flowEntry of entries) {
					const info = flowEntry as unknown as Record<string, string | undefined>;
					const target = info.targetType;
					if (!target || !nodeMap.has(target)) { continue; }
					graphData.execflow.push({
						source: typeName,
						target,
						kind: String(info.kind || 'unknown'),
						location: info.location,
						code: info.code
					});
				}
			}
		}

		// Creation graph (instrumentation.json v2): static call chains from
		// entry points to `new` sites. Optional — a v1 instrumentation
		// payload carries no creationGraph and the section stays absent,
		// leaving every existing consumer unaffected.
		const instrumentation = registry.getInstrumentation();
		const creationGraph = instrumentation?.getCreationGraph();
		if (creationGraph) {
			graphData.creation = this.buildCreationSection(creationGraph, nodeMap);
		}

		// Wrappers graph (eds.json wrap entries): dive wrap sites, their
		// generation chains (via), the construction-mediated (ctor) fiber
		// links, and the joins to creation scopes and wrapped types.
		// Absent when EDS is disabled or carries no wraps.
		if (eds) {
			const wrappers = this.buildWrappersSection(eds, nodeMap, creationGraph);
			if (wrappers.nodes.length > 0) {
				graphData.wrappers = wrappers;
				// Combined Dive backplane (declared —
				// graph/internals-manifest.ts): the EDS ring, the
				// attachHooks hub with its per-type grafts, and the
				// adapter sinks. Emitted only when dive wiring is visible
				// — no wraps, no backplane
				graphData.internals = this.buildInternalsSection(nodeMap, usages ? instantiated : undefined);
			}
		}

		return graphData;
	}

	/**
	 * Assemble the combined Dive backplane: the declared ring/hub/sink
	 * knots, the directed export path (ring → providers/filter → Jaeger),
	 * the collection→hub hookup, and the attachHooks grafts — one per
	 * type whose construction really happens (never-created types are
	 * excluded: hooks never fire for them). Declared, not discovered: the
	 * calls live inside dive/adapter packages, no analyzer over the
	 * workspace can see them — the manifest cites the sources it mirrors.
	 */
	private static buildInternalsSection(
		nodeMap: Map<string, TypeNode>,
		instantiated?: Set<string>
	): { nodes: D3InternalNode[]; links: D3InternalLink[]; grafts: string[] } {
		const nodes: D3InternalNode[] = INTERNAL_KNOTS.map(knot => ({
			id        : knot.id,
			name      : knot.name,
			role      : knot.role,
			citation  : knot.citation,
		}));
		const links: D3InternalLink[] = INTERNAL_EDGES.map(edge => ({
			source : edge.source,
			target : edge.target,
			kind   : 'sink' as const,
			label  : edge.label,
		}));
		links.push({
			source : COLLECTION_HOOKUP_EDGE.source,
			target : COLLECTION_HOOKUP_EDGE.target,
			kind   : 'hookup',
		});
		const grafts: string[] = [];
		for (const typeId of nodeMap.keys()) {
			if (instantiated && !instantiated.has(typeId)) { continue; }
			grafts.push(typeId);
		}
		const result = { nodes, links, grafts };
		return result;
	}

	/**
	 * Convert the raw creationGraph into the GraphData creation section.
	 * Anchors join to the type graph by dot-joined fullPath; anchors
	 * naming types absent from the hierarchy are dropped (same policy as
	 * the execflow layer — no dangling references), and edges whose
	 * endpoints are not known scopes are skipped.
	 */
	private static buildCreationSection(
		graph: rawCreationGraph,
		nodeMap: Map<string, TypeNode>
	): { nodes: D3CreationNode[]; links: D3CreationLink[] } {
		const createsByHolder = new Map<string, D3CreationNode['creates']>();
		for (const anchor of graph.anchors) {
			if (!nodeMap.has(anchor.typePath)) { continue; }
			let list = createsByHolder.get(anchor.holderScopeId);
			if (!list) {
				list = [];
				createsByHolder.set(anchor.holderScopeId, list);
			}
			list.push({
				typePath        : anchor.typePath,
				location        : this.parseLocation(anchor.location),
				constructorText : anchor.constructorText,
				variable        : anchor.variable,
				rooted          : anchor.rooted,
				terminatedAt    : anchor.terminatedAt
			});
		}

		const nodes: D3CreationNode[] = graph.nodes.map((node) => {
			// Module scope names are full file paths — the basename is the
			// displayable name. Anonymous function scopes arrive named
			// "filePath:line" — shorten those to "basename:line" too
			// (named functions/methods arrive short already).
			const baseName = node.filePath.split('/').pop() || node.name;
			let name = node.name;
			if (node.kind === 'module') {
				name = baseName;
			} else if (name.startsWith(node.filePath)) {
				name = baseName + name.slice(node.filePath.length);
			}
			const creationNode: D3CreationNode = {
				id       : node.scopeId,
				name,
				kind     : node.kind,
				filePath : node.filePath,
				location : this.parseLocation(node.location),
				starter  : Boolean(node.starter),
				creates  : createsByHolder.get(node.scopeId) ?? []
			};
			return creationNode;
		});

		const known = new Set(nodes.map((n) => n.id));
		const links: D3CreationLink[] = [];
		for (const edge of graph.edges) {
			if (!known.has(edge.caller) || !known.has(edge.callee)) { continue; }
			links.push({ source: edge.caller, target: edge.callee });
		}

		const section = { nodes, links };
		return section;
	}

	/**
	 * Convert eds.json wrap entries into the GraphData wrappers section.
	 * One node per wrap call site (the location is the id). Generations
	 * walk the `via` chain: a wrap with no known parent is gen-0, every
	 * child one generation past its parent. Joins to the creation graph
	 * (callback scope preferred, holder scope as fallback) and to the
	 * type graph (wrapsTypePath) survive only when their target exists —
	 * the same no-dangling-reference policy as the execflow layer.
	 */
	private static buildWrappersSection(
		eds: { entries(): IterableIterator<[string, unknown[]]> },
		nodeMap: Map<string, TypeNode>,
		creationGraph?: rawCreationGraph
	): { nodes: D3WrapperNode[]; links: D3WrapperLink[] } {
		const creationScopeIds = new Set<string>(
			(creationGraph?.nodes ?? []).map((node) => node.scopeId)
		);

		const nodes: D3WrapperNode[] = [];
		const byId = new Map<string, D3WrapperNode>();
		const viaById = new Map<string, string>();
		// Per-site EDS scope key (the type hosting the wrap's define
		// handler, or 'unknown' for module scopes) and createsTypes — the
		// raw material of construction-mediated (ctor) fiber links
		const scopeById = new Map<string, string>();
		const createsById = new Map<string, string[]>();
		for (const [scopeKey, entries ] of eds.entries()) {
			for (const e of entries) {
				const info = e as Record<string, unknown>;
				if (info.kind !== 'wrap' || typeof info.location !== 'string') { continue; }
				if (byId.has(info.location)) { continue; }
				const parsed = this.parseLocation(info.location);
				const label = typeof info.label === 'string' ? info.label : undefined;
				const baseName = parsed ? parsed.fileName.split('/').pop() : undefined;
				const name = label ?? (baseName && parsed ? `${baseName}:${parsed.line}` : info.location);
				const node: D3WrapperNode = {
					id         : info.location,
					name,
					generation : 0,
					location   : parsed,
					label,
					code       : typeof info.code === 'string' ? info.code : undefined
				};
				const callbackScopeId = info.callbackScopeId;
				const holderScopeId = info.scopeId;
				if (typeof callbackScopeId === 'string' && creationScopeIds.has(callbackScopeId)) {
					node.callbackScopeId = callbackScopeId;
				} else if (typeof holderScopeId === 'string' && creationScopeIds.has(holderScopeId)) {
					node.holderScopeId = holderScopeId;
				}
				const wrapsTypePath = info.wrapsTypePath;
				if (typeof wrapsTypePath === 'string' && nodeMap.has(wrapsTypePath)) {
					node.wrapsTypePath = wrapsTypePath;
				}
				if (typeof info.via === 'string') {
					viaById.set(node.id, info.via);
				}
				scopeById.set(node.id, scopeKey);
				// The scope key naming a known type means the wrap call
				// lives inside that type's define handler — the instance
				// PRODUCED this wrap (drawn as a directed sphere → bagel edge)
				if (nodeMap.has(scopeKey)) {
					node.hostTypePath = scopeKey;
				}
				if (Array.isArray(info.createsTypes)) {
					const creates = info.createsTypes.filter((t): t is string => typeof t === 'string');
					if (creates.length > 0) {
						createsById.set(node.id, creates);
					}
				}
				byId.set(node.id, node);
				nodes.push(node);
			}
		}

		// Memoized with a cycle guard — a via loop collapses to gen-0
		// instead of recursing forever
		const generationCache = new Map<string, number>();
		const generationOf = (id: string, trail: Set<string>): number => {
			const cached = generationCache.get(id);
			if (cached !== undefined) { return cached; }
			if (trail.has(id)) { return 0; }
			trail.add(id);
			const via = viaById.get(id);
			let generation = 0;
			if (via !== undefined && byId.has(via)) {
				generation = generationOf(via, trail) + 1;
			}
			generationCache.set(id, generation);
			return generation;
		};

		const links: D3WrapperLink[] = [];
		for (const node of nodes) {
			node.generation = generationOf(node.id, new Set());
			const via = viaById.get(node.id);
			if (via !== undefined && byId.has(via)) {
				links.push({ source: via, target: node.id, kind: 'via' });
			}
		}

		// Construction-mediated ancestry (the T → W2 hop): a wrap whose
		// callback constructs type T is the runtime ancestor of every wrap
		// running in the context of a T instance — hosted by T's define
		// handler, or wrapping a T instance (wrapsTypePath). At runtime the
		// child's first edge parents on T's create edge via attachHooks'
		// postCreation recordCreation
		const ctorSeen = new Set<string>();
		for (const node of nodes) {
			const creates = createsById.get(node.id);
			if (!creates) { continue; }
			for (const typePath of creates) {
				for (const child of nodes) {
					if (child.id === node.id) { continue; }
					if (scopeById.get(child.id) !== typePath && child.wrapsTypePath !== typePath) { continue; }
					const dedupeKey = `${node.id}→${child.id}@${typePath}`;
					if (ctorSeen.has(dedupeKey)) { continue; }
					ctorSeen.add(dedupeKey);
					links.push({ source: node.id, target: child.id, kind: 'ctor', viaType: typePath });
				}
			}
		}

		const section = { nodes, links };
		return section;
	}

	private static parseLocation(location: string): { fileName: string; line: number; column: number } | undefined {
		const match = location.match(/^(.+):(\d+):(\d+)$/);
		if (!match) { return undefined; }
		return {
			fileName: match[1],
			line: parseInt(match[2], 10),
			column: parseInt(match[3], 10)
		};
	}

	private static mapEDSKind(kind: string): 'wrap' | 'link' | 'context' | 'hook' | 'error' | 'adapter' {
		switch (kind) {
			case 'wrap': return 'wrap';
			case 'link': return 'link';
			case 'contextConsume': return 'context';
			case 'hookAttach': return 'hook';
			case 'errorEnrich': return 'error';
			case 'adapterUse': return 'adapter';
			default: return 'wrap';
		}
	}

	private static buildTypeNode(name: string, entry: Record<string, unknown>): TypeNode | undefined {
		if (!entry) {
			return undefined;
		}

		const properties = new Map<string, { name: string; type: string; optional: boolean }>();
		if (entry.properties instanceof Map) {
			for (const [propName, propValue] of entry.properties.entries()) {
				if (typeof propValue === 'object' && propValue !== null) {
					const pv = propValue as Record<string, unknown>;
					properties.set(propName, {
						name: propName,
						type: String(pv.type || 'unknown'),
						optional: Boolean(pv.optional)
					});
				}
			}
		}

		// entry.location (from hierarchy.json) points at the real
		// define() site, 1-based
		const location = this.parseLocation(String(entry.location || ''));

		return {
			name: String(entry.name || name),
			fullPath: name,
			properties,
			children: new Map(),
			parent: undefined,
			sourceFile: location ? location.fileName : '',
			line: location ? location.line : Number(entry.lineNumber || 0),
			column: location ? location.column : 0
		} as TypeNode;
	}

	static getStats(graphData: GraphData): {
		nodeCount: number;
		linkCount: number;
		maxDepth: number;
	} {
		const stats = GraphConverter.getDepthStats(graphData.nodes);
		return {
			nodeCount: graphData.nodes.length,
			linkCount: graphData.links.length,
			maxDepth: stats.maxDepth
		};
	}
}
