# Hoop Land Companion

An installable web app (PWA) for running an **offseason development phase** on Hoop Land season files.

1. **Load** a season file (the extension-less JSON save from your Hoop Land saves folder).
2. **Pick your teams.** Commissioner saves control every team, so you choose which ones are yours.
3. **Run the offseason bump:** players 25 and under earn upgrade points based on age and minutes.
4. **Adjust your players:** tweak their points, ratings or skills.
5. **Export** the file and drop it back into the game to continue the offseason.

Everything runs on-device; the file never leaves your phone.

## The offseason calendar

Load the save from the **start of the offseason (Pre-Lottery)**. The main menu is a calendar from June to October;
each step unlocks only when the one before it is finished, and each tool opens only during its own step:

| Date | Step | What happens |
|---|---|---|
| Jun 1 | Front Office | Pick the teams you run. |
| Jun 2 | Draft Lottery | Check the odds, then run the lottery (writes the draft order). |
| Jun 3–24 | War Room | Scout the class, build your big board and watch list, mock drafts, pick trades. Lock the board. |
| Jun 25 | NBA Draft | The live draft with trades. Finishing moves the save to Post-Draft. |
| Jul 1–5 | Summer League | Rookies win back draft-drop ratings by age; the rookie bump. |
| Jul 6 | Free Agency · Day 1 | Opening free agency signs the draft picks; the main market. |
| Jul 7 | Free Agency · Day 2 | Mid-level exception. |
| Jul 8 | Free Agency · Day 3 | Finalize free agency: veteran minimums. |
| Aug–Sep | Player Development | Development coach and trainer, mentorship, jersey numbers. |
| Sep 29 | Media Day | The top 10 storylines. |
| Oct 21 | Opening Night | Export once and load the file in Hoop Land. |

Finished steps show what happened (the lottery winner, the #1 pick, each free agency day's biggest deal). The last
phase change (lottery, draft, opening free agency, a new day) can be undone until the next step is finished. Saves
from later in the offseason start at their step, with earlier ones marked done. The draft writer reproduces the game's
post-draft save, and opening free agency signs rookies to the same contracts the game gives.

## How the offseason bump works

Run it in **free agency, Day 3** (the last day before advancing to the new season). By default it's a meeting with
the **development coach**: players get real rating upgrades (e.g. MID 13/18 → 15/18, at most +3 per rating;
ceilings rise with the rating, free throws stop at 16). The older *Upgrade Points* mode is still in Settings. Ratings don't change anywhere
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
- **Trainer (production):** each player's last season (15+ games, 10+ MPG) is scored as per-36 game score and
  compared, as a z-score, with players in the same role (guards / wings / bigs) within 1 year of their age (widened a year at a time if fewer than 8 peers).
  Standout seasons (z ≥ 1.5) add +12% per σ to the potential roll; poor young seasons (z ≤ −1.5) have a 6% chance
  of −1 potential. Production also scales the regression-delay roll (×(1 + 0.4·z), 0.2–2).
- **Regression sooner:** players within 3 years of their regression age can lose a year of `regressionAge`:
  25% after a structural injury, 15% nagging, 8% standard, or 15% after a poor season (z ≤ −1.0). A player
  never gains and loses regression age in the same offseason.
- Regression age and potential can also be adjusted by hand on any player.
- Optional skill unlocks/level-ups (off by default).
- Runs are **seeded**, so the same seed reproduces the same offseason. Re-roll for a different one.

All of these are adjustable under **Settings**.

## Mentorship

Also in free agency: veterans (33+) teach one of their skills — one they have at Lv 2+ — to up to two young
teammates (25 and under) within one position step (a GF teaches SG, GF, SF), and it unlocks right away (keeping any
XP already built toward it). One skill per vet, one skill per young player each offseason. CPU teams pair up
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

Elite requirements (16/20): Bully INS, Dunk Artist DNK, Unfazed MID, Limitless TPT, Foot Surgeon DRB, Hot Potato PAS,
Ball Hawk STL, Snatcher BLK.
With elite teaching on, the young player must already meet the requirement.

## Draft room

Available once the file has a draft class (offseason, before the lottery).

- **Board:** prospects ranked by projection, with **floor** and **ceiling comps**. Floor = the projected rookie line:
  the draft drop (−4, never below 2; ratings already at 2 or lower stay) minus what summer league gives back for their
  age. Each rating shows its projected loss. Ceiling = their top ratings. Comps weigh the 12
  skill ratings, position, height and weight against active players, free agents, retirees and Hall of Famers.
  Every comp is tagged by its potential: 11 Legend, 10 Hall of Fame, 9 Superstar, 8 All-Star, 7 Starter,
  6 Role Player, 5 Bench Depth, 4 Project. Floor comps use the rookie line plus +2 a rating of natural development. A prospect's own potential is never shown (no stars or tier in the draft room).
  One floor and one ceiling comp per prospect, assigned across the whole class so no player is used twice (best
  prospects pick first). Ceiling comps are at or below the prospect's scouted tier; 10+ potential comps (Hall of Fame,
  Legend) only go to top-tier prospects, at most 3 per class, and never as floors; those prospects lean toward the
  greats rather than current players. Comps stay within 2 inches of the prospect's height whenever possible. Ceiling comps sit within one tier of the
  scouted tier; floors sit at least one tier under the ceiling comp. Comps need 2+ seasons in the league, so rookies (older ones
  included) are never used. Current players are
  preferred (retirees and Hall of Famers only win clear matches, about 1 in 4 ceilings). Like real scouting reports,
  a couple of comps per class get a "+" (the prospect projects a bit better) or "lite" (a bit short) — 2 of each.
- **Fog of war:** projections use a scouted potential that's usually right but, 25% of the time by default, reads one
  step high or low (stable per prospect and save; Settings → Rookies → Scouting Report Accuracy). The board order,
  projected ceilings, ceiling comps and CPU mock picks all use it.
- **Projected ceilings:** the game caps every generated prospect's ceiling at ~140 total (an All-Star line) regardless
  of potential, while prime players top out at about 140 + 14 per potential step (pot 9 ≈ 154, pot 10 ≈ 168,
  pot 7 ≈ 126). Ceilings are projected to the prospect's tier — extra points spread over their strengths (≤ +6 each),
  lower tiers scale down — and comps only use players with 2+ seasons in the league (plus retirees and Hall of Famers).
  Free throws are capped at 16.
- **Scouting report:** two strengths and a weakness per prospect, judged against active players at similar positions
  and weighted by what matters for the role (guard / wing / big); free throws only count as a weakness when awful.
- **War Room step:** your teams' stage, needs and draft capital (this year's picks with their slots, future picks by
  year) sit at the top, over three tabs:
  - **Consensus:** the whole class ranked by the scouts, with a draft grade on each prospect. Tap **+** to add a
    prospect to your board.
  - **War Room:** your board (the order you set with ▲▼; it comes first in your pick list on draft night) and a
    first-round **mock draft** from every team's stage, needs and board (re-run any time).
  - **Front Office:** your **trade block**. Put players or picks on it and **Field Offers**: CPU teams build
    packages from their picks and players (never their two best players), and teams behind your picks call about
    moving up. Accept an offer, or **Build a Trade** yourself. Trades are written to the file and can be undone.
  Each prospect page shows college stats, fit on your team, the scouting report and comps.
- **Lottery:** three formats, with each team's odds at #1 and at a top pick (20,000 simulations, shown as bars):
  **3-2-1** (NBA 2027+: your league's weights, all lottery picks drawn, worst 3 teams no lower than #12;
  auto-detected), **Top 4** (NBA 2019–2026: 14 teams, worst 3 at 14%, top 4 drawn) and **Old School**
  (NBA 1994–2018: 14 teams, worst at 25%, top 3 drawn).
- **Consensus** shows each prospect's overall rank so you know how far down the board you are.
- **Draft grades** next to every prospect: Consensus #1, Top 5, Lottery, First Round, Second Round, UDFA, or N/A
  (projected to go unsigned). They follow the board with a fixed scouting nudge near the cutoffs, so they read like
  projections rather than exact ranks.
- **Board order:** prospects whose floor and ceiling comps are both
  All-Star or better rank first, and the comp tiers count directly (a Hall of Fame ceiling beats a Superstar one, a
  Starter floor beats Bench Depth).
- **How teams value prospects:** expected potential (the scouted tier) leads, then the projected ceiling, then the
  floor, and youth counts for a lot: about three years younger beats a matching ceiling and floor. Team tags come from
  last season's finish (record and playoff run) and the roster's current talent:
  - **Rebuilding** teams lean hardest on ceiling and youth;
  - **Developing** teams are close behind;
  - **Contending** teams weigh the floor and barely mind age, so older, ready-now prospects go to contenders.
- **Team needs:** every team has two needs, a position group (guards: PG/G/SG, wings: GF/SF/F, bigs: PF/FC/C) and a skill (playmaking,
  shooting, finishing, post scoring, rebounding, perimeter D, rim protection), from its top two players at each group
  against the league average. A prospect who projects at or above the league average there fills the need, and teams
  lean toward those picks. Your teams' needs show on the board, on the clock, and next to prospects who fill them.
- **Mock draft:** uses the simulated lottery (or record order), honours traded picks. Teams weigh scouted value,
  roster need (guards/wings/bigs) and age, with some draft-day variance, so each run plays out differently. Sim All
  drafts for your teams too; or stop at your pick and choose.
- **Trades:** swap draft picks between any two teams, written to the season file (undo per trade).
- After the lottery (phase 4) the lottery tab and mock draft use the real draft order from the save. After the
  draft (phase 5) the room shows the rookie class with comps.

## Live draft (Pre-Draft save, after the lottery)

The **Live** tab in the draft room runs the real draft from the save's order. CPU teams pick by scouted value,
roster need and age with some variance; you pick for your teams from your own big board (watch-listed prospects
starred). Nothing is written until you finish. Trades are final; with **Commissioner Mode** on you can undo them
and **Reset** the draft.

- **Trades at any point:** picks in this draft, future picks, players, and **draft-and-trade** of a rookie any time
  after they're taken. A **Trade Alert** banner announces every trade. When the last pick is in, the **Draft Recap**
  lists every pick in team colors with the rookie's projected level after the draft dip (sort by pick or level). CPU teams accept when they get a bit more value back than they give;
  With **Commissioner Mode** on (Settings) you can trade for any team and **Force** pushes a trade through; off (the
  default), your side is limited to the teams you control. Pick teams with the ◀ ▶ arrows. Players whose contracts are up (pending free
  agents) can't be traded: they're listed last, greyed out with a 🔒 Pending FA tag. A balance bar
  under the teams slides as you add and remove assets. The middle is a fair deal by the CPU's standard (they want a
  little more back than they give, so the middle already includes that); anything in the green zone, they accept. Every trade can be undone.
- **Trade-back offers:** when you're on the clock, teams picking 3–8 slots later may offer their pick plus future
  picks to move up. CPU teams also trade up among themselves now and then in round 1 (Settings: off / rare / normal /
  busy).
- **Finish Draft** writes the draft the way the game does — rookies join their teams with the −4 drop, undrafted
  prospects become free agents, college stats move to history, used picks are removed, a draft news item per pick,
  and the save moves to the **Post-Draft** phase — so summer league and the rookie bump can follow. Replaying the
  game's own picks through this reproduces the game's post-draft save (the game re-sorts depth charts itself).
- **Player value** uses **Level** (a maxed 5-star is Lv 100; every two upgrades is one level, so a maxed 4-star is
  86 and a 4.5 is 93), last season's production, youth and upside, age decline, and the **contract**: an expiring deal
  is close to neutral, a bargain adds value, and an overpay for the player's level costs value for every year left
  (more with a player option, less with a team option). Trade labels show Level, salary × years, the option (TO/PO)
  and a Final Year / Overpaid / Bargain tag.
- **Player trades** move the player and update the player's new-season stats row (team and jersey), as the game does.
- **Jersey numbers:** a player joining a team (draft or trade) keeps their number if it's free; otherwise they try its
  single digit (#27 → 7, #55 → 5), then the lowest number that's neither worn nor retired. The offseason screen can
  also fix clashes the game left behind (duplicates and retired numbers; the longest-tenured player keeps the number).

## Rookie contracts (free agency)

The game signs this year's picks on Free Agency Day 1: first-rounders get a 4-year scale deal (#1 ≈ $10M down to
$2M) with a team option, second-rounders 4 years at the minimum. The offseason screen shortens second-round deals to
**2 years** with the team option kept (Settings → Rookies: 2, 3 or the game's 4). Undo is available until export.

## Free agency (Days 1–3)

**Main menu → Free Agency** on a Free Agency save runs that day's market: players with expiring deals and unsigned
free agents, each with an **asking price** (from last season's production, youth and upside; capped by the save's
max contract for their years in the league) and a **motivation**:

| | Motivation | Weighs most |
|---|---|---|
| 💰 | Money | salary vs. the ask |
| 🛡️ | Security | years |
| 🎛️ | Control | a player option (and a shorter deal) |
| 🏆 | Contender | team quality (last season + best players) |
| ⏱️ | Role | where they'd rank on the roster |

Veterans lean contender, stars money or control, young players security or role.

- **Day 1 — open market:** offers need cap space (cap from the save). A player's old team can go over the cap to
  re-sign them (Bird rights, up to 5 years).
- **Day 2 — mid-level exception:** one per team over the cap: up to $15M for 1–2 years with an option.
- **Day 3 — finalize free agency:** veteran minimums, $3M for 1 year (ages 30+). Asking prices drop each day (×0.9,
  ×0.75; veterans a further ×0.85 on day 3), and **veterans who aren't chasing money take the minimum** rather than sit
  out the season (a contender-minded vet asking $13M signs for $3M with the best team that calls). CPU teams spread
  their bids instead of piling onto the same few names.

Make offers for your teams: one tap for the **MLE** ($15M × 2, then pick no / team / player option) from Day 2 when
you're over the cap, one tap for the **vet minimum** ($3M × 1, sent right away) on Day 3; or set your own (salary, years, no / team / player option; the app checks the rules and shows whether
you're ahead), then **Open Bidding**: CPU teams bid on the best players they can afford plus a value signing, and
**bidding wars** push prices up (up to 30% over the ask). Raise if you're behind, then **Players Decide** — CPU teams
get one last raise, and each player takes the offer that best fits what they want (if it's close enough to the
ask). Rosters max out at 15 signed players.

Signings are written the way the game writes them (roster, status, contract, new-season stats row and number, a
signing news item) and the player's pending game offers are removed. By default the game's own pending CPU offers
are cleared too, so the game doesn't sign players over the app's results (Settings → Rookies). **Undo Today**
restores the file exactly. Export, advance a day in the game, and load the next day's save. Bidding wars feed the
storylines.

- **Restricted free agents:** first-round picks coming off their rookie deal (drafted within 4 seasons). Their old
  team can match any offer sheet, and a match beats every other offer. CPU teams match fair offers; for your RFAs
  you're asked to **Match** or **Let Go** before players decide.
- **Last day:** anyone still on a roster without a contract is released to the free-agent pool, so the game doesn't
  carry them (or their development) into the season.
- The market sorts by level, with Guards / Wings / Bigs / Bidding tabs. Players past their regression age are
  flagged **Declining** in red. Your own free agents are listed under Your Books (other teams can bid on them too).

## Summer league (right after the draft)

Two steps, in order, both by age only (draft slot doesn't matter) and final (undo needs Commissioner Mode):

1. **Age Adjustment**: the same on every skill, no dice.
2. **Summer League**: rookies earn upgrade points to spend in the game, more for younger players.

The age adjustment: older rookies win back part of the draft drop: 18–19 +0 (keep the full −4), 20–21 +1 (net −3), 22+ +2 (net −2), never past their
pre-draft rating (12 skill ratings only; physicals never drop). The app remembers prospects' pre-draft ratings
whenever you load a save that has a draft class; at the post-draft phase you can also load a pre-draft save as a
read-only reference. It only runs at the Post-Draft phase and is locked for that season once you export, so it
can't be applied twice.

## Rookie bump

After the draft (phase 5), rookies get their own bump: upgrade points by age (≤19: 3–5, 20–21: 2–4, 22+: 1–3),
×1.25 for first-rounders, ×1.0 second round, ×0.75 undrafted (optional). Points go into `season.ap` like the
offseason bump. Rookies' ratings already include the draft drop.

## Storylines

**Main menu → Storylines** ranks the top 10 stories of the offseason, written the way a fan would read them, with no
behind-the-scenes numbers. They come from the save: the champion going for a repeat, the MVP, contenders who fell
short (Finals losers, teams with several straight deep runs and no title), awards, notable retirements, signings and
trades (grouped when a team brings in several), the best players still unsigned, lottery luck, top-5 rookies
(especially on bad teams), stars coming back from injuries and aging stars racing Father Time. Development the app
applied this session shows up as summer buzz (big rating jumps), breakout candidates and notable mentorships. At most
two stories of a kind (three for moves and contenders). Tap a story to open the player; **Copy as Text** copies or
shares the list.

## Dropbox

On iPhone, the export screen's **Share → Save to Files → Dropbox** works with no setup. To upload straight from the
app, create a Dropbox app once at dropbox.com/developers/apps (Scoped access, permission `files.content.write`) and
paste its App key on the export screen. **Connect Dropbox** opens Dropbox; allow access and paste back the code it
shows (no redirect needed, so it works from the installed app). Uploads go to the folder you set (default
`/Hoop Land`); by default an existing file is kept and the upload renamed, or turn on *Replace the file if it
exists*. You can also upload the storylines as a `.txt`. The tokens are kept in this browser only.

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
node tests/storylines.test.mjs  path/to/season-file   # top 10 storylines
node tests/livedraft.test.mjs   pre-draft post-draft fa-day-1   # draft writer matches the game, live draft + trades, rookie deals
node tests/freeagency.test.mjs  fa-file [day]          # free agency rules, signings, exact undo
node tests/phases.test.mjs      pre-lottery [post-draft fa-day-1]  # whole offseason in code; rookie deals match the game
```
