/* MnemoGraphica — graph data.
 * The tool draws ITSELF: every node here is a real model from
 * mythographica/mnemographica  src/models/ + src/core/ + src/graph/.
 * - dataflow links  = the mnemonica inheritance trie (parent -> child / SubType)
 * - execflow links  = runtime invocations (instantiation / propertyRead / methodCall)
 *                     captured by tactica into flow.json — the layer the current
 *                     PoC computes but never draws.
 * - eds             = how a type is decorated (EDS kind from eds.json)
 */
(function (root) {
  'use strict';

  // gen = depth in the inheritance trie (0 = root). Drives BOTH color and 3D depth-plane.
  // eds = EDS decoration kind, or null.
  const N = (id, gen, eds, blurb) => ({ id, gen, eds: eds || null, blurb });

  const nodes = [
    // ---- gen 0 : the root the whole registry hangs from ----
    N('Main', 0, null, 'Root model. Everything the extension is, descends from here.'),

    // ---- gen 1 : the registry's first-class models (src/models, src/core) ----
    N('Registry', 1, 'link', 'Controller. Loads .tactica/ and populates every model.'),
    N('Definitions', 1, null, 'Pure store of define() sites.'),
    N('Types', 1, null, 'Pure store of generated type entries.'),
    N('Usages', 1, null, 'Pure store of lookup() usages.'),
    N('Flow', 1, 'contextConsume', 'Execution-flow store: instantiation / read / call.'),
    N('EDS', 1, 'errorEnrich', 'Decoration store: wrap / link / hook / adapter…'),
    N('Trie', 1, null, 'The inheritance trie itself — structure as data.'),
    N('Scene2D', 1, null, 'Flat radial projection of the trie.'),
    N('Scene3D', 1, 'adapterUse', 'Depth-plane projection of the trie.'),
    N('LoggerTab', 1, 'hookAttach', 'Diagnostics surface.'),
    N('Adapter', 1, 'adapterUse', 'NavigationAdapter — go-to-definition bridge.'),
    N('ContextMenu', 1, 'wrap', 'Right-click actions on a node.'),

    // ---- gen 2 : the SubTypes each model define()s on itself ----
    N('RegistryEntry', 2, 'link', 'Registry.define(\'RegistryEntry\').'),
    N('DefinitionEntry', 2, null, 'Definitions.define(\'DefinitionEntry\').'),
    N('TypeEntry', 2, null, 'Types.define(\'TypeEntry\').'),
    N('UsageEntry', 2, 'contextConsume', 'Usages.define(\'UsageEntry\').'),
    N('FlowEntry', 2, 'contextConsume', 'Flow.define(\'FlowEntry\') — one invocation.'),
    N('EDSEntry', 2, 'errorEnrich', 'EDS.define(\'EDSEntry\') — one decoration.'),
    N('GraphNodeTrie', 2, null, 'Trie.define(\'GraphNodeTrie\').'),
    N('LinkTrie', 2, 'link', 'Trie.define(\'LinkTrie\').'),
    N('GraphNode2D', 2, null, 'Scene2D node.'),
    N('Link2D', 2, 'link', 'Scene2D link.'),
    N('Tooltip2D', 2, 'wrap', 'Scene2D tooltip.'),
    N('GraphNode3D', 2, null, 'Scene3D node.'),
    N('Link3D', 2, 'link', 'Scene3D link.'),
    N('Camera3D', 2, 'hookAttach', 'Scene3D camera rig.'),
    N('LogEntry', 2, 'hookAttach', 'LoggerTab.define(\'LogEntry\').'),
  ];

  // ---- DATA FLOW : the inheritance trie (parent -> child). The skeleton. ----
  const dataflow = [
    ['Main', 'Registry'], ['Main', 'Definitions'], ['Main', 'Types'], ['Main', 'Usages'],
    ['Main', 'Flow'], ['Main', 'EDS'], ['Main', 'Trie'], ['Main', 'Scene2D'],
    ['Main', 'Scene3D'], ['Main', 'LoggerTab'], ['Main', 'Adapter'], ['Main', 'ContextMenu'],

    ['Registry', 'RegistryEntry'],
    ['Definitions', 'DefinitionEntry'],
    ['Types', 'TypeEntry'],
    ['Usages', 'UsageEntry'],
    ['Flow', 'FlowEntry'],
    ['EDS', 'EDSEntry'],
    ['Trie', 'GraphNodeTrie'], ['Trie', 'LinkTrie'],
    ['Scene2D', 'GraphNode2D'], ['Scene2D', 'Link2D'], ['Scene2D', 'Tooltip2D'],
    ['Scene3D', 'GraphNode3D'], ['Scene3D', 'Link3D'], ['Scene3D', 'Camera3D'],
    ['LoggerTab', 'LogEntry'],
  ];

  // ---- EXECUTION FLOW : runtime invocations across branches. The muscle. ----
  // kind: 'instantiation' | 'propertyRead' | 'methodCall'
  const E = (s, t, kind) => ({ source: s, target: t, kind });
  const execflow = [
    // Registry orchestrates: it CALLS the loaders (methodCall) and READS their stores.
    E('Registry', 'Definitions', 'methodCall'),
    E('Registry', 'Types', 'methodCall'),
    E('Registry', 'Usages', 'methodCall'),
    E('Registry', 'Flow', 'methodCall'),
    E('Registry', 'EDS', 'methodCall'),
    E('Registry', 'Trie', 'methodCall'),

    // Each store is INSTANTIATED with its entries.
    E('Definitions', 'DefinitionEntry', 'instantiation'),
    E('Types', 'TypeEntry', 'instantiation'),
    E('Usages', 'UsageEntry', 'instantiation'),
    E('Flow', 'FlowEntry', 'instantiation'),
    E('EDS', 'EDSEntry', 'instantiation'),
    E('Trie', 'GraphNodeTrie', 'instantiation'),
    E('Trie', 'LinkTrie', 'instantiation'),

    // The Trie READS Types + Definitions to build itself (GraphBuilder.buildFromRegistry).
    E('Trie', 'Types', 'propertyRead'),
    E('Trie', 'Definitions', 'propertyRead'),
    E('GraphNodeTrie', 'TypeEntry', 'propertyRead'),

    // Scenes READ the Trie and INSTANTIATE their own render nodes.
    E('Scene2D', 'Trie', 'propertyRead'),
    E('Scene3D', 'Trie', 'propertyRead'),
    E('Scene2D', 'GraphNode2D', 'instantiation'),
    E('Scene2D', 'Link2D', 'instantiation'),
    E('Scene3D', 'GraphNode3D', 'instantiation'),
    E('Scene3D', 'Link3D', 'instantiation'),
    E('GraphNode3D', 'GraphNodeTrie', 'propertyRead'),
    E('GraphNode2D', 'GraphNodeTrie', 'propertyRead'),
    E('Camera3D', 'Scene3D', 'methodCall'),

    // EDS + Flow READ Definitions to decorate them.
    E('EDS', 'Definitions', 'propertyRead'),
    E('Flow', 'Usages', 'propertyRead'),

    // Cross-cutting UI calls.
    E('ContextMenu', 'Adapter', 'methodCall'),
    E('Adapter', 'DefinitionEntry', 'propertyRead'),
    E('LoggerTab', 'LogEntry', 'instantiation'),
    E('Registry', 'LoggerTab', 'methodCall'),
  ];

  // ---- THE RING (typeømatica S¹ substrate axis) ----
  // A closed prototype chain — the HoTT Circle type realized at runtime.
  // Not part of the trie; it is the SECOND axis. Shown as an optional overlay.
  const ring = ['Registry', 'Trie', 'Scene3D', 'EDS', 'Flow'];

  // ---- FLOW PANEL stats (mirrors the real FLOW panel: kind -> count) ----
  const flowStats = [
    { kind: 'instantiation', count: 155 },
    { kind: 'propertyRead', count: 152 },
    { kind: 'methodCall', count: 49 },
  ];

  // EDS taxonomy — kind -> label + how it decorates.
  const edsKinds = {
    wrap:           { label: 'wrap',           note: 'wraps the constructor' },
    link:           { label: 'link',           note: 'links to another type' },
    contextConsume: { label: 'contextConsume', note: 'consumes ambient context' },
    hookAttach:     { label: 'hookAttach',     note: 'attaches a lifecycle hook' },
    errorEnrich:    { label: 'errorEnrich',    note: 'enriches thrown errors' },
    adapterUse:     { label: 'adapterUse',     note: 'adapts an external surface' },
  };

  root.MG_DATA = { nodes, dataflow, execflow, ring, flowStats, edsKinds };
})(window);
