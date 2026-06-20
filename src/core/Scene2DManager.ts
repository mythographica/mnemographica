'use strict';

import { lookup } from 'mnemonica';
import type { Scene2D as Scene2DType, Scene2D_GraphNode2D, Scene2D_Link2D } from '../../.tactica/types';
import { GraphData, D3Node, D3Link } from '../types';

export class Scene2DManager {
	private scene: Scene2DType;
	private nodeMap: Map<string, Scene2D_GraphNode2D> = new Map();
	private linkMap: Map<string, Scene2D_Link2D> = new Map();

	constructor(graphData?: GraphData) {
		const Scene2D = lookup('Scene2D');
		this.scene = new Scene2D();
		if (graphData) {
			this.loadGraph(graphData);
		}
	}

	loadGraph(graphData: GraphData): void {
		this.clear();
		new this.scene.Camera2D({ x: 0, y: 0, zoom: 1 });

		for (const nodeData of graphData.nodes) {
			this.createNode(nodeData);
		}
		for (const linkData of graphData.links) {
			this.createLink(linkData);
		}
	}

	createNode(data: D3Node): Scene2D_GraphNode2D {
		const node = new this.scene.GraphNode2D({
			id: data.id,
			label: data.name || data.id,
			x: data.x || 0,
			y: data.y || 0,
			radius: 5,
			color: '#69b3a2'
		});
		this.nodeMap.set(data.id, node);
		return node;
	}

	createLink(data: D3Link): Scene2D_Link2D | undefined {
		const sourceId = typeof data.source === 'string' ? data.source : data.source.id;
		const targetId = typeof data.target === 'string' ? data.target : data.target.id;

		const source = this.nodeMap.get(sourceId);
		const target = this.nodeMap.get(targetId);
		if (!source || !target) { return undefined; }

		const link = new this.scene.Link2D({ source, target, strength: 1 });
		this.linkMap.set(`${sourceId}-${targetId}`, link);
		return link;
	}

	getNode(id: string): Scene2D_GraphNode2D | undefined {
		return this.nodeMap.get(id);
	}

	getNodes(): Scene2D_GraphNode2D[] {
		return Array.from(this.nodeMap.values());
	}

	updateNodePosition(id: string, x: number, y: number): void {
		const node = this.nodeMap.get(id);
		if (node) {
			node.x = x;
			node.y = y;
		}
	}

	getScene(): Scene2DType {
		return this.scene;
	}

	clear(): void {
		this.nodeMap.clear();
		this.linkMap.clear();
	}

	getStats(): { nodeCount: number; linkCount: number } {
		return {
			nodeCount: this.nodeMap.size,
			linkCount: this.linkMap.size
		};
	}
}
