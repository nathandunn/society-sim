# Society Sim

Two bands share a world for 500 years — rich forest, a farmland river valley, desert oases or an archipelago. Each carries a **genome** of social rules — marriage, mate choice, descent, residence, labour division, food sharing, foraging, trade, governance, norm enforcement, outgroup stance, captives, famine policy, fission size, ritual, and who owns fields and herds. The app shows which ways of organising people survive, grow or absorb the other, and *why*: every birth, death, rule change and technology change is logged with its cause.

Live: https://society-sim.apps.precogsoftwareservices.com

## Run

```sh
npm run build      # copies src/ into public/src (static site, no deps)
npm test           # determinism + forager-range demography checks
npm run sim -- "Egalitarian matriarchy" "Patriarchal harem" 5 500
node tools/sweep.mjs 10 500                 # every preset pair, in every world
node tools/envcheck.mjs 3                   # per-world calibration snapshot
```

Serve `public/` with any static server.

## Layout

| Path | What |
| --- | --- |
| `src/engine.js` | Year-tick agent model: world, people, sharing, mortality, marriage, births, raids, trade, skills/tech, cultural evolution, fission |
| `src/genome.js` | Rule genes, presets, mutation |
| `src/params.js` | Every baseline parameter, the 21 technologies and `MODEL_VERSION` |
| `src/world.js` | The four worlds: map generator, start homes, starting know-how, climate overrides |
| `src/sweep.js` | Genome pairs × seeds → survival/share/pop with 95% CIs |
| `public/` | Web app (Web Worker runs the engine; hand-rolled SVG charts) |
| `tools/` | Build, tests, CLI runs and sweeps |

## Worlds (v0.2)

| World | What changes |
| --- | --- |
| Rich forest | The v0.1 forager island; cultivation can be invented in a few clearings |
| Farmland valley | Cultivation known; fields deplete without fallow, flood, settle villages (1-year birth spacing, more disease) and are owned and inherited |
| Desert oases | Herding known; harsh, variable rain; oases dry in droughts; herds graze, breed, die in drought and plague, and are rustled in raids |
| Islands | Five islands; no contact, trade or war across water until boats are invented, then empty islands can be settled |

The **Fields & herds owned by** gene (communal, lineage, household, ruler) decides who may work a field or tend a herd, who inherits it, and how much the ruler takes. Wealth raises status, and status wins wives.

Versioning: `package.json` and `MODEL_VERSION` in `src/params.js` must match (a test checks). The build stamps version, commit and date into `public/version.js`; the page header shows it and every result and export carries it.

## Calibration (v0.1)

Pooled lone-society runs: infant mortality ≈ 0.17, survival to 15 ≈ 0.60 (forager life tables put these near 0.2 and 0.55–0.6). Lone bands plateau at ~150–180 people; the island carries ~250–300. War causes 20–50% of adult male deaths in contested pairings (Keeley's ethnographic range is 10–60%). Hunger acts mainly through illness and suppressed fertility.

Known simplifications: food is one currency (kcal); no terrain beyond patch types; sweeps run in the browser worker rather than on the hub. In the valley, farming booms then busts as soil tires and villages outgrow walking-distance fields; war causes ~20–25% of deaths there.

Spec: Society Sim — Spec v0 (claude.ai doc).
