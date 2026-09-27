'use strict';

import { Frontend } from '../models/collections';
import type { FrontendRegistry_Scene3D as Scene3D } from '../../.tactica/types';
import type { D3Node, GraphData } from '../types';

/**
 * SceneBuilder — the controller for the Scene3D model family. Mirrors
 * GraphBuilder's role: GraphBuilder turns the Registry into GraphData
 * (the webview's transfer shape), SceneBuilder turns the same GraphData
 * into the panel's Scene3D instance tree — the host-side logical scene.
 *
 * The webview owns geometry; the scene owns the census: every sphere,
 * edge, diamond, bagel, sink, ring, hub, cone and caption the renderer
 * will draw, as mnemonica instances parented on the one scene root, so
 * the extension's own type graph records the 3D vocabulary as USED.
 */

// D3 link endpoints are ids at build time, but the type allows a
// resolved node reference — normalize at the boundary
const endpointId = function (end: string | D3Node): string {
	const id = typeof end === 'string' ? end : end.id;
	return id;
};

export function buildSceneFor (sourceRoot: string, graphData: GraphData): Scene3D {
	const Scene3DConstructor = Frontend.lookup('Scene3D');
	const scene = new Scene3DConstructor();
	scene.sourceRoot = sourceRoot;

	for (const node of graphData.nodes) {
		const sphere = new scene.GraphNode3D({
			id       : node.id,
			label    : node.name,
			depth    : node.depth,
			isRoot   : node.isRoot,
			location : node.location
		});
		scene.addNode(node.id, sphere);
		const caption = new scene.Caption3D({ text: node.name, targetId: node.id });
		scene.addCaption(node.id, caption);
	}

	for (const link of graphData.links) {
		const edge = new scene.Link3D({
			source : endpointId(link.source),
			target : endpointId(link.target),
			kind   : 'inheritance'
		});
		scene.addLink(edge);
	}
	for (const link of graphData.execflow) {
		const edge = new scene.Link3D({
			source : endpointId(link.source),
			target : endpointId(link.target),
			// execflow links carry their own flow kind (edsPathHit, …)
			kind   : link.kind
		});
		scene.addLink(edge);
	}

	if (graphData.creation) {
		for (const scope of graphData.creation.nodes) {
			const diamond = new scene.Diamond3D({
				id       : scope.id,
				name     : scope.name,
				kind     : scope.kind,
				filePath : scope.filePath,
				starter  : scope.starter,
				creates  : scope.creates.length
			});
			scene.addDiamond(scope.id, diamond);
			const caption = new scene.Caption3D({ text: scope.name, targetId: scope.id });
			scene.addCaption(scope.id, caption);
		}
		for (const link of graphData.creation.links) {
			const edge = new scene.Link3D({ source: link.source, target: link.target, kind: 'creation' });
			scene.addLink(edge);
		}
	}

	if (graphData.wrappers) {
		for (const wrap of graphData.wrappers.nodes) {
			// What the ring encircles: the callback scope's diamond when
			// known, else the holding scope's, else the wrapped type's
			// sphere; null when the wrap joins nothing (ambient shell)
			const anchor = wrap.callbackScopeId ?? wrap.holderScopeId ?? wrap.wrapsTypePath ?? null;
			const bagel = new scene.Bagel3D({
				id            : wrap.id,
				name          : wrap.name,
				generation    : wrap.generation,
				anchor        : anchor,
				wrapsTypePath : wrap.wrapsTypePath
			});
			scene.addBagel(wrap.id, bagel);
			const caption = new scene.Caption3D({ text: wrap.name, targetId: wrap.id });
			scene.addCaption(wrap.id, caption);
		}
		for (const link of graphData.wrappers.links) {
			const edge = new scene.Link3D({ source: link.source, target: link.target, kind: `fiber-${link.kind}` });
			scene.addLink(edge);
		}
	}

	if (graphData.internals) {
		for (const knot of graphData.internals.nodes) {
			if (knot.role === 'store') {
				scene.ring = new scene.Ring3D({ id: knot.id, name: knot.name, citation: knot.citation });
			} else if (knot.role === 'hub') {
				scene.hub = new scene.Hub3D({ id: knot.id, name: knot.name, citation: knot.citation });
			} else if (knot.role === 'sink') {
				const sink = new scene.Sink3D({ id: knot.id, name: knot.name, citation: knot.citation });
				scene.addSink(knot.id, sink);
			} else {
				// 'external' — Jaeger, the only terminal outside the system
				scene.cone = new scene.Cone3D({ id: knot.id, name: knot.name });
			}
			const caption = new scene.Caption3D({ text: knot.name, targetId: knot.id });
			scene.addCaption(knot.id, caption);
		}
		for (const link of graphData.internals.links) {
			const edge = new scene.Link3D({ source: link.source, target: link.target, kind: link.kind });
			scene.addLink(edge);
		}
	}

	return scene;
}
