# Society Sim

Two forager bands share a rich-forest island for 500 years. Each carries a **genome** of social rules — marriage, mate choice, descent, residence, labour division, food sharing, foraging, trade, governance, norm enforcement, outgroup stance, captives, famine policy, fission size, ritual. The app shows which ways of organising people survive, grow or absorb the other, and *why*: every birth, death, rule change and technology change is logged with its cause.

Live: https://society-sim.apps.precogsoftwareservices.com

## Run

```sh
npm run build      # copies src/ into public/src (static site, no deps)
npm test           # determinism + forager-range demography checks
npm run sim -- "Egalitarian matriarchy" "Patriarchal harem" 5 500
node tools/sweep.mjs 20 500   # round robin of all presets
```

Serve `public/` with any static server.

## Layout

| Path | What |
| --- | --- |
| `src/engine.js` | Year-tick agent model: world, people, sharing, mortality, marriage, births, raids, trade, skills/tech, cultural evolution, fission |
| `src/genome.js` | Rule genes, presets, mutation |
| `src/params.js` | Every baseline parameter and the 15 technologies |
| `src/sweep.js` | Genome pairs × seeds → survival/share/pop with 95% CIs |
| `public/` | Web app (Web Worker runs the engine; hand-rolled SVG charts) |
| `tools/` | Build, tests, CLI runs and sweeps |

## Calibration (v0.1)

Pooled lone-society runs: infant mortality ≈ 0.17, survival to 15 ≈ 0.60 (forager life tables put these near 0.2 and 0.55–0.6). Lone bands plateau at ~150–180 people; the island carries ~250–300. War causes 20–50% of adult male deaths in contested pairings (Keeley's ethnographic range is 10–60%). Hunger acts mainly through illness and suppressed fertility.

Known v0.1 simplifications: food is one currency (kcal); 400-patch grid without terrain; sweeps run in the browser worker rather than on the hub; desert nomadic environment is v2.

Spec: Society Sim — Spec v0 (claude.ai doc).
