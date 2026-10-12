'use strict';

// The type-path trie the Diamonds (control.json callers anchors) and
// Bagels (eds.json wrap sites) sidebar trees share: one node per segment
// of a dot-joined type path, entries hanging off the node whose fullPath
// IS the type they belong to.

export interface PathTrieNode<Entry> {
	segment: string;
	fullPath: string;
	children: Map<string, PathTrieNode<Entry>>;
	entries: Entry[];
}

export const newPathTrieNode = function <Entry>(segment: string, fullPath: string): PathTrieNode<Entry> {
	const node: PathTrieNode<Entry> = { segment, fullPath, children: new Map(), entries: [] };
	return node;
};

/** Hang the entry on the node for dotPath, creating the path as needed */
export const insertIntoPathTrie = function <Entry>(root: PathTrieNode<Entry>, dotPath: string, entry: Entry): void {
	let node = root;
	let currentPath = '';
	for (const segment of dotPath.split('.')) {
		currentPath = currentPath ? `${currentPath}.${segment}` : segment;
		let child = node.children.get(segment);
		if (!child) {
			child = newPathTrieNode(segment, currentPath);
			node.children.set(segment, child);
		}
		node = child;
	}
	node.entries.push(entry);
};

export const findInPathTrie = function <Entry>(root: PathTrieNode<Entry>, fullPath: string): PathTrieNode<Entry> | undefined {
	let node: PathTrieNode<Entry> | undefined = root;
	for (const segment of fullPath.split('.')) {
		node = node.children.get(segment);
		if (!node) { return undefined; }
	}
	return node;
};

/** Entries hanging off the node itself plus its whole subtree */
export const subtreeEntryCount = function <Entry>(node: PathTrieNode<Entry>): number {
	let count = node.entries.length;
	for (const child of node.children.values()) {
		count += subtreeEntryCount(child);
	}
	return count;
};
