// Offseason bump: on top of the game's normal in-season progression, young
// players earn extra upgrade points based on age and last season's minutes.
// Points go into season.ap (Finishing, Shooting, Creating, Defense) to be
// spent in-game, so user and CPU teams stay even.

import { ATTRS, ATTR_MAX, SKILL_MAX_LEVEL, CATEGORIES, lastSeasonMpg, activeSkills, isLeveled } from './savefile.js';

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
  // Optional skill gains (off by default)
  skillMaxAge: 25,
  skillMinPoints: 3,
  newSkillChance: 0,      // %
  levelUpChance: 0,       // %
  levelUpMaxAge: 25,
  maxSkills: 8,
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

// Run the offseason bump. `entries` are { p, team, leagueIdx, spend }.
// `spend` spends the player's held points into ratings afterwards.
// Returns Map pid -> points awarded.
export function runProgression(entries, params, profiles) {
  const rng = mulberry32(params.seed);
  const awards = new Map();
  // Sort by id so results don't depend on roster order.
  const sorted = [...entries].sort((a, b) => a.p.id - b.p.id);
  for (const e of sorted) {
    const pts = pointsFor(e.p, lastSeasonMpg(e.p, e.leagueIdx), params, rng);
    awards.set(e.p.id, awardPoints(e.p, pts, params, rng));
    maybeSkills(e.p, pts, params, profiles, rng);
    if (e.spend) spendHeldPoints(e.p, params, rng);
  }
  return awards;
}
