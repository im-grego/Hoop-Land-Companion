# Hoop Land Companion

An installable web app (PWA) for running an **offseason development phase** on Hoop Land season files.

1. **Load** a season file (the extension-less JSON save from your Hoop Land saves folder).
2. **Pick your teams.** Commissioner saves control every team, so you choose which ones are yours.
3. **Run the offseason bump:** players 25 and under earn upgrade points based on age and minutes.
4. **Adjust your players:** tweak their points, ratings or skills.
5. **Export** the file and drop it back into the game to continue the offseason.

Everything runs on-device; the file never leaves your phone.

## How the offseason bump works

Run it in **free agency, Day 3** (the last day before advancing to the new season). Ratings don't change anywhere
in the offseason; the game applies progression/regression once the new season starts. Ages are the new-season ages.

The bump sits on top of the game's normal in-season progression. Young players earn extra **upgrade points**,
which are added to each player's `season.ap` pools (Finishing, Shooting, Creating, Defense) and spent in-game.
Every team gets the same rules, so CPU teams stay even with yours.

- **Points by age** (default): 18–20: 4–6, 21–23: 2–4, 24–25: 1–2, 26+: none.
- **Minutes multiplier** from last season: starters (≥28 MPG) ×1.25, bench (<15 MPG) ×0.75.
- Points are split across the four categories by where the player has room to grow and where they're strong.
- **Your players:** adjust any player's points per category by hand.
- **CPU points:** held for the game to spend (default), or *Spend Now* to apply them to ratings in the app
  for commissioner saves where the CPU doesn't spend. Spending raises the ceiling with the rating (13/14 +2 → 15/15).
- **Longevity:** regression starts once a player's age passes their `regressionAge`. Players in their first season
  of decline have a 30% chance (10% later on, scaled by minutes) to have `regressionAge` pushed back a year.
- **Earned longevity:** the game itself adds +1 regression age to players 30+ who play every game at 30+ MPG
  (62.5% of minutes). The app lowers that bar to 90% of games and 60% of minutes (28.8 MPG); players the game
  already rewarded are skipped, and those who earn it skip the random roll.
- **Potential:** players 25 and under have a rare 4% chance (scaled by minutes) of +1 potential (half a star, max 10).
- **Injuries:** players who missed 15+ games to injury last season (`history.injuries`) risk −1 potential:
  0.6% per game missed, ×0.8–1.1 by major severity (1–4; minor injuries ×0.6), ×1.2 lower body, ×1.25 at 30+.
  **Lingering injuries** (looking back 3 seasons): ×1.5 per earlier injury of the same type, ×1.25 per earlier
  injury in the same area, and recurring injuries count even under 15 games. Injuries fall into three classes:
  **standard** (base risk), **structural** (a major injury — broken, dislocated, fractured or torn — to Achilles,
  ACL, MCL, knee, ankle, foot, hip or back: ×1.25 risk, and the regression-delay chance is cut 75% instead of 50%;
  checked first, so major beats body part) and **nagging** (groin, abs, back, calf, hamstring, thigh — torn muscles included — plus sprained ankles and knees: tend to recur,
  ×1.25 risk and ×0.75 offseason bump points).

Injury codes, as the game names them: core 1–5 Head, Abs, Back, Groin, Hip · upper body 1–6 Thumb, Finger, Hand,
Wrist, Elbow, Shoulder · lower body 1–10 Toe, Foot, Ankle, Achilles, Calf, Hamstring, Thigh, ACL, MCL, Knee · minor
severity 1–11 Bruised, Concussed, Jammed, Pulled, Sore, Sprained, Stiff, Strained, Swollen, Tweaked, Repaired · major
severity 1–4 Broken, Dislocated, Fractured, Torn. Capped at 50%. Injured players can't also get the potential upgrade, and their
  regression-delay chance is cut in half.
- Regression age and potential can also be adjusted by hand on any player.
- Optional skill unlocks/level-ups (off by default).
- Runs are **seeded**, so the same seed reproduces the same offseason. Re-roll for a different one.

All of these are adjustable under **Settings**.

## Mentorship

Also in free agency: veterans (30+) teach a young teammate (24 and under) within two position steps one of their
skills — one they have at Lv 2+ that the youngster lacks — and it unlocks right away (keeping
any XP already built toward it). One mentee per mentor and one skill per mentee each offseason. CPU teams pair up
automatically (50% per eligible mentor, best-fit skill); for your teams you pick the pairing and skill. Free skills
are never taught, and elite skills only if allowed in settings (off by default).

Skills (code → name; first in each category is free, last two are elite and need 16/20 in a related rating):

| Finishing | Shooting | Creating | Defense |
|---|---|---|---|
| HIG Highlight Reel (free) | SPA Spark Plug (free) | DIM Dimer (free) | CLA Clamps (free) |
| CRA Crafty | CLU Clutch Gene | CHE Chef | LOC Locked In |
| SOF Soft Touch | SPO Spot Up | CLE Cleanup Crew | MAG Magnet |
| TEA Tear Dropper | VOL Volume Shooter | STE Step Dancer | TWO Two Way |
| BUL Bully (elite) | LIM Limitless (elite) | FOO Foot Surgeon (elite) | BAL Ball Hawk (elite) |
| DUN Dunk Artist (elite) | UNF Unfazed (elite) | HOT Hot Potato (elite) | SNA Snatcher (elite) |

Elite requirements (16/20): Bully INS, Dunk Artist DNK, Unfazed MID, Limitless TPT, Ball Hawk STL, Snatcher BLK.
With elite teaching on, the young player must already meet the requirement.

## Draft room

Available once the file has a draft class (offseason, before the lottery).

- **Board:** prospects ranked by projection, with **floor** and **ceiling comps**. Floor = the projected rookie line:
  the draft drop (−4, never below 2; ratings already at 2 or lower stay) minus what summer league gives back for their
  age. Each rating shows its projected loss. Ceiling = their top ratings. Comps weigh the 12
  skill ratings, position, height and weight against active players, free agents, retirees and Hall of Famers.
- **Lottery:** odds per team from your league's lottery weights (Monte Carlo), and a one-off lottery simulation.
  Supports the NBA 3-2-1 format (all 16 lottery picks drawn, worst 3 teams no lower than #12; auto-detected) and
  the classic top-4 draw.
- **Mock draft:** uses the simulated lottery (or record order), honours traded picks; CPU teams take the best fit,
  you pick for your teams.
- **Trades:** swap draft picks between any two teams, written to the season file (undo per trade).
- After the lottery (phase 4) the lottery tab and mock draft use the real draft order from the save. After the
  draft (phase 5) the room shows the rookie class with comps.

## Summer league (right after the draft)

Older rookies win back part of the draft drop: 18–19 +0 (keep the full −4), 20–21 +1 (net −3), 22+ +2 (net −2), never past their
pre-draft rating (12 skill ratings only; physicals never drop). The app remembers prospects' pre-draft ratings
whenever you load a save that has a draft class; at the post-draft phase you can also load a pre-draft save as a
read-only reference. It only runs at the Post-Draft phase and is locked for that season once you export, so it
can't be applied twice.

## Rookie bump

After the draft (phase 5), rookies get their own bump: upgrade points by age (≤19: 3–5, 20–21: 2–4, 22+: 1–3),
×1.25 for first-rounders, ×1.0 second round, ×0.75 undrafted (optional). Points go into `season.ap` like the
offseason bump. Rookies' ratings already include the draft drop.

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
node tests/rookies.test.mjs     pre-draft post-draft   # real draft order, draft drop, rookie bump
node tests/mentorship.test.mjs  path/to/season-file   # mentor/mentee rules
```
