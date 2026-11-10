import { GENES, GENE_KEYS, PRESETS, withDefaults } from './src/genome.js';
import { TECHS, DOMAINS, PARAM_UI, DEFAULT_PARAMS, getPath, tuningToParams } from './src/params.js';
import { ENV_PARAMS } from './src/world.js';
import { deepMerge } from './src/engine.js';
import { ENVIRONMENTS } from './src/world.js';
import { BUILD } from './version.js';
import { lineChart, stackedBars } from './charts.js';
import { initPlay } from './play.js';

const $ = s => document.querySelector(s);
const COLORS = ['#c2410c', '#1d4ed8', '#15803d', '#a21caf', '#b45309', '#0e7490'];
const CAUSE_GROUPS = [
  { key: 'illness', name: 'Illness', color: '#64748b', causes: ['infant illness', 'infection', 'other illness'] },
  { key: 'epidemic', name: 'Epidemic', color: '#7c3aed', causes: ['epidemic'] },
  { key: 'starvation', name: 'Starvation', color: '#d97706', causes: ['starvation'] },
  { key: 'violence', name: 'Raids & violence', color: '#dc2626', causes: ['raid', 'mate fight', 'punishment', 'succession', 'revolt', 'killed captive', 'feud', 'intervention'] },
  { key: 'birth', name: 'Childbirth & infanticide', color: '#db2777', causes: ['childbirth', 'infanticide'] },
  { key: 'accident', name: 'Accident', color: '#0891b2', causes: ['accident'] },
  { key: 'old', name: 'Old age', color: '#a8a29e', causes: ['old age'] },
];
const GENE_HELP = {
  marriage: 'Who may pair and how many partners', mateChoice: 'Who picks the match', descent: 'Lineage that pools food and inherits',
  residence: 'Who moves at marriage; whose grandmother helps', labour: 'Who forages, hunts, fishes and fights', sharing: 'How food is pooled',
  foraging: 'Where a camp may forage', trade: 'Trade with neighbours', governance: 'Who decides raids and takes surplus',
  enforcement: 'How free-riders are handled', outgroup: 'Attitude to the other society', captives: 'Fate of people taken in raids',
  famine: 'Who goes without in famine', property: 'Who may work fields and tend herds, and who inherits them', fission: 'Camp size that triggers a split', ritual: 'Cohesion bought with food',
};

// ---------- state ----------
const presetNames = Object.keys(PRESETS);
const socs = [
  { name: 'Egalitarian matriarchy', preset: 'Egalitarian matriarchy', genome: { ...PRESETS['Egalitarian matriarchy'] } },
  { name: 'Patriarchal harem', preset: 'Patriarchal harem', genome: { ...PRESETS['Patriarchal harem'] } },
];
let worker = null, result = null, pickYear = null, causeFilter = null, chartSoc = 'all';
let tune = {};   // {param path: value in display units}

function loadState() {
  try {
    const q = new URLSearchParams(location.hash.slice(1));
    if (q.get('s')) { const st = JSON.parse(decodeURIComponent(atob(q.get('s')))); st.socs.forEach((s, i) => { socs[i] = s; if (!s.genome.property) s.genome.property = (PRESETS[s.preset] || {}).property || 'lineage'; s.genome = withDefaults(s.genome); }); $('#seed').value = st.seed; $('#years').value = st.years; if (st.env && ENVIRONMENTS[st.env]) $('#env').value = st.env; if (st.tune && typeof st.tune === 'object') tune = st.tune; }
  } catch { /* ignore a bad hash */ }
}
function saveState() {
  const st = { socs, seed: +$('#seed').value, years: +$('#years').value, env: $('#env').value, tune };
  try { history.replaceState(null, '', '#s=' + btoa(encodeURIComponent(JSON.stringify(st)))); } catch { }
}

// ---------- baseline tuning ----------
const worldDefaults = () => deepMerge(DEFAULT_PARAMS, ENV_PARAMS[$('#env').value] || {});
const decimals = step => (String(step).split('.')[1] || '').length;
function renderTune() {
  const D = worldDefaults();
  const groups = [...new Set(PARAM_UI.map(p => p.group))];
  $('#tuneBody').innerHTML = groups.map(g => `<fieldset><legend>${g}</legend>` + PARAM_UI.filter(p => p.group === g).map(p => {
    const def = +(getPath(D, p.path) / (p.scale || 1)).toFixed(decimals(p.step));
    const has = tune[p.path] !== undefined;
    const id = 'tune-' + p.path.replace(/\./g, '-');
    return `<label class="tunerow${has ? ' changed' : ''}" for="${id}"><span><b>${esc(p.label)}</b>${p.unit ? ` (${esc(p.unit)})` : ''}<small>default ${def}</small></span>
      <input id="${id}" data-path="${p.path}" type="number" min="${p.min}" max="${p.max}" step="${p.step}" value="${has ? tune[p.path] : def}"></label>`;
  }).join('') + '</fieldset>').join('');
  $('#tuneBody').querySelectorAll('input').forEach(inp => inp.onchange = () => {
    const spec = PARAM_UI.find(p => p.path === inp.dataset.path);
    const def = +(getPath(worldDefaults(), spec.path) / (spec.scale || 1)).toFixed(decimals(spec.step));
    let v = +inp.value;
    if (!Number.isFinite(v)) v = def;
    v = Math.min(spec.max, Math.max(spec.min, v));
    if (Math.abs(v - def) < spec.step / 2) delete tune[spec.path]; else tune[spec.path] = v;
    saveState(); renderTune();
  });
  const n = Object.keys(tune).length;
  $('#tuneCount').textContent = n ? `· ${n} changed` : '· all defaults';
}
$('#tuneReset').onclick = () => { tune = {}; saveState(); renderTune(); };

// ---------- setup ----------
function renderSetup() {
  const host = $('#socs'); host.innerHTML = '';
  socs.forEach((s, i) => {
    const d = document.createElement('div'); d.className = 'soc'; d.style.setProperty('--c', COLORS[i]);
    const preset = PRESETS[s.preset] || {};
    d.innerHTML = `<div class="row"><input type="text" value="${esc(s.name)}" aria-label="Name">
      <select aria-label="Preset">${presetNames.map(n => `<option ${n === s.preset ? 'selected' : ''}>${n}</option>`).join('')}<option value="__custom" ${s.preset === '__custom' ? 'selected' : ''}>Custom</option></select></div>
      <div class="gist">${gist(s.genome)}</div>
      <details><summary>Edit rules (${GENE_KEYS.filter(k => preset[k] !== undefined && preset[k] !== s.genome[k]).length} changed)</summary><div class="genes"></div></details>`;
    const [name, sel] = [d.querySelector('input'), d.querySelector('select')];
    name.oninput = () => { s.name = name.value || `Society ${'AB'[i]}`; saveState(); };
    sel.onchange = () => {
      if (sel.value !== '__custom') { s.preset = sel.value; s.genome = { ...PRESETS[sel.value] }; s.name = sel.value; }
      else s.preset = '__custom';
      renderSetup(); saveState();
    };
    const genes = d.querySelector('.genes');
    for (const k of GENE_KEYS) {
      const spec = GENES[k];
      const lab = document.createElement('label');
      lab.title = GENE_HELP[k];
      if (preset[k] !== undefined && preset[k] !== s.genome[k]) lab.className = 'changed';
      lab.append(spec.label);
      let inp;
      if (spec.kind === 'enum') {
        inp = document.createElement('select');
        spec.values.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; if (v === s.genome[k]) o.selected = true; inp.appendChild(o); });
        inp.onchange = () => { s.genome[k] = inp.value; afterEdit(); };
      } else {
        inp = document.createElement('input'); inp.type = 'number'; inp.min = spec.min; inp.max = spec.max; inp.step = spec.step; inp.value = s.genome[k];
        inp.onchange = () => { s.genome[k] = Math.max(spec.min, Math.min(spec.max, +inp.value)); afterEdit(); };
      }
      lab.appendChild(inp); genes.appendChild(lab);
    }
    function afterEdit() { const open = d.querySelector('details').open; renderSetup(); host.children[i].querySelector('details').open = open; saveState(); }
    host.appendChild(d);
  });
  $('#go').textContent = `Run ${$('#years').value} years`;
}
const gist = g => `${g.marriage}${g.marriagePayment && g.marriagePayment !== 'none' ? ' (' + g.marriagePayment + ')' : ''}, ${g.descent}, ${g.residence} · ${g.governance}${g.ageSets === 'warriors' ? ' + age sets' : ''} · shares by ${g.sharing}, property ${g.property}, status by ${g.prestige || 'hoard'} · ${g.outgroup} to outsiders, captives: ${g.captives}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- worker ----------
function getWorker() {
  if (worker) return worker;
  worker = new Worker('worker.js', { type: 'module' });
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'run') { result = m.result; pickYear = null; causeFilter = null; renderResult(); }
    else if (m.type === 'progress') { $('#sBar').style.width = (100 * m.done / m.total) + '%'; $('#sStatus').textContent = `${m.done} / ${m.total} runs`; }
    else if (m.type === 'pair') { sweepResults.push(m.result); renderSweep(); }
    else if (m.type === 'sweepDone') { $('#sStatus').textContent = `Done: ${sweepResults.length} pairings`; $('#sGo').disabled = false; }
    else if (m.type === 'error') { $('#runstatus').textContent = 'Error: ' + m.message; $('#sStatus').textContent = 'Error'; $('#sGo').disabled = false; $('#go').disabled = false; console.error(m.message); }
  };
  return worker;
}
const runCfg = () => ({ genomes: socs.map(s => ({ ...s.genome })), names: socs.map(s => s.name), seed: +$('#seed').value || 1,
  params: { ...tuningToParams(tune), years: +$('#years').value || 500, freezeGenomes: $('#freeze').checked, env: $('#env').value } });
function run() {
  saveState();
  $('#runstatus').textContent = 'Simulating…'; $('#go').disabled = true;
  getWorker().postMessage({ type: 'run', cfg: runCfg() });
}

// ---------- results ----------
function renderResult() {
  $('#go').disabled = false;
  const r = result;
  const S = r.summary;
  const alive = S.filter(s => s.alive);
  $('#runstatus').innerHTML = `${esc(r.envName)} · model v${r.version} · seed ${r.seed} · ${r.years} years · ${r.events.length.toLocaleString()} events · simulated in ${r.ms} ms. ` +
    (alive.length ? `${alive.length} societ${alive.length > 1 ? 'ies' : 'y'} alive at the end, ${alive.reduce((t, s) => t + s.finalPop, 0)} people.` : 'The island is empty.');
  // outcome cards: founders and living bands; ended daughter bands go in a compact table
  const featured = S.filter(s => s.parent === null || s.parent === undefined || s.alive);
  const ended = S.filter(s => !featured.includes(s));
  $('#outcome').innerHTML = featured.map(s => {
    const parent = s.parent !== null && s.parent !== undefined ? S[s.parent].name : null;
    const verdict = s.alive ? `<span class="verdict alive">Alive at year ${r.years}</span>` : `<span class="verdict dead">Ended year ${s.ended}: ${esc(s.endReason)}</span>`;
    return `<div class="card" style="--c:${s.color}"><h3>${esc(s.name)}</h3>
      <div>${verdict}</div>${parent ? `<div class="muted" style="font-size:13px">split from ${esc(parent)} in year ${s.founded}</div>` : ''}
      <dl class="kv"><dt>Final / peak pop.</dt><dd>${s.finalPop} / ${s.peakPop}</dd>
      <dt>Island share</dt><dd>${pct(s.islandShare)}</dd>
      ${s.ancestryShare !== null ? `<dt>Ancestry share</dt><dd title="Share of everyone alive at the end descended from this founder group">${pct(s.ancestryShare)}</dd>` : ''}
      <dt>War, of adult ♂ deaths</dt><dd>${pct(s.warShareMaleDeaths)}</dd>
      <dt>Rule changes</dt><dd>${s.geneChanges}</dd>
      ${s.alive ? `<dt>Food, last 50 yrs</dt><dd>${mixText(s.foodMix)}</dd>` : ''}
      ${s.herdsEnd ? `<dt>Herds</dt><dd>${s.herdsEnd} livestock units</dd>` : ''}${s.fieldsEnd ? `<dt>Fields</dt><dd>${s.fieldsEnd}</dd>` : ''}</dl>
      <div class="techs">${s.techs.map(t => `<span>${TECHS[t].name}</span>`).join('') || '<span class="muted">no technologies</span>'}</div></div>`;
  }).join('') + (ended.length ? `<details class="card" style="--c:var(--line);grid-column:1/-1"><summary><b>${ended.length} daughter bands</b> split off and later ended</summary><div class="tablewrap"><table><thead><tr><th>Band</th><th>Split from</th><th class="num">Founded</th><th class="num">Ended</th><th>How</th><th class="num">Peak</th></tr></thead><tbody>` +
    ended.map(s => `<tr><td><span class="dot" style="background:${s.color}"></span>${esc(s.name)}</td><td>${esc(S[s.parent].name)}</td><td class="num">${s.founded}</td><td class="num">${s.ended}</td><td>${esc(s.endReason)}</td><td class="num">${s.peakPop}</td></tr>`).join('') + '</tbody></table></div></details>' : '');
  renderCharts();
  renderDigest();
  renderFilters();
  renderLog();
  renderGenes();
  renderDisease();
}
const pct = x => x == null ? '–' : Math.round(x * 100) + '%';
const FOOD = { plant: ['Gathering', '#65a30d'], hunt: ['Hunting', '#b45309'], fish: ['Fishing', '#0284c7'], farm: ['Farming', '#ca8a04'], herd: ['Herding', '#9f1239'] };
const mixText = m => Object.entries(m || {}).filter(([, v]) => v >= 0.05).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${FOOD[k][0].toLowerCase()} ${pct(v)}`).join(', ') || '–';

function chartBox(title, hint, withPick = false) {
  const b = document.createElement('div'); b.className = 'chartbox';
  b.innerHTML = `<h3>${title}</h3><p class="hint">${hint}</p>${withPick ? '<select class="socpick"></select>' : ''}<div class="host"></div>`;
  $('#charts').appendChild(b);
  if (withPick) {
    const sel = b.querySelector('.socpick');
    sel.innerHTML = `<option value="all">All societies</option>` + result.societies.map(s => `<option value="${s.id}" ${String(s.id) === String(chartSoc) ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    sel.onchange = () => { chartSoc = sel.value; renderCharts(); };
  }
  return b.querySelector('.host');
}
function renderCharts() {
  const r = result; $('#charts').innerHTML = '';
  // lay out every box first, then draw, so each chart measures its final width
  const queue = [];
  const draw = (fn, host, opts) => queue.push(() => fn(host, opts));
  const socs = r.societies;
  // charts follow founding lines (a founder plus all its daughter bands); cards and the log keep every band
  const rootOf = id => { let x = socs[id]; while (x.parent !== null && x.parent !== undefined) x = socs[x.parent]; return x.id; };
  const founders = socs.filter(x => x.parent === null || x.parent === undefined);
  const SUM = new Set(['pop', 'warDeaths', 'herds', 'fields', 'births', 'deaths', 'raidsMade', 'raidsSuffered', 'slaves']);
  const MAX = new Set(['techs']);
  const lineage = (key) => founders.map(fd => {
    const bands = socs.filter(x => rootOf(x.id) === fd.id);
    const values = Array.from({ length: r.years }, (_, y) => {
      let sum = 0, w = 0, any = false, mx = null;
      for (const b of bands) {
        const v = r.sseries[b.id][key][y], pop = r.sseries[b.id].pop[y] || 0;
        if (v == null || !pop) continue;
        any = true; sum += SUM.has(key) ? v : v * pop; w += pop; mx = mx == null ? v : Math.max(mx, v);
      }
      if (!any) return null;
      return SUM.has(key) ? sum : MAX.has(key) ? mx : sum / w;
    });
    return { name: fd.name + (bands.length > 1 ? ` (${bands.length} bands)` : ''), color: fd.color, values };
  });
  const ser = (key, f = v => v) => lineage(key).map(x => ({ ...x, values: x.values.map(v => v == null ? null : f(v)) }));
  const onPick = y => { pickYear = y; $('#fYear').value = y; $('#fWin').value = 2; renderLog(); renderCharts(); document.querySelector('#log').scrollTop = 0; };
  const markers = r.events.filter(e => (e.t === 'conquest' || e.t === 'merger') && e.to != null && rootOf(e.soc) !== rootOf(e.to)).map(e => ({ x: e.y, color: socs[e.to].color }));
  const total = { name: 'Island total', color: 'var(--muted)', dash: '4 3', width: 1.2, values: Array.from({ length: r.years }, (_, y) => socs.reduce((t, s) => t + (r.sseries[s.id].pop[y] || 0), 0)) };
  draw(lineChart, chartBox('Population', 'Each line is a founding society plus every band that split from it. Dotted lines mark one line conquering or absorbing a band of the other. Click any chart to inspect that year.'), { series: [...ser('pop'), total], onPick, pick: pickYear, markers });
  // deaths by cause per decade
  const pickSocs = chartSoc === 'all' ? socs.map(s => s.id) : [+chartSoc];
  const nDec = Math.ceil(r.years / 10);
  const stacks = CAUSE_GROUPS.map(g => ({ key: g.key, name: g.name, color: g.color, values: Array.from({ length: nDec }, (_, d) =>
    pickSocs.reduce((t, id) => t + g.causes.reduce((u, c) => { const a = r.sseries[id].deathsByCause[c]; let x = 0; for (let y = d * 10; y < Math.min(r.years, d * 10 + 10); y++) x += a[y] || 0; return u + x; }, 0), 0)) }));
  draw(stackedBars, chartBox('Deaths by cause, per decade', 'Tap a cause to filter the event log; tap a bar to open that decade.', true), {
    labels: Array.from({ length: nDec }, (_, d) => String(d * 10)), stacks, activeKey: causeFilter,
    onPick: d => { pickYear = d * 10 + 5; $('#fYear').value = d * 10 + 5; $('#fWin').value = 5; renderLog(); renderCharts(); },
    onLegend: k => { causeFilter = causeFilter === k ? null : k; $('#fType').value = 'death'; renderLog(); renderCharts(); } });
  draw(lineChart, chartBox('Food per head', 'Share of each person’s need actually eaten (1 = fed). Dips are bad years, raids and overshoot.'), { series: ser('food'), yMin: 0, yMax: 1, onPick, pick: pickYear });
  draw(lineChart, chartBox('Food inequality (Gini)', '0 = everyone eats the same share. Household sharing and elite cuts raise it.'), { series: ser('gini'), yMin: 0, onPick, pick: pickYear });
  const roll = a => a.map((_, i) => { let t = 0; for (let k = Math.max(0, i - 9); k <= i; k++) t += a[k] || 0; return t; });
  draw(lineChart, chartBox('War deaths (10-year rolling)', 'Raid deaths suffered by each founding line.'), { series: lineage('warDeaths').map(x => ({ ...x, values: roll(x.values) })), onPick, pick: pickYear });
  draw(lineChart, chartBox('Unpaired men and polygyny', 'Solid: share of men 20–45 with no partner (drives fights and raids). Dashed: share of wives in polygynous unions.'), {
    series: [...ser('unpaired'), ...lineage('polygyny').map(x => ({ ...x, name: x.name + ' polygyny', dash: '4 3' }))], yMin: 0, yMax: 1, yFormat: pct, onPick, pick: pickYear });
  // where food comes from, per decade (selected society or all)
  const fstacks = Object.entries(FOOD).map(([k, [name, color]]) => ({ key: 'food-' + k, name, color, values: Array.from({ length: nDec }, (_, d) =>
    Math.round(pickSocs.reduce((t, id) => { let x = 0; for (let y = d * 10; y < Math.min(r.years, d * 10 + 10); y++) x += r.sseries[id].prod[k][y] || 0; return t + x; }, 0) / 10)) }));
  if (fstacks.some(st => st.values.some(v => v))) draw(stackedBars, chartBox('Where food comes from', 'Mean yearly harvest per decade, millions of kcal, by source. Uses the society picked above the deaths chart.'), {
    labels: Array.from({ length: nDec }, (_, d) => String(d * 10)), stacks: fstacks, unit: 'M kcal',
    onPick: d => { pickYear = d * 10 + 5; $('#fYear').value = d * 10 + 5; $('#fWin').value = 5; renderLog(); renderCharts(); } });
  const anyHerd = socs.some(s => r.sseries[s.id].herds.some(v => v)), anyField = socs.some(s => r.sseries[s.id].fields.some(v => v));
  if (anyHerd) draw(lineChart, chartBox('Herds', 'Livestock units each society holds: they breed when grazed and tended, die in drought and plague, and change hands in raids.'), { series: ser('herds'), yMin: 0, onPick, pick: pickYear });
  if (anyField) draw(lineChart, chartBox('Fields under cultivation', 'Fields each society works. Soil tires with use and recovers in fallow; unused fields go back to the wild.'), { series: ser('fields'), yMin: 0, onPick, pick: pickYear });
  if (anyHerd || anyField) draw(lineChart, chartBox('Wealth inequality (Gini)', 'Fields and herds per person, after the property rule decides who owns them. Wealth raises status, and status wins wives.'), { series: ser('wealthGini'), yMin: 0, yMax: 1, onPick, pick: pickYear });
  draw(lineChart, chartBox('Technologies known', 'Invented, learned through trade or migrants, and lost when the experts die.'), { series: ser('techs'), yMin: 0, onPick, pick: pickYear });
  draw(lineChart, chartBox('Cohesion', 'From ritual and governance; rises under threat, decays in long peace, drops after succession crises.'), { series: ser('cohesion'), yMin: 0, yMax: 1, onPick, pick: pickYear });
  const sid = chartSoc === 'all' ? 0 : +chartSoc;
  const dcol = { plant: '#65a30d', hunt: '#b45309', fish: '#0284c7', farm: '#ca8a04', herd: '#9f1239', fight: '#dc2626', heal: '#7c3aed', craft: '#78716c' };
  draw(lineChart, chartBox(`Know-how: ${esc(socs[sid].name)}`, 'Mean skill of the best three practitioners in each domain. Pick a society above the deaths chart.'), { series: DOMAINS.map(d => ({ name: d, color: dcol[d], values: r.sseries[sid].skill[d] })), yMin: 0, yMax: 1, onPick, pick: pickYear });
  const anc = r.societies.filter(s => s.parent === null || s.parent === undefined);
  draw(lineChart, chartBox('Ancestry of the living', 'Share of everyone alive descended from each founding group — interbreeding, captives and conquest blur the lines.'), { series: anc.map(s => ({ name: s.name, color: s.color, values: r.sseries[s.id].ancestry })), yMin: 0, yMax: 1, yFormat: pct, onPick, pick: pickYear });
  queue.forEach(f => f());
}

function renderDigest() {
  const r = result;
  $('#digest').innerHTML = r.digest.map(d => `<li style="--c:${r.societies[d.soc]?.color || '#999'}" data-y="${d.y}">${esc(d.text)}</li>`).join('') || '<li>No big swings — a quiet 500 years.</li>';
  $('#digest').querySelectorAll('li[data-y]').forEach(li => li.onclick = () => { pickYear = +li.dataset.y; $('#fYear').value = pickYear; $('#fWin').value = 3; $('#fSoc').value = ''; renderLog(); renderCharts(); });
}

const TYPE_NAMES = { relief: 'Chief hands out food', farming: 'First fields', sedentary: 'Settling down', move: 'Camp moves', inherit: 'Inheritances', death: 'Deaths', birth: 'Births', raid: 'Raids', gene: 'Rule changes', tech: 'Tech gained', techLoss: 'Tech lost', epidemic: 'Epidemics', shock: 'Shocks',
  fission: 'Fissions', conquest: 'Conquests', merger: 'Mergers', intermarry: 'Intermarriages', trade: 'Trade', succession: 'Succession crises', leader: 'New leaders',
  revolt: 'Revolts', escape: 'Escapes', defect: 'Defections', exile: 'Exiles', extinct: 'Extinctions' };
function renderFilters() {
  const r = result;
  $('#fSoc').innerHTML = '<option value="">All societies</option>' + r.societies.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const types = [...new Set(r.events.map(e => e.t))];
  $('#fType').innerHTML = '<option value="">All but births</option>' + types.map(t => `<option value="${t}">${TYPE_NAMES[t] || t}</option>`).join('');
  const causes = [...new Set(r.events.filter(e => e.t === 'death').map(e => e.cause))].sort();
  $('#fCause').innerHTML = '<option value="">Any cause</option>' + causes.map(c => `<option>${c}</option>`).join('');
  $('#fYear').max = r.years - 1;
}
function filtered() {
  const r = result;
  const soc = $('#fSoc').value, type = $('#fType').value, cause = $('#fCause').value, yv = $('#fYear').value, win = +$('#fWin').value || 0;
  const group = causeFilter ? CAUSE_GROUPS.find(g => g.key === causeFilter) : null;
  return r.events.filter(e => {
    if (soc !== '' && e.soc !== +soc && e.to !== +soc) return false;
    if (type ? e.t !== type : e.t === 'birth') return false;
    if (cause && e.cause !== cause) return false;
    if (group && !(e.t === 'death' && group.causes.includes(e.cause))) return false;
    if (yv !== '' && Math.abs(e.y - +yv) > win) return false;
    return true;
  });
}
function renderLog() {
  if (!result) return;
  const evs = filtered();
  const g = causeFilter ? CAUSE_GROUPS.find(x => x.key === causeFilter).name : '';
  $('#logtitle').textContent = `· ${evs.length.toLocaleString()} events${g ? ' · ' + g : ''}`;
  const shown = evs.slice(0, 500);
  $('#log').innerHTML = shown.map(e => `<div class="ev"><span class="y">${e.y}</span><span>${describe(e)}</span></div>`).join('') +
    (evs.length > shown.length ? `<div class="more">…and ${evs.length - shown.length} more. Narrow by year or society.</div>` : '') || '<div class="more">Nothing matches.</div>';
}
function describe(e, S = result.societies) {
  const n = id => S[id] ? `<span class="dot" style="background:${S[id].color}"></span>${esc(S[id].name)}` : '';
  const f = e.f && e.f.length ? ` <span class="f">— ${e.f.map(esc).join(', ')}</span>` : '';
  switch (e.t) {
    case 'death': return `${n(e.soc)}: ${e.sex === 'F' ? 'woman' : 'man'} #${e.who}, ${e.age}, died of <b>${e.cause}</b>${f}`;
    case 'birth': return `${n(e.soc)}: birth #${e.who} to #${e.mother} and #${e.father}`;
    case 'raid': return `${n(e.soc)} raided ${n(e.to)} with ${e.party} against ${e.def} — <b>${e.win ? 'won' : 'repelled'}</b>; deaths ${e.dA} / ${e.dB}${e.taken ? `, ${e.taken} captives` : ''}${e.stolen ? `, ${Math.round(e.stolen / 1e6)}M kcal taken` : ''}${e.herds ? `, ${e.herds} livestock rustled` : ''}${f}`;
    case 'gene': return `${n(e.soc)}: <b>${GENES[e.gene]?.label || e.gene}</b> ${esc(e.from)} → <b>${esc(e.to)}</b> <span class="f">(${esc(e.via)})</span>${f}`;
    case 'tech': return `${n(e.soc)}: gained <b>${TECHS[e.tech].name}</b> <span class="f">(${esc(e.via)})</span>`;
    case 'techLoss': return `${n(e.soc)}: <b>lost ${TECHS[e.tech].name}</b> — the experts are gone${f}`;
    case 'epidemic': return `${n(e.soc)}: <b>${esc(e.name || 'epidemic')}</b> ${esc(e.via || '')} — ${e.infected ?? '?'} sick, <b>${e.deaths} dead</b> <span class="f">(${e.susceptible != null ? pct(e.susceptible) + ' had no immunity, ' : ''}spread rate ${e.R ?? '?'})</span>`;
    case 'shock': return `World: <b>${e.what}</b>`;
    case 'relief': return `${n(e.soc)}: <b>the chief opened his storehouse</b>, ${Math.round(e.kcal / 1e6)}M kcal to the hungry`;
    case 'bloodMoney': return `${n(e.soc)}: #${e.who}'s kin <b>paid blood money</b> for #${e.victim}`;
    case 'feud': return `${n(e.soc)}: <b>feud</b> — #${e.who} killed in revenge for #${e.victim}`;
    case 'bigman': return `${n(e.soc)}: <b>#${e.who} became Big Man</b> <span class="f">(prestige ${e.prestige}${e.from ? ', eclipsing #' + e.from : ''})</span>`;
    case 'lapse': return `${n(e.soc)}: Big Man #${e.who} died — <b>his following scattered</b>`;
    case 'patron': return `${n(e.soc)}: Big Man #${e.who} paid #${e.groom}'s bridewealth`;
    case 'migrate': return `${e.n} moved from ${n(e.soc)} to ${n(e.to)} <span class="f">(open bands)</span>`;
    case 'alliance': return `${n(e.soc)}: <b>${e.n} kinsmen from brother segments</b> joined the fight with ${n(e.against)}`;
    case 'ageSet': return `${n(e.soc)}: <b>new age set initiated</b>; ${e.warriors} young men in the warrior grade`;
    case 'intervene': return `${n(e.soc)}: <b>✋ ${esc(e.what)}</b>`;
    case 'farming': return `${n(e.soc)}: <b>first fields cleared</b>`;
    case 'sedentary': return `${n(e.soc)}: <b>${e.on ? 'settled into villages' : 'went back to moving camp'}</b> <span class="f">(farming ${pct(e.share)} of food)</span>`;
    case 'move': return `${n(e.soc)}: camp moved — ${esc(e.why)}`;
    case 'inherit': return `${n(e.soc)}: #${e.from}'s ${[e.herd ? e.herd + ' livestock' : '', e.fields ? e.fields + ' field' + (e.fields > 1 ? 's' : '') : ''].filter(Boolean).join(' and ')} ${e.to ? `passed to #${e.to}` : 'went to the common pool'}`;
    case 'fission': return `${n(e.soc)} <b>split</b>: ${n(e.to)} founded with ${e.size} people${e.genes.length ? ` <span class="f">(new rules: ${e.genes.join(', ')})</span>` : ''}`;
    case 'conquest': return `${n(e.to)} <b>conquered</b> ${n(e.soc)}: ${e.people} absorbed, ${e.killed} men killed`;
    case 'merger': return `${n(e.soc)} <b>merged into</b> ${n(e.to)} (${e.people} people)`;
    case 'intermarry': return `Intermarriage: #${e.who} moved from ${n(e.soc)} to ${n(e.to)}`;
    case 'trade': return `${n(e.soc)} sent ${Math.round(e.kcal / 1e6)}M kcal of ${e.what} to ${n(e.to)}`;
    case 'succession': return `${n(e.soc)}: <b>succession crisis</b>, ${e.deaths} killed`;
    case 'leader': return `${n(e.soc)}: new leader #${e.who}`;
    case 'revolt': return `${n(e.soc)}: <b>slave revolt</b>, ${e.deaths} dead`;
    case 'escape': return `#${e.who} escaped slavery in ${n(e.soc)}, home to ${n(e.to)}`;
    case 'defect': return `#${e.who} defected from ${n(e.soc)} to ${n(e.to)}`;
    case 'exile': return `#${e.who} exiled from ${n(e.soc)}, taken in by ${n(e.to)}`;
    case 'extinct': return `${n(e.soc)} <b>died out</b>`;
    default: return esc(JSON.stringify(e));
  }
}
function renderDisease() {
  const r = result;
  const ob = r.events.filter(e => e.t === 'epidemic');
  if (!ob.length) { $('#disease').innerHTML = '<p class="muted">No outbreaks in this run.</p>'; return; }
  const by = new Map();
  for (const e of ob) { const x = by.get(e.strain) || { n: 0, sick: 0, dead: 0, first: e.y, last: e.y, socs: new Set() }; x.n++; x.sick += e.infected; x.dead += e.deaths; x.last = e.y; x.socs.add(e.soc); by.set(e.strain, x); }
  const src = { wild: 'wild animals', herd: 'herds', crowd: 'crowded villages' };
  const rows = [...by.entries()].sort((a, b) => b[1].dead - a[1].dead);
  $('#disease').innerHTML = `<table><thead><tr><th>Disease</th><th>Kind</th><th>Came from</th><th class="num">Spread rate</th><th class="num">Fatality</th><th class="num">Outbreaks</th><th class="num">Sick</th><th class="num">Dead</th><th class="num">Years</th><th>Struck</th></tr></thead><tbody>` +
    rows.map(([id, x]) => { const st = r.strains[id] || {}; return `<tr><td><b>${esc(st.name || '?')}</b></td><td>${esc(st.kind || '')}</td><td>${esc(src[st.source] || '')}</td><td class="num">${st.R0 ?? ''}</td><td class="num">${st.cfr != null ? pct(st.cfr) : ''}</td><td class="num">${x.n}</td><td class="num">${x.sick}</td><td class="num">${x.dead}</td><td class="num">${x.first}–${x.last}</td><td>${[...x.socs].map(i => `<span class="dot" style="background:${r.societies[i].color}"></span>`).join('')}</td></tr>`; }).join('') + '</tbody></table>';
}
function renderGenes() {
  const r = result;
  const rows = r.events.filter(e => e.t === 'gene' || e.t === 'fission');
  if (!rows.length) { $('#genes').innerHTML = '<p class="muted">No rule changed. (Freeze genomes was on, or 500 quiet years.)</p>'; return; }
  $('#genes').innerHTML = `<table><thead><tr><th class="num">Year</th><th>Society</th><th>Rule</th><th>From</th><th>To</th><th>How</th></tr></thead><tbody>` +
    rows.map(e => e.t === 'gene'
      ? `<tr><td class="num">${e.y}</td><td><span class="dot" style="background:${r.societies[e.soc].color}"></span>${esc(r.societies[e.soc].name)}</td><td>${GENES[e.gene]?.label}</td><td>${esc(e.from)}</td><td><b>${esc(e.to)}</b></td><td class="muted">${esc(e.via)}${e.f ? ' — ' + e.f.map(esc).join(', ') : ''}</td></tr>`
      : `<tr><td class="num">${e.y}</td><td><span class="dot" style="background:${r.societies[e.to].color}"></span>${esc(r.societies[e.to].name)}</td><td>—</td><td colspan="2">split from ${esc(r.societies[e.soc].name)}</td><td class="muted">fission${e.genes.length ? ', mutated ' + e.genes.join(', ') : ''}</td></tr>`).join('') + '</tbody></table>';
}

// ---------- export ----------
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
if ($('#expJson')) $('#expJson').onclick = () => result && download(`society-sim-v${BUILD.version}-seed${result.seed}.json`, JSON.stringify({ build: BUILD, config: socs, ...result }), 'application/json');
if ($('#expCsv')) $('#expCsv').onclick = () => {
  if (!result) return;
  const cols = ['y', 't', 'soc', 'to', 'who', 'sex', 'age', 'cause', 'f', 'gene', 'from', 'tech', 'via', 'win', 'dA', 'dB', 'taken'];
  const cell = v => v == null ? '' : '"' + String(Array.isArray(v) ? v.join('; ') : v).replace(/"/g, '""') + '"';
  download(`society-sim-seed${result.seed}-events.csv`, cols.join(',') + '\n' + result.events.map(e => cols.map(c => cell(e[c])).join(',')).join('\n'), 'text/csv');
};

// ---------- sweep ----------
let sweepResults = [];
function renderSweepPick() {
  $('#sweepEnvs').innerHTML = Object.entries(ENVIRONMENTS).map(([k, e]) => `<label class="chk"><input type="checkbox" value="${k}" ${k === $('#env').value ? 'checked' : ''}> ${esc(e.name)}</label>`).join('');
  $('#sweepPick').innerHTML = presetNames.map(n => `<label class="chk"><input type="checkbox" value="${esc(n)}" checked> ${esc(n)}</label>`).join('') +
    socs.map((s, i) => `<label class="chk"><input type="checkbox" value="__soc${i}" ${s.preset === '__custom' || JSON.stringify(s.genome) !== JSON.stringify(PRESETS[s.preset]) ? 'checked' : ''}> Custom: ${esc(s.name)}</label>`).join('');
}
function startSweep() {
  const picked = [...$('#sweepPick').querySelectorAll('input:checked')].map(i => i.value).map(v => v.startsWith('__soc') ? { name: socs[+v.slice(5)].name + ' (custom)', genome: socs[+v.slice(5)].genome } : { name: v, genome: PRESETS[v] });
  if (picked.length < 2) { $('#sStatus').textContent = 'Tick at least two.'; return; }
  const pairs = []; for (let i = 0; i < picked.length; i++) for (let j = i + 1; j < picked.length; j++) pairs.push({ a: picked[i], b: picked[j] });
  sweepResults = []; renderSweep();
  $('#sGo').disabled = true; $('#sBar').style.width = '0';
  const seeds = Math.max(2, +$('#sSeeds').value || 10);
  const envs = [...$('#sweepEnvs').querySelectorAll('input:checked')].map(i => i.value);
  if (!envs.length) { $('#sStatus').textContent = 'Tick at least one world.'; $('#sGo').disabled = false; return; }
  const years = +$('#sYears').value || 500;
  const nTune = Object.keys(tune).length;
  $('#sTuned').hidden = !nTune;
  $('#sTuned').textContent = nTune ? `Using ${nTune} tuned baseline${nTune > 1 ? 's' : ''}: ${Object.keys(tune).map(k => PARAM_UI.find(p => p.path === k)?.label).join(', ')}.` : '';
  $('#sStatus').textContent = `${pairs.length} pairings × ${envs.length} world${envs.length > 1 ? 's' : ''} × ${seeds} seeds = ${pairs.length * envs.length * seeds} runs…`;
  if ($('#sWhere').value === 'hub') return hubSweep({ pairs, envs, seeds, years, tune });
  getWorker().postMessage({ type: 'sweep', pairs, envs, seeds, params: { ...tuningToParams(tune), years } });
}

// The hub runs sweeps on its own CPUs and keeps the results. If it cannot be reached
// (for example when this page is opened somewhere other than its own site), fall back to the browser.
let pollTimer = null;
async function hubSweep(body) {
  clearTimeout(pollTimer);
  try {
    const r = await fetch('api/sweeps', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.statusText);
    showHubJob(j);
  } catch (e) {
    if (e instanceof TypeError || /JSON|Unexpected/.test(String(e))) {
      $('#sStatus').textContent = 'The hub is not reachable from here; running in this browser instead…';
      $('#sWhere').value = 'browser';
      getWorker().postMessage({ type: 'sweep', pairs: body.pairs, envs: body.envs, seeds: body.seeds, params: { ...tuningToParams(body.tune), years: body.years } });
    } else { $('#sStatus').textContent = 'The hub refused the sweep: ' + e.message; $('#sGo').disabled = false; }
  }
}
function showHubJob(j) {
  sweepResults = j.results || []; renderSweep();
  $('#sBar').style.width = (100 * (j.done || 0) / (j.total || 1)) + '%';
  const tag = `Hub sweep ${j.id} · model v${j.version}`;
  if (j.status === 'done') { $('#sBar').style.width = '100%'; $('#sStatus').textContent = `${tag} · done: ${j.total} runs${j.finished ? ', finished ' + j.finished.slice(0, 16).replace('T', ' ') + ' UTC' : ''}`; $('#sGo').disabled = false; loadRecent(); return; }
  if (j.status === 'failed') { $('#sStatus').textContent = `${tag} · failed: ${j.error}`; $('#sGo').disabled = false; return; }
  $('#sStatus').textContent = j.status === 'queued' ? `${tag} · waiting in line (position ${j.position})` : `${tag} · ${j.done} / ${j.total} runs`;
  pollTimer = setTimeout(async () => {
    try { const r = await fetch('api/sweeps/' + j.id); showHubJob(await r.json()); }
    catch { $('#sStatus').textContent = `${tag} · lost touch with the hub; it keeps running there. Open it again from Recent hub sweeps.`; $('#sGo').disabled = false; }
  }, 2000);
}
async function loadRecent() {
  try {
    const r = await fetch('api/sweeps'); if (!r.ok) throw 0;
    const list = await r.json();
    $('#sRecentBox').hidden = !list.length;
    $('#sRecent').innerHTML = `<table><thead><tr><th>Sweep</th><th>Status</th><th>Model</th><th>Worlds</th><th class="num">Pairs</th><th class="num">Seeds</th><th class="num">Runs</th><th>Finished</th><th></th></tr></thead><tbody>` +
      list.map(j => `<tr><td><code>${j.id}</code></td><td>${j.status}${j.status === 'running' ? ` ${Math.round(100 * j.done / j.total)}%` : ''}</td><td>v${esc(j.version || '?')}</td><td>${(j.envs || []).map(e => esc(ENVIRONMENTS[e]?.name || e)).join(', ')}</td><td class="num">${j.pairs ?? ''}</td><td class="num">${j.seeds ?? ''}</td><td class="num">${j.total}</td><td>${j.finished ? j.finished.slice(0, 16).replace('T', ' ') : ''}</td><td><button data-job="${j.id}">Open</button></td></tr>`).join('') + '</tbody></table>';
    $('#sRecent').querySelectorAll('button[data-job]').forEach(b => b.onclick = async () => { clearTimeout(pollTimer); const r = await fetch('api/sweeps/' + b.dataset.job); showHubJob(await r.json()); });
  } catch { $('#sRecentBox').hidden = true; $('#sWhere').value = 'browser'; }
}
function renderSweep() {
  const ci = s => `${pct(s.mean)} <span class="ci">${pct(s.lo)}–${pct(s.hi)}</span>`;
  const envName = k => ENVIRONMENTS[k]?.name || k;
  $('#sTable').innerHTML = sweepResults.length ? `<table><thead><tr><th>World</th><th>Society A</th><th>Society B</th><th class="num">A survives</th><th class="num">B survives</th><th class="num">A share</th><th class="num">Pop A / B</th><th class="num">War ♂ deaths A / B</th></tr></thead><tbody>` +
    sweepResults.map(r => `<tr><td>${esc(envName(r.env))}</td><td>${esc(r.a)}</td><td>${esc(r.b)}</td><td class="num">${ci(r.stats[0].survival)}</td><td class="num">${ci(r.stats[1].survival)}</td><td class="num">${ci(r.stats[0].share)}</td><td class="num">${r.stats[0].finalPop.mean.toFixed(0)} / ${r.stats[1].finalPop.mean.toFixed(0)}</td><td class="num">${pct(r.stats[0].war.mean)} / ${pct(r.stats[1].war.mean)}</td></tr>`).join('') + '</tbody></table>' : '<p class="muted">No results yet.</p>';
  // society x world matrix
  const envs = [...new Set(sweepResults.map(r => r.env))];
  const M = {};
  sweepResults.forEach(r => [[r.a, 0], [r.b, 1]].forEach(([n, i]) => { const c = ((M[n] = M[n] || {})[r.env] = M[n][r.env] || { share: 0, surv: 0, k: 0 }); c.share += r.stats[i].share.mean; c.surv += r.stats[i].survival.mean; c.k++; }));
  const sc = (n, e) => M[n][e] ? M[n][e].surv / M[n][e].k + 0.001 * M[n][e].share / M[n][e].k : 0; // survival wins; share breaks ties
  const names = Object.keys(M).sort((x, z) => envs.reduce((t, e) => t + sc(z, e), 0) - envs.reduce((t, e) => t + sc(x, e), 0));
  const best = Object.fromEntries(envs.map(e => [e, names.reduce((b, n) => M[n][e] && (!b || sc(n, e) > sc(b, e)) ? n : b, null)]));
  $('#sMatrix').innerHTML = names.length ? `<table><thead><tr><th>Society</th>${envs.map(e => `<th class="num">${esc(envName(e))}</th>`).join('')}</tr></thead><tbody>` +
    names.map(n => `<tr><td>${esc(n)}</td>${envs.map(e => { const c = M[n][e]; return c ? `<td class="cell${best[e] === n ? ' best' : ''}"><b>${pct(c.surv / c.k)}</b> <span class="ci">share ${pct(c.share / c.k)}</span></td>` : '<td></td>'; }).join('')}</tr>`).join('') + '</tbody></table>' : '<p class="muted">Run a sweep to compare worlds.</p>';
  const agg = {};
  sweepResults.forEach(r => [[r.a, 0], [r.b, 1]].forEach(([n, i]) => { agg[n] = agg[n] || { share: 0, surv: 0, pop: 0, k: 0 }; agg[n].share += r.stats[i].share.mean; agg[n].surv += r.stats[i].survival.mean; agg[n].pop += r.stats[i].finalPop.mean; agg[n].k++; }));
  const rows = Object.entries(agg).sort((x, z) => (z[1].surv / z[1].k - x[1].surv / x[1].k) + 0.001 * (z[1].share / z[1].k - x[1].share / x[1].k));
  $('#sRank').innerHTML = rows.length ? `<table><thead><tr><th>#</th><th>Society</th><th class="num">Survival, all worlds</th><th class="num">Mean share</th><th class="num">Mean final pop.</th><th class="num">Opponents</th></tr></thead><tbody>` +
    rows.map(([n, a], i) => `<tr><td>${i + 1}</td><td>${esc(n)}</td><td class="num"><b>${pct(a.surv / a.k)}</b></td><td class="num">${pct(a.share / a.k)}</td><td class="num">${(a.pop / a.k).toFixed(0)}</td><td class="num">${a.k}</td></tr>`).join('') + '</tbody></table>' : '<p class="muted">Run a sweep to rank strategies.</p>';
}

// ---------- wiring ----------
document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b));
  ['run', 'play', 'sweep', 'about'].forEach(t => $('#tab-' + t).hidden = t !== b.dataset.tab);
  $('#setup').hidden = b.dataset.tab === 'about';
  $('#setup .runbar').hidden = b.dataset.tab !== 'run' && b.dataset.tab !== 'play';
  $('#go').hidden = $('#dice').hidden = b.dataset.tab === 'play';
  if (b.dataset.tab === 'sweep') { renderSweepPick(); loadRecent(); }
  document.body.classList.toggle('staged', b.dataset.tab === 'play');
  if (b.dataset.tab === 'play' && typeof player !== 'undefined') { player.ensure(); player.show(); } // show the founding camps at once
});
$('#go').onclick = run;
$('#dice').onclick = () => { $('#seed').value = 1 + Math.floor(Math.random() * 99999); run(); };
$('#years').onchange = () => { renderSetup(); saveState(); };
['#fSoc', '#fType', '#fCause', '#fYear', '#fWin'].forEach(s => $(s).onchange = () => { if (s !== '#fYear' && s !== '#fWin') { } pickYear = $('#fYear').value === '' ? null : +$('#fYear').value; renderLog(); });
$('#fClear').onclick = () => { ['#fSoc', '#fType', '#fCause', '#fYear'].forEach(s => $(s).value = ''); $('#fWin').value = 0; causeFilter = null; pickYear = null; renderLog(); renderCharts(); };
$('#sGo').onclick = startSweep;
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => result && renderCharts(), 200); });

$('#ver').textContent = 'v' + BUILD.version;
$('#ver').title = `commit ${BUILD.commit}, built ${BUILD.built}`;
$('#verFull').textContent = `v${BUILD.version} · commit ${BUILD.commit} · built ${BUILD.built}`;
$('#env').innerHTML = Object.entries(ENVIRONMENTS).map(([k, e]) => `<option value="${k}">${esc(e.name)}</option>`).join('');
const showBlurb = () => { $('#envBlurb').textContent = ENVIRONMENTS[$('#env').value].blurb; };
$('#env').onchange = () => { showBlurb(); renderTune(); saveState(); run(); };
loadState();
showBlurb();
renderTune();
renderSetup();
renderSweep();
run();
const showTab = t => document.querySelector(`.tab[data-tab="${t}"]`).click();
const player = initPlay({ esc, describe, exit: () => showTab('run'), getCfg: () => { saveState(); return runCfg(); },
  showResult: (r) => { result = r; r.ms = r.ms || 0; pickYear = null; causeFilter = null; showTab('run'); renderResult(); } });
