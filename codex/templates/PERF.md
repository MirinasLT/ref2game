# PERF.md: performance plan (references/performance.md §12)

Written before the systems are coded, kept current. Every decision names its reason (the count, the mechanic).

## 1. Target
- Devices: mid-range phone (Android Chrome, iOS Safari) + desktop
- View: <SIM.VIEW>, render scale: auto (tier cap: high 1, mid 0.75, low 0.6)
- Platform: <desktop / phone / universal> · Controls: <keys, touch layout (SIM.CONTROLS), pad>
- Tiers (performance.md §13): what this game's own extras drop at mid / low: <e.g. reflection pass off at low, sparks × L.fx>
- Budgets: frame p95 ≤ 16.7 ms · CPU p95 ≤ 8 ms · draws ≤ 250 (peak 400) · full-screen passes ≤ 10 · textures ≤ 150 MB · heap flat

## 2. Entity budget (max simultaneous, from the design)
| System | Max | Why this number |
|---|---|---|
| e.g. enemies | | |
| e.g. bullets / projectiles | | |
| e.g. pickups | | |
| e.g. particles | | |

## 3. Decisions per system
| System | Pool (size, when full) | Broad phase | Update tier | Draw (batch/atlas or L.sprite) | Cull |
|---|---|---|---|---|---|
| | | | | | |

## 4. Render plan
| Layer (in order) | Draws | Full-screen? | Texture / atlas |
|---|---|---|---|
| | | | |

Atlases: <name: contents>. Texture MB: <from __perf()>.

## 5. Measured (`__perf()` / livecheck)
| When | Case | fps | frame p50/p95 | cpu p95 | draws | tex MB |
|---|---|---|---|---|---|---|
| Gate A | normal play | | | | | |
| Gate B | normal play | | | | | |
| Gate B | stress (max counts) | | | | | |
| Gate B | `--mobile --cpu 4` | | | | | |
| Gate B | `--q low` | | | | | |
