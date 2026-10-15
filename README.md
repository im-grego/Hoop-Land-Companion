# Hoop Land Companion

An installable web app (PWA) for running an **offseason development phase** on Hoop Land season files.

1. **Load** a season file (the extension-less JSON save from your Hoop Land saves folder).
2. **Pick your teams.** Commissioner saves control every team, so you choose which ones are yours.
3. **Run the offseason bump:** players 25 and under earn upgrade points based on age and minutes.
4. **Adjust your players:** tweak their points, ratings or skills.
5. **Export** the file and drop it back into the game to continue the offseason.

Everything runs on-device; the file never leaves your phone.

## How the offseason bump works

The bump sits on top of the game's normal in-season progression. Young players earn extra **upgrade points**,
which are added to each player's `season.ap` pools (Finishing, Shooting, Creating, Defense) and spent in-game.
Every team gets the same rules, so CPU teams stay even with yours.

- **Points by age** (default): 18–20: 4–6, 21–23: 2–4, 24–25: 1–2, 26+: none.
- **Minutes multiplier** from last season: starters (≥28 MPG) ×1.25, bench (<15 MPG) ×0.75.
- Points are split across the four categories by where the player has room to grow and where they're strong.
- **Your players:** adjust any player's points per category by hand.
- **CPU points:** held for the game to spend (default), or *Spend Now* to apply them to ratings in the app
  for commissioner saves where the CPU doesn't spend. Spending raises the ceiling with the rating (13/14 +2 → 15/15).
- Optional skill unlocks/level-ups (off by default).
- Runs are **seeded**, so the same seed reproduces the same offseason. Re-roll for a different one.

All of these are adjustable under **Settings**.

## Draft room

Available once the file has a draft class (offseason, before the lottery).

- **Board:** prospects ranked by projection, with **floor** and **ceiling comps**. Floor = skill ratings after the
  rookie drop (−4, never below 2; ratings already at 2 or lower stay). Ceiling = their top ratings. Comps match the 12
  skill ratings plus height against active players, free agents, retirees and Hall of Famers.
- **Lottery:** odds per team from your league's lottery weights (Monte Carlo), and a one-off lottery simulation.
  Supports the NBA 3-2-1 format (all 16 lottery picks drawn, worst 3 teams no lower than #12; auto-detected) and
  the classic top-4 draw.
- **Mock draft:** uses the simulated lottery (or record order), honours traded picks; CPU teams take the best fit,
  you pick for your teams.
- **Trades:** swap draft picks between any two teams, written to the season file (undo per trade).

## Save-file safety

Only player upgrade points (`season.ap`), ratings/skills you edit, and draft-pick ownership from trades are modified. Everything else, including Unity's float formatting,
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
node tests/draft.test.mjs       path/to/offseason-file # comps, lottery, mock draft, pick trades
```
