// Sweep: genome pairs x seeds -> survival and population statistics with 95% CIs.
import { runSim } from './engine.js';

function meanCI(xs) {
  const n = xs.length; if (!n) return { mean: 0, lo: 0, hi: 0, n };
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0;
  const h = 1.96 * sd / Math.sqrt(n);
  return { mean: m, lo: m - h, hi: m + h, n };
}
function propCI(k, n) { // Wilson interval
  if (!n) return { mean: 0, lo: 0, hi: 0, n };
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return { mean: p, lo: Math.max(0, c - h), hi: Math.min(1, c + h), n };
}

// lineage helpers: a founder "survives" if it or any daughter society is alive at the end
function lineageOf(summary) {
  const root = new Map();
  summary.forEach(s => { let r = s; while (r.parent !== null && r.parent !== undefined) r = summary[r.parent]; root.set(s.id, r.id); });
  return root;
}

export function runPair(gA, gB, nameA, nameB, seeds, params, onProgress) {
  const res = { a: nameA, b: nameB, runs: [] };
  for (let k = 0; k < seeds; k++) {
    const seed = 1000 + k;
    const r = runSim({ genomes: [gA, gB], names: [nameA, nameB], seed, params });
    const root = lineageOf(r.summary);
    const line = [0, 1].map(f => {
      const mine = r.summary.filter(s => root.get(s.id) === f);
      return {
        alive: mine.some(s => s.alive),
        pop: mine.reduce((t, s) => t + s.finalPop, 0),
        share: mine.reduce((t, s) => t + s.islandShare, 0),
        ancestry: r.summary[f].ancestryShare,
        meanPop: r.summary[f].meanPop,
        war: r.summary[f].warShareMaleDeaths,
        ended: r.summary[f].ended,
      };
    });
    const ev = r.events;
    res.runs.push({ seed, line, raids: ev.filter(e => e.t === 'raid').length,
      conquests: ev.filter(e => e.t === 'conquest').map(e => ({ y: e.y, by: root.get(e.to), of: root.get(e.soc) })),
      techs: [0, 1].map(f => r.summary.filter(s => root.get(s.id) === f).reduce((m, s) => Math.max(m, s.techs.length), 0)) });
    onProgress && onProgress(k + 1, seeds);
  }
  const stat = f => ({
    survival: propCI(res.runs.filter(r => r.line[f].alive).length, res.runs.length),
    finalPop: meanCI(res.runs.map(r => r.line[f].pop)),
    share: meanCI(res.runs.map(r => r.line[f].share)),
    ancestry: meanCI(res.runs.map(r => r.line[f].ancestry ?? 0)),
    war: meanCI(res.runs.map(r => r.line[f].war)),
    techs: meanCI(res.runs.map(r => r.techs[f])),
  });
  res.stats = [stat(0), stat(1)];
  res.winsA = res.runs.filter(r => r.line[0].share > r.line[1].share).length;
  res.winsB = res.runs.filter(r => r.line[1].share > r.line[0].share).length;
  return res;
}
