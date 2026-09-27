'use strict';

import { Frontend } from './collections';

// The 3D scene vocabulary as mnemonica models: one Scene3D instance per
// 3D panel (keyed by the panel's .tactica source root), every visual
// shape a subtype of it. Geometry (sphere x/y/z, radii, shell layout) is
// computed inside the webview renderer and never crosses back to the
// host — the models carry the LOGICAL scene: what is in it, keyed and
// joined by the same ids the GraphData uses. SceneBuilder (src/core)
// populates a scene from GraphData; GraphPanel owns one per panel and
// updates camera/tooltip/tube as view events arrive.
//
// Scene3D is class-based like every other container model in this
// directory: tactica's type printer drops Map type arguments (a public
// `Map<string, object>` field emits a bare `Map`, TS2314), so the
// collections stay PRIVATE behind accessor methods.

export const Scene3D = Frontend.define('Scene3D', class {
	createdAt: number;
	// Set by the SceneBuilder right after construction — a class-based
	// define keeps its constructor parameterless here, matching the
	// other container models (Types, Registry, …)
	sourceRoot = '';
	// The singleton knots and the live view state — public mutable
	// fields the GraphPanel swaps as view events arrive
	ring: object | null = null;
	hub: object | null = null;
	cone: object | null = null;
	camera: object | null = null;
	tooltip: object | null = null;
	tube: object | null = null;

	private nodeMap: Map<string, object> = new Map();
	private linkList: Array<object> = [];
	private diamondMap: Map<string, object> = new Map();
	private bagelMap: Map<string, object> = new Map();
	private sinkMap: Map<string, object> = new Map();
	private captionMap: Map<string, object> = new Map();

	constructor () {
		this.createdAt = Date.now();
	}

	addNode (id: string, node: object): void {
		this.nodeMap.set(id, node);
	}

	getNode (id: string): object | undefined {
		const node = this.nodeMap.get(id);
		return node;
	}

	get nodeCount (): number {
		return this.nodeMap.size;
	}

	addLink (link: object): void {
		this.linkList.push(link);
	}

	get linkCount (): number {
		return this.linkList.length;
	}

	addDiamond (id: string, diamond: object): void {
		this.diamondMap.set(id, diamond);
	}

	get diamondCount (): number {
		return this.diamondMap.size;
	}

	addBagel (id: string, bagel: object): void {
		this.bagelMap.set(id, bagel);
	}

	get bagelCount (): number {
		return this.bagelMap.size;
	}

	addSink (id: string, sink: object): void {
		this.sinkMap.set(id, sink);
	}

	get sinkCount (): number {
		return this.sinkMap.size;
	}

	addCaption (id: string, caption: object): void {
		this.captionMap.set(id, caption);
	}

	get captionCount (): number {
		return this.captionMap.size;
	}
});

export const Camera3D = Scene3D.define('Camera3D', function (
	this: { x: number; y: number; z: number; zoom: number; rotationX: number; rotationY: number },
	data: { x: number; y: number; z: number; zoom: number; rotationX: number; rotationY: number }
) {
	// x/y/z are the orbit-center pan offset, rotationX/rotationY the
	// orbit angles, zoom the distance — the renderer's camera triple
	this.x = data.x;
	this.y = data.y;
	this.z = data.z;
	this.zoom = data.zoom;
	this.rotationX = data.rotationX;
	this.rotationY = data.rotationY;
});

export const GraphNode3D = Scene3D.define('GraphNode3D', function (
	this: {
		id: string;
		label: string;
		depth: number;
		isRoot: boolean;
		location?: { fileName: string; line: number; column: number };
	},
	data: {
		id: string;
		label: string;
		depth: number;
		isRoot: boolean;
		location?: { fileName: string; line: number; column: number };
	}
) {
	this.id = data.id;
	this.label = data.label;
	this.depth = data.depth;
	this.isRoot = data.isRoot;
	this.location = data.location;
});

export const Link3D = Scene3D.define('Link3D', function (
	this: { source: string; target: string; kind: string },
	data: { source: string; target: string; kind: string }
) {
	// One arrows model for every directed edge the scene draws; kind
	// discriminates: inheritance | the execflow kinds | creation |
	// fiber-via | fiber-ctor | sink | hookup
	this.source = data.source;
	this.target = data.target;
	this.kind = data.kind;
});

export const Tooltip3D = GraphNode3D.define('Tooltip3D', function (
	this: { targetNode: string; content: string; visible: boolean },
	data: { targetNode: string; content: string; visible: boolean }
) {
	// Constructed from the sphere instance it describes — the prototype
	// chain ties the tooltip to its node
	this.targetNode = data.targetNode;
	this.content = data.content;
	this.visible = data.visible;
});

export const Diamond3D = Scene3D.define('Diamond3D', function (
	this: {
		id: string;
		name: string;
		kind: string;
		filePath: string;
		starter: boolean;
		creates: number;
	},
	data: {
		id: string;
		name: string;
		kind: string;
		filePath: string;
		starter: boolean;
		creates: number;
	}
) {
	// A creation scope (instrumentation.json v2); creates is the count of
	// `new` sites the scope holds — the per-anchor detail stays in the
	// Diamonds sidebar, the scene needs the census
	this.id = data.id;
	this.name = data.name;
	this.kind = data.kind;
	this.filePath = data.filePath;
	this.starter = data.starter;
	this.creates = data.creates;
});

export const Bagel3D = Scene3D.define('Bagel3D', function (
	this: {
		id: string;
		name: string;
		generation: number;
		anchor: string | null;
		wrapsTypePath?: string;
	},
	data: {
		id: string;
		name: string;
		generation: number;
		anchor: string | null;
		wrapsTypePath?: string;
	}
) {
	// A dive wrap site. anchor is what the ring encircles: the callback
	// scope's diamond when known, else the holding scope's, else the
	// wrapped type's sphere; null when the wrap joins nothing (ambient)
	this.id = data.id;
	this.name = data.name;
	this.generation = data.generation;
	this.anchor = data.anchor;
	this.wrapsTypePath = data.wrapsTypePath;
});

export const Ring3D = Scene3D.define('Ring3D', function (
	this: { id: string; name: string; citation?: string },
	data: { id: string; name: string; citation?: string }
) {
	// The EDS store — dive's runtime trace storage, encircling the origin
	this.id = data.id;
	this.name = data.name;
	this.citation = data.citation;
});

export const Hub3D = Scene3D.define('Hub3D', function (
	this: { id: string; name: string; citation?: string },
	data: { id: string; name: string; citation?: string }
) {
	// The attachHooks hub — bootstrap wiring whose grafts fire per
	// construction
	this.id = data.id;
	this.name = data.name;
	this.citation = data.citation;
});

export const Sink3D = Scene3D.define('Sink3D', function (
	this: { id: string; name: string; citation?: string },
	data: { id: string; name: string; citation?: string }
) {
	// An adapter sink — where a fiber's data leaves the trace system
	this.id = data.id;
	this.name = data.name;
	this.citation = data.citation;
});

export const Cone3D = Scene3D.define('Cone3D', function (
	this: { id: string; name: string },
	data: { id: string; name: string }
) {
	// Jaeger — the only terminal outside the system; no citation, it
	// lives in no repo of ours
	this.id = data.id;
	this.name = data.name;
});

export const Caption3D = Scene3D.define('Caption3D', function (
	this: { text: string; targetId: string },
	data: { text: string; targetId: string }
) {
	// A label sprite + leader line; targetId is the mesh it captions
	// (node id, scope id, wrap location, or knot id)
	this.text = data.text;
	this.targetId = data.targetId;
});

export const Tube3D = Scene3D.define('Tube3D', function (
	this: { id: string; chain: Array<string> },
	data: { id: string; chain: Array<string> }
) {
	// The selection glow tube: id is the focused node, chain the
	// dot-joined ancestor prefixes the tube threads
	this.id = data.id;
	this.chain = data.chain;
});

export default Scene3D;
