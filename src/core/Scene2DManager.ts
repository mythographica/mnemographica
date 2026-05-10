'use strict';

import { Scene2D, GraphNode2D, Link2D } from '../models/Scene2D';
import { GraphData, D3Node, D3Link } from '../types';

// Type for Scene2D instance with nested constructors
type Scene2DInstance = InstanceType<typeof Scene2D> & {
	Camera2D: typeof GraphNode2D; // Actually Camera2D constructor
	GraphNode2D: typeof GraphNode2D;
	Link2D: typeof Link2D;
};

/**
 * Scene2D Manager - wraps Scene2D mnemonica model and provides graph operations
 */
export class Scene2DManager {
	private scene: Scene2DInstance;
	private nodeMap: Map<string, InstanceType<typeof GraphNode2D>> = new Map();
	private linkMap: Map<string, InstanceType<typeof Link2D>> = new Map();

	constructor(graphData?: GraphData) {
		this.scene = new Scene2D() as Scene2DInstance;

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

	createNode(data: D3Node): InstanceType<typeof GraphNode2D> {
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

	createLink(data: D3Link): InstanceType<typeof Link2D> | undefined {
		const sourceId = typeof data.source === 'string' ? data.source : data.source.id;
		const targetId = typeof data.target === 'string' ? data.target : data.target.id;

		const source = this.nodeMap.get(sourceId);
		const target = this.nodeMap.get(targetId);
		if (!source || !target) { return undefined; }

		const link = new this.scene.Link2D({ source, target, strength: 1 });
		this.linkMap.set(`${sourceId}-${targetId}`, link);
		return link;
	}

	getNode(id: string): InstanceType<typeof GraphNode2D> | undefined {
		return this.nodeMap.get(id);
	}

	getNodes(): InstanceType<typeof GraphNode2D>[] {
		return Array.from(this.nodeMap.values());
	}

	getLinks(): InstanceType<typeof Link2D>[] {
		return Array.from(this.linkMap.values());
	}

	updateNodePosition(id: string, x: number, y: number): void {
		const node = this.nodeMap.get(id);
		if (node) {
			node.x = x;
			node.y = y;
		}
	}

	getScene(): Scene2DInstance {
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
