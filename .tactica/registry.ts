// Generated TypeRegistry for type-safe mnemonica.lookup()
// This file augments mnemonica's TypeRegistry via declaration merging.
//
// Usage:
//   import { lookup } from 'mnemonica';
//   import './.tactica/registry';  // applies the augmentation
//   const MyType = lookup('MyType');
//   // TypeScript knows: MyType is the typed constructor for MyType
//   const instance = new MyType({ /* constructor args */ });
//   // instance has full intellisense for the generated type

import type {
	Instrumentation,
	Instrumentation_InstrumentationPoint,
	Definitions,
	Definitions_DefinitionEntry,
	EDS,
	EDS_EDSEntry,
	Flow,
	Flow_FlowEntry,
	LoggerTab,
	LoggerTab_LogEntry,
	Main,
	Main_Adapter,
	Types,
	Types_TypeEntry,
	Usages,
	Usages_UsageEntry,
	Registry,
	Registry_RegistryEntry,
	Scene3D,
	Scene3D_Camera3D,
	Scene3D_GraphNode3D,
	Scene3D_GraphNode3D_Tooltip3D,
	Scene3D_Link3D,
	Trie,
	Trie_GraphNodeTrie,
	Trie_GraphNodeTrie_LinkTrie,
	Trie_GraphNodeTrie_ContextMenu,
} from './types';

/**
 * Type registry augmenting mnemonica's TypeRegistry interface
 * This enables type-safe lookup() without explicit type arguments
 *
 * Usage: const SomeType = lookup('SomeType'); // Fully typed!
 */
declare module 'mnemonica' {
	interface TypeRegistry {
		'Instrumentation': new () => Instrumentation;
		'Instrumentation.InstrumentationPoint': new (data: { kind: string; className: string; location: string; code: string; scope: string; targets?: Array<string> }) => Instrumentation_InstrumentationPoint;
		'Definitions': new () => Definitions;
		'Definitions.DefinitionEntry': new (data: { name: string; location: string; kind: string; parent: string | null; strictChain: boolean; blockErrors: boolean }) => Definitions_DefinitionEntry;
		'EDS': new () => EDS;
		'EDS.EDSEntry': new (data: { typeName: string; location: string; kind: string; code: string; targetType?: string; scope?: string; via?: string; createsTypes?: Array<string>; label?: string; callbackScopeId?: string; instanceArg?: string; scopeId?: string; wrapsTypePath?: string }) => EDS_EDSEntry;
		'Flow': new () => Flow;
		'Flow.FlowEntry': new (data: { typeName: string; kind: string; code: string; location: string; propertyName?: string; context?: string; targetType?: string }) => Flow_FlowEntry;
		'LoggerTab': new () => LoggerTab;
		'LoggerTab.LogEntry': new (data: { level: 'info' | 'warning' | 'error'; message: string; timestamp: number; typeName?: string; error?: Error; args?: Array<unknown> }) => LoggerTab_LogEntry;
		'Main': new (extensionVersion: string) => Main;
		'Main.Adapter': new (data: { name: string; domain: string; enabled: boolean }) => Main_Adapter;
		'Types': new () => Types;
		'Types.TypeEntry': new (data: { name: string; fullPath: string; parent?: string; properties: Map<string, { name: string; type: string; optional: boolean }>; lineNumber: number; location?: string }) => Types_TypeEntry;
		'Usages': new () => Usages;
		'Usages.UsageEntry': new (usages: { typeName: string; kind: string; code: string; location: string }) => Usages_UsageEntry;
		'Registry': new () => Registry;
		'Registry.RegistryEntry': new (data: { id: string; name: string; filePath: string; line: number; column: number }) => Registry_RegistryEntry;
		'Scene3D': new () => Scene3D;
		'Scene3D.Camera3D': new (data: { x: number; y: number; z: number; zoom: number; rotationX: number; rotationY: number }) => Scene3D_Camera3D;
		'Scene3D.GraphNode3D': new (data: { id: string; label: string; x: number; y: number; z: number; radius: number; color: string }) => Scene3D_GraphNode3D;
		'Scene3D.GraphNode3D.Tooltip3D': new (data: { targetNode: unknown; content: string; visible: boolean }) => Scene3D_GraphNode3D_Tooltip3D;
		'Scene3D.Link3D': new (data: { source: unknown; target: unknown; strength: number }) => Scene3D_Link3D;
		'Trie': new () => Trie;
		'Trie.GraphNodeTrie': new (data: { id: string; name: string; path: string; depth: number; isLeaf: boolean }) => Trie_GraphNodeTrie;
		'Trie.GraphNodeTrie.LinkTrie': new (data: { parent: unknown; child: unknown; relation: 'subtype' | 'instance' }) => Trie_GraphNodeTrie_LinkTrie;
		'Trie.GraphNodeTrie.ContextMenu': new (data: { targetNode: unknown; items: Array<{ label: string; action: string }>; visible: boolean }) => Trie_GraphNodeTrie_ContextMenu;
	}
}

import type { TypeRegistry } from 'mnemonica';
export type { TypeRegistry };