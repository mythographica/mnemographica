'use strict';

import { Backend } from './collections';

// The type trie: the Registry fills it from hierarchy.json at load —
// one GraphNodeTrie per type, one LinkTrie per parent→child edge — and
// the Types tree's context menu records a ContextMenu per invocation.
// Class-based like every other container model: tactica's type printer
// drops Map type arguments, so the collections stay private behind
// accessor methods.

export const Trie = Backend.define('Trie', class {
	createdAt: number;

	private nodeMap: Map<string, object> = new Map();
	private linkList: Array<object> = [];
	private menuList: Array<object> = [];

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

	addMenu (menu: object): void {
		this.menuList.push(menu);
	}

	get menuCount (): number {
		return this.menuList.length;
	}
});

export const GraphNodeTrie = Trie.define('GraphNodeTrie', function (
	this: { id: string; name: string; path: string; depth: number; isLeaf: boolean },
	data: { id: string; name: string; path: string; depth: number; isLeaf: boolean }
) {
	this.id = data.id;
	this.name = data.name;
	this.path = data.path;
	this.depth = data.depth;
	this.isLeaf = data.isLeaf;
});

export const LinkTrie = GraphNodeTrie.define('LinkTrie', function (
	this: { parent: unknown; child: unknown; relation: 'subtype' | 'instance' },
	data: { parent: unknown; child: unknown; relation: 'subtype' | 'instance' }
) {
	// Constructed from the child trie node — the link's prototype chain
	// ties it there
	this.parent = data.parent;
	this.child = data.child;
	this.relation = data.relation;
});

export const ContextMenu = GraphNodeTrie.define('ContextMenu', function (
	this: { targetNode: unknown; items: Array<{ label: string; action: string }>; visible: boolean },
	data: { targetNode: unknown; items: Array<{ label: string; action: string }>; visible: boolean }
) {
	// One instance per context-menu invocation on the trie node it was
	// opened for
	this.targetNode = data.targetNode;
	this.items = data.items;
	this.visible = data.visible;
});

export default Trie;
