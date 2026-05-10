'use strict';

import { Trie, GraphNodeTrie, LinkTrie } from '../models/Trie';
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

type TrieInstance = InstanceType<typeof Trie> & {
	GraphNodeTrie: typeof GraphNodeTrie;
	LinkTrie: typeof LinkTrie;
};

type GraphNodeTrieInstance = InstanceType<typeof GraphNodeTrie>;
type LinkTrieInstance = InstanceType<typeof LinkTrie>;

export class TrieManager {
	private trie: TrieInstance;
	private nodeMap: Map<string, GraphNodeTrieInstance> = new Map();
	private rootNodes: GraphNodeTrieInstance[] = [];
	private links: LinkTrieInstance[] = [];

	constructor() {
		this.trie = new Trie() as TrieInstance;
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

	createNode(typeNode: TypeNode, depth: number): GraphNodeTrieInstance {
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

	createLink(parentId: string, childId: string, relation: 'subtype' | 'instance'): LinkTrieInstance | undefined {
		const parent = this.nodeMap.get(parentId);
		const child = this.nodeMap.get(childId);
		if (!parent || !child) { return undefined; }

		const link = new this.trie.LinkTrie({ parent, child, relation });
		this.links.push(link);
		return link;
	}

	getTreeItems(): TreeItemData[] {
		return this.rootNodes.map(node => this.toTreeItemData(node));
	}

	private toTreeItemData(node: GraphNodeTrieInstance): TreeItemData {
		const children: TreeItemData[] = [];
		for (const link of this.links) {
			const linkChild = link.child as unknown as GraphNodeTrieInstance;
			if ((link.parent as unknown as GraphNodeTrieInstance).id === node.id && linkChild) {
				children.push(this.toTreeItemData(linkChild));
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

	getNode(id: string): GraphNodeTrieInstance | undefined {
		return this.nodeMap.get(id);
	}

	getTrie(): TrieInstance {
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
