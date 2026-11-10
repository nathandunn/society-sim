// Play mode: run one history a year at a time, pause it, look at every person, and change things.
import { GENES, GENE_KEYS } from './src/genome.js';
import { TECHS } from './src/params.js';
import { lineChart } from './charts.js';

const $ = s => document.querySelector(s);
const TERRAIN = { light: ['#bcd3e6', '#e9e2cf', '#d7dfb4', '#8fb8de', '#e4dfae'], dark: ['#1f3a52', '#4a4536', '#4f5a33', '#3570a0', '#5e5838'] };
const SPEEDS = [1, 5, 10, 25, 50];
const ACT = { plant: 'gathering', hunt: 'hunting', fish: 'fishing', farm: 'farming', herd: 'herding' };

export function initPlay(ctx) {
  const { esc, describe, getCfg, showResult } = ctx;
  let w = null, meta = null, snap = null, frames = [], playing = false, waiting = false, done = false;
  let recent = [], socInfo = new Map(), pops = [], sel = null, pending = [], applied = [], base = null, filter = 'all', sortKey = 'age', sortDir = -1, personId = null, timer = null;

  const dark = () => matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark';
  const nameOf = id => socInfo.get(id)?.name ?? '#' + id;
  const S = () => { const arr = []; socInfo.forEach((v, k) => { arr[k] = v; }); return arr; };
  const say = e => describe(e, S());

  function worker() {
    if (w) return w;
    w = new Worker('live.js', { type: 'module' });
    w.onerror = e => { stop(); waiting = false; status('The simulation could not start in this browser: ' + esc(e.message || 'worker failed to load') + '. Try reloading the page.', true); };
    w.onmessage = ev => {
      const m = ev.data;
      if (m.type === 'meta') {
        meta = m.meta; snap = m.snap; meta.societies.forEach(s => socInfo.set(s.id, { ...s, parent: null })); frames = []; pops = [];
        // year 0: draw the founding camps straight away
        const f0 = { y: 0, socs: snap.societies.filter(s => s.alive).map(s => ({ id: s.id, name: s.name, color: s.color, parent: s.parent, home: s.home, leader: s.leader, pop: s.pop, herds: s.herds, sedentary: s.sedentary, fed: s.fed })),
          fields: [], events: [], births: 0, deaths: 0, pops: snap.societies.map(s => s.pop) };
        frames = [f0]; pops[0] = f0.pops; view.fit = false; founders0 = f0.socs.map(x => x.home); drawMap(f0); drawChart(); setYear(0); showInspector(); renderHud(f0);
      }
      else if (m.type === 'frames') {
        waiting = false; m.frames.forEach(onFrame); done = m.done;
        if (m.stopped) {
          render();
          const y = frames.at(-1)?.y ?? 0;
          status(m.hit ? `<b>Stopped at year ${y}:</b> ${esc(m.hit)}` : `Ran ${m.stopped.years} year${m.stopped.years === 1 ? '' : 's'} to year ${y}${m.stopped.until !== 'none' ? ' — it never happened' : ''}.`, !!m.hit);
        }
        if (done) { stop(); finish(); }
      }
      else if (m.type === 'snapshot') { snap = m.snap; showInspector(); }
      else if (m.type === 'person') renderPerson(m.person);
      else if (m.type === 'intervened') { pending.push(m.rec); renderPending(); if (!base) w.postMessage({ type: 'baseline' }); }
      else if (m.type === 'baseline') { base = m.base; drawChart(); }
      else if (m.type === 'result') showResult(m.result, applied.length ? base : null);
      else if (m.type === 'error') { stop(); status('Error: ' + esc(m.message), true); console.error(m.message); }
    };
    return w;
  }

  let started = false;
  const ensure = () => { if (!started) start(); };
  function start() {
    started = true; stop(); waiting = false; done = false; base = null; pending = []; recent = []; applied = []; personId = null; socInfo = new Map(); sel = 0;
    $('#pEvents').innerHTML = ''; $('#pPending').innerHTML = ''; $('#pPerson').hidden = true; $('#pCompare').hidden = true; $('#pTicker').innerHTML = '';
    worker().postMessage({ type: 'init', cfg: getCfg() });
    status('Press Play. Tap a camp to look inside; drag and pinch to move about.');
  }

  function onFrame(f) {
    f.socs.forEach(s => { const o = socInfo.get(s.id) || {}; socInfo.set(s.id, { ...o, id: s.id, name: s.name, color: s.color, parent: s.parent, home: s.home }); });
    pops[f.y] = f.pops;
    frames.push(f); if (frames.length > 3) frames.shift();
    recent.push(...f.events); if (recent.length > 80) recent.splice(0, recent.length - 80);
    // interventions that were pending took effect as this year began
    const now = pending.filter(p => p.y <= f.y); if (now.length) { applied.push(...now); pending = pending.filter(p => p.y > f.y); renderPending(); }
  }

  function tick() {
    if (!playing || waiting || done) return;
    const per = SPEEDS[+$('#pSpeed').value] / 10;
    tick.acc = (tick.acc || 0) + per;
    const n = Math.floor(tick.acc); if (!n) return;
    tick.acc -= n; step(n, true);
  }
  function step(n, quiet) {
    ensure();
    if (waiting || done || !w) return;
    waiting = true; w.postMessage({ type: 'step', n });
    if (!quiet) w.postMessage({ type: 'snapshot' });
    requestAnimationFrame(render);
  }
  function runUntil() {
    ensure();
    if (waiting || done || !w) return;
    if (playing) play();
    const until = $('#pUntil').value, who = $('#pWho').value;
    waiting = true;
    status('Running…', true); $('#pUntilBox').hidden = true;
    w.postMessage({ type: 'runUntil', max: Math.max(1, Math.min(1000, +$('#pMax').value || 50)), until, soc: who === 'any' ? null : sel });
    requestAnimationFrame(render);
  }
  function render() {
    if (waiting) { requestAnimationFrame(render); return; }
    const f = frames[frames.length - 1]; if (!f) return;
    setYear(f.y); drawMap(f); renderHud(f); if (!$('#pDrawer').hidden && !document.querySelector('#pDrawer [data-pane=chart]:not(button)').hidden) drawChart();
    const evs = recent.slice().reverse();
    $('#pEvents').innerHTML = `<div class="muted pyline">Year ${f.y}: ${f.births} born, ${f.deaths} died</div>` + (evs.map(e => `<div class="ev"><span class="y">${e.y}</span><span>${say(e)}</span></div>`).join('') || '<div class="more">A quiet year.</div>');
  }
  function play() {
    ensure();
    if (done) return;
    playing = !playing; $('#pPlay').textContent = playing ? '❚❚ Pause' : '▶ Play';
    status(playing ? 'Running' : 'Paused — tap a camp to step in');
    $('#pInspect').classList.toggle('dim', playing);
    if (playing) { clearInterval(timer); timer = setInterval(() => { tick(); render(); }, 100); }
    else { clearInterval(timer); w.postMessage({ type: 'snapshot' }); }
  }
  function stop() { playing = false; clearInterval(timer); if ($('#pPlay')) $('#pPlay').textContent = '▶ Play'; $('#pInspect')?.classList.remove('dim'); }
  function finish() {
    render(); w.postMessage({ type: 'snapshot' });
    status(`The history is over at year ${frames.at(-1)?.y ?? 0}. <button id="pSeeAll" class="primary">See full results</button>`, true);
    $('#pSeeAll').onclick = () => { if (applied.length && !base) w.postMessage({ type: 'baseline' }); setTimeout(() => w.postMessage({ type: 'result' }), applied.length && !base ? 400 : 0); };
    if (applied.length) compare();
  }
  function setYear(y) { $('#pYear').textContent = 'Year ' + y; }

  // ---------- map ----------
  function drawMap(f) {
    const cv = $('#pMap'); if (!meta) return;
    const G = meta.grid, W = cv.clientWidth || innerWidth, H = cv.clientHeight || innerHeight, dpr = devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    if (!view.fit) fitView(W, H);
    const cell = view.base * view.z, ox = view.ox, oy = view.oy, px = W, z = view.z;
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = dark() ? 'rgb(32,50,66)' : 'rgb(170,200,226)'; c.fillRect(0, 0, W, H); // open sea beyond the map
    const dk = dark(), mix = (a, b, t) => a.map((x, k) => Math.round(x + (b[k] - x) * t));
    const rgb = (a, m = 1) => `rgb(${a.map(x => Math.round(x * m)).join(',')})`, shade = dk ? 0.45 : 1;
    const SAND = [232, 222, 192], WOOD = [96, 140, 82], SEA = [150, 190, 222], DEEP = [70, 125, 175], RIVER = [120, 170, 220], SOIL = [214, 206, 140];
    // terrain: sand to forest by how much food the land holds now; sea deeper where the fish are
    meta.map.forEach((v, i) => {
      const x = ox + (i % G) * cell, y = oy + Math.floor(i / G) * cell;
      if (x > W || y > H || x + cell < 0 || y + cell < 0) return;
      let col;
      if (v === 0) col = mix(SEA, DEEP, (meta.fish?.[i] || 0) / 9);
      else if (v === 3) col = RIVER;
      else { const r = (meta.rich?.[i] ?? 5) / 9 * ((f?.lush?.[i] ?? 9) / 9); col = v === 2 ? mix(SOIL, WOOD, r * 0.5) : mix(SAND, WOOD, r); }
      c.fillStyle = rgb(col, shade); c.fillRect(x, y, cell + 0.5, cell + 0.5);
      if (v !== 0 && v !== 3 && (meta.rich?.[i] ?? 0) * ((f?.lush?.[i] ?? 9) / 9) > 5.5) { // a few trees
        c.fillStyle = rgb([60, 100, 55], shade); c.beginPath(); c.arc(x + cell * 0.3, y + cell * 0.35, cell * 0.14, 0, 7); c.arc(x + cell * 0.68, y + cell * 0.62, cell * 0.12, 0, 7); c.fill();
      }
    });
    if (!f) return;
    const colorOf = id => socInfo.get(id)?.color || '#888';
    // fields: ploughed plots with furrows in the owner's colour
    (f.fields || []).forEach(([i, s]) => {
      const x = ox + (i % G) * cell + 1.5, y = oy + Math.floor(i / G) * cell + 1.5, w2 = cell - 3;
      c.fillStyle = rgb([176, 138, 84], shade); c.fillRect(x, y, w2, w2);
      c.strokeStyle = colorOf(s); c.lineWidth = Math.max(1, cell / 14); c.globalAlpha = 0.9;
      for (let k = 1; k < 4; k++) { c.beginPath(); c.moveTo(x + 1, y + w2 * k / 4); c.lineTo(x + w2 - 1, y + w2 * k / 4); c.stroke(); }
      c.globalAlpha = 1; c.lineWidth = 1.5; c.strokeRect(x, y, w2, w2);
    });
    const at = h => [ox + (h.x + 0.5) * cell, oy + (h.y + 0.5) * cell];
    hit = { f, at, cell };
    // links between peoples over the last few years, labelled; raids both ways get one double-headed arrow
    const homeOf = id => f.socs.find(s => s.id === id)?.home || socInfo.get(id)?.home;
    const links = new Map();
    const lastFrames = frames.slice(-4);
    lastFrames.forEach((fr, k) => fr.events.forEach(e => {
      if (!['raid', 'conquest', 'merger', 'fission', 'migrate', 'trade'].includes(e.t) || e.to == null) return;
      // from → to as the arrow should point
      const [from, to] = e.t === 'conquest' ? [e.to, e.soc] : [e.soc, e.to];
      const kind = e.t === 'raid' ? 'raid' : e.t, key = kind + ':' + Math.min(from, to) + ':' + Math.max(from, to);
      const L = links.get(key) || { kind, a: Math.min(from, to), b: Math.max(from, to), dirs: new Set(), k: 0, won: 0, lost: 0, dead: 0, taken: 0, n: 0 };
      L.dirs.add(from + '>' + to); L.k = Math.max(L.k, k); L.n += e.n || e.people || e.size || 0;
      if (e.t === 'raid') { if (e.win) L.won++; else L.lost++; L.dead += (e.dA || 0) + (e.dB || 0); L.taken += e.taken || 0; L.from = from; L.to = to; }
      else { L.from = from; L.to = to; }
      links.set(key, L);
    }));
    for (const L of links.values()) {
      const pa = homeOf(L.from), pb = homeOf(L.to); if (!pa || !pb) continue;
      const fade = 0.45 + 0.55 * (L.k + 1) / lastFrames.length, both = L.dirs.size > 1;
      let col, label, dash = [], wdt = 2.6;
      if (L.kind === 'raid') {
        col = `rgba(220,38,38,${fade})`;
        label = both ? '⚔ raiding each other' : `⚔ raid — ${L.won ? 'won' : 'beaten off'}`;
        const bits = []; if (L.dead) bits.push(`${L.dead} killed`); if (L.taken) bits.push(`${L.taken} taken`);
        if (bits.length) label += ', ' + bits.join(', ');
        if (!L.won && !both) dash = [6, 5];
      } else if (L.kind === 'conquest') { col = `rgba(127,29,29,${fade})`; label = '☠ conquered'; wdt = 4; }
      else if (L.kind === 'merger') { col = `rgba(120,113,108,${fade})`; label = 'merged into'; dash = [3, 3]; }
      else if (L.kind === 'fission') { col = `rgba(120,113,108,${fade})`; label = `split off${L.n ? ' (' + L.n + ')' : ''}`; dash = [3, 3]; wdt = 1.8; }
      else if (L.kind === 'migrate') { col = `rgba(120,113,108,${fade})`; label = `${L.n} moved`; dash = [3, 3]; wdt = 1.6; }
      else if (L.kind === 'trade') { col = `rgba(21,128,61,${fade})`; label = 'food sent'; wdt = 2; }
      arrow(c, at(pa), at(pb), col, dash, wdt, both);
      tag(c, at(pa), at(pb), label, col, dk);
    }
    // camps and villages
    f.socs.forEach(s => {
      const [x, y] = at(s.home), r = Math.max(7, Math.min(cell * 1.8, (4 + Math.sqrt(s.pop) * 1.3) * Math.sqrt(z)));
      const sick = frames.at(-1).events.some(e => e.t === 'epidemic' && e.soc === s.id);
      if (sick) { c.beginPath(); c.arc(x, y, r + 6, 0, 7); c.strokeStyle = '#7c3aed'; c.lineWidth = 3; c.stroke(); }
      const col = colorOf(s.id);
      // herds graze around the camp
      const nh = Math.min(28, Math.round(s.herds / 6));
      for (let k = 0; k < nh; k++) { const ang = k * 2.39996, d = r + (6 + (k % 4) * 3.5) * Math.sqrt(z); c.fillStyle = k % 3 ? (dk ? '#e7e5e4' : '#fafaf9') : '#78350f'; c.beginPath(); c.ellipse(x + Math.cos(ang) * d, y + Math.sin(ang) * d, 2.4 * Math.sqrt(z), 1.6 * Math.sqrt(z), 0, 0, 7); c.fill(); }
      // the ground the camp or village stands on
      c.beginPath(); c.arc(x, y, r + 2, 0, 7); c.fillStyle = col; c.globalAlpha = 0.28; c.fill(); c.globalAlpha = 1;
      c.lineWidth = s.id === sel ? 3 : 1.5; c.strokeStyle = s.id === sel ? (dk ? '#fff' : '#111') : col; c.stroke();
      // dwellings: one for every five or so people — tents in a camp, houses in a village
      const nd = Math.max(1, Math.min(24, Math.round(s.pop / 5)));
      for (let k = 0; k < nd; k++) {
        const ang = k * 2.39996, d = nd === 1 ? 0 : r * 0.72 * Math.sqrt((k + 0.5) / nd), hx = x + Math.cos(ang) * d, hy = y + Math.sin(ang) * d, sz = Math.max(3, Math.min(6 * Math.sqrt(z), cell * 0.22));
        c.fillStyle = col; c.strokeStyle = dk ? 'rgba(0,0,0,.6)' : 'rgba(0,0,0,.45)'; c.lineWidth = 0.8;
        if (s.sedentary) { c.fillRect(hx - sz * 0.6, hy - sz * 0.2, sz * 1.2, sz * 0.8); c.strokeRect(hx - sz * 0.6, hy - sz * 0.2, sz * 1.2, sz * 0.8); c.beginPath(); c.moveTo(hx - sz * 0.8, hy - sz * 0.2); c.lineTo(hx, hy - sz * 0.9); c.lineTo(hx + sz * 0.8, hy - sz * 0.2); c.closePath(); c.fillStyle = dk ? '#a8a29e' : '#78716c'; c.fill(); c.stroke(); }
        else { c.beginPath(); c.moveTo(hx - sz * 0.7, hy + sz * 0.5); c.lineTo(hx, hy - sz * 0.7); c.lineTo(hx + sz * 0.7, hy + sz * 0.5); c.closePath(); c.fill(); c.stroke(); }
      }
      if (s.fed < 0.85) { c.fillStyle = '#d97706'; c.beginPath(); c.arc(x + r * 0.8, y - r * 0.8, 3.5, 0, 7); c.fill(); }
      c.font = '600 11.5px system-ui, sans-serif'; c.textAlign = 'center'; c.lineWidth = 3; c.strokeStyle = dark() ? 'rgba(0,0,0,.75)' : 'rgba(255,255,255,.85)';
      const label = `${nameOf(s.id)} · ${s.pop}${s.herds ? ' · ' + s.herds + ' head' : ''}`;
      const tw = c.measureText(label).width / 2, lx = Math.max(tw + 3, Math.min(px - tw - 3, x)), ly = y - r - 5 < 12 ? y + r + 15 : y - r - 5;
      c.strokeText(label, lx, ly); c.fillStyle = dark() ? '#f5f5f4' : '#1c1917'; c.fillText(label, lx, ly);
    });
  }

  // ---------- moving about the map: drag to pan, pinch or wheel to zoom, tap a camp ----------
  const view = { z: 1, ox: 0, oy: 0, base: 10, fit: false };
  let founders0 = [];
  let hit = null;
  // the part of the screen not covered by the bars and the drawer
  function area(W, H) {
    const open = !$('#pDrawer').hidden, wide = W > 700, top = $('.hudtop').offsetHeight || 56;
    return { x0: 0, y0: top, w: W - (open && wide ? $('#pDrawer').offsetWidth : 0), h: H - top - (open && !wide ? $('#pDrawer').offsetHeight : 64) };
  }
  // fill the screen with the map (no empty margins), centred on where people live
  function fitView(W, H) {
    const G = meta.grid, a = area(W, H);
    view.base = Math.min(a.w, a.h) / G; view.z = 1; view.fit = true; // the whole world in view
    const hs = founders0; // where the founders started: fixed for the whole history, so the view never wanders by itself
    const cx = hs.length ? hs.reduce((t, h) => t + h.x, 0) / hs.length + 0.5 : G / 2, cy = hs.length ? hs.reduce((t, h) => t + h.y, 0) / hs.length + 0.5 : G / 2;
    centre(cx, cy, W, H);
  }
  function centre(cx, cy, W, H) {
    const G = meta.grid, a = area(W, H), cell = view.base * view.z;
    // centre on (cx, cy) but never leave an empty band when the map is bigger than the screen
    const fitX = G * cell <= a.w, fitY = G * cell <= a.h;
    view.ox = fitX ? a.x0 + (a.w - G * cell) / 2 : Math.min(a.x0, Math.max(a.x0 + a.w - G * cell, a.x0 + a.w / 2 - cx * cell));
    view.oy = fitY ? a.y0 + (a.h - G * cell) / 2 : Math.min(a.y0, Math.max(a.y0 + a.h - G * cell, a.y0 + a.h / 2 - cy * cell));
  }
  function focus(id) {
    const s = (frames.at(-1)?.socs || []).find(x => x.id === id), cv = $('#pMap'); if (!s) return;
    const a = area(cv.clientWidth, cv.clientHeight), cell = view.base * view.z, x = view.ox + (s.home.x + 0.5) * cell, y = view.oy + (s.home.y + 0.5) * cell;
    if (x < a.x0 + 30 || x > a.x0 + a.w - 30 || y < a.y0 + 30 || y > a.y0 + a.h - 30) centre(s.home.x + 0.5, s.home.y + 0.5, cv.clientWidth, cv.clientHeight);
    redraw();
  }
  function zoomAt(k, mx, my) {
    const nz = Math.max(0.6, Math.min(8, view.z * k)); k = nz / view.z;
    view.ox = mx - (mx - view.ox) * k; view.oy = my - (my - view.oy) * k; view.z = nz; redraw();
  }
  const redraw = () => drawMap(frames.at(-1) || null);
  function bindMap() {
    const cv = $('#pMap'), pts = new Map(); let moved = 0, pinch = 0;
    const rel = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, rel(e)); moved = 0; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } cv.classList.add('dragging'); });
    cv.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      const p0 = pts.get(e.pointerId), p1 = rel(e); pts.set(e.pointerId, p1);
      if (pts.size === 1) { view.ox += p1[0] - p0[0]; view.oy += p1[1] - p0[1]; moved += Math.abs(p1[0] - p0[0]) + Math.abs(p1[1] - p0[1]); redraw(); }
      else if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) zoomAt(d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); pinch = d; moved += 10; }
    });
    const up = e => {
      const p = pts.get(e.pointerId); pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; if (!pts.size) cv.classList.remove('dragging');
      if (p && moved < 6 && hit) { // a tap: pick the nearest camp
        let best = null, bd = 1e9; hit.f.socs.forEach(s => { const [x, y] = hit.at(s.home); const d = Math.hypot(x - p[0], y - p[1]); if (d < bd) { bd = d; best = s.id; } });
        if (best != null && bd < Math.max(28, hit.cell * 2)) { sel = best; if (snap) showInspector(); openDrawer('soc'); focus(best); }
      }
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { e.preventDefault(); const [mx, my] = rel(e); zoomAt(Math.exp(-e.deltaY * 0.0015), mx, my); }, { passive: false });
    $('#pZin').onclick = () => zoomAt(1.4, cv.clientWidth / 2, cv.clientHeight / 2);
    $('#pZout').onclick = () => zoomAt(1 / 1.4, cv.clientWidth / 2, cv.clientHeight / 2);
    $('#pFit').onclick = () => { view.fit = false; redraw(); };
  }

  // ---------- drawer, ticker, chips, status ----------
  function openDrawer(pane) {
    $('#pDrawer').hidden = false;
    if (pane) document.querySelectorAll('#pDrawer [data-pane]').forEach(el => { if (el.tagName === 'BUTTON') el.classList.toggle('on', el.dataset.pane === pane); else el.hidden = el.dataset.pane !== pane; });
    if (pane === 'chart') drawChart();
  }
  function closeDrawer() { $('#pDrawer').hidden = true; }
  let statusTimer = null;
  function status(html, stay) {
    const el = $('#pStatus'); el.innerHTML = html; el.classList.remove('fade'); clearTimeout(statusTimer);
    if (!stay) statusTimer = setTimeout(() => el.classList.add('fade'), 5000);
  }
  function renderHud(f) {
    $('#pTicker').innerHTML = recent.slice(-3).reverse().map(e => `<div><span class="y">${e.y}</span>${say(e)}</div>`).join('');
    $('#pChips').innerHTML = f.socs.map(s => `<button class="chipbtn ${s.id === sel ? 'on' : ''}" data-id="${s.id}" style="--c:${socInfo.get(s.id)?.color}"><i></i>${esc(nameOf(s.id))} <b>${s.pop}</b>${s.fed < 0.85 ? ' <span class="bad">hungry</span>' : ''}</button>`).join('');
    $('#pChips').querySelectorAll('button').forEach(b => b.onclick = () => { sel = +b.dataset.id; if (snap) showInspector(); openDrawer('soc'); focus(sel); });
  }
  function arrow(c, [x1, y1], [x2, y2], color, dash, wdt, both) {
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, gap = Math.min(22, L / 4);
    const sx = x1 + ux * gap, sy = y1 + uy * gap, ex = x2 - ux * gap, ey = y2 - uy * gap, hl = 7 + wdt * 2, hw = 4 + wdt * 1.4;
    const head = (px, py, vx, vy) => { c.beginPath(); c.moveTo(px, py); c.lineTo(px - vx * hl - vy * hw, py - vy * hl + vx * hw); c.lineTo(px - vx * hl + vy * hw, py - vy * hl - vx * hw); c.closePath(); c.fill(); };
    c.save(); c.strokeStyle = color; c.fillStyle = color; c.lineWidth = wdt; c.setLineDash(dash); c.lineCap = 'round';
    c.beginPath(); c.moveTo(sx + (both ? ux * hl : 0), sy + (both ? uy * hl : 0)); c.lineTo(ex - ux * hl * 0.8, ey - uy * hl * 0.8); c.stroke(); c.setLineDash([]);
    head(ex, ey, ux, uy); if (both) head(sx, sy, -ux, -uy);
    c.restore();
  }
  // a small label in a pill at the middle of a link
  function tag(c, [x1, y1], [x2, y2], text, color, dk) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    c.save(); c.font = '600 11.5px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const w = c.measureText(text).width + 12, h = 18;
    c.fillStyle = dk ? 'rgba(28,25,23,.9)' : 'rgba(255,255,255,.93)'; c.strokeStyle = color; c.lineWidth = 1.2;
    c.beginPath(); if (c.roundRect) c.roundRect(mx - w / 2, my - h / 2, w, h, 9); else c.rect(mx - w / 2, my - h / 2, w, h); c.fill(); c.stroke();
    c.fillStyle = dk ? '#fafaf9' : '#1c1917'; c.fillText(text, mx, my + 0.5); c.restore();
  }

  // ---------- population chart, with the untouched history dashed ----------
  const rootOf = id => { let x = socInfo.get(id), g = 0; while (x && x.parent != null && g++ < 50) x = socInfo.get(x.parent); return x?.id ?? id; };
  function drawChart() {
    if (!meta) return;
    const founders = meta.societies;
    const n = Math.max(pops.length, base ? base.years : 0, 1);
    const series = founders.map(fd => ({ name: fd.name, color: fd.color, values: Array.from({ length: pops.length }, (_, y) => pops[y] ? pops[y].reduce((t, v, id) => t + (rootOf(id) === fd.id ? v : 0), 0) : null) }));
    if (base && applied.length) {
      const bRoot = id => { let x = base.societies[id]; while (x && x.parent != null) x = base.societies[x.parent]; return x?.id ?? id; };
      founders.forEach(fd => series.push({ name: fd.name + ' (untouched)', color: fd.color, dash: '4 4', width: 1.2,
        values: Array.from({ length: Math.min(n, base.years) }, (_, y) => base.pop.reduce((t, arr, id) => t + (bRoot(id) === fd.id ? (arr[y] || 0) : 0), 0)) }));
    }
    lineChart($('#pChart'), { series, height: 170, markers: applied.map(a => ({ x: a.y, color: 'var(--accent)' })) });
    $('#pChartKey').innerHTML = founders.map(fd => `<span><i style="background:${fd.color}"></i>${esc(fd.name)}</span>`).join('') + (base && applied.length ? '<span class="muted">dashed: the history without your changes · ticks: your changes</span>' : '');
  }

  // ---------- inspector (when paused) ----------
  function showInspector() {
    if (!snap) return;
    const alive = snap.societies.filter(s => s.alive);
    if (sel == null || !snap.societies[sel]?.alive) sel = alive[0]?.id ?? 0;
    $('#pSocTabs').innerHTML = alive.map(s => `<button class="chipbtn ${s.id === sel ? 'on' : ''}" data-id="${s.id}" style="--c:${s.color}"><i></i>${esc(s.name)} <span class="muted">${s.pop}</span></button>`).join('');
    $('#pSocTabs').querySelectorAll('button').forEach(b => b.onclick = () => { sel = +b.dataset.id; showInspector(); drawMap(frames.at(-1)); });
    const s = snap.societies[sel]; if (!s) { $('#pSoc').innerHTML = '<p class="muted">Nobody is left.</p>'; return; }
    const others = alive.filter(o => o.id !== s.id);
    const L = snap.people.find(p => p.id === s.leader);
    $('#pSoc').innerHTML = `
      <div class="facts">
        <div><b>${s.pop}</b><span>people</span></div><div><b>${Math.round(s.fed * 100)}%</b><span>fed</span></div>
        <div><b>${s.stores}</b><span>years stored</span></div><div><b>${s.herds}</b><span>livestock</span></div>
        <div><b>${s.slaves}</b><span>slaves</span></div><div><b>${L ? '#' + L.id : '—'}</b><span>${L ? `leader, ${L.sex === 'F' ? 'woman' : 'man'} of ${L.age}` : 'no leader'}</span></div>
        <div><b>${s.sedentary ? 'village' : 'camp'}</b><span>${s.techs.length} techs</span></div>
      </div>
      <h3>Act</h3>
      <div class="acts">
        <button data-a="famine">Blight (3 bad harvests)</button>
        <button data-a="plague">Send a plague</button>
        <button data-a="gift">Gift a year of food</button>
        <button data-a="migrants">10 newcomers arrive</button>
        <button data-a="killLeader" ${L ? '' : 'disabled'}>Strike down the leader</button>
        <button data-a="freeSlaves" ${s.slaves ? '' : 'disabled'}>Free the slaves</button>
        ${others.length ? `<span class="actsel"><select id="pTo">${others.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select><button data-a="raid">Order a raid</button><button data-a="peace">Impose 20 years' peace</button></span>` : ''}
        <span class="actsel"><select id="pTech">${Object.entries(TECHS).filter(([k]) => !s.techs.includes(k)).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join('')}</select><button data-a="tech">Teach it</button></span>
      </div>
      <h3>Change the rules <label class="chk lockchk"><input type="checkbox" id="pLock" ${s.locked ? 'checked' : ''}> lock them so drift and imitation can't undo your changes</label></h3>
      <div class="genes">${GENE_KEYS.map(k => {
        const sp = GENES[k], v = s.genome[k];
        const input = sp.kind === 'enum' ? `<select data-g="${k}">${sp.values.map(x => `<option ${x === v ? 'selected' : ''}>${x}</option>`).join('')}</select>`
          : `<input data-g="${k}" type="number" min="${sp.min}" max="${sp.max}" step="${sp.step || (sp.max > 5 ? 10 : 0.05)}" value="${+(+v).toFixed(2)}">`;
        return `<label>${esc(sp.label)}${input}</label>`;
      }).join('')}</div>`;
    $('#pSoc').querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a, iv = { t: a, soc: s.id };
      if (a === 'raid' || a === 'peace') iv.to = +$('#pTo').value;
      if (a === 'tech') iv.tech = $('#pTech').value;
      if (a === 'famine') iv.years = 3;
      if (a === 'migrants') iv.n = 10;
      act(iv, b.textContent + (iv.to != null ? ' → ' + nameOf(iv.to) : '') + (iv.tech ? ': ' + TECHS[iv.tech].name : ''));
    });
    $('#pSoc').querySelectorAll('[data-g]').forEach(i => i.onchange = () => act({ t: 'gene', soc: s.id, gene: i.dataset.g, value: GENES[i.dataset.g].kind === 'dial' ? +i.value : i.value }, `${GENES[i.dataset.g].label} → ${i.value}`));
    $('#pLock').onchange = e => act({ t: 'lock', soc: s.id, on: e.target.checked }, e.target.checked ? 'Lock the rules' : 'Unlock the rules');
    renderPeople();
  }
  function act(iv, label) {
    if (done) return;
    if (playing) play();
    w.postMessage({ type: 'intervene', iv: { ...iv, label: `${nameOf(iv.soc)}: ${label}` } });
  }
  function renderPending() {
    const row = p => `<li><span class="y">${p.y}</span> ${esc(p.label || p.t)}</li>`;
    $('#pPending').innerHTML = (pending.length ? `<p class="hint">Takes effect as year ${pending[0].y} begins:</p><ul class="plist">${pending.map(row).join('')}</ul>` : '') +
      (applied.length ? `<p class="hint">Your changes so far:</p><ul class="plist">${applied.map(row).join('')}</ul>` : '');
  }

  // ---------- people ----------
  const FILTERS = { all: () => true, men: p => p.sex === 'M' && p.age >= 15, women: p => p.sex === 'F' && p.age >= 15, children: p => p.age < 15,
    warriors: p => p.warrior, slaves: p => p.status === 'slave', hungry: p => p.fed < 0.8, unmarried: p => p.age >= 18 && !p.spouses };
  const COLS = [['id', '#'], ['sex', ''], ['age', 'Age'], ['activity', 'Doing'], ['fed', 'Fed'], ['spouses', 'Spouses'], ['kids', 'Kids'], ['wealth', 'Wealth'], ['prestige', 'Prestige'], ['hunt', 'Hunt'], ['fight', 'Fight']];
  function renderPeople() {
    const s = snap.societies[sel]; if (!s) return;
    const ppl = snap.people.filter(p => p.soc === s.id);
    $('#pFilters').innerHTML = Object.keys(FILTERS).map(k => { const n = ppl.filter(FILTERS[k]).length; return `<button class="chipbtn ${k === filter ? 'on' : ''}" data-f="${k}">${k} <span class="muted">${n}</span></button>`; }).join('');
    $('#pFilters').querySelectorAll('button').forEach(b => b.onclick = () => { filter = b.dataset.f; renderPeople(); });
    const rows = ppl.filter(FILTERS[filter]).sort((a, b) => { const x = a[sortKey], y = b[sortKey]; return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });
    const shown = rows.slice(0, 300);
    $('#pPeople').innerHTML = `<table class="people"><thead><tr>${COLS.map(([k, l]) => `<th data-k="${k}" class="${['id', 'sex', 'activity'].includes(k) ? '' : 'num'}">${l}${k === sortKey ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}<th></th></tr></thead><tbody>` +
      shown.map(p => `<tr data-id="${p.id}" class="${p.id === personId ? 'on' : ''}"><td>${p.id}</td><td>${p.sex === 'F' ? '♀' : '♂'}</td><td class="num">${p.age}</td><td>${p.age < 5 ? '<span class="muted">infant</span>' : p.activity ? ACT[p.activity] || p.activity : '<span class="muted">—</span>'}</td>` +
        `<td class="num ${p.fed < 0.8 ? 'bad' : ''}">${Math.round(p.fed * 100)}%</td><td class="num">${p.spouses || ''}</td><td class="num">${p.kids || ''}</td><td class="num">${p.wealth.toFixed(2)}</td><td class="num">${p.prestige || ''}</td><td class="num">${p.hunt.toFixed(2)}</td><td class="num">${p.fight.toFixed(2)}</td>` +
        `<td>${p.leader ? '<span class="tag">leader</span>' : ''}${p.warrior ? '<span class="tag">warrior</span>' : ''}${p.status === 'slave' ? '<span class="tag bad">slave</span>' : ''}</td></tr>`).join('') +
      `</tbody></table>${rows.length > shown.length ? `<div class="more">…and ${rows.length - shown.length} more.</div>` : ''}`;
    $('#pPeople').querySelectorAll('th').forEach(th => th.onclick = () => { const k = th.dataset.k; if (!k) return; if (k === sortKey) sortDir *= -1; else { sortKey = k; sortDir = -1; } renderPeople(); });
    $('#pPeople').querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => openPerson(+tr.dataset.id));
  }
  function openPerson(id) { personId = id; w.postMessage({ type: 'person', id }); openDrawer('people'); }
  function renderPerson(p) {
    const box = $('#pPerson'); if (!p) { box.hidden = true; return; }
    box.hidden = false;
    const link = q => q ? `<a href="#" data-p="${q.id}">#${q.id}</a> <span class="muted">${q.sex === 'F' ? '♀' : '♂'} ${q.age}${q.alive ? '' : ', dead'}${q.soc !== p.soc ? ', ' + esc(nameOf(q.soc)) : ''}</span>` : '<span class="muted">unknown</span>';
    const canCrown = p.alive && !p.leader && p.age >= 16 && p.status !== 'slave';
    box.innerHTML = `<div class="phead"><h3>${p.sex === 'F' ? 'Woman' : 'Man'} #${p.id} <span class="muted">${esc(nameOf(p.soc))}</span></h3><button id="pClose" aria-label="Close">✕</button></div>
      <p>${p.alive ? `Aged ${p.age}` : `Died aged ${p.died - p.born} in year ${p.died}, of <b>${esc(p.cause)}</b>`}${p.status === 'slave' ? ', <b>a slave</b>' : ''}${p.leader ? ', <b>the leader</b>' : ''}${p.origin !== p.soc ? `, born in ${esc(nameOf(p.origin))}` : ''}.
        ${p.alive && p.age >= 5 ? `This year: ${p.activity ? ACT[p.activity] || p.activity : 'no work'}, ${Math.round(p.fed * 100)}% fed.` : ''}</p>
      <dl class="kin"><dt>Mother</dt><dd>${link(p.mother)}</dd><dt>Father</dt><dd>${link(p.father)}</dd>
        <dt>Spouses</dt><dd>${p.spouseList.map(link).join('<br>') || '<span class="muted">none</span>'}</dd>
        <dt>Children</dt><dd>${p.kidList.map(link).join('<br>') || '<span class="muted">none</span>'}</dd></dl>
      <p class="muted small">Skills: hunting ${p.hunt}, fighting ${p.fight} · wealth rank ${p.wealth} · prestige ${p.prestige} · savings ${p.savings}</p>
      ${canCrown ? `<button id="pCrown">Make ${p.sex === 'F' ? 'her' : 'him'} leader</button>` : ''}
      <h3>Life</h3><div class="log small">${p.life.map(e => `<div class="ev"><span class="y">${e.y}</span><span>${say(e)}</span></div>`).join('') || '<div class="more">Nothing recorded.</div>'}</div>`;
    box.querySelectorAll('[data-p]').forEach(a => a.onclick = ev => { ev.preventDefault(); openPerson(+a.dataset.p); });
    $('#pClose').onclick = () => { personId = null; box.hidden = true; renderPeople(); };
    if (canCrown) $('#pCrown').onclick = () => act({ t: 'crown', soc: p.soc, who: p.id }, `crown #${p.id}`);
    renderPeople();
  }

  // ---------- how your changes turned out ----------
  function compare() {
    if (!base) { w.postMessage({ type: 'baseline' }); setTimeout(compare, 300); return; }
    const f = frames.at(-1), lines = meta.societies;
    const now = id => (pops[f.y] || []).reduce((t, v, k) => t + (rootOf(k) === id ? v : 0), 0);
    const bRoot = id => { let x = base.societies[id]; while (x && x.parent != null) x = base.societies[x.parent]; return x?.id ?? id; };
    const was = id => base.pop.reduce((t, arr, k) => t + (bRoot(k) === id ? (arr[Math.min(f.y, base.years - 1)] || 0) : 0), 0);
    $('#pCompare').hidden = false; openDrawer('chart');
    $('#pCompareBody').innerHTML = `<table><thead><tr><th>Founding line</th><th class="num">With your changes</th><th class="num">Untouched</th></tr></thead><tbody>` +
      lines.map(l => { const a = now(l.id), b = was(l.id); return `<tr><td><span class="dot" style="background:${l.color}"></span>${esc(l.name)}</td><td class="num"><b>${a ? a + ' people' : 'gone'}</b></td><td class="num">${b ? b + ' people' : 'gone'}</td></tr>`; }).join('') + '</tbody></table>';
  }

  // ---------- wiring ----------
  $('#pStart').onclick = start;
  $('#pPlay').onclick = play;
  $('#pStep').onclick = () => step(1);
  $('#pStep10').onclick = () => step(10);
  $('#pRunUntil').onclick = runUntil;
  $('#pUntilBtn').onclick = () => { const b = $('#pUntilBox'); b.hidden = !b.hidden; $('#pUntilBtn').setAttribute('aria-expanded', String(!b.hidden)); };
  $('#pOpen').onclick = () => $('#pDrawer').hidden ? openDrawer() : closeDrawer();
  $('#pClose2').onclick = closeDrawer;
  $('#pTicker').onclick = () => openDrawer('log');
  document.querySelectorAll('#pDrawer .dtabs button').forEach(b => b.onclick = () => openDrawer(b.dataset.pane));
  $('#pExit').onclick = () => openDrawer('setup');
  $('#pStart2').onclick = () => { start(); closeDrawer(); };
  document.querySelectorAll('[data-goto]').forEach(a => a.onclick = ev => { ev.preventDefault(); if (playing) play(); ctx.goto(a.dataset.goto); });
  bindMap();
  $('#pSpeed').innerHTML = SPEEDS.map((s, i) => `<option value="${i}" ${i === 2 ? 'selected' : ''}>${s} yr/s</option>`).join('');
  let lastW = innerWidth;
  addEventListener('resize', () => { if (!meta) return; if (Math.abs(innerWidth - lastW) > 40) { lastW = innerWidth; view.fit = false; } redraw(); });
  return { start, ensure, show: () => { if (meta) requestAnimationFrame(redraw); } };
}
