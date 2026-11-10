// The live simulation for play mode: one run held open so it can be stepped, paused, inspected and interfered with.
import { createSim, runSim } from './src/engine.js';

let sim = null, cfg = null, base = null, last = null, popHist = [];

// Stop conditions for "run until". Each returns a sentence when it fires, or null.
const STOPS = {
  leader: (f, prev, mine) => {
    for (const s of f.socs.filter(x => mine(x.id))) {
      const p = prev && prev.socs.find(x => x.id === s.id);
      if (p && p.leader !== s.leader) return `${s.name} has a new leader${s.leader ? '' : ' (none for now)'}`;
    }
    const e = f.events.find(e => (e.t === 'succession' || e.t === 'lapse') && mine(e.soc));
    return e ? `${nm(f, e.soc)}: ${e.t === 'lapse' ? 'the Big Man died and his following scattered' : 'a succession crisis'}` : null;
  },
  raid: (f, prev, mine) => { const e = f.events.find(e => e.t === 'raid' && (mine(e.soc) || mine(e.to))); return e ? `${nm(f, e.soc)} raided ${nm(f, e.to)} (${e.win ? 'won' : 'beaten off'})` : null; },
  epidemic: (f, prev, mine) => { const e = f.events.find(e => e.t === 'epidemic' && mine(e.soc)); return e ? `${e.name || 'an epidemic'} in ${nm(f, e.soc)}, ${e.deaths} dead` : null; },
  famine: (f, prev, mine) => { const s = f.socs.find(s => mine(s.id) && s.fed < 0.75); return s ? `${s.name} is going hungry (${Math.round(s.fed * 100)}% fed)` : null; },
  rule: (f, prev, mine) => { const e = f.events.find(e => e.t === 'gene' && e.via !== 'decree' && mine(e.soc)); return e ? `${nm(f, e.soc)} changed a rule: ${e.gene} ${e.from} → ${e.to} (${e.via})` : null; },
  tech: (f, prev, mine) => { const e = f.events.find(e => (e.t === 'tech' || e.t === 'techLoss') && mine(e.soc)); return e ? `${nm(f, e.soc)} ${e.t === 'tech' ? 'gained' : 'lost'} ${e.tech}` : null; },
  split: (f, prev, mine) => { const e = f.events.find(e => ['fission', 'merger', 'conquest', 'extinct'].includes(e.t) && (mine(e.soc) || mine(e.to))); return e ? `${nm(f, e.soc)}: ${{ fission: 'split', merger: 'merged', conquest: 'was conquered', extinct: 'died out' }[e.t]}` : null; },
  cataclysm: (f, prev, mine) => {
    const e = f.events.find(e => (['conquest', 'extinct', 'revolt', 'succession'].includes(e.t) && (mine(e.soc) || mine(e.to))) || e.t === 'shock');
    if (e) return e.t === 'shock' ? `a ${e.what}` : `${nm(f, e.soc)}: ${{ conquest: 'conquered', extinct: 'died out', revolt: 'a slave revolt', succession: 'a succession crisis' }[e.t]}`;
    const ep = f.events.find(e => e.t === 'epidemic' && mine(e.soc) && e.deaths >= 0.1 * Math.max(1, (f.socs.find(s => s.id === e.soc)?.pop || 0) + e.deaths));
    if (ep) return `${ep.name || 'an epidemic'} killed ${ep.deaths} in ${nm(f, ep.soc)}`;
    const starving = f.socs.find(s => mine(s.id) && s.fed < 0.6); if (starving) return `famine in ${starving.name} (${Math.round(starving.fed * 100)}% fed)`;
    const then = popHist[popHist.length - 6];
    if (then) for (const s of f.socs.filter(x => mine(x.id))) { const a = then[s.id] || 0; if (a >= 20 && s.pop <= a * 0.75) return `${s.name} fell from ${a} to ${s.pop} in five years`; }
    return null;
  },
};
const nm = (f, id) => f.socs.find(s => s.id === id)?.name ?? meta?.societies[id]?.name ?? 'a band';
let meta = null;
const lite = f => ({ ...f, fields: null, lush: null });

self.onmessage = (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      cfg = m.cfg; sim = createSim(cfg); base = null; last = null; popHist = []; meta = sim.meta();
      self.postMessage({ type: 'meta', meta, snap: sim.snapshot() });
    } else if (m.type === 'step') {
      const frames = [];
      for (let k = 0; k < m.n && !sim.done; k++) { sim.step(); last = sim.frame(); popHist.push(last.pops); frames.push(last); }
      self.postMessage({ type: 'frames', frames, done: sim.done, year: sim.year });
    } else if (m.type === 'runUntil') {
      // run up to max years, stopping early when the chosen thing happens (to the chosen society, or anyone)
      const frames = [], test = STOPS[m.until], mine = id => m.soc == null || id === m.soc;
      let hit = null;
      for (let k = 0; k < m.max && !sim.done; k++) {
        const prev = last;
        sim.step(); last = sim.frame(); popHist.push(last.pops); frames.push(last);
        if (test && (hit = test(last, prev, mine))) break;
      }
      self.postMessage({ type: 'frames', frames: frames.map((f, i) => i < frames.length - 3 ? lite(f) : f), done: sim.done, year: sim.year, hit, stopped: { until: m.until, years: frames.length } });
      self.postMessage({ type: 'snapshot', snap: sim.snapshot() });
    } else if (m.type === 'snapshot') {
      self.postMessage({ type: 'snapshot', snap: sim.snapshot() });
    } else if (m.type === 'person') {
      self.postMessage({ type: 'person', person: sim.person(m.id) });
    } else if (m.type === 'intervene') {
      const rec = sim.intervene(m.iv);
      self.postMessage({ type: 'intervened', rec });
    } else if (m.type === 'result') {
      const r = sim.result();
      self.postMessage({ type: 'result', result: r });
    } else if (m.type === 'baseline') {
      // the same seed with no interventions: the history that would have happened anyway
      if (!base) {
        const r = runSim(cfg);
        base = { years: r.years, societies: r.societies, pop: r.sseries.map(sd => sd.pop), summary: r.summary };
      }
      self.postMessage({ type: 'baseline', base });
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e && e.stack || e) });
  }
};
