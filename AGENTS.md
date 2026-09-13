# AGENTS.md - Mnemonica Graphica

Guidance for AI agents working on the Mnemonica Graphica VS Code extension.

## Documentation style

AGENTS.md describes the present only: no dated history, no changelog
narrative, no dialogue transcripts. When behavior changes, rewrite the
section in place. Code comments follow the same rule — state what the
code does and its invariants, not when or why a change happened.

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
   - Registers a URI handler: `vscode://mythographica.mnemographica/trace?root=N`
     (exact dive root edge) or `?jaeger=<traceId>` (matches any ring edge's
     OTEL traceId — robust when the true root predates the push window).
     Jaeger's linkPatterns (tactica-nestjs/scripts/jaeger-ui.json) generate these
     links from span tags, closing the Jaeger → Live Trace → 3D loop.

2. **Registry** (`src/models/Registry.ts`) — the controller
   - The only model doing file I/O: `loadFromWorkspace()` reads `.tactica/*`
   - Types are loaded from `hierarchy.json` (structure, dot-joined fullPaths,
     1-based define()-site locations); property signatures are parsed from the
     generated `types.ts` bodies, the only place they exist
   - `instrumentation.json` (framework lifecycle crossroads) loads through the
     same stale guard as `eds.json` — a file older than `definitions.json`
     is skipped. The `Instrumentation` model holds a FLAT points list
     (`all()`), not a per-type Map. v2 payloads also carry `creationGraph`
     (static call chains from entry points down to every `new` site):
     stored as plain transfer data (`getCreationGraph()` /
     `hasCreationGraph()`), absent for v1 files, dropped by the model's
     `clear()` together with the points. When no graph is attached the
     model records WHY (`getCreationGraphAbsentReason()` → `missing` /
     `stale` / `v1`, set by the loader, cleared by `setCreationGraph` and
     `clear()`) so the Diamonds pane can give the right advice
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
     recent traces, merged by root name AND trace shape (a pure name merge
     collides DISTINCT traces sharing a root: a trace ending at one wrap
     site is not the trace ending at another): the shape signature is the
     sorted set of the trace's `kind:name` edge identities (the callsite
     rides the name for call/method edges), loop ×N multiplicity folded
     out — one `[2][×49] name` group row per name+shape, discriminated by
     the trace's endpoint (`→ UserResponse`, its chronologically last
     edge) when several shapes share a name, expanding to individual
     traces (`[2] #rootId` — exact-pick while they're in the ring, fan-out
     capped at 100 with a "more in Jaeger" overflow row), each expanding
     to per-edge code jumps; click isolates the trace in the 3D panel AND
     reveals its tab. Sort is tiered: UNKNOWN ERROR (errored trace with no
     create edge — nothing to pin the failure to) > ERROR > healthy,
     newest-first inside a tier. Single-trace names render directly, no
     nesting. Identical sibling edges merge into one `label ×N` row (a
     request loop chains the same callsite N times — N lines are noise).
     Errored traces and edges render red (`errorForeground`); edges whose
     `instanceSource` is `ambient` (dive's lastContext fallback) get a
     `question` icon and a tooltip warning — the instance may belong to a
     different flow. Row click isolates by rootId — name resolution can
     bind to a DIFFERENT trace ending on the same type name. A `source: …`
     header row tops the list whenever the ring is non-empty — the ring is
     single-source, so the one marker (`self:<pid>`, `app-channel:<pid>`,
     or untagged strategy) describes every row; it reads
     `MainOrchestrator.getTraceSession()`. Context menu: "Replay Trace"
     (human-speed re-walk of the lineage in 3D, ~650ms per edge, errored
     steps flash red) and "Open in Jaeger" (rows whose edges carry an OTEL
     `traceId` forwarded by strategy's push mapper; base URL overridable
     via MNEMOGRAPHICA_JAEGER_URL). Traces that aged out of the ring are
     Jaeger's job — the ring is "now".
   - `treeProvider.ts` — Definitions section (define() sites) and Types section
     (generated aliases in types.ts)
   - `usagesTreeProvider.ts` — usages per selected type
   - `flowTreeProvider.ts` — flow.json grouped kind → type → entry;
     entry rows carry the `file.ts:line` tail as description so
     identical labels (".value" × N under one type) stay
     distinguishable
   - `genTreeProvider.ts` — graph nodes grouped by depth; group rows
     explain the generation rule in their tooltip, node rows show the
     immediate parent as `← Parent` description (the dot-joined id IS
     the define() chain — the parent path is the prefix)
   - `diamondsTreeProvider.ts` — Diamonds: the instrumentation.json v2
     creationGraph as a type-path trie → the scopes holding each
     `new` site (click jumps to the site). An absent graph gets a
     REASON-SPECIFIC row instead of an empty pane:
     `stale` — the file was skipped by the guard, regenerate as one
     batch; `missing` — tactica never ran here; `v1` — the payload
     predates the creation graph
   - `bagelsTreeProvider.ts` — Bagels: eds.json wrap sites as a
     type-path trie keyed by the type the bagel belongs to
     (`wrapsTypePath`, else the EDS scope key when it names a known
     type, else a "(no type context)" bucket); rows carry the
     GraphBuilder via-generation as `gen N` description

4b. **3D graph panel** (`src/webview/panel.ts` + `media/webview.js`)
   - **Multi-panel, keyed by .tactica source**: `GraphPanel.panels`
     maps each project root carrying a `.tactica/` to its own tab,
     bound for life. `Ψ 3D` follows the Trie panel ALWAYS — the
     sidebar's loaded source opens/reveals directly, no matter how many
     panels are open. Only with NO trie loaded: no panel → the import
     advice — several `.tactica` around → "Import...", else
     "Browse...", both routed to `mnemographica.selectWorkspace`;
     panel(s) open → the `**/.tactica/hierarchy.json` discovery
     QuickPicks when several exist (the open-another-project flow).
     Re-invoking on an open source reveals its tab, never a duplicate.
     Each panel owns its data pipeline
     (`graphDataLoader.loadGraphDataFor(sourceRoot)` — a fresh Registry
     per source; the MainOrchestrator's primary Registry serves the
     sidebar only). There is no auto-refresh for panels — a tab re-reads
     its source only via its ⟳ Refresh button, or via the Layers &
     Distances `follow .tactica changes` checkbox, a connection-style
     opt-in creating a per-source watcher only while checked (host-side
     `followWatcher`, disposed on uncheck/close). Save writes per
     project: `<sourceRoot>/.mnemographica/layout.json`. Routing:
     sidebar-driven focus → the primary source's panel
     (`GraphPanel.primarySource`); trace isolate/replay/flashes and
     state/query 'view' → the most recently active panel
     (`lastActivePanel`).
   - The `mnemographica.showTypeGraph` command ("Ψ 3D") opens an interactive
     Three.js scene of the current GraphData — 3D-only (the 2D view is
     retired; the dormant 2D renderer remains in webview.js but is
     never entered). Loads d3/three from CDN, so it needs network access.
   - **Layer groups, one scene**: type spheres live in `typesGroup`;
     `instrumentationGroup` carries the creation layer, `diveGroup` the
     combined Dive layer (wrappers and the internals backplane under one
     `dive ◯` toggle). The creation layer's panel row reads
     `invocations ◆`; the code ids keep `instrumentation`.
     The creation layer (instrumentation.json v2): the main.ts starter as
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
     +X anchor, co-holders Fibonacci-spread over the whole shell), EVERY
     held type — the primary included — gets a DASHED edge with an
     arrowhead at the sphere tip (LineDashedMaterial;
     `computeLineDistances` on every dynamic rewrite), so a dragged
     diamond never loses what it creates; the connector tip is the
     surface point FACING the diamond on the live center line
     (`sphereTipToward`); call edges carry arrowhead
     cones as well (caller → callee). Holders wired into the call graph
     glow cyan (0x26c6da), isolated ones (their own entry points) keep
     orchid (0xda70d6). Mid-chain scopes interpolate between their
     chain's starter and holder by relative hop distance. That
     interpolation is NOT injective — DI-symmetric chains land on
     IDENTICAL coordinates, and `placeOnSphere`'s index 0 is the north
     pole for ANY ring total so same-ring starter/fallback groups stack
     there — so the dynamics writer ends with a second-pass de-collision
     (`decollideCreationLayer`): pass 1 fans exact piles onto mini
     Fibonacci shells around their centroid, pass 2 relaxes near-misses
     out to one nodeRadius (grid-stencil neighbor search, Gauss-Seidel
     in fixed build order — deterministic, so live re-seats reproduce
     the same spread). FIXED obstacles: the creation center, holder
     diamonds, the maroon marker, and every pinned mesh — a dragged
     node is pinned, so the crowd yields to the cursor, never the
     drag. Holder/chain/edge
     geometry recomputes on every
     `updateLinkPositions()` call (a user-dragged holder pins RELATIVE
     to its primary sphere — `pinAnchor` + `pinOffset` in userData, so
     dragging the sphere afterwards carries the diamond along as if
     never detached — and connectors follow from wherever
     it lands; a user-dragged CHAIN scope keeps its drop spot — the
     starter→holder interpolation skips pinned meshes), so
     shells follow dragged type spheres
     and `adjustGenRadius` (which re-runs `renderGraph`) re-lays the whole
     layer out. The holder-shell stretch lives on the diamond orient's
     wheel.
     The "Layers & Distances" panel gives each layer a header row built
     around a visibility CHECKBOX reading the LIVE `group.visible` (a
     rebuild never lies; the flags SURVIVE the
     rebuild — renderGraph snapshots them before clear() disposes the
     groups and re-applies them to the fresh ones — and the checkbox
     blurs itself after every click: a focused checkbox re-toggles on
     Space). The panel itself COLLAPSES on a
     header click and DRAGS by its header — the legend idiom: < 4px is
     a click (▸/▾ toggle), a real drag repositions, the first move
     switches the CSS right-anchor to explicit left/top, pointer
     capture keeps the gesture off the scene canvas (its handlers bail
     on genControlsDragState alongside legendDragState), expanding a
     dragged panel clamps back into the viewport. CSS hides
     `#layer-controls-list` when collapsed. The checkbox labels are
     inline-flex with a 4px column-gap (a leading space in the label's
     text node collapses at the start of its anonymous flex item, so
     the gap renders instead). The panel layout: the follow-.tactica
     setting sits at the panel top; each
     layer row CARRIES its own ⌖ orient control on the same line
     (Diamonds ⌖ on invocations ◆, Bagels ⌖ on dive ◯, the captions
     ⌖ with no second label), the layer order is invocations →
     dive → captions → types, the types row doubles as the expander
     for the generation distance rows (the
     `expandedLayerControls` Set key keeps the 'distance-orient'
     name, starts expanded), the gen rows nest indented under it, and
     Sinks keeps its own row inside the expanded group (no layer to
     ride; the Jaeger cone follows its orient). The merged orient-name
     spans wear `.layer-orient-name` — NEVER `.gen-control-value`:
     refreshGenReadouts maps that class to generation depths by
     index. Both that span and `.gen-control-value` carry
     `margin-right: 6px`. Each generation
     row (Roots/Gen N, nested under the types row) carries its own
     visibility CHECKBOX — hiding a generation hides its spheres,
     their edges, holding diamonds and wraps. The mechanism is COMPUTED
     visibility: `defineComputedVisible(obj, fn)` installs a
     getter-only `.visible` (the module-level
     `sessionGenVisibility` map feeds `genDepthVisible(depth)`) and
     every governed object ANSWERS on its own — THREE's render
     traversal, the firstVisibleIntersect parent-walk and the
     dynamics writers just read it. Primitive rules: type spheres →
     their generation; creation scopes → hidden when ALL creates
     anchors' generations are hidden (`scopeHiddenByGen`; starters
     and chain scopes carry no creates and always show); grafts,
     inheritance links and path-hit edges → endpoint generations.
     Everything else COMPOSES by reading a mesh's `.visible`: a
     bagel shows exactly when its anchor shows (scope diamond first,
     else type sphere — ambient bagels anchor to nothing and stay);
     captions (addLabel's sprite + leader) read
     `this.captionsVisible && mesh.visible`, so setCaptionsVisible
     is flag-only — a getter-backed `.visible` has NO setter,
     an assignment would throw in strict class methods (the audit
     rule: `.visible =` may target only layer groups, the center
     marker, and writer-owned per-edge lines/arrowheads). Batched
     LineSegments (creation call edges, the four wrapper pair
     kinds) carry no per-edge object: their position writers emit
     DEGENERATE vertices (zero-length rasterizes nothing) for a
     pair whose endpoints read hidden, and the writer-owned
     arrowheads (holder connectors, call arrows, fiber arrows) fold
     the same `pair.from.visible && pair.to.visible` read into
     their length test — visibility decided in the regular update
     pass, never by a flip-time walk. The checkbox handler is
     `sessionGenVisibility.set` + ONE `updateLinkPositions()` +
     `needsRender`: the panel does not rebuild, the layout does not
     move, hidden generations leave their shell slots empty — the
     same semantics as the layer checkboxes. Fresh meshes install
     the getters at birth, so renderer rebuilds keep honoring the
     map. The types row's expanded group holds the ⌖ rows for the
     generation shell radii (wheel-driven 'gen' modes,
     cascading outward so shells never cross) plus the one orphan
     vector kind: Sinks — captions, diamonds and bagels ride their
     own layer rows; the Jaeger cone rides the sinks orient (same
     zone direction, reach stretched by the defaults' ratio
     jaegerOffset/sinkOffset; pinned cones take the sinks delta
     on their absolute positions) — the sphere control owns distance
     AND orientation for those elements; their constants stay on
     `renderer.layerDistances` as the defaults the orients start from.
     Gen-radius wheel emits cascade instantly through
     `cascadeShellRadii` and that is ALL it does —
     `reseatTypeSpheresLive` scales every sphere radially by its
     shell's ratio (pinned seats ride their already-scaled x3d),
     node.x/y/z follow for the edge writers, updateLinkPositions
     re-seats the whole dynamics chain from the live seats (the
     gen0-keyed writers read depthRadii directly, so the Roots Ø
     reaches sinks/ambient shells too), labels re-anchor, and only
     the px readouts refresh in place. The angular arrangement is
     preserved — re-relaxing angles stays the full rebuild's job
     (Refresh).
     Relayouts preserve CURRENT positions: a dragged
     sphere writes `node.x3d/y3d/z3d` — `calculatePosition` honors it and
     `relaxTypeShells` skips user-placed spheres (they repel neighbours
     but never move) — and non-sphere pins are snapshotted before
     `clear()` and restored after the builders (relative pins re-resolve
     their anchor mesh and keep the offset, absolute pins land on their
     stored spot). Only UNtouched elements follow the new distances —
     with one exception: an adjust SCALES/ROTATES the pinned elements
     it governs (generation radii × the dragged sphere's stored
     x3d/y3d/z3d — radial scaling keeps each sphere's direction;
     the vector-sphere orients
     carry the rest — pinned diamonds' pinOffsets and sinks'
     cone-relative pinOffsets rotate/stretch by the DELTA between the
     old and new orient, pinned Jaeger cones' absolute positions
     likewise) so pins don't make the control look dead; the
     arrangement keeps its shape, rotated/stretched.
     Checkbox flips stay purely local, nothing posted to the host.
     Creation meshes stay out of `nodeMeshes`,
     but ride the interactive list (drag pins, click shows the scope
     tooltip, double-click jumps to the scope's location); THREE's
     Raycaster does not skip invisible objects, so all four raycast
     sites go through `firstVisibleIntersect()`. Every label carries
     a thin grey LEADER LINE down to its mesh.
   - **Invocation path filter**: a `.*` button in the top `#controls`
     bar (there are no +/− zoom buttons — the wheel IS the zoom; the
     renderer's `zoomIn`/`zoomOut` methods stay as automation API)
     toggles a small non-draggable window docked left of the Layers &
     Distances panel (`.invocation-filter`, right:240; the input spans
     460px), pre-filled with `\.spec\.ts|\.test\.ts|/tests?/|__tests__`.
     The input is a JS RegExp tested against each creation scope's
     `filePath`; applied on open, on Enter and live (200ms debounce);
     empty text means OFF; an invalid expression keeps the last good
     one and marks the input `.invalid`. The mechanism is the gen
     checkboxes' computed visibility: `invocationPathFiltered` composes
     with `scopeHiddenByGen` in the one `defineComputedVisible` call
     per scope mesh, the compiled expression rides the module
     `sessionInvocationFilter` (session-only — Save persists
     arrangement, not view filters), and the apply reaches the LIVE
     renderer through module `renderer3D` (the window DOM hangs off
     document.body, surviving panel rebuilds), flipping with one
     updateLinkPositions + needsRender — batched call edges fold to
     degenerate vertices, captions and hosted bagels follow by reading
     their anchor mesh's .visible. Dive/wrappers are NOT filtered —
     creation scopes only.
   - **Dive layer, wrappers half** (`diveGroup`):
     eds.json wrap entries render as amber TORUS rings — the dive "wrap"
     made visible. A bagel ENCIRCLES the element it wraps, drawn
     VERTICAL (the EDS ring at the origin stays the horizontal-tilted
     one), SNUG — just bigger than the wrapped element's diameter:
     centered on the hosting scope's DIAMOND (the common case —
     wrap(fn, instance) wraps the callback fn; the instance is only
     the context carried along), or on the type SPHERE only when no
     scope hosts the wrap (the genuine constructor wrap at define
     time), or on an outer
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
     reappears when the bagel is dragged out — attribution survives.
     Terminal fibers (nothing wraps them later) carry an
     "ambient / terminal fiber" note in their tooltip instead of an
     outgoing arrow. All edge kinds are
     batched LineSegments (one entry in `wrapperLines` per kind) whose
     endpoints rewrite from live positions in `updateLinkPositions()`,
     AFTER creationDynamics — encircling rings re-center on their live
     target meshes, so dragging either side keeps the bagel around its
     target (a dragged bagel pins RELATIVE to its anchor — the scope
     diamond or type sphere — and follows it on later anchor drags;
     only anchor-less ambient bagels pin absolutely). Rings are unit
     tori scaled per-mesh, sharing one geometry and one material
     (disposed once in `clear()`); labels are per-mesh and join the
     layer group, each with a leader line; co-centered onion labels
     de-stack one text line per level (`labelOffsetY = ringR + 6 +
     k×14`). Wrapper meshes stay
     out of `nodeMeshes` but ride the interactive list: drag pins,
     click shows the wrap tooltip (including WHAT it wraps), double-click
     jumps to the wrap site.
   - **Layout relaxation**: two deterministic steps. (1) Initial shell
     radii widen with node counts (circumference ≥ count × 10
     nodeRadii; shells kept strictly ordered) — computed at init, where
     a saved/session seed overlays them (see the Save bullet); the
     layer distances own the values afterwards. (2) `relaxTypeShells()`
     runs at the end of `renderGraph`: type spheres repel SLIDING ON
     THEIR OWN SHELL (radial distance is invariant — generation geometry
     never collapses, only the angular position moves), with effective
     radii ×2.2 uncrowned and ×(3.3 + min(crown,8)×0.15) crowned so
     crowns stop colliding; fixed iteration order and cap (80
     iterations, damping 0.4, ε 0.05) — same graph, same layout, every
     render. Labels then alternate above/below their sphere (leader
     lines keep attribution), and the whole dynamics chain (diamond
     shells, bagels, edges) follows through `updateLinkPositions()`.
   - **Over-pole camera**: rotation drags no longer clamp
     latitude at ±90° — the camera tumbles over the poles, full
     north-to-south. `camera.up` flips sign past each pole in
     `updateCameraPosition()` (must precede `lookAt`, which reads it),
     so the roll stays continuous instead of a 180° snap at the pole;
     the angle wraps into [−π, π] to keep the numbers small.
     Programmatic focus (`focusNode`) still clamps its targets into the
     upright band — a focus always lands right-side up.
     The focus approach is the center→item
     ray from OUTSIDE — the camera ends beyond the
     sphere looking inward, so the item is the foreground and the
     graph center reads behind it.
     **Fit-to-view on first render**: `fitCameraToView()` runs in
     `render3DGraph` right after `renderGraph`, ONLY when no saved or
     live camera exists (saved layout / mode-switch camera ALWAYS
     wins; knob rebuilds share the renderer and never refit) — it
     scans every mesh layer for the outermost |position|, derives the
     distance from the fov/aspect with a 1.08 margin, and stretches
     `maxZoomOut` (max(2500, fit×2)), the fog band and `camera.far`
     to match, so zoom-out reaches the whole graph. `reset()`
     homes to the fitted zoom. Deliberately NOT a gen-distance
     recalculation — shrinking shells would fight the deliberate
     circumference ≥ count × 10 nodeRadii widening (a readability
     rule).
   - **Grab-the-world pan**:
     Ctrl+drag translates the orbit center along the camera's OWN
     right/up axes by cursor-delta × world-units-per-pixel at the target
     distance (`2·zoom·tan(fov/2) / canvasHeight`), so content follows
     the cursor 1:1 — including under rotation. Plain drag rotates (the
     over-pole tumble above); Shift+drag ROLLS the view about its own
     axis — or grabs a caption when one is under the cursor (the
     texel-exact pick below runs first).
   - **Save button**: the `#controls` Save
     button persists the current arrangement to
     `<sourceRoot>/.mnemographica/layout.json` — user-placed sphere
     positions (nodes with x3d set), pinned non-spheres (the same snap
     shape renderGraph's pinnedSnapshot uses, keyed by node id), the
     generation shell radii (`genRadii`, `[[depth, radius], …]` —
     distances are arrangement too), and
     the camera (the constructor's initialCameraState shape). The
     webview cannot write files: it posts `saveLayout` and panel.ts
     persists it (reply `layoutSaved` → status line). panel.ts reads
     the file on EVERY updateGraph and rides it along, with a STALE
     GUARD (the Registry's instrumentation.json idiom): a layout whose
     `savedAt` (file mtime as fallback) predates its source's
     `.tactica/hierarchy.json` mtime arranges a graph that no longer
     exists and is skipped entirely — a tactica regeneration, even a
     content-identical one, invalidates the save. render3DGraph
     applies it around renderGraph — positions before (calculatePosition
     honors x3d, relaxTypeShells skips), pins after (`applySavedPins`,
     relative pins re-resolve through resolvePinAnchor), camera via the
     constructor (a live mode-switch camera still wins), and the radii
     via `renderer.seededGenRadii` set before renderGraph: the
     depthRadii init overlays them on the formula defaults (depths the
     seed never knew — a deeper graph since — keep the formula value;
     the strict-ordering pass repairs any crossing the seed
     introduces). A full renderer
     rebuild (every updateGraph) discards the old renderer's meshes —
     UNSAVED pins hand across through a module-level `sessionPins` map
     (`snapshotPins()` off the outgoing renderer before the wipe,
     re-applied over the file pins after the builders), and the wheel's
     radii snapshot into `sessionGenRadii` the same way (a Refresh
     keeps them; session values are newer than the file, same rule as
     pins and orients).
     Untouched
     nodes are NOT saved — the deterministic layout reproduces them.
   - **Captions toggle**: a knob-less `captions` row in the
     Layers & Distances panel flips `renderer.captionsVisible` via
     `setCaptionsVisible()` — every sign sprite and leader line
     hides, the shapes stay. `addLabel` applies the flag at birth,
     so rebuilds never re-show hidden captions; across
     full renderer rebuilds the choice rides the module-level
     `sessionCaptionsVisible` (the panel rebuilds too, so the DOM
     cannot hold it), applied before `createLayerControls` runs.
     The center marker's caption ANDs the flag with the types-layer
     visibility (`updateCenterMarkerVisibility`).
   - **Vector-sphere control**: the `⌖` buttons of the Layers &
     Distances panel — on the layer rows (captions/diamonds/bagels)
     and in the types row's expanded
     generation group (gen radii, sinks) — open the `VectorSphereControl`
     overlay (media/webview.js, canvas sized to max(200, ¼ of the
     smaller viewport side); `sizeCanvas()` recomputes it at build AND
     on every `open()`) — fixed CENTRAL dot (the bound element's
     center, never moves), SURFACE dot (drag ARCBALL-rotates the
     assembly — plain drag; the window has no pan of its own for
     plain drag to collide with — Shoemake trackball,
     cursor→virtual-sphere vectors, quaternion premultiply; the dot
     rides the rotation — that IS the orientation; SHIFT+drag ROLLS
     the assembly about the view axis instead — the sweep angle around
     the canvas center premultiplies the quaternion about (0,0,1)),
     transparent SPHERE (scroll wheel zooms its
     radius — the 3D view's zoom idiom — that IS the distance, live
     in EVERY mode). The wheel is an ODOMETER: `wheelAcc` accumulates
     pixels, the VISUAL radius sweeps a decade per VISUAL cycle —
     MAX_SCALE × 10^(phase−½) ∈ [0.115, 1.15] of the window fit
     (min is 1/10 of max), with a phase
     OFFSET (`visOffset`) parking the open point at scale 1.0 — the
     sphere nearly fills the pane at open,
     independent of the textbox value because open() zeroes the
     odometer; wheel-up grows the last ⅓-notch to the full-bleed
     rollover, wheel-down walks the whole decade first — while the
     VALUE keeps accumulating smoothly (base × K^(acc/100), K = 1.007,
     one notch ≈ 100px; coarse moves ride the slider/textfield). The
     visual phase runs on VIS_CYCLE = 500px,
     DE-ALIASED from the value's 100px: a 100px period is the standard
     mouse notch, so one notch = exactly one wrap and the sphere
     phase-locks frozen while the value flies; 500px gives five
     visible steps per decade. `setDistance` paints too — slider
     and textfield commits animate the sphere, not just the wheel. The
     phase is CENTERED (−½…+½) — the sphere passes through normal at
     the open point in BOTH wheel directions, the wrap snap sitting
     half a cycle away. The window always opens at normal visual size
     carrying the current value as the base. The window drag clamps
     to the viewport (48px grip — an off-screen window is a lost
     window). The × (20px glyph with padding) closes
     the window and re-clicking the same row's ⌖ toggles it shut
     (pointer-capture note: the header drag must not capture presses
     landing on ×, or its click never fires). The footer is a
     distance SLIDER + numeric TEXTFIELD: both land in
     `setDistance`, which backs `wheelAcc` out of the target so the
     odometer continues from the set value; the slider spans
     floor…4× the open value (a typed number past its end stretches
     it), the textfield IS the readout (never clobbered while
     focused; invalid input restores the last emitted value), and
     the unit-formatted string (`168px`, `×1.20 gen0`) rides the
     textfield's hover tooltip. Consumers: Captions →
     the caption vector (VIEW-space direction + the wheel's distance
     multiplier; signs sit at camera × vector × signed distance ×
     multiplier, so captions hold their screen spot on rotation;
     `labelOffsetY` reads as a signed distance along the vector).
     Diamonds → WORLD-space rigid
     rotation of the co-holder Fibonacci spread around each bound
     sphere, the wheel stretches `holderShell` (pinned offsets
     rotate/stretch by the DELTA). Bagels → WORLD-space: the wheel
     pushes bagels off their anchor along the direction at an
     anchor-radii distance FLOORED at the encircling 0 (the antipode
     is the rotation's job, not the wheel's; the odometer's
     multiplicative quantity is 1 + d/3 with floorLinear 1, stale
     saved negatives self-heal to 0 on the first emit); the ring
     faces its anchor once
     pushed out; ambient bagels anchor to nothing, the orient does
     not reach them. Sinks → WORLD-space zone direction + reach in
     gen-0 radii (default `layerDistances.dive.sinkOffset`); JAEGER
     HAS NO ROW OF ITS OWN — it rides the sinks orient at the
     `jaegerOffset`/`sinkOffset` reach ratio; the sink stack
     spreads along the world-up component perpendicular to the zone
     direction; unpinned knots re-seat through a dedicated
     internalsDynamics writer (ordered before the pinned-follow writer
     and writeSinks), pinned ones delta-transform (sinks'
     cone-relative pinOffsets, cones' absolute positions). Gen rows
     (Roots/Gen N) open a wheel-only 'gen' mode (floorLinear 10,
     readout in px) — the wheel rescales the
     clicked generation's shell AND cascades the deeper shells
     instantly through the shared `cascadeShellRadii` (the x3d
     user-sphere scaling lives there too), reseated LIVE (see the
     Layers bullet). World consumers capture the main
     camera AT OPEN — the main scene is not rotated while the
     tool window is up. Per-caption Shift+drag stores a view-relative
     override in `userData.captionViewOffset`; the grab is TEXEL-EXACT:
     the sprite raycast tests whole quads, transparent margins
     included, so the nearest quad hit is often a neighbour's
     invisible edge — the mousedown pick samples the label canvas's
     alpha at the hit UV (the canvas lives on the texture, CPU-backed
     via `willReadFrequently`) and grabs the first hit whose painted
     texel is really there (alpha > 127, the material's alphaTest
     0.5), i.e. the caption actually under the cursor — and when NO
     hit has a painted texel there, the pick falls back to the nearest
     quad (the press aims at the caption BOX, but the glyph band
     fills only a strip of the quad); overlaps still resolve
     texel-exact. Shift+drag that grabs NO caption ROLLS the whole
     view instead: the caption pick runs first, and only when no
     caption was grabbed does the drag sweep the angle around the
     VIEWPORT center — `cameraRoll` follows the sweep (screen atan2
     is y-down, so the sign flips) and `updateCameraPosition` rotates
     `camera.up` about the view axis, leaving rotation/pan deltas
     exactly 0. All four orient states ride
     session vars across rebuilds and `layout.json`'s `orient` key
     on Save. Application is LIVE: captions re-anchor per emit,
     diamonds/bagels/knots re-seat through their dynamics writers —
     no rebuild.
   - **Render-on-demand**: `animate()` keeps its rAF loop
     but calls `renderer.render` only when `needsRender` is set (every
     mutation site flags it — `updateCameraPosition`,
     `updateLinkPositions`, `updateHover`, `setFocusedMesh`, trace-mode
     enter/extend/exit, `resize`, the Layers checkboxes), while a
     continuous animation is live (focus anim/pulse, trace/replay
     flashes; the pre-updater `wasAnimating` snapshot in `animate()`
     guarantees the settle frame still paints), or a ~1Hz heartbeat
     fires as self-heal for a missed flag. Idle panel: ~1 frame/sec
     instead of 60.
   - **Progressive build**: `renderGraph(data, onDone)` runs its
     prelude synchronously (pins snapshot, clear, groups, nodeMap,
     depthRadii, the center marker — visible IMMEDIATELY) and
     constructs the scene from a rAF queue of `{ step, done }` units,
     each tick spending a ~12ms frame budget before yielding: unit 1
     type spheres + labels CENTER-OUT (explicitly depth-ordered —
     parents build before children since placeInCone reads the
     parent's live seat; positions compute AT BUILD TIME so a
     mid-build radius change still seats unbuilt shells), unit 2
     inheritance edges, unit 3 path-hits, units 4-6 the
     creation/wrappers/internals layers one each (their internal
     loops stay monolithic), the final unit pins restore +
     relaxTypeShells + the interactive set + the first
     updateLinkPositions, then the caller's `onDone`. A `buildToken`
     kills a stale queue when renderGraph re-runs; `dispose()`
     cancels the pending tick. Everything mesh-dependent in
     render3DGraph (saved/session pins, caption overrides, the
     fresh-camera `fitCameraToView`, the pendingFocus flush) rides
     the `onDone` continuation against a captured `builtRenderer` —
     a second render3DGraph mid-build replaces the outer variable,
     and a continuation must never land on the wrong renderer.
   - **Internals backplane**: the DECLARED knots
     the fibers plug into at runtime, living in the same `diveGroup`.
     Declared, not discovered: the calls completing the fiber chain live
     inside the dive/adapter packages — `src/graph/internals-manifest.ts`
     mirrors them with a source citation per knot. Six knots by role:
     the **EDS ring** (dive's runtime storage — every fiber lands
     there) as a thin steel-blue (0x7aa2f7) torus ENCIRCLING the maroon
     collection marker at the origin, Saturn-tilted, label below — the
     third convergence point alongside the collection marker
     (instances) and the main.ts diamond (invocations), all keyed by
     paths; the **attachHooks hub** as a steel-blue octahedron at the
     ring's right side (+X, the same side convention as the creation
     center diamond); three **adapter sinks** (AsyncFlowProvider,
     DiveOtelProvider, TraceExceptionFilter) as violet (0xb48ead) boxes
     in a DETERMINISTIC compact vertical stack just outside the gen-0
     shell on the LEFT (−X, gen0 × 1.3, half-shell vertical step); and
     **Jaeger** — the only terminal outside the system — as a gold
     (0xf0c674) cone leftmost of all (gen0 × 1.65). The sink zone
     never moves between renders, so the eye learns where every fiber
     ends. Sink edges are solid slate with arrowheads, directed as
     DATA flows: ring → providers/filter (the filter's edge is labeled
     `getFlow / getErrorInstance`) → Jaeger — and they ride
     internalsDynamics, so dragged sinks keep their edges (sticky). The
     collection → hub hookup is dashed slate. The **attachHooks
     grafts** are the hub firing: whisper-thin (opacity 0.22) blue
     QuadraticBezier curves bowed outward, one per REALLY constructed
     type, landing just past the type's sphere — never-created types
     get none (hooks never fire for them). The **usages census**
     (usages.json `instantiation` entries) also dims never-created
     spheres (opacity 0.35) and flags their path-hit edges
     `neverTaken` (rendered at 0.12 instead of 0.5). dive's internal
     functions (recordCreation/enterContext/…) are NOT knots — they
     are event chunks of the hub firing, folded into the grafts.
     Hookup endpoints and grafts rewrite in `updateLinkPositions()`
     after wrapperDynamics. Internal meshes stay out of `nodeMeshes`
     but ride the interactive list like wrappers (drag pins ABSOLUTELY
     for the ring/hub/cone — those knots have no anchor to follow;
     adapter SINKS pin RELATIVE to the Jaeger cone, so dragging the
     cone carries the connected adapter stack as if never detached;
     click shows the knot tooltip with its source citation — no jump,
     the citation points into a sibling repo). A **legend**
     (`#dive-legend`, bottom-left) names every shape/color/edge kind —
     16 rows. The legend header is both the collapse toggle and the
     drag handle: a press moving < 4px counts as a click and toggles
     the rows, a real drag repositions the panel (clamped to the
     viewport). The CSS bottom-anchor switches to explicit left/top
     only on the FIRST REAL MOVE, not on press — a plain collapse
     click keeps the bottom anchor, so collapsing at the initial spot
     docks the panel to the viewport bottom instead of lifting the
     bottom edge up. The drag rides pointer events with pointer
     capture on the header: the cursor leaving the legend (or the
     window) keeps the drag, and the scene canvas never starts a
     grab-the-world pan/rotate mid-drag — its mouse handlers bail on
     `legendDragState` before `stopPropagation` (a release over the
     canvas otherwise leaves the drag stuck). Collapse shrink-wraps
     the panel to the header (the smaller width is intentionally
     correct) with `column-gap: 10px` on the header — the Legend→arrow
     gap equals the arrow→border padding. EXPANDING a dragged legend
     clamps the box back into the viewport.
   - **Show on Graph** (Types trie context menu): opens
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
     methods: `trace/ingest` and `state/query`. `trace/ingest`
     (`{ edges, source? }` — dive-trace deltas land on the `Main`
     instance via the orchestrator, ring-bounded at 5000): dedup is
     monotonic per source process EXCEPT lifecycle completions —
     `leave`/`settle` re-publish an edge id already ingested via
     `enter`, and those are upserted in place (status/duration/ts
     merge, counted as `updated`, still forwarded to the panel and the
     Live Trace tree); without the upsert every call edge would stay
     `running` forever. Trace mode resolution is by rootId
     (`getTraceLineageByRoot`); the older name resolver remains for the
     webview's own pick flow. In 3D trace mode, edges whose status is
     `error` paint their sphere red (0xff2020) instead of green. The
     live flash (lineage-wide): the webview keeps a ring-bounded edge
     index and each incoming edge walks its parentId chain, lighting
     the WHOLE lineage in the trace-mode acid-green (0x40ff80) —
     errored members flash red (0xff2020) and are never downgraded —
     with a 5s decay. Live-flash distrust: edges whose
     `instanceSource` is `ambient` still feed the chain walk and the
     click-to-pick set but never flash a bulb themselves — attribution
     must be true or absent, never guessed. `state/query`
     (`{ subject, sample? }` — subjects `server`, `graph`, `trace`,
     `view`; `view` roundtrips into the 3D webview for the live camera
     + focused node — with several panels open the most recently active
     one answers, and the facts carry its source root as `source`)
   - **Bound to 127.0.0.1** — there is no auth,
     so it must never listen on a LAN interface
   - **Self-trace** (`src/strategy/selfTrace.ts`): dive runs IN the
     extension host — `startSelfTrace` attaches dive's edge hooks
     (enter/create/leave/settle, 250ms buffered flush) and lands the
     mapped edges on the SAME `ingestTrace` + downstream
     (`pushTraceEdges`, `noteIngest`) as the WS trace/ingest, tagged
     session `self:<pid>`; `stopSelfTrace` runs from deactivate.
     `refreshTypeGraph` is wrapped (the Registry mnemonica instance as
     context — its TypeName resolves via getProps at runtime), so every
     refresh flows as a `call` edge. dive loads via guarded dynamic
     import — a load failure disables self-tracing, never activation —
     which is also why the static wrap site lands in eds.json's
     `unknown` bucket (no static import for tactica to bind). The ring
     stays single-source: an app-channel session alternating with
     `self:<pid>` VACUUMs per the existing rule.

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
     MCP SDK into the extension host.

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
pre-decrement** a line before calling it.

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
  `clear()`/reload regression (getter-only properties break refresh),
  the instrumentation.json load/clear pins, and the v2
  creationGraph load / v1 absence / stale-guard / model-clear pins
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

Notes:
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
  CPU.
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
│                         # (direct WS to an app's embedded strategy channel),
│                         # selfTrace (in-host dive → ingestTrace bridge)
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
- **@mnemonica/strategy**: provides `WSSession`
  for the App Channel tab and the server binary spawned by the Strategy
  tab. The dep must come from the registry, not a `file:` link —
  `vsce package` does not follow `file:` symlinks, so a `.vsix` needs
  the registry dep.
- **@mnemonica/dive**: the self-trace runtime
  (loaded via guarded dynamic import in `selfTrace.ts`); its presence in
  `dependencies` also auto-enables tactica's EDS pass, so mnemographica's
  own `.tactica/` gains `eds.json`

## VS Code API Usage

- `vscode.window.createTreeView`: The exploration views
- `vscode.WebviewView`: Welcome view (inline HTML only, no remote scripts)
- `vscode.commands`: Command palette integration
- `vscode.workspace.createFileSystemWatcher`: Auto-refresh on file changes
- `vscode.window.showTextDocument`: Go-to-definition functionality (only via NavigationAdapter)

## Coding Conventions

1. **Models are pure data containers; actions live in controllers.**
   No file I/O inside model classes — the `Registry` controller reads
   files and populates models:

```typescript
// Definitions.ts - pure data
class Definitions {
    get(name: string) { return this.map.get(name); }
    set(name: string, entry: DefinitionEntry) { this.map.set(name, entry); }
}

// Registry.ts - controller with actions
class Registry {
    private async loadDefinitions(tacticaPath: string) {
        const content = fs.readFileSync(definitionsPath, 'utf-8');
        // ... parse and populate Definitions instance
    }
}
```

2. **Store data at load time; never re-read files in getters.**

```typescript
// ❌ Re-reads the ENTIRE file just to find a line number
getLineForType(typeName: string): number | undefined {
    const entry = this.map.get(typeName);
    if (!entry) return undefined;
    const content = fs.readFileSync(entry.fullPath, 'utf-8');
    // ...
}

// ✅ Store it while visiting hierarchy.json nodes — O(1) afterwards
const entry = new typesInstance.TypeEntry({
    name: node.name,
    fullPath: node.fullPath,
    parent,
    properties: propertiesByType.get(node.fullPath) || new Map(),
    lineNumber: parsed ? parsed.line : 0,  // 1-based define() site line
    location: node.location
} as rawTypeEntry);
```

3. **Naming: `raw*` types for data transfer.** One clear type name per
   external shape:

```typescript
export type rawTypeEntry = {
    name: string;
    fullPath: string;  // dot-joined, the cross-file join key
    parent?: string;
    properties: Map<string, { name: string; type: string; optional: boolean }>;
    lineNumber: number;  // 1-based, define() site
    location?: string;   // "file:line:column", from hierarchy.json
};
```

4. **No getter-only `Object.defineProperty` on mutable class state** —
   later assignment throws in strict mode. Keep mutable model references
   as plain private fields.

**Key Principle:** Models define `raw*` types for data transfer. Controllers use these types when populating models.

## Pattern Summary

| Layer | Responsibility | Example |
|-------|---------------|---------|
| Model (Definitions, Types, Usages, EDS, Flow, Trie) | Pure data storage, Map operations | `get()`, `set()`, `has()` |
| Controller (Registry) | File I/O, parsing, orchestration | `loadDefinitions()`, `loadTypes()` |
| Data Transfer | `raw*` types for external data | `rawTypeEntry`, `rawDefinitionEntry` |
