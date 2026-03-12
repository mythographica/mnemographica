// Generated TypeRegistry for type-safe mnemonica.lookupTyped<TypeRegistry>()
// Import this interface and use with lookupTyped from mnemonica
//
// Usage:
//   import { lookupTyped } from 'mnemonica';
//   import { TypeRegistry } from './.tactica/registry';
//   const Sentience = lookupTyped<TypeRegistry>('Sentience');
//   // TypeScript knows: Sentience is a constructor for SentienceInstance
//   const instance = new Sentience({ purpose: 'AI' });
//   // instance has full intellisense for Consciousness, Memory, etc.

import type {
	DefinitionInstance,
	LinkInstance,
	LoggerTabInstance,
	LogEntryInstance,
	MainInstance,
	AdapterInstance,
	RegistryInstance,
	DefinitionEntryInstance,
	Scene2DInstance,
	Camera2DInstance,
	GraphNode2DInstance,
	Link2DInstance,
	Tooltip2DInstance,
	Scene3DInstance,
	Camera3DInstance,
	GraphNode3DInstance,
	Link3DInstance,
	Tooltip3DInstance,
	TrieInstance,
	GraphNodeTrieInstance,
	LinkTrieInstance,
	ContextMenuInstance,
	TypesInstance,
	TypeEntryInstance,
	UsagesInstance,
	UsageEntryInstance,
} from './types';

/**
 * Type registry augmenting mnemonica's TypeRegistry interface
 * This enables type-safe lookupTyped() without explicit type arguments
 *
 * Usage: const SomeType = lookupTyped('SomeType'); // Fully typed!
 */
declare module 'mnemonica' {
	interface TypeRegistry {
		'Definition': new (...args: unknown[]) => DefinitionInstance;
		'Definition.Link': new (...args: unknown[]) => LinkInstance;
		'LoggerTab': new (...args: unknown[]) => LoggerTabInstance;
		'LoggerTab.LogEntry': new (...args: unknown[]) => LogEntryInstance;
		'Main': new (...args: unknown[]) => MainInstance;
		'Main.Adapter': new (...args: unknown[]) => AdapterInstance;
		'Registry': new (...args: unknown[]) => RegistryInstance;
		'Registry.DefinitionEntry': new (...args: unknown[]) => DefinitionEntryInstance;
		'Scene2D': new (...args: unknown[]) => Scene2DInstance;
		'Scene2D.Camera2D': new (...args: unknown[]) => Camera2DInstance;
		'Scene2D.GraphNode2D': new (...args: unknown[]) => GraphNode2DInstance;
		'Scene2D.GraphNode2D.Link2D': new (...args: unknown[]) => Link2DInstance;
		'Scene2D.GraphNode2D.Tooltip2D': new (...args: unknown[]) => Tooltip2DInstance;
		'Scene3D': new (...args: unknown[]) => Scene3DInstance;
		'Scene3D.Camera3D': new (...args: unknown[]) => Camera3DInstance;
		'Scene3D.GraphNode3D': new (...args: unknown[]) => GraphNode3DInstance;
		'Scene3D.GraphNode3D.Link3D': new (...args: unknown[]) => Link3DInstance;
		'Scene3D.GraphNode3D.Tooltip3D': new (...args: unknown[]) => Tooltip3DInstance;
		'Trie': new (...args: unknown[]) => TrieInstance;
		'Trie.GraphNodeTrie': new (...args: unknown[]) => GraphNodeTrieInstance;
		'Trie.GraphNodeTrie.LinkTrie': new (...args: unknown[]) => LinkTrieInstance;
		'Trie.GraphNodeTrie.ContextMenu': new (...args: unknown[]) => ContextMenuInstance;
		'Types': new (...args: unknown[]) => TypesInstance;
		'Types.TypeEntry': new (...args: unknown[]) => TypeEntryInstance;
		'Usages': new (...args: unknown[]) => UsagesInstance;
		'Usages.UsageEntry': new (...args: unknown[]) => UsageEntryInstance;
	}
}

import type { TypeRegistry } from 'mnemonica';
export type { TypeRegistry };