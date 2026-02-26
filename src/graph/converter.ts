import { TypeNode } from '../types';
import { D3Node, D3Link, GraphData } from '../types';

/**
 * Converts tactica TypeGraph to D3-compatible format
 */
export class GraphConverter {
	/**
	 * Convert TypeNode hierarchy to D3 graph data
	 */
	static convert (typeNodes: TypeNode[]): GraphData {
		const nodes: D3Node[] = [];
		const links: D3Link[] = [];
		const visited = new Set<string>();

		// Process each root node
		for (const rootNode of typeNodes) {
			this.processNode(rootNode, 0, nodes, links, visited);
		}

		return { nodes, links };
	}

	/**
	 * Recursively process a TypeNode and its children
	 */
	private static processNode (
		typeNode: TypeNode,
		depth: number,
		nodes: D3Node[],
		links: D3Link[],
		visited: Set<string>
	): void {
		// Skip if already processed
		if (visited.has(typeNode.fullPath)) {
			return;
		}
		visited.add(typeNode.fullPath);

		// Convert properties Map to array
		const properties: Array<{ name: string; type: string; optional?: boolean }> = [];
		for (const [name, prop] of typeNode.properties) {
			properties.push({
				name,
				type: prop.type,
				optional: prop.optional
			});
		}

		// Create D3 node
		const d3Node: D3Node = {
			id: typeNode.fullPath,
			name: typeNode.name,
			depth: depth,
			isRoot: depth === 0,
			properties: properties,
			location: {
				fileName: typeNode.sourceFile,
				line: typeNode.line,
				column: typeNode.column
			}
		};
		nodes.push(d3Node);

		// Create link to parent if exists
		if (typeNode.parent) {
			links.push({
				source: typeNode.parent.fullPath,
				target: typeNode.fullPath
			});
		}

		// Process children
		for (const child of typeNode.children.values()) {
			this.processNode(child, depth + 1, nodes, links, visited);
		}
	}

	/**
	 * Calculate depth statistics for the graph
	 */
	static getDepthStats (nodes: D3Node[]): {
		maxDepth: number;
		averageDepth: number;
		typeCountByDepth: Map<number, number>;
	} {
		const depths = nodes.map(n => n.depth);
		const maxDepth = Math.max(...depths, 0);
		const averageDepth = depths.length > 0
			? depths.reduce((a, b) => a + b, 0) / depths.length
			: 0;

		const typeCountByDepth = new Map<number, number>();
		for (const node of nodes) {
			const count = typeCountByDepth.get(node.depth) || 0;
			typeCountByDepth.set(node.depth, count + 1);
		}

		return { maxDepth, averageDepth, typeCountByDepth };
	}

	/**
	 * Get total property count across all nodes
	 */
	static getTotalProperties (nodes: D3Node[]): number {
		return nodes.reduce((sum, node) => sum + node.properties.length, 0);
	}
}