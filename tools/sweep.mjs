// node tools/sweep.mjs [seeds] [years] -> round-robin of all presets
import { runPair } from '../src/sweep.js';
import { PRESETS } from '../src/genome.js';
const seeds = +(process.argv[2] || 20), years = +(process.argv[3] || 500);
const names = Object.keys(PRESETS);
const pct = x => (x * 100).toFixed(0).padStart(3) + '%';
const t0 = Date.now();
const score = Object.fromEntries(names.map(n => [n, { share: 0, surv: 0, k: 0 }]));
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
  const r = runPair(PRESETS[names[i]], PRESETS[names[j]], names[i], names[j], seeds, { years });
  const [a, b] = r.stats;
  console.log(`${names[i].padEnd(24)} vs ${names[j].padEnd(24)} surv ${pct(a.survival.mean)}/${pct(b.survival.mean)}  share ${pct(a.share.mean)}/${pct(b.share.mean)}  pop ${a.finalPop.mean.toFixed(0)}/${b.finalPop.mean.toFixed(0)}  war♂ ${pct(a.war.mean)}/${pct(b.war.mean)}`);
  score[names[i]].share += a.share.mean; score[names[i]].surv += a.survival.mean; score[names[i]].k++;
  score[names[j]].share += b.share.mean; score[names[j]].surv += b.survival.mean; score[names[j]].k++;
}
console.log('\nOverall (mean over opponents):');
Object.entries(score).sort((x, z) => z[1].share - x[1].share).forEach(([n, s]) => console.log(`  ${n.padEnd(24)} share ${pct(s.share / s.k)} survival ${pct(s.surv / s.k)}`));
console.log(`elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
