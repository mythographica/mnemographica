'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { GraphData } from '../types';
import { TacticaAdapter } from './tactica';
import { GraphConverter } from './converter';
import { getLogger } from '../services/LoggerService';
// Phase 3: Removed direct imports of Definition, Link from models
// Models are loaded at runtime via topologica bootstrap

type DefinitionInfo = {
	name: string;
	filePath: string;
	line: number;
	column: number;
	parent?: string;
};

type DefinitionsJson = {
	definitions: Record<string, DefinitionInfo>;
};

// Plain types for graph data (Phase 3: no mnemonica instances yet)
type DefinitionData = {
	id: string;
	name: string;
	fullPath: string;
	properties: Map<string, unknown>;
};

type LinkData = {
	source: DefinitionData;
	target: DefinitionData;
	relation: string;
};

/**
 * Provides graph data for visualization using mnemonica instances
 */
export class GraphProvider {
	private graphData: GraphData | null = null;
	private tacticaAdapter: TacticaAdapter;
	private cacheKey: string | null = null;
	private definitions: Map<string, DefinitionData> = new Map();
	private links: LinkData[] = [];

	constructor () {
		this.tacticaAdapter = new TacticaAdapter();
	}

	/**
	 * Load graph data from workspace using mnemonica instances
	 */
	async loadGraph (workspacePath: string): Promise<GraphData> {
		const logger = getLogger();
		logger.info('[Mnemonica] Loading graph from:', workspacePath);

		// Check cache
		const cacheKey = `${workspacePath}:${Date.now()}`;
		if (this.cacheKey === cacheKey && this.graphData) {
			logger.info('[Mnemonica] Returning cached data');
			return this.graphData;
		}

		// Load definitions from .tactica/definitions.json
		await this.loadDefinitions(workspacePath);

		// Load type nodes from tactica
		const typeNodes = await this.tacticaAdapter.loadTypeGraph(workspacePath);
		logger.info('[Mnemonica] Loaded', typeNodes.length, 'type nodes');

		// Convert to D3 format
		this.graphData = GraphConverter.convert(typeNodes);
		logger.info('[Mnemonica] Converted to', this.graphData.nodes.length, 'D3 nodes');

		this.cacheKey = cacheKey;

		return this.graphData;
	}

	/**
	 * Load definitions from .tactica/definitions.json and create mnemonica instances
	 */
	private async loadDefinitions (workspacePath: string): Promise<void> {
		const logger = getLogger();
		const definitionsPath = path.join(workspacePath, '.tactica', 'definitions.json');

		if (!fs.existsSync(definitionsPath)) {
			logger.warn('[Mnemonica] No definitions.json found');
			return;
		}

		const content = fs.readFileSync(definitionsPath, 'utf-8');
		const data: DefinitionsJson = JSON.parse(content);

		// Create Definition data objects (Phase 3: plain objects, not mnemonica instances)
		for (const [name, info] of Object.entries(data.definitions)) {
			const def: DefinitionData = {
				id: `${name}:${info.line}:${info.column}`,
				name: info.name,
				fullPath: info.filePath,
				properties: new Map()
			};
			this.definitions.set(name, def);
		}

		// Create links based on parent relationships
		for (const [name, info] of Object.entries(data.definitions)) {
			if (info.parent && this.definitions.has(info.parent)) {
				const source = this.definitions.get(info.parent)!;
				const target = this.definitions.get(name)!;
				this.links.push({
					source,
					target,
					relation: 'defines'
				});
			}
		}

		logger.info('[Mnemonica] Created', this.definitions.size, 'Definition instances');
		logger.info('[Mnemonica] Created', this.links.length, 'Link instances');
	}

	/**
	 * Clear cached data
	 */
	clearCache (): void {
		const logger = getLogger();
		this.graphData = null;
		this.cacheKey = null;
		this.definitions.clear();
		this.links = [];
		this.tacticaAdapter.clearCache();
		logger.info('[Mnemonica] Cache cleared');
	}

	/**
	 * Get statistics about loaded data
	 */
	getStats (): { definitions: number; links: number; nodes: number } {
		return {
			definitions: this.definitions.size,
			links: this.links.length,
			nodes: this.graphData?.nodes.length ?? 0
		};
	}
}
