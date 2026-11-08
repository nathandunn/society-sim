// One sweep run per message, on its own thread.
import { parentPort } from 'node:worker_threads';
import { summarizeRun } from '../src/sweep.js';

parentPort.on('message', t => {
  try {
    parentPort.postMessage({ ok: true, run: summarizeRun(t.a.genome, t.b.genome, t.a.name, t.b.name, t.seed, t.params) });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: String(e && e.stack || e) });
  }
});
