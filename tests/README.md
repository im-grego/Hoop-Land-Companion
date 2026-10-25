# Tests

Saves aren't kept in the repo (they're big and personal), so most tests take a save path.

| Test | Needs | Checks |
|---|---|---|
| `node tests/regression.test.mjs` | nothing | In-game regression: every rating and level of a seven-season decline read off the game |
| `node tests/roundtrip.test.mjs <save>` | any save | Load and save is byte-for-byte lossless (and how long each takes) |
| `node tests/smoke.test.mjs <save> [...]` | any saves | Real browser: loads each save, opens every screen for its mode and point in the season, builds the export, fails on any page error |
| `node tests/storylines.test.mjs <save>` | a season-complete save | Storyline detection |
| `node tests/progression.test.mjs <save>` | an offseason save | Camp point spending |
| `node tests/mentorship.test.mjs <save>` | an offseason save | Mentor trait passing |
| `node tests/draft.test.mjs <save>` | pre-draft (phase 4) | Draft scoring |
| `node tests/freeagency.test.mjs <save> [day]` | free agency (phase 6) | Free agency |
| `node tests/phases.test.mjs <pre-lottery> [post-draft fa-day-1]` | phase files | Phase advances |
| `node tests/livedraft.test.mjs <pre-draft> <post-draft> [fa-day-1]` | phase files | Live draft against the game's |
| `node tests/rookies.test.mjs <pre-draft> <post-draft>` | phase files | Rookie ratings |

A good set for the smoke test covers one save of each mode: a franchise save in the offseason, a commissioner save, and career saves at the All-Star break, the start of the playoffs and the offseason.
