/* MnemoGraphica — layout + projection engine.
 *
 * One layout, two readings:
 *   - Radial trie layout: radius = generation, angle = position in subtree.
 *   - mode3d in [0,1] lerps each generation-ring apart along Z, turning the flat
 *     concentric-ring view (2D) into a rotatable "lineage tunnel" (3D) where
 *     DEPTH itself encodes generation. 2D<->3D is therefore a smooth morph.
 */
(function (root) {
  'use strict';

  function buildTopology(data) {
    const byId = new Map(data.nodes.map(n => [n.id, n]));
    const children = new Map();
    const parent = new Map();
    data.nodes.forEach(n => children.set(n.id, []));
    data.dataflow.forEach(([p, c]) => {
      children.get(p).push(c);
      parent.set(c, p);
    });
    const roots = data.nodes.filter(n => !parent.has(n.id)).map(n => n.id);
    return { byId, children, parent, roots };
  }

  function leafCount(id, children, memo) {
    if (memo.has(id)) return memo.get(id);
    const kids = children.get(id) || [];
    let c = kids.length === 0 ? 1 : 0;
    for (const k of kids) c += leafCount(k, children, memo);
    c = Math.max(1, c);
    memo.set(id, c);
    return c;
  }

  // Assign base polar coordinates (angle, ring) to every node.
  function layout(data, opts) {
    opts = opts || {};
    const spread = opts.spread == null ? 1 : opts.spread; // angular padding factor
    const topo = buildTopology(data);
    const { byId, children } = topo;
    const memo = new Map();

    function assign(id, a0, a1, gen) {
      const node = byId.get(id);
      node.gen = gen;
      node.angle = (a0 + a1) / 2;
      node.ring = gen;
      const kids = children.get(id) || [];
      if (!kids.length) return;
      const total = kids.reduce((s, k) => s + leafCount(k, children, memo), 0);
      // pad: shrink each child's slice slightly so siblings breathe
      const pad = Math.min(0.18, (a1 - a0) * 0.04 * spread);
      let cursor = a0 + pad / 2;
      const usable = (a1 - a0) - pad;
      for (const k of kids) {
        const frac = leafCount(k, children, memo) / total;
        const span = usable * frac;
        assign(k, cursor, cursor + span, gen + 1);
        cursor += span;
      }
    }

    // Roots share the full circle (here: a single root, Main).
    const rn = topo.roots.length;
    topo.roots.forEach((r, i) => {
      assign(r, (i / rn) * Math.PI * 2, ((i + 1) / rn) * Math.PI * 2, 0);
    });

    // Resolve to base 2D coordinates on the z=0 plane.
    const ringGap = (opts.ringGap || 150) * (opts.spacing || 1);
    data.nodes.forEach(n => {
      const r = n.ring * ringGap;
      n.bx = Math.cos(n.angle) * r;
      n.by = Math.sin(n.angle) * r;
      n.r = r;
    });

    return topo;
  }

  // Project a node's world position to screen, given camera state.
  // cam: { yaw, pitch, dist, mode3d, depthGap, zoom, cx, cy, spinPhase }
  function project(n, cam) {
    // world position: base plane (bx,by) + generation pushed along z by mode3d.
    const x = n.bx;
    const y = n.by;
    const z = -n.gen * cam.depthGap * cam.mode3d;

    // rotate around Y (yaw) then X (pitch) — rotation fades out as we flatten to 2D
    const ry = cam.yaw * cam.mode3d, rx = cam.pitch * cam.mode3d;
    const cy0 = Math.cos(ry), sy0 = Math.sin(ry);
    let x1 = x * cy0 + z * sy0;
    let z1 = -x * sy0 + z * cy0;
    const cx0 = Math.cos(rx), sx0 = Math.sin(rx);
    let y1 = y * cx0 - z1 * sx0;
    let z2 = y * sx0 + z1 * cx0;

    // perspective: closer (z toward camera) = bigger. dist is camera pull-back.
    const persp = cam.dist / (cam.dist - z2);
    const scale = persp * cam.zoom;
    return {
      sx: cam.cx + x1 * scale,
      sy: cam.cy + y1 * scale,
      scale: scale,
      depth: z2,        // for painter's-algorithm sort + fog
      persp: persp,
    };
  }

  root.MG_ENGINE = { layout, project, buildTopology };
})(window);
