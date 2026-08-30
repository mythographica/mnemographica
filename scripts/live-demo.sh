#!/bin/bash
# B1.5 live demo: dive constructions flash cyan in the Mnemonica Graph 3D
# panel, status line shows "⟁ live N (last: X)".
#
# Chain: demo target (:9229, mnemonica types named after mnemographica
# graph nodes) → strategy trace-stream → mnemographica WS :9231 → panel.
#
# Ctrl-C stops everything it started.

set -u

echo "1/4 dive demo target on :9229"
cd /code/mnemonica/tactica-nestjs || exit 1
node --inspect=9229 -e "
const dive = require('@mnemonica/dive');
const { define } = require('mnemonica');
const names = ['Scene3D','Camera3D','GraphNode3D','Link3D','Tooltip3D','ContextMenu','LinkTrie','Trie'];
const types = {};
for (const n of names) { types[n] = define(n, function () { this.created = Date.now(); }); }
let i = 0;
setInterval(() => {
	const n = names[i++ % names.length];
	const inst = new types[n]();
	dive.recordCreation(n, inst);
}, 600);
console.log('demo target up', process.pid);
" &
TARGET=$!

echo "2/4 VS Code (extension dev host) on your display (logs → /tmp/demo-vscode.log)"
DISPLAY=:0 /usr/share/code/code --no-sandbox \
	--user-data-dir /tmp/vsc-mnem/user \
	--extensions-dir /tmp/vsc-mnem/ext \
	--extensionDevelopmentPath=/code/mnemonica/mnemographica \
	--inspect-extensions=9233 --remote-debugging-port=9223 \
	--new-window /code/mnemonica/mnemographica \
	>/tmp/demo-vscode.log 2>&1 &
CODE=$!

echo "3/4 waiting for the extension WS :9231 (up to 2 min; click through any trust dialog)"
for i in $(seq 1 60); do
	ss -tln | grep -q 9231 && ss -tln | grep -q 9233 && break
	sleep 2
done
ss -tln | grep -q 9231 || { echo "extension never came up — check the VS Code window"; kill "$TARGET" "$CODE" 2>/dev/null; exit 1; }

echo "4/4 opening the 3D panel + starting the stream"
node /code/mnemonica/strategy/tools/vsc-driver.js ext "
const req = process.getBuiltinModule('node:module').createRequire('/code/mnemonica/tactica-nestjs/package.json');
const vscode = req('vscode');
vscode.commands.executeCommand('mnemographica.showTypeGraph').then(() => 'opened');
"
node /code/mnemonica/strategy/tools/hold-trace-stream.js &
STREAM=$!

echo ""
echo "DEMO RUNNING — watch the Mnemonica Graph 3D panel:"
echo "  · matching spheres flash cyan as constructions land"
echo "  · status line: ⟁ live N (last: TypeName)"
echo "Ctrl-C here stops target + stream + VS Code."

# Graceful shutdown: TERM only the MAIN code pid and let it take its
# children down itself — a blanket pkill kills children first, the parent
# reports them as crashed, and the window pops "terminated unexpectedly"
trap 'kill "$TARGET" "$STREAM" 2>/dev/null; kill "$CODE" 2>/dev/null; wait "$CODE" 2>/dev/null; pkill -f "vsc-mn[e]m" 2>/dev/null' INT TERM
wait
