'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { GraphData } from '../types';
import { TacticaAdapter } from './tactica';
import { GraphConverter } from './converter';
import { Definition, Link } from '../models';

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

/**
 * Provides graph data for visualization using mnemonica instances
 */
export class GraphProvider {
	private graphData: GraphData | null = null;
	private tacticaAdapter: TacticaAdapter;
	private cacheKey: string | null = null;
	private definitions: Map<string, InstanceType<typeof Definition>> = new Map();
	private links: InstanceType<typeof Link>[] = [];

	constructor () {
		this.tacticaAdapter = new TacticaAdapter();
	}

	/**
	 * Load graph data from workspace using mnemonica instances
	 */
	async loadGraph (workspacePath: string): Promise<GraphData> {
		console.log('[Mnemonica] Loading graph from:', workspacePath);

		// Check cache
		const cacheKey = `${workspacePath}:${Date.now()}`;
		if (this.cacheKey === cacheKey && this.graphData) {
			console.log('[Mnemonica] Returning cached data');
			return this.graphData;
		}

		// Load definitions from .tactica/definitions.json
		await this.loadDefinitions(workspacePath);

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
	 * Load definitions from .tactica/definitions.json and create mnemonica instances
	 */
	private async loadDefinitions (workspacePath: string): Promise<void> {
		const definitionsPath = path.join(workspacePath, '.tactica', 'definitions.json');

		if (!fs.existsSync(definitionsPath)) {
			console.log('[Mnemonica] No definitions.json found');
			return;
		}

		const content = fs.readFileSync(definitionsPath, 'utf-8');
		const data: DefinitionsJson = JSON.parse(content);

		// Create Definition instances
		for (const [name, info] of Object.entries(data.definitions)) {
			const def = new Definition({
				id: `${name}:${info.line}:${info.column}`,
				name: info.name,
				fullPath: info.filePath,
				properties: new Map()
			});
			this.definitions.set(name, def);
		}

		// Create Link instances for parent relationships
		for (const [name, info] of Object.entries(data.definitions)) {
			if (info.parent) {
				const child = this.definitions.get(name);
				const parent = this.definitions.get(info.parent);
				if (child && parent) {
					const link = new Link({
						source: parent,
						target: child,
						relation: 'extends'
					});
					this.links.push(link);
				}
			}
		}

		console.log('[Mnemonica] Created', this.definitions.size, 'Definition instances');
		console.log('[Mnemonica] Created', this.links.length, 'Link instances');
	}

	/**
	 * Get cached graph data
	 */
	getGraphData (): GraphData | null {
		return this.graphData;
	}

	/**
	 * Get mnemonica definition instances
	 */
	getDefinitions (): Map<string, InstanceType<typeof Definition>> {
		return this.definitions;
	}

	/**
	 * Get mnemonica link instances
	 */
	getLinks (): InstanceType<typeof Link>[] {
		return this.links;
	}

	/**
	 * Clear cached data
	 */
	clearCache (): void {
		this.graphData = null;
		this.cacheKey = null;
		this.definitions.clear();
		this.links = [];
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
		mnemonicaDefinitions: number;
		mnemonicaLinks: number;
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
			maxDepth: stats.maxDepth,
			mnemonicaDefinitions: this.definitions.size,
			mnemonicaLinks: this.links.length
		};
	}
}
