// node tools/sweep.mjs [seeds] [years] [envs comma list] -> round robin of all presets, per world
import { runPair } from '../src/sweep.js';
import { PRESETS } from '../src/genome.js';
import { ENVIRONMENTS } from '../src/world.js';
const seeds = +(process.argv[2] || 10), years = +(process.argv[3] || 500);
const envs = process.argv[4] ? process.argv[4].split(',') : Object.keys(ENVIRONMENTS);
const names = Object.keys(PRESETS);
const pct = x => (x * 100).toFixed(0).padStart(3) + '%';
const t0 = Date.now();
const M = Object.fromEntries(names.map(n => [n, {}]));
for (const env of envs) {
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const r = runPair(PRESETS[names[i]], PRESETS[names[j]], names[i], names[j], seeds, { years, env });
    [[names[i], 0], [names[j], 1]].forEach(([n, k]) => { const c = (M[n][env] = M[n][env] || { share: 0, surv: 0, k: 0 }); c.share += r.stats[k].share.mean; c.surv += r.stats[k].survival.mean; c.k++; });
  }
  console.error(`${env} done ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
console.log('Mean share of the world at the end (survival), over all opponents and ' + seeds + ' seeds each\n');
console.log('Society'.padEnd(26) + envs.map(e => ENVIRONMENTS[e].name.padStart(18)).join(''));
for (const n of names) console.log(n.padEnd(26) + envs.map(e => { const c = M[n][e]; return `${pct(c.share / c.k)} (${pct(c.surv / c.k)})`.padStart(18); }).join(''));
console.log(`\nelapsed ${((Date.now() - t0) / 1000).toFixed(0)}s`);
