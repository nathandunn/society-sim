import { runSim } from './src/engine.js';
import { runPair } from './src/sweep.js';

self.onmessage = (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'run') {
      const t0 = performance.now();
      const r = runSim(m.cfg);
      r.ms = Math.round(performance.now() - t0);
      self.postMessage({ type: 'run', result: r });
    } else if (m.type === 'sweep') {
      const out = [];
      let done = 0;
      const envs = m.envs && m.envs.length ? m.envs : ['forest'];
      const total = m.pairs.length * m.seeds * envs.length;
      for (const env of envs) for (const p of m.pairs) {
        const r = runPair(p.a.genome, p.b.genome, p.a.name, p.b.name, m.seeds, { ...m.params, env }, () => {
          done++; if (done % 2 === 0 || done === total) self.postMessage({ type: 'progress', done, total });
        });
        delete r.runs; // keep payload small; stats carry the answer
        r.env = env;
        out.push(r);
        self.postMessage({ type: 'pair', result: r });
      }
      self.postMessage({ type: 'sweepDone', results: out });
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e && e.stack || e) });
  }
};
