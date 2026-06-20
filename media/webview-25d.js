/* MnemoGraphica 2.5D — Canvas2D webview renderer.
 * Adapts the design-handoff prototype (mg-engine + mg-scene) to the
 * real GraphData shape from the extension: nodes[] + links[] + execflow[].
 */
(function () {
	'use strict';

	const vscode = acquireVsCodeApi();

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

	// ---------- engine: layout + projection ----------
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

	function layout(data, opts) {
		opts = opts || {};
		const spread = opts.spread == null ? 1 : opts.spread;
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

		const rn = topo.roots.length;
		topo.roots.forEach((r, i) => {
			assign(r, (i / rn) * Math.PI * 2, ((i + 1) / rn) * Math.PI * 2, 0);
		});

		const ringGap = (opts.ringGap || 150) * (opts.spacing || 1);
		data.nodes.forEach(n => {
			const r = n.ring * ringGap;
			n.bx = Math.cos(n.angle) * r;
			n.by = Math.sin(n.angle) * r;
			n.r = r;
		});

		return topo;
	}

	function project(n, cam) {
		const x = n.bx;
		const y = n.by;
		const z = -n.gen * cam.depthGap * cam.mode3d;
		const ry = cam.yaw * cam.mode3d, rx = cam.pitch * cam.mode3d;
		const cy0 = Math.cos(ry), sy0 = Math.sin(ry);
		let x1 = x * cy0 + z * sy0;
		let z1 = -x * sy0 + z * cy0;
		const cx0 = Math.cos(rx), sx0 = Math.sin(rx);
		let y1 = y * cx0 - z1 * sx0;
		let z2 = y * sx0 + z1 * cx0;
		const persp = cam.dist / (cam.dist - z2);
		const scale = persp * cam.zoom;
		return {
			sx: cam.cx + x1 * scale,
			sy: cam.cy + y1 * scale,
			scale: scale,
			depth: z2,
			persp: persp,
		};
	}

	// ---------- transform incoming GraphData to prototype shape ----------
	function transformGraph(raw) {
		const nodes = raw.nodes.map(n => ({
			id: n.id,
			gen: n.depth || 0,
			eds: n.edsStatus && n.edsStatus !== 'none' ? n.edsStatus : null,
			name: n.name,
			location: n.location,
			properties: n.properties,
			isRoot: n.isRoot,
		}));
		// links -> dataflow as [source, target] tuples
		const dataflow = raw.links.map(l => {
			const s = typeof l.source === 'object' ? l.source.id : l.source;
			const t = typeof l.target === 'object' ? l.target.id : l.target;
			return [s, t];
		});
		// execflow already in right shape, just ensure string IDs
		const execflow = (raw.execflow || []).map(e => ({
			source: typeof e.source === 'object' ? e.source.id : e.source,
			target: typeof e.target === 'object' ? e.target.id : e.target,
			kind: e.kind,
			location: e.location,
			code: e.code,
		}));
		return { nodes, dataflow, execflow };
	}

	// ---------- main scene init ----------
	function initScene(canvas, data, opts) {
		const ctx = canvas.getContext('2d');
		const topo = layout(data, opts);
		const byId = topo.byId;

		const cam = {
			yaw: -0.62, pitch: 0.48, dist: 1150, depthGap: 165,
			zoom: 0.9, cx: 0, cy: 0, panX: 0, panY: 0,
		};

		let hovered = null, selected = null;
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

		// EDS ring drawing
		function drawEDS(n, p, t) {
			if (!n.eds || !opts.showEDS) return;
			const T = THEME[opts.theme];
			const R = nodeBaseR(n) * p.scale + 5;
			const col = n.eds === 'error' ? T.err : T.ring;
			ctx.save();
			ctx.strokeStyle = col; ctx.lineWidth = 1.4;
			ctx.beginPath();
			switch (n.eds) {
			case 'wrap':
				ctx.arc(p.sx, p.sy, R, 0, Math.PI * 2); ctx.stroke();
				ctx.beginPath(); ctx.arc(p.sx, p.sy, R + 3, 0, Math.PI * 2); ctx.stroke(); break;
			case 'link':
				ctx.setLineDash([5, 4]); ctx.arc(p.sx, p.sy, R, 0, Math.PI * 2); ctx.stroke(); break;
			case 'context':
				ctx.setLineDash([1.5, 4]); ctx.lineWidth = 2; ctx.arc(p.sx, p.sy, R, 0, Math.PI * 2); ctx.stroke(); break;
			case 'error':
				ctx.arc(p.sx, p.sy, R, 0, Math.PI * 2); ctx.stroke(); break;
			case 'hook':
				ctx.arc(p.sx, p.sy, R, 0, Math.PI * 2); ctx.stroke();
				for (let i = 0; i < 3; i++) {
					const a = t * 0.5 + i * (Math.PI * 2 / 3);
					ctx.beginPath();
					ctx.moveTo(p.sx + Math.cos(a) * R, p.sy + Math.sin(a) * R);
					ctx.lineTo(p.sx + Math.cos(a) * (R + 4), p.sy + Math.sin(a) * (R + 4));
					ctx.stroke();
				} break;
			case 'adapter':
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
					const p = project(n, cam);
					lastProj.set(n.id, p); proj.push({ n, p });
				});
				proj.sort((a, b) => a.p.depth - b.p.depth); // far first

				const focus = selected || hovered;
				let zmin = Infinity, zmax = -Infinity;
				proj.forEach(o => { zmin = Math.min(zmin, o.p.depth); zmax = Math.max(zmax, o.p.depth); });
				const fog = (d) => opts.mode3d < 0.15 ? 0 : Math.max(0, Math.min(0.62, (d - zmin) / ((zmax - zmin) || 1) * 0.62));

				// ---- skeleton: data flow ----
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

				// ---- muscle: execution flow ----
				if (opts.showExec) {
					data.execflow.forEach((e, i) => {
						if (opts.kindFilter && opts.kindFilter !== e.kind) return;
						const a = lastProj.get(e.source), b = lastProj.get(e.target);
						if (!a || !b) return;
						const focusRel = focus && (e.source === focus || e.target === focus);
						const dimmed = focus && !focusRel;
						const base = KIND[e.kind];
						if (!base) return;
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

				// ---- labels (collision-aware) ----
				drawLabels(proj, focus, fog);
			} catch (err) { console.error('[MG25D]', err); }
		}

		function drawLabels(proj, focus, fogFn) {
			const T = THEME[opts.theme];
			const placed = [];
			const order = proj.slice().sort((a, b) => {
				const fa = (focus && (a.n.id === focus || isFocusSubtree(a.n.id, focus))) ? 0 : 1;
				const fb = (focus && (b.n.id === focus || isFocusSubtree(b.n.id, focus))) ? 0 : 1;
				if (fa !== fb) return fa - fb;
				if (a.n.gen !== b.n.gen) return a.n.gen - b.n.gen;
				return b.p.depth - a.p.depth;
			});
			ctx.font = '500 12px "JetBrains Mono", ui-monospace, monospace';
			ctx.textBaseline = 'middle';
			order.forEach(({ n, p }) => {
				const isFoc = focus && (n.id === focus || isFocusSubtree(n.id, focus));
				const showAll = opts.labelDensity === 'all' || cam.zoom > 1.7;
				if (!isFoc && !showAll && n.gen > 1 && n.id !== focus) return;
				const r = nodeBaseR(n) * p.scale;
				const lx = p.sx + r + 5, ly = p.sy;
				const tw = ctx.measureText(n.id).width;
				const box = { x: lx - 2, y: ly - 8, w: tw + 5, h: 16 };
				const clash = placed.some(b => !(box.x > b.x + b.w || box.x + box.w < b.x || box.y > b.y + b.h || box.y + box.h < b.y));
				if (clash && !isFoc) return;
				placed.push(box);
				const f = fogFn(p.depth);
				ctx.fillStyle = T.labelBg; ctx.globalAlpha = isFoc ? 0.9 : 0.55;
				ctx.fillRect(box.x, box.y, box.w, box.h);
				ctx.globalAlpha = 1;
				ctx.fillStyle = isFoc ? T.text : mix(n.gen <= 1 ? T.text : T.dim, T.bg, f * 0.7);
				ctx.fillText(n.id, lx, ly + 1);
			});
		}

		resize();
		let _raf = false, _started = performance.now();
		function loop() { _raf = true; render(performance.now() - _started); requestAnimationFrame(loop); }
		requestAnimationFrame(loop);
		render(0);
		setTimeout(function () {
			if (!_raf) { setInterval(function () { render(performance.now() - _started); }, 33); }
		}, 400);

		return {
			on,
			resize,
			cam,
			select(id) { selected = id; emit('select', id); },
			getSelected() { return selected; },
			resetView() { cam.yaw = -0.62; cam.pitch = 0.48; cam.zoom = 0.9; cam.panX = 0; cam.panY = 0; resize(); },
			data, byId,
		};
	}

	// ---------- boot ----------
	const canvas = document.getElementById('scene');
	let currentData = null;
	let scene = null;

	const opts = {
		theme: 'dark', mode3d: 1, spacing: 1, spread: 1, ringGap: 150, depthGap: 165,
		showData: true, showExec: true, showEDS: true, showRing: false,
		kindFilter: null, labelDensity: 'smart',
	};

	function setupControls() {
		// 2D / 3D toggle
		document.getElementById('dim-2d').addEventListener('click', () => tweenMode(0));
		document.getElementById('dim-3d').addEventListener('click', () => tweenMode(1));
		// theme
		document.getElementById('theme-btn').addEventListener('click', () => {
			opts.theme = opts.theme === 'dark' ? 'light' : 'dark';
			document.documentElement.dataset.theme = opts.theme;
			document.getElementById('theme-btn').textContent = opts.theme === 'dark' ? 'Dark' : 'Light';
		});
		// reset
		document.getElementById('reset-btn').addEventListener('click', () => {
			if (scene) scene.resetView();
		});
		// zoom
		document.getElementById('zoom-in').addEventListener('click', () => {
			if (scene) { scene.cam.zoom = Math.min(3.5, scene.cam.zoom * 1.3); }
		});
		document.getElementById('zoom-out').addEventListener('click', () => {
			if (scene) { scene.cam.zoom = Math.max(0.35, scene.cam.zoom * 0.7); }
		});
		// sliders
		document.getElementById('r-mode').addEventListener('input', e => {
			opts.mode3d = +e.target.value / 100;
			document.getElementById('v-mode').textContent = opts.mode3d > 0.6 ? '3D' : opts.mode3d < 0.04 ? '2D' : Math.round(opts.mode3d * 100) + '%';
		});
		document.getElementById('r-spread').addEventListener('input', e => {
			opts.spread = +e.target.value / 100;
			document.getElementById('v-spread').textContent = opts.spread.toFixed(1) + 'x';
			if (scene) layout(scene.data, opts);
		});
		document.getElementById('r-spacing').addEventListener('input', e => {
			opts.spacing = +e.target.value / 100;
			document.getElementById('v-spacing').textContent = opts.spacing.toFixed(1) + 'x';
			if (scene) layout(scene.data, opts);
		});
		document.getElementById('r-depth').addEventListener('input', e => {
			opts.depthGap = +e.target.value;
			document.getElementById('v-depth').textContent = opts.depthGap;
		});
	}

	function tweenMode(target) {
		if (!scene) return;
		const start = opts.mode3d, t0 = performance.now(), dur = 520;
		if (tweenMode._iv) clearInterval(tweenMode._iv);
		function frame() {
			const k = Math.min(1, (performance.now() - t0) / dur);
			const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
			opts.mode3d = start + (target - start) * e;
			document.getElementById('r-mode').value = Math.round(opts.mode3d * 100);
			document.getElementById('v-mode').textContent = opts.mode3d > 0.5 ? '3D' : opts.mode3d < 0.04 ? '2D' : Math.round(opts.mode3d * 100) + '%';
			if (k >= 1 && tweenMode._iv) { clearInterval(tweenMode._iv); tweenMode._iv = null; opts.mode3d = target; }
		}
		tweenMode._iv = setInterval(frame, 16);
		frame();
	}

	function updateStatus(data) {
		const el = document.getElementById('status');
		if (!el || !data) return;
		const execCount = (data.execflow || []).length;
		el.textContent = data.nodes.length + ' types | ' + data.dataflow.length + ' inheritance | ' + execCount + ' invocations';
	}

	function renderGraph(rawData) {
		if (!rawData || !rawData.nodes || rawData.nodes.length === 0) {
			const container = document.getElementById('graph-container');
			if (container) container.innerHTML = '<div class="loading">No type data found</div>';
			return;
		}
		currentData = transformGraph(rawData);
		if (scene) {
			// Just update data reference; scene re-renders via rAF
			scene.data = currentData;
			layout(currentData, opts);
		} else {
			scene = initScene(canvas, currentData, opts);
			scene.on('select', id => {
				const n = scene.byId.get(id);
				if (n && n.location) {
					vscode.postMessage({ command: 'goToDefinition', data: n.location });
				}
			});
		}
		updateStatus(currentData);
	}

	// Handle messages from extension
	window.addEventListener('message', function (event) {
		const message = event.data;
		if (message.command === 'updateGraph') {
			renderGraph(message.data);
		}
	});

	// Initial ready ping
	vscode.postMessage({ command: 'ready' });
	setupControls();
})();
