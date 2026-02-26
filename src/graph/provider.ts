import { GraphData } from '../types';
import { TacticaAdapter } from './tactica';
import { GraphConverter } from './converter';

/**
 * Provides graph data for visualization
 */
export class GraphProvider {
	private graphData: GraphData | null = null;
	private tacticaAdapter: TacticaAdapter;
	private cacheKey: string | null = null;

	constructor () {
		this.tacticaAdapter = new TacticaAdapter();
	}

	/**
	 * Load graph data from workspace
	 */
	async loadGraph (workspacePath: string): Promise<GraphData> {
		console.log('[Mnemonica] Loading graph from:', workspacePath);

		// Check cache
		const cacheKey = `${workspacePath}:${Date.now()}`;
		if (this.cacheKey === cacheKey && this.graphData) {
			console.log('[Mnemonica] Returning cached data');
			return this.graphData;
		}

		// Load type nodes from tactica
		const typeNodes = await this.tacticaAdapter.loadTypeGraph(workspacePath);
		console.log('[Mnemonica] Loaded', typeNodes.length, 'type nodes');

		// Convert to D3 format
		this.graphData = GraphConverter.convert(typeNodes);
		console.log('[Mnemonica] Converted to', this.graphData.nodes.length, 'D3 nodes');

		this.cacheKey = cacheKey;

		return this.graphData;
	}

	/**
	 * Get cached graph data
	 */
	getGraphData (): GraphData | null {
		return this.graphData;
	}

	/**
	 * Clear cached data
	 */
	clearCache (): void {
		this.graphData = null;
		this.cacheKey = null;
		this.tacticaAdapter.clearCache();
	}

	/**
	 * Get graph statistics
	 */
	getStats (): {
		typeCount: number;
		relationshipCount: number;
		propertyCount: number;
		maxDepth: number;
	} | null {
		if (!this.graphData) {
			return null;
		}

		const stats = GraphConverter.getDepthStats(this.graphData.nodes);
		const propertyCount = GraphConverter.getTotalProperties(this.graphData.nodes);

		return {
			typeCount: this.graphData.nodes.length,
			relationshipCount: this.graphData.links.length,
			propertyCount,
			maxDepth: stats.maxDepth
		};
	}
}