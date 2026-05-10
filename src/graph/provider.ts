'use strict';

import { GraphData } from '../types';
import { getLogger } from '../services/LoggerService';
import type { MainOrchestrator } from '../core/MainOrchestrator';

/**
 * Provides graph data for visualization using MainOrchestrator
 */
export class GraphProvider {
	private mainOrchestrator: MainOrchestrator | undefined;

	constructor (mainOrchestrator?: MainOrchestrator) {
		this.mainOrchestrator = mainOrchestrator;
	}

	/**
	 * Load graph data from MainOrchestrator
	 */
	async loadGraph (_workspacePath: string): Promise<GraphData> {
		const logger = getLogger();

		if (!this.mainOrchestrator) {
			throw new Error('MainOrchestrator not set');
		}

		const graphData = this.mainOrchestrator.getGraphData();
		if (!graphData) {
			throw new Error('No graph data available. Make sure workspace is loaded.');
		}

		logger.info(`[GraphProvider] Returning graph with ${graphData.nodes.length} nodes and ${graphData.links.length} links`);
		return graphData;
	}

	/**
	 * Clear cached data
	 */
	clearCache (): void {
		const logger = getLogger();
		logger.info('[GraphProvider] Cache cleared');
	}

	/**
	 * Get statistics about loaded data
	 */
	getStats (): { definitions: number; links: number; nodes: number } {
		const graphData = this.mainOrchestrator?.getGraphData();
		return {
			definitions: 0,
			links: graphData?.links.length ?? 0,
			nodes: graphData?.nodes.length ?? 0
		};
	}
}
