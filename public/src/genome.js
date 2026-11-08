// Society genome: rule genes, their allowed values, and presets.
// Each gene is either an enum (array of values) or a dial (0..1).

export const GENES = {
  marriage:    { kind: 'enum', values: ['monogamy', 'serial', 'polygyny', 'polyandry', 'open'],
                 label: 'Marriage' },
  mateChoice:  { kind: 'enum', values: ['free', 'kin', 'ruler'], label: 'Mate choice' },
  descent:     { kind: 'enum', values: ['matrilineal', 'patrilineal', 'bilateral', 'communal'],
                 label: 'Descent & inheritance' },
  residence:   { kind: 'enum', values: ['matrilocal', 'patrilocal', 'free'], label: 'Residence' },
  labour:      { kind: 'enum', values: ['bySex', 'bySkill', 'mixed'], label: 'Labour division' },
  sharing:     { kind: 'enum', values: ['household', 'kin', 'camp', 'ruler'], label: 'Food sharing' },
  foraging:    { kind: 'enum', values: ['roam', 'territorial', 'rotation'], label: 'Foraging strategy' },
  property:    { kind: 'enum', values: ['communal', 'lineage', 'household', 'ruler'], label: 'Fields & herds owned by' },
  trade:       { kind: 'enum', values: ['none', 'kin', 'open', 'ruler'], label: 'Trade' },
  governance:  { kind: 'enum', values: ['anarchy', 'democracy', 'chief', 'totalitarian'], label: 'Governance' },
  enforcement: { kind: 'enum', values: ['gossip', 'fines', 'violence', 'exile'], label: 'Norm enforcement' },
  outgroup:    { kind: 'enum', values: ['xenophobic', 'neutral', 'open'], label: 'Outgroup stance' },
  captives:    { kind: 'enum', values: ['kill', 'ransom', 'slave', 'adopt'], label: 'Captives' },
  famine:      { kind: 'enum', values: ['infanticide', 'elderCare', 'neither'], label: 'Child/elder policy' },
  fission:     { kind: 'dial', min: 80, max: 400, step: 10, label: 'Fission threshold (camp size)' },
  ritual:      { kind: 'dial', min: 0, max: 1, step: 0.05, label: 'Ritual & cohesion' },
};

export const GENE_KEYS = Object.keys(GENES);

export const PRESETS = {
  'Egalitarian matriarchy': {
    marriage: 'serial', mateChoice: 'free', descent: 'matrilineal', residence: 'matrilocal',
    labour: 'mixed', sharing: 'camp', foraging: 'rotation', property: 'lineage', trade: 'open', governance: 'democracy',
    enforcement: 'gossip', outgroup: 'open', captives: 'adopt', famine: 'elderCare', fission: 150, ritual: 0.5,
  },
  'Patriarchal harem': {
    marriage: 'polygyny', mateChoice: 'ruler', descent: 'patrilineal', residence: 'patrilocal',
    labour: 'bySex', sharing: 'ruler', foraging: 'territorial', property: 'household', trade: 'ruler', governance: 'chief',
    enforcement: 'violence', outgroup: 'xenophobic', captives: 'slave', famine: 'infanticide', fission: 200, ritual: 0.6,
  },
  'Democratic egalitarian': {
    marriage: 'monogamy', mateChoice: 'free', descent: 'bilateral', residence: 'free',
    labour: 'bySkill', sharing: 'camp', foraging: 'rotation', property: 'household', trade: 'open', governance: 'democracy',
    enforcement: 'fines', outgroup: 'neutral', captives: 'adopt', famine: 'elderCare', fission: 150, ritual: 0.4,
  },
  'Warlord state': {
    marriage: 'polygyny', mateChoice: 'ruler', descent: 'patrilineal', residence: 'patrilocal',
    labour: 'bySex', sharing: 'ruler', foraging: 'territorial', property: 'ruler', trade: 'ruler', governance: 'totalitarian',
    enforcement: 'violence', outgroup: 'xenophobic', captives: 'slave', famine: 'infanticide', fission: 300, ritual: 0.8,
  },
  'Anarchist band': {
    marriage: 'open', mateChoice: 'free', descent: 'communal', residence: 'free',
    labour: 'bySkill', sharing: 'kin', foraging: 'roam', property: 'communal', trade: 'kin', governance: 'anarchy',
    enforcement: 'exile', outgroup: 'neutral', captives: 'ransom', famine: 'neither', fission: 120, ritual: 0.2,
  },
  'Monogamous chiefdom': {
    marriage: 'monogamy', mateChoice: 'kin', descent: 'patrilineal', residence: 'patrilocal',
    labour: 'bySex', sharing: 'kin', foraging: 'territorial', property: 'lineage', trade: 'open', governance: 'chief',
    enforcement: 'fines', outgroup: 'neutral', captives: 'adopt', famine: 'elderCare', fission: 180, ritual: 0.5,
  },
};

export function cloneGenome(g) { return { ...g }; }

export function mutateGene(genome, key, rng) {
  const spec = GENES[key];
  const g = cloneGenome(genome);
  if (spec.kind === 'enum') {
    const others = spec.values.filter(v => v !== g[key]);
    g[key] = others[Math.floor(rng() * others.length)];
  } else {
    const span = spec.max - spec.min;
    let v = g[key] + (rng() - 0.5) * span * 0.3;
    v = Math.max(spec.min, Math.min(spec.max, v));
    g[key] = Math.round(v / spec.step) * spec.step;
  }
  return g;
}

export function genomeDiff(a, b) {
  return GENE_KEYS.filter(k => a[k] !== b[k]);
}
