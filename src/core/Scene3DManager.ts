'use strict';

import { Scene3D, GraphNode3D, Link3D } from '../models/Scene3D';
import { GraphData, D3Node, D3Link } from '../types';

type Scene3DInstance = InstanceType<typeof Scene3D> & {
	Camera3D: unknown;
	GraphNode3D: typeof GraphNode3D;
	Link3D: typeof Link3D;
};

export class Scene3DManager {
	private scene: Scene3DInstance;
	private nodeMap: Map<string, InstanceType<typeof GraphNode3D>> = new Map();
	private linkMap: Map<string, InstanceType<typeof Link3D>> = new Map();

	constructor(graphData?: GraphData) {
		this.scene = new Scene3D() as Scene3DInstance;
		if (graphData) {
			this.loadGraph(graphData);
		}
	}

	loadGraph(graphData: GraphData): void {
		this.clear();
		new (this.scene.Camera3D as new (data: unknown) => unknown)({
			x: 0, y: 0, z: 500, zoom: 1, rotationX: 0, rotationY: 0
		});

		for (const nodeData of graphData.nodes) {
			this.createNode(nodeData);
		}
		for (const linkData of graphData.links) {
			this.createLink(linkData);
		}
	}

	createNode(data: D3Node): InstanceType<typeof GraphNode3D> {
		const node = new this.scene.GraphNode3D({
			id: data.id,
			label: data.name || data.id,
			x: data.x || 0,
			y: data.y || 0,
			z: 0,
			radius: 5,
			color: '#69b3a2'
		});
		this.nodeMap.set(data.id, node);
		return node;
	}

	createLink(data: D3Link): InstanceType<typeof Link3D> | undefined {
		const sourceId = typeof data.source === 'string' ? data.source : data.source.id;
		const targetId = typeof data.target === 'string' ? data.target : data.target.id;

		const source = this.nodeMap.get(sourceId);
		const target = this.nodeMap.get(targetId);
		if (!source || !target) { return undefined; }

		const link = new this.scene.Link3D({ source, target, strength: 1 });
		this.linkMap.set(`${sourceId}-${targetId}`, link);
		return link;
	}

	getNode(id: string): InstanceType<typeof GraphNode3D> | undefined {
		return this.nodeMap.get(id);
	}

	getNodes(): InstanceType<typeof GraphNode3D>[] {
		return Array.from(this.nodeMap.values());
	}

	updateNodePosition(id: string, x: number, y: number, z: number): void {
		const node = this.nodeMap.get(id);
		if (node) {
			node.x = x;
			node.y = y;
			node.z = z;
		}
	}

	getScene(): Scene3DInstance {
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
