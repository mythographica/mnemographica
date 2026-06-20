'use strict';

import { GraphData } from '../types';
import { GraphConverter } from '../graph/converter';
import { TypeNode } from '../types/tactica-types';
import type { Registry } from '../../.tactica/types';
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

		// Enrich nodes with EDS status
		const eds = registry.getEDS();
		if (eds) {
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
							code: entry.code
						};
					});
				} else {
					node.edsStatus = 'none';
				}
			}
		}

		// Enrich nodes with definition location (actual define() site)
		const defs = registry.getDefinitions();
		if (defs) {
			for (const node of graphData.nodes) {
				// Definition keys use dots (e.g. "Scene2D.GraphNode2D")
				// Node ids use underscores (e.g. "Scene2D_GraphNode2D")
				const defKey = node.id.replace(/_/g, '.');
				const def = defs.get(defKey);
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

		return graphData;
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

		return {
			name: String(entry.name || name),
			fullPath: name,
			properties,
			children: new Map(),
			parent: undefined,
			sourceFile: String(entry.fullPath || ''),
			line: Number(entry.lineNumber || 0),
			column: 0
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
