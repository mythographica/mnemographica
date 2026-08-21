'use strict';

import { lookup } from 'mnemonica';
import type { Main as MainType, Registry } from '../../.tactica/types';
import { StateManager } from './StateManager';
import { GraphBuilder } from './GraphBuilder';
import { GraphData } from '../types';

export class MainOrchestrator {
	private main: MainType;
	private stateManager: StateManager;
	private registry: Registry;
	private currentGraphData: GraphData | undefined;

	constructor(version: string) {
		const Main = lookup('Main');
		this.main = new Main(version);
		this.stateManager = new StateManager();
		const Registry = lookup('Registry');
		this.registry = new Registry();
	}

	getStateManager(): StateManager {
		return this.stateManager;
	}

	getRegistry() {
		return this.registry;
	}

	async loadWorkspace(workspacePath: string): Promise<void> {
		this.stateManager.setLoading(true);
		this.stateManager.clearError();

		try {
			this.stateManager.setWorkspacePath(workspacePath);
			await this.registry.loadFromWorkspace(workspacePath);

			this.currentGraphData = GraphBuilder.buildFromRegistry(this.registry);

			this.stateManager.setLoading(false);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.stateManager.setError(message);
			this.stateManager.setLoading(false);
			throw error;
		}
	}

	async refresh(): Promise<void> {
		const workspacePath = this.stateManager.getState().workspacePath;
		if (!workspacePath) { return; }
		this.registry.clear();
		await this.loadWorkspace(workspacePath);
	}

	getGraphData(): GraphData | undefined {
		return this.currentGraphData;
	}

	getGraphStats(): { nodeCount: number; linkCount: number; maxDepth: number } | undefined {
		if (!this.currentGraphData) { return undefined; }
		return GraphBuilder.getStats(this.currentGraphData);
	}

	getMain(): MainType {
		return this.main;
	}

	dispose(): void {
		this.currentGraphData = undefined;
		this.registry.clear();
	}
}
