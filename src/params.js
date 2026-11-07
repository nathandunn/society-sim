// Baseline parameters. Demography is anchored to forager life tables
// (approximate; Gurven & Kaplan 2007 style): q0 ~ 0.2, ~60% survive to 15,
// TFR ~ 5-6, modal adult death ~ 70. Every value is tunable from the UI.

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
  starvationHazard: 0.3,    // added hazard = k * deficit^2 (hunger also amplifies illness, see engine)
  sexRatioMale: 0.51,

  // --- Food (kcal per year) ---
  adultNeed: 880000,        // ~2,400 kcal/day
  childNeedFrac: 0.55,      // under 12
  elderNeedFrac: 0.8,       // 60+
  workFrom: 12, workTo: 62,
  rate: { plant: 2600000, game: 3400000, fish: 2900000 },   // per full-time worker at full skill & full stock
  gameVariance: 0.55,       // hunting is high-variance
  travelCost: 0.04,         // yield loss per grid unit of distance from camp
  forageRadius: 6,          // grid units a camp forages in
  campMoveEvery: 3,         // years between camp moves
  campMoveMax: 5,           // max grid units a camp moves at once
  storeDecay: 0.55,         // fraction of stores lost per year without preservation
  gluttLoss: 0.12,          // harvest spoiled in glut seasons without preservation

  // --- Environment: rich forest ---
  grid: 20,                 // 20x20 = 400 patches
  coastWidth: 2,
  K: { plant: 4000000, game: 3200000, fish: 3400000 },  // per patch (fish only coastal)
  regrow: { plant: 0.55, game: 0.35, fish: 0.45 },
  climate: { bad: 0.15, badMult: 0.68, good: 0.15, goodMult: 1.15, noise: 0.08 },
  shocks: { fire: 0.02, storm: 0.02, epidemic: 0.012 },
  epidemicKill: 0.07,

  // --- Social ---
  freeRiderLoss: 0.18,      // max effort lost under pooled sharing
  eliteCut: 0.12,
  polygynyMaxWives: 4,
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
  maxSocieties: 6,
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
};

export const DOMAINS = ['plant', 'hunt', 'fish', 'fight', 'heal', 'craft'];

export const CAUSES = [
  'infant illness', 'infection', 'accident', 'other illness', 'old age', 'starvation',
  'childbirth', 'epidemic', 'raid', 'mate fight', 'punishment', 'infanticide', 'succession',
  'revolt', 'killed captive',
];
