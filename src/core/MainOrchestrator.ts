'use strict';

import { lookup } from 'mnemonica';
import type { Main as MainType, Registry } from '../../.tactica/types';
import { StateManager } from './StateManager';
import { GraphBuilder } from './GraphBuilder';
import { Scene2DManager } from './Scene2DManager';
import { Scene3DManager } from './Scene3DManager';
import { TrieManager } from './TrieManager';
import { GraphData } from '../types';

export class MainOrchestrator {
	private main: MainType;
	private stateManager: StateManager;
	private registry: Registry;
	private scene2d: Scene2DManager | undefined;
	private scene3d: Scene3DManager | undefined;
	private trie: TrieManager | undefined;
	private currentGraphData: GraphData | undefined;

	constructor(version: string) {
		const Main = lookup('Main');
		this.main = new Main(version);
		this.stateManager = new StateManager();
		const Registry = lookup('Registry');
		this.registry = new Registry();

		new this.main.Adapter({
			name: 'mcp', domain: 'strategy', enabled: true
		});
		new this.main.Adapter({
			name: 'vscode', domain: 'ui', enabled: true
		});
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
			this.scene2d = new Scene2DManager(this.currentGraphData);
			this.scene3d = new Scene3DManager(this.currentGraphData);
			this.trie = new TrieManager();

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

	getScene2D(): Scene2DManager | undefined {
		return this.scene2d;
	}

	getScene3D(): Scene3DManager | undefined {
		return this.scene3d;
	}

	getTrie(): TrieManager | undefined {
		return this.trie;
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
		this.scene2d = undefined;
		this.scene3d = undefined;
		this.trie = undefined;
		this.currentGraphData = undefined;
		this.registry.clear();
	}
}
