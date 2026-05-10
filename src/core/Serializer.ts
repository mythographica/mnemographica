'use strict';

/**
 * Serialized node for webview consumption
 */
export type SerializedNode = {
	id: string;
	name: string;
	x: number;
	y: number;
	radius: number;
	color: string;
	label: string;
	properties: Array<{ name: string; type: string }>;
};

/**
 * Serialized link for webview consumption
 */
export type SerializedLink = {
	source: string;
	target: string;
	strength: number;
};

/**
 * Serialized scene for webview
 */
export type SerializedScene = {
	nodes: SerializedNode[];
	links: SerializedLink[];
	camera: {
		x: number;
		y: number;
		zoom: number;
	};
};

/**
 * Pure serializer - converts mnemonica instances to/from JSON
 */
export class Serializer {
	/**
	 * Serialize a 2D scene for webview transmission
	 */
	static serializeScene2D(scene: unknown): SerializedScene {
		// Extract data from mnemonica instance
		const instance = scene as Record<string, unknown>;

		const nodes: SerializedNode[] = [];
		const links: SerializedLink[] = [];

		// Serialize graph nodes
		if (instance.graphNodes && Array.isArray(instance.graphNodes)) {
			for (const node of instance.graphNodes) {
				const n = node as Record<string, unknown>;
				nodes.push({
					id: String(n.id || ''),
					name: String(n.name || n.id || ''),
					x: Number(n.x || 0),
					y: Number(n.y || 0),
					radius: Number(n.radius || 5),
					color: String(n.color || '#69b3a2'),
					label: String(n.label || n.name || ''),
					properties: Array.isArray(n.properties) ? n.properties as SerializedNode['properties'] : []
				});
			}
		}

		// Serialize links
		if (instance.links && Array.isArray(instance.links)) {
			for (const link of instance.links) {
				const l = link as Record<string, unknown>;
				links.push({
					source: String(l.source || ''),
					target: String(l.target || ''),
					strength: Number(l.strength || 1)
				});
			}
		}

		// Serialize camera
		const camera = instance.camera as Record<string, number> | undefined;

		return {
			nodes,
			links,
			camera: {
				x: camera?.x || 0,
				y: camera?.y || 0,
				zoom: camera?.zoom || 1
			}
		};
	}

	/**
	 * Apply delta updates from webview back to scene instance
	 */
	static applyDelta(scene: unknown, delta: { nodes?: SerializedNode[]; camera?: SerializedScene['camera'] }): void {
		const instance = scene as Record<string, unknown>;

		if (delta.nodes && instance.graphNodes && Array.isArray(instance.graphNodes)) {
			for (const updatedNode of delta.nodes) {
				const existingNode = (instance.graphNodes as unknown[]).find(
					(n) => (n as Record<string, unknown>).id === updatedNode.id
				);
				if (existingNode) {
					const node = existingNode as Record<string, unknown>;
					node.x = updatedNode.x;
					node.y = updatedNode.y;
				}
			}
		}

		if (delta.camera && instance.camera) {
			const camera = instance.camera as Record<string, number>;
			camera.x = delta.camera.x;
			camera.y = delta.camera.y;
			camera.zoom = delta.camera.zoom;
		}
	}
}
