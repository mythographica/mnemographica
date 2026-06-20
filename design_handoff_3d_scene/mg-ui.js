/* MnemoGraphica — UI wiring. Builds the dynamic panels and binds controls to opts. */
(function () {
  'use strict';
  const D = window.MG_DATA;
  const GEN = window.MG_SCENE.GEN;
  const KIND = window.MG_SCENE.KIND;
  const $ = s => document.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  const opts = {
    theme: 'dark', mode3d: 1, spacing: 1, spread: 1, ringGap: 150, depthGap: 165,
    showData: true, showExec: true, showEDS: true, showRing: false,
    kindFilter: null, collab: 'pairing', labelDensity: 'smart',
  };

  const canvas = $('#scene');
  const scene = window.MG_SCENE.init(canvas, D, opts);

  function genName(g) { return g === 0 ? 'Roots' : 'Gen ' + g; }

  // ---------- explorer tree ----------
  function buildTree() {
    const tree = $('#model-tree');
    $('#model-count').textContent = D.nodes.length;
    const gens = [...new Set(D.nodes.map(n => n.gen))].sort();
    gens.forEach(g => {
      const grp = el('div', 'gen-group');
      const lbl = el('div', 'gen-label');
      const sw = el('span', 'sw'); sw.style.background = GEN[opts.theme][Math.min(g, 5)];
      lbl.appendChild(sw); lbl.appendChild(document.createTextNode(genName(g)));
      grp.appendChild(lbl);
      D.nodes.filter(n => n.gen === g).forEach(n => {
        const row = el('div', 'tree-row'); row.dataset.id = n.id;
        row.innerHTML = '<span class="nm">' + n.id + '</span>' + (n.eds ? '<span class="eds">' + n.eds + '</span>' : '');
        row.addEventListener('click', () => { scene.select(n.id); });
        grp.appendChild(row);
      });
      tree.appendChild(grp);
    });
  }

  function syncTree(id) {
    document.querySelectorAll('.tree-row').forEach(r => r.classList.toggle('sel', r.dataset.id === id));
  }

  // ---------- flow panel ----------
  function buildFlow() {
    const rows = $('#flow-rows');
    const total = D.flowStats.reduce((s, f) => s + f.count, 0);
    $('#flow-total').textContent = total + ' calls';
    const max = Math.max(...D.flowStats.map(f => f.count));
    D.flowStats.forEach(f => {
      const row = el('div', 'flow-row'); row.dataset.kind = f.kind;
      row.innerHTML =
        '<span class="key"><span class="sw" style="background:' + KIND[f.kind] + '"></span>' + f.kind + '</span>' +
        '<span class="bar"><i style="width:' + (f.count / max * 100) + '%;background:' + KIND[f.kind] + '"></i></span>' +
        '<span class="n">' + f.count + '</span>';
      row.addEventListener('click', () => {
        opts.kindFilter = opts.kindFilter === f.kind ? null : f.kind;
        if (opts.kindFilter) opts.showExec = true;
        syncFlow(); syncLayers();
      });
      rows.appendChild(row);
    });
  }
  function syncFlow() {
    document.querySelectorAll('.flow-row').forEach(r => {
      r.classList.toggle('solo', opts.kindFilter === r.dataset.kind);
      r.classList.toggle('off', opts.kindFilter && opts.kindFilter !== r.dataset.kind);
    });
  }

  // ---------- layer toggles ----------
  const LAYERS = [
    { key: 'showData', label: 'Data flow', sub: 'inheritance trie', stroke: 'var(--skeleton)', solid: true },
    { key: 'showExec', label: 'Execution flow', sub: 'invocations', stroke: KIND.methodCall, dashed: true },
    { key: 'showEDS', label: 'EDS rings', sub: 'decoration kind', ring: true },
    { key: 'showRing', label: 'S¹ substrate ring', sub: 'typeømatica axis', stroke: '#7cf0d2', dotted: true },
  ];
  function buildLayers() {
    const box = $('#layer-toggles');
    LAYERS.forEach(L => {
      const row = el('div', 'toggle-row');
      let mark = '';
      if (L.ring) mark = '<span class="swatch" style="width:14px;height:14px;border:1.5px solid var(--ring);border-radius:50%;border-top:0;flex:none"></span>';
      else mark = '<span class="swatch" style="border-top-color:' + (L.stroke === 'var(--skeleton)' ? 'var(--dim)' : L.stroke) + ';border-top-style:' + (L.dashed ? 'dashed' : L.dotted ? 'dotted' : 'solid') + '"></span>';
      row.innerHTML = '<span class="lbl">' + mark + '<span class="txt"><div class="t">' + L.label + '</div><div class="s">' + L.sub + '</div></span></span>' +
        '<span class="sw-toggle" data-on="' + (opts[L.key] ? 1 : 0) + '"></span>';
      const tg = row.querySelector('.sw-toggle');
      tg.addEventListener('click', () => {
        opts[L.key] = !opts[L.key];
        tg.dataset.on = opts[L.key] ? 1 : 0;
        if (L.key === 'showExec' && !opts[L.key]) { opts.kindFilter = null; syncFlow(); }
      });
      box.appendChild(row);
    });
  }
  function syncLayers() {
    document.querySelectorAll('#layer-toggles .sw-toggle').forEach((tg, i) => { tg.dataset.on = opts[LAYERS[i].key] ? 1 : 0; });
  }

  // ---------- EDS legend ----------
  function edsGlyph(kind) {
    const c = '#d6e0eb', err = '#f0616b', col = kind === 'errorEnrich' ? err : c;
    const common = 'fill="none" stroke="' + col + '" stroke-width="1.3"';
    let inner = '';
    switch (kind) {
      case 'wrap': inner = '<circle cx="8" cy="8" r="4.2" ' + common + '/><circle cx="8" cy="8" r="6.5" ' + common + '/>'; break;
      case 'link': inner = '<circle cx="8" cy="8" r="6" ' + common + ' stroke-dasharray="3 2.5"/>'; break;
      case 'contextConsume': inner = '<circle cx="8" cy="8" r="6" ' + common + ' stroke-width="1.8" stroke-dasharray="0.5 3"/>'; break;
      case 'hookAttach': inner = '<circle cx="8" cy="8" r="5" ' + common + '/><path d="M8 1.5V3.5M13.5 5l-1.7 1M2.5 5l1.7 1" ' + common + '/>'; break;
      case 'errorEnrich': inner = '<circle cx="8" cy="8" r="6" ' + common + '/>'; break;
      case 'adapterUse': inner = '<path d="M3 3.5V2h2M13 2h2v1.5M15 12.5V14h-2M5 14H3v-1.5" ' + common + ' stroke-linecap="round"/>'; break;
    }
    return '<svg viewBox="0 0 16 16">' + inner + '</svg>';
  }
  function buildEDS() {
    const box = $('#eds-legend');
    Object.keys(D.edsKinds).forEach(k => {
      const item = el('div', 'eds-item');
      item.innerHTML = '<span class="gl">' + edsGlyph(k) + '</span>' + k;
      box.appendChild(item);
    });
  }
  function refreshEDS() { $('#eds-legend').innerHTML = ''; buildEDS(); }

  // ---------- HUD legend chips ----------
  function buildHud() {
    const hud = $('#hud');
    hud.innerHTML = '';
    const skel = el('div', 'chip'); skel.innerHTML = '<span class="ln" style="border-top-color:var(--dim);border-top-style:solid"></span> data flow · lineage';
    hud.appendChild(skel);
    Object.keys(KIND).forEach(k => {
      const c = el('div', 'chip'); c.innerHTML = '<span class="ln" style="border-top-color:' + KIND[k] + ';border-top-style:dashed"></span> ' + k;
      hud.appendChild(c);
    });
  }

  // ---------- selection inspector ----------
  function showSelection(id) {
    const body = $('#sel-body');
    syncTree(id);
    if (!id) { body.innerHTML = '<div class="sel-empty">Click any node to inspect its lineage and the invocations that touch it.</div>'; return; }
    const n = scene.byId.get(id);
    const col = GEN[opts.theme][Math.min(n.gen, 5)];
    const outE = D.execflow.filter(e => e.source === id);
    const inE = D.execflow.filter(e => e.target === id);
    const parent = D.dataflow.find(([p, c]) => c === id);
    const kids = D.dataflow.filter(([p, c]) => p === id).map(([p, c]) => c);
    let h = '<div class="sel-name"><span class="dot" style="background:' + col + '"></span>' + n.id + '</div>';
    h += '<div class="sel-meta"><span class="tag">' + genName(n.gen) + '</span>';
    if (parent) h += '<span class="tag">▸ ' + parent[0] + '</span>';
    if (n.eds) h += '<span class="tag eds">' + n.eds + '</span>';
    h += '</div>';
    h += '<div class="sel-blurb">' + n.blurb + '</div>';
    h += '<div class="edge-list">';
    if (kids.length) { h += '<div class="eh">defines (data flow)</div>'; kids.forEach(k => h += edgeRow(k, GEN[opts.theme][Math.min(scene.byId.get(k).gen,5)], '▸')); }
    if (outE.length) { h += '<div class="eh">calls out (execution)</div>'; outE.forEach(e => h += edgeRow(e.target, KIND[e.kind], '→', e.kind)); }
    if (inE.length) { h += '<div class="eh">called by</div>'; inE.forEach(e => h += edgeRow(e.source, KIND[e.kind], '←', e.kind)); }
    h += '</div>';
    body.innerHTML = h;
    body.querySelectorAll('.er').forEach(r => r.addEventListener('click', () => scene.select(r.dataset.id)));
  }
  function edgeRow(id, col, arrow, kind) {
    return '<div class="er" data-id="' + id + '"><span class="k" style="background:' + col + '"></span><span class="ar">' + arrow + '</span>' + id + (kind ? '<span style="margin-left:auto;color:var(--faint);font-size:9.5px">' + kind + '</span>' : '') + '</div>';
  }

  // ---------- status ----------
  function syncStatus() {
    $('#st-types').textContent = D.nodes.length + ' types';
    $('#st-flows').textContent = '◈ ' + D.execflow.length + ' invocations';
    $('#st-mode').textContent = (opts.mode3d > 0.5 ? '3D tunnel' : '2D radial') + ' · ' +
      (opts.collab === 'solo' ? 'Solo' : opts.collab === 'pairing' ? 'AI Pairing' : 'AI Autonomous');
  }

  // ---------- controls ----------
  function tweenMode(target) {
    const start = opts.mode3d, t0 = performance.now(), dur = 520;
    if (tweenMode._iv) clearInterval(tweenMode._iv);
    function frame() {
      const k = Math.min(1, (performance.now() - t0) / dur);
      const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      opts.mode3d = start + (target - start) * e;
      $('#r-mode').value = Math.round(opts.mode3d * 100);
      $('#v-mode').textContent = opts.mode3d > 0.5 ? '3D' : opts.mode3d < 0.04 ? '2D' : Math.round(opts.mode3d * 100) + '%';
      syncStatus();
      if (k >= 1 && tweenMode._iv) { clearInterval(tweenMode._iv); tweenMode._iv = null; opts.mode3d = target; }
    }
    tweenMode._iv = setInterval(frame, 16);
    frame();
  }

  function bindControls() {
    // collab modes
    $('#collab').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      opts.collab = b.dataset.mode;
      document.querySelectorAll('#collab button').forEach(x => x.dataset.on = x === b ? 1 : 0);
      syncStatus();
    });
    // 2D / 3D
    $('#dim-toggle').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      document.querySelectorAll('#dim-toggle button').forEach(x => x.dataset.on = x === b ? 1 : 0);
      tweenMode(b.dataset.dim === '3' ? 1 : 0);
    });
    // theme
    $('#theme-btn').addEventListener('click', () => {
      opts.theme = opts.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = opts.theme;
      $('#theme-btn').textContent = opts.theme === 'dark' ? '☾ Dark' : '☀ Light';
      // refresh swatches that read palette
      document.querySelectorAll('.gen-label .sw').forEach((sw, i) => { sw.style.background = GEN[opts.theme][Math.min(i, 5)]; });
      buildHud(); showSelection(scene.getSelected());
    });
    $('#reset-btn').addEventListener('click', () => scene.resetView());
    $('#note-x').addEventListener('click', () => $('#note').style.display = 'none');

    // sliders
    $('#r-mode').addEventListener('input', e => {
      opts.mode3d = +e.target.value / 100;
      $('#v-mode').textContent = opts.mode3d > 0.6 ? '3D' : opts.mode3d < 0.04 ? '2D' : Math.round(opts.mode3d * 100) + '%';
      document.querySelectorAll('#dim-toggle button').forEach(x => x.dataset.on = (x.dataset.dim === '3') === (opts.mode3d > 0.5) ? 1 : 0);
      syncStatus();
    });
    $('#r-spread').addEventListener('input', e => {
      opts.spread = +e.target.value / 100; $('#v-spread').textContent = opts.spread.toFixed(1) + '×';
      window.MG_ENGINE.layout(D, opts);
    });
    $('#r-spacing').addEventListener('input', e => {
      opts.spacing = +e.target.value / 100; $('#v-spacing').textContent = opts.spacing.toFixed(1) + '×';
      window.MG_ENGINE.layout(D, opts);
    });
    $('#r-depth').addEventListener('input', e => {
      opts.depthGap = +e.target.value; $('#v-depth').textContent = opts.depthGap;
    });
  }

  // ---------- scene events ----------
  scene.on('select', id => { showSelection(id); });
  scene.on('hover', () => {});
  scene.on('agentmove', () => { syncStatus(); });

  // ---------- boot ----------
  buildTree(); buildFlow(); buildLayers(); buildEDS(); buildHud(); bindControls(); syncStatus();
  window.addEventListener('resize', () => scene.resize());
})();
