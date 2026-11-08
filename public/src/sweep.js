// Sweep: genome pairs x seeds -> survival and population statistics with 95% CIs.
// summarizeRun + aggregate are shared by the browser worker and the hub's sweep service,
// so a run's summary is the same wherever it was computed.
import { runSim } from './engine.js';

function meanCI(xs, lo = -Infinity, hi = Infinity) {
  const n = xs.length; if (!n) return { mean: 0, lo: 0, hi: 0, n };
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0;
  const h = 1.96 * sd / Math.sqrt(n);
  return { mean: m, lo: Math.max(lo, m - h), hi: Math.min(hi, m + h), n };
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

export const seedOf = k => 1000 + k;

// One run of a pair, reduced to what the statistics need (small enough to send between threads).
export function summarizeRun(gA, gB, nameA, nameB, seed, params) {
  const r = runSim({ genomes: [gA, gB], names: [nameA, nameB], seed, params });
  const root = lineageOf(r.summary);
  const line = [0, 1].map(f => {
    const mine = r.summary.filter(s => root.get(s.id) === f);
    return {
      alive: mine.some(s => s.alive),
      pop: mine.reduce((t, s) => t + s.finalPop, 0),
      share: mine.reduce((t, s) => t + s.islandShare, 0),
      ancestry: r.summary[f].ancestryShare,
      war: r.summary[f].warShareMaleDeaths,
      ended: r.summary[f].ended,
    };
  });
  const ev = r.events;
  return {
    seed, line, version: r.version,
    raids: ev.filter(e => e.t === 'raid').length,
    epidemicDeaths: ev.filter(e => e.t === 'death' && e.cause === 'epidemic').length,
    techs: [0, 1].map(f => r.summary.filter(s => root.get(s.id) === f).reduce((m, s) => Math.max(m, s.techs.length), 0)),
  };
}

export function aggregate(a, b, runs) {
  const stat = f => ({
    survival: propCI(runs.filter(r => r.line[f].alive).length, runs.length),
    finalPop: meanCI(runs.map(r => r.line[f].pop), 0),
    share: meanCI(runs.map(r => r.line[f].share), 0, 1),
    ancestry: meanCI(runs.map(r => r.line[f].ancestry ?? 0), 0, 1),
    war: meanCI(runs.map(r => r.line[f].war), 0, 1),
    techs: meanCI(runs.map(r => r.techs[f])),
  });
  return {
    a, b, n: runs.length, stats: [stat(0), stat(1)],
    bothSurvive: runs.filter(r => r.line[0].alive && r.line[1].alive).length,
    winsA: runs.filter(r => r.line[0].alive && !r.line[1].alive).length,
    winsB: runs.filter(r => r.line[1].alive && !r.line[0].alive).length,
  };
}

export function runPair(gA, gB, nameA, nameB, seeds, params, onProgress) {
  const runs = [];
  for (let k = 0; k < seeds; k++) {
    runs.push(summarizeRun(gA, gB, nameA, nameB, seedOf(k), params));
    onProgress && onProgress(k + 1, seeds);
  }
  return { ...aggregate(nameA, nameB, runs), runs };
}
