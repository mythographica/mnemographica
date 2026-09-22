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
	BackendRegistry_Instrumentation,
	BackendRegistry_Instrumentation_InstrumentationPoint,
	BackendRegistry_Definitions,
	BackendRegistry_Definitions_DefinitionEntry,
	BackendRegistry_EDS,
	BackendRegistry_EDS_EDSEntry,
	BackendRegistry_Flow,
	BackendRegistry_Flow_FlowEntry,
	LoggerTab,
	LoggerTab_LogEntry,
	Main,
	Main_Adapter,
	BackendRegistry_Types,
	BackendRegistry_Types_TypeEntry,
	BackendRegistry_Usages,
	BackendRegistry_Usages_UsageEntry,
	Registry,
	Registry_RegistryEntry,
	FrontendRegistry_Scene3D,
	FrontendRegistry_Scene3D_Camera3D,
	FrontendRegistry_Scene3D_GraphNode3D,
	FrontendRegistry_Scene3D_GraphNode3D_Tooltip3D,
	FrontendRegistry_Scene3D_Link3D,
	FrontendRegistry_Scene3D_Diamond3D,
	FrontendRegistry_Scene3D_Bagel3D,
	FrontendRegistry_Scene3D_Ring3D,
	FrontendRegistry_Scene3D_Hub3D,
	FrontendRegistry_Scene3D_Sink3D,
	FrontendRegistry_Scene3D_Cone3D,
	FrontendRegistry_Scene3D_Caption3D,
	FrontendRegistry_Scene3D_Tube3D,
	BackendRegistry_Trie,
	BackendRegistry_Trie_GraphNodeTrie,
	BackendRegistry_Trie_GraphNodeTrie_LinkTrie,
	BackendRegistry_Trie_GraphNodeTrie_ContextMenu,
} from './types';

/**
 * Type registry augmenting mnemonica's TypeRegistry interface
 * This enables type-safe lookup() without explicit type arguments
 *
 * Usage: const SomeType = lookup('SomeType'); // Fully typed!
 */
declare module 'mnemonica' {
	interface TypeRegistry {
		'LoggerTab': new () => LoggerTab;
		'LoggerTab.LogEntry': new (data: { level: 'info' | 'warning' | 'error'; message: string; timestamp: number; typeName?: string; error?: Error; args?: Array<unknown> }) => LoggerTab_LogEntry;
		'Main': new (extensionVersion: string) => Main;
		'Main.Adapter': new (data: { name: string; domain: string; enabled: boolean }) => Main_Adapter;
		'Registry': new () => Registry;
		'Registry.RegistryEntry': new (data: { id: string; name: string; filePath: string; line: number; column: number }) => Registry_RegistryEntry;
	}
}

declare module '../src/models/collections' {
	interface BackendRegistry {
		'Instrumentation': new () => BackendRegistry_Instrumentation;
		'Instrumentation.InstrumentationPoint': new (data: { kind: string; className: string; location: string; code: string; scope: string; targets?: Array<string> }) => BackendRegistry_Instrumentation_InstrumentationPoint;
		'Definitions': new () => BackendRegistry_Definitions;
		'Definitions.DefinitionEntry': new (data: { name: string; location: string; kind: string; parent: string | null; strictChain: boolean; blockErrors: boolean }) => BackendRegistry_Definitions_DefinitionEntry;
		'EDS': new () => BackendRegistry_EDS;
		'EDS.EDSEntry': new (data: { typeName: string; location: string; kind: string; code: string; targetType?: string; scope?: string; via?: string; createsTypes?: Array<string>; label?: string; callbackScopeId?: string; instanceArg?: string; scopeId?: string; wrapsTypePath?: string }) => BackendRegistry_EDS_EDSEntry;
		'Flow': new () => BackendRegistry_Flow;
		'Flow.FlowEntry': new (data: { typeName: string; kind: string; code: string; location: string; propertyName?: string; context?: string; targetType?: string }) => BackendRegistry_Flow_FlowEntry;
		'Types': new () => BackendRegistry_Types;
		'Types.TypeEntry': new (data: { name: string; fullPath: string; parent?: string; properties: Map<string, { name: string; type: string; optional: boolean }>; lineNumber: number; location?: string }) => BackendRegistry_Types_TypeEntry;
		'Usages': new () => BackendRegistry_Usages;
		'Usages.UsageEntry': new (usages: { typeName: string; kind: string; code: string; location: string }) => BackendRegistry_Usages_UsageEntry;
		'Trie': new () => BackendRegistry_Trie;
		'Trie.GraphNodeTrie': new (data: { id: string; name: string; path: string; depth: number; isLeaf: boolean }) => BackendRegistry_Trie_GraphNodeTrie;
		'Trie.GraphNodeTrie.LinkTrie': new (data: { parent: unknown; child: unknown; relation: 'subtype' | 'instance' }) => BackendRegistry_Trie_GraphNodeTrie_LinkTrie;
		'Trie.GraphNodeTrie.ContextMenu': new (data: { targetNode: unknown; items: Array<{ label: string; action: string }>; visible: boolean }) => BackendRegistry_Trie_GraphNodeTrie_ContextMenu;
	}
}

declare module '../src/models/collections' {
	interface FrontendRegistry {
		'Scene3D': new () => FrontendRegistry_Scene3D;
		'Scene3D.Camera3D': new (data: { x: number; y: number; z: number; zoom: number; rotationX: number; rotationY: number }) => FrontendRegistry_Scene3D_Camera3D;
		'Scene3D.GraphNode3D': new (data: { id: string; label: string; depth: number; isRoot: boolean; location?: { fileName: string; line: number; column: number } }) => FrontendRegistry_Scene3D_GraphNode3D;
		'Scene3D.GraphNode3D.Tooltip3D': new (data: { targetNode: string; content: string; visible: boolean }) => FrontendRegistry_Scene3D_GraphNode3D_Tooltip3D;
		'Scene3D.Link3D': new (data: { source: string; target: string; kind: string }) => FrontendRegistry_Scene3D_Link3D;
		'Scene3D.Diamond3D': new (data: { id: string; name: string; kind: string; filePath: string; starter: boolean; creates: number }) => FrontendRegistry_Scene3D_Diamond3D;
		'Scene3D.Bagel3D': new (data: { id: string; name: string; generation: number; anchor: string | null; wrapsTypePath?: string }) => FrontendRegistry_Scene3D_Bagel3D;
		'Scene3D.Ring3D': new (data: { id: string; name: string; citation?: string }) => FrontendRegistry_Scene3D_Ring3D;
		'Scene3D.Hub3D': new (data: { id: string; name: string; citation?: string }) => FrontendRegistry_Scene3D_Hub3D;
		'Scene3D.Sink3D': new (data: { id: string; name: string; citation?: string }) => FrontendRegistry_Scene3D_Sink3D;
		'Scene3D.Cone3D': new (data: { id: string; name: string }) => FrontendRegistry_Scene3D_Cone3D;
		'Scene3D.Caption3D': new (data: { text: string; targetId: string }) => FrontendRegistry_Scene3D_Caption3D;
		'Scene3D.Tube3D': new (data: { id: string; chain: Array<string> }) => FrontendRegistry_Scene3D_Tube3D;
	}
}

import type { TypeRegistry } from 'mnemonica';
export type { TypeRegistry };