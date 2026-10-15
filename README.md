# Hoop Land Companion

An installable web app (PWA) for running an **offseason development phase** on Hoop Land season files.

1. **Load** a season file (the extension-less JSON save from your Hoop Land saves folder).
2. **Pick your teams.** Commissioner saves control every team, so you choose which ones are yours.
3. **Run auto progression** on every CPU team (and optionally free agents) using adjustable rules.
4. **Hand-pick upgrades** for your own players: raise ratings, add or level up skills, or auto-develop selected players.
5. **Export** the file and drop it back into the game to continue the offseason.

Everything runs on-device; the file never leaves your phone.

## How progression works

Each rating in the save is stored as `[current, ceiling]`. Auto progression raises `current` toward `ceiling`
(the game's own regression handles decline, so this only adds). Raising a rating past its ceiling lifts the ceiling with it (13/14 +2 → 15/15).

- **Points by age** (default): ≤22: 3–6, 23–25: 1–4, 26–29: 0–2, 30+: none.
- **Minutes multiplier** from last season: starters (≥28 MPG) ×1.25, bench (<15 MPG) ×0.75.
- **Held points** (earned but unspent, per category) are spent first; age-based growth is added on top.
- Points are spread across ratings, favouring room under the ceiling and the player's strengths, max +3 per rating.
- **Skills:** young players with a big jump may learn a new skill picked to fit their ratings; existing skills can level up (max Lv 3).
- Runs are **seeded**, so the same seed reproduces the same offseason. Re-roll for a different one.

All of these are adjustable under **Settings**.

## Save-file safety

Only player `attributes`, `skills` and held points (`season.ap`) are modified. Everything else, including Unity's float formatting,
is written back byte-for-byte (see `js/savefile.js`). Keep a backup of your original file anyway.

## Running it

It's a static site with no build step.

- **Local:** `python3 -m http.server` in this folder, then open `http://localhost:8000`.
- **On your phone:** host it on GitHub Pages (Settings → Pages → deploy from branch), open the URL,
  then use *Add to Home Screen* (iOS Safari) or *Install app* (Android Chrome).

## Tests

```sh
node tests/roundtrip.test.mjs   path/to/season-file   # load + save is byte-identical
node tests/progression.test.mjs path/to/season-file   # progression rules hold
```
