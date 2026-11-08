// node tools/envcheck.mjs [seeds] [presetA] [presetB] -> per-environment calibration snapshot
import { runSim } from '../src/engine.js';
import { PRESETS } from '../src/genome.js';
import { ENVIRONMENTS } from '../src/world.js';
const seeds = +(process.argv[2] || 3);
const a = process.argv[3] || 'Democratic egalitarian', b = process.argv[4] || 'Patriarchal harem';
const envs = process.argv[5] ? process.argv[5].split(',') : Object.keys(ENVIRONMENTS);
const pct = x => Math.round(x * 100) + '%';
for (const env of envs) {
  console.log(`\n== ${ENVIRONMENTS[env].name} ==`);
  for (let seed = 1; seed <= seeds; seed++) {
    const t0 = Date.now();
    const r = runSim({ genomes: [PRESETS[a], PRESETS[b]], names: ['A', 'B'], seed, params: { env } });
    const ms = Date.now() - t0;
    const tot = y => r.sseries.reduce((t, s) => t + (s.pop[y] || 0), 0);
    const ev = r.events;
    const deaths = ev.filter(e => e.t === 'death');
    const by = {}; deaths.forEach(e => by[e.cause] = (by[e.cause] || 0) + 1);
    const top = Object.entries(by).sort((x, z) => z[1] - x[1]).slice(0, 4).map(([c, n]) => `${c} ${pct(n / deaths.length)}`).join(', ');
    const live = r.summary.filter(s => s.alive);
    const mix = live.map(s => `${s.name}:` + Object.entries(s.foodMix).filter(([, v]) => v > 0.03).map(([k, v]) => `${k} ${pct(v)}`).join('/')).join(' ');
    console.log(`seed ${seed} ${ms}ms  pop@50/150/300/499 ${[50, 150, 300, 499].map(tot).join('/')}  socs ${r.summary.length} alive ${live.length}  raids ${ev.filter(e => e.t === 'raid').length}  herds ${live.map(s => s.herdsEnd).join(',')}  fields ${live.map(s => s.fieldsEnd).join(',')}  sedentary ${ev.filter(e => e.t === 'sedentary' && e.on).length}  boats ${ev.filter(e => e.t === 'tech' && e.tech === 'boats').map(e => e.y).slice(0, 2).join(',')}`);
    console.log(`   mix ${mix}`);
    console.log(`   deaths ${top}`);
  }
}
