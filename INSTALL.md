# Installing Mnemonica Graphica Extension

## Method 1: Install from VSIX (Recommended for Local Use)

### Step 1: Build the Extension
```bash
cd mnemographica
npm install
npm run compile
```

### Step 2: Package as VSIX
```bash
# Install vsce if not already installed
npm install -g @vscode/vsce

# Package the extension
vsce package
```

This creates `mnemographica-<version>.vsix`

### Step 3: Install in VS Code
1. Open VS Code
2. Go to Extensions view (Cmd+Shift+X)
3. Click `...` (More Actions) → `Install from VSIX...`
4. Select the generated `.vsix` file
5. The extension is now installed!

---

## Method 2: Development Mode (F5)

For development/testing:
1. Open the `mnemographica` folder in VS Code
2. Press `F5` to launch Extension Development Host
3. The extension is active only in the new window

---

## Usage After Installation

1. Open a TypeScript project with mnemonica types
2. Make sure the project has a `.tactica/` directory (run `npx tactica` if not)
3. Open the Mnemonica activity bar container (Ψ) for the tree views
4. Run `Mnemonica: Ψ 3D` for the interactive 3D type graph
5. For live tracing, open `Mnemonica: Ψ App Channel` and connect to a
   running instrumented app (see "Watching a running app" in the README)

---

## Troubleshooting

### Extension not showing in Command Palette
- Check that the workspace has TypeScript files
- Reload VS Code window (`Cmd+Shift+P` → `Developer: Reload Window`)

### Views are empty
- Ensure `.tactica/` exists in your project — run `npx tactica` to generate it
- The Diamonds view additionally needs tactica ≥ 0.2.0 output
  (`instrumentation.json`); see the README's Requirements section

### Extension fails to load
- Check VS Code version (need 1.74.0+)
- Check Output panel → `Extension Host` for errors
