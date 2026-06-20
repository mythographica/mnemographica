/* MnemoGraphica — canvas scene renderer.
 * Draws the dual-flow graph: skeleton (data flow) + muscle (execution flow),
 * EDS rings, depth fog, collision-aware labels, the S1 ring, and AI presence.
 */
(function (root) {
  'use strict';

  // ---------- palettes ----------
  const GEN = {
    dark:  ['#f2c14e', '#ef8b6b', '#e8688e', '#b07cd6', '#5b9bd6', '#4fc4b0'],
    light: ['#b98512', '#cf6038', '#c33a66', '#7d44bd', '#2f6fb0', '#13917c'],
  };
  const KIND = {
    instantiation: '#46c98b',
    propertyRead:  '#5aa7f0',
    methodCall:    '#f0b14a',
  };
  const THEME = {
    dark: {
      bg: '#0d1014', grid: 'rgba(120,135,155,0.05)',
      skeleton: 'rgba(150,162,180,0.22)', skeletonDim: 'rgba(150,162,180,0.08)',
      text: '#d3dae3', dim: '#828d9c', faint: '#5a6473',
      ring: 'rgba(214,224,235,0.55)', err: '#f0616b',
      labelBg: 'rgba(13,16,20,0.72)', agent: '#7cf0d2', human: '#ffd166',
      panel: '#14181e',
    },
    light: {
      bg: '#f4f2ec', grid: 'rgba(30,40,55,0.05)',
      skeleton: 'rgba(40,48,60,0.22)', skeletonDim: 'rgba(40,48,60,0.07)',
      text: '#23272e', dim: '#6b7280', faint: '#9aa1ab',
      ring: 'rgba(30,36,46,0.5)', err: '#cf3b46',
      labelBg: 'rgba(244,242,236,0.78)', agent: '#0f9c86', human: '#c98a12',
      panel: '#ece9e0',
    },
  };

  function mix(hex, target, t) {
    const a = parseInt(hex.slice(1), 16), b = parseInt(target.slice(1), 16);
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  function init(canvas, data, opts) {
    const ctx = canvas.getContext('2d');
    const topo = MG_ENGINE.layout(data, opts);
    const byId = topo.byId;

    const cam = {
      yaw: -0.62, pitch: 0.48, dist: 1150, depthGap: 165,
      zoom: 0.9, cx: 0, cy: 0, panX: 0, panY: 0,
    };

    let hovered = null, selected = null, agentNode = 'FlowEntry', humanNode = 'Trie';
    let agentTargetId = 'FlowEntry';
    let dragging = false, lastX = 0, lastY = 0, moved = 0;
    let idleSpin = true, lastInteract = performance.now();
    const listeners = {};
    const emit = (ev, d) => (listeners[ev] || []).forEach(f => f(d));

    function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cam.cx = w / 2 + cam.panX; cam.cy = h / 2 + cam.panY - h * 0.015;
    }
    window.addEventListener('resize', resize);

    function nodeBaseR(n) { return n.gen === 0 ? 15 : n.gen === 1 ? 10.5 : 7.5; }
    function genColor(n) { return GEN[opts.theme][Math.min(n.gen, 5)]; }

    // ---------- pointer ----------
    function localXY(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    canvas.addEventListener('pointerdown', e => {
      dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId); idleSpin = false; lastInteract = performance.now();
    });
    canvas.addEventListener('pointermove', e => {
      const p = localXY(e);
      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
        if (opts.mode3d > 0.15 && !e.shiftKey) {
          cam.yaw += dx * 0.006; cam.pitch += dy * 0.005;
          cam.pitch = Math.max(-1.1, Math.min(1.1, cam.pitch));
        } else {
          cam.panX += dx; cam.panY += dy; resize();
        }
        lastInteract = performance.now();
      } else {
        const hit = pick(p.x, p.y);
        if (hit !== hovered) { hovered = hit; canvas.style.cursor = hit ? 'pointer' : 'grab'; emit('hover', hit); }
      }
    });
    canvas.addEventListener('pointerup', e => {
      dragging = false;
      if (moved < 5) {
        const p = localXY(e); const hit = pick(p.x, p.y);
        selected = hit; emit('select', hit);
      }
      setTimeout(() => { idleSpin = true; }, 4000);
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      cam.zoom *= e.deltaY < 0 ? 1.08 : 0.93;
      cam.zoom = Math.max(0.35, Math.min(3.5, cam.zoom));
      lastInteract = performance.now(); idleSpin = false;
      setTimeout(() => { idleSpin = true; }, 4000);
    }, { passive: false });

    let lastProj = new Map();
    function pick(x, y) {
      let best = null, bestD = 18 * 18;
      lastProj.forEach((p, id) => {
        const n = byId.get(id);
        const rr = nodeBaseR(n) * p.scale + 6;
        const dx = x - p.sx, dy = y - p.sy, d = dx * dx + dy * dy;
        if (d < Math.max(bestD, rr * rr)) { bestD = d; best = id; }
      });
      return best;
    }

    // ---------- EDS ring ----------
    function drawEDS(n, p, t) {
      if (!n.eds || !opts.showEDS) return;
      const T = THEME[opts.theme];
      const R = nodeBaseR(n) * p.scale + 5;
      const col = n.eds === 'errorEnrich' ? T.err : T.ring;
      ctx.save();
      ctx.strokeStyle = col; ctx.lineWidth = 1.4;
      ctx.beginPath();
      switch (n.eds) {
        case 'wrap':
          ctx.arc(p.sx, p.sy, R, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.arc(p.sx, p.sy, R + 3, 0, Math.PI * 2); ctx.stroke(); break;
        case 'link':
          ctx.setLineDash([5, 4]); ctx.arc(p.sx, p.sy, R, 0, Math.PI * 2); ctx.stroke(); break;
        case 'contextConsume':
          ctx.setLineDash([1.5, 4]); ctx.lineWidth = 2; ctx.arc(p.sx, p.sy, R, 0, Math.PI * 2); ctx.stroke(); break;
        case 'errorEnrich':
          ctx.arc(p.sx, p.sy, R, 0, Math.PI * 2); ctx.stroke(); break;
        case 'hookAttach':
          ctx.arc(p.sx, p.sy, R, 0, Math.PI * 2); ctx.stroke();
          for (let i = 0; i < 3; i++) {
            const a = t * 0.5 + i * (Math.PI * 2 / 3);
            ctx.beginPath();
            ctx.moveTo(p.sx + Math.cos(a) * R, p.sy + Math.sin(a) * R);
            ctx.lineTo(p.sx + Math.cos(a) * (R + 4), p.sy + Math.sin(a) * (R + 4));
            ctx.stroke();
          } break;
        case 'adapterUse':
          ctx.setLineDash([]);
          const s = R + 1;
          for (let q = 0; q < 4; q++) {
            const ox = (q % 2 ? 1 : -1), oy = (q < 2 ? -1 : 1);
            ctx.beginPath();
            ctx.moveTo(p.sx + ox * s, p.sy + oy * s - oy * 5);
            ctx.lineTo(p.sx + ox * s, p.sy + oy * s);
            ctx.lineTo(p.sx + ox * s - ox * 5, p.sy + oy * s);
            ctx.stroke();
          } break;
      }
      ctx.restore();
    }

    // ---------- curved edge ----------
    function curve(a, b, lift) {
      const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
      const dx = b.sx - a.sx, dy = b.sy - a.sy;
      const nx = -dy, ny = dx, len = Math.hypot(nx, ny) || 1;
      return { cx: mx + (nx / len) * lift, cy: my + (ny / len) * lift };
    }

    function isFocusSubtree(id, focus) {
      if (!focus) return false;
      let cur = id;
      while (cur) { if (cur === focus) return true; cur = topo.parent.get(cur); }
      return false;
    }

    // ---------- main render ----------
    function render(time) {
     try {
      const T = THEME[opts.theme];
      const t = time / 1000;
      if (idleSpin && opts.mode3d > 0.15 && performance.now() - lastInteract > 4000) cam.yaw += 0.0016;
      cam.depthGap = opts.depthGap;
      cam.mode3d = opts.mode3d;

      const w = canvas.clientWidth, h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, h);

      // project all
      lastProj = new Map();
      const proj = [];
      data.nodes.forEach(n => {
        const p = MG_ENGINE.project(n, cam);
        lastProj.set(n.id, p); proj.push({ n, p });
      });
      proj.sort((a, b) => a.p.depth - b.p.depth); // far first

      const focus = selected || hovered;
      // depth range for fog
      let zmin = Infinity, zmax = -Infinity;
      proj.forEach(o => { zmin = Math.min(zmin, o.p.depth); zmax = Math.max(zmax, o.p.depth); });
      const fog = (d) => opts.mode3d < 0.15 ? 0 : Math.max(0, Math.min(0.62, (d - zmin) / ((zmax - zmin) || 1) * 0.62));

      // ---- skeleton: data flow (inheritance) ----
      if (opts.showData) {
        data.dataflow.forEach(([s, tg]) => {
          const a = lastProj.get(s), b = lastProj.get(tg);
          if (!a || !b) return;
          const dim = focus && !(isFocusSubtree(s, focus) || isFocusSubtree(tg, focus));
          ctx.strokeStyle = dim ? T.skeletonDim : T.skeleton;
          ctx.lineWidth = Math.max(0.6, 1.1 * b.scale);
          ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
        });
      }

      // ---- muscle: execution flow (invocations) ----
      if (opts.showExec) {
        data.execflow.forEach((e, i) => {
          if (opts.kindFilter && opts.kindFilter !== e.kind) return;
          const a = lastProj.get(e.source), b = lastProj.get(e.target);
          if (!a || !b) return;
          const focusRel = focus && (e.source === focus || e.target === focus);
          const dimmed = focus && !focusRel;
          const base = KIND[e.kind];
          const c = curve(a, b, 26 * ((i % 3) + 1) * 0.5 * b.scale);
          ctx.save();
          ctx.globalAlpha = dimmed ? 0.14 : (focusRel ? 0.95 : 0.6);
          ctx.strokeStyle = mix(base, T.bg, fog(b.depth));
          ctx.lineWidth = (focusRel ? 2.4 : 1.4) * Math.max(0.5, b.scale);
          ctx.setLineDash([6, 7]);
          ctx.lineDashOffset = -t * 26 * (e.kind === 'methodCall' ? 1.6 : e.kind === 'propertyRead' ? 1.1 : 0.8);
          ctx.beginPath(); ctx.moveTo(a.sx, a.sy);
          ctx.quadraticCurveTo(c.cx, c.cy, b.sx, b.sy); ctx.stroke();
          // arrowhead
          ctx.setLineDash([]);
          const ang = Math.atan2(b.sy - c.cy, b.sx - c.cx);
          const ah = 6 * Math.max(0.6, b.scale);
          const br = nodeBaseR(byId.get(e.target)) * b.scale + 2;
          const tx = b.sx - Math.cos(ang) * br, ty = b.sy - Math.sin(ang) * br;
          ctx.fillStyle = mix(base, T.bg, fog(b.depth));
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(tx - Math.cos(ang - 0.4) * ah, ty - Math.sin(ang - 0.4) * ah);
          ctx.lineTo(tx - Math.cos(ang + 0.4) * ah, ty - Math.sin(ang + 0.4) * ah);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        });
      }

      // ---- the S1 ring (typeomatica substrate axis) ----
      if (opts.showRing) {
        ctx.save();
        ctx.strokeStyle = opts.theme === 'dark' ? 'rgba(124,240,210,0.5)' : 'rgba(15,156,134,0.55)';
        ctx.lineWidth = 1.6; ctx.setLineDash([2, 6]); ctx.lineCap = 'round';
        ctx.beginPath();
        data.ring.forEach((id, i) => {
          const p = lastProj.get(id); if (!p) return;
          if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy);
        });
        const first = lastProj.get(data.ring[0]); if (first) ctx.lineTo(first.sx, first.sy);
        ctx.stroke(); ctx.restore();
      }

      // ---- nodes ----
      proj.forEach(({ n, p }) => {
        const r = nodeBaseR(n) * p.scale;
        const f = fog(p.depth);
        const focused = focus && (n.id === focus || isFocusSubtree(n.id, focus));
        ctx.save();
        ctx.globalAlpha = focus && !focused ? 0.4 : 1;
        // halo
        ctx.beginPath(); ctx.arc(p.sx, p.sy, r + 3, 0, Math.PI * 2);
        ctx.fillStyle = mix(genColor(n), T.bg, Math.min(0.85, f + 0.55));
        ctx.fill();
        // body
        ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
        ctx.fillStyle = mix(genColor(n), T.bg, f);
        ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = mix('#ffffff', T.bg, 0.3 + f * 0.5);
        ctx.globalAlpha *= 0.5; ctx.stroke(); ctx.globalAlpha = focus && !focused ? 0.4 : 1;
        ctx.restore();
        drawEDS(n, p, t);
      });

      // ---- agent / human presence ----
      drawPresence(time);

      // ---- labels (collision-aware) ----
      drawLabels(proj, focus, fog);
     } catch (err) { window.__MG_ERR = String(err && err.stack || err); }
    }

    function drawPresence(time) {
      const T = THEME[opts.theme];
      const t = time / 1000;
      if (opts.collab === 'solo') return;
      // agent hop in autonomous mode
      if (opts.collab === 'autonomous') {
        if (!drawPresence._next || time > drawPresence._next) {
          const outs = data.execflow.filter(e => e.source === agentNode);
          const pick2 = outs.length ? outs[Math.floor(Math.random() * outs.length)].target
            : data.execflow[Math.floor(Math.random() * data.execflow.length)].target;
          agentTargetId = pick2; agentNode = pick2;
          drawPresence._next = time + 2200;
          emit('agentmove', agentNode);
        }
      }
      const ap = lastProj.get(agentNode);
      if (ap) drawAura(ap, T.agent, 'opus-4.8', opts.collab === 'autonomous' ? 'traversing' : 'reading', t);
      if (opts.collab === 'pairing') {
        const hp = lastProj.get(humanNode);
        if (hp) drawAura(hp, T.human, 'you', 'editing', t + 1.5);
      }
    }

    function drawAura(p, color, who, verb, t) {
      const pulse = 1 + Math.sin(t * 2.4) * 0.12;
      ctx.save();
      ctx.strokeStyle = color; ctx.globalAlpha = 0.85; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(p.sx, p.sy, 17 * p.scale * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.arc(p.sx, p.sy, 24 * p.scale * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      // tag
      const label = '\u25C8 ' + who + ' \u00B7 ' + verb;
      ctx.font = '600 11px "JetBrains Mono", monospace';
      const tw = ctx.measureText(label).width;
      const lx = p.sx + 20 * p.scale, ly = p.sy - 20 * p.scale;
      ctx.save();
      ctx.fillStyle = color; ctx.globalAlpha = 0.16;
      ctx.beginPath(); roundRect(lx - 6, ly - 13, tw + 12, 19, 5); ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); roundRect(lx - 6, ly - 13, tw + 12, 19, 5); ctx.stroke();
      ctx.fillStyle = color; ctx.fillText(label, lx, ly);
      ctx.restore();
    }

    function roundRect(x, y, w, h, r) {
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }

    function drawLabels(proj, focus, fog) {
      const T = THEME[opts.theme];
      const placed = [];
      // importance: focused/selected first, then low gen, then nearer
      const order = proj.slice().sort((a, b) => {
        const fa = (focus && (a.n.id === focus || isFocusSubtree(a.n.id, focus))) ? 0 : 1;
        const fb = (focus && (b.n.id === focus || isFocusSubtree(b.n.id, focus))) ? 0 : 1;
        if (fa !== fb) return fa - fb;
        if (a.n.gen !== b.n.gen) return a.n.gen - b.n.gen;
        return b.p.depth - a.p.depth;
      });
      ctx.font = '500 12px "JetBrains Mono", monospace';
      ctx.textBaseline = 'middle';
      order.forEach(({ n, p }) => {
        const isFoc = focus && (n.id === focus || isFocusSubtree(n.id, focus));
        const showAll = opts.labelDensity === 'all' || cam.zoom > 1.7;
        if (!isFoc && !showAll && n.gen > 1 && n.id !== focus) {
          // gen>=2 labels only when zoomed/focused or all-mode
          if (!(opts.labelDensity === 'all')) return;
        }
        const r = nodeBaseR(n) * p.scale;
        const lx = p.sx + r + 5, ly = p.sy;
        const tw = ctx.measureText(n.id).width;
        const box = { x: lx - 2, y: ly - 8, w: tw + 5, h: 16 };
        const clash = placed.some(b => !(box.x > b.x + b.w || box.x + box.w < b.x || box.y > b.y + b.h || box.y + box.h < b.y));
        if (clash && !isFoc) return;
        placed.push(box);
        const f = fog(p.depth);
        ctx.fillStyle = T.labelBg; ctx.globalAlpha = isFoc ? 0.9 : 0.55;
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.globalAlpha = 1;
        ctx.fillStyle = isFoc ? T.text : mix(n.gen <= 1 ? T.text : T.dim, T.bg, f * 0.7);
        ctx.fillText(n.id, lx, ly + 1);
      });
    }

    resize();
    // Driver: prefer rAF (smooth, visible tab) but fall back to a timer when
    // rAF is throttled/paused (offscreen iframe, export, hidden tab) so the
    // scene always paints.
    let _raf = false, _started = performance.now();
    function loop() { _raf = true; render(performance.now() - _started); requestAnimationFrame(loop); }
    requestAnimationFrame(loop);
    render(0); // immediate first paint
    setTimeout(function () {
      if (!_raf) { setInterval(function () { render(performance.now() - _started); }, 33); }
    }, 400);

    return {
      on,
      resize,
      cam,
      select(id) { selected = id; emit('select', id); },
      setAgent(id) { agentNode = id; agentTargetId = id; },
      getSelected() { return selected; },
      resetView() { cam.yaw = -0.62; cam.pitch = 0.48; cam.zoom = 0.9; cam.panX = 0; cam.panY = 0; resize(); },
      data, byId,
    };
  }

  root.MG_SCENE = { init, GEN, KIND, THEME };
})(window);
