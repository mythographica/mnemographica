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
	Definitions,
	Definitions_DefinitionEntry,
	LoggerTab,
	LoggerTab_LogEntry,
	Main,
	Main_Adapter,
	Registry,
	Registry_DefinitionEntry,
	Scene2D,
	Scene2D_Camera2D,
	Scene2D_GraphNode2D,
	Scene2D_GraphNode2D_Link2D,
	Scene2D_GraphNode2D_Tooltip2D,
	Scene3D,
	Scene3D_Camera3D,
	Scene3D_GraphNode3D,
	Scene3D_GraphNode3D_Link3D,
	Scene3D_GraphNode3D_Tooltip3D,
	Trie,
	Trie_GraphNodeTrie,
	Trie_GraphNodeTrie_LinkTrie,
	Trie_GraphNodeTrie_ContextMenu,
	Types,
	Types_TypeEntry,
	Usages,
	Usages_UsageEntry,
} from './types';

/**
 * Type registry augmenting mnemonica's TypeRegistry interface
 * This enables type-safe lookupTyped() without explicit type arguments
 *
 * Usage: const SomeType = lookupTyped('SomeType'); // Fully typed!
 */
declare module 'mnemonica' {
	interface TypeRegistry {
		'Definitions': new () => Definitions;
		'Definitions.DefinitionEntry': new (data: { name: string; location: string; kind: string; parent: string | unknown; strictChain: boolean; blockErrors: boolean }) => Definitions_DefinitionEntry;
		'LoggerTab': new () => LoggerTab;
		'LoggerTab.LogEntry': new (data: { level: 'info' | 'warning' | 'error'; message: string; timestamp: number; typeName?: string; error?: Error; args?: Array<unknown> }) => LoggerTab_LogEntry;
		'Main': new (extensionVersion: string) => Main;
		'Main.Adapter': new (data: { name: string; domain: string; enabled: boolean }) => Main_Adapter;
		'Registry': new () => Registry;
		'Registry.DefinitionEntry': new (data: { id: string; name: string; filePath: string; line: number; column: number }) => Registry_DefinitionEntry;
		'Scene2D': new () => Scene2D;
		'Scene2D.Camera2D': new (data: { x: number; y: number; zoom: number }) => Scene2D_Camera2D;
		'Scene2D.GraphNode2D': new (data: { id: string; label: string; x: number; y: number; radius: number; color: string }) => Scene2D_GraphNode2D;
		'Scene2D.GraphNode2D.Link2D': new (data: { source: unknown; target: unknown; strength: number }) => Scene2D_GraphNode2D_Link2D;
		'Scene2D.GraphNode2D.Tooltip2D': new (data: { targetNode: unknown; content: string; visible: boolean }) => Scene2D_GraphNode2D_Tooltip2D;
		'Scene3D': new () => Scene3D;
		'Scene3D.Camera3D': new (data: { x: number; y: number; z: number; zoom: number; rotationX: number; rotationY: number }) => Scene3D_Camera3D;
		'Scene3D.GraphNode3D': new (data: { id: string; label: string; x: number; y: number; z: number; radius: number; color: string }) => Scene3D_GraphNode3D;
		'Scene3D.GraphNode3D.Link3D': new (data: { source: unknown; target: unknown; strength: number }) => Scene3D_GraphNode3D_Link3D;
		'Scene3D.GraphNode3D.Tooltip3D': new (data: { targetNode: unknown; content: string; visible: boolean }) => Scene3D_GraphNode3D_Tooltip3D;
		'Trie': new () => Trie;
		'Trie.GraphNodeTrie': new (data: { id: string; name: string; path: string; depth: number; isLeaf: boolean }) => Trie_GraphNodeTrie;
		'Trie.GraphNodeTrie.LinkTrie': new (data: { parent: unknown; child: unknown; relation: 'subtype' | 'instance' }) => Trie_GraphNodeTrie_LinkTrie;
		'Trie.GraphNodeTrie.ContextMenu': new (data: { targetNode: unknown; items: Array<object>; visible: boolean }) => Trie_GraphNodeTrie_ContextMenu;
		'Types': new () => Types;
		'Types.TypeEntry': new (data: { name: string; fullPath: string; properties: Map<string, string>; parent?: string }) => Types_TypeEntry;
		'Usages': new () => Usages;
		'Usages.UsageEntry': new (usages: { typeName: string; kind: string; code: string; location: string }) => Usages_UsageEntry;
	}
}

import type { TypeRegistry } from 'mnemonica';
export type { TypeRegistry };