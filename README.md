# Society Sim

Two bands share a world for 500 years — rich forest, a farmland river valley, desert oases or an archipelago. Each carries a **genome** of social rules — marriage, mate choice, descent, residence, labour division, food sharing, foraging, trade, governance, norm enforcement, outgroup stance, captives, famine policy, fission size, ritual, and who owns fields and herds. The app shows which ways of organising people survive, grow or absorb the other, and *why*: every birth, death, rule change and technology change is logged with its cause.

Live: https://society-sim.apps.precogsoftwareservices.com

## Play mode

The Play tab steps one history a year at a time on a map (`public/play.js`, worker `public/live.js`, engine `createSim`). Pause to inspect every person and step in, then run 1–N years or until something happens (a new leader, a raid, an epidemic, hunger, a rule change, a technology, a split or conquest, or any cataclysm): rule decrees, blight, plague, food, technology, newcomers, raids, peace, killing or crowning a leader, freeing slaves. Interventions are recorded as `{ y, t, ... }` and replay exactly via `runSim({ ...cfg, interventions })`.

## Run

```sh
npm run build      # copies src/ into public/src (static site, no deps)
npm test           # determinism + forager-range demography checks
npm run sim -- "Egalitarian matriarchy" "Patriarchal harem" 5 500
node tools/sweep.mjs 10 500                 # every preset pair, in every world
node tools/envcheck.mjs 3                   # per-world calibration snapshot
```

Serve `public/` with any static server, or run `npm start` (the hub server: the app plus the sweep API).

## Hub sweep service (v0.3)

`server/server.mjs` serves the app and runs sweeps on the hub's CPUs (one job at a time, runs spread over `SWEEP_WORKERS` threads, sweeps run at lowered priority):

| Route | |
| --- | --- |
| `POST /api/sweeps` | `{pairs:[{a:{name,genome},b:{name,genome}}], envs, seeds, years, tune}` → job (identical requests return the cached job) |
| `GET /api/sweeps/:id` | progress and per-pair results |
| `GET /api/sweeps` | recent jobs |
| `GET /api/health` | version, workers, queue |

Limits: 200 seeds, 28 pairs, 4 worlds, 12,000 runs, 4 queued jobs. Finished jobs are kept on the `society-sim-data` volume, keyed by model version, so a new model never reuses old results. Deployed with `docker-compose.yml` by the hub's `deploy.sh`.

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

## Disease (v0.3)

Two kinds, as in the forager record (illness causes about 70% of forager deaths, Gurven & Kaplan 2007):

- **Everyday illness**: infant illness, infection and other illness. Hunger multiplies these hazards (`hungerIllness`), so most hunger deaths are illness deaths; outright starvation happens only past the `famineLine`.
- **Contagious strains**: respiratory, gut, fever and pox strains spill over from wild animals, herds and crowded villages. An outbreak infects a share of the *susceptible* people given by the SIR final-size equation; survivors are immune, so outbreaks return as children are born. Small bands cannot keep crowd diseases going (measles needs a population of hundreds of thousands), so strains burn out and come back only by new spillover or by contact: trade, raids, kin and captives. A strain new to a people (no one immune) hits hardest.

## Winning

A society wins by surviving: its line (the founders or any band that split from them) is alive at the end. Share of the world's people breaks ties.

## Calibration (v0.1)

Pooled lone-society runs: infant mortality ≈ 0.17, survival to 15 ≈ 0.60 (forager life tables put these near 0.2 and 0.55–0.6). Lone bands plateau at ~150–180 people; the island carries ~250–300. War causes 20–50% of adult male deaths in contested pairings (Keeley's ethnographic range is 10–60%). Hunger acts mainly through illness and suppressed fertility.

Known simplifications: food is one currency (kcal); no terrain beyond patch types; sweeps run in the browser worker rather than on the hub. In the valley, farming booms then busts as soil tires and villages outgrow walking-distance fields; war causes ~20–25% of deaths there.

Spec: Society Sim — Spec v0 (claude.ai doc).
