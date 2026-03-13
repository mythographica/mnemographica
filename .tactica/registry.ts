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
		'Definition': new (data: { id: string; name: string; fullPath: string; properties: Map<string, object> }) => DefinitionInstance;
		'Definition.Link': new (data: { source: unknown; target: unknown; relation: 'extends' | 'implements' | 'contains' }) => LinkInstance;
		'LoggerTab': new (...args: unknown[]) => LoggerTabInstance;
		'LoggerTab.LogEntry': new (data: { level: 'info' | 'warning' | 'error'; message: string; timestamp: number; typeName?: string; error?: Error; args?: Array<unknown> }) => LogEntryInstance;
		'Main': new (data: { extensionVersion: string }) => MainInstance;
		'Main.Adapter': new (data: { name: string; domain: string; enabled: boolean }) => AdapterInstance;
		'Registry': new (...args: unknown[]) => RegistryInstance;
		'Registry.DefinitionEntry': new (data: { id: string; name: string; filePath: string; line: number; column: number }) => DefinitionEntryInstance;
		'Scene2D': new (...args: unknown[]) => Scene2DInstance;
		'Scene2D.Camera2D': new (data: { x: number; y: number; zoom: number }) => Camera2DInstance;
		'Scene2D.GraphNode2D': new (data: { id: string; label: string; x: number; y: number; radius: number; color: string }) => GraphNode2DInstance;
		'Scene2D.GraphNode2D.Link2D': new (data: { source: unknown; target: unknown; strength: number }) => Link2DInstance;
		'Scene2D.GraphNode2D.Tooltip2D': new (data: { targetNode: unknown; content: string; visible: boolean }) => Tooltip2DInstance;
		'Scene3D': new (...args: unknown[]) => Scene3DInstance;
		'Scene3D.Camera3D': new (data: { x: number; y: number; z: number; zoom: number; rotationX: number; rotationY: number }) => Camera3DInstance;
		'Scene3D.GraphNode3D': new (data: { id: string; label: string; x: number; y: number; z: number; radius: number; color: string }) => GraphNode3DInstance;
		'Scene3D.GraphNode3D.Link3D': new (data: { source: unknown; target: unknown; strength: number }) => Link3DInstance;
		'Scene3D.GraphNode3D.Tooltip3D': new (data: { targetNode: unknown; content: string; visible: boolean }) => Tooltip3DInstance;
		'Trie': new (...args: unknown[]) => TrieInstance;
		'Trie.GraphNodeTrie': new (data: { id: string; name: string; path: string; depth: number; isLeaf: boolean }) => GraphNodeTrieInstance;
		'Trie.GraphNodeTrie.LinkTrie': new (data: { parent: unknown; child: unknown; relation: 'subtype' | 'instance' }) => LinkTrieInstance;
		'Trie.GraphNodeTrie.ContextMenu': new (data: { targetNode: unknown; items: Array<object>; visible: boolean }) => ContextMenuInstance;
		'Types': new (...args: unknown[]) => TypesInstance;
		'Types.TypeEntry': new (data: { id: string; name: string; fullPath: string; parent?: string; properties: Map<string, string> }) => TypeEntryInstance;
		'Usages': new (...args: unknown[]) => UsagesInstance;
		'Usages.UsageEntry': new (data: { typeName: string; kind: string; code: string; location: string }) => UsageEntryInstance;
	}
}

import type { TypeRegistry } from 'mnemonica';
export type { TypeRegistry };