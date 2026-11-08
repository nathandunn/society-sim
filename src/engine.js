// Society Sim engine. Pure ES module: runs in node (calibration, tests) and in a Web Worker.
// One tick = one year. Every person is an agent with genealogy; every birth, death,
// gene change and tech change is logged with its cause and contributing factors.

import { DEFAULT_PARAMS, TECHS, DOMAINS, CAUSES, MODEL_VERSION } from './params.js';
import { GENES, GENE_KEYS, mutateGene, cloneGenome } from './genome.js';
import { buildWorld, ENVIRONMENTS } from './world.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLORS = ['#c2410c', '#1d4ed8', '#15803d', '#a21caf', '#b45309', '#0e7490'];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sigmoid = x => 1 / (1 + Math.exp(-x));

export function deepMerge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over || {})) {
    const v = over[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object') out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
}

export function runSim(cfg) {
  let P = deepMerge(DEFAULT_PARAMS, cfg.params || {});
  const rng = mulberry32(cfg.seed ?? 1);
  const R = () => rng();
  const pick = arr => arr[Math.floor(R() * arr.length)];
  const normal = () => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const years = P.years;
  const nFounders = cfg.genomes.length;

  // ---------- World ----------
  const envKey = ENVIRONMENTS[P.env] ? P.env : 'forest';
  const W = buildWorld(envKey, P, R);
  P = deepMerge(deepMerge(DEFAULT_PARAMS, W.params || {}), cfg.params || {}); // defaults < world < user tuning
  const G = W.G;
  const patches = W.patches;
  patches.forEach(pt => { pt.fertNow = pt.fert; pt.lastFarmed = -99; pt.farmers = 0; });
  const patchAt = (x, y) => patches[clamp(Math.round(y), 0, G - 1) * G + clamp(Math.round(x), 0, G - 1)];
  const reqOf = t => (W.techReq && W.techReq[t]) || TECHS[t].req;
  const envHas = { arable: patches.some(p => p.land && p.arable), water: patches.some(p => p.water), grass: patches.some(p => p.grass), oasis: patches.some(p => p.oasis) };
  let curYear = 0;

  // ---------- Logging ----------
  const events = [];
  const log = (e) => { events.push(e); return e; };

  // ---------- People ----------
  const people = [];
  let nextId = 1;
  let popVer = 0, memCache = { ver: -1, map: new Map() };
  const setSoc = (p, id) => { p.soc = id; popVer++; };
  const byId = new Map();
  function makePerson(o) {
    const p = {
      id: nextId++, sex: o.sex, born: o.born, mother: o.mother || 0, father: o.father || 0,
      soc: o.soc, status: o.status || 'free', spouses: [], alive: true, died: null, cause: null,
      skill: o.skill || Object.fromEntries(DOMAINS.map(d => [d, 0.05])),
      coop: clamp(o.coop ?? 0.5, 0, 1), aggr: clamp(o.aggr ?? 0.5, 0, 1), flair: R(),
      lastBirth: -99, kids: [], matriline: o.matriline || 0, patriline: o.patriline || 0,
      ancestry: o.ancestry || new Array(nFounders).fill(0), freedYear: o.freedYear ?? null, imm: null,
      foodRatio: 1, activity: null, raided: false, origin: o.soc, wealth: 0, wealthRank: 0,
    };
    if (!p.matriline) p.matriline = p.id;
    if (!p.patriline) p.patriline = p.id;
    people.push(p); byId.set(p.id, p); popVer++;
    return p;
  }
  const age = (p, y) => y - p.born;
  const aliveSpouses = p => p.spouses.filter(id => byId.get(id)?.alive);

  // ---------- Societies ----------
  const societies = [];
  function makeSociety(genome, name, home, parent = null) {
    const s = {
      id: societies.length, name, color: parent !== null ? societies[parent].color : COLORS[societies.length % COLORS.length], genome: cloneGenome(genome),
      home, alive: true, techs: new Set(), stores: new Map(), grievance: {}, trust: {}, tradeLink: {},
      leader: 0, cohesionPenalty: 0, lastRaidYear: -99, lastPressure: {}, parent, founded: 0, ended: null,
      endReason: null, popHistory: [], epidemicThisYear: false, foodRatio: 1, tradeBonus: 0, pendingStrains: [], outbreakStrain: null,
      ritualLogged: genome.ritual, herds: new Map(), prod: {}, farmShare: 0, herdShare: 0, sedentary: false, graze: 1, tribute: 0,
    };
    societies.push(s);
    return s;
  }
  const homes = W.homes.concat([{ x: Math.floor(G / 2), y: 3 }, { x: Math.floor(G / 2), y: G - 4 }]);
  cfg.genomes.forEach((g, i) => makeSociety(g, (cfg.names && cfg.names[i]) || `Society ${String.fromCharCode(65 + i)}`, homes[i % homes.length]));

  // founders: a plausible forager age pyramid
  function founderAge() {
    const r = R();
    if (r < 0.30) return Math.floor(R() * 12);
    if (r < 0.48) return 12 + Math.floor(R() * 10);
    if (r < 0.88) return 22 + Math.floor(R() * 28);
    return 50 + Math.floor(R() * 22);
  }
  societies.forEach(s => {
    for (let k = 0; k < P.startPerSociety; k++) {
      const sex = R() < P.sexRatioMale ? 'M' : 'F';
      const a = founderAge();
      const adult = a >= 15;
      const sk = d => adult ? 0.25 + R() * 0.45 : 0.05 + R() * 0.1;
      const skill = { plant: sk(), hunt: sk(), fish: sk(), farm: W.startSkills.farm ? sk() : 0.05, herd: W.startSkills.herd ? sk() : 0.05, fight: sk(), heal: sk() * 0.6, craft: sk() * 0.8 };
      const anc = new Array(nFounders).fill(0); anc[s.id] = 1;
      // founders belong to ~6 clans per society so kin sharing starts with real lineages
      const clan = -(s.id * 100 + 1 + Math.floor(R() * 6));
      makePerson({ sex, born: -a, soc: s.id, skill, coop: 0.5 + normal() * 0.18, aggr: 0.5 + normal() * 0.18, ancestry: anc, matriline: clan, patriline: clan - 50 });
    }
  });
  // founders: pair up existing adults so year 0 has families
  societies.forEach(s => {
    const W = people.filter(p => p.soc === s.id && p.sex === 'F' && -p.born >= 18);
    const M = people.filter(p => p.soc === s.id && p.sex === 'M' && -p.born >= 20);
    W.forEach((w, i) => { const m = M[i]; if (m && s.genome.marriage !== 'open') { w.spouses.push(m.id); m.spouses.push(w.id); } });
    const kids = people.filter(p => p.soc === s.id && -p.born < 15);
    kids.forEach(k => { const mom = pick(W.length ? W : [null]); if (mom) { k.mother = mom.id; k.matriline = mom.matriline; mom.kids.push(k.id);
      const dad = byId.get(mom.spouses[0]); if (dad) { k.father = dad.id; k.patriline = dad.patriline; dad.kids.push(k.id); } } });
  });

  // ---------- Series ----------
  const series = { climate: [], shocks: [], env: envKey };
  const sseries = []; // per society
  function ensureSeries(s) {
    if (!sseries[s.id]) {
      const z = () => new Array(years).fill(null);
      const sd = { pop: z(), births: z(), deaths: z(), food: z(), gini: z(), techs: z(), warDeaths: z(), slaves: z(),
        ritual: z(), cohesion: z(), raidsMade: z(), raidsSuffered: z(), unpaired: z(), polygyny: z(), ancestry: z(),
        herds: z(), fields: z(), wealthGini: z(), sedentary: z(),
        deathsByCause: {}, skill: {}, prod: {} };
      ['plant', 'hunt', 'fish', 'farm', 'herd'].forEach(a => sd.prod[a] = z());
      CAUSES.forEach(c => sd.deathsByCause[c] = z());
      DOMAINS.forEach(d => sd.skill[d] = z());
      sseries[s.id] = sd;
    }
    return sseries[s.id];
  }
  societies.forEach(ensureSeries);

  // ---------- Helpers ----------
  const members = (s) => {
    if (memCache.ver !== popVer) {
      const m = new Map();
      for (const p of people) if (p.alive) { let a = m.get(p.soc); if (!a) m.set(p.soc, a = []); a.push(p); }
      memCache = { ver: popVer, map: m };
    }
    return memCache.map.get(s.id) || [];
  };
  const has = (s, t) => s.techs.has(t);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const homeIsle = s => patchAt(s.home.x, s.home.y).isle;
  const reach = (s, pt) => pt.land && (!W.islands || pt.isle === homeIsle(s) || has(s, 'boats'));
  const canRaid = (A, B) => !W.islands || homeIsle(A) === homeIsle(B) || has(A, 'boats');
  const inContact = (A, B) => !W.islands || homeIsle(A) === homeIsle(B) || has(A, 'boats') || has(B, 'boats');
  const waterNear = (pt, s) => {
    if (!W.waterRange) return true;
    const r = W.waterRange + (s && has(s, 'wells') ? 2 : 0);
    return patches.some(q => q.water && Math.abs(q.x - pt.x) <= r && Math.abs(q.y - pt.y) <= r && dist(q, pt) <= r);
  };
  function lineKey(p, g) {
    if (g.descent === 'matrilineal') return 'm' + p.matriline;
    if (g.descent === 'patrilineal') return 'p' + p.patriline;
    if (g.descent === 'communal') return 'all';
    return (Math.abs(p.matriline) % 2 ? 'm' + p.matriline : 'p' + p.patriline);
  }
  function headOf(p, g) {
    let q = p;
    if (curYear - q.born < 15) { const m = byId.get(q.mother); if (m && m.alive && m.soc === q.soc) q = m; }
    const sp = q.spouses.map(id => byId.get(id)).filter(z => z && z.alive && z.soc === q.soc);
    if (!sp.length) return q;
    const husband = q.sex === 'M' ? q : sp[0], wife = q.sex === 'F' ? q : sp[0];
    return g.descent === 'matrilineal' ? wife : husband;
  }
  // who owns fields and herds, by the Property gene
  function ownerKey(p, s) {
    const g = s.genome;
    if (g.property === 'communal') return 'all';
    if (g.property === 'ruler') return 'ruler';
    if (g.property === 'lineage') return lineKey(p, g);
    return 'i' + headOf(p, g).id;
  }
  const canUse = (p, s, key) => key === 'all' || key === 'ruler' || key === ownerKey(p, s);
  // ---------- Contagious disease ----------
  const strains = [];
  const KINDS = {
    respiratory: { R0: [2, 4.5], cfr: [0.03, 0.1], names: ['cough', 'chest fever', 'wheeze', 'throat sickness'] },
    gut: { R0: [1.5, 3], cfr: [0.04, 0.14], names: ['flux', 'bloody flux', 'gut fever', 'wasting sickness'] },
    fever: { R0: [1.2, 2.5], cfr: [0.05, 0.18], names: ['fever', 'shaking fever', 'sweating sickness', 'yellow fever'] },
    pox: { R0: [3, 6], cfr: [0.1, 0.3], names: ['pox', 'spotted sickness', 'blister fever', 'red pox'] },
  };
  const COLOURS = ['red', 'grey', 'black', 'white', 'spotted', 'summer', 'winter', 'river', 'marsh', 'hill'];
  const SOURCE_KINDS = { wild: ['fever', 'gut', 'respiratory'], herd: ['pox', 'respiratory', 'gut', 'fever'], crowd: ['gut', 'respiratory', 'pox'] };
  function newStrain(source, y) {
    const kinds = SOURCE_KINDS[source];
    const kind = kinds[Math.floor(R() * kinds.length)], K = KINDS[kind];
    const between = ([a, b]) => a + R() * (b - a);
    let name;
    for (let k = 0; k < 6; k++) {
      name = (source === 'herd' && R() < 0.5 ? 'cattle' : COLOURS[Math.floor(R() * COLOURS.length)]) + ' ' + K.names[Math.floor(R() * K.names.length)];
      if (!strains.some(z => z.name === name)) break;
      name += ' ' + roman(strains.length + 1);
    }
    const st = { id: strains.length, name, kind, source, R0: +between(K.R0).toFixed(2), cfr: +between(K.cfr).toFixed(3), born: y };
    strains.push(st);
    return st;
  }
  function spillover(source, y) {
    const known = strains.filter(z => z.source === source);
    return known.length && R() < P.disease.reuse ? known[Math.floor(R() * known.length)] : newStrain(source, y);
  }
  // final size of an outbreak: fraction z of susceptibles infected, z = 1 - exp(-R * s0 * z)
  function finalSize(R, s0) {
    if (R * s0 <= 1) return 0;
    let z = 0.9;
    for (let k = 0; k < 40; k++) z = 1 - Math.exp(-R * s0 * z);
    return z;
  }
  function outbreak(s, st, y, via) {
    const ms = members(s);
    if (!ms.length) return;
    const sus = ms.filter(p => !(p.imm && p.imm.has(st.id)));
    const s0 = sus.length / ms.length;
    let Reff = st.R0 * (s.sedentary ? 1 + P.disease.crowding : 1) * (has(s, 'quarantine') ? 0.6 : 1) * (st.kind === 'gut' && has(s, 'hygiene') ? 0.7 : 1);
    Reff *= Math.min(1, Math.sqrt(ms.length / 40)); // tiny groups have fewer chains of contact
    const z = finalSize(Reff, s0);
    let infected = 0, n = 0;
    const casesIfFizzle = 1 + Math.floor(R() * 3);
    sus.forEach((p, i) => {
      const hit = z > 0 ? R() < z : i < casesIfFizzle && R() < 0.8;
      if (!hit) return;
      infected++;
      const a = age(p, y), deficit = Math.max(0, 1 - p.foodRatio);
      const cfr = Math.min(0.7, st.cfr * (a < 5 ? 2 : a < 15 ? 0.6 : a >= 60 ? 2.5 : 1) * (1 + P.disease.hungerCFR * deficit) *
        (has(s, 'herbal') ? 0.85 : 1) * (p.status === 'slave' ? 1.2 : 1));
      if (R() < cfr) {
        const f = [st.name, via];
        if (deficit > 0.15) f.push('hungry');
        if (s0 > 0.9) f.push('no one immune');
        kill(p, y, 'epidemic', f, { strain: st.id });
        n++;
      } else (p.imm || (p.imm = new Set())).add(st.id);
    });
    s.epidemicThisYear = true;
    (s.outbreaks || (s.outbreaks = [])).push(st.id);
    log({ y, t: 'epidemic', soc: s.id, strain: st.id, name: st.name, kind: st.kind, via, R: +Reff.toFixed(2), susceptible: +s0.toFixed(2), infected, deaths: n });
  }
  function needOf(p, y) {
    const a = age(p, y);
    if (a < 12) return P.adultNeed * P.childNeedFrac * (a < 3 ? 0.6 : 1);
    if (a >= 60) return P.adultNeed * P.elderNeedFrac;
    return P.adultNeed;
  }
  function levelOf(ms, d) {
    const v = ms.map(p => p.skill[d]).sort((a, b) => b - a).slice(0, 3);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  }
  function huntMult(s) { return (has(s, 'spear') ? 1.15 : 1) * (has(s, 'bow') ? 1.3 : 1); }
  function fishMult(s) { return (has(s, 'fishWeir') ? 1.3 : 1) * (has(s, 'boats') ? 1.2 : 1); }
  function plantMult(s) { return has(s, 'pottery') ? 1.08 : 1; }
  function farmMult(s) { return has(s, 'irrigation') ? 1.25 : 1; }
  function herdMult(s) { return has(s, 'dairying') ? 1.2 : 1; }
  function decayOf(s) {
    const base = has(s, 'pottery') ? 0.2 : has(s, 'smoking') ? 0.3 : P.storeDecay;
    return s.farmShare > 0.3 ? Math.min(base, has(s, 'granary') ? 0.12 : 0.25) : base; // grain keeps
  }
  function cohesionOf(s) {
    const g = s.genome;
    const gov = { anarchy: 0, democracy: 0.2, chief: 0.1, totalitarian: 0.15 }[g.governance];
    return clamp(g.ritual * 0.5 + gov + 0.15 - s.cohesionPenalty, 0, 1);
  }
  function isRelated(a, b) {
    if (a.id === b.id) return true;
    if (a.mother && (a.mother === b.mother || a.mother === b.id)) return true;
    if (a.father && (a.father === b.father || a.father === b.id)) return true;
    if (b.mother === a.id || b.father === a.id) return true;
    const am = byId.get(a.mother), bm = byId.get(b.mother);
    if (am && (am.mother === b.id || am.father === b.id)) return true;
    if (bm && (bm.mother === a.id || bm.father === a.id)) return true;
    return false;
  }
  function status(p, s) {
    return 0.4 * (p.skill.hunt + p.skill.fight) / 2 + 0.2 * p.flair + 0.2 * (s.leader === p.id ? 1 : 0) + 0.1 * p.aggr + 0.3 * (p.wealthRank || 0);
  }
  function kill(p, y, cause, factors = [], extra = {}) {
    if (!p.alive) return;
    p.alive = false; p.died = y; p.cause = cause;
    const s = societies[p.soc];
    const sd = ensureSeries(s);
    sd.deaths[y] = (sd.deaths[y] || 0) + 1;
    sd.deathsByCause[cause][y] = (sd.deathsByCause[cause][y] || 0) + 1;
    log({ y, t: 'death', soc: p.soc, who: p.id, sex: p.sex, age: age(p, y), cause, f: factors, ...extra });
    popVer++;
    if (s.genome.property === 'household') inherit(p, s, y);
  }
  // household property passes down the line the descent gene names
  function inherit(p, s, y) {
    const key = 'i' + p.id;
    const herd = s.herds.get(key) || 0;
    const fields = patches.filter(pt => pt.field && pt.field.soc === s.id && pt.field.key === key);
    if (!herd && !fields.length) return;
    const kids = p.kids.map(id => byId.get(id)).filter(k => k && k.alive && k.soc === s.id);
    const d = s.genome.descent;
    const pool = d === 'matrilineal' ? kids.filter(k => k.sex === 'F') : d === 'patrilineal' ? kids.filter(k => k.sex === 'M') : kids;
    const heir = pool.sort((a, b) => a.born - b.born)[0] || aliveSpouses(p).map(id => byId.get(id)).find(q => q && q.soc === s.id);
    const nk = heir ? ownerKey(heir, s) : 'all';
    if (herd) { s.herds.delete(key); s.herds.set(nk, (s.herds.get(nk) || 0) + herd); }
    fields.forEach(pt => { if (heir) pt.field.key = nk; else pt.field = null; });
    if (herd >= 10 || fields.length) log({ y, t: 'inherit', soc: s.id, from: p.id, to: heir ? heir.id : null, herd: Math.round(herd), fields: fields.length });
  }
  function fightersOf(s, y, home = true) {
    const ms = members(s).filter(p => p.status === 'free' || p.status === 'captive');
    const lab = s.genome.labour;
    return ms.filter(p => {
      const a = age(p, y); if (a < 16 || a > 50) return false;
      if (p.sex === 'M') return true;
      if (lab === 'bySkill') return p.skill.fight > 0.45;
      if (lab === 'mixed') return p.skill.fight > 0.55;
      return false;
    });
  }
  function fightPower(p, s, attack) {
    let f = 0.5 + p.skill.fight;
    f *= 1 + (has(s, 'spear') ? 0.15 : 0) + (has(s, 'bow') ? 0.3 : 0);
    if (!attack && has(s, 'shields')) f *= 1.15;
    if (attack && has(s, 'shields')) f *= 1.07;
    if (p.sex === 'F') f *= 0.85;
    return f;
  }

  // founders' starting know-how and herds
  societies.forEach(s => {
    W.startTechs.forEach(t => s.techs.add(t));
    if (W.herdsPerPerson) members(s).forEach(p => { const k = ownerKey(p, s); s.herds.set(k, (s.herds.get(k) || 0) + W.herdsPerPerson); });
  });

  // ---------- Territory ----------
  function assignTerritory() {
    const live = societies.filter(s => s.alive);
    const pops = live.map(s => Math.max(1, members(s).length));
    for (const pt of patches) {
      if (!pt.land) { pt.owner = -1; continue; }
      let best = -1, bd = 1e9;
      live.forEach((s, k) => { const d = (dist(pt, s.home) + (reach(s, pt) ? 0 : 1000)) / Math.sqrt(pops[k]); if (d < bd) { bd = d; best = s.id; } });
      pt.owner = best;
    }
  }

  // ---------- Year loop ----------
  let lastSocietyCount = societies.length;
  for (let y = 0; y < years; y++) {
    curYear = y;
    // --- climate & shocks ---
    const cr = R();
    let climate = 1 + normal() * P.climate.noise, climateTag = 'normal';
    if (cr < P.climate.bad) { climate *= P.climate.badMult; climateTag = 'bad'; }
    else if (cr > 1 - P.climate.good) { climate *= P.climate.goodMult; climateTag = 'good'; }
    series.climate.push(+climate.toFixed(3));
    const shocks = [];
    if (R() < P.shocks.fire) {
      const cx = Math.floor(R() * G), cy = Math.floor(R() * G);
      patches.forEach(pt => { if (Math.hypot(pt.x - cx, pt.y - cy) < 5) { pt.stock.game *= 0.35; pt.stock.plant *= 0.3; } });
      shocks.push('forest fire'); log({ y, t: 'shock', what: 'forest fire', at: [cx, cy] });
    }
    if (R() < P.shocks.storm) {
      patches.forEach(pt => { if (pt.coast) pt.stock.fish *= 0.45; });
      shocks.push('storm'); log({ y, t: 'shock', what: 'storm' });
    }
    if (P.shocks.flood && R() < P.shocks.flood) {
      patches.forEach(pt => { if (pt.arable && pt.fert >= 1) { pt.flooded = y; pt.fertNow = Math.min(1.1, pt.fertNow + 0.1); } });
      shocks.push('river flood'); log({ y, t: 'shock', what: 'river flood' });
    }
    if (P.shocks.rinderpest && R() < P.shocks.rinderpest) {
      societies.forEach(s => { for (const [k, c] of s.herds) s.herds.set(k, c * 0.6); });
      shocks.push('cattle plague'); log({ y, t: 'shock', what: 'cattle plague' });
    }
    patches.forEach(pt => { if (pt.oasis) pt.water = !(climateTag === 'bad' && R() < 0.4); });
    if (climateTag === 'bad' && W.waterRange) shocks.push('drought');
    series.shocks.push(shocks);

    // --- regrowth ---
    for (const pt of patches) for (const r of ['plant', 'game', 'fish']) {
      const K = pt.K[r]; if (!K) continue;
      const s0 = Math.max(pt.stock[r], K * 0.02);
      pt.stock[r] = clamp(s0 + P.regrow[r] * s0 * (1 - s0 / K) * clamp(climate, 0.5, 1.3), 0, K);
    }
    // mobile bands shift camp toward richer ground every few years; farmers stay put; desert bands follow water
    for (const s of societies.filter(s => s.alive)) {
      if (s.sedentary) continue;
      const dry = W.waterRange && !waterNear(s.home, s);
      if (y % P.campMoveEvery !== 0 && !dry) continue;
      const others = societies.filter(o => o.alive && o !== s);
      const terr = s.genome.foraging !== 'roam';
      const richness = pt => patches.reduce((t, q) => q.land && dist(q, pt) <= 4 ? t + q.stock.plant + q.stock.game + q.stock.fish : t, 0);
      let best = null, bv = -1;
      for (const pt of patches) {
        if (!reach(s, pt) || dist(pt, s.home) > P.campMoveMax * (dry ? 2 : 1)) continue;
        if (terr && !dry && pt.owner !== s.id && pt.owner >= 0) continue;
        if (others.some(o => dist(o.home, pt) < 5)) continue;
        if (!waterNear(pt, s)) continue;
        const v = richness(pt);
        if (v > bv) { bv = v; best = pt; }
      }
      if (best && (best.x !== s.home.x || best.y !== s.home.y) && (dry || bv > richness(s.home) * 1.1)) {
        s.home = { x: best.x, y: best.y };
        if (dry) log({ y, t: 'move', soc: s.id, why: 'water failed', to: [best.x, best.y] });
      }
    }
    assignTerritory();

    const live = societies.filter(s => s.alive);
    for (const s of live) {
      s.epidemicThisYear = false;
      // leader
      const g = s.genome;
      if (g.governance === 'chief' || g.governance === 'totalitarian') {
        const cur = byId.get(s.leader);
        if (!cur || !cur.alive || cur.soc !== s.id) {
          const prev = s.leader;
          const cands = members(s).filter(p => p.status === 'free' && age(p, y) >= 25 && age(p, y) <= 65 &&
            (g.descent === 'matrilineal' ? p.sex === 'F' : g.descent === 'patrilineal' ? p.sex === 'M' : true));
          cands.sort((a, b) => status(b, s) - status(a, s));
          s.leader = cands[0]?.id || 0;
          if (prev && s.leader) {
            log({ y, t: 'leader', soc: s.id, who: s.leader });
            if (R() < P.succesionCrisis) {
              const rivals = members(s).filter(p => p.sex === 'M' && age(p, y) >= 20 && age(p, y) <= 55 && p.id !== s.leader);
              const n = 1 + Math.floor(R() * 3);
              for (let k = 0; k < n && rivals.length; k++) kill(rivals.splice(Math.floor(R() * rivals.length), 1)[0], y, 'succession', ['leader died']);
              s.cohesionPenalty += 0.15;
              log({ y, t: 'succession', soc: s.id, deaths: n });
            }
          }
        }
      } else s.leader = 0;
      s.cohesionPenalty = Math.max(0, s.cohesionPenalty * 0.85);
    }

    // --- foraging, farming, herding ---
    for (const s of live) {
      const g = s.genome, ms = members(s);
      s.prod = { plant: 0, hunt: 0, fish: 0, farm: 0, herd: 0 }; s.tribute = 0;
      const owned = patches.filter(pt => pt.owner === s.id);
      let allowed;
      if (g.foraging === 'roam') allowed = patches.filter(pt => pt.land && dist(pt, s.home) < 12);
      else if (g.foraging === 'territorial') allowed = owned;
      else allowed = owned.filter(pt => (pt.i % 3) !== (y % 3));
      allowed = allowed.filter(pt => reach(s, pt));
      if (!allowed.length) allowed = owned.filter(pt => reach(s, pt));
      if (!allowed.length) allowed = patches.filter(pt => reach(s, pt));
      // daily foraging range around camp; widen to the nearest dozen patches if the range is thin
      let ranged = allowed.filter(pt => dist(pt, s.home) <= P.forageRadius);
      if (ranged.length < 12) ranged = allowed.slice().sort((a, b) => dist(a, s.home) - dist(b, s.home)).slice(0, 12);
      allowed = ranged;
      const fishAllowed = allowed.filter(pt => pt.K.fish > 0);
      const farming = has(s, 'cultivation');
      const fieldPool = farming ? patches.filter(pt => pt.arable && reach(s, pt) && dist(pt, s.home) <= P.forageRadius &&
        (pt.field ? pt.field.soc === s.id : pt.owner === s.id)) : [];
      fieldPool.forEach(pt => { pt.farmers = 0; });
      const herding = has(s, 'herding');
      const untended = new Map(s.herds);
      const pool = g.sharing === 'household' ? 0 : g.sharing === 'kin' ? 0.4 : g.sharing === 'ruler' ? 0.8 : 1;
      const enforce = { gossip: 0.3, fines: 0.6, violence: 0.75, exile: 0.65 }[g.enforcement];
      const cohesion = cohesionOf(s);
      for (const p of ms) {
        p.harvest = 0; p.activity = null; p.raided = false;
        const a = age(p, y);
        if (a < P.workFrom || a > P.workTo) continue;
        let eff = a < 16 ? 0.6 : a > 55 ? 0.8 : 1;
        const nursing = p.sex === 'F' && y - p.lastBirth < P.nursingYears;
        let effort = 1 - P.freeRiderLoss * (1 - p.coop) * pool * (1 - enforce) + cohesion * 0.05;
        if (g.governance === 'totalitarian') effort += 0.12;
        if (p.status === 'slave') effort = P.slaveEffort;
        eff *= effort;
        const options = [];
        const opt = (act, rate, sk, ptList) => {
          if (!ptList.length) return;
          let best = null, bv = -1;
          for (let k = 0; k < 4; k++) {
            const pt = ptList[Math.floor(R() * ptList.length)];
            const res = act === 'hunt' ? 'game' : act;
            const stockF = Math.min(1, pt.stock[res] / (P.rate[res] * 0.6));
            const v = rate * stockF * Math.max(0.2, 1 - P.travelCost * dist(pt, s.home));
            if (v > bv) { bv = v; best = pt; }
          }
          options.push({ act, v: bv * (0.6 + 0.4 * sk), pt: best });
        };
        const hPen = nursing ? 0.5 : 1, gPen = nursing ? 0.85 : 1;
        opt('plant', P.rate.plant * plantMult(s) * gPen, p.skill.plant, allowed);
        opt('hunt', P.rate.game * huntMult(s) * hPen, p.skill.hunt, allowed);
        opt('fish', P.rate.fish * fishMult(s) * gPen, p.skill.fish, fishAllowed);
        if (fieldPool.length) {
          // work a field you may use that still has room; clear new ground only when those are full
          let best = null, bv = -1;
          const fv = pt => P.rate.farm * farmMult(s) * pt.fertNow * Math.max(0.3, 1 - P.travelCost * dist(pt, s.home)); // settled yield
          for (const pt of fieldPool) {
            if (!pt.field || pt.farmers >= P.farmersPerField || !canUse(p, s, pt.field.key)) continue;
            const v = fv(pt); if (v > bv) { bv = v; best = pt; }
          }
          if (!best || bv < P.rate.farm * 0.45) {
            for (let k = 0; k < 6; k++) {
              const pt = fieldPool[Math.floor(R() * fieldPool.length)];
              if (pt.field) continue;
              const v = fv(pt) * 0.9; if (v > bv) { bv = v; best = pt; }
            }
          }
          if (best) options.push({ act: 'farm', v: bv * (0.4 + 0.6 * p.skill.farm) * gPen, pt: best });
        }
        if (herding && untended.size) {
          let acc = 0;
          for (const [k, c] of untended) if (c > 0.5 && canUse(p, s, k)) acc += c;
          if (acc > 0.5) {
            const t = Math.min(P.herdPerHerder, acc);
            options.push({ act: 'herd', v: t * P.herdYield * herdMult(s) * (s.graze ?? 1) * (0.6 + 0.4 * p.skill.herd) * hPen, tend: t });
          }
        }
        let choice;
        const male = ['hunt', 'fish', 'herd', 'farm'], female = ['plant', 'fish', 'farm', 'herd']; // men clear, plough and take the far grazing; women gather, hoe, milk and herd near camp
        const sexDefault = () => options.filter(o => (p.sex === 'M' ? male : female).includes(o.act)).sort((a, b) => b.v - a.v)[0];
        const bestAny = () => options.slice().sort((a, b) => b.v - a.v)[0];
        if (g.labour === 'bySex') choice = sexDefault() || bestAny();
        else if (g.labour === 'bySkill') choice = bestAny();
        else choice = (R() < 0.5 ? sexDefault() : bestAny()) || bestAny();
        if (!choice) continue;
        let got = choice.v * eff;
        if (choice.act === 'farm') {
          const pt = choice.pt;
          got *= Math.pow(clamp(climate, 0.2, 1.5), has(s, 'irrigation') ? 0.6 : 1.4) * Math.max(0, 1 + normal() * 0.12) * (pt.flooded === y ? 0.2 : 1);
          if (!pt.field) {
            got *= 0.5; // the first year goes into clearing
            pt.field = { soc: s.id, key: ownerKey(p, s) };
            if (s.firstField == null) { s.firstField = y; log({ y, t: 'farming', soc: s.id }); }
          }
          pt.farmers++; pt.lastFarmed = y;
          pt.fertNow = Math.max(pt.fert * 0.4, pt.fertNow - P.fieldDepletion);
        } else if (choice.act === 'herd') {
          got *= Math.pow(clamp(climate, 0.3, 1.5), 0.5) * Math.max(0, 1 + normal() * 0.12);
          let t = choice.tend;
          for (const [k, c] of untended) { if (t <= 0) break; if (c > 0.5 && canUse(p, s, k)) { const d = Math.min(c, t); untended.set(k, c - d); t -= d; } }
        } else {
          const res = choice.act === 'hunt' ? 'game' : choice.act;
          got *= climate;
          if (choice.act === 'hunt') got *= Math.max(0, 1 + normal() * P.gameVariance);
          else got *= Math.max(0, 1 + normal() * 0.15);
          got = Math.min(got, choice.pt.stock[res] * 0.6);
          choice.pt.stock[res] -= got;
          if (!has(s, 'smoking')) got *= 1 - P.gluttLoss;
          if (choice.pt.owner !== s.id && choice.pt.owner >= 0) {
            const o = societies[choice.pt.owner];
            if (o.genome.foraging !== 'roam') o.grievance[s.id] = (o.grievance[s.id] || 0) + 0.004;
          }
        }
        if (g.property === 'ruler' && (choice.act === 'farm' || choice.act === 'herd') && p.id !== s.leader) { const tr = got * 0.25; s.tribute += tr; got -= tr; }
        p.harvest = got; p.activity = choice.act; s.prod[choice.act] += got;
      }
      if (s.tradeBonus) ms.forEach(p => { if (p.harvest) p.harvest *= 1 + s.tradeBonus; });
      // herds graze, breed and die
      const total = [...s.herds.values()].reduce((a, b) => a + b, 0);
      if (total > 0.5) {
        const need = total * P.herdGraze;
        const pasture = patches.filter(pt => reach(s, pt) && !pt.field && dist(pt, s.home) <= P.forageRadius + 2);
        const avail = pasture.reduce((t, pt) => t + pt.stock.plant * 0.5, 0);
        const take = Math.min(need, avail);
        if (avail > 0) pasture.forEach(pt => { pt.stock.plant -= pt.stock.plant * 0.5 * (take / avail); });
        const graze = need ? take / need : 1;
        s.graze = graze;
        for (const [k, c] of s.herds) {
          const f = c ? 1 - (untended.get(k) || 0) / c : 0;
          const nc = c * (1 + P.herdGrowth * graze * (0.4 + 0.6 * f) - (1 - graze) * 0.3 - (1 - f) * 0.08 - (climateTag === 'bad' ? 0.12 : 0));
          if (nc < 0.5) s.herds.delete(k); else s.herds.set(k, nc);
        }
      }
      const tot = Object.values(s.prod).reduce((a, b) => a + b, 0) || 1;
      s.farmShare = s.prod.farm / tot; s.herdShare = s.prod.herd / tot;
      const wasSed = s.sedentary;
      s.sedentary = s.sedentary ? s.farmShare > 0.12 : s.farmShare > 0.45; // villages abandon their fields only when farming has all but failed
      if (s.sedentary !== wasSed) log({ y, t: 'sedentary', soc: s.id, on: s.sedentary, share: +s.farmShare.toFixed(2) });
    }
    // fallow fields recover; long-abandoned fields go back to the wild
    for (const pt of patches) {
      if (!pt.arable) continue;
      if (!pt.farmers || pt.lastFarmed !== y) pt.fertNow = Math.min(pt.fert, pt.fertNow + P.fieldRecovery * (pt.fert - pt.fertNow + 0.05));
      if (pt.field && y - pt.lastFarmed > 15) pt.field = null;
    }
    // wealth: fields and herds per person, ranked within each society (feeds status and polygyny)
    for (const s of live) {
      const ms = members(s);
      const kw = new Map();
      for (const [k, c] of s.herds) kw.set(k, (kw.get(k) || 0) + c * P.herdYield);
      for (const pt of patches) if (pt.field && pt.field.soc === s.id) kw.set(pt.field.key, (kw.get(pt.field.key) || 0) + P.rate.farm * pt.fertNow);
      const ruler = kw.get('ruler') || 0, common = kw.get('all') || 0;
      const keyOfP = new Map(ms.map(p => [p.id, ownerKey(p, s)]));
      const size = new Map(); keyOfP.forEach(k => size.set(k, (size.get(k) || 0) + 1));
      const L = byId.get(s.leader);
      const lk = L ? keyOfP.get(L.id) : null;
      ms.forEach(p => {
        const k = keyOfP.get(p.id);
        let w = (k === 'all' || k === 'ruler') ? 0 : (kw.get(k) || 0) / (size.get(k) || 1);
        w += common / Math.max(1, ms.length);
        if (ruler && k === lk) w += ruler / (size.get(lk) || 1);
        p.wealth = w;
      });
      const sorted = ms.slice().sort((a, b) => a.wealth - b.wealth);
      sorted.forEach((p, i) => { p.wealthRank = sorted.length > 1 ? i / (sorted.length - 1) : 0; });
      const sd = ensureSeries(s);
      sd.wealthGini[y] = +gini(ms.map(p => p.wealth)).toFixed(3);
    }

    // --- sharing & consumption ---
    for (const s of live) {
      const g = s.genome, ms = members(s);
      const ritualCost = g.ritual * 0.04;
      // group key for each person
      const hearthOf = (p) => {
        const a = age(p, y);
        if (a < 15) { const m = byId.get(p.mother); if (m && m.alive && m.soc === s.id) return hearthOf(m); }
        if (p.sex === 'M') { const w = aliveSpouses(p).map(id => byId.get(id)).find(w => w.soc === s.id); if (w) return 'h' + w.id; }
        return 'h' + p.id;
      };
      const lineOf = (p) => {
        if (g.descent === 'matrilineal') return 'm' + p.matriline;
        if (g.descent === 'patrilineal') return 'p' + p.patriline;
        if (g.descent === 'communal') return 'all';
        return (Math.abs(p.matriline) % 2 ? 'm' + p.matriline : 'p' + p.patriline);
      };
      let keyOf;
      if (g.sharing === 'household') keyOf = hearthOf;
      else if (g.sharing === 'kin') keyOf = lineOf;
      else keyOf = () => 'all';
      const groups = new Map();
      for (const p of ms) {
        const k = keyOf(p);
        if (!groups.has(k)) groups.set(k, { food: 0, need: 0, people: [] });
        const gr = groups.get(k);
        gr.people.push(p); gr.need += needOf(p, y);
      }
      // production: polygynous men split among wives' hearths
      for (const p of ms) {
        if (!p.harvest) continue;
        if (g.sharing === 'household' && p.sex === 'M') {
          const ws = aliveSpouses(p).map(id => byId.get(id)).filter(w => w.soc === s.id);
          if (ws.length > 1) { ws.forEach(w => groups.get(keyOf(w)).food += p.harvest / ws.length); continue; }
        }
        groups.get(keyOf(p)).food += p.harvest;
      }
      if (s.tribute) {
        const L = byId.get(s.leader);
        const gk = L && L.alive && L.soc === s.id ? keyOf(L) : groups.keys().next().value;
        if (gk !== undefined && groups.has(gk)) groups.get(gk).food += s.tribute;
      }
      let totFood = 0, totNeed = 0;
      const ratios = [];
      const leaderKin = new Set();
      if (g.sharing === 'ruler' && s.leader) {
        const L = byId.get(s.leader);
        if (L) { leaderKin.add(L.id); aliveSpouses(L).forEach(id => leaderKin.add(id)); L.kids.forEach(id => leaderKin.add(id)); }
      }
      // demand sharing: groups in surplus pass part of it to hungry groups in the same camp
      if (groups.size > 1) {
        const share = g.sharing === 'household' ? 0.15 : 0.3;
        let pot = 0;
        for (const [k, gr] of groups) { const av = gr.food + (s.stores.get(k) || 0); if (av > gr.need) { const give = (av - gr.need) * share; gr.food -= give; pot += give; } }
        const short = [...groups.values()].filter(gr => gr.food + 0 < gr.need);
        const gap = short.reduce((t, gr) => t + (gr.need - gr.food), 0);
        if (gap > 0) short.forEach(gr => gr.food += pot * (gr.need - gr.food) / gap);
      }
      for (const [k, gr] of groups) {
        const stored = s.stores.get(k) || 0;
        let avail = gr.food * (1 - ritualCost) + stored;
        totFood += gr.food; totNeed += gr.need;
        // the chief's storehouse: tribute goes into it, his household eats well from it,
        // and in a hungry year he hands part of it out (chiefly redistribution as famine insurance)
        if (g.sharing === 'ruler' && leaderKin.size) {
          const elite = gr.people.filter(p => leaderKin.has(p.id));
          const rest = gr.people.filter(p => !leaderKin.has(p.id));
          const eliteNeed = elite.reduce((a, p) => a + needOf(p, y), 0);
          const restNeed = rest.reduce((a, p) => a + needOf(p, y), 0);
          const tribute = avail * P.eliteCut;
          avail -= tribute;
          let store = (s.stores.get('chief') || 0) + tribute;
          // the chief's household is fed first: from the store, then from the common pot
          const want = eliteNeed * P.eliteEat;
          let eaten = Math.min(store, want); store -= eaten;
          if (eaten < eliteNeed) { const more = Math.min(avail, eliteNeed - eaten); eaten += more; avail -= more; }
          elite.forEach(p => p.foodRatio = eliteNeed ? Math.min(1, eaten / eliteNeed) : 1);
          let released = 0;
          if (avail < restNeed && store > 0) { released = Math.min(store * P.chiefRelease, restNeed - avail); avail += released; store -= released; }
          s.stores.set('chief', store * (1 - decayOf(s)));
          if (released > restNeed * 0.1 && y - (s.lastRelief || -99) > 4) { s.lastRelief = y; log({ y, t: 'relief', soc: s.id, kcal: Math.round(released), who: s.leader }); }
          distribute(rest, avail, k, s, y, ratios);
          elite.forEach(p => ratios.push(p.foodRatio));
        } else distribute(gr.people, avail, k, s, y, ratios);
      }
      // orphans under household sharing get a little mercy from the camp
      s.foodRatio = totNeed ? clamp((totFood + [...s.stores.values()].reduce((a, b) => a + b, 0) * 0) / totNeed, 0, 3) : 1;
      s.meanRatio = ratios.length ? ratios.reduce((a, b) => a + Math.min(1, b), 0) / ratios.length : 1;
      ensureSeries(s).gini[y] = +gini(ratios).toFixed(3);
      ensureSeries(s).food[y] = +s.meanRatio.toFixed(3);
    }
    function distribute(list, avail, key, s, y, ratios) {
      const g = s.genome;
      const need = list.reduce((a, p) => a + needOf(p, y), 0);
      if (!list.length) { s.stores.set(key, avail * (1 - decayOf(s))); return; }
      if (avail >= need) {
        list.forEach(p => { p.foodRatio = 1; ratios.push(1); });
        s.stores.set(key, Math.min(need * 1.5, (avail - need) * (1 - decayOf(s))));
        return;
      }
      s.stores.set(key, 0);
      // shortage: weights by famine policy
      const w = p => {
        const a = age(p, y);
        if (g.famine === 'neither' && a >= 60) return 0.6;
        if (p.status === 'slave') return 0.7;
        return 1;
      };
      const wsum = list.reduce((acc, p) => acc + needOf(p, y) * w(p), 0);
      const k = avail / wsum;
      list.forEach(p => { p.foodRatio = clamp(k * w(p), 0, 1); ratios.push(p.foodRatio); });
    }

    // --- mortality ---
    for (const s of live) {
      const ms = members(s);
      const g = s.genome;
      const storesEmpty = [...s.stores.values()].reduce((a, b) => a + b, 0) < 1;
      for (const p of ms) {
        const a = age(p, y);
        const f = [];
        let hInf = 0;
        if (a < 15) {
          hInf = P.infantA * Math.exp(-P.infantB * a);
          if (a === 0) hInf *= (has(s, 'midwifery') ? 0.8 : 1);
          hInf *= has(s, 'hygiene') ? 0.9 : 1;
          if (a < 10) {
            const dad = byId.get(p.father);
            if (dad && dad.alive && dad.soc === p.soc) {
              const wives = aliveSpouses(dad).length;
              const care = { monogamy: 0.85, serial: 0.88, polyandry: 0.84, polygyny: 0.84 + 0.04 * Math.max(0, wives - 1), open: 0.95 }[g.marriage];
              hInf *= care;
            } else { hInf *= 1.08; f.push('fatherless'); }
            const mom = byId.get(p.mother);
            const gm = mom && byId.get(mom.mother);
            const pgm = byId.get(byId.get(p.father)?.mother);
            if (g.residence !== 'patrilocal' && gm && gm.alive && gm.soc === p.soc) hInf *= 0.88;
            else if (g.residence === 'patrilocal' && pgm && pgm.alive && pgm.soc === p.soc) hInf *= 0.93;
            if (!mom || !mom.alive) { hInf *= 1.6; f.push('motherless'); }
          }
          if (a === 0 && !has(s, 'midwifery')) f.push('no midwife');
        }
        const slaveM = p.status === 'slave' ? 1.25 : 1;
        const hungerM = 1 + P.hungerIllness * Math.max(0, 1 - p.foodRatio); // malnutrition-infection synergy: most hunger deaths are illness deaths
        hInf *= hungerM;
        const hInfect = P.bgInfection * (has(s, 'herbal') ? 0.6 : 1) * (has(s, 'hygiene') ? 0.8 : 1) * slaveM * hungerM * (1 + 0.4 * s.farmShare + 0.3 * s.herdShare);
        const hunter = p.activity === 'hunt';
        const hAcc = P.bgAccident * (hunter ? 1.6 : 1) * (has(s, 'boneSetting') ? 0.7 : 1) * (has(s, 'woundCare') ? 0.8 : 1);
        const hOther = P.bgOther * slaveM * hungerM;
        const hOld = P.senA * Math.exp(P.senB * a);
        const deficit = 1 - p.foodRatio;
        const sev = Math.max(0, deficit - P.famineLine) / (1 - P.famineLine); // outright starvation only in true famine
        const hStarve = sev > 0 ? P.starvationHazard * sev * sev * (a < 5 || a > 60 ? 1.5 : 1) : 0;
        if (deficit > 0.15) f.push(deficit > P.famineLine ? 'famine' : 'malnourished');
        if (climateTag === 'bad') f.push('bad year');
        if (storesEmpty && deficit > 0) f.push('stores empty');
        if (p.status === 'slave') f.push('enslaved');
        const comps = [['infant illness', hInf], ['infection', hInfect], ['accident', hAcc], ['other illness', hOther], ['old age', hOld], ['starvation', hStarve]];
        let H = comps.reduce((acc, c) => acc + c[1], 0);
        if (a >= P.maxAge) H = 1;
        H = Math.min(0.97, H);
        if (R() < H) {
          let r = R() * comps.reduce((acc, c) => acc + c[1], 0), cause = 'old age';
          for (const [c, h] of comps) { if ((r -= h) <= 0) { cause = c; break; } }
          kill(p, y, cause, f);
        }
      }
      // contagious disease: strains caught from neighbours last year, then new spillovers
      s.outbreaks = [];
      const pend = s.pendingStrains; s.pendingStrains = [];
      const seen = new Set();
      for (const { strain, via } of pend) { if (seen.has(strain)) continue; seen.add(strain); outbreak(s, strains[strain], y, via); }
      const pop100 = Math.max(1, ms.length) / 100;
      const herdUnits = [...s.herds.values()].reduce((a, b) => a + b, 0);
      if (R() < P.shocks.epidemic * Math.sqrt(pop100)) { const st = spillover('wild', y); if (!seen.has(st.id)) { seen.add(st.id); outbreak(s, st, y, 'caught from wild animals'); } }
      if (herdUnits > 1 && R() < P.disease.spillHerd * herdUnits / 100) { const st = spillover('herd', y); if (!seen.has(st.id)) { seen.add(st.id); outbreak(s, st, y, 'caught from the herds'); } }
      if (s.sedentary && R() < P.disease.spillCrowd * s.farmShare * ms.length / 200) { const st = spillover('crowd', y); if (!seen.has(st.id)) { seen.add(st.id); outbreak(s, st, y, 'bred in crowded villages'); } }
    }

    // --- internal violence, enforcement, slaves ---
    for (const s of live) {
      const g = s.genome, ms = members(s);
      const adultMen = ms.filter(p => p.sex === 'M' && age(p, y) >= 20 && age(p, y) <= 45 && p.status !== 'slave');
      const unpaired = adultMen.filter(p => aliveSpouses(p).length === 0);
      const upFrac = adultMen.length ? unpaired.length / adultMen.length : 0;
      s.unpairedFrac = g.marriage === 'open' ? 0 : upFrac;
      ensureSeries(s).unpaired[y] = +s.unpairedFrac.toFixed(3);
      if (g.marriage !== 'open') for (const p of unpaired) {
        if (R() < P.unpairedViolence * upFrac * 3 * (0.5 + p.aggr)) {
          const rival = adultMen.filter(q => q.alive && q.id !== p.id);
          const victim = R() < 0.5 || !rival.length ? p : pick(rival);
          kill(victim, y, 'mate fight', ['unpaired men ' + Math.round(upFrac * 100) + '%']);
        }
      }
      const low = ms.filter(p => p.alive && age(p, y) >= 16 && p.coop < 0.28 && p.status === 'free');
      if (g.enforcement === 'violence') low.forEach(p => { if (R() < 0.01) kill(p, y, 'punishment', ['free-rider']); });
      if (g.enforcement === 'exile') low.forEach(p => {
        if (R() < 0.03) {
          const dest = societies.filter(o => o.alive && o.id !== s.id && o.genome.outgroup !== 'xenophobic' && inContact(s, o));
          if (dest.length && R() < 0.6) { const d = pick(dest); setSoc(p, d.id); log({ y, t: 'exile', soc: s.id, to: d.id, who: p.id }); }
          else kill(p, y, 'accident', ['exiled']);
        }
      });
      // totalitarian defection
      if (g.governance === 'totalitarian') ms.filter(p => p.alive && p.status === 'free' && age(p, y) >= 16 && age(p, y) < 50).forEach(p => {
        if (R() < P.defection * (1 - cohesionOf(s))) {
          const dest = societies.filter(o => o.alive && o.id !== s.id && o.genome.outgroup !== 'xenophobic' && inContact(s, o));
          if (dest.length) { const d = pick(dest); setSoc(p, d.id); aliveSpouses(p).forEach(() => {}); log({ y, t: 'defect', soc: s.id, to: d.id, who: p.id }); }
        }
      });
      // slaves: escape, revolt, freeing, adoption of captives
      const slaves = ms.filter(p => p.alive && p.status === 'slave');
      ensureSeries(s).slaves[y] = slaves.length;
      const free = ms.filter(p => p.alive && p.status === 'free').length;
      if (slaves.length > 0.25 * free && slaves.length >= 5 && R() < P.slaveRevolt * (slaves.length / Math.max(1, free))) {
        let deaths = 0;
        const masters = ms.filter(p => p.alive && p.status === 'free' && p.sex === 'M' && age(p, y) > 16);
        slaves.forEach(sl => { if (R() < 0.35) { kill(sl, y, 'revolt', ['slave revolt']); deaths++; } });
        masters.forEach(m => { if (R() < 0.08) { kill(m, y, 'revolt', ['slave revolt']); deaths++; } });
        log({ y, t: 'revolt', soc: s.id, deaths });
      }
      slaves.filter(p => p.alive).forEach(sl => {
        if (R() < P.slaveEscape) {
          const home = societies[sl.origin];
          if (home && home.alive && home.id !== s.id && inContact(s, home)) { setSoc(sl, home.id); sl.status = 'free'; log({ y, t: 'escape', soc: s.id, to: home.id, who: sl.id }); }
        }
      });
      ms.filter(p => p.alive && p.status === 'captive' && p.freedYear !== null && y >= p.freedYear).forEach(p => { p.status = 'free'; });
    }

    // --- marriage market ---
    for (const s of live) {
      const g = s.genome, ms = members(s);
      if (g.marriage === 'open') { ms.forEach(p => p.spouses = []); continue; }
      if (g.marriage === 'serial') {
        ms.filter(p => p.sex === 'F' && aliveSpouses(p).length).forEach(w => {
          if (R() < 0.04) { const h = byId.get(aliveSpouses(w)[0]); w.spouses = []; if (h) h.spouses = h.spouses.filter(id => id !== w.id); }
        });
      }
      const maxW = g.marriage === 'polyandry' ? 2 : 1;
      const women = ms.filter(p => p.sex === 'F' && age(p, y) >= P.femaleMarryFrom && age(p, y) <= 45 && aliveSpouses(p).length < maxW);
      const menAll = ms.filter(p => p.sex === 'M' && age(p, y) >= P.maleMarryFrom && age(p, y) <= 65);
      const ranked = menAll.slice().sort((a, b) => status(b, s) - status(a, s));
      const capOf = (m) => {
        if (g.marriage !== 'polygyny') return 1;
        if (m.id === s.leader) return P.polygynyMaxWives + 2;
        const r = ranked.indexOf(m) / Math.max(1, ranked.length);
        return 1 + Math.floor((1 - r) * (1 - r) * (P.polygynyMaxWives - 1) + 0.25);
      };
      const pMarry = g.mateChoice === 'free' ? 0.55 : 0.8;
      // ruler picks first
      if (g.mateChoice === 'ruler' && s.leader) {
        const L = byId.get(s.leader);
        if (L && L.sex === 'M' && aliveSpouses(L).length < capOf(L)) {
          const c = women.filter(w => !aliveSpouses(w).length && !isRelated(w, L)).sort((a, b) => b.born - a.born)[0];
          if (c && R() < 0.5) wed(c, L, y);
        }
      }
      for (const w of shuffle(women)) {
        if (aliveSpouses(w).length >= maxW) continue;
        if (R() > pMarry) continue;
        // intermarriage
        const others = societies.filter(o => o.alive && o.id !== s.id && o.genome.outgroup !== 'xenophobic' && g.outgroup !== 'xenophobic' && inContact(s, o) &&
          (s.grievance[o.id] || 0) < 1 && (o.grievance[s.id] || 0) < 1);
        let pool = menAll, foreign = null;
        if (others.length && R() < (g.outgroup === 'open' ? 0.08 : 0.03)) {
          foreign = pick(others);
          pool = members(foreign).filter(p => p.sex === 'M' && age(p, y) >= P.maleMarryFrom && age(p, y) <= 65);
        }
        const elig = pool.filter(m => aliveSpouses(m).length < (foreign ? 1 : capOf(m)) && !isRelated(w, m) && !aliveSpouses(w).includes(m.id));
        if (!elig.length) continue;
        let m;
        if (g.mateChoice === 'free') {
          const sample = []; for (let k = 0; k < 5; k++) sample.push(pick(elig));
          m = sample.sort((a, b) => status(b, societies[b.soc]) - status(a, societies[a.soc]))[0];
        } else if (g.mateChoice === 'ruler') m = elig.slice().sort((a, b) => status(b, s) - status(a, s))[Math.floor(R() * Math.min(3, elig.length))];
        else m = pick(elig);
        wed(w, m, y);
        if (foreign) {
          const res = g.residence === 'free' ? (R() < 0.5 ? 'matrilocal' : 'patrilocal') : g.residence;
          const mover = res === 'matrilocal' ? m : w;
          const to = res === 'matrilocal' ? s.id : foreign.id;
          const from = mover.soc;
          setSoc(mover, to);
          if (mover === w) w.kids.forEach(id => { const k = byId.get(id); if (k && k.alive && age(k, y) < 12) setSoc(k, to); });
          log({ y, t: 'intermarry', soc: from, to, who: mover.id });
        }
      }
    }
    function wed(w, m, y) { w.spouses.push(m.id); m.spouses.push(w.id); }
    function shuffle(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

    // --- births ---
    for (const s of live) {
      const g = s.genome, ms = members(s);
      const sd = ensureSeries(s);
      const famine = s.meanRatio < 0.75;
      const adultMenOpen = g.marriage === 'open' ? ms.filter(p => p.sex === 'M' && age(p, y) >= 18 && age(p, y) <= 60) : null;
      for (const w of ms) {
        if (w.sex !== 'F' || !w.alive) continue;
        const a = age(w, y);
        if (a < P.femaleFertileFrom || a > P.femaleFertileTo) continue;
        if (y - w.lastBirth < (s.sedentary ? P.nursingYearsSedentary : P.nursingYears)) continue;
        let father;
        if (g.marriage === 'open') { if (!adultMenOpen.length) continue; const cands = adultMenOpen.filter(m => !isRelated(w, m)); if (!cands.length) continue;
          const sample = [pick(cands), pick(cands), pick(cands)]; father = sample.sort((x, z) => status(z, s) - status(x, s))[0]; }
        else { const hs = aliveSpouses(w).map(id => byId.get(id)).filter(h => h.soc === w.soc); if (!hs.length) continue; father = pick(hs); }
        const fa = a < 20 ? 0.7 : a < 35 ? 1 : a < 40 ? 0.7 : 0.35;
        const pc = P.conceptionBase * fa * Math.pow(clamp(w.foodRatio, 0, 1), 3) * (w.status === 'slave' ? 0.8 : 1);
        if (R() >= pc) continue;
        const sex = R() < P.sexRatioMale ? 'M' : 'F';
        const anc = w.ancestry.map((v, i) => (v + father.ancestry[i]) / 2);
        let st = 'free';
        if (w.status === 'slave') st = g.descent === 'matrilineal' ? 'slave' : g.descent === 'patrilineal' ? (father.status === 'slave' ? 'slave' : 'free') : 'free';
        const inherit = d => clamp((w.skill[d] + father.skill[d]) * 0.04, 0.02, 0.1);
        const child = makePerson({ sex, born: y, mother: w.id, father: father.id, soc: w.soc, status: st,
          matriline: w.matriline, patriline: father.patriline, ancestry: anc,
          coop: (w.coop + father.coop) / 2 + normal() * 0.1, aggr: (w.aggr + father.aggr) / 2 + normal() * 0.1,
          skill: Object.fromEntries(DOMAINS.map(d => [d, inherit(d)])) });
        w.kids.push(child.id); father.kids.push(child.id);
        w.lastBirth = y;
        sd.births[y] = (sd.births[y] || 0) + 1;
        log({ y, t: 'birth', soc: s.id, who: child.id, mother: w.id, father: father.id });
        // maternal death
        const md = P.maternalDeath * (has(s, 'midwifery') ? 0.4 : 1) * (w.foodRatio < 0.8 ? 1.5 : 1);
        if (R() < md) kill(w, y, 'childbirth', has(s, 'midwifery') ? [] : ['no midwife']);
        // first-year hazard (births run after the mortality phase, so the newborn's year-0 risk is rolled here)
        let h0 = P.infantA * (has(s, 'midwifery') ? 0.8 : 1) * (has(s, 'hygiene') ? 0.9 : 1) * (w.alive ? 1 : 2.5) * (w.foodRatio < 0.8 ? 1.3 : 1);
        const f0 = [];
        if (!has(s, 'midwifery')) f0.push('no midwife');
        if (!w.alive) f0.push('mother died');
        if (w.foodRatio < 0.8) f0.push('mother hungry');
        if (R() < h0) kill(child, y, 'infant illness', f0);
        if (famine && g.famine === 'infanticide' && R() < 0.5) { kill(child, y, 'infanticide', ['famine']); w.lastBirth = y - 1; }
      }
    }

    // --- conflict ---
    const liveNow = societies.filter(s => s.alive && members(s).length);
    const raidedThisYear = new Set(), raidedPairs = new Set();
    for (const A of liveNow) {
      for (const B of liveNow) {
        if (A === B || !A.alive || !B.alive || !canRaid(A, B)) continue;
        const gA = A.genome;
        const fa = fightersOf(A, y), fb = fightersOf(B, y);
        if (fa.length < 2) continue;
        const strA = fa.reduce((t, p) => t + fightPower(p, A, true), 0);
        const strB = Math.max(0.5, fb.reduce((t, p) => t + fightPower(p, B, false), 0));
        const L = byId.get(A.leader);
        const meanAggr = fa.reduce((t, p) => t + p.aggr, 0) / fa.length;
        let pressure = 1.6 * Math.max(0, 1 - A.meanRatio) + 0.35 * (A.grievance[B.id] || 0) + 2 * (A.unpairedFrac || 0) +
          { xenophobic: 0.4, neutral: 0.15, open: 0 }[gA.outgroup] + clamp(strA / strB - 1, -1, 2) * 0.4 +
          meanAggr * 0.3 - (A.trust[B.id] || 0) * 0.5;
        if (L && (gA.governance === 'chief' || gA.governance === 'totalitarian')) pressure += (L.aggr - 0.5) * 0.8;
        if (gA.governance === 'totalitarian') pressure += 0.3;
        const herdPer = x => [...x.herds.values()].reduce((a, b) => a + b, 0) / Math.max(1, members(x).length);
        if (herdPer(B) > 1 && herdPer(B) > herdPer(A) * 1.2) pressure += 0.35; // livestock envy
        let thr = P.raidThreshold;
        if (gA.governance === 'democracy') { const prev = A.lastPressure[B.id] ?? pressure; A.lastPressure[B.id] = pressure; pressure = prev; thr += 0.15; }
        let pr = P.raidBase * sigmoid(P.raidSlope * (pressure - thr));
        if (gA.governance === 'anarchy') pr *= 0.6;
        if (R() >= pr) continue;
        // party
        let party;
        const sorted = fa.slice().sort((a, b) => b.skill.fight - a.skill.fight);
        if (gA.governance === 'anarchy') party = sorted.filter(p => p.aggr > 0.5).slice(0, 3 + Math.floor(R() * 4));
        else party = sorted.slice(0, Math.max(2, Math.round(fa.length * { democracy: 0.35, chief: 0.5, totalitarian: 0.8 }[gA.governance])));
        if (party.length < 2) continue;
        const cohA = cohesionOf(A), cohB = cohesionOf(B);
        const att = party.reduce((t, p) => t + fightPower(p, A, true), 0) * (1 + cohA * 0.3 + 0.25 + (has(A, 'ambush') ? 0.25 : 0));
        const defenders = fb.filter(() => R() < 0.7);
        const def = Math.max(0.3, defenders.reduce((t, p) => t + fightPower(p, B, false), 0)) *
          (1 + (has(B, 'palisade') ? 0.5 : 0) + (B.genome.foraging === 'territorial' ? 0.2 : 0) + cohB * 0.3);
        const win = R() < Math.pow(att, 1.5) / (Math.pow(att, 1.5) + Math.pow(def, 1.5));
        const wcA = has(A, 'woundCare') ? 0.7 : 1, wcB = has(B, 'woundCare') ? 0.7 : 1;
        let dA = 0, dB = 0;
        party.forEach(p => { p.raided = true; if (R() < (win ? P.casualtyWinner : P.casualtyLoser) * wcA) { kill(p, y, 'raid', ['raiding ' + B.name], { by: B.id }); dA++; } });
        defenders.forEach(p => { if (R() < (win ? P.casualtyLoser : P.casualtyWinner) * wcB) { kill(p, y, 'raid', ['defending vs ' + A.name], { by: A.id }); dB++; } });
        let taken = 0, stolen = 0, rustledThis = 0;
        if (win) {
          members(B).forEach(p => { if (R() < 0.03) { kill(p, y, 'raid', ['camp raided by ' + A.name], { by: A.id }); dB++; } });
          for (const [k, v] of B.stores) { stolen += v * 0.3; B.stores.set(k, v * 0.7); }
          const loot = 'all';
          const lk = A.genome.sharing === 'household' || A.genome.sharing === 'kin' ? [...A.stores.keys()][0] || loot : loot;
          A.stores.set(lk, (A.stores.get(lk) || 0) + stolen);
          let rustled = 0;
          for (const [k, c] of B.herds) { const t = c * 0.3; B.herds.set(k, c - t); rustled += t; }
          if (rustled > 0.5) {
            const keys = party.filter(p => p.alive).map(p => ownerKey(p, A));
            const ks = keys.length ? keys : [ownerKey(party[0], A)];
            ks.forEach(k => A.herds.set(k, (A.herds.get(k) || 0) + rustled / ks.length));
          }
          rustledThis = Math.round(rustled);
          const cands = members(B).filter(p => { const a = age(p, y); return (p.sex === 'F' && a >= 13 && a <= 35) || (a >= 3 && a <= 12); });
          const nCap = Math.min(cands.length, Math.round(party.length * 0.35 * R() + 0.5));
          for (let k = 0; k < nCap; k++) {
            const c = cands.splice(Math.floor(R() * cands.length), 1)[0];
            const pol = A.genome.captives;
            if (pol === 'kill') { kill(c, y, 'killed captive', ['taken by ' + A.name], { by: A.id }); continue; }
            if (pol === 'ransom') { stolen += needOf(c, y) * 0.5; continue; }
            c.spouses.forEach(id => { const h = byId.get(id); if (h) h.spouses = h.spouses.filter(z => z !== c.id); });
            c.spouses = []; setSoc(c, A.id); c.origin = B.id;
            if (pol === 'slave') c.status = 'slave'; else { c.status = 'captive'; c.freedYear = y + 2; }
            taken++;
          }
        }
        A.grievance[B.id] = (A.grievance[B.id] || 0) + dA * 0.15;
        B.grievance[A.id] = (B.grievance[A.id] || 0) + 1 + dB * 0.2 + taken * 0.3;
        A.trust[B.id] = 0; B.trust[A.id] = 0; A.tradeLink[B.id] = 0; B.tradeLink[A.id] = 0;
        A.lastRaidYear = y; B.lastRaidYear = y;
        const sdA = ensureSeries(A), sdB = ensureSeries(B);
        sdA.raidsMade[y] = (sdA.raidsMade[y] || 0) + 1; sdB.raidsSuffered[y] = (sdB.raidsSuffered[y] || 0) + 1;
        sdA.warDeaths[y] = (sdA.warDeaths[y] || 0) + dA; sdB.warDeaths[y] = (sdB.warDeaths[y] || 0) + dB;
        raidedThisYear.add(A.id); raidedThisYear.add(B.id); raidedPairs.add(A.id + '-' + B.id);
        log({ y, t: 'raid', soc: A.id, to: B.id, win, party: party.length, def: defenders.length, dA, dB, taken, stolen: Math.round(stolen), herds: rustledThis,
          f: [A.meanRatio < 0.85 ? 'hunger' : null, (A.grievance[B.id] || 0) > 1 ? 'grievance' : null, (A.unpairedFrac || 0) > 0.25 ? 'unpaired men' : null].filter(Boolean) });
        // conquest
        const popA = members(A).length, popB = members(B).length;
        if (win && att > 3 * def && popB < 0.3 * popA) absorb(B, A, y, 'conquest');
      }
    }
    for (const s of societies) for (const k of Object.keys(s.grievance)) s.grievance[k] *= 0.88;

    // --- trade ---
    const pairs = [];
    for (let i = 0; i < liveNow.length; i++) for (let j = i + 1; j < liveNow.length; j++) pairs.push([liveNow[i], liveNow[j]]);
    for (const [A, B] of pairs) {
      if (!A.alive || !B.alive) continue;
      const ok = s => s.genome.trade !== 'none' && s.genome.outgroup !== 'xenophobic' || s.genome.trade === 'ruler';
      if (!ok(A) || !ok(B) || !inContact(A, B)) { A.tradeLink[B.id] = 0; B.tradeLink[A.id] = 0; continue; }
      if ((A.grievance[B.id] || 0) > 0.8 || (B.grievance[A.id] || 0) > 0.8) continue;
      const migrants = members(A).filter(p => p.origin === B.id).length + members(B).filter(p => p.origin === A.id).length;
      if ((A.genome.trade === 'kin' || B.genome.trade === 'kin') && migrants < 2) continue;
      const link = Math.min(1, (A.tradeLink[B.id] || 0) + 0.1);
      A.tradeLink[B.id] = B.tradeLink[A.id] = link;
      A.trust[B.id] = Math.min(1, (A.trust[B.id] || 0) + 0.05); B.trust[A.id] = Math.min(1, (B.trust[A.id] || 0) + 0.05);
      A.grievance[B.id] = Math.max(0, (A.grievance[B.id] || 0) - 0.1); B.grievance[A.id] = Math.max(0, (B.grievance[A.id] || 0) - 0.1);
      // famine relief: the richer camp sells food to the poorer
      const [rich, poor] = A.meanRatio >= B.meanRatio ? [A, B] : [B, A];
      if (poor.meanRatio < 0.9 && rich.meanRatio >= 1) {
        let moved = 0;
        for (const [k, v] of rich.stores) { const m = v * 0.2; rich.stores.set(k, v - m); moved += m; }
        const k0 = [...poor.stores.keys()][0] || 'all';
        poor.stores.set(k0, (poor.stores.get(k0) || 0) + moved);
        if (moved > 0) log({ y, t: 'trade', soc: rich.id, to: poor.id, kcal: Math.round(moved), what: 'famine relief' });
      }
      for (const [X, Y] of [[A, B], [B, A]]) {
        for (const t of Y.techs) if (!X.techs.has(t) && reqOf(t).every(r => X.techs.has(r)) && R() < P.diffuseTrade * link) {
          X.techs.add(t); log({ y, t: 'tech', soc: X.id, tech: t, via: 'trade with ' + Y.name });
        }
      }
    }
    // outbreaks cross to peoples in contact: trade, raids, and people who moved between them
    for (const X of societies.filter(z => z.alive && z.outbreaks && z.outbreaks.length)) {
      for (const Y of societies.filter(z => z.alive && z !== X && inContact(X, z))) {
        const raided = raidedPairs.has(X.id + '-' + Y.id) || raidedPairs.has(Y.id + '-' + X.id);
        const movers = members(Y).filter(p => p.origin === X.id && curYear - p.born < 60).length;
        const q = has(Y, 'quarantine') ? 0.5 : 1;
        for (const sid of X.outbreaks) {
          let via = null;
          if ((X.tradeLink[Y.id] || 0) > 0 && R() < P.disease.viaTrade * q) via = 'from ' + X.name + ' through trade';
          else if (raided && R() < P.disease.viaRaid) via = 'from ' + X.name + ' in a raid';
          else if (movers && R() < Math.min(0.9, P.disease.viaMigrants * Math.sqrt(movers)) * q) via = 'from ' + X.name + ' through kin and captives';
          if (via) Y.pendingStrains.push({ strain: sid, via });
        }
      }
    }
    for (const s of liveNow) {
      const links = Object.values(s.tradeLink).reduce((a, b) => a + b, 0);
      s.tradeBonus = 0.05 * Math.min(1, links) * (s.genome.trade === 'ruler' ? 0.7 : 1);
    }

    // --- skills & technology ---
    for (const s of societies.filter(s => s.alive)) {
      const ms = members(s), g = s.genome;
      for (const p of ms) {
        const a = age(p, y);
        for (const d of DOMAINS) p.skill[d] = Math.max(0, p.skill[d] - 0.008 * p.skill[d]);
        if (p.activity) { const d = p.activity === 'hunt' ? 'hunt' : p.activity; p.skill[d] += 0.06 * (1 - p.skill[d]); }
        if (p.raided) p.skill.fight += 0.08 * (1 - p.skill.fight);
        if (a >= 16 && a <= 40 && p.sex === 'M' && p.status === 'free') p.skill.fight += 0.02 * (1 - p.skill.fight);
      }
      const healers = ms.filter(p => age(p, y) >= 16 && (g.labour !== 'bySex' || p.sex === 'F' || age(p, y) >= 50)).sort((a, b) => b.skill.heal - a.skill.heal).slice(0, 2);
      healers.forEach(p => p.skill.heal += 0.05 * (1 - p.skill.heal));
      const crafters = ms.filter(p => age(p, y) >= 16).sort((a, b) => b.skill.craft - a.skill.craft).slice(0, 3);
      crafters.forEach(p => p.skill.craft += 0.05 * (1 - p.skill.craft));
      const L = {}; DOMAINS.forEach(d => L[d] = levelOf(ms.filter(p => age(p, y) >= 15), d));
      for (const p of ms) {
        const a = age(p, y);
        if (a < 6 || a > 15) continue;
        const role = d => {
          if (g.labour !== 'bySex') return 1;
          if (p.sex === 'M') return ['hunt', 'fight', 'fish', 'craft'].includes(d) ? 1 : 0.3;
          return ['plant', 'heal', 'fish', 'craft'].includes(d) ? 1 : 0.3;
        };
        DOMAINS.forEach(d => { if (L[d] > p.skill[d]) p.skill[d] += 0.07 * role(d) * (L[d] - p.skill[d]) * (1 + g.ritual * 0.2); });
      }
      const sd = ensureSeries(s);
      DOMAINS.forEach(d => sd.skill[d][y] = +L[d].toFixed(3));
      const innov = { anarchy: 1, democracy: 1.15, chief: 0.9, totalitarian: 0.6 }[g.governance];
      const migFrac = ms.length ? ms.filter(p => p.origin !== s.id).length / ms.length : 0;
      for (const [t, spec] of Object.entries(TECHS)) {
        if (s.techs.has(t)) {
          const kd = spec.keep || spec.domain; // know-how is kept alive by whoever practises it
          if (L[kd] < P.techLossThreshold && R() < 0.08) {
            s.techs.delete(t);
            log({ y, t: 'techLoss', soc: s.id, tech: t, f: [`${kd} skill ${L[kd].toFixed(2)}`] });
          }
          continue;
        }
        if (!reqOf(t).every(r => s.techs.has(r))) continue;
        if (spec.needs && !envHas[spec.needs]) continue;
        const pI = P.inventBase * (spec.rarity ?? 1) * (0.3 + L[spec.domain]) * Math.sqrt(Math.max(1, ms.length) / 50) * innov * (1 + 0.5 * migFrac);
        if (R() < pI) {
          s.techs.add(t);
          const inv = ms.slice().sort((a, b) => b.skill[spec.domain === 'fight' ? 'fight' : spec.domain] - a.skill[spec.domain])[0];
          log({ y, t: 'tech', soc: s.id, tech: t, via: 'invented', who: inv?.id });
        }
        // diffusion through migrants carrying know-how
        for (const o of societies) {
          if (o === s || !o.techs.has(t) || s.techs.has(t)) continue;
          const carriers = ms.filter(p => p.origin === o.id).length;
          if (carriers && R() < P.diffusePerMigrant * carriers) { s.techs.add(t); log({ y, t: 'tech', soc: s.id, tech: t, via: 'migrants from ' + o.name }); }
        }
      }
      sd.techs[y] = s.techs.size;
    }

    // --- cultural evolution ---
    for (const s of societies.filter(s => s.alive)) {
      const g = s.genome;
      // ritual responds to threat whether or not genomes are frozen (it is a dial of lived cohesion)
      const threatened = y - s.lastRaidYear < 25;
      if (!P.freezeGenomes) {
        g.ritual = clamp(g.ritual + (threatened ? 0.002 : -P.ritualDecay), 0, 1);
        if (Math.abs(g.ritual - s.ritualLogged) >= 0.1) {
          log({ y, t: 'gene', soc: s.id, gene: 'ritual', from: +s.ritualLogged.toFixed(2), to: +g.ritual.toFixed(2), via: threatened ? 'threat' : 'peace decay' });
          s.ritualLogged = g.ritual;
        }
        for (const k of GENE_KEYS) {
          if (k === 'ritual') continue;
          if (R() < P.driftRate) {
            const from = g[k]; s.genome = mutateGene(s.genome, k, R);
            log({ y, t: 'gene', soc: s.id, gene: k, from, to: s.genome[k], via: 'drift' });
          }
        }
        const succ = (x) => {
          const h = x.popHistory; const n = h.length;
          const growth = n > 20 ? (h[n - 1] - h[n - 21]) / Math.max(10, h[n - 21]) : 0;
          return growth + (x.meanRatio || 1) - 1;
        };
        for (const o of societies.filter(o => o.alive && o !== s)) {
          const contact = (s.tradeLink[o.id] || 0) > 0 || members(s).filter(p => p.origin === o.id).length >= 3;
          if (!contact) continue;
          const diff = succ(o) - succ(s);
          if (diff > 0.1 && R() < P.imitateRate * diff * 3) {
            const differing = GENE_KEYS.filter(k => k !== 'ritual' && k !== 'fission' && s.genome[k] !== o.genome[k]);
            if (differing.length) {
              const k = pick(differing), from = s.genome[k];
              s.genome = { ...s.genome, [k]: o.genome[k] };
              log({ y, t: 'gene', soc: s.id, gene: k, from, to: o.genome[k], via: 'imitating ' + o.name, f: [`${o.name} doing better by ${(diff * 100).toFixed(0)}%`] });
            }
          }
        }
      }
      const sd = ensureSeries(s);
      sd.ritual[y] = +s.genome.ritual.toFixed(3);
      sd.cohesion[y] = +cohesionOf(s).toFixed(3);
    }

    // --- fission, merger, extinction ---
    for (const s of societies.filter(s => s.alive)) {
      const ms = members(s);
      if (ms.length > s.genome.fission && societies.filter(x => x.alive).length < P.maxSocieties) fission(s, y);
    }
    for (const s of societies.filter(s => s.alive)) {
      const ms = members(s);
      const adults = ms.filter(p => age(p, y) >= 15);
      if (!ms.length) { s.alive = false; s.ended = y; s.endReason = 'extinct'; log({ y, t: 'extinct', soc: s.id }); continue; }
      const canBreed = adults.some(p => p.sex === 'F' && age(p, y) <= 44) && adults.some(p => p.sex === 'M');
      if (ms.length < 8 || (!canBreed && adults.length < 12)) {
        const hosts = societies.filter(o => o.alive && o !== s && o.genome.outgroup !== 'xenophobic' && inContact(s, o));
        if (hosts.length) absorb(s, pick(hosts), y, 'merger');
      }
    }

    // --- record ---
    const total = people.filter(p => p.alive).length || 1;
    for (const s of societies) {
      const sd = ensureSeries(s);
      const ms = s.alive ? members(s) : [];
      sd.pop[y] = ms.length;
      s.popHistory.push(ms.length);
      sd.births[y] = sd.births[y] || 0; sd.deaths[y] = sd.deaths[y] || 0;
      sd.warDeaths[y] = sd.warDeaths[y] || 0;
      // polygyny rate: share of married women in polygynous unions
      const wives = ms.filter(p => p.sex === 'F' && aliveSpouses(p).length);
      sd.herds[y] = Math.round([...s.herds.values()].reduce((a, b) => a + b, 0));
      sd.fields[y] = s.alive ? patches.filter(pt => pt.field && pt.field.soc === s.id).length : 0;
      sd.sedentary[y] = s.sedentary ? 1 : 0;
      for (const a of ['plant', 'hunt', 'fish', 'farm', 'herd']) sd.prod[a][y] = s.alive ? Math.round((s.prod[a] || 0) / 1e5) / 10 : 0;
      sd.polygyny[y] = wives.length ? +(wives.filter(w => aliveSpouses(byId.get(aliveSpouses(w)[0])).length > 1).length / wives.length).toFixed(3) : 0;
      if (s.id < nFounders) sd.ancestry[y] = +(people.filter(p => p.alive).reduce((a, p) => a + p.ancestry[s.id], 0) / total).toFixed(3);
    }
    if (!societies.some(s => s.alive)) { log({ y, t: 'island empty' }); break; }
    // keep only the living in the hot list (genealogy stays in byId)
    for (let i = people.length - 1; i >= 0; i--) if (!people[i].alive) people.splice(i, 1);
    popVer++;
  }

  // ---------- fission & absorption ----------
  function fission(s, y) {
    const ms = members(s);
    const key = s.genome.descent === 'patrilineal' ? 'patriline' : 'matriline';
    const lines = new Map();
    ms.forEach(p => { const k = s.genome.descent === 'communal' ? (p.id % 2) : p[key]; if (!lines.has(k)) lines.set(k, []); lines.get(k).push(p); });
    const groups = shuffle([...lines.values()]);
    const leaving = []; let n = 0;
    for (const gr of groups) { if (n >= ms.length / 2) break; if (gr.some(p => p.id === s.leader)) continue; leaving.push(...gr); n += gr.length; }
    if (leaving.length < 15) return;
    let genome = cloneGenome(s.genome);
    if (!P.freezeGenomes) { const k = pick(GENE_KEYS.filter(k => k !== 'fission')); genome = mutateGene(genome, k, R); }
    let best = null, bd = -1;
    for (const pt of patches) {
      if (!reach(s, pt) || !waterNear(pt, s)) continue;
      const d = Math.min(...societies.filter(o => o.alive).map(o => dist(pt, o.home) + (W.islands && pt.isle !== patchAt(o.home.x, o.home.y).isle ? 6 : 0)));
      if (d > bd) { bd = d; best = pt; }
    }
    if (!best || bd < 4) return;
    const root = s.root || s.name;
    const nth = societies.filter(o => (o.root || o.name) === root).length + 1;
    const childSoc = makeSociety(genome, `${root} ${roman(nth)}`, { x: best.x, y: best.y }, s.id);
    childSoc.root = root;
    childSoc.founded = y;
    ensureSeries(childSoc);
    s.techs.forEach(t => childSoc.techs.add(t));
    leaving.forEach(p => { setSoc(p, childSoc.id); });
    // spouses across the split follow residence
    leaving.forEach(p => aliveSpouses(p).forEach(id => { const q = byId.get(id); if (q.soc === s.id && (s.genome.residence === 'matrilocal' ? q.sex === 'M' : q.sex === 'F')) setSoc(q, childSoc.id); }));
    s.trust[childSoc.id] = childSoc.trust[s.id] = 0.5;
    s.grievance[childSoc.id] = childSoc.grievance[s.id] = 0.3;
    // split stores; herds go with the people who own them; fields of leavers are abandoned
    for (const [k, v] of s.stores) { s.stores.set(k, v * 0.5); childSoc.stores.set(k, v * 0.5); }
    const leftKeys = new Set(leaving.map(p => ownerKey(p, s)));
    const share = leaving.length / Math.max(1, leaving.length + members(s).length);
    for (const [k, c] of [...s.herds]) {
      if (k === 'all' || k === 'ruler') { s.herds.set(k, c * (1 - share)); childSoc.herds.set(k, c * share); }
      else if (leftKeys.has(k)) { s.herds.delete(k); childSoc.herds.set(k, c); }
    }
    patches.forEach(pt => { if (pt.field && pt.field.soc === s.id && leftKeys.has(pt.field.key) && pt.field.key !== 'all' && pt.field.key !== 'ruler') pt.field = null; });
    log({ y, t: 'fission', soc: s.id, to: childSoc.id, size: members(childSoc).length, genes: Object.keys(genome).filter(k => genome[k] !== s.genome[k]) });
    function shuffle(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
  }
  function absorb(B, A, y, how) {
    const ms = members(B);
    const pol = A.genome.captives;
    let killed = 0;
    for (const p of ms) {
      if (how === 'conquest' && p.sex === 'M' && age(p, y) >= 15 && R() < 0.4) { kill(p, y, 'raid', ['conquered by ' + A.name], { by: A.id }); killed++; continue; }
      setSoc(p, A.id); p.origin = B.id;
      if (how === 'conquest' && pol === 'slave') p.status = 'slave';
      else if (how === 'conquest') { p.status = 'captive'; p.freedYear = y + 2; }
    }
    for (const [k, v] of B.stores) A.stores.set(k, (A.stores.get(k) || 0) + v);
    const ak = A.genome.property === 'ruler' ? 'ruler' : 'all';
    for (const [, c] of B.herds) A.herds.set(ak, (A.herds.get(ak) || 0) + c);
    B.herds.clear();
    patches.forEach(pt => { if (pt.field && pt.field.soc === B.id) pt.field = { soc: A.id, key: ak }; });
    B.techs.forEach(t => { if (!A.techs.has(t) && R() < 0.5) { A.techs.add(t); log({ y, t: 'tech', soc: A.id, tech: t, via: 'absorbed ' + B.name }); } });
    B.alive = false; B.ended = y; B.endReason = how === 'conquest' ? 'conquered by ' + A.name : 'merged into ' + A.name;
    log({ y, t: how, soc: B.id, to: A.id, people: ms.length - killed, killed });
  }

  // ---------- summary & digest ----------
  const lastY = series.climate.length - 1;
  const totalEnd = people.filter(p => p.alive).length;
  const summary = societies.map(s => {
    const sd = sseries[s.id];
    const pops = sd.pop.filter(v => v !== null);
    const deathsMaleAdult = events.filter(e => e.t === 'death' && e.soc === s.id && e.sex === 'M' && e.age >= 15);
    const warM = deathsMaleAdult.filter(e => e.cause === 'raid').length;
    return {
      id: s.id, name: s.name, color: s.color, parent: s.parent, founded: s.founded, alive: s.alive, ended: s.ended, endReason: s.endReason,
      finalPop: s.alive ? sd.pop[lastY] : 0, peakPop: Math.max(0, ...pops), meanPop: +(pops.reduce((a, b) => a + b, 0) / Math.max(1, pops.length)).toFixed(1),
      islandShare: totalEnd ? +((s.alive ? sd.pop[lastY] : 0) / totalEnd).toFixed(3) : 0,
      ancestryShare: s.id < nFounders ? sd.ancestry[lastY] : null,
      warShareMaleDeaths: deathsMaleAdult.length ? +(warM / deathsMaleAdult.length).toFixed(3) : 0,
      techs: [...s.techs], genome: s.genome,
      herdsEnd: sd.herds[lastY] || 0, fieldsEnd: sd.fields[lastY] || 0,
      foodMix: (() => { const m = {}; let t = 0; for (const a of ['plant', 'hunt', 'fish', 'farm', 'herd']) { let v = 0; for (let k = Math.max(0, lastY - 49); k <= lastY; k++) v += sd.prod[a][k] || 0; m[a] = v; t += v; } for (const a in m) m[a] = t ? +(m[a] / t).toFixed(3) : 0; return m; })(),
      geneChanges: events.filter(e => e.t === 'gene' && e.soc === s.id).length,
    };
  });
  const digest = makeDigest(events, sseries, series, societies);
  return {
    strains, version: MODEL_VERSION, seed: cfg.seed, years: lastY + 1, params: P, env: envKey, envName: ENVIRONMENTS[envKey].name, grid: G,
    map: patches.map(pt => pt.land ? (pt.water ? 3 : pt.arable && pt.fert >= 1 ? 2 : pt.grass ? 4 : 1) : 0),
    societies: societies.map(s => ({ id: s.id, name: s.name, color: s.color, parent: s.parent, founded: s.founded })),
    series, sseries, events, summary, digest,
  };
}

function roman(n) {
  const m = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let out = '';
  for (const [v, r] of m) while (n >= v) { out += r; n -= v; }
  return out;
}

export function gini(xs) {
  const n = xs.length; if (n < 2) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / n; if (!mean) return 0;
  let acc = 0; s.forEach((v, i) => acc += (2 * (i + 1) - n - 1) * v);
  return acc / (n * n * mean);
}

function makeDigest(events, sseries, series, societies) {
  const out = [];
  societies.forEach(s => {
    const pop = sseries[s.id].pop;
    for (let y = 3; y < pop.length; y++) {
      const a = pop[y - 3], b = pop[y];
      if (a == null || b == null || a < 15) continue;
      const drop = (b - a) / a;
      if (drop > -0.15) continue;
      if (out.length && out[out.length - 1].soc === s.id && y - out[out.length - 1].y < 6) continue;
      const win = events.filter(e => e.y > y - 3 && e.y <= y && e.soc === s.id);
      const deaths = win.filter(e => e.t === 'death');
      const by = {}; deaths.forEach(e => by[e.cause] = (by[e.cause] || 0) + 1);
      const top = Object.entries(by).sort((x, z) => z[1] - x[1]).slice(0, 3).map(([c, n]) => `${c} ${n}`);
      const bits = [];
      const clim = series.climate.slice(y - 2, y + 1);
      if (clim.some(c => c < 0.8)) bits.push('bad harvest');
      if (win.some(e => e.t === 'epidemic')) bits.push('epidemic');
      const raids = events.filter(e => e.t === 'raid' && e.y > y - 3 && e.y <= y && e.to === s.id);
      if (raids.length) bits.push(`${raids.length} raid${raids.length > 1 ? 's' : ''} suffered`);
      if (win.some(e => e.t === 'fission')) bits.push('fission');
      if (win.some(e => e.t === 'succession')) bits.push('succession crisis');
      out.push({ y, soc: s.id, text: `Year ${y}: ${s.name} ${Math.round(drop * 100)}% (${a}→${b}) — ${bits.join(', ') || 'no single shock'}; deaths: ${top.join(', ')}` });
    }
  });
  events.filter(e => ['conquest', 'merger', 'fission', 'extinct', 'revolt'].includes(e.t)).forEach(e => {
    const s = societies[e.soc], o = e.to != null ? societies[e.to] : null;
    const t = { conquest: `${o?.name} conquered ${s.name}`, merger: `${s.name} merged into ${o?.name}`, fission: `${s.name} split; ${o?.name} founded (${e.size} people)`,
      extinct: `${s.name} died out`, revolt: `slave revolt in ${s.name} (${e.deaths} dead)` }[e.t];
    out.push({ y: e.y, soc: e.soc, text: `Year ${e.y}: ${t}` });
  });
  return out.sort((a, b) => a.y - b.y);
}
