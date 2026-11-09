// Play mode: run one history a year at a time, pause it, look at every person, and change things.
import { GENES, GENE_KEYS } from './src/genome.js';
import { TECHS } from './src/params.js';
import { lineChart } from './charts.js';

const $ = s => document.querySelector(s);
const TERRAIN = { light: ['#bcd3e6', '#e9e2cf', '#d7dfb4', '#8fb8de', '#e4dfae'], dark: ['#1d2b38', '#3a372d', '#3d4429', '#28465f', '#4a4630'] };
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
    w.onmessage = ev => {
      const m = ev.data;
      if (m.type === 'meta') { meta = m.meta; snap = m.snap; meta.societies.forEach(s => socInfo.set(s.id, { ...s, parent: null })); frames = []; pops = []; drawMap(null); setYear(0); showInspector(); }
      else if (m.type === 'frames') {
        waiting = false; m.frames.forEach(onFrame); done = m.done;
        if (m.stopped) {
          render();
          const y = frames.at(-1)?.y ?? 0;
          $('#pStatus').innerHTML = m.hit ? `<b>Stopped at year ${y}:</b> ${esc(m.hit)}. Look inside below, change what you like, and run on.`
            : `Ran ${m.stopped.years} year${m.stopped.years === 1 ? '' : 's'} to year ${y}${m.stopped.until !== 'none' ? ' — it never happened' : ''}.`;
        }
        if (done) { stop(); finish(); }
      }
      else if (m.type === 'snapshot') { snap = m.snap; showInspector(); }
      else if (m.type === 'person') renderPerson(m.person);
      else if (m.type === 'intervened') { pending.push(m.rec); renderPending(); if (!base) w.postMessage({ type: 'baseline' }); }
      else if (m.type === 'baseline') { base = m.base; drawChart(); }
      else if (m.type === 'result') showResult(m.result, applied.length ? base : null);
      else if (m.type === 'error') { stop(); $('#pStatus').textContent = 'Error: ' + m.message; console.error(m.message); }
    };
    return w;
  }

  function start() {
    stop(); done = false; base = null; pending = []; recent = []; applied = []; personId = null; socInfo = new Map(); sel = 0;
    $('#pEvents').innerHTML = ''; $('#pPending').innerHTML = ''; $('#pPerson').hidden = true; $('#pCompare').hidden = true;
    worker().postMessage({ type: 'init', cfg: getCfg() });
    $('#pPlayBox').hidden = false;
    $('#pStatus').textContent = 'Ready at year 0. Press Play, or step a year at a time. Pause at any moment to look inside and change things.';
  }

  function onFrame(f) {
    f.socs.forEach(s => { const o = socInfo.get(s.id) || {}; socInfo.set(s.id, { ...o, id: s.id, name: s.name, color: s.color, parent: s.parent }); });
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
    if (waiting || done || !w) return;
    waiting = true; w.postMessage({ type: 'step', n });
    if (!quiet) w.postMessage({ type: 'snapshot' });
    requestAnimationFrame(render);
  }
  function runUntil() {
    if (waiting || done || !w) return;
    if (playing) play();
    const until = $('#pUntil').value, who = $('#pWho').value;
    waiting = true;
    $('#pStatus').textContent = 'Running…';
    w.postMessage({ type: 'runUntil', max: Math.max(1, Math.min(1000, +$('#pMax').value || 50)), until, soc: who === 'any' ? null : sel });
    requestAnimationFrame(render);
  }
  function render() {
    if (waiting) { requestAnimationFrame(render); return; }
    const f = frames[frames.length - 1]; if (!f) return;
    setYear(f.y); drawMap(f); drawChart();
    const evs = recent.slice().reverse();
    $('#pEvents').innerHTML = `<div class="muted pyline">Year ${f.y}: ${f.births} born, ${f.deaths} died</div>` + (evs.map(e => `<div class="ev"><span class="y">${e.y}</span><span>${say(e)}</span></div>`).join('') || '<div class="more">A quiet year.</div>');
  }
  function play() {
    if (done) return;
    playing = !playing; $('#pPlay').textContent = playing ? '❚❚ Pause' : '▶ Play';
    $('#pStatus').textContent = playing ? 'Running. Pause to look inside and step in.' : 'Paused. Look inside below, change what you like, then play on.';
    $('#pInspect').classList.toggle('dim', playing);
    if (playing) { clearInterval(timer); timer = setInterval(() => { tick(); render(); }, 100); }
    else { clearInterval(timer); w.postMessage({ type: 'snapshot' }); }
  }
  function stop() { playing = false; clearInterval(timer); if ($('#pPlay')) $('#pPlay').textContent = '▶ Play'; $('#pInspect')?.classList.remove('dim'); }
  function finish() {
    render(); w.postMessage({ type: 'snapshot' });
    $('#pStatus').innerHTML = `The history is over at year ${frames.at(-1)?.y ?? 0}. <button id="pSeeAll" class="primary">See full results</button>`;
    $('#pSeeAll').onclick = () => { if (applied.length && !base) w.postMessage({ type: 'baseline' }); setTimeout(() => w.postMessage({ type: 'result' }), applied.length && !base ? 400 : 0); };
    if (applied.length) compare();
  }
  function setYear(y) { $('#pYear').textContent = 'Year ' + y; }

  // ---------- map ----------
  function drawMap(f) {
    const cv = $('#pMap'); if (!meta) return;
    const G = meta.grid, box = cv.parentElement.clientWidth, px = Math.min(560, box), cell = px / G, dpr = devicePixelRatio || 1;
    cv.width = px * dpr; cv.height = px * dpr; cv.style.width = px + 'px'; cv.style.height = px + 'px';
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const T = dark() ? TERRAIN.dark : TERRAIN.light;
    meta.map.forEach((v, i) => { c.fillStyle = T[v] || T[1]; c.fillRect((i % G) * cell, Math.floor(i / G) * cell, cell + 0.5, cell + 0.5); });
    if (!f) return;
    const colorOf = id => socInfo.get(id)?.color || '#888';
    // fields
    c.globalAlpha = 0.45; f.fields.forEach(([i, s]) => { c.fillStyle = colorOf(s); c.fillRect((i % G) * cell + 1, Math.floor(i / G) * cell + 1, cell - 2, cell - 2); }); c.globalAlpha = 1;
    const at = h => [(h.x + 0.5) * cell, (h.y + 0.5) * cell];
    const homeOf = new Map(f.socs.map(s => [s.id, s.home]));
    // raids and other links this year
    const lastFrames = frames.slice(-3);
    lastFrames.forEach((fr, k) => fr.events.forEach(e => {
      const a = homeOf.get(e.soc), b = homeOf.get(e.to);
      if (!a || !b) return;
      const fade = 0.35 + 0.65 * (k + 1) / lastFrames.length;
      if (e.t === 'raid') arrow(c, at(a), at(b), e.win ? `rgba(220,38,38,${fade})` : `rgba(220,38,38,${fade * 0.6})`, e.win ? [] : [4, 4], 2.2);
      else if (e.t === 'fission' || e.t === 'migrate') arrow(c, at(a), at(b), `rgba(120,113,108,${fade})`, [2, 3], 1.4);
      else if (e.t === 'conquest') arrow(c, at(b), at(a), `rgba(127,29,29,${fade})`, [], 3.5);
    }));
    // camps and villages
    f.socs.forEach(s => {
      const [x, y] = at(s.home), r = Math.max(4, Math.min(cell * 1.6, 2.2 + Math.sqrt(s.pop) * 1.1));
      const sick = frames.at(-1).events.some(e => e.t === 'epidemic' && e.soc === s.id);
      if (sick) { c.beginPath(); c.arc(x, y, r + 6, 0, 7); c.strokeStyle = '#7c3aed'; c.lineWidth = 3; c.stroke(); }
      c.beginPath();
      if (s.sedentary) c.rect(x - r, y - r, 2 * r, 2 * r); else c.arc(x, y, r, 0, 7);
      c.fillStyle = colorOf(s.id); c.fill();
      c.lineWidth = s.id === sel ? 3 : 1.2; c.strokeStyle = s.id === sel ? (dark() ? '#fff' : '#111') : 'rgba(0,0,0,.35)'; c.stroke();
      if (s.fed < 0.85) { c.fillStyle = '#d97706'; c.beginPath(); c.arc(x + r * 0.8, y - r * 0.8, 3.5, 0, 7); c.fill(); }
      c.font = '600 11.5px system-ui, sans-serif'; c.textAlign = 'center'; c.lineWidth = 3; c.strokeStyle = dark() ? 'rgba(0,0,0,.75)' : 'rgba(255,255,255,.85)';
      const label = `${nameOf(s.id)} · ${s.pop}${s.herds ? ' · ' + s.herds + '🐄' : ''}`;
      c.strokeText(label, x, y - r - 5); c.fillStyle = dark() ? '#f5f5f4' : '#1c1917'; c.fillText(label, x, y - r - 5);
    });
    cv.onclick = ev => {
      const rect = cv.getBoundingClientRect(), mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      let best = null, bd = 1e9; f.socs.forEach(s => { const [x, y] = at(s.home); const d = Math.hypot(x - mx, y - my); if (d < bd) { bd = d; best = s.id; } });
      if (best != null && bd < cell * 3) { sel = best; drawMap(f); showInspector(); }
    };
  }
  function arrow(c, [x1, y1], [x2, y2], color, dash, wdt) {
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    const sx = x1 + ux * 10, sy = y1 + uy * 10, ex = x2 - ux * 12, ey = y2 - uy * 12;
    c.save(); c.strokeStyle = color; c.fillStyle = color; c.lineWidth = wdt; c.setLineDash(dash);
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.stroke(); c.setLineDash([]);
    c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex - ux * 8 - uy * 5, ey - uy * 8 + ux * 5); c.lineTo(ex - ux * 8 + uy * 5, ey - uy * 8 - ux * 5); c.closePath(); c.fill(); c.restore();
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
  function openPerson(id) { personId = id; w.postMessage({ type: 'person', id }); }
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
    $('#pCompare').hidden = false;
    $('#pCompareBody').innerHTML = `<table><thead><tr><th>Founding line</th><th class="num">With your changes</th><th class="num">Untouched</th></tr></thead><tbody>` +
      lines.map(l => { const a = now(l.id), b = was(l.id); return `<tr><td><span class="dot" style="background:${l.color}"></span>${esc(l.name)}</td><td class="num"><b>${a ? a + ' people' : 'gone'}</b></td><td class="num">${b ? b + ' people' : 'gone'}</td></tr>`; }).join('') + '</tbody></table>';
  }

  // ---------- wiring ----------
  $('#pStart').onclick = start;
  $('#pPlay').onclick = play;
  $('#pStep').onclick = () => step(1);
  $('#pStep10').onclick = () => step(10);
  $('#pRunUntil').onclick = runUntil;
  $('#pSpeed').innerHTML = SPEEDS.map((s, i) => `<option value="${i}" ${i === 2 ? 'selected' : ''}>${s} yr/s</option>`).join('');
  addEventListener('resize', () => { if (meta) { drawMap(frames.at(-1)); drawChart(); } });
  return { start };
}
