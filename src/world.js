// Environments: each builds a patch grid, start homes, starting technologies and
// parameter overrides. Patch resources are kcal-equivalent stocks per ~0.5 km² patch.
//
// patch: { i, x, y, land, isle, coast, water, arable, fert, K:{plant,game,fish}, stock, owner, field }

export const ENVIRONMENTS = {
  forest: {
    name: 'Rich forest',
    blurb: 'Temperate forest island ringed by a rich shore. Game, nuts and roots inland, shellfish and fish on the coast. A few clearings could be farmed once cultivation is invented.',
  },
  farmland: {
    name: 'Farmland valley',
    blurb: 'A broad river valley with alluvial soil. Both bands already know how to cultivate; fields out-yield foraging but tie people down, crowd them, and need land that can be owned and fought over.',
  },
  desert: {
    name: 'Desert oases',
    blurb: 'Dry steppe and sand with a handful of oases. Rain fails often and oases dry up. Both bands keep herds, which graze, breed, die in drought and are the main prize of raids.',
  },
  islands: {
    name: 'Islands',
    blurb: 'An archipelago of five islands in a fish-rich sea. Each band starts alone on its own island; there is no contact, trade or war until someone builds boats.',
  },
};

// Each world's parameter overrides, applied over the defaults and under the user's own tuning.
export const ENV_PARAMS = {
  forest: {},
  farmland: { shocks: { fire: 0.005, storm: 0, epidemic: 0.012, flood: 0.03 } },
  desert: { climate: { bad: 0.25, badMult: 0.5, good: 0.12, goodMult: 1.25, noise: 0.15 }, shocks: { fire: 0, storm: 0, epidemic: 0.01, rinderpest: 0.012 } },
  islands: { shocks: { fire: 0.01, storm: 0.035, epidemic: 0.008 } },
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function blank(G, landFn) {
  const patches = [];
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    patches.push({ i: patches.length, x, y, land: landFn(x, y), isle: 0, coast: false, water: false, arable: false, fert: 0,
      K: { plant: 0, game: 0, fish: 0 }, stock: null, owner: -1, field: null });
  }
  return patches;
}
function markCoast(patches, G) {
  const at = (x, y) => (x < 0 || y < 0 || x >= G || y >= G) ? null : patches[y * G + x];
  for (const p of patches) {
    if (!p.land) continue;
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => at(p.x + dx, p.y + dy));
    p.coast = nb.some(n => !n || !n.land);
  }
}
function finish(patches) { patches.forEach(p => { p.stock = { ...p.K }; }); return patches; }

export function buildWorld(envKey, P, R) {
  const j = () => 0.75 + R() * 0.5;
  const K = P.K;

  if (envKey === 'farmland') {
    const G = 20;
    const riverX = y => Math.round(10 + 2.5 * Math.sin(y / 3));
    const patches = blank(G, () => true);
    for (const p of patches) {
      const dr = Math.abs(p.x - riverX(p.y));
      p.river = dr === 0;
      p.arable = true;
      p.fert = dr <= 3 ? 1.0 : dr <= 6 ? 0.75 : 0.5;
      p.K.plant = K.plant * 0.75 * j();
      p.K.game = K.game * 0.55 * j();
      p.K.fish = p.river ? K.fish * 0.9 * j() : 0;
      p.water = p.river;
    }
    return { G, patches: finish(patches), homes: [{ x: riverX(4) - 2, y: 4 }, { x: riverX(15) + 2, y: 15 }],
      startTechs: ['cultivation'], startSkills: { farm: true }, herdsPerPerson: 0,
      params: ENV_PARAMS.farmland };
  }

  if (envKey === 'desert') {
    const G = 20;
    const patches = blank(G, () => true);
    const oases = [];
    const want = [[3, 10], [16, 10], [9, 4], [11, 16], [6, 15], [14, 4], [10, 10]];
    for (const [x, y] of want) oases.push({ x: x + Math.floor(R() * 3) - 1, y: y + Math.floor(R() * 3) - 1 });
    for (const p of patches) {
      const dO = Math.min(...oases.map(o => dist(o, p)));
      if (dO < 0.5) { p.water = true; p.oasis = true; p.K.plant = K.plant * 1.4 * j(); p.K.game = K.game * 0.3; p.arable = true; p.fert = 0.8; }
      else if (dO <= 1.5) { p.K.plant = K.plant * 0.55 * j(); p.K.game = K.game * 0.3 * j(); p.arable = true; p.fert = 0.45; }
      else if (R() < 0.45) { p.grass = true; p.K.plant = K.plant * 0.4 * j(); p.K.game = K.game * 0.3 * j(); }
      else { p.K.plant = K.plant * 0.1 * j(); p.K.game = K.game * 0.12 * j(); }
    }
    return { G, patches: finish(patches), homes: [oases[0], oases[1]], startTechs: ['herding'], startSkills: { herd: true },
      herdsPerPerson: 6, waterRange: 2,
      params: ENV_PARAMS.desert };
  }

  if (envKey === 'islands') {
    const G = 30;
    const isles = [
      { x: 6, y: 15, r: 5.3 }, { x: 24, y: 15, r: 5.3 },
      { x: 15, y: 4.5, r: 3.4 }, { x: 15, y: 25.3, r: 4.8 }, { x: 15, y: 15, r: 2.3 },
    ];
    const isleOf = (x, y) => { for (let k = 0; k < isles.length; k++) { const s = isles[k]; if (Math.hypot(x - s.x, y - s.y) <= s.r) return k; } return -1; };
    const patches = blank(G, (x, y) => isleOf(x, y) >= 0);
    markCoast(patches, G);
    for (const p of patches) {
      p.isle = p.land ? isleOf(p.x, p.y) : -1;
      if (!p.land) continue;
      p.K.plant = K.plant * 0.95 * j();
      p.K.game = K.game * 0.5 * j();
      p.K.fish = p.coast ? K.fish * 1.8 * j() : 0;
      p.arable = R() < 0.15; p.fert = 0.6;
    }
    const centre = k => { const s = isles[k]; return { x: Math.round(s.x), y: Math.round(s.y) }; };
    return { G, patches: finish(patches), homes: [centre(0), centre(1)], startTechs: [], startSkills: {}, herdsPerPerson: 0,
      techReq: { boats: [] }, islands: true, isleCount: isles.length,
      params: ENV_PARAMS.islands };
  }

  // forest (default): the v1 island
  const G = 20;
  const patches = blank(G, () => true);
  for (const p of patches) {
    const edge = Math.min(p.x, p.y, G - 1 - p.x, G - 1 - p.y);
    p.coast = edge < P.coastWidth;
    p.K.plant = K.plant * j(); p.K.game = K.game * j(); p.K.fish = p.coast ? K.fish * j() : 0;
    p.arable = R() < 0.12; p.fert = 0.6;
  }
  return { G, patches: finish(patches), homes: [{ x: 3, y: 10 }, { x: 16, y: 10 }], startTechs: [], startSkills: {}, herdsPerPerson: 0, params: ENV_PARAMS.forest };
}
