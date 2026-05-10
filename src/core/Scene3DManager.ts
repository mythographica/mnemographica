'use strict';

import { lookupTyped } from 'mnemonica';
import type { Scene3D as Scene3DType, Scene3D_GraphNode3D, Scene3D_Link3D } from '../../.tactica/types';
import { GraphData, D3Node, D3Link } from '../types';

export class Scene3DManager {
	private scene: Scene3DType;
	private nodeMap: Map<string, Scene3D_GraphNode3D> = new Map();
	private linkMap: Map<string, Scene3D_Link3D> = new Map();

	constructor(graphData?: GraphData) {
		const Scene3D = lookupTyped('Scene3D');
		this.scene = new Scene3D();
		if (graphData) {
			this.loadGraph(graphData);
		}
	}

	loadGraph(graphData: GraphData): void {
		this.clear();
		new this.scene.Camera3D({
			x: 0, y: 0, z: 500, zoom: 1, rotationX: 0, rotationY: 0
		});

		for (const nodeData of graphData.nodes) {
			this.createNode(nodeData);
		}
		for (const linkData of graphData.links) {
			this.createLink(linkData);
		}
	}

	createNode(data: D3Node): Scene3D_GraphNode3D {
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

	createLink(data: D3Link): Scene3D_Link3D | undefined {
		const sourceId = typeof data.source === 'string' ? data.source : data.source.id;
		const targetId = typeof data.target === 'string' ? data.target : data.target.id;

		const source = this.nodeMap.get(sourceId);
		const target = this.nodeMap.get(targetId);
		if (!source || !target) { return undefined; }

		const link = new this.scene.Link3D({ source, target, strength: 1 });
		this.linkMap.set(`${sourceId}-${targetId}`, link);
		return link;
	}

	getNode(id: string): Scene3D_GraphNode3D | undefined {
		return this.nodeMap.get(id);
	}

	getNodes(): Scene3D_GraphNode3D[] {
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

	getScene(): Scene3DType {
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
