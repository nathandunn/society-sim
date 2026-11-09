// Sanity tests: determinism, demography within forager ranges, causality completeness.
import assert from 'node:assert/strict';
import { runSim, createSim } from '../src/engine.js';
import { PRESETS } from '../src/genome.js';
import { CAUSES, MODEL_VERSION } from '../src/params.js';
import { readFileSync } from 'node:fs';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok', name); };

const cfg = seed => ({ genomes: [PRESETS['Egalitarian matriarchy'], PRESETS['Patriarchal harem']], seed, params: { years: 200 } });

t('deterministic for a seed', () => {
  const a = runSim(cfg(7)), b = runSim(cfg(7));
  assert.deepEqual(a.sseries[0].pop, b.sseries[0].pop);
  assert.equal(a.events.length, b.events.length);
});

t('different seeds diverge', () => {
  assert.notDeepEqual(runSim(cfg(1)).sseries[0].pop, runSim(cfg(2)).sseries[0].pop);
});

t('every death has a known cause and every person dies at most once', () => {
  const r = runSim(cfg(3));
  const seen = new Set();
  for (const e of r.events.filter(e => e.t === 'death')) {
    assert.ok(CAUSES.includes(e.cause), 'cause ' + e.cause);
    assert.ok(!seen.has(e.who), 'double death ' + e.who);
    seen.add(e.who);
  }
});

t('demography within forager ranges (pooled over 6 seeds)', () => {
  let births = 0, inf = 0, born = 0, dead15 = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const r = runSim({ genomes: [PRESETS['Democratic egalitarian']], seed, params: { years: 300, freezeGenomes: true } });
    const ev = r.events;
    const b = new Set(ev.filter(e => e.t === 'birth' && e.y < 280).map(e => e.who));
    births += ev.filter(e => e.t === 'birth').length;
    inf += ev.filter(e => e.t === 'death' && e.age === 0).length;
    born += b.size;
    dead15 += ev.filter(e => e.t === 'death' && e.age < 15 && b.has(e.who)).length;
  }
  const q0 = inf / births, s15 = 1 - dead15 / born;
  console.log(`   q0 ${q0.toFixed(3)} survival-to-15 ${s15.toFixed(3)}`);
  assert.ok(q0 > 0.12 && q0 < 0.30, 'q0 ' + q0);
  assert.ok(s15 > 0.45 && s15 < 0.72, 's15 ' + s15);
});

t('lone society plateaus instead of exploding or dying', () => {
  const finals = [];
  for (let seed = 1; seed <= 4; seed++) {
    const r = runSim({ genomes: [{ ...PRESETS['Warlord state'], fission: 400 }], seed, params: { years: 300, freezeGenomes: true } });
    finals.push(r.sseries[0].pop[299] ?? 0);
  }
  console.log('   finals', finals.join(' '));
  assert.ok(finals.every(p => p > 40 && p < 400), finals.join(','));
});

t('island-level summaries add up', () => {
  const r = runSim(cfg(5));
  const share = r.summary.reduce((a, s) => a + s.islandShare, 0);
  assert.ok(share === 0 || Math.abs(share - 1) < 0.01, 'share ' + share);
});

t('model version matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(MODEL_VERSION, pkg.version);
  assert.equal(runSim(cfg(1)).version, pkg.version);
});

t('every world runs 150 years with somebody alive somewhere', () => {
  for (const env of ['forest', 'farmland', 'desert', 'islands']) {
    let alive = 0;
    for (let seed = 1; seed <= 3; seed++) alive += runSim({ genomes: [PRESETS['Democratic egalitarian'], PRESETS['Patriarchal harem']], seed, params: { env, years: 150 } }).summary.some(s => s.alive) ? 1 : 0;
    assert.ok(alive >= 2, env + ' died out in ' + (3 - alive) + ' of 3 seeds');
  }
});

t('stepping a year at a time gives the same history as a full run', () => {
  const sim = createSim(cfg(5)); while (sim.step()) { /* */ }
  assert.deepEqual(sim.result().summary, runSim(cfg(5)).summary);
});

t('interventions replay exactly from the recorded list', () => {
  const sim = createSim(cfg(4));
  for (let i = 0; i < 60; i++) sim.step();
  sim.intervene({ t: 'gene', soc: 1, gene: 'governance', value: 'democracy' });
  sim.intervene({ t: 'famine', soc: 0, years: 3 });
  sim.intervene({ t: 'migrants', soc: 0, n: 12 });
  for (let i = 0; i < 40; i++) sim.step();
  sim.intervene({ t: 'plague', soc: 0 }); sim.intervene({ t: 'freeSlaves', soc: 1 }); sim.intervene({ t: 'killLeader', soc: 1 });
  while (sim.step()) { /* */ }
  const a = sim.result();
  const b = runSim({ ...cfg(4), interventions: a.interventions });
  assert.deepEqual(a.summary, b.summary);
  assert.ok(a.events.some(e => e.t === 'gene' && e.via === 'decree'));
  assert.notDeepEqual(a.sseries[0].pop, runSim(cfg(4)).sseries[0].pop);
});

console.log(`${pass} tests passed`);
