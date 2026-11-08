// Society Sim hub server: serves the static app and runs sweeps on the hub's CPUs.
//
//   POST /api/sweeps        {pairs:[{a:{name,genome},b:{name,genome}}], envs:[...], seeds, years, tune:{path:value}}
//                           -> {id, status, total, done}   (an identical request returns the cached job)
//   GET  /api/sweeps/:id    -> {id, status, total, done, results:[{env, a, b, n, stats, ...}], ...}
//   GET  /api/sweeps        -> recent jobs (id, status, created, size, model version)
//   GET  /api/health        -> {ok, version, workers, queue}
//
// Jobs run one at a time; each run is farmed out to a pool of worker threads.
// Finished jobs are written to $DATA_DIR/sweeps/<id>.json and survive redeploys
// (the cache key includes the model version, so a new model never reuses old results).
// Unfinished jobs are checkpointed to <id>.pending.json after every pair, and resumed
// from the last finished pair when the server restarts.
import http from 'node:http';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENES, GENE_KEYS } from '../src/genome.js';
import { ENVIRONMENTS } from '../src/world.js';
import { MODEL_VERSION, tuningToParams, PARAM_UI } from '../src/params.js';
import { aggregate } from '../src/sweep.js';

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const DATA = process.env.DATA_DIR || '/data';
const PORT = +(process.env.PORT || 80);
const WORKERS = Math.max(1, +(process.env.SWEEP_WORKERS || os.availableParallelism()));
const LIMITS = { seeds: 200, pairs: 28, envs: 4, runs: 12000, queue: 4, years: 1000, body: 256 * 1024 };

try { os.setPriority(10); } catch { /* sweeps run below the hub's other services */ }
await mkdir(join(DATA, 'sweeps'), { recursive: true });

// ---------- validation ----------
function bad(msg) { const e = new Error(msg); e.status = 400; throw e; }
function cleanGenome(g) {
  if (!g || typeof g !== 'object') bad('genome missing');
  const out = {};
  for (const k of GENE_KEYS) {
    const spec = GENES[k], v = g[k];
    if (spec.kind === 'enum') { if (!spec.values.includes(v)) bad(`gene ${k}: ${JSON.stringify(v)} is not one of ${spec.values.join(', ')}`); out[k] = v; }
    else { if (typeof v !== 'number' || !Number.isFinite(v)) bad(`gene ${k} must be a number`); out[k] = Math.min(spec.max, Math.max(spec.min, v)); }
  }
  return out;
}
function cleanRequest(body) {
  const pairs = Array.isArray(body.pairs) ? body.pairs : bad('pairs must be a list');
  if (!pairs.length || pairs.length > LIMITS.pairs) bad(`between 1 and ${LIMITS.pairs} pairs`);
  const cp = pairs.map(p => ({
    a: { name: String(p?.a?.name || 'A').slice(0, 60), genome: cleanGenome(p?.a?.genome) },
    b: { name: String(p?.b?.name || 'B').slice(0, 60), genome: cleanGenome(p?.b?.genome) },
  }));
  const envs = (Array.isArray(body.envs) && body.envs.length ? body.envs : ['forest']).filter(e => ENVIRONMENTS[e]);
  if (!envs.length || envs.length > LIMITS.envs) bad('unknown world');
  const seeds = Math.floor(+body.seeds || 0);
  if (seeds < 2 || seeds > LIMITS.seeds) bad(`seeds must be 2–${LIMITS.seeds}`);
  const years = Math.floor(+body.years || 500);
  if (years < 20 || years > LIMITS.years) bad(`years must be 20–${LIMITS.years}`);
  const tune = {};
  for (const spec of PARAM_UI) { const v = body.tune?.[spec.path]; if (typeof v === 'number' && Number.isFinite(v)) tune[spec.path] = v; }
  const total = cp.length * envs.length * seeds;
  if (total > LIMITS.runs) bad(`that is ${total} runs; the limit is ${LIMITS.runs}`);
  return { pairs: cp, envs, seeds, years, tune, total };
}

// ---------- worker pool ----------
const pool = [];
const waiting = [];
for (let i = 0; i < WORKERS; i++) spawn();
function spawn() {
  const w = new Worker(new URL('./worker.mjs', import.meta.url));
  w.busy = null;
  w.on('message', m => { const t = w.busy; w.busy = null; m.ok ? t.resolve(m.run) : t.reject(new Error(m.error)); next(); });
  w.on('error', err => { const t = w.busy; w.busy = null; if (t) t.reject(err); pool.splice(pool.indexOf(w), 1); spawn(); next(); });
  pool.push(w);
  next();
}
function next() {
  for (const w of pool) {
    if (w.busy || !waiting.length) continue;
    w.busy = waiting.shift();
    w.postMessage(w.busy.task);
  }
}
const runTask = task => new Promise((resolve, reject) => { waiting.push({ task, resolve, reject }); next(); });

// ---------- jobs ----------
const jobs = new Map();   // id -> job (live and recently finished)
const queue = [];
let running = null;

const jobPath = id => join(DATA, 'sweeps', id + '.json');
const pendingPath = id => join(DATA, 'sweeps', id + '.pending.json');
const checkpoint = j => writeFile(pendingPath(j.id), JSON.stringify({ id: j.id, req: j.req, version: j.version, created: j.created, results: j.results })).catch(() => {});
const publicJob = j => ({ id: j.id, status: j.status, version: j.version, created: j.created, finished: j.finished, total: j.total, done: j.done,
  request: { envs: j.req.envs, seeds: j.req.seeds, years: j.req.years, tune: j.req.tune, pairs: j.req.pairs.map(p => ({ a: p.a.name, b: p.b.name })) },
  results: j.results, error: j.error, position: j.status === 'queued' ? queue.indexOf(j) + 1 : undefined });

async function startNext() {
  if (running || !queue.length) return;
  const j = running = queue.shift();
  j.status = 'running'; j.started = new Date().toISOString();
  try {
    const params = { ...tuningToParams(j.req.tune), years: j.req.years };
    for (const env of j.req.envs) {
      for (const [pi, p] of j.req.pairs.entries()) {
        if (j.results.some(r => r.env === env && r.pi === pi)) continue; // finished before a restart
        const tasks = [];
        for (let k = 0; k < j.req.seeds; k++) tasks.push(runTask({ a: p.a, b: p.b, seed: 1000 + k, params: { ...params, env } }).then(r => { j.done++; return r; }));
        const runs = await Promise.all(tasks);
        j.results.push({ env, pi, ...aggregate(p.a.name, p.b.name, runs) });
        await checkpoint(j);
      }
    }
    j.status = 'done';
  } catch (e) {
    j.status = 'failed'; j.error = String(e.message || e);
  }
  j.finished = new Date().toISOString();
  if (j.status === 'done') { await writeFile(jobPath(j.id), JSON.stringify(publicJob(j))).catch(() => {}); await rm(pendingPath(j.id), { force: true }).catch(() => {}); }
  running = null;
  startNext();
}

async function submit(body) {
  const req = cleanRequest(body);
  const id = createHash('sha256').update(JSON.stringify({ v: MODEL_VERSION, ...req })).digest('hex').slice(0, 16);
  if (jobs.has(id) && jobs.get(id).status !== 'failed') return jobs.get(id);
  if (existsSync(jobPath(id))) { const j = JSON.parse(await readFile(jobPath(id), 'utf8')); jobs.set(id, { ...j, req: { ...req } }); return jobs.get(id); }
  if (queue.length >= LIMITS.queue) { const e = new Error('The sweep queue is full; try again in a few minutes.'); e.status = 503; throw e; }
  const j = { id, req, status: 'queued', version: MODEL_VERSION, created: new Date().toISOString(), total: req.total, done: 0, results: [] };
  jobs.set(id, j); queue.push(j); await checkpoint(j); startNext();
  return j;
}

async function getJob(id) {
  if (!/^[0-9a-f]{16}$/.test(id)) return null;
  if (jobs.has(id)) return jobs.get(id);
  if (existsSync(jobPath(id))) return JSON.parse(await readFile(jobPath(id), 'utf8'));
  return null;
}

async function recent() {
  const files = (await readdir(join(DATA, 'sweeps')).catch(() => [])).filter(f => f.endsWith('.json') && !f.endsWith('.pending.json'));
  const saved = await Promise.all(files.map(async f => ({ f, t: (await stat(join(DATA, 'sweeps', f))).mtimeMs })));
  saved.sort((x, y) => y.t - x.t);
  const out = [];
  for (const j of [running, ...queue].filter(Boolean)) out.push(publicJob(j));
  for (const { f } of saved.slice(0, 20)) {
    const id = f.slice(0, -5);
    if (out.some(o => o.id === id)) continue;
    try { const j = JSON.parse(await readFile(join(DATA, 'sweeps', f), 'utf8')); out.push({ ...j, results: undefined }); } catch { }
  }
  return out.map(j => ({ id: j.id, status: j.status, version: j.version, created: j.created, finished: j.finished, total: j.total, done: j.done,
    envs: j.request?.envs, seeds: j.request?.seeds, pairs: j.request?.pairs?.length }));
}

// resume jobs a restart interrupted
for (const f of (await readdir(join(DATA, 'sweeps')).catch(() => [])).filter(f => f.endsWith('.pending.json'))) {
  try {
    const c = JSON.parse(await readFile(join(DATA, 'sweeps', f), 'utf8'));
    if (c.version !== MODEL_VERSION) { await rm(join(DATA, 'sweeps', f), { force: true }); continue; } // the model changed; old runs no longer apply
    const j = { id: c.id, req: c.req, status: 'queued', version: c.version, created: c.created, total: c.req.total, done: c.results.length * c.req.seeds, results: c.results, resumed: true };
    jobs.set(j.id, j); queue.push(j);
    console.log(`resuming sweep ${j.id}: ${c.results.length} pairs already done`);
  } catch (e) { console.log('could not resume', f, e.message); }
}
startNext();

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(b) }); res.end(b); };

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > LIMITS.body) bad('request too large'); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { bad('body is not JSON'); }
}

async function serveStatic(req, res, path) {
  let p = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '');
  if (p.endsWith('/')) p += 'index.html';
  const file = join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': p === '/index.html' || p.endsWith('version.js') ? 'no-cache' : 'public, max-age=300' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, version: MODEL_VERSION, workers: pool.length, busy: pool.filter(w => w.busy).length, queue: queue.length, running: running?.id || null });
    if (url.pathname === '/api/sweeps' && req.method === 'POST') { const j = await submit(await readBody(req)); return send(res, 202, publicJob(j)); }
    if (url.pathname === '/api/sweeps' && req.method === 'GET') return send(res, 200, await recent());
    const m = url.pathname.match(/^\/api\/sweeps\/([0-9a-f]+)$/);
    if (m && req.method === 'GET') { const j = await getJob(m[1]); return j ? send(res, 200, j.req ? publicJob(j) : j) : send(res, 404, { error: 'No such sweep' }); }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    return send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
  }
}).listen(PORT, () => console.log(`society-sim v${MODEL_VERSION} on :${PORT}, ${WORKERS} sweep workers, data in ${DATA}`));
