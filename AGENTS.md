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
   - Creates the tree views, registers commands and file watchers
   - Starts the Strategy server, loads models via topologica
   - Owns `refreshTypeGraph()` — the single refresh path all watchers funnel into
   - Registers a URI handler: `vscode://mnemonica.mnemographica/trace?root=N`
     (exact dive root edge) or `?jaeger=<traceId>` (matches any ring edge's
     OTEL traceId — robust when the true root predates the push window).
     Jaeger's linkPatterns (strategy/tools/jaeger-ui.json) generate these
     links from span tags, closing the Jaeger → Live Trace → 3D loop.

2. **Registry** (`src/models/Registry.ts`) — the controller
   - The only model doing file I/O: `loadFromWorkspace()` reads `.tactica/*`
   - Types are loaded from `hierarchy.json` (structure, dot-joined fullPaths,
     1-based define()-site locations); property signatures are parsed from the
     generated `types.ts` bodies, the only place they exist
   - `instrumentation.json` (NestJS lifecycle crossroads) loads through the
     same stale guard as `eds.json` — a file older than `definitions.json`
     is skipped. The `Instrumentation` model holds a FLAT points list
     (`all()`), not a per-type Map. v2 payloads also carry `creationGraph`
     (static call chains from entry points down to every `new` site):
     stored as plain transfer data (`getCreationGraph()` /
     `hasCreationGraph()`), absent for v1 files, dropped by the model's
     `clear()` together with the points
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
   - When the Instrumentation model carries a creationGraph (v2), attaches an
     optional `creation { nodes, links }` section: scopes keyed by tactica
     scopeId, caller→callee links, and per-holder `creates` anchors joined to
     graph nodes by dot-joined fullPath (anchors naming unknown types are
     dropped, same policy as execflow). Creation nodes stay OUT of `nodes` —
     stats, gen controls, and trace mode never see them
   - When the EDS model carries wrap entries, attaches an optional `wrappers
     { nodes, links }` section: one node per wrap call site (id = location),
     `generation` walked from the `via` chain (memoized, cycle-guarded),
     cross-layer joins as NODE fields — `callbackScopeId` (preferred) /
     `holderScopeId` (fallback) into the creation graph, `wrapsTypePath` into
     the type graph — all surviving only when their target exists. Wrapper
     nodes stay OUT of `nodes`, same isolation policy as creation nodes

4. **Tree view providers** (`src/views/`)
   - `liveTraceTreeProvider.ts` — Live Trace: the trace ring grouped into
     recent traces, merged by root name AND trace shape (2026-09-05,
     Viktor's review — the pure name merge of 2026-09-02 collided
     DISTINCT traces sharing a root: a trace ending at one wrap site is
     not the trace ending at another): the shape signature is the sorted
     set of the trace's `kind:name` edge identities (the callsite rides
     the name for call/method edges), loop ×N multiplicity folded out —
     one `[2][×49] name` group row per name+shape
     (2 edges per trace, 49 such traces in the
     ring), discriminated by the trace's endpoint (`→ UserResponse`,
     its chronologically last edge) when several shapes share a name,
     expanding to individual traces (`[2] #rootId` — exact-pick
     while they're in the ring, fan-out capped at 100 with a "more in
     Jaeger" overflow row), each expanding to per-edge code jumps;
     click isolates the trace in the 3D panel AND reveals its tab.
     Sort is tiered: UNKNOWN ERROR (errored trace with no create edge —
     nothing to pin the failure to) > ERROR > healthy, newest-first
     inside a tier. Single-trace names render directly, no nesting.
     Identical sibling edges merge into one `label ×N` row (a request
     loop chains the same callsite N times — N lines are noise). Errored
     traces and edges render red (`errorForeground`); edges whose
     `instanceSource` is `ambient` (dive's lastContext fallback) get a
     `question` icon and a tooltip warning — the instance may belong to a
     different flow. Row click isolates by rootId — name resolution can
     bind to a DIFFERENT trace ending on the same type name. Context menu: "Replay Trace" (human-speed
     re-walk of the lineage in 3D, ~650ms per edge, errored steps flash
     red) and "Open in Jaeger" (rows whose edges carry an OTEL `traceId`
     forwarded by strategy's push mapper; base URL overridable via
     MNEMOGRAPHICA_JAEGER_URL). Replaced the Welcome placeholder
     2026-09-01 — humans can't track a millisecond event stream, so the
     sidebar collects it. Traces that aged out of the ring are Jaeger's
     job — the ring is "now"
   - `treeProvider.ts` — Definitions section (define() sites) and Types section
     (generated aliases in types.ts)
   - `usagesTreeProvider.ts` — usages per selected type
   - `flowTreeProvider.ts` — flow.json grouped kind → type → entry;
     entry rows carry the `file.ts:line` tail as description so
     identical labels (".value" × N under one type) stay
     distinguishable (2026-09-05 review)
   - `genTreeProvider.ts` — graph nodes grouped by depth; group rows
     explain the generation rule in their tooltip, node rows show the
     immediate parent as `← Parent` description (the dot-joined id IS
     the define() chain — the parent path is the prefix)
   - `diamondsTreeProvider.ts` — Diamonds: the instrumentation.json v2
     creationGraph as a type-path trie → the scopes holding each
     `new` site (click jumps to the site; v1 payloads get an
     explanatory row instead of an empty pane)
   - `bagelsTreeProvider.ts` — Bagels: eds.json wrap sites as a
     type-path trie keyed by the type the bagel belongs to
     (`wrapsTypePath`, else the EDS scope key when it names a known
     type, else a "(no type context)" bucket); rows carry the
     GraphBuilder via-generation as `gen N` description

4b. **3D graph panel** (`src/webview/panel.ts` + `media/webview.js`)
   - The `mnemographica.showTypeGraph` command ("Ψ 3D") opens an interactive
     Three.js scene of the current GraphData — 3D-only (the 2D view was
     retired 2026-08; the dormant 2D renderer remains in webview.js but is
     never entered). Loads d3/three from CDN, so it needs network access.
     The 2.5D Canvas panel was fully removed.
   - **Layer groups, one scene** (2026-09-03; Dive merge 2026-09-04):
     type spheres live in `typesGroup`; `instrumentationGroup` carries the
     creation layer, `diveGroup` the combined Dive layer (wrappers and
     the internals backplane merged under one `dive ◯` toggle).
     The creation layer (instrumentation.json v2, landed 2026-09-04):
     the main.ts starter as
     a gold DIAMOND tangent to the collection marker's right side (+X) —
     both graphs keep their own center side by side; the maroon marker
     (labeled with the collection name, `defaultTypes` until tactica
     emits collection ids) belongs to the types layer and never yields
     (`updateCenterMarkerVisibility` runs on render and on every Layers
     toggle). Other starters sit on normalized sub-rings between center
     and the gen-0 shell (one ring per hop from the center,
     Fibonacci spread), holder scopes render as DIAMONDS on a hidden
     CONCENTRIC SHELL around their created type's sphere (dir ×
     nodeRadius × 2.4 from the sphere center; the first holder keeps the
     +X anchor, co-holders Fibonacci-spread over the whole shell — a
     tangent pile of co-holder labels hid the sphere), EVERY held
     type — the primary included — gets a DASHED edge with an
     arrowhead at the sphere tip (LineDashedMaterial;
     `computeLineDistances` on every dynamic rewrite), so a dragged
     diamond never loses what it creates; the connector tip is the
     surface point FACING the diamond on the live center line
     (`sphereTipToward`, 2026-09-05 review — the old tangent point
     kept the initial shell-slot direction, so a dragged diamond's
     arrow read as off-center); call edges carry arrowhead
     cones as well (caller → callee). The bar stretch
     was tried and rejected, the diamond keeps its shape and the links
     read as invocation edges. Holders wired into the call graph glow
     cyan (0x26c6da), isolated ones (their own entry points) keep orchid
     (0xda70d6). Mid-chain scopes interpolate between their chain's
     starter and holder by relative hop distance. Holder/chain/edge
     geometry recomputes on every
     `updateLinkPositions()` call (a user-dragged holder pins RELATIVE
     to its primary sphere — `pinAnchor` + `pinOffset` in userData, so
     dragging the sphere afterwards carries the diamond along as if
     never detached, 2026-09-05 — and connectors follow from wherever
     it lands; a user-dragged CHAIN scope keeps its drop spot — the
     starter→holder interpolation skips pinned meshes, the same
     absolute-pin rule as anchor-less holders, 2026-09-05 review:
     app.module.ts used to snap back mid-drag and read as "not
     movable"), so
     shells follow dragged type spheres
     and `adjustGenRadius` (which re-runs `renderGraph`) re-lays the whole
     layer out. The holder-shell factor is a panel knob
     (`layerDistances.creation.holderShell`). The NestJS-heritage diamond graph built on static
     instrumentation.json v1 was reverted 2026-09-03 as unusable — the
     v1-points diamond rendering stays gone; diamonds returned with
     creation semantics. The "Layers & Distances" panel (merged
     2026-09-05 from the separate Generation Distances + Layers
     sections) gives each layer a COLLAPSIBLE header row — visibility
     checkbox (reads the LIVE `group.visible`, a rebuild never lies) +
     ▸/▾ toggle — with that layer's own distance knobs inside: the
     generation radii under `types` (±15, cascading outward so shells
     never cross), `Holder ring` under `instrumentation ◆`, and
     `Ambient ring/step`, `Onion gap`, `Sink/Jaeger offset` under
     `dive ◯`. Knobs live on `renderer.layerDistances`, the builders
     read them live, any adjust re-runs `renderGraph` and rebuilds the
     panel (expansion state survives in `expandedLayerControls`).
     Relayouts preserve CURRENT positions (2026-09-05 review): a dragged
     sphere writes `node.x3d/y3d/z3d` — `calculatePosition` honors it and
     `relaxTypeShells` skips user-placed spheres (they repel neighbours
     but never move) — and non-sphere pins are snapshotted before
     `clear()` and restored after the builders (relative pins re-resolve
     their anchor mesh and keep the offset, absolute pins land on their
     stored spot). Only UNtouched elements follow the new distances —
     with one exception: a knob change SCALES the pinned elements it
     governs by the value ratio (holder ring × pinOffset of anchored
     diamonds, sink/Jaeger offset × knot X — anchored sinks scale
     their pinOffset instead — ambient ring/step × the
     anchor-less bagel's radial slot, generation radii × the dragged
     sphere's stored x3d/y3d/z3d — radial scaling keeps each sphere's
     direction, 2026-09-05 review: "the knob must reach repositioned
     elements, spheres at least") so pins don't make the knob look
     dead; the arrangement keeps its shape, stretched.
     Checkbox flips stay purely local, nothing posted to the host. Creation meshes stay out of `nodeMeshes`,
     but ride the interactive list (drag pins, click shows the scope
     tooltip, double-click jumps to the scope's location); THREE's Raycaster does not
     skip invisible objects, so all four raycast sites go through
     `firstVisibleIntersect()`. Every label carries a thin grey LEADER
     LINE down to its mesh (2026-09-04 review: floating labels over
     dense clusters were unreadable).
   - **Dive layer, wrappers half** (`diveGroup`, landed 2026-09-04;
     merged with internals under the single `dive ◯` toggle 2026-09-04):
     eds.json wrap entries render as amber TORUS rings — the dive "wrap"
     made visible. A bagel ENCIRCLES the element it wraps, drawn
     VERTICAL (the EDS ring at the origin stays the horizontal-tilted
     one), SNUG — just bigger than the wrapped element's diameter:
     centered on the hosting scope's DIAMOND (the common case —
     wrap(fn, instance) wraps the callback fn; the instance is only
     the context carried along), or on the type SPHERE only when no
     scope hosts the wrap (the genuine constructor wrap, dive('T',
     wrap(fn), scope) at define time), or on an outer
     ambient shell (gen0Radius × 1.4, stepping out per generation) when
     the wrap joins nothing. Several bagels on one target onion out:
     ring radius × (1 + k·0.22), the vertical axis rotated
     k·goldenAngle around Y — a gyroscope shell, never a stack.
     Fiber edges are DIRECTED, one arrowhead cone per edge:
     solid amber (0xffb300) for the `via` generation chain, DASHED
     light-amber (0xffd54f) for the construction-mediated (ctor) hop —
     a wrap whose createsTypes holds T parents every wrap hosted by T's
     define handler or wrapping a T instance (at runtime the child's
     first edge parents on T's create edge). Cross-layer joins are
     DIRECTED arrows too: salmon (0xff8a65) diamond → bagel for the scope
     the wrap is called in, warm orange (0xf9a825) sphere → bagel for the
     type whose handler PRODUCED the wrap (`hostTypePath`, emitted by
     GraphBuilder). The diamond → bagel join edge is zero-length while
     the bagel encircles that very diamond (the ring IS the link) and
     reappears when the bagel is dragged out — attribution survives. Terminal fibers (nothing wraps them
     later — a throw wrapper whose runtime parent hangs off an
     unattributable property read) carry an "ambient / terminal fiber"
     note in their tooltip instead of an outgoing arrow. All edge kinds are
     batched LineSegments (one entry in `wrapperLines` per kind) whose
     endpoints rewrite from live positions in `updateLinkPositions()`,
     AFTER creationDynamics — encircling rings re-center on their live
     target meshes, so dragging either side keeps the bagel around its
     target (a dragged bagel pins RELATIVE to its anchor — the scope
     diamond or type sphere — and follows it on later anchor drags;
     only anchor-less ambient bagels pin absolutely, 2026-09-05). Rings are unit tori scaled
     per-mesh, sharing one geometry and one material (disposed once in
     `clear()`); labels are per-mesh and join the layer group, same as
     creation's, each with a leader line; co-centered onion labels
     de-stack one text line per level (`labelOffsetY = ringR + 6 +
     k×14`), or 11 wraps on one type pile into one unreadable label. Wrapper meshes stay
     out of `nodeMeshes` but ride the interactive list: drag pins,
     click shows the wrap tooltip (including WHAT it wraps), double-click
     jumps to the wrap site.
   - **Layout relaxation** (2026-09-04 review: dense shells crossed
     figures and labels): two deterministic steps. (1) Initial shell
     radii widen with node counts (circumference ≥ count × 10
     nodeRadii — raised from ×6 on 2026-09-05, crowded shells must
     stay readable at a glance, not just non-overlapping; shells kept
     strictly ordered) — only at init, the layer distance
     sliders own the values afterwards. (2) `relaxTypeShells()`
     runs at the end of `renderGraph`: type spheres repel SLIDING ON
     THEIR OWN SHELL (radial distance is invariant — generation geometry
     never collapses, only the angular position moves), with effective
     radii ×2.2 uncrowned and ×(3.3 + min(crown,8)×0.15) crowned
     (both raised 2026-09-05 from ×1.7 / ×(2.9+0.12crown); crowns
     hold diamonds at the ×2.4 default holder shell) so crowns
     stop colliding; fixed iteration order and cap (80 iterations,
     damping 0.4, ε 0.05) — same graph, same layout, every render.
     Labels then alternate above/below their sphere (leader lines keep
     attribution), and the whole dynamics chain (diamond shells, bagels,
     edges) follows through `updateLinkPositions()`.
   - **Over-pole camera** (2026-09-05): ctrl+drag no longer clamps
     latitude at ±90° — the camera tumbles over the poles, full
     north-to-south. `camera.up` flips sign past each pole in
     `updateCameraPosition()` (must precede `lookAt`, which reads it),
     so the roll stays continuous instead of a 180° snap at the pole;
     the angle wraps into [−π, π] to keep the numbers small.
     Programmatic focus (`focusNode`) still clamps its targets into the
     upright band — a focus always lands right-side up.
   - **Render-on-demand** (2026-09-04): `animate()` keeps its rAF loop
     but calls `renderer.render` only when `needsRender` is set (every
     mutation site flags it — `updateCameraPosition`,
     `updateLinkPositions`, `updateHover`, `setFocusedMesh`, trace-mode
     enter/extend/exit, `resize`, the Layers checkboxes), while a
     continuous animation is live (focus anim/pulse, trace/replay
     flashes; the pre-updater `wasAnimating` snapshot in `animate()`
     guarantees the settle frame still paints), or a ~1Hz heartbeat
     fires as self-heal for a missed flag. Idle panel: ~1 frame/sec
     instead of 60 (measured headless: 3 frames per 183 rAF ticks) —
     an open static graph no longer spins the laptop fan
   - **Internals backplane** (redesigned 2026-09-04): the DECLARED knots
     the fibers plug into at runtime, living in the same `diveGroup`.
     Declared, not discovered: the calls completing the fiber chain live
     inside the dive/adapter packages — `src/graph/internals-manifest.ts`
     mirrors them with a source citation per knot; every edge was
     verified against the cited source. Six knots by role: the **EDS
     ring** (dive's runtime storage — every fiber lands there) as a thin
     steel-blue (0x7aa2f7) torus ENCIRCLING the maroon collection marker
     at the origin, Saturn-tilted, label below — the third convergence
     point alongside the collection marker (instances) and the main.ts
     diamond (invocations), all keyed by paths; the **attachHooks hub**
     as a steel-blue octahedron at the ring's right side (+X, the same
     side convention as the creation center diamond); three **adapter
     sinks** (AsyncFlowProvider, DiveOtelProvider, TraceExceptionFilter)
     as violet (0xb48ead) boxes in a DETERMINISTIC compact vertical
     stack just outside the gen-0 shell on the LEFT (−X, gen0 × 1.3,
     half-shell vertical step); and **Jaeger** — the only terminal
     outside the system — as a gold (0xf0c674) cone leftmost of all
     (gen0 × 1.65). The sink zone never moves
     between renders, so the eye learns where every fiber ends. Sink edges are solid
     slate with arrowheads, directed as DATA flows: ring →
     providers/filter (the filter's edge is labeled
     `getFlow / getErrorInstance`) → Jaeger — and they ride
     internalsDynamics, so dragged sinks keep their edges (sticky). The collection → hub hookup
     is dashed slate. The **attachHooks grafts** are the hub firing:
     whisper-thin (opacity 0.22) blue QuadraticBezier curves bowed
     outward, one per REALLY constructed type, landing just past the
     type's sphere — never-created types get none (hooks never fire for
     them). The **usages census** (usages.json `instantiation` entries)
     also dims never-created spheres (opacity 0.35) and flags their
     path-hit edges `neverTaken` (rendered at 0.12 instead of 0.5, the
     EdsProbe → UserEntity diagnostic). dive's internal functions
     (recordCreation/enterContext/…) are NOT knots — they are event
     chunks of the hub firing, folded into the grafts. Hookup endpoints
     and grafts rewrite in `updateLinkPositions()` after
     wrapperDynamics. Internal meshes stay out of `nodeMeshes` but ride
     the interactive list like wrappers (drag pins ABSOLUTELY for the
     ring/hub/cone — those knots have no anchor to follow; adapter
     SINKS pin RELATIVE to the Jaeger cone, so dragging the cone
     carries the connected adapter stack as if never detached,
     2026-09-05 owner review — click shows the knot
     tooltip with its source citation — no jump, the citation points
     into a sibling repo). A **legend** (`#dive-legend`, bottom-left)
     names every shape/color/edge kind — 16 rows. The legend header
     is both the collapse toggle and the drag handle (2026-09-05
     review): a press moving < 4px counts as a click and toggles the
     rows, a real drag repositions the panel (switching its CSS
     bottom-anchor to explicit left/top, clamped to the viewport).
   - **Show on Graph** (Types trie context menu, 2026-09-05): opens
     the 3D panel when closed, then focuses the node. The focus
     request rides a two-level queue so it survives the fresh panel's
     load window — panel-side `GraphPanel.pendingFocus` flushed on
     the webview's `ready`, webview-side `pendingFocusNode` flushed
     at the end of `render3DGraph`.

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
   - Beyond the MCP tools, the WS channel carries two first-class
     methods (B1.3 bidirectional envelope): `trace/ingest` and
     `state/query`. `trace/ingest` (`{ edges, source? }` — dive-trace
     deltas land on the `Main` instance via the orchestrator,
     ring-bounded at 5000): dedup is monotonic per source process
     EXCEPT lifecycle completions — `leave`/`settle` re-publish an edge
     id already ingested via `enter`, and those are upserted in place
     (status/duration/ts merge, counted as `updated`, still forwarded
     to the panel and the Live Trace tree); without the upsert every
     call edge would stay `running` forever. Trace mode resolution is
     by rootId (`getTraceLineageByRoot`); the older name resolver
     remains for the webview's own pick flow. In 3D trace mode, edges
     whose status is `error` paint their sphere red (0xff2020) instead
     of green, and the ambient flash lasts 5s (raised from 4s for human
     perception). Live-flash distrust: edges whose `instanceSource` is
     `ambient` advance the status counter but never flash a bulb —
     attribution must be true or absent, never guessed. `state/query` (`{ subject, sample? }` — subjects
     `server`, `graph`, `trace`, `view`; `view` roundtrips into the 3D
     webview for the live camera + focused node)
   - **Bound to 127.0.0.1** — there is no auth,
     so it must never listen on a LAN interface

7b. **Strategy tabs** (`src/webview/strategyPanel.ts`,
   `src/webview/appChannelPanel.ts`, `src/strategy/processManager.ts`,
   `src/strategy/appChannelClient.ts`)
   - `mnemographica.openStrategyTab` ("Ψ Strategy MCP") spawns the
     @mnemonica/strategy MCP server as a child process with
     `STRATEGY_LOG_PORT` (default 9250, setting
     `mnemographica.strategyLogPort`) and tees its stderr-mirrored log
     socket into the panel; the child is disposed on deactivate.
   - `mnemographica.openAppChannelTab` ("Ψ App Channel") connects
     DIRECTLY to an app's embedded strategy WS channel: discovery via
     `GET <mnemographica.appChannelDiscoveryUrl>` (default
     `http://127.0.0.1:3000/strategy/channel`) or manual host/port/token,
     then `trace/subscribe`; edges land on the orchestrator as source
     `app-channel:<pid>`. No CDP anywhere on this path.
   - `WSSession` is loaded by **absolute path** from the resolved
     package root, not via the package root export — that would pull the
     MCP SDK into the extension host. (In the `file:`-dep era the symlink
     realpath also escaped the extension's module root; the dep is a
     registry install now.)

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
  `clear()`/reload regression (getter-only properties used to break refresh),
  the instrumentation.json load/clear pins (Tests 18–19), and the v2
  creationGraph load / v1 absence / stale-guard / model-clear pins
  (Tests 20–23)
- `test/types-model.test.js` — Types model as pure data container
- `test/types-parser.test.js` — types.ts alias/parent regex against the repo's
  own `.tactica/types.ts`
- `test/graph-builder.test.js` — GraphBuilder → GraphData: the v2
  creation section (counts, anchor joins, display names, stats
  isolation) and its absence for v1 payloads; the wrappers section
  (`via` generation chain + `ctor` construction-mediated fiber hops);
  the internals backplane (6 declared knots, sink edges, the collection
  hookup, census-driven grafts, never-created spheres and never-taken
  path-hits)

The fixtures live in `test/fixtures/.tactica/` (v1 instrumentation payload)
and `test/fixtures-v2/.tactica/` (real tactica v2 output, regenerated from
tactica-nestjs with `tactica -p <tactica-nestjs>/tsconfig.json -o
test/fixtures-v2/.tactica`), both mirroring real tactica output (including
`hierarchy.json`).

Manual testing:
1. Press `F5` to launch extension host
2. Open a project with `.tactica/` generated by a current tactica
3. Explore the Mnemonica activity bar views (Live Trace, Usages, Types, Flow, By Generation, Diamonds, Bagels)

## Agent Automation (CDP)

The extension exposes a debug handle for external tooling (Strategy MCP,
CDP-driven tests): `globalThis.__mnemographica` in the extension host,
set at the end of `activate()` (extension.ts) — holds `treeProvider`,
`treeView`, `usagesProvider`, `flowProvider`, `genProvider`,
`diamondsProvider`, `bagelsProvider`, `liveTraceProvider`,
`mainOrchestrator`, `strategyServer`. The 3D webview exposes `window.__mnemographica3D` (the
`Graph3DRenderer` instance) for camera/scene readback.

Headless dev instance (does not touch the user's display):

```bash
xvfb-run -a -s "-screen 0 1600x1000x24" /usr/share/code/code \
  --no-sandbox --disable-gpu --enable-unsafe-swiftshader \
  --user-data-dir /tmp/vsc-mnem/user --extensions-dir /tmp/vsc-mnem/ext \
  --extensionDevelopmentPath=$PWD --inspect-extensions=9233 \
  --remote-debugging-port=9223 --new-window /path/to/workspace
```

Notes, all hard-won:
- Use the Electron binary directly — the `code` wrapper script exits
  silently under `xvfb-run`.
- `--enable-unsafe-swiftshader` is required or the WebGL canvas paints
  black (scene builds fine, nothing shows).
- Port 9222 may be occupied on the dev machine; check before reuse.
- Extension host CDP: port 9233; EH is ESM — get `vscode` via
  `process.getBuiltinModule('node:module').createRequire('<existing file>')`.
- Workbench CDP: the `--remote-debugging-port` port. Webview access:
  attach to the single `vscode-webview://` iframe target (the outer
  shim), then reach the graph through
  `document.querySelector('iframe').contentWindow.__mnemographica3D`.
  `Page.captureScreenshot` can serve a STALE compositor frame under
  xvfb — for pixel truth, eval `renderer.render(scene, camera)` +
  `renderer.domElement.toDataURL()` in one synchronous task.
- `TreeView.reveal` works for automation: `MnemonicaTreeProvider`
  implements `getParent` and items carry stable `id`s.
- Kill the instance when a debugging bout ends — a parked VS Code burns
  CPU and the laptop fan (owner's hardware-conservation rule).
- SIGKILLed VS Code leaves orphaned `dconf watch /system/proxy/` children
  holding the devtools ports via fd inheritance — sweep with
  `pkill -f "dconf watc[h] /system/proxy"` (bracket pattern avoids
  self-matching). The bracket must cover EVERY occurrence in the
  compound command — a bare copy of the pattern string in a later
  `pgrep`/`echo` argument makes `pkill -f` kill the invoking shell
  itself (exit -1), aborting the rest of the cleanup.

## File Structure

```
src/
├── extension.ts          # Main extension entry
├── webview/panel.ts      # 3D graph panel (renderer: media/webview.js, CDN libs)
├── webview/              # + strategyPanel.ts / appChannelPanel.ts — the two Ψ tabs
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
├── strategy/             # MCP-shaped server (127.0.0.1 only), processManager
│                         # (spawn strategy child + log socket), appChannelClient
│                         # (direct WS to an app's embedded strategy channel)
├── topologica/           # Model bootstrap loader
├── types/
│   ├── index.ts          # GraphData/D3Node/D3Link/D3ExecLink
│   └── tactica-types.ts  # TypeNode/PropertyInfo
└── views/                # Tree view providers (Live Trace, Usages, Types,
                          # Flow, By Generation, Diamonds, Bagels)
```

## Dependencies

- **mnemonica**: The type system itself (models are mnemonica types)
- **@mnemonica/topologica**: Module loader that self-defines model types
- **@mnemonica/tactica**: Type analysis (dev-time `.tactica` generation)
- **ws**: Strategy server WebSocket transport
- **@mnemonica/strategy**: registry dep (`^0.5.1`); provides `WSSession`
  for the App Channel tab and the server binary spawned by the Strategy
  tab. (Was `file:../strategy` until strategy 0.5.1 shipped — `vsce
  package` does not follow `file:` symlinks, so a `.vsix` needs the
  registry dep it now has.)

## VS Code API Usage

- `vscode.window.createTreeView`: The exploration views
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
