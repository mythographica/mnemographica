# Handoff: MnemoGraphica — 3D Scene Redesign (dual-flow)

> For a Claude Code session working in **`github.com/mythographica/mnemographica`**, branch **`re-factoring`**.
> This package is a **design reference**, not production code to paste. The HTML/JS in this folder is a
> standalone Canvas2D prototype that demonstrates the intended *look, interaction model, and information
> design* of the type-graph scene. Your job is to realize these ideas inside the real VS Code extension,
> using its existing architecture (the `src/models/` mnemonica registry, `src/core/GraphBuilder.ts`,
> `src/graph/converter.ts`, and the `media/` webview), and its real data source: the `.tactica/` IR
> (`definitions.json`, `usages.json`, `flow.json`, `eds.json`).

---

## 0. Why this exists (the one design idea)

The current PoC renders **only the inheritance trie** — `src/graph/converter.ts` walks `children` from
parentless roots and emits parent→child links, nothing else. Meanwhile the registry already computes
**execution flow** (`src/models/Flow.ts` → `instantiation` / `propertyRead` / `methodCall`) and **EDS
decorations** (`src/models/EDS.ts` → `wrap` / `link` / `contextConsume` / `hookAttach` / `errorEnrich` /
`adapterUse`) — but neither is drawn on the graph. The FLOW panel shows counts; the scene shows none of it.

**The redesign draws both at once:** *structure as skeleton, flow as muscle.*

- **Data flow** (inheritance trie) = a calm, low-contrast structural skeleton.
- **Execution flow** (invocations) = color-coded, **directional**, animated arcs that cross branches — the
  layer that is "completely undone" today. This is the centerpiece. It is the connection between the
  Data Flow (the trie) and the Execution Flow (invocations) that currently does not exist visually.
- **EDS kind** = a per-node ring glyph (a free second encoding dimension).
- **2D↔3D** = one continuous morph of a single radial layout (not two separate renderers).
- **Human–AI presence** = agent + human "cursors" on the graph, plus a Solo / AI-Pairing / AI-Autonomous
  mode switch — because AI agents are a first-class user of this surface (the CDP→MCP→graph loop).

**Fidelity: high.** Colors, typography, spacing, motion, and interaction are all intended as drawn. Match
them. Where the prototype invents data (see §6) you must instead bind to the real `.tactica/` IR.

---

## 1. What to build, mapped onto the real repo

| Prototype concept | Where it lives in the prototype | Where it should land in the repo |
|---|---|---|
| Dual-flow rendering (skeleton + muscle) | `mg-scene.js` `render()` | `media/graph.js` (webview renderer) — the big change |
| Two link sets: `dataflow` + `execflow` | `mg-data.js` | `src/graph/converter.ts` — emit a second link array from `flow.json` |
| `kind` on exec links | `mg-data.js` `execflow[].kind` | `GraphConverter.convert` — read `Flow` entries, tag each link |
| EDS ring glyph per node | `mg-scene.js` `drawEDS()` | `media/graph.js`; map via existing `GraphBuilder.mapEDSKind` |
| 2D↔3D morph (depth = generation) | `mg-engine.js` `project()` | new projection util in webview; drive from `Scene2D`/`Scene3D` models |
| FLOW panel → isolate a kind | `mg-ui.js` `buildFlow()` | existing FLOW panel; post a `filterKind` message to the webview |
| Layer toggles | `mg-ui.js` `LAYERS` | webview UI; toggles set render flags |
| Collab modes + presence | `mg-ui.js` collab seg + `mg-scene.js` `drawPresence()` | fed by the `strategy` MCP server (agent focus) over the existing webview message channel |
| S¹ substrate ring overlay | `mg-data.js` `ring` + `mg-scene.js` `showRing` | optional; from a `typeømatica` substrate-edge set if/when available |

**Important:** the current `media/graph.js` uses **D3 + SVG force simulation**. The prototype uses **hand-rolled
Canvas2D** because it needed precise control of the 2D↔3D morph, depth fog, and painter's-algorithm sorting
that are awkward in SVG at this node/edge count. Recommendation: **move the scene to Canvas2D (or WebGL via
three.js / regl for the 3D scene)** — the `re-factoring` branch's stated goal of splitting a reusable core
from the VS Code shell is the right moment to do this. If you keep D3, keep it only for the **force layout
solve**, and render to Canvas yourself.

---

## 2. Layout & projection (the 2D↔3D morph)

One radial layout serves both modes. See `mg-engine.js`.

- **Layout:** radial tidy-tree. `radius = generation × ringGap`, `angle` = position within subtree,
  apportioned by **leaf count** so dense subtrees get proportional arc. (`layout()` in `mg-engine.js`.)
- **Generation** = depth in the inheritance trie (root = 0). It drives **both node color and Z-depth**.
- **The morph:** a single scalar `mode3d ∈ [0,1]`.
  - At `0`: flat concentric rings on the z=0 plane — a clean radial diagram for **explaining**.
  - At `1`: each generation is pushed apart along **Z** (`z = -gen × depthGap × mode3d`), forming a
    rotatable "lineage tunnel" where **depth itself encodes generation** — for **exploring**.
  - Camera yaw/pitch are multiplied by `mode3d`, so at `mode3d=0` the view is a true flat top-down (no
    shear). See `project()` in `mg-engine.js`.
- **Perspective:** `persp = dist / (dist - z)`; nearer nodes render larger. Sort nodes far→near before
  drawing (painter's algorithm). Apply **depth fog** (mix node/edge color toward background by normalized
  depth) so the tunnel reads.

This is the key UX question for the author to answer: **3D tunnel for exploring vs. flat radial for
explaining.** Keep both; default to whichever the author prefers after using it.

---

## 3. Rendering spec (per layer)

All drawing is in `mg-scene.js` `render()`. Draw order: background → grid → **skeleton** → **muscle** →
S¹ ring → nodes → presence → labels.

### 3a. Data flow (skeleton)
- Straight line, parent→child. Stroke `--skeleton` (dark `rgba(150,162,180,0.22)`, light `rgba(40,48,60,0.22)`).
- When a node is focused (hover/select), dim every edge **not** in the focused subtree to `--skeletonDim`.

### 3b. Execution flow (muscle) — the centerpiece
- **Quadratic curve** between source/target, offset along the edge normal so parallel calls fan out
  (lift `= 26 × ((i%3)+1) × 0.5 × scale`).
- **Color by kind:** `instantiation #46c98b` (green), `propertyRead #5aa7f0` (blue), `methodCall #f0b14a` (amber).
- **Directional:** filled arrowhead at the target, offset by the target node radius.
- **Animated flow:** dashed stroke with a moving `lineDashOffset` (`-t × 26 × kindSpeed`), so each kind
  visibly "flows" toward its target at a kind-specific speed. Respect `prefers-reduced-motion` — freeze
  the dash offset when set.
- **Focus behavior:** when a node is selected, exec edges touching it go to full opacity + thicker; all
  others drop to ~0.14 alpha. This is the skeleton-vs-muscle payoff — *select Registry and watch its
  `methodCall` fan light up while the trie recedes.*
- **FLOW-panel filter:** clicking a kind in the FLOW panel isolates only that kind on the graph.

### 3c. EDS rings
Per-node decoration drawn just outside the node. Each kind has a distinct glyph (`drawEDS()`):
- `wrap` → double concentric ring
- `link` → dashed ring
- `contextConsume` → fine dotted ring
- `hookAttach` → ring with 3 radial ticks (slowly rotating)
- `errorEnrich` → solid ring in the **error color** (`--err`)
- `adapterUse` → four corner brackets (a "frame")

Map from your existing `GraphBuilder.mapEDSKind`. The glyphs are intentionally subtle — second open
question for the author: are they legible enough, or should EDS also tint the node body?

### 3d. Nodes
- Radius by generation: root 15, gen-1 10.5, deeper 7.5 (× perspective scale).
- Fill = generation color, mixed toward bg by depth fog. Soft halo ring behind. Thin light stroke.
- **Color = generation** palette (6 hues, cycle if deeper):
  - dark:  `#f2c14e #ef8b6b #e8688e #b07cd6 #5b9bd6 #4fc4b0`
  - light: `#b98512 #cf6038 #c33a66 #7d44bd #2f6fb0 #13917c`

### 3e. Labels (collision-aware)
- Monospace, drawn after nodes. Maintain a list of placed label boxes; **skip any label that overlaps an
  already-placed one** — unless the node is focused (focused labels always win).
- Priority order: focused subtree → lower generation → nearer camera.
- Density: show gen 0–1 always; deeper labels only when zoomed in (`zoom > 1.7`) or in "all" mode.

### 3f. Human–AI presence (`drawPresence()`)
- **Solo:** none.
- **AI Pairing:** agent aura on its focus node (`◈ opus-4.8 · reading`, teal) + human aura (`◈ you ·
  editing`, amber). Pulsing double ring + a labeled tag.
- **AI Autonomous:** the agent **hops along execution edges** every ~2.2s (`◈ opus-4.8 · traversing`),
  emitting an `agentmove` event. In the real product this position comes from the **`strategy` MCP
  server** (the running process's focus via CDP), *not* a random walk.

---

## 4. Tool shell / panels (already-correct information architecture)

The prototype's chrome mirrors a VS Code extension and is a good target for the panel layout:
- **Toolbar:** brand + branch tag · collab-mode segmented control · 2D/3D toggle · theme · reset view.
- **Activity rail** (left, 48px) + **Explorer** (model tree grouped by generation, EDS tag per row).
- **Stage:** the canvas + a floating HUD legend (one chip per flow kind + the skeleton).
- **Inspector** (right): **FLOW panel** (kind → bar + count, click to isolate) · **Layers** (4 toggles:
  data flow, execution flow, EDS rings, S¹ ring) · **Layout** (sliders: 2D→3D depth, force/spread,
  spacing, generation depth) · **Selection** (lineage + in/out invocations, click to navigate) · **EDS legend**.
- **Status bar** (bottom): type count · invocation count · current mode.

The **Layout sliders are the author's requested tweak surface** — keep them as first-class inline controls,
not a hidden panel.

---

## 5. Design tokens

**Typography:** UI = `Hanken Grotesk` (400/500/600/700); data/code/labels = `JetBrains Mono` (400/500/600).
In the extension, prefer the user's VS Code editor font for mono where appropriate.

**Themes** (both required). Full token sets are in the `:root[data-theme=...]` blocks of `MnemoGraphica.html`:
- Dark: bg `#0d1014`, panel `#14181e`, border `#232a33`, text `#d3dae3`, dim `#828d9c`, accent `#7cf0d2`,
  ring `rgba(214,224,235,0.55)`, error `#f0616b`.
- Light: bg `#f4f2ec`, panel `#ece9e0`, border `#d7d2c5`, text `#23272e`, dim `#6b7280`, accent `#0f9c86`,
  ring `rgba(30,36,46,0.5)`, error `#cf3b46`.

**Flow-kind colors** (theme-independent): instantiation `#46c98b`, propertyRead `#5aa7f0`, methodCall `#f0b14a`.

**Motion:** dash-flow on exec edges (continuous, reduced-motion-aware); 520ms ease for the 2D↔3D morph;
gentle idle yaw auto-rotate in 3D after 4s of no interaction; presence pulse ~2.4 rad/s.

---

## 6. Data binding — READ THIS

The prototype's `mg-data.js` is a **hand-authored reconstruction** of the extension's own model registry
(the tool drawing itself — 28 nodes from `src/models/` + `src/core/`). **The execution-flow edges and the
FLOW counts in the prototype are illustrative, not real.** In the extension you must instead:

1. Read `.tactica/definitions.json` → nodes + the inheritance (data-flow) links (this already works via
   `converter.ts`).
2. Read `.tactica/flow.json` → **execution-flow links**, each tagged with its `kind`
   (`instantiation`/`propertyRead`/`methodCall`). **This is the new data path to add to `converter.ts`.**
3. Read `.tactica/eds.json` → per-node EDS kind (already available via `GraphBuilder.mapEDSKind`).
4. FLOW-panel counts = aggregate of `flow.json` by kind (the real panel already does this).

Shape the converter output as two link arrays so the renderer can layer them:
```ts
interface GraphData {
  nodes: D3Node[];               // + gen (trie depth), eds (kind|null)
  dataflow: { source, target }[];        // inheritance (skeleton)
  execflow: { source, target, kind }[];  // invocations (muscle)  ← NEW
}
```

---

## 7. Files in this bundle
- `MnemoGraphica.html` — the shell, all design tokens, panel markup. Open in a browser to interact.
- `mg-data.js` — reconstructed registry + the two link sets (reference for data shape; **not** real data).
- `mg-engine.js` — radial layout + the 2D↔3D projection math (`layout()`, `project()`).
- `mg-scene.js` — the Canvas2D renderer: dual flows, EDS glyphs, fog, labels, presence (`render()`).
- `mg-ui.js` — panel wiring: explorer tree, FLOW filter, layer toggles, sliders, selection inspector.

To run the reference: open `MnemoGraphica.html` in any modern browser. Drag = orbit, scroll = zoom,
click a node = inspect. Toggle 2D/3D and the collab modes in the toolbar.

## 8. Suggested implementation order
1. Extend `converter.ts` to emit `execflow` (with `kind`) from `flow.json`. Verify counts match the FLOW panel.
2. Swap the webview scene to Canvas2D; render the **skeleton** first (parity with today).
3. Add the **muscle** overlay (curved, directional, animated, color-by-kind) + focus dim/highlight.
4. Add the **2D↔3D morph** (single `mode3d` scalar; depth = generation).
5. Add **EDS ring glyphs** + **collision-aware labels** + the **Layers** toggles + **FLOW isolate**.
6. Wire **presence** to the `strategy` MCP feed (replace the prototype's random walk).
7. Both themes; honor `prefers-reduced-motion`.
