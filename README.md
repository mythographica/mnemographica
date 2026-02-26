# Mnemonica Graphica

Visualize mnemonica type hierarchies with interactive D3 force-directed graphs in VS Code.

## Features

- **Interactive Graph Visualization**: See your mnemonica type inheritance as a force-directed graph
- **Click to Definition**: Click any node to jump to its source definition
- **Hover for Details**: View type properties on hover
- **Real-time Updates**: Automatically refreshes when you modify source files
- **Zoom & Pan**: Navigate large type hierarchies easily

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