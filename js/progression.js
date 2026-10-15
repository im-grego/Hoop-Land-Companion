// Offseason bump: on top of the game's normal in-season progression, young
// players earn extra upgrade points based on age and last season's minutes.
// Points go into season.ap (Finishing, Shooting, Creating, Defense) to be
// spent in-game, so user and CPU teams stay even.

import { ATTRS, ATTR_MAX, SKILL_MAX_LEVEL, CATEGORIES, POT_MIN, POT_MAX, lastSeasonMpg, activeSkills, isLeveled, injuryHistory, injuryType } from './savefile.js';

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
  includeFreeAgents: true,
  // Commissioner saves: CPU teams hold points without spending them. On =
  // spend CPU points into ratings now (raising ceilings as needed).
  spendCpuPoints: false,
  // Longevity: chance to push regressionAge back a year (scaled by minutes).
  regFirstYearChance: 30, // % for players in their first regression year
  regLaterChance: 10,     // % for players further into regression
  // Rare potential upgrade (+1 = half a star), scaled by minutes.
  potUpChance: 4,         // %
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
  softTissueCodes: [],    // injury types ('lowerBody:3', ...) treated as soft tissue
  softTissueMult: 1.25,
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
  // Draft room
  lotteryFormat: 'auto',  // auto | 321 | classic
  lotteryDraws: 4,        // classic format only
  draftRounds: 2,
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
  return Math.round(randInt(rng, band[1], band[2]) * minutesMult(mpgInfo, params));
}

// How much a player "wants" points in a rating: room under the ceiling,
// blended with how strong they already are.
function attrWeight(p, k, params) {
  const [cur, ceil] = p.attributes[k];
  if (cur >= ATTR_MAX) return 0;
  const room = Math.max(1, ceil - cur);
  return room * ((1 - params.strengthBias) + params.strengthBias * (cur / ATTR_MAX) * 2);
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
  const mult = round === 1 ? params.rookieR1Mult : round === 2 ? params.rookieR2Mult : params.rookieUndraftedMult;
  return Math.round(randInt(rng, band[1], band[2]) * mult);
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

// Push regressionAge back a year: likeliest in the first year of decline.
export function maybeLongevity(p, mult, params, rng, injured = false) {
  const year = p.age - p.regressionAge;
  if (year < 1) return false;
  const cut = injured ? 1 - params.injuryLongevityCut / 100 : 1;
  const chance = (year === 1 ? params.regFirstYearChance : params.regLaterChance) * mult * cut;
  if (rng() * 100 >= chance) return false;
  p.regressionAge++;
  return true;
}

export function maybePotential(p, mult, params, rng) {
  if (p.age > params.potUpMaxAge || p.pot >= POT_MAX) return false;
  if (rng() * 100 >= params.potUpChance * mult) return false;
  p.pot++;
  return true;
}

// A serious injury last season can cost half a star of potential.
// Risk of losing potential from last season's injuries. Lingering or
// recurring injuries (same type or area within the window) raise the risk
// and count even below the games threshold.
export function injuryRisk(p, year, params) {
  const h = injuryHistory(p, year, params.injuryWindow);
  if (!h) return null;
  const recurring = h.sameType + h.sameArea > 0;
  if (h.games < params.injuryMinGames && !recurring) return { ...h, chance: 0 };
  const w = h.worst;
  const sev = w.majorSeverity > 0 ? 0.7 + params.injurySevStep * Math.min(4, w.majorSeverity) : params.injuryMinorMult;
  const area = w.lowerBody ? params.injuryLowerBodyMult : 1;
  const repeat = 1 + h.sameType * params.injuryRepeatType + h.sameArea * params.injuryRepeatArea;
  const soft = params.softTissueCodes.includes(injuryType(w)) ? params.softTissueMult : 1;
  const age = p.age >= params.injuryOldAge ? 1.25 : 1;
  const chance = Math.min(params.injuryPotMax, h.games * params.injuryPotPerGame * sev * area * repeat * soft * age);
  return { ...h, chance };
}

export const injuryPotChance = (p, year, params) => injuryRisk(p, year, params)?.chance || 0;

export function maybeInjuryPotLoss(p, year, params, rng) {
  const chance = injuryPotChance(p, year, params);
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

export function maybeSkills(p, points, params, profiles, rng) {
  if (p.age <= params.skillMaxAge && points >= params.skillMinPoints &&
      activeSkills(p).length < params.maxSkills && rng() * 100 < params.newSkillChance) {
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

// Run the offseason bump. `entries` are { p, team, leagueIdx, spend, injuryYear }.
// `spend` spends the player's held points into ratings afterwards.
// Returns Map pid -> points awarded.
export function runProgression(entries, params, profiles) {
  const rng = mulberry32(params.seed);
  const awards = new Map();
  // Sort by id so results don't depend on roster order.
  const sorted = [...entries].sort((a, b) => a.p.id - b.p.id);
  for (const e of sorted) {
    const mpg = lastSeasonMpg(e.p, e.leagueIdx);
    const pts = pointsFor(e.p, mpg, params, rng);
    awards.set(e.p.id, awardPoints(e.p, pts, params, rng));
    const mult = minutesMult(mpg, params);
    // Seriously injured players are less likely to delay regression, risk
    // losing potential and can't gain it.
    const injured = e.injuryYear != null && injuryPotChance(e.p, e.injuryYear, params) > 0;
    maybeLongevity(e.p, mult, params, rng, injured);
    if (injured) maybeInjuryPotLoss(e.p, e.injuryYear, params, rng);
    else maybePotential(e.p, mult, params, rng);
    maybeSkills(e.p, pts, params, profiles, rng);
    if (e.spend) spendHeldPoints(e.p, params, rng);
  }
  return awards;
}
