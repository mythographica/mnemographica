# Installing Mnemonica Graphica Extension

## Method 1: Install from VSIX (Recommended for Local Use)

### Step 1: Build the Extension
```bash
cd /code/mnemonica/mnemographica
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

This creates `mnemographica-0.1.0.vsix`

### Step 3: Install in VS Code
1. Open VS Code
2. Go to Extensions view (Cmd+Shift+X)
3. Click `...` (More Actions) → `Install from VSIX...`
4. Select `mnemographica-0.1.0.vsix`
5. The extension is now installed!

---

## Method 2: Development Mode (F5)

For development/testing:
1. Open `mnemographica` folder in VS Code
2. Press `F5` to launch Extension Development Host
3. The extension is active only in the new window

---

## Method 3: Copy to Extensions Folder (Manual)

### Find Extensions Folder
```bash
# macOS
~/.vscode/extensions/

# Linux
~/.vscode/extensions/

# Windows
%USERPROFILE%\.vscode\extensions\
```

### Create Extension Directory
```bash
mkdir -p ~/.vscode/extensions/mnemographica-0.1.0
```

### Copy Files
```bash
cp -r /code/mnemonica/mnemographica/out ~/.vscode/extensions/mnemographica-0.1.0/
cp -r /code/mnemonica/mnemographica/media ~/.vscode/extensions/mnemographica-0.1.0/
cp /code/mnemonica/mnemographica/package.json ~/.vscode/extensions/mnemographica-0.1.0/
```

### Restart VS Code
The extension will be loaded automatically.

---

## Usage After Installation

1. Open a TypeScript project with mnemonica types
2. Make sure `.tactica/types.ts` exists (run `npx tactica` if not)
3. Press `Cmd+Shift+P` → `Mnemonica: Show Type Graph`
4. Or right-click any `.ts` file → `Show Type Graph`

---

## Troubleshooting

### Extension not showing in Command Palette
- Check that the workspace has TypeScript files
- Reload VS Code window (`Cmd+Shift+P` → `Developer: Reload Window`)

### Graph is empty
- Ensure `.tactica/types.ts` exists in your project
- Run `npx tactica` to generate it

### Extension fails to load
- Check VS Code version (need 1.74.0+)
- Check Output panel → `Extension Host` for errors