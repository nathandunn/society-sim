// Small dependency-free SVG charts: multi-line with hover + click, and stacked bars.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };

function niceTicks(lo, hi, n = 4) {
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(s => s >= raw) || raw;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
const fmt = v => Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : (Math.abs(v) < 1 && v !== 0 ? v.toFixed(2) : String(+v.toFixed(1)));

export function lineChart(host, { series, yMin, yMax, yFormat = fmt, onPick, pick = null, height = 180, markers = [] }) {
  host.innerHTML = '';
  const W = Math.max(300, host.clientWidth || 600), H = height, m = { l: 40, r: 12, t: 10, b: 22 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'chart' }, host);
  const n = Math.max(...series.map(s => s.values.length), 1);
  const all = series.flatMap(s => s.values.filter(v => v != null));
  const lo = yMin ?? Math.min(0, ...all), hi = yMax ?? Math.max(1, ...all);
  const X = i => m.l + (i / Math.max(1, n - 1)) * (W - m.l - m.r);
  const Y = v => H - m.b - ((v - lo) / (hi - lo || 1)) * (H - m.t - m.b);
  const ticks = niceTicks(lo, hi);
  ticks.forEach(t => { el('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: 'grid' }, svg); const tx = el('text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end', class: 'tick' }, svg); tx.textContent = yFormat(t); });
  niceTicks(0, n - 1, 5).forEach(t => { const tx = el('text', { x: X(t), y: H - 6, 'text-anchor': 'middle', class: 'tick' }, svg); tx.textContent = t; });
  markers.forEach(mk => { el('line', { x1: X(mk.x), x2: X(mk.x), y1: m.t, y2: H - m.b, class: 'marker', stroke: mk.color || 'currentColor' }, svg); });
  for (const s of series) {
    let d = '', pen = false;
    s.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; });
    el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 1.6, 'stroke-dasharray': s.dash || '', 'stroke-linejoin': 'round' }, svg);
  }
  const cursor = el('line', { x1: 0, x2: 0, y1: m.t, y2: H - m.b, class: 'cursor', visibility: pick == null ? 'hidden' : 'visible' }, svg);
  if (pick != null) { cursor.setAttribute('x1', X(pick)); cursor.setAttribute('x2', X(pick)); }
  const tip = document.createElement('div'); tip.className = 'tip'; host.appendChild(tip);
  const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
  const toI = (ev) => { const r = svg.getBoundingClientRect(); const px = (ev.clientX - r.left) * (W / r.width); return Math.round(((px - m.l) / (W - m.l - m.r)) * (n - 1)); };
  hit.addEventListener('pointermove', ev => {
    const i = Math.max(0, Math.min(n - 1, toI(ev)));
    cursor.setAttribute('x1', X(i)); cursor.setAttribute('x2', X(i)); cursor.setAttribute('visibility', 'visible');
    tip.innerHTML = `<b>Year ${i}</b>` + series.filter(s => s.values[i] != null).map(s => `<div><i style="background:${s.color}"></i>${s.name}: ${yFormat(s.values[i])}</div>`).join('');
    tip.style.display = 'block';
    const r = svg.getBoundingClientRect(); const left = (X(i) / W) * r.width;
    tip.style.left = Math.min(left + 10, r.width - 170) + 'px';
  });
  hit.addEventListener('pointerleave', () => { tip.style.display = 'none'; if (pick == null) cursor.setAttribute('visibility', 'hidden'); else { cursor.setAttribute('x1', X(pick)); cursor.setAttribute('x2', X(pick)); } });
  if (onPick) hit.addEventListener('click', ev => onPick(Math.max(0, Math.min(n - 1, toI(ev)))));
}

export function stackedBars(host, { labels, stacks, height = 190, onPick, onLegend, activeKey = null }) {
  host.innerHTML = '';
  const W = Math.max(300, host.clientWidth || 600), H = height, m = { l: 40, r: 12, t: 10, b: 22 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'chart' }, host);
  const n = labels.length;
  const totals = labels.map((_, i) => stacks.reduce((t, s) => t + (s.values[i] || 0), 0));
  const hi = Math.max(1, ...totals);
  const bw = (W - m.l - m.r) / n;
  const Y = v => H - m.b - (v / hi) * (H - m.t - m.b);
  niceTicks(0, hi).forEach(t => { el('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: 'grid' }, svg); const tx = el('text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end', class: 'tick' }, svg); tx.textContent = fmt(t); });
  const tip = document.createElement('div'); tip.className = 'tip'; host.appendChild(tip);
  labels.forEach((lab, i) => {
    let acc = 0;
    const g = el('g', {}, svg);
    for (const s of stacks) {
      const v = s.values[i] || 0; if (!v) continue;
      el('rect', { x: m.l + i * bw + 1, y: Y(acc + v), width: Math.max(1, bw - 2), height: Y(acc) - Y(acc + v), fill: s.color, opacity: activeKey && activeKey !== s.key ? 0.25 : 1 }, g);
      acc += v;
    }
    if (i % Math.ceil(n / 10) === 0) { const tx = el('text', { x: m.l + i * bw + bw / 2, y: H - 6, 'text-anchor': 'middle', class: 'tick' }, svg); tx.textContent = lab; }
    const hit = el('rect', { x: m.l + i * bw, y: m.t, width: bw, height: H - m.t - m.b, fill: 'transparent' }, svg);
    hit.addEventListener('pointerenter', () => {
      tip.innerHTML = `<b>${lab}</b> · ${totals[i]} deaths` + stacks.filter(s => s.values[i]).map(s => `<div><i style="background:${s.color}"></i>${s.name}: ${s.values[i]}</div>`).join('');
      tip.style.display = 'block';
      const r = svg.getBoundingClientRect(); tip.style.left = Math.min(((m.l + i * bw) / W) * r.width + 10, r.width - 170) + 'px';
    });
    hit.addEventListener('pointerleave', () => tip.style.display = 'none');
    if (onPick) hit.addEventListener('click', () => onPick(i));
  });
  const leg = document.createElement('div'); leg.className = 'legend';
  stacks.forEach(s => { const b = document.createElement('button'); b.className = 'chip' + (activeKey === s.key ? ' on' : ''); b.innerHTML = `<i style="background:${s.color}"></i>${s.name}`; if (onLegend) b.onclick = () => onLegend(s.key); leg.appendChild(b); });
  host.appendChild(leg);
}
