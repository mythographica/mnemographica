'use strict';

import { lookup } from 'mnemonica';
import type { Trie, Trie_GraphNodeTrie, Trie_GraphNodeTrie_LinkTrie } from '../../.tactica/types';
import { TypeNode } from '../types/tactica-types';

export type TreeItemData = {
	id: string;
	name: string;
	label: string;
	children?: TreeItemData[];
	isLeaf?: boolean;
	depth: number;
	location?: {
		fileName: string;
		line: number;
		column: number;
	};
};

export class TrieManager {
	private trie: Trie;
	private nodeMap: Map<string, Trie_GraphNodeTrie> = new Map();
	private rootNodes: Trie_GraphNodeTrie[] = [];
	private links: Trie_GraphNodeTrie_LinkTrie[] = [];

	constructor() {
		const TrieConstructor = lookup('Trie');
		this.trie = new TrieConstructor();
	}

	buildFromTypes(typeNodes: TypeNode[]): void {
		this.clear();

		for (const typeNode of typeNodes) {
			if (!typeNode.parent) {
				this.createNode(typeNode, 0);
			}
		}

		for (const typeNode of typeNodes) {
			if (typeNode.parent) {
				this.createNode(typeNode, this.calculateDepth(typeNode));
				this.createLink(typeNode.parent.fullPath, typeNode.fullPath, 'subtype');
			}
		}
	}

	createNode(typeNode: TypeNode, depth: number): Trie_GraphNodeTrie {
		const node = new this.trie.GraphNodeTrie({
			id: typeNode.fullPath,
			name: typeNode.name,
			path: typeNode.fullPath,
			depth,
			isLeaf: typeNode.children.size === 0
		});

		this.nodeMap.set(typeNode.fullPath, node);
		if (depth === 0) {
			this.rootNodes.push(node);
		}
		return node;
	}

	createLink(parentId: string, childId: string, relation: 'subtype' | 'instance'): Trie_GraphNodeTrie_LinkTrie | undefined {
		const parent = this.nodeMap.get(parentId);
		const child = this.nodeMap.get(childId);
		if (!parent || !child) { return undefined; }

		const LinkTrie = lookup('Trie.GraphNodeTrie.LinkTrie');
		const link = new LinkTrie({ parent, child, relation });
		this.links.push(link);
		return link;
	}

	getTreeItems(): TreeItemData[] {
		return this.rootNodes.map(node => this.toTreeItemData(node));
	}

	private toTreeItemData(node: Trie_GraphNodeTrie): TreeItemData {
		const children: TreeItemData[] = [];
		for (const link of this.links) {
			const parent = link.parent as Trie_GraphNodeTrie;
			const child = link.child as Trie_GraphNodeTrie;
			if (parent.id === node.id) {
				children.push(this.toTreeItemData(child));
			}
		}

		return {
			id: node.id,
			name: node.name,
			label: node.name,
			children: children.length > 0 ? children : undefined,
			isLeaf: node.isLeaf,
			depth: node.depth
		};
	}

	private calculateDepth(typeNode: TypeNode): number {
		let depth = 0;
		let current = typeNode.parent;
		while (current) {
			depth++;
			current = current.parent;
		}
		return depth;
	}

	getNode(id: string): Trie_GraphNodeTrie | undefined {
		return this.nodeMap.get(id);
	}

	getTrie(): Trie {
		return this.trie;
	}

	clear(): void {
		this.nodeMap.clear();
		this.rootNodes = [];
		this.links = [];
	}

	getNodeCount(): number {
		return this.nodeMap.size;
	}
}
