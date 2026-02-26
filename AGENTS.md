# AGENTS.md - Mnemonica Graphica

Guidance for AI agents working on the Mnemonica Graphica VS Code extension.

## Project Overview

Mnemonica Graphica is a VS Code extension that visualizes mnemonica type hierarchies using interactive graphs. It parses `.tactica/types.ts` files to build a visual representation of the instance inheritance trie.

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
export type UserEntityInstance = {
	id: string;
	email: string;
	UserResponse: TypeConstructor<UserResponseInstance>;
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
