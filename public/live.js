// The live simulation for play mode: one run held open so it can be stepped, paused, inspected and interfered with.
import { createSim, runSim } from './src/engine.js';

let sim = null, cfg = null, base = null;

self.onmessage = (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      cfg = m.cfg; sim = createSim(cfg); base = null;
      self.postMessage({ type: 'meta', meta: sim.meta(), snap: sim.snapshot() });
    } else if (m.type === 'step') {
      const frames = [];
      for (let k = 0; k < m.n && !sim.done; k++) { sim.step(); frames.push(sim.frame()); }
      self.postMessage({ type: 'frames', frames, done: sim.done, year: sim.year });
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
