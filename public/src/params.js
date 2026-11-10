// Baseline parameters. Demography is anchored to forager life tables
// (approximate; Gurven & Kaplan 2007 style): q0 ~ 0.2, ~60% survive to 15,
// TFR ~ 5-6, modal adult death ~ 70. Every value is tunable from the UI.

// Model version: bump with package.json (tests check they match). Stamped into every result.
export const MODEL_VERSION = '0.5.4';

export const DEFAULT_PARAMS = {
  years: 500,
  startPerSociety: 50,

  // --- Demography ---
  // Siler hazard: infant term + constant + senescent term
  infantA: 0.20, infantB: 1.0,
  bgInfection: 0.0045, bgAccident: 0.0025, bgOther: 0.002,
  senA: 0.00035, senB: 0.082,
  maxAge: 95,
  femaleFertileFrom: 17, femaleFertileTo: 44,
  maleMarryFrom: 18, femaleMarryFrom: 16,
  conceptionBase: 0.42,     // per eligible year (not nursing)
  nursingYears: 2,
  maternalDeath: 0.012,     // per birth, without midwifery
  starvationHazard: 0.9,    // added hazard = k * severity^2 once hunger passes the famine line
  famineLine: 0.4,          // below this deficit hunger kills through illness, not outright starvation
  hungerIllness: 5,         // illness hazard multiplier at total hunger (1 + k * deficit)
  sexRatioMale: 0.51,

  // --- Food (kcal per year) ---
  adultNeed: 880000,        // ~2,400 kcal/day
  childNeedFrac: 0.55,      // under 12
  elderNeedFrac: 0.8,       // 60+
  workFrom: 12, workTo: 62,
  rate: { plant: 2600000, game: 3400000, fish: 2900000, farm: 4800000 },   // per full-time worker at full skill & full stock
  farmersPerField: 3,       // a field patch is fully worked by about three farmers
  fieldDepletion: 0.006,    // fertility lost per farmer-year
  fieldRecovery: 0.15,      // share of lost fertility regained per fallow year
  nursingYearsSedentary: 1, // weaning foods shorten birth spacing once people farm
  herdYield: 180000,        // kcal per tended livestock unit per year (milk, blood, culled meat)
  herdPerHerder: 30,        // livestock units one herder can tend
  herdGrowth: 0.16,         // yearly herd increase when well grazed and tended
  herdGraze: 45000,         // grass (plant-stock units) one livestock unit eats per year
  gameVariance: 0.55,       // hunting is high-variance
  travelCost: 0.04,         // yield loss per grid unit of distance from camp
  forageRadius: 6,          // grid units a camp forages in
  campMoveEvery: 3,         // years between camp moves
  campMoveMax: 5,           // max grid units a camp moves at once
  storeDecay: 0.55,         // fraction of stores lost per year without preservation
  gluttLoss: 0.12,          // harvest spoiled in glut seasons without preservation

  // --- Environment (see world.js; these are the rich-forest baselines) ---
  env: 'forest',
  grid: 20,                 // 20x20 = 400 patches
  coastWidth: 2,
  K: { plant: 4000000, game: 3200000, fish: 3400000 },  // per patch (fish only coastal)
  regrow: { plant: 0.55, game: 0.35, fish: 0.45 },
  climate: { bad: 0.15, badMult: 0.68, good: 0.15, goodMult: 1.15, noise: 0.08 },
  shocks: { fire: 0.02, storm: 0.02, epidemic: 0.012 },  // epidemic = yearly chance per ~100 people of a spillover from wild animals
  // Contagious disease (strains with immunity). Small bands cannot keep crowd diseases going,
  // so outbreaks burn out and return only by new spillover or by contact with other peoples.
  disease: {
    spillHerd: 0.006,       // spillover chance per 100 livestock units per year
    spillCrowd: 0.03,       // extra spillover chance per year for a fully farming village, per 200 people
    reuse: 0.6,             // chance a spillover is an already-known strain from the same source
    viaTrade: 0.3, viaRaid: 0.5, viaMigrants: 0.25,   // chance per year a live outbreak crosses each channel
    crowding: 0.35,         // R0 boost for settled villages
    hungerCFR: 2,           // case fatality multiplier at total hunger (1 + k * deficit)
  },

  // --- Social ---
  freeRiderLoss: 0.18,      // max effort lost under pooled sharing
  eliteCut: 0.12,           // tribute: share of the common pot that goes to the chief's storehouse
  eliteEat: 1.25,           // the chief's household eats this multiple of its need from the store
  chiefRelease: 0.5,        // share of the store a chief hands out in a hungry year
  polygynyMaxWives: 4,
  // --- Customs (v0.4) ---
  maleMarryLate: 28,        // age men may marry where they marry late (bridewealth to raise, warriorhood to serve)
  saveFrac: 0.3,            // share of a worker's surplus put by for marriage payments (pigs, cattle, valuables)
  savingsCap: 6,            // most a person can hold, in adult-years of food
  bridePrice: 1.5, bridePriceHerd: 4,   // bridewealth: adult-years of valuables, or livestock units
  brideCredit: 0.25,        // chance a groom who can't pay marries on a promise, carrying the debt
  dowry: 1, dowryHerd: 3,               // dowry, the same way
  brideServiceYears: 5, brideServiceShare: 0.3, // years a new husband works for his in-laws, and the share of his catch they get
  bloodPrice: 2, bloodPriceHerd: 6,     // blood money for a killing
  feudRevenge: 0.4,         // chance unpaid blood money is answered with a killing
  feastFrac: 0.5,           // share of a surplus given away at feasts where status is won by feasting
  feastWaste: 0.15,         // share of a feast destroyed in display
  fluidMove: 0.01,          // yearly chance a family moves to a kin band, where bands are open
  fluidHunger: 0.3,         // extra chance per unit the other camp is eating better
  unpairedViolence: 0.012,  // yearly chance per unpaired adult man of a deadly fight
  succesionCrisis: 0.3,
  defection: 0.012,
  slaveEffort: 0.75, slaveEscape: 0.05, slaveRevolt: 0.25,

  // --- Conflict ---
  raidThreshold: 0.9,
  raidSlope: 3.0,
  raidBase: 0.25,
  casualtyLoser: 0.28, casualtyWinner: 0.06,

  // --- Technology ---
  inventBase: 0.0045,
  techLossThreshold: 0.25,
  diffuseTrade: 0.06,
  diffusePerMigrant: 0.01,

  // --- Cultural evolution ---
  freezeGenomes: false,
  driftRate: 0.0015,
  imitateRate: 0.03,
  ritualDecay: 0.003,
  maxSocieties: 10,
};

// Discrete technologies. effects are multipliers / reductions consumed by the engine.
export const TECHS = {
  spear:       { domain: 'hunt',  name: 'Spear',              req: [],              start: false },
  bow:         { domain: 'hunt',  name: 'Bow',                req: ['spear'],       start: false },
  fishWeir:    { domain: 'fish',  name: 'Fish weir & nets',   req: [],              start: false },
  boats:       { domain: 'fish',  name: 'Boats',              req: ['fishWeir'],    start: false },
  smoking:     { domain: 'craft', name: 'Smoking & drying',   req: [],              start: false },
  pottery:     { domain: 'craft', name: 'Pottery',            req: ['smoking'],     start: false },
  shields:     { domain: 'fight', name: 'Shields',            req: [],              start: false },
  palisade:    { domain: 'craft', name: 'Palisade',           req: [],              start: false },
  ambush:      { domain: 'fight', name: 'Organised ambush',   req: ['spear'],       start: false },
  herbal:      { domain: 'heal',  name: 'Herbal remedies',    req: [],              start: false },
  woundCare:   { domain: 'heal',  name: 'Wound care',         req: [],              start: false },
  midwifery:   { domain: 'heal',  name: 'Midwifery',          req: [],              start: false },
  boneSetting: { domain: 'heal',  name: 'Bone setting',       req: ['woundCare'],   start: false },
  quarantine:  { domain: 'heal',  name: 'Quarantine norm',    req: ['herbal'],      start: false },
  hygiene:     { domain: 'heal',  name: 'Hygiene & water',    req: [],              start: false },
  cultivation: { domain: 'plant', keep: 'farm', name: 'Cultivation', req: [],         start: false, needs: 'arable', rarity: 0.15 },
  irrigation:  { domain: 'farm',  name: 'Irrigation',         req: ['cultivation'], start: false, needs: 'water' },
  granary:     { domain: 'craft', name: 'Granaries',          req: ['cultivation'], start: false },
  herding:     { domain: 'hunt', keep: 'herd', name: 'Herding',      req: [],          start: false, needs: 'grass', rarity: 0.15 },
  dairying:    { domain: 'herd',  name: 'Dairying',           req: ['herding'],     start: false },
  wells:       { domain: 'craft', name: 'Wells',              req: [],              start: false, needs: 'oasis' },
};

export const DOMAINS = ['plant', 'hunt', 'fish', 'farm', 'herd', 'fight', 'heal', 'craft'];

export const CAUSES = [
  'infant illness', 'infection', 'accident', 'other illness', 'old age', 'starvation',
  'childbirth', 'epidemic', 'raid', 'mate fight', 'punishment', 'infanticide', 'succession',
  'revolt', 'killed captive', 'feud', 'intervention',
];

// Parameters the app lets you tune. path = dotted key into the params object;
// scale divides the stored value for display (e.g. kcal -> millions of kcal).
export const PARAM_UI = [
  { group: 'People', path: 'conceptionBase', label: 'Conception chance per year', min: 0.1, max: 0.8, step: 0.01 },
  { group: 'People', path: 'nursingYears', label: 'Birth spacing, mobile (years nursing)', min: 1, max: 4, step: 1 },
  { group: 'People', path: 'nursingYearsSedentary', label: 'Birth spacing, villages (years)', min: 1, max: 4, step: 1 },
  { group: 'People', path: 'maternalDeath', label: 'Deaths per birth, mothers', min: 0, max: 0.05, step: 0.001 },
  { group: 'People', path: 'infantA', label: 'Infant illness hazard', min: 0.05, max: 0.4, step: 0.01 },
  { group: 'People', path: 'bgInfection', label: 'Everyday infection hazard', min: 0, max: 0.02, step: 0.0005 },
  { group: 'Food', path: 'adultNeed', label: 'Adult need', unit: 'M kcal/yr', scale: 1e6, min: 0.6, max: 1.2, step: 0.01 },
  { group: 'Food', path: 'rate.plant', label: 'Gathering return per worker', unit: 'M kcal/yr', scale: 1e6, min: 0.5, max: 6, step: 0.1 },
  { group: 'Food', path: 'rate.game', label: 'Hunting return per worker', unit: 'M kcal/yr', scale: 1e6, min: 0.5, max: 6, step: 0.1 },
  { group: 'Food', path: 'rate.fish', label: 'Fishing return per worker', unit: 'M kcal/yr', scale: 1e6, min: 0.5, max: 6, step: 0.1 },
  { group: 'Food', path: 'rate.farm', label: 'Farming return per worker', unit: 'M kcal/yr', scale: 1e6, min: 0.5, max: 10, step: 0.1 },
  { group: 'Food', path: 'herdYield', label: 'Yield per livestock unit', unit: 'k kcal/yr', scale: 1e3, min: 20, max: 400, step: 5 },
  { group: 'Food', path: 'gameVariance', label: 'Hunting luck (variance)', min: 0, max: 1.2, step: 0.05 },
  { group: 'Food', path: 'storeDecay', label: 'Stores lost per year (no preserving)', min: 0, max: 1, step: 0.05 },
  { group: 'Land', path: 'K.plant', label: 'Plant food per patch', unit: 'M kcal', scale: 1e6, min: 0.5, max: 10, step: 0.1 },
  { group: 'Land', path: 'K.game', label: 'Game per patch', unit: 'M kcal', scale: 1e6, min: 0.5, max: 10, step: 0.1 },
  { group: 'Land', path: 'K.fish', label: 'Fish per shore patch', unit: 'M kcal', scale: 1e6, min: 0, max: 10, step: 0.1 },
  { group: 'Land', path: 'fieldDepletion', label: 'Soil tiredness per farmer-year', min: 0, max: 0.03, step: 0.001 },
  { group: 'Land', path: 'fieldRecovery', label: 'Fallow recovery per year', min: 0, max: 0.5, step: 0.01 },
  { group: 'Land', path: 'herdGrowth', label: 'Herd growth per year', min: 0, max: 0.4, step: 0.01 },
  { group: 'Climate', path: 'climate.bad', label: 'Chance of a bad year', min: 0, max: 0.6, step: 0.01 },
  { group: 'Climate', path: 'climate.badMult', label: 'Harvest in a bad year (× normal)', min: 0.2, max: 1, step: 0.01 },
  { group: 'Climate', path: 'climate.good', label: 'Chance of a good year', min: 0, max: 0.6, step: 0.01 },
  { group: 'Climate', path: 'shocks.fire', label: 'Forest fires per year', min: 0, max: 0.1, step: 0.005 },
  { group: 'Climate', path: 'shocks.storm', label: 'Storms per year', min: 0, max: 0.1, step: 0.005 },
  { group: 'Disease', path: 'shocks.epidemic', label: 'Spillover from wild animals (per 100 people per year)', min: 0, max: 0.1, step: 0.002 },
  { group: 'Disease', path: 'disease.spillHerd', label: 'Spillover from herds (per 100 livestock)', min: 0, max: 0.05, step: 0.001 },
  { group: 'Disease', path: 'disease.spillCrowd', label: 'Diseases bred in villages', min: 0, max: 0.2, step: 0.005 },
  { group: 'Disease', path: 'disease.viaTrade', label: 'Spread through trade', min: 0, max: 1, step: 0.05 },
  { group: 'Disease', path: 'disease.viaRaid', label: 'Spread through raids', min: 0, max: 1, step: 0.05 },
  { group: 'Disease', path: 'hungerIllness', label: 'How much hunger worsens illness', min: 0, max: 10, step: 0.5 },
  { group: 'Disease', path: 'famineLine', label: 'Famine line (share of food missing)', min: 0.1, max: 0.9, step: 0.05 },
  { group: 'Conflict', path: 'raidBase', label: 'Raid chance when pressed', min: 0, max: 1, step: 0.01 },
  { group: 'Conflict', path: 'raidThreshold', label: 'Pressure needed to raid', min: 0, max: 3, step: 0.05 },
  { group: 'Conflict', path: 'casualtyLoser', label: 'Deaths among the losing side', min: 0, max: 0.8, step: 0.01 },
  { group: 'Conflict', path: 'casualtyWinner', label: 'Deaths among the winning side', min: 0, max: 0.5, step: 0.01 },
  { group: 'Conflict', path: 'unpairedViolence', label: 'Fights among unpaired men', min: 0, max: 0.1, step: 0.002 },
  { group: 'Rulers', path: 'eliteCut', label: 'Tribute to the chief (share of food)', min: 0, max: 0.5, step: 0.01 },
  { group: 'Rulers', path: 'eliteEat', label: "Chief's household eats (× need)", min: 1, max: 3, step: 0.05 },
  { group: 'Rulers', path: 'chiefRelease', label: 'Share of the store handed out in famine', min: 0, max: 1, step: 0.05 },
  { group: 'Customs', path: 'maleMarryLate', label: 'Age men marry, where they marry late', min: 20, max: 40, step: 1 },
  { group: 'Customs', path: 'bridePrice', label: 'Bridewealth (years of surplus)', min: 0, max: 5, step: 0.1 },
  { group: 'Customs', path: 'bridePriceHerd', label: 'Bridewealth in livestock', min: 0, max: 20, step: 1 },
  { group: 'Customs', path: 'dowry', label: 'Dowry (years of surplus)', min: 0, max: 5, step: 0.1 },
  { group: 'Customs', path: 'brideServiceYears', label: 'Years of bride-service', min: 0, max: 15, step: 1 },
  { group: 'Customs', path: 'bloodPrice', label: 'Blood money (years of surplus)', min: 0, max: 6, step: 0.1 },
  { group: 'Customs', path: 'feudRevenge', label: 'Unpaid killings avenged', min: 0, max: 1, step: 0.05 },
  { group: 'Customs', path: 'feastFrac', label: 'Surplus given at feasts', min: 0, max: 1, step: 0.05 },
  { group: 'Customs', path: 'feastWaste', label: 'Share of a feast destroyed', min: 0, max: 1, step: 0.05 },
  { group: 'Customs', path: 'fluidMove', label: 'Families moving between open bands', min: 0, max: 0.1, step: 0.002 },
  { group: 'Culture', path: 'inventBase', label: 'Invention rate', min: 0, max: 0.03, step: 0.0005 },
  { group: 'Culture', path: 'driftRate', label: 'Rule drift per gene per year', min: 0, max: 0.02, step: 0.0005 },
  { group: 'Culture', path: 'imitateRate', label: 'Imitating a richer neighbour', min: 0, max: 0.2, step: 0.005 },
  { group: 'Culture', path: 'ritualDecay', label: 'Ritual decay in peace', min: 0, max: 0.02, step: 0.0005 },
];

export const getPath = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);

// Turn {path: value} tuning into a nested params object, dropping anything unknown or out of range.
export function tuningToParams(tune) {
  const out = {};
  for (const spec of PARAM_UI) {
    const v = tune && tune[spec.path];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const real = v * (spec.scale || 1);
    const lo = spec.min * (spec.scale || 1), hi = spec.max * (spec.scale || 1);
    const keys = spec.path.split('.');
    let o = out; for (const k of keys.slice(0, -1)) o = o[k] = o[k] || {};
    o[keys.at(-1)] = Math.min(hi, Math.max(lo, real));
  }
  return out;
}
