# Mnemonica Graphica

Visualize mnemonica type hierarchies with interactive D3 force-directed graphs in VS Code.

## Features

- **Interactive Graph Visualization**: See your mnemonica type inheritance as a force-directed graph
- **2D/3D Toggle**: Switch between 2D force-directed layout and 3D WebGL visualization
- **Click to Definition**: Single-click any node to view its properties, double-click to jump to source definition
- **Hover for Details**: View type properties on hover (name, depth, property list with types)
- **Real-time Updates**: Automatically refreshes when you modify source files
- **Zoom & Pan**: Navigate large type hierarchies easily
- **Draggable Nodes**: Drag nodes in 2D mode to rearrange the layout

## Requirements

- VS Code 1.74.0 or higher
- A TypeScript project using [mnemonica](https://github.com/mythographica/mnemonica)
- Optionally: [@mnemonica/tactica](https://github.com/mythographica/mnemonica/tree/master/tactica) for enhanced type analysis

## Usage

1. Open a project with mnemonica types
2. Run `Mnemonica: Show Type Graph` from the command palette
3. Or right-click any `.ts` file and select `Show Type Graph`

The graph will display:
- **Nodes**: Each mnemonica type defined in your project
- **Links**: Inheritance relationships (parent → child)
- **Node Size**: Based on number of properties
- **Node Color**: Based on depth in the inheritance tree

## Commands

| Command | Description |
|---------|-------------|
| `Mnemonica: Show Type Graph` | Open the type hierarchy visualization |
| `Mnemonica: Refresh Type Graph` | Manually refresh the graph |
| `Toggle 2D/3D` | Switch between 2D and 3D visualization modes |

## Interaction

### 2D Mode
- **Hover**: View type properties tooltip
- **Single Click**: Pin tooltip with full property details
- **Double Click**: Jump to source definition
- **Drag**: Rearrange node positions
- **Scroll**: Zoom in/out
- **Right-click drag**: Pan the view

### 3D Mode
- **Click**: Select node and view properties
- **Double Click**: Jump to source definition
- **Drag**: Rotate the 3D view
- **Scroll**: Zoom in/out

## Configuration

```json
{
  "mnemographica.layout": "force",
  "mnemographica.nodeSize": "propertyCount",
  "mnemographica.showProperties": true
}
```

## How It Works

Mnemonica Graphica parses your TypeScript files to find `define()` calls and builds a visual representation of the instance inheritance trie - the "family tree" of types created through mnemonica's prototype chain inheritance pattern.

## Development

```bash
npm install
npm run compile
# Press F5 to launch extension host
```

## License

MIT