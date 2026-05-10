'use strict';

import { GraphData } from '../types';
import { GraphConverter } from '../graph/converter';
import { TypeNode } from '../types/tactica-types';
import type { Registry } from '../models/Registry';

/**
 * Pure graph builder - constructs graph data from registry without VS Code dependencies
 */
export class GraphBuilder {
	/**
	 * Build graph data from registry's type definitions
	 */
	static buildFromRegistry(registry: InstanceType<typeof Registry>): GraphData {
		const types = registry.getTypes();
		if (!types) {
			return { nodes: [], links: [] };
		}

		const typeNodes: TypeNode[] = [];
		for (const [name, entry] of types.entries()) {
			const typeNode = this.buildTypeNode(name, entry as unknown as Record<string, unknown>);
			if (typeNode) {
				typeNodes.push(typeNode);
			}
		}

		return GraphConverter.convert(typeNodes);
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
