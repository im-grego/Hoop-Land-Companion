// Offseason progression for CPU players.
//
// Each attribute is stored as [current, ceiling]. Growth raises `current`
// toward `ceiling`; the game's own regression handles decline, so this only
// ever adds.

import { ATTRS, ATTR_MAX, SKILL_MAX_LEVEL, CATEGORIES, lastSeasonMpg, activeSkills, isLeveled } from './savefile.js';

export const DEFAULT_PARAMS = {
  seed: 2027,
  // Total upgrade points by age band: [maxAge, minPts, maxPts]
  ageBands: [
    [22, 3, 6],
    [25, 1, 4],
    [29, 0, 2],
    [99, 0, 0],
  ],
  // Minutes-per-game multipliers
  starterMpg: 28,
  benchMpg: 15,
  starterMult: 1.25,
  rotationMult: 1.0,
  benchMult: 0.75,
  maxPerAttr: 3,          // cap per attribute per offseason
  exceedCeiling: false,   // allow growth past the hidden ceiling
  strengthBias: 0.5,      // 0 = spread evenly, 1 = pour into strengths
  // Skills
  skillMaxAge: 25,
  skillMinPoints: 3,
  newSkillChance: 25,     // %
  levelUpChance: 15,      // %
  levelUpMaxAge: 29,
  maxSkills: 8,
  includeFreeAgents: true,
  spendHeldPoints: true,  // spend unspent category points (season.ap)
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

export function pointsFor(p, mpgInfo, params, rng) {
  const band = params.ageBands.find(b => p.age <= b[0]) || [0, 0, 0];
  let pts = randInt(rng, band[1], band[2]);
  const mpg = mpgInfo ? mpgInfo.mpg : 0;
  const mult = mpg >= params.starterMpg ? params.starterMult
    : mpg >= params.benchMpg ? params.rotationMult
    : params.benchMult;
  return Math.round(pts * mult);
}

function attrWeight(p, k, params) {
  const cur = p.attributes[k][0];
  const room = params.exceedCeiling ? Math.max(1, p.attributes[k][1] - cur) : p.attributes[k][1] - cur;
  return room * ((1 - params.strengthBias) + params.strengthBias * (cur / ATTR_MAX) * 2);
}

function canGrow(p, k, params) {
  const cap = params.exceedCeiling ? ATTR_MAX : Math.min(ATTR_MAX, p.attributes[k][1]);
  return p.attributes[k][0] < cap;
}

function raise(p, k) {
  p.attributes[k][0]++;
  if (p.attributes[k][1] < p.attributes[k][0]) p.attributes[k][1] = p.attributes[k][0];
}

// Spend held category points: each point is +1 to a rating in its category.
// Points with nowhere to go (category maxed) stay held. Returns points spent.
export function spendHeldPoints(p, params, rng) {
  const ap = p.season?.ap;
  if (!ap) return 0;
  let spent = 0;
  CATEGORIES.forEach((c, i) => {
    while (ap[i] > 0) {
      const k = weightedPick(rng, c.attrs.filter(k => canGrow(p, k, params)), k => attrWeight(p, k, params));
      if (!k) break;
      raise(p, k);
      ap[i]--;
      spent++;
    }
  });
  return spent;
}

// Spend `points` on attributes. Mutates p. Returns points actually spent.
export function distributePoints(p, points, params, rng) {
  const gained = {};
  let spent = 0;
  for (let i = 0; i < points; i++) {
    const open = ATTRS.filter(k => canGrow(p, k, params) && (gained[k] || 0) < params.maxPerAttr);
    const k = weightedPick(rng, open, k => attrWeight(p, k, params));
    if (!k) break;
    raise(p, k);
    gained[k] = (gained[k] || 0) + 1;
    spent++;
  }
  return spent;
}

// Unlock a skill, reusing the locked (level 0) entry and its XP if present.
export function unlockSkill(p, id) {
  const s = p.skills.find(x => x.id === id);
  if (s) { s.level = Math.max(1, s.level); s.equipped = true; }
  else p.skills.push({ id, xp: 0, level: 1, equipped: true });
}

export function maybeSkills(p, spent, params, profiles, rng) {
  if (p.age <= params.skillMaxAge && spent >= params.skillMinPoints &&
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

// Run progression over a list of players. `entries` are { p, team, league }.
export function runProgression(entries, params, profiles) {
  const rng = mulberry32(params.seed);
  // Sort by id so results don't depend on roster order.
  const sorted = [...entries].sort((a, b) => a.p.id - b.p.id);
  for (const e of sorted) {
    if (params.spendHeldPoints) spendHeldPoints(e.p, params, rng);
    const pts = pointsFor(e.p, lastSeasonMpg(e.p, e.leagueIdx), params, rng);
    const spent = pts > 0 ? distributePoints(e.p, pts, params, rng) : 0;
    maybeSkills(e.p, spent, params, profiles, rng);
  }
}
