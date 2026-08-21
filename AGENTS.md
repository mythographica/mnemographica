# AGENTS.md - Mnemonica Graphica

Guidance for AI agents working on the Mnemonica Graphica VS Code extension.

## Project Overview

Mnemonica Graphica is a VS Code extension for exploring mnemonica type hierarchies. It reads the `.tactica/` artifacts of a workspace (`hierarchy.json`, `definitions.json`, `usages.json`, `eds.json`, `flow.json`, `types.ts`) into mnemonica model instances and exposes them as tree views with navigation.

### Purpose

Mnemonica Graphica provides:
- **Bird's eye view** of the entire type hierarchy (Definitions / Types tree)
- **Navigation** - click a type to jump to its `define()` site or generated alias
- **Usages, Flow, and Generation views** - where types are used, how they flow, and how deep they sit
- **Instance tracking** - shows both type definitions and instance creations (flow.json)

This helps developers understand and navigate complex inheritance structures that Mnemonica enables.

### AI Integration

The extension helps AI agents:
- Understand the project's type structure at a glance
- Navigate between related types efficiently
- Comprehend the inheritance graph for better code generation

## Architecture

### Core Components

1. **Extension Entry** (`src/extension.ts`)
   - Creates the four tree views, registers commands and file watchers
   - Starts the Strategy server, loads models via topologica
   - Owns `refreshTypeGraph()` — the single refresh path all watchers funnel into

2. **Registry** (`src/models/Registry.ts`) — the controller
   - The only model doing file I/O: `loadFromWorkspace()` reads `.tactica/*`
   - Types are loaded from `hierarchy.json` (structure, dot-joined fullPaths,
     1-based define()-site locations); property signatures are parsed from the
     generated `types.ts` bodies, the only place they exist
   - Other models (`Definitions`, `Types`, `Usages`, `EDS`, `Flow`, `Trie`) are
     pure data containers (`Map` wrappers with a nested `*Entry` subtype)

3. **GraphBuilder + GraphConverter** (`src/core/GraphBuilder.ts`, `src/graph/converter.ts`)
   - Builds `GraphData { nodes, links, execflow }` from the Registry
   - Node ids are dot-joined full paths — the same keys used by
     definitions/usages/flow/hierarchy, so no normalization is needed when joining
   - Enriches nodes with EDS status and `definitionLocation`
   - Populates `execflow` from flow.json: edges between known graph nodes only
     (entries whose key or `targetType` doesn't resolve — natives like `Date` —
     are skipped)

4. **Tree view providers** (`src/views/`)
   - `treeProvider.ts` — Definitions section (define() sites) and Types section
     (generated aliases in types.ts)
   - `usagesTreeProvider.ts` — usages per selected type
   - `flowTreeProvider.ts` — flow.json grouped kind → type → entry
   - `genTreeProvider.ts` — graph nodes grouped by depth

4b. **3D graph panel** (`src/webview/panel.ts` + `media/webview.js`)
   - The `mnemographica.showTypeGraph` command ("Ψ 3D") opens an interactive
     Three.js scene of the current GraphData — 3D-only (the 2D view was
     retired 2026-08; the dormant 2D renderer remains in webview.js but is
     never entered). Loads d3/three from CDN, so it needs network access.
     The 2.5D Canvas panel was fully removed.

5. **Navigation providers** (`src/providers/`)
   - `definitionProvider.ts` — Ctrl+Click for `lookup('X')` and type identifiers;
     its per-file cache is cleared on every `refreshTypeGraph()`
   - `referenceProvider.ts` — Shift+F12, backed by its own `Usages` instance

6. **Services** (`src/services/`)
   - `LoggerService.ts` — singleton: output channel + `logs/server.log` +
     Phase 1 mnemonica `LoggerTab`/`LogEntry` mirror (resolved lazily on first
     write — models don't exist yet at `initialize()` time)
   - `NavigationAdapter.ts` — the ONLY place vscode editor APIs are used directly

7. **Strategy server** (`src/strategy/server.ts`)
   - MCP-shaped JSON-RPC over HTTP (9230) and WebSocket (9231)
   - Experimental, no consumer yet. **Bound to 127.0.0.1** — there is no auth,
     so it must never listen on a LAN interface

8. **Topologica bootstrap** (`src/topologica/bootstrap.ts`)
   - Loads compiled models from `out/src/models`, self-defining all mnemonica types

### Type System

- **TypeNode** (`src/types/tactica-types.ts`): Internal representation of a type
  - `name`: Simple type name (e.g., "GraphNode2D")
  - `fullPath`: Dot-joined path (e.g., "Scene2D.GraphNode2D")
  - `properties`: Map of property names to PropertyInfo
  - `children`: Map of child type names to TypeNode
  - `parent`: Reference to parent TypeNode

- **D3Node** (`src/types/index.ts`): Flat node format for `GraphData`
  - `id`: Unique identifier (dot-joined fullPath)
  - `properties`: Array format

## Identity Convention (important)

Everything semantic is keyed by **dot-joined full path**: `definitions.json`,
`usages.json`, `eds.json`, `flow.json`, `hierarchy.json`, the Registry's Types
map, and `GraphData` node ids all agree on it. The one exception is the
generated `types.ts`, whose type aliases are **underscore-joined**
(`Scene2D_GraphNode2D`) — normalize with `.replace(/_/g, '.')` (or the reverse)
exactly at that boundary, nowhere else.

## Location Convention (important)

All stored locations are **1-based** `"file:line:column"` strings (tactica's
format). `VSCodeNavigation.goTo()` converts to 0-based internally — **never
pre-decrement** a line before calling it. Two historical bugs (panel25d and the
`navigateToLocation` command) were exactly that double-decrement.

## Key Patterns

### Types Loading (Registry.loadTypes)

Structure comes from `hierarchy.json` (flattened recursively, with self-reference
guard). Properties come from parsing the body of each `export type` block in
`types.ts`:

```typescript
export type UserEntity = {
	id: string;
	email: string;
	UserResponse: new (data: { status: number; body: string }) => UserEntity_UserResponse;
}
```

**Important**: Type definitions end with `}` not `;`. The body walk is
depth-tracked so inline object types don't end the block early.

### Inheritance Detection

In `types.ts`, extending types use `&` or `ProtoFlat`:
```typescript
export type AdminEntityInstance = UserEntityInstance & {
	role: string;
}
```
This is only needed for the alias-name boundary; hierarchy.json already carries
the parent fullPath.

## Build Commands

```bash
npm run compile    # tactica:generate + tsc
npm run watch      # Watch mode for development
npm run lint       # Run ESLint
npm test           # pretest (compile + lint) + node test/*.test.js
```

## Testing

Automated (plain node, no VS Code host):
- `test/registry-loading.test.js` — Registry + fixtures, incl. the
  `clear()`/reload regression (getter-only properties used to break refresh)
- `test/types-model.test.js` — Types model as pure data container
- `test/types-parser.test.js` — types.ts alias/parent regex against the repo's
  own `.tactica/types.ts`

The fixtures live in `test/fixtures/.tactica/` and mirror real tactica output
(including `hierarchy.json`).

Manual testing:
1. Press `F5` to launch extension host
2. Open a project with `.tactica/` generated by a current tactica
3. Explore the Mnemonica activity bar views (Welcome, Usages, Types, Flow, By Generation)

## File Structure

```
src/
├── extension.ts          # Main extension entry
├── activityBar.ts        # Welcome webview view (inline HTML, CSP'd)
├── webview/panel.ts      # 3D graph panel (renderer: media/webview.js, CDN libs)
├── commands/             # Command registrations (navigation, tree, utility, workspace)
├── core/
│   ├── MainOrchestrator.ts  # Owns Registry instance + StateManager + GraphData
│   ├── GraphBuilder.ts      # Registry → GraphData (nodes, links, execflow)
│   └── StateManager.ts      # App state holder
├── graph/
│   └── converter.ts      # TypeNode hierarchy → GraphData
├── models/               # Pure mnemonica data types (Registry is the controller)
├── providers/            # Definition (Ctrl+Click) and Reference (Shift+F12)
├── services/             # LoggerService, NavigationAdapter
├── strategy/             # Experimental MCP-shaped server (127.0.0.1 only)
├── topologica/           # Model bootstrap loader
├── types/
│   ├── index.ts          # GraphData/D3Node/D3Link/D3ExecLink
│   └── tactica-types.ts  # TypeNode/PropertyInfo
└── views/                # Four tree view providers
```

## Dependencies

- **mnemonica**: The type system itself (models are mnemonica types)
- **@mnemonica/topologica**: Module loader that self-defines model types
- **@mnemonica/tactica**: Type analysis (dev-time `.tactica` generation)
- **ws**: Strategy server WebSocket transport

## VS Code API Usage

- `vscode.window.createTreeView`: The four exploration views
- `vscode.WebviewView`: Welcome view (inline HTML only, no remote scripts)
- `vscode.commands`: Command palette integration
- `vscode.workspace.createFileSystemWatcher`: Auto-refresh on file changes
- `vscode.window.showTextDocument`: Go-to-definition functionality (only via NavigationAdapter)

## Lessons Learned

### 1. Separation of Concerns: Actions vs Data

**WRONG:** Putting file I/O actions inside model classes
```typescript
// Definitions.ts - model
class Definitions {
    async loadFromFile(path: string) {  // ❌ Action in data class
        // file reading logic here
    }
}
```

**RIGHT:** Keep models as pure data containers, actions go in controllers
```typescript
// Definitions.ts - pure data
class Definitions {
    get(name: string) { return this.map.get(name); }
    set(name: string, entry: DefinitionEntry) { this.map.set(name, entry); }
    // Note: loadFromFile action moved to Registry
}

// Registry.ts - controller with actions
class Registry {
    private async loadDefinitions(tacticaPath: string) {
        const content = fs.readFileSync(definitionsPath, 'utf-8');
        // ... parse and populate Definitions instance
    }
}
```

### 2. Avoid Inefficient File Operations

**WRONG:** Re-reading files to get data that was already available during parsing
```typescript
// Types.ts - wasteful re-reading
getLineForType(typeName: string): number | undefined {
    const entry = this.map.get(typeName);
    if (!entry) return undefined;

    // ❌ Re-reads the ENTIRE file just to find line number!
    const content = fs.readFileSync(entry.fullPath, 'utf-8');
    // ...
}
```

**RIGHT:** Store the data when you have it during loading
```typescript
// Registry.ts - while visiting hierarchy.json nodes
const entry = new typesInstance.TypeEntry({
    name: node.name,
    fullPath: node.fullPath,
    parent,
    properties: propertiesByType.get(node.fullPath) || new Map(),
    lineNumber: parsed ? parsed.line : 0,  // ✅ 1-based define() site line
    location: node.location
} as rawTypeEntry);

// Types.ts - simple lookup
getLineForType(typeName: string): number | undefined {
    const entry = this.map.get(typeName);
    return entry?.lineNumber;  // ✅ O(1) lookup, no file I/O
}
```

### 3. Naming Convention: Use rawTypeEntry Pattern

**WRONG:** Confusing naming between internal type and data transfer type
```typescript
// ❌ Two different types with similar names
export type typeEntry = { ... };        // Used inside model
export type TypeEntryData = { ... };    // Used for external data
```

**RIGHT:** Clear naming: `rawTypeEntry` for data transfer
```typescript
// ✅ Single clear type name for external data
export type rawTypeEntry = {
    name: string;
    fullPath: string;  // dot-joined, the cross-file join key
    parent?: string;
    properties: Map<string, { name: string; type: string; optional: boolean }>;
    lineNumber: number;  // 1-based, define() site
    location?: string;   // "file:line:column", from hierarchy.json
};
```

**Key Principle:** Models define `raw*` types for data transfer. Controllers use these types when populating models.

### 4. Accessor Properties on Mutable Class State

Getter-only `Object.defineProperty` on class instances makes later assignment
throw in strict mode — `Registry.clear()` used to die exactly that way, silently
killing every refresh. Keep mutable model references as plain private fields.

## Pattern Summary

| Layer | Responsibility | Example |
|-------|---------------|---------|
| Model (Definitions, Types, Usages, EDS, Flow, Trie) | Pure data storage, Map operations | `get()`, `set()`, `has()` |
| Controller (Registry) | File I/O, parsing, orchestration | `loadDefinitions()`, `loadTypes()` |
| Data Transfer | `raw*` types for external data | `rawTypeEntry`, `rawDefinitionEntry` |
