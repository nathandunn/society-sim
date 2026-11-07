// Headless runner: node tools/run.mjs [presetA] [presetB] [seeds] [years]
import { runSim } from '../src/engine.js';
import { PRESETS } from '../src/genome.js';

const [a = 'Egalitarian matriarchy', b = 'Patriarchal harem', nSeeds = '5', years = '500', extra = '{}'] = process.argv.slice(2);
const params = { years: +years, ...JSON.parse(extra) };
const t0 = Date.now();
const rows = [];
for (let seed = 1; seed <= +nSeeds; seed++) {
  const r = runSim({ genomes: [PRESETS[a], PRESETS[b]], names: [a, b], seed, params });
  const ev = r.events;
  const deaths = ev.filter(e => e.t === 'death');
  const by = {}; deaths.forEach(e => by[e.cause] = (by[e.cause] || 0) + 1);
  const births = ev.filter(e => e.t === 'birth').length;
  const inf = deaths.filter(e => e.age === 0).length;
  const to15 = (() => { // cohort survival to 15 among those born before year years-15
    const born = new Map(); ev.filter(e => e.t === 'birth' && e.y < r.years - 15).forEach(e => born.set(e.who, e.y));
    let dead = 0; deaths.forEach(e => { if (born.has(e.who) && e.age < 15) dead++; });
    return born.size ? 1 - dead / born.size : null;
  })();
  const adultDeaths = deaths.filter(e => e.age >= 15);
  rows.push({ seed, ms: 0, summary: r.summary.map(s => `${s.name.slice(0, 14)}:${s.alive ? s.finalPop : 'x' + s.ended}(pk${s.peakPop})`).join(' | '),
    births, deaths: deaths.length, q0: +(inf / Math.max(1, births)).toFixed(3), s15: to15 && +to15.toFixed(3),
    meanAdultDeathAge: +(adultDeaths.reduce((x, e) => x + e.age, 0) / Math.max(1, adultDeaths.length)).toFixed(1),
    raids: ev.filter(e => e.t === 'raid').length, techs: ev.filter(e => e.t === 'tech').length, genes: ev.filter(e => e.t === 'gene').length,
    fissions: ev.filter(e => e.t === 'fission').length, causes: by });
}
for (const r of rows) {
  console.log(`seed ${r.seed}: ${r.summary}`);
  console.log(`   births ${r.births} deaths ${r.deaths} q0 ${r.q0} s15 ${r.s15} meanAdultDeath ${r.meanAdultDeathAge} raids ${r.raids} techs ${r.techs} genes ${r.genes} fissions ${r.fissions}`);
  console.log('   ' + Object.entries(r.causes).sort((x, z) => z[1] - x[1]).map(([c, n]) => `${c}:${n}`).join(' '));
}
console.log(`elapsed ${(Date.now() - t0) / 1000}s`);
