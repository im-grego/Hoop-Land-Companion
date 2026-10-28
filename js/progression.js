// Offseason bump: on top of the game's normal in-season progression, young
// players earn extra upgrade points based on age and last season's minutes.
// Points go into season.ap (Finishing, Shooting, Creating, Defense) to be
// spent in-game, so user and CPU teams stay even.

import { secsOf } from './gameclock.js';
import { coachMult, durMult, durLongevity } from './traits.js';
import { ATTRS, ATTR_MAX, SKILL_MAX_LEVEL, CATEGORIES, POT_MIN, POT_MAX, MINOR_INJURY, lastSeasonMpg, activeSkills, isLeveled, injuryHistory, injuryPart } from './savefile.js';

// Categories the bump awards points in (Physical is left alone).
export const AWARD_CATEGORIES = [0, 1, 2, 3];

export const DEFAULT_PARAMS = {
  seed: 2027,
  // Upgrade points by age band: [maxAge, minPts, maxPts]. Older players get none.
  ageBands: [
    [20, 4, 6],
    [23, 2, 4],
    [25, 1, 2],
  ],
  // Minutes-per-game multipliers
  starterMpg: 28,
  benchMpg: 15,
  starterMult: 1.25,
  rotationMult: 1.0,
  benchMult: 0.75,
  strengthBias: 0.5,      // 0 = favour room to grow, 1 = favour strengths
  // 'train': the development coach raises ratings directly (ceilings rise
  // with them; free throws stop at 16). 'points': add upgrade points to
  // season.ap for spending in-game.
  bumpMode: 'train',
  trainMaxPerAttr: 3,
  includeFreeAgents: true,
  // Commissioner saves: CPU teams hold points without spending them. On =
  // spend CPU points into ratings now (raising ceilings as needed).
  spendCpuPoints: false,
  // Longevity: chance to push regressionAge back a year (scaled by minutes).
  regFirstYearChance: 18, // % for players in their first regression year (decline should usually start on time)
  regLaterChance: 6,      // % for players further into regression
  // Earned longevity: the game itself adds +1 regressionAge to players 30+
  // (season age) who play 100% of games at 62.5%+ of minutes (30 of 48).
  // The app lowers that bar; players the game already rewarded are skipped.
  naturalMinAge: 30,
  naturalGamesPct: 95,
  naturalMinutesPct: 65,
  gameNaturalGamesPct: 100,
  gameNaturalMinutesPct: 62.5,
  gameMinutes: 48,
  // Trainer: production vs players of the same role and age (z-score of
  // per-36 game score) moves potential and regression age.
  trainerMinGames: 15,
  trainerMinMpg: 10,
  prodAgeRange: 1,          // production peers: same role, within this many years of age
  prodPotUpZ: 1.5,          // z at which standout production starts to raise potential
  prodPotUpPerZ: 8,         // % per z above that
  prodPotDownZ: -1.0,       // z at which poor production can cost potential
  prodPotDownChance: 9,     // %
  prodLongevityPerZ: 0.4,   // regression-delay chance x(1 + 0.4 z), clamped
  regDownStructural: 25,    // % chance regressionAge drops a year after a structural injury
  regDownNagging: 15,
  regDownStandard: 8,
  regDownProdZ: -1.0,       // veterans near regression with production this poor...
  regDownProdChance: 15,    // ...can have regressionAge drop a year
  regDownWindow: 3,         // "near regression": within this many years of regressionAge
  // Rare potential change (1 = half a star): up scaled by minutes, down a
  // flat chance, so ups only slightly outnumber downs.
  potUpChance: 3,         // %
  potDownChance: 1,       // %
  potUpMaxAge: 25,
  // Serious injuries last season: chance to lose 1 potential.
  injuryMinGames: 15,     // games missed before there's any risk (recurring injuries always count)
  injuryPotPerGame: 0.6,  // % chance per game missed
  injuryOldAge: 30,       // at this age and up the chance is x1.25
  injuryPotMax: 50,       // % cap
  injurySevStep: 0.1,     // severity 1-4 -> x0.8 .. x1.1
  injuryLowerBodyMult: 1.2,
  injuryLongevityCut: 50, // % cut to the regression-delay chance after a serious injury
  injuryMinorMult: 0.6,   // non-major (minor) time-loss injuries
  injuryWindow: 3,        // seasons looked back for lingering injuries
  injuryRepeatType: 0.5,  // +50% per earlier injury of the same type
  injuryRepeatArea: 0.25, // +25% per earlier injury in the same body area
  // Injury classes:
  //  structural - a major injury to a load-bearing part (checked first, so a
  //               major back injury is structural, a sore back nagging)
  //  nagging    - soft tissue + back; tends to recur and holds players back
  //  standard   - everything else
  naggingParts: ['Groin', 'Abs', 'Back', 'Calf', 'Hamstring', 'Thigh'],
  naggingSprainParts: ['Ankle', 'Knee'], // sprains here linger too
  naggingRiskMult: 1.25,       // x potential-loss risk
  naggingPointsMult: 0.75,     // x offseason bump points
  structuralParts: ['Achilles', 'ACL', 'MCL', 'Knee', 'Ankle', 'Foot', 'Hip', 'Back'],
  structuralRiskMult: 1.25,
  structuralLongevityCut: 75,  // % cut to the regression-delay chance
  // Mentorship (see mentorship.js)
  mentorMinAge: 33,
  menteeMaxAge: 25,
  mentorPosRange: 1,      // position steps apart (PG..C): a GF teaches SG, GF, SF
  mentorMaxMentees: 2,    // one skill per vet, taught to up to this many players
  mentorSkillMinLevel: 2, // leveled skills must be at least this level to teach
  mentorshipChance: 50,   // % per eligible CPU mentor
  mentorTeachElite: false, // elite skills (last two per category) need 16/20 in-game
  // Optional skill gains (off by default)
  skillMaxAge: 25,
  skillMinPoints: 3,
  newSkillChance: 0,      // %
  levelUpChance: 0,       // %
  levelUpMaxAge: 25,
  maxSkills: 8,
  // Rookie bump (after the draft): [maxAge, minPts, maxPts] by age, times
  // a multiplier by draft round.
  rookieBands: [
    [19, 3, 5],
    [21, 2, 4],
    [99, 1, 3],
  ],
  rookieR1Mult: 1.25,
  rookieR2Mult: 1.0,
  rookieUndraftedMult: 0.75,
  rookieIncludeUndrafted: true,
  // Summer league right after the draft: [maxAge, drop points won back]
  recoveryBands: [[19, 0], [21, 1], [99, 2]],
  readiness: 'motor',      // the draft drop by motor (Pro-Ready −2, Base −3, Project −4) or by age ('age': the bands above)
  // Draft room: % of scouting reports that read potential one step off
  scoutVariance: 25,
  workoutSlots: 4,        // private workouts before the draft, per team you run
  lotteryFormat: 'auto',  // auto (from the league's settings) | 321 | top4 | old
  lotteryDraws: 4,        // unused (old setting)
  draftRounds: 2,
  redoOptions: true,        // reopen the options the game already decided before export
  capSystem: true,          // NBA cap, tax line and aprons by season (the save's cap set to the 2nd apron on export)
  liveCpuTradeChance: 10,  // % chance of a CPU trade around each CPU pick in the live draft
  draftTradeWindow: 8,
  commissioner: false,     // trades: work any team's side and force trades through
  tradeValues: false,      // trades: show asset values next to the balance bar
  rookieR2Years: 2,
  startYear: 1977,         // history starts: the merger year by default (0 keeps the file's own); written as the starting year on export so the game scrolls back that far
  faClearCpuOffers: true,  // clear the game's pending CPU offers after the app's free agency day        // second-round rookie deals (team option); the game gives 4     // picks after being drafted that a rookie can still be traded (draft-and-trade)
};

// Deterministic RNG so a seed reproduces the same offseason.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }

function weightedPick(rng, items, weightOf) {
  let total = 0;
  for (const it of items) total += weightOf(it);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const it of items) {
    r -= weightOf(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

// Average attribute profile of players who own each skill, used to pick
// skills that fit a player without needing to know what the codes mean.
export function buildSkillProfiles(players) {
  const sums = {};
  for (const p of players) {
    for (const s of activeSkills(p)) {
      const e = sums[s.id] || (sums[s.id] = { n: 0, v: ATTRS.map(() => 0) });
      e.n++;
      ATTRS.forEach((k, i) => { e.v[i] += p.attributes[k][0]; });
    }
  }
  const profiles = {};
  for (const [id, e] of Object.entries(sums)) profiles[id] = { count: e.n, v: e.v.map(x => x / e.n) };
  return profiles;
}

function centered(v) {
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return v.map(x => x - m);
}

function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

// Skills ranked by how well they fit this player's strengths.
export function rankSkillsFor(p, profiles) {
  const owned = new Set(activeSkills(p).map(s => s.id));
  const pv = centered(ATTRS.map(k => p.attributes[k][0]));
  return Object.entries(profiles)
    .filter(([id]) => !owned.has(id))
    .map(([id, prof]) => ({ id, fit: cosine(pv, centered(prof.v)) }))
    .sort((a, b) => b.fit - a.fit);
}

export function minutesMult(mpgInfo, params) {
  const mpg = mpgInfo ? mpgInfo.mpg : 0;
  return mpg >= params.starterMpg ? params.starterMult
    : mpg >= params.benchMpg ? params.rotationMult
    : params.benchMult;
}

export function pointsFor(p, mpgInfo, params, rng) {
  const band = params.ageBands.find(b => p.age <= b[0]);
  if (!band) return 0;
  // Coachable players get more out of the offseason, stubborn ones less.
  return Math.round(randInt(rng, band[1], band[2]) * minutesMult(mpgInfo, params) * coachMult(p));
}

// How much a player "wants" points in a rating: room under the ceiling,
// blended with how strong they already are.
function attrWeight(p, k, params) {
  const [cur, ceil] = p.attributes[k];
  if (cur >= ATTR_MAX) return 0;
  const room = Math.max(1, ceil - cur);
  return room * ((1 - params.strengthBias) + params.strengthBias * (cur / ATTR_MAX) * 2);
}

const trainCap = k => (k === 'FTS' ? 16 : ATTR_MAX);

// Development coach: spend `points` straight into ratings in the four skill
// categories, weighted toward where the player has room and strengths.
// Ceilings don't stop it (they rise with the rating), except free throws at
// 16. At most `trainMaxPerAttr` per rating. Returns points applied.
export function trainPoints(p, points, params, rng) {
  const gained = {};
  const ok = k => p.attributes[k][0] < trainCap(k) && (gained[k] || 0) < params.trainMaxPerAttr;
  const w = k => (ok(k) ? Math.max(0.5, attrWeight(p, k, params)) : 0);
  let given = 0;
  for (let n = 0; n < points; n++) {
    const cat = weightedPick(rng, AWARD_CATEGORIES, i => CATEGORIES[i].attrs.reduce((a, k) => a + w(k), 0));
    if (cat == null) break;
    const k = weightedPick(rng, CATEGORIES[cat].attrs, w);
    const a = p.attributes[k];
    a[0]++;
    if (a[1] < a[0]) a[1] = a[0];
    gained[k] = (gained[k] || 0) + 1;
    given++;
  }
  return given;
}

// Add `points` to season.ap, split across the award categories.
export function awardPoints(p, points, params, rng) {
  const ap = p.season?.ap;
  if (!ap || points <= 0) return 0;
  const weights = AWARD_CATEGORIES.map(i =>
    CATEGORIES[i].attrs.reduce((a, k) => a + attrWeight(p, k, params), 0));
  let given = 0;
  for (let n = 0; n < points; n++) {
    const i = weightedPick(rng, AWARD_CATEGORIES, i => weights[AWARD_CATEGORIES.indexOf(i)]);
    if (i == null) break;
    ap[i]++;
    given++;
  }
  return given;
}

// Spend held points into ratings: each point is +1 to a rating in its
// category, and the ceiling rises with it (13/14 +2 -> 15/15). Points with
// nowhere to go (category all at 20) stay held. Returns points spent.
export function spendHeldPoints(p, params, rng) {
  const ap = p.season?.ap;
  if (!ap) return 0;
  let spent = 0;
  CATEGORIES.forEach((c, i) => {
    while (ap[i] > 0) {
      const k = weightedPick(rng, c.attrs, k => attrWeight(p, k, params));
      if (!k) break;
      p.attributes[k][0]++;
      if (p.attributes[k][1] < p.attributes[k][0]) p.attributes[k][1] = p.attributes[k][0];
      ap[i]--;
      spent++;
    }
  });
  return spent;
}

export function rookiePoints(p, round, params, rng) {
  if (round === 0 && !params.rookieIncludeUndrafted) return 0;
  const band = params.rookieBands.find(b => p.age <= b[0]);
  if (!band) return 0;
  // By age only: where a rookie was drafted doesn't matter.
  return randInt(rng, band[1], band[2]);
}

// Rookie bump. `entries` are { p, round, spend }. Returns Map pid -> points.
export function runRookieBump(entries, params) {
  const rng = mulberry32(params.seed ^ 0x5eed);
  const awards = new Map();
  for (const e of [...entries].sort((a, b) => a.p.id - b.p.id)) {
    awards.set(e.p.id, awardPoints(e.p, rookiePoints(e.p, e.round, params, rng), params, rng));
    if (e.spend) spendHeldPoints(e.p, params, rng);
  }
  return awards;
}

// Lowered bar for the game's own regression-age bonus. `ctx` = { totalGames,
// rolled } (rolled: ages already ticked over for the new season).
export function earnsNaturalLongevity(p, mpgInfo, ctx, params) {
  if (!mpgInfo || !ctx?.totalGames) return false;
  const seasonAge = p.age - (ctx.rolled ? 1 : 0);
  if (seasonAge < params.naturalMinAge) return false;
  // Same window as the trainer: at the regression age or the year before.
  if (p.age < p.regressionAge - 1 || p.age > p.regressionAge) return false;
  const gamesPct = mpgInfo.gp / ctx.totalGames * 100;
  const minPct = mpgInfo.mpg / params.gameMinutes * 100;
  const gameDid = gamesPct >= params.gameNaturalGamesPct && minPct >= params.gameNaturalMinutesPct;
  return !gameDid && gamesPct >= params.naturalGamesPct && minPct >= params.naturalMinutesPct;
}

// Did the game itself already add a year (30+, every game at 62.5%+ of
// minutes)? Then the offseason doesn't add another.
export function gameRewardedLongevity(p, mpgInfo, ctx, params) {
  if (!mpgInfo || !ctx?.totalGames) return false;
  if (p.age - (ctx.rolled ? 1 : 0) < params.naturalMinAge) return false;
  return mpgInfo.gp / ctx.totalGames * 100 >= params.gameNaturalGamesPct && mpgInfo.mpg / params.gameMinutes * 100 >= params.gameNaturalMinutesPct;
}

// ---------------------------------------------------------------------------
// Trainer: production relative to peers

const ROLE = pos => (pos <= 2 ? 'guard' : pos <= 5 ? 'wing' : 'big');

// Per-36 game score for a season in a league, or null if they barely played.
export function seasonGameScore(p, leagueIdx, year, params) {
  const s = (p.stats || []).find(x => x.league === leagueIdx && x.yr === year);
  if (!s) return null;
  const t = (s.season || []).reduce((a, r) => {
    for (const k of ['GP', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'FGM', 'FGA', 'FTM', 'FTA']) a[k] = (a[k] || 0) + r[k];
    a.MIN = (a.MIN || 0) + secsOf(r, leagueIdx) / 60;
    return a;
  }, {});
  if (!t.GP || t.GP < params.trainerMinGames || t.MIN / t.GP < params.trainerMinMpg) return null;
  const gs = t.PTS + 0.7 * t.REB + 0.7 * t.AST + t.STL + 0.7 * t.BLK - 0.7 * t.TO
    - 0.4 * (t.FGA - t.FGM) - 0.4 * (t.FTA - t.FTM);
  return gs / t.MIN * 36;
}

// z-score of each player's game score against players of the same role
// within `prodAgeRange` years of their age (widened a year at a time, then
// to the whole role, if there are too few peers).
// Returns Map id -> z, with `.ranges` Map id -> age range used (null = whole role).
export function productionScores(players, leagueIdx, year, params) {
  const rows = players.map(p => ({ p, gs: seasonGameScore(p, leagueIdx, year, params) })).filter(r => r.gs != null);
  const out = new Map();
  out.ranges = new Map();
  for (const r of rows) {
    const role = rows.filter(x => ROLE(x.p.pos) === ROLE(r.p.pos));
    let range = params.prodAgeRange ?? 1, peers;
    for (; range <= 3; range++) {
      peers = role.filter(x => Math.abs(x.p.age - r.p.age) <= range);
      if (peers.length >= 8) break;
    }
    if (range > 3) { peers = role; range = null; }
    out.ranges.set(r.p.id, range);
    const m = peers.reduce((a, x) => a + x.gs, 0) / peers.length;
    const sd = Math.sqrt(peers.reduce((a, x) => a + (x.gs - m) ** 2, 0) / peers.length) || 1;
    out.set(r.p.id, (r.gs - m) / sd);
  }
  return out;
}

// Regression age can also drop a year: after an injury (by class) or a poor
// season from a veteran near regression. Never once a player is already
// regressing: age is doing that already.
export function maybeRegressionDown(p, injuryClass, z, params, rng) {
  if (p.age < p.regressionAge - params.regDownWindow) return false;
  if (p.age >= p.regressionAge) return false;
  if (p.regressionAge <= 30) return false;          // the game won't take it below 30
  let chance = 0;
  if (injuryClass === 'structural') chance = params.regDownStructural;
  else if (injuryClass === 'nagging') chance = params.regDownNagging;
  else if (injuryClass) chance = params.regDownStandard;
  if (z != null && z <= params.regDownProdZ) chance = Math.max(chance, params.regDownProdChance);
  if (!chance || rng() * 100 >= chance) return false;
  p.regressionAge--;
  return true;
}

// Push regressionAge back a year. Only at the regression age or the year
// before it (a 33 regression age can be earned at 32 or 33); likeliest at
// the regression age itself. A player already regressing can pause it with
// a strong season (z = production against his peers). `injury` is the
// injury class ('standard' | 'nagging' | 'structural') when the player had
// a qualifying injury.
export function maybeLongevity(p, mult, params, rng, injury = null, z = null, cutMult = 1) {
  const year = p.age - p.regressionAge + 1; // 1 = at the regression age, 0 = the year before
  if (year < 0) return false;
  if (year > 1 && !(z != null && z >= 0.5)) return false;
  const pct = injury === 'structural' ? params.structuralLongevityCut : injury ? params.injuryLongevityCut : 0;
  const cut = 1 - pct * cutMult * durMult(p) / 100;
  // Durability: an Ironman's body holds off decline longer (about ×1.25), an injury-prone one less (about ×0.78).
  const chance = (year === 1 ? params.regFirstYearChance : params.regLaterChance) * mult * cut * durLongevity(p);
  if (rng() * 100 >= chance) return false;
  p.regressionAge++;
  return true;
}

// Young players: standout production can raise potential, poor production
// can lower it; plus a small random chance either way of a breakout.
export function maybePotential(p, mult, params, rng, z = null) {
  if (p.age > params.potUpMaxAge) return false;
  // Coachability: a coachable player's breakout is likelier and his slide less likely; stubborn the other way.
  const cm = coachMult(p);
  let up = params.potUpChance * mult;
  if (z != null && z >= params.prodPotUpZ) up += (z - params.prodPotUpZ + 1) * params.prodPotUpPerZ;
  up *= cm;
  const down = ((params.potDownChance || 0) + (z != null && z <= params.prodPotDownZ ? params.prodPotDownChance : 0)) * (2 - cm);
  const r = rng() * 100;
  if (p.pot < POT_MAX && r < up) { p.pot++; return true; }
  if (p.pot > POT_MIN && r >= 100 - down) { p.pot--; return true; }
  return false;
}

// A serious injury last season can cost half a star of potential.
// Risk of losing potential from last season's injuries. Lingering or
// recurring injuries (same type or area within the window) raise the risk
// and count even below the games threshold.
export function injuryClass(inj, params) {
  if (!inj) return null;
  const part = injuryPart(inj);
  if (inj.majorSeverity > 0 && params.structuralParts.includes(part)) return 'structural';
  // A break or fracture is structural wherever it is.
  if (inj.majorSeverity === 1 || inj.majorSeverity === 3) return 'structural';
  if (params.naggingParts.includes(part)) return 'nagging';
  if (MINOR_INJURY[inj.minorSeverity] === 'Sprained' && params.naggingSprainParts.includes(part)) return 'nagging';
  return 'standard';
}

export function injuryRisk(p, year, params) {
  const h = injuryHistory(p, year, params.injuryWindow);
  if (!h) return null;
  const recurring = h.sameType + h.sameArea > 0;
  const cls = injuryClass(h.worst, params);
  if (h.games < params.injuryMinGames && !recurring) return { ...h, chance: 0, cls };
  const w = h.worst;
  const sev = w.majorSeverity > 0 ? 0.7 + params.injurySevStep * Math.min(4, w.majorSeverity) : params.injuryMinorMult;
  const area = w.lowerBody ? params.injuryLowerBodyMult : 1;
  const repeat = 1 + h.sameType * params.injuryRepeatType + h.sameArea * params.injuryRepeatArea;
  const clsMult = cls === 'nagging' ? params.naggingRiskMult : cls === 'structural' ? params.structuralRiskMult : 1;
  const age = p.age >= params.injuryOldAge ? 1.25 : 1;
  // Durability: an Ironman shrugs off about half the damage, an injury-prone body takes about half again more.
  const chance = Math.min(params.injuryPotMax, h.games * params.injuryPotPerGame * sev * area * repeat * clsMult * age * durMult(p));
  return { ...h, chance, cls };
}

export const injuryPotChance = (p, year, params) => injuryRisk(p, year, params)?.chance || 0;

export function maybeInjuryPotLoss(p, year, params, rng, mult = 1) {
  const chance = injuryPotChance(p, year, params) * mult;
  if (!chance || p.pot <= POT_MIN) return false;
  if (rng() * 100 >= chance) return false;
  p.pot--;
  return true;
}

// Unlock a skill, reusing the locked (level 0) entry and its XP if present.
export function unlockSkill(p, id) {
  const s = p.skills.find(x => x.id === id);
  if (s) { s.level = Math.max(1, s.level); s.equipped = true; }
  else p.skills.push({ id, xp: 0, level: 1, equipped: true });
}

export function maybeSkills(p, points, params, profiles, rng, skillMult = 1) {
  if (p.age <= params.skillMaxAge && points >= params.skillMinPoints &&
      activeSkills(p).length < params.maxSkills && rng() * 100 < params.newSkillChance * skillMult) {
    const ranked = rankSkillsFor(p, profiles).slice(0, 5).filter(s => s.fit > 0);
    const pick = weightedPick(rng, ranked, s => s.fit);
    if (pick) unlockSkill(p, pick.id);
  }
  if (p.age <= params.levelUpMaxAge && rng() * 100 < params.levelUpChance) {
    const up = activeSkills(p).filter(s => isLeveled(s.id) && s.level < SKILL_MAX_LEVEL);
    const s = up.length ? up[Math.floor(rng() * up.length)] : null;
    if (s) s.level++;
  }
}

// Run the offseason bump. `entries` are { p, team, leagueIdx, spend, injuryYear, totalGames, rolled,
// production (Map id -> z) }.
// `spend` spends the player's held points into ratings afterwards.
// Returns Map pid -> points awarded.
export function runProgression(entries, params, profiles) {
  const rng = mulberry32(params.seed);
  const awards = new Map();
  awards.why = new Map();  // pid -> why potential dropped
  awards.gl = new Map();   // pid -> G League points added
  // Sort by id so results don't depend on roster order.
  const sorted = [...entries].sort((a, b) => a.p.id - b.p.id);
  for (const e of sorted) {
    const mpg = lastSeasonMpg(e.p, e.leagueIdx);
    const risk = e.injuryYear != null ? injuryRisk(e.p, e.injuryYear, params) : null;
    // A recovery center treats structural injuries like ordinary ones.
    if (risk && e.structStd && risk.cls === 'structural') risk.cls = 'standard';
    let pts = pointsFor(e.p, mpg, params, rng);
    if (risk?.cls === 'nagging') pts = Math.round(pts * (1 - (1 - params.naggingPointsMult) * (e.nagMult ?? 1)));
    // The coaching tree's Player Development branch (your teams only).
    if (e.devMult) pts = Math.round(pts * e.devMult);
    // A season in the G League (your teams): its points on top.
    if (e.glPts) { pts += e.glPts; awards.gl.set(e.p.id, e.glPts); }
    awards.set(e.p.id, params.bumpMode === 'train' ? trainPoints(e.p, pts, params, rng) : awardPoints(e.p, pts, params, rng));
    const mult = minutesMult(mpg, params);
    // Seriously injured players are less likely to delay regression, risk
    // losing potential and can't gain it.
    const injured = !!risk?.chance;
    const z = e.production?.get(e.p.id) ?? null;
    // Trainer: regression age up (earned, or a production-scaled roll) or
    // down (injury / poor production), never both.
    if (earnsNaturalLongevity(e.p, mpg, e, params)) e.p.regressionAge++;
    else if (gameRewardedLongevity(e.p, mpg, e, params)) { /* the game gave his year already */ }
    else if (!maybeRegressionDown(e.p, injured ? risk.cls : null, z, params, rng)) {
      const prod = z == null ? 1 : Math.max(0.2, Math.min(2, 1 + params.prodLongevityPerZ * z));
      maybeLongevity(e.p, mult * prod * (e.longMult || 1), params, rng, injured ? risk.cls : null, z, e.longCutMult ?? 1);
    }
    const pot = e.p.pot;
    if (injured) maybeInjuryPotLoss(e.p, e.injuryYear, params, rng, e.potLossMult ?? 1);
    else maybePotential(e.p, mult * (e.potMult || 1), params, rng, z);
    // Why potential dropped, for the report.
    if (e.p.pot < pot) awards.why.set(e.p.id, injured ? 'injury' : z != null && z <= params.prodPotDownZ ? 'production' : mpg && mpg.mpg < 12 ? 'minutes' : 'development');
    maybeSkills(e.p, pts, params, profiles, rng, e.skillMult ?? 1);
    if (e.spend) spendHeldPoints(e.p, params, rng);
  }
  return awards;
}
