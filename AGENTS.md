# AGENTS.md - Mnemonica Graphica

Guidance for AI agents working on the Mnemonica Graphica VS Code extension.

## Project Overview

Mnemonica Graphica is a VS Code extension that visualizes mnemonica type hierarchies using interactive graphs. It parses `.tactica/types.ts` files to build a visual representation of the instance inheritance trie.

### Purpose

Mnemonica Graphica provides:
- **Bird's eye view** of the entire type hierarchy
- **Visual IDE/navigation** - click a node to jump to definition
- **2D and 3D visualizations** of the inheritance graph
- **Instance tracking** - shows both type definitions and instance creations

This helps developers understand and navigate complex inheritance structures that Mnemonica enables.

### AI Integration

The visualization helps AI agents:
- Understand the project's type structure at a glance
- Navigate between related types efficiently
- Comprehend the inheritance graph for better code generation

## Architecture

### Core Components

1. **Extension Entry** (`src/extension.ts`)
   - Registers commands and file watchers
   - Manages the graph panel lifecycle

2. **Tactica Adapter** (`src/graph/tactica.ts`)
   - Parses `.tactica/types.ts` files
   - Builds TypeNode hierarchy with parent-child relationships
   - **Key parsing logic**: Line-by-line parser with brace counting, starting after `=` and stopping when `braceDepth` returns to 0

3. **Graph Converter** (`src/graph/converter.ts`)
   - Converts TypeNode hierarchy to D3-compatible format
   - Recursively processes nodes to build nodes/links arrays

4. **Webview Panel** (`src/webview/panel.ts`)
   - Renders 2D graph using D3 force simulation
   - Renders 3D graph using Three.js
   - Handles user interactions (click, hover, drag)

5. **3D Renderer** (`src/webview/renderer3d.ts`)
   - WebGL-based 3D visualization
   - Uses Three.js for rendering spheres and lines

### Type System

- **TypeNode** (`src/types/tactica-types.ts`): Internal representation of a type
  - `name`: Type name
  - `fullPath`: Dot-separated path (e.g., "UserEntityInstance.AdminEntityInstance")
  - `properties`: Map of property names to PropertyInfo
  - `children`: Map of child type names to TypeNode
  - `parent`: Reference to parent TypeNode

- **D3Node** (`src/types/index.ts`): Format for D3 visualization
  - `id`: Unique identifier (fullPath)
  - `properties`: Array format for webview

## Key Patterns

### Tactica File Parsing

The parser must handle multiline type definitions like:
```typescript
export type UserEntity = {
	id: string;
	email: string;
	UserResponse: new (data: { status: number; body: string }) => UserEntity_UserResponse;
}
```

**Important**: Type definitions end with `}` not `;`

### Inheritance Detection

Types extending others use the `&` operator:
```typescript
export type AdminEntityInstance = UserEntityInstance & {
	role: string;
}
```

The parser extracts the parent name using regex: `/^(\w+)\s*&/`

## Build Commands

```bash
npm run compile    # Compile TypeScript
npm run watch      # Watch mode for development
npm run lint       # Run ESLint
```

## Testing

Manual testing:
1. Press `F5` to launch extension host
2. Open a project with `.tactica/types.ts` file
3. Run "Mnemonica: Show Type Graph" command

## Known Issues

1. **3D Sign Positioning**: Labels may disappear when dragging nodes in 3D mode
2. **Tooltip on Toggle**: Tooltip state may freeze when switching 2D/3D modes

## File Structure

```
src/
├── extension.ts          # Main extension entry
├── graph/
│   ├── tactica.ts        # Tactica file parser
│   └── converter.ts      # TypeNode to D3 conversion
├── webview/
│   ├── panel.ts          # Webview panel with 2D/3D rendering
│   └── renderer3d.ts     # Three.js 3D renderer
├── types/
│   ├── index.ts          # D3 types
│   └── tactica-types.ts  # TypeNode types
└── activityBar.ts        # Activity bar tree view
```

## Dependencies

- **d3-force-3d**: 3D force simulation
- **three**: WebGL rendering
- **@mnemonica/tactica**: Type analysis (optional, for source parsing fallback)

## VS Code API Usage

- `vscode.WebviewPanel`: Main visualization panel
- `vscode.commands`: Command palette integration
- `vscode.workspace.fileWatcher`: Auto-refresh on file changes
- `vscode.window.showTextDocument`: Go-to-definition functionality

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
    const lines = content.split('\n');
    const searchPattern = new RegExp(`export\\s+type\\s+${typeName}\\s*=`);
    
    for (let i = 0; i < lines.length; i++) {
        if (searchPattern.test(lines[i])) {
            return i;
        }
    }
    return undefined;
}
```

**RIGHT:** Store the data when you have it during parsing
```typescript
// rawTypeEntry definition
export type rawTypeEntry = {
    name: string;
    fullPath: string;
    parent?: string;
    properties: Map<string, string>;
    lineNumber: number;  // ✅ Store it during parsing
};

// Registry.ts - during parsing
for (let i = 0; i < lines.length; i++) {
    const match = typeRegex.exec(lines[i]);
    if (match) {
        const entry = new this.typesInstance.TypeEntry({
            name,
            fullPath: typesPath,
            parent,
            properties: new Map(),
            lineNumber: i  // ✅ Store line number when we know it
        } as rawTypeEntry);
    }
}

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
    fullPath: string;
    parent?: string;
    properties: Map<string, string>;
    lineNumber: number;
};

// Used in Registry.ts when creating instances
const entry = new this.typesInstance.TypeEntry({
    name,
    fullPath: typesPath,
    parent,
    properties: new Map(),
    lineNumber: i
} as rawTypeEntry);
```

**Key Principle:** Models define `raw*` types for data transfer. Controllers use these types when populating models.

## Pattern Summary

| Layer | Responsibility | Example |
|-------|---------------|---------|
| Model (Definitions, Types, Usages, Trie) | Pure data storage, Map operations | `get()`, `set()`, `has()` |
| Controller (Registry) | File I/O, parsing, orchestration | `loadDefinitions()`, `loadTypes()` |
| Data Transfer | `raw*` types for external data | `rawTypeEntry`, `rawDefinitionEntry` |
