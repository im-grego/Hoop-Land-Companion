// Draft tools: prospect comps, lottery simulation, mock drafts, pick trades.

import { ATTRS, PHYSICAL, POSITIONS, playerName, heightStr } from './savefile.js';
import { mulberry32 } from './progression.js';

// The 12 skill ratings (physical ratings aren't kept for retirees).
export const SKILL_ATTRS = ATTRS.filter(k => !PHYSICAL.includes(k));

// Drafted rookies lose 4 from each skill rating, but never drop below 2
// (a rating already at 2 or lower stays where it is).
export const DRAFT_DROP = 4;
export const DRAFT_FLOOR = 2;
export const draftDrop = v => (v <= DRAFT_FLOOR ? v : Math.max(DRAFT_FLOOR, v - DRAFT_DROP));

// Summer league recovery right after the draft: older rookies win back part
// of the drop ([maxAge, points]): 18-19 keep the full -4, 20-21 net -3,
// 22+ net -2. A rating never recovers past its pre-draft value.
export const DEFAULT_RECOVERY = [[19, 0], [21, 1], [99, 2]];
export const recoveryFor = (age, bands = DEFAULT_RECOVERY) => (bands.find(b => age <= b[0]) || [0, 0])[1];

// Where a pre-draft rating ends up after the drop and summer league.
export const projectedRookie = (v, age, bands = DEFAULT_RECOVERY) =>
  Math.min(v, draftDrop(v) + recoveryFor(age, bands));

// The projected rookie line (net of drop and recovery).
export function rookieLine(p, bands = DEFAULT_RECOVERY) {
  return SKILL_ATTRS.map(k => projectedRookie(p.attributes[k][0], p.age, bands));
}

// Prospect floor: the rookie line plus natural development (+2 a rating),
// never past their ceiling, 20, or 16 for free throws.
export const FLOOR_DEVELOPMENT = 2;
export function floorVector(p, bands = DEFAULT_RECOVERY) {
  return withDevelopment(p, rookieLine(p, bands));
}
function withDevelopment(p, line) {
  return line.map((v, i) => {
    const k = SKILL_ATTRS[i];
    const top = Math.max(p.attributes[k][0], p.attributes[k][1]);
    return Math.max(v, Math.min(v + FLOOR_DEVELOPMENT, top, k === 'FTS' ? 16 : 20));
  });
}

// Pre-draft skill ratings, to remember across saves: { id: [12 values] }.
export function originalRatings(league) {
  const out = {};
  for (const p of league.draftClass || []) out[p.id] = SKILL_ATTRS.map(k => p.attributes[k][0]);
  return out;
}

// Apply summer league to a drafted rookie given their pre-draft ratings.
// Only raises ratings. Returns { attr: gain }.
export function applySummerLeague(p, original, bands = DEFAULT_RECOVERY) {
  const gains = {};
  SKILL_ATTRS.forEach((k, i) => {
    const target = projectedRookie(original[i], p.age, bands);
    const a = p.attributes[k];
    if (a[0] < target) {
      gains[k] = target - a[0];
      a[0] = target;
      if (a[1] < a[0]) a[1] = a[0];
    }
  });
  return gains;
}
// Free throws are capped at 16 in this league; everything else at 20.
export const capFor = k => (k === 'FTS' ? 16 : 20);

export function ceilingVector(p) {
  return SKILL_ATTRS.map(k => Math.min(capFor(k), Math.max(p.attributes[k][0], p.attributes[k][1])));
}

// Generated prospects' ceilings all total ~140 (an All-Star/4-star line) no
// matter their potential. Prime players in the league top out at about
// 140 + 14 per potential step (pot 9 ~154, pot 10 ~168, pot 7 ~126), so
// project the ceiling to the player's tier: extra points go to their
// strengths (keeping the archetype), and lower tiers scale down evenly.
const MAX_PROJECTED_GAIN = 6;
export const tierCeilingTotal = pot => 140 + 14 * (Math.min(pot, 10) - 8);

// `pot` lets callers project from a scouted (fogged) potential.
export function projectedCeiling(p, pot = p.pot) {
  const v = ceilingVector(p);
  const total = v.reduce((a, b) => a + b, 0);
  const target = tierCeilingTotal(pot);
  if (total > target) {
    const f = target / total;
    return v.map(x => Math.max(DRAFT_FLOOR, Math.round(x * f)));
  }
  // Spread the extra over their better ratings (weighted toward strengths,
  // at most +6 each) so the archetype grows rather than one rating maxing.
  const out = [...v];
  for (let n = total; n < target; n++) {
    let best = -1, bestW = -1;
    out.forEach((x, i) => {
      const ok = x < capFor(SKILL_ATTRS[i]) && x - v[i] < MAX_PROJECTED_GAIN;
      const w = ok ? v[i] ** 1.5 / (1 + x - v[i]) : -1;
      if (w > bestW) { bestW = w; best = i; }
    });
    if (best < 0) break;
    out[best]++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tiers (by potential) and comps

export const TIERS = [
  [11, 'Legend'], [10, 'Hall of Fame'], [9, 'Superstar'], [8, 'All-Star'], [7, 'Starter'], [6, 'Role Player'],
  [5, 'Bench Depth'], [0, 'Project'],
];
export const tierFor = pot => TIERS.find(([min]) => pot >= min)[1];

// Fog of war: scouting reports are usually right, but `chance`% of the time
// they read a prospect one potential step high or low. Stable per prospect
// and `salt` (e.g. the save), so reloading doesn't reveal the truth.
export function scoutedPot(p, salt = 0, chance = 25) {
  const rng = mulberry32((salt ^ Math.imul(p.id, 2654435761)) >>> 0);
  if (rng() * 100 >= chance) return p.pot;
  let d = rng() < 0.5 ? -1 : 1;
  if (p.pot + d > 10 || p.pot + d < 4) d = -d;
  return p.pot + d;
}

// Comparison pool: active players + free agents (current ratings), retirees
// and Hall of Famers (best of their two stored values). This year's rookies
// are left out so prospects aren't compared with each other.
// Comps need at least this many seasons in the league (rules out rookies,
// including older ones).
export const MIN_COMP_SEASONS = 2;

export function buildCompPool(league) {
  const pool = [];
  const yr = league.season.currentYear;
  const isRookie = p => p.history?.draft?.yr === yr || p.history?.yearDeclared === yr;
  const add = (p, group, vec) => {
    if (!p?.attributes || !p.ht || isRookie(p)) return;
    const v = vec(p);
    if (v.reduce((a, b) => a + b, 0) < 40) return; // empty/placeholder records
    // Established = has played enough to show who they are.
    const established = (group !== 'Active' && group !== 'Free Agent') || (p.yrs || 0) >= MIN_COMP_SEASONS;
    pool.push({ p, group, v, ht: p.ht, wt: p.wt || 0, pos: p.pos, established });
  };
  for (const t of league.teams) for (const p of t.roster) add(p, 'Active', x => SKILL_ATTRS.map(k => x.attributes[k][0]));
  for (const p of league.freeAgents || []) add(p, 'Free Agent', x => SKILL_ATTRS.map(k => x.attributes[k][0]));
  for (const p of league.retirees || []) add(p, 'Retired', ceilingVector);
  for (const p of league.hallOfFame || []) add(p, 'Hall of Fame', ceilingVector);
  return pool;
}

// How much size and position count against rating differences:
// 1 inch = 2.5 rating points, 10 lb = 1.2, one position step (PG..C) = 2.
const HEIGHT_WEIGHT = 2.5;
const WEIGHT_WEIGHT = 0.12;
const POSITION_WEIGHT = 2;

// `body` = { ht, wt, pos } of the player being compared.
export function compDistance(v, body, entry) {
  let d = 0;
  for (let i = 0; i < v.length; i++) d += (v[i] - entry.v[i]) ** 2;
  d += (HEIGHT_WEIGHT * (body.ht - entry.ht)) ** 2;
  if (body.wt && entry.wt) d += (WEIGHT_WEIGHT * (body.wt - entry.wt)) ** 2;
  if (body.pos != null && entry.pos != null) d += (POSITION_WEIGHT * (body.pos - entry.pos)) ** 2;
  return Math.sqrt(d);
}

const bodyOf = p => ({ ht: p.ht, wt: p.wt, pos: p.pos });

// Closest pool players to a vector. Similarity is 0-100.
export function findComps(v, body, pool, n = 3, excludeId = null, establishedOnly = false) {
  return pool
    .filter(e => e.p.id !== excludeId && (!establishedOnly || e.established))
    .map(e => ({ ...e, dist: compDistance(v, body, e) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n)
    .map(e => ({ name: playerName(e.p), group: e.group, ht: e.ht, wt: e.wt, pos: e.p.pos, tier: tierFor(e.p.pot), sim: Math.max(0, Math.round(100 - e.dist * 3)), id: e.p.id }));
}

export function prospectComps(p, pool, bands = DEFAULT_RECOVERY, pot = p.pot) {
  return {
    floor: findComps(floorVector(p, bands), bodyOf(p), pool, 3, p.id),
    ceiling: findComps(projectedCeiling(p, pot), bodyOf(p), pool, 3, p.id, true),
  };
}

// One floor and one ceiling comp per player across a whole class, never
// reusing a comp. `players` should be in priority order (best first): they
// get first pick. Ceiling comps come from established players at or below the
// player's (scouted) tier, and the very top comps (potential 10+: Hall of Fame
// and Legend) only go to top-tier players, at most `legendCap` per class.
// Floor comps never come from that top group and never above tier.
// Returns Map id -> { floor: [comp], ceiling: [comp] }.
// Share of each class's comps tagged "+" (prospect projects a bit better) or
// "lite" (a bit short), picked by the biggest gaps; never on tiny gaps.
const QUALIFIER_MAX = 2;      // at most this many "+" and "lite" per class
const QUALIFIER_MIN_GAP = 4; // skill-total points
const HISTORIC_PENALTY = 6;  // distance added to retirees / Hall of Famers so current players win close calls
const SIZE_RANGE = 2;        // inches: comps stay this close in height when anyone fits

const TOP_COMP = 10; // Wilt / LeBron territory

export function assignClassComps(players, pool, { floorVec, ceilVec, potOf = p => p.pot, legendCap = 3 }) {
  const used = new Set();
  const out = new Map(players.map(p => [p.id, { floor: [], ceiling: [] }]));
  let legends = 0;
  const sum = v => v.reduce((a, b) => a + b, 0);
  const fmt = (e, vec) => ({
    name: playerName(e.p), tier: tierFor(e.p.pot), pot: e.p.pot, pos: e.p.pos, ht: e.ht, wt: e.wt, id: e.p.id,
    gap: sum(vec) - sum(e.v),
  });
  const historic = e => e.group === 'Retired' || e.group === 'Hall of Fame';
  // Stay close in size: try comps within SIZE_RANGE inches first. Top-tier
  // prospects lean toward the greats instead of current players.
  const pick = (p, vec, ok, favorHistoric = false) => {
    const best = within => {
      let b = null, bestD = Infinity;
      for (const e of pool) {
        if (used.has(e.p.id) || e.p.id === p.id || !ok(e)) continue;
        if (within && Math.abs(e.ht - p.ht) > SIZE_RANGE) continue;
        const d = compDistance(vec, bodyOf(p), e) + (historic(e) ? (favorHistoric ? -HISTORIC_PENALTY : HISTORIC_PENALTY) : 0);
        if (d < bestD) { bestD = d; b = e; }
      }
      return b;
    };
    const e = best(true) || best(false);
    if (e) used.add(e.p.id);
    return e;
  };
  for (const p of players) {
    const pot = potOf(p);
    // Within one tier of the scouted tier (falling back to anything lower).
    const okCeil = c => c.established && c.p.pot <= pot &&
      (c.p.pot < TOP_COMP || (pot >= TOP_COMP && legends < legendCap));
    const top = pot >= TOP_COMP;
    const e = pick(p, ceilVec(p), c => okCeil(c) && c.p.pot >= pot - 1, top) || pick(p, ceilVec(p), okCeil, top);
    if (e) {
      if (e.p.pot >= TOP_COMP) legends++;
      out.get(p.id).ceiling = [fmt(e, ceilVec(p))];
    }
  }
  for (const p of players) {
    const pot = potOf(p);
    // A floor sits at least one tier under the ceiling comp; like ceilings it
    // needs MIN_COMP_SEASONS in the league.
    const ceil = out.get(p.id).ceiling[0];
    const cap = Math.min(pot, ceil ? ceil.pot - 1 : pot) ;
    const e = pick(p, floorVec(p), c => c.p.pot < TOP_COMP && c.p.pot <= cap && c.established);
    if (e) out.get(p.id).floor = [fmt(e, floorVec(p))];
  }
  // A couple of "+" / "lite" per class, on the comps furthest from their
  // list's typical gap (floors usually sit under their comp, ceilings over).
  const all = [];
  for (const kind of ['floor', 'ceiling']) {
    const comps = [...out.values()].map(c => c[kind][0]).filter(Boolean);
    if (!comps.length) continue;
    const sorted = comps.map(c => c.gap).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    comps.forEach(c => all.push({ c, rel: c.gap - median }));
  }
  all.sort((a, b) => b.rel - a.rel);
  all.filter(x => x.rel >= QUALIFIER_MIN_GAP).slice(0, QUALIFIER_MAX).forEach(x => { x.c.name += '+'; });
  all.reverse().filter(x => x.rel <= -QUALIFIER_MIN_GAP).slice(0, QUALIFIER_MAX).forEach(x => { x.c.name += ' lite'; });
  return out;
}

// ---------------------------------------------------------------------------
// Scouting report: two strengths and a weakness, judged against active
// players at similar positions (a center isn't dinged for his three-ball).

const SCOUT = {
  LAY: ['Smooth finisher around the rim', 'Struggles to finish at the rim'],
  DNK: ['Explosive above-the-rim finisher', 'Rarely finishes above the rim'],
  INS: ['Polished post scorer', 'Little to no post game'],
  MID: ['Reliable mid-range shooter', 'Inconsistent from mid-range'],
  TPT: ['Floor-spacing three-point shooter', 'Shaky three-point shot'],
  FTS: ['Automatic at the free-throw line', 'Poor free-throw shooter'],
  DRB: ['Tight handle, creates off the dribble', 'Loose handle under pressure'],
  PAS: ['Gifted passer with great vision', 'Limited playmaker'],
  ORE: ['Relentless on the offensive glass', "Doesn't crash the offensive glass"],
  DRE: ['Strong defensive rebounder', 'Soft on the defensive glass'],
  STL: ['Active hands, jumps passing lanes', 'Rarely forces turnovers'],
  BLK: ['Rim protector who erases shots', 'Not a shot blocker'],
  STR: ['Strong, physical frame', 'Slight frame, gets pushed around'],
  SPD: ['Quick, explosive athlete', 'Lacks foot speed'],
  STM: ['High motor, can handle heavy minutes', 'Limited stamina'],
};

// How much each area moves the needle, by role; free throws and stamina
// rarely define a prospect.
const IMPACT = {
  guard: { LAY: 1.0, DNK: 0.8, INS: 0.5, MID: 1.0, TPT: 1.4, FTS: 0.4, DRB: 1.3, PAS: 1.3,
    ORE: 0.5, DRE: 0.6, STL: 1.1, BLK: 0.5, STR: 0.7, SPD: 1.2, STM: 0.4, HT: 1.0 },
  wing: { LAY: 1.1, DNK: 1.0, INS: 0.8, MID: 1.0, TPT: 1.3, FTS: 0.4, DRB: 1.1, PAS: 1.0,
    ORE: 0.7, DRE: 0.9, STL: 1.1, BLK: 0.9, STR: 0.9, SPD: 1.1, STM: 0.4, HT: 1.0 },
  big: { LAY: 1.0, DNK: 1.1, INS: 1.2, MID: 0.8, TPT: 0.6, FTS: 0.4, DRB: 0.6, PAS: 0.9,
    ORE: 1.0, DRE: 1.2, STL: 0.8, BLK: 1.3, STR: 1.1, SPD: 0.9, STM: 0.4, HT: 1.2 },
};
// Weaknesses that matter less for a role than the role's average impact
// suggests (a center who can't shoot threes, a guard with no post game).
const DOWN_IMPACT = {
  guard: { INS: 0.3, BLK: 0.3, ORE: 0.3, DRE: 0.5, STR: 0.6 },
  wing: { INS: 0.6, ORE: 0.5 },
  big: { TPT: 0.35, DRB: 0.4, MID: 0.6, SPD: 0.7 },
};
// Strengths worth more than usual for a role (the stretch big).
const UP_IMPACT = { big: { TPT: 1.1 } };
export const roleOf = pos => (pos <= 2 ? 'guard' : pos <= 5 ? 'wing' : 'big');
const AWFUL_FT = 6; // free throws only count as a weakness at or below this

const statsCache = new WeakMap();
function positionStats(league, pos) {
  let byPos = statsCache.get(league);
  if (!byPos) statsCache.set(league, byPos = new Map());
  if (byPos.has(pos)) return byPos.get(pos);
  const peers = league.teams.flatMap(t => t.roster).filter(p => Math.abs(p.pos - pos) <= 1);
  const stat = vals => {
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) || 1;
    return { m, sd };
  };
  const out = { n: peers.length, ht: stat(peers.map(p => p.ht)) };
  for (const k of ATTRS) out[k] = stat(peers.map(p => p.attributes[k][0]));
  byPos.set(pos, out);
  return out;
}

// `rookieLine` = the projected rookie ratings (skill attrs) if known.
export function scoutingReport(p, league, pot = p.pot) {
  const st = positionStats(league, p.pos);
  const pos = POSITIONS[p.pos] ?? '';
  const proj = projectedCeiling(p, pot);
  const role = roleOf(p.pos);
  const UP = { ...IMPACT[role], ...UP_IMPACT[role] };
  const DOWN = { ...IMPACT[role], ...DOWN_IMPACT[role] };
  const items = ATTRS.map(k => {
    const cur = Math.min(capFor(k), p.attributes[k][0]);
    const i = SKILL_ATTRS.indexOf(k);
    const top = i >= 0 ? Math.max(cur, proj[i]) : Math.max(cur, p.attributes[k][1]);
    // Strength judged on what they can become; weakness on today + ceiling.
    let down = ((cur + top) / 2 - st[k].m) / st[k].sd * DOWN[k];
    if (k === 'FTS' && cur > AWFUL_FT) down = Infinity;
    return {
      k,
      up: (top - st[k].m) / st[k].sd * UP[k],
      down,
      detail: top > cur ? `${k} ${cur} → ${top} ceiling` : `${k} ${cur}`,
    };
  });
  const htZ = (p.ht - st.ht.m) / st.ht.sd * UP.HT;
  const size = { k: 'HT', up: htZ, down: htZ, detail: `${heightStr(p.ht)} vs ${heightStr(Math.round(st.ht.m))} avg ${pos}` };
  const strengths = [...items, size].sort((a, b) => b.up - a.up).slice(0, 2)
    .map(x => ({ text: x.k === 'HT' ? `Great size for a ${pos}` : SCOUT[x.k][0], detail: x.detail }));
  const used = new Set(strengths.map(s => s.text));
  const weak = [...items, size].sort((a, b) => a.down - b.down)
    .map(x => ({ text: x.k === 'HT' ? `Undersized for a ${pos}` : SCOUT[x.k][1], detail: x.detail }))
    .find(x => !used.has(x.text));
  return { strengths, weakness: weak };
}

// ---------------------------------------------------------------------------
// Prospect value (used for CPU picks and board order)

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const topN = (a, n) => [...a].sort((x, y) => y - x).slice(0, n);

export function prospectValue(p, bands = DEFAULT_RECOVERY, pot = p.pot) {
  const ceil = mean(topN(ceilingVector(p), 8));
  const floor = mean(topN(floorVector(p, bands), 8));
  return ceil * 0.65 + floor * 0.35 + pot * 0.4 + (21 - p.age) * 0.25;
}

// ---------------------------------------------------------------------------
// Standings, lottery, draft order

export function teamRecord(team, year) {
  const rows = (team.season || []).filter(s => s.seasonStats?.GP > 0);
  const row = year != null ? rows.find(s => s.yr === year) : rows[rows.length - 1];
  if (!row) return { W: 0, L: 0, pct: 0, yr: null };
  const { W, L } = row.seasonStats;
  return { W, L, pct: W + L ? W / (W + L) : 0, yr: row.yr };
}

// Teams worst to best by last completed season. Ties broken by team id.
export function standings(league) {
  return league.teams
    .map(t => ({ team: t, ...teamRecord(t) }))
    .sort((a, b) => a.pct - b.pct || a.team.id - b.team.id);
}

// Lottery formats:
//  classic: top `draws` picks drawn, the rest by record.
//  321 (NBA 2027+): all lottery picks drawn; the 3 worst teams pick no lower
//  than #12.
export const LOTTERY_321 = { floorTeams: 3, floorPick: 12 };

// Detect the 3-2-1 format from the odds: 16 teams and the worst seeds having
// lower odds than seed 4.
export function detectLotteryFormat(league) {
  const s = league.season;
  const o = s.lotteryOdds || [];
  return s.lotteryTeams === 16 && o.length >= 4 && o[0] < o[3] ? '321' : 'classic';
}

// Draw picks from the lottery teams using the league's odds (index 0 = worst
// record). `drawn` picks are drawn; the rest follow by record. `floor`
// guarantees the worst `floorTeams` seeds a pick no lower than `floorPick`.
export function drawLottery(lotteryTeams, odds, drawn, rng, floor = null) {
  const pool = lotteryTeams.map((t, i) => ({ t, w: odds[i] ?? 0, seed: i }));
  const order = [];
  for (let n = 0; n < Math.min(drawn, lotteryTeams.length); n++) {
    let candidates = pool;
    if (floor) {
      const protectedLeft = pool.filter(x => x.seed < floor.floorTeams);
      if (protectedLeft.length && floor.floorPick - n <= protectedLeft.length) candidates = protectedLeft;
    }
    const total = candidates.reduce((a, x) => a + x.w, 0);
    let r = rng() * total;
    let pick = candidates.find(x => (r -= x.w) <= 0) || candidates[candidates.length - 1];
    order.push(pool.splice(pool.indexOf(pick), 1)[0]);
  }
  pool.sort((a, b) => a.seed - b.seed);
  return [...order, ...pool].map(x => ({ team: x.t, seed: x.seed }));
}

// `format` is 'auto', 'classic' or '321'; `classicDraws` is used for classic.
export function lotterySetup(league, format = 'auto', classicDraws = 4) {
  const s = league.season;
  const table = standings(league);
  const n = Math.min(s.lotteryTeams || 14, table.length);
  const fmt = format === 'auto' ? detectLotteryFormat(league) : format;
  return {
    table,
    lotteryTeams: table.slice(0, n).map(r => r.team),
    odds: s.lotteryOdds || [],
    format: fmt,
    draws: fmt === '321' ? n : Math.min(classicDraws, n),
    floor: fmt === '321' ? LOTTERY_321 : null,
  };
}

export function runLottery(league, format, classicDraws, rng) {
  const { lotteryTeams, odds, draws, floor } = lotterySetup(league, format, classicDraws);
  return drawLottery(lotteryTeams, odds, draws, rng, floor);
}

// Monte Carlo odds: chance of each pick for each lottery team.
export function lotteryOdds(league, format = 'auto', classicDraws = 4, sims = 10000, seed = 1) {
  const { lotteryTeams, odds, draws, floor } = lotterySetup(league, format, classicDraws);
  const rng = mulberry32(seed);
  const counts = lotteryTeams.map(() => new Array(lotteryTeams.length).fill(0));
  for (let s = 0; s < sims; s++) {
    drawLottery(lotteryTeams, odds, draws, rng, floor).forEach((r, pick) => { counts[r.seed][pick]++; });
  }
  return lotteryTeams.map((t, i) => ({ team: t, seed: i, weight: odds[i] ?? 0, pct: counts[i].map(c => c / sims * 100) }));
}

// Who owns a team's pick in a given year/round (traded picks move teams).
export function pickOwner(league, year, round, originalTid) {
  for (const t of league.teams) {
    if (t.draftPicks.some(pk => pk.yr === year && pk.rd === round && pk.otid === originalTid)) return t;
  }
  return null;
}

// Full draft order. Round 1 lottery order comes from `lottery` (array of
// teams); everything else goes worst to best record.
export function draftOrder(league, lottery, rounds = 2) {
  const year = league.season.currentYear;
  const actual = actualDraftOrder(league);
  if (actual) return actual;
  const table = standings(league).map(r => r.team);
  const r1 = lottery ? [...lottery, ...table.filter(t => !lottery.includes(t))] : table;
  const order = [];
  for (let rd = 1; rd <= rounds; rd++) {
    (rd === 1 ? r1 : table).forEach(orig => {
      const owner = pickOwner(league, year, rd, orig.id);
      if (owner) order.push({ rd, orig, owner, overall: order.length + 1 });
    });
  }
  return order;
}

// After the lottery the game numbers this year's picks (pk, 0-based within
// each round). Returns the real order, or null before the lottery.
export function lotteryDone(league) {
  const yr = league.season.currentYear;
  return league.teams.some(t => t.draftPicks.some(pk => pk.yr === yr && pk.rd === 1 && pk.pk > 0));
}

export function actualDraftOrder(league) {
  if (!lotteryDone(league)) return null;
  const yr = league.season.currentYear;
  const byId = new Map(league.teams.map(t => [t.id, t]));
  const picks = [];
  for (const t of league.teams) for (const pk of t.draftPicks) if (pk.yr === yr) picks.push({ pk, owner: t });
  picks.sort((a, b) => a.pk.rd - b.pk.rd || a.pk.pk - b.pk.pk);
  return picks.map((x, i) => ({ rd: x.pk.rd, orig: byId.get(x.pk.otid) || x.owner, owner: x.owner, overall: i + 1 }));
}

// Comps for a player already drafted (ratings already include the drop).
// With pre-draft ratings and summer league still to come, the floor is the
// projected post-summer-league line.
export function rookieFloorVector(p, original = null, bands = DEFAULT_RECOVERY) {
  return withDevelopment(p, SKILL_ATTRS.map((k, i) => {
    const cur = p.attributes[k][0];
    return original ? Math.max(cur, projectedRookie(original[i], p.age, bands)) : cur;
  }));
}

export function rookieComps(p, pool, original = null, bands = DEFAULT_RECOVERY, pot = p.pot) {
  return {
    floor: findComps(rookieFloorVector(p, original, bands), bodyOf(p), pool, 3, p.id),
    ceiling: findComps(projectedCeiling(p, pot), bodyOf(p), pool, 3, p.id, true),
  };
}

// Best available for a team: value plus a small bonus for positions the
// roster is thin at.
// `valueOf` lets the mock draft use scouted values.
// `valueOf(p)` is the prospect's value on the board; teams add need, a
// stronger lean toward younger players, and some draft-day noise (rng).
export function cpuPick(team, available, valueOf = p => prospectValue(p), rng = null, opts = {}) {
  const { ageWeight = 0.35, needWeight = 0.35, noise = 0.9 } = opts;
  const groups = { guard: 0, wing: 0, big: 0 };
  for (const p of team.roster) groups[roleOf(p.pos)]++;
  const gauss = () => {
    if (!rng) return 0;
    const u = Math.max(1e-9, rng()), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  let best = null, bestScore = -Infinity;
  for (const p of available) {
    const need = Math.max(0, 5 - groups[roleOf(p.pos)]) * needWeight;
    const score = valueOf(p) + (20 - p.age) * ageWeight + need + gauss() * noise;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// College stats and team fit

// Last college season, per game: { yr, team, gp, mpg, pts, reb, ast, stl, blk, fg, tp, ft, tpa }.
export function collegeLine(p, leagues) {
  let best = null;
  (p.stats || []).forEach(s => {
    const L = leagues[s.league];
    if (!L || L.leagueType === 0 || s.league === 0) return;
    const r = (s.season || []).reduce((a, x) => {
      for (const k of ['GP', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'FGM', 'FGA', 'TPM', 'TPA', 'FTM', 'FTA']) a[k] = (a[k] || 0) + x[k];
      a.MIN = (a.MIN || 0) + x.MIN[0];
      a.tid = x.tid;
      return a;
    }, {});
    if (r.GP > 0 && (!best || s.yr > best.yr)) {
      const team = L.teams.find(t => t.id === r.tid);
      const pg = k => r[k] / r.GP;
      const pct = (m, a) => (r[a] ? r[m] / r[a] * 100 : null);
      best = {
        yr: s.yr, team: team ? `${team.city} ${team.name}` : L.shortName, gp: r.GP, mpg: r.MIN / 60 / r.GP,
        pts: pg('PTS'), reb: pg('REB'), ast: pg('AST'), stl: pg('STL'), blk: pg('BLK'),
        fg: pct('FGM', 'FGA'), tp: pct('TPM', 'TPA'), ft: pct('FTM', 'FTA'), tpa: pg('TPA'),
      };
    }
  });
  return best;
}

// Where a skill line would rank on a roster: overall and within the role.
// Ratings are compared on each player's best 8 skills (how specialists rate).
export function rosterSlot(roster, line, pos) {
  const top8 = v => [...v].sort((a, b) => b - a).slice(0, 8).reduce((a, b) => a + b, 0) / 8;
  const mine = top8(line);
  const vals = roster.map(p => ({ v: top8(SKILL_ATTRS.map(k => p.attributes[k][0])), role: roleOf(p.pos) }));
  const role = roleOf(pos);
  const peers = vals.filter(x => x.role === role);
  return {
    rank: vals.filter(x => x.v > mine).length + 1, of: vals.length + 1,
    roleRank: peers.filter(x => x.v > mine).length + 1, roleOf: peers.length + 1, role,
  };
}

// ---------------------------------------------------------------------------
// Pick trades (written to the save)

const pickKey = pk => `${pk.yr}:${pk.rd}:${pk.otid}`;
export const samePick = (a, b) => pickKey(a) === pickKey(b);

// Move picks between two teams. `fromA` / `fromB` are pick objects currently
// owned by A / B.
export function tradePicks(teamA, teamB, fromA, fromB) {
  const move = (src, dst, picks) => {
    for (const pk of picks) {
      const i = src.draftPicks.findIndex(x => samePick(x, pk));
      if (i < 0) throw new Error('Pick not owned by team');
      const [obj] = src.draftPicks.splice(i, 1);
      obj.tid = dst.id;
      dst.draftPicks.push(obj);
    }
  };
  move(teamA, teamB, fromA);
  move(teamB, teamA, fromB);
}

// Rough pick value for trade evaluation (higher = more valuable).
export function pickValue(league, pk) {
  const year = league.season.currentYear;
  const table = standings(league).map(r => r.team.id);
  const rank = Math.max(0, table.indexOf(pk.otid));
  const base = pk.rd === 1 ? 100 - rank * 2.2 : 30 - rank * 0.6;
  return Math.max(5, base * Math.pow(0.85, Math.max(0, pk.yr - year)));
}

// ---------------------------------------------------------------------------
// Draft board value and team needs
//
// Value: expected potential first (the projected ceiling at the scouted
// tier), then the floor (rookie line + development), with a bonus for
// prospects strong in both. Rebuilding teams lean young; win-now teams
// weigh the floor more and mind age less. Each team has two needs (a
// position group and a skill, e.g. "Guards · Playmaking") from its roster
// against the league average.

export const POS_GROUPS = ['guards', 'wings', 'bigs'];
export const GROUP_NAMES = { guards: 'Guards', wings: 'Wings', bigs: 'Bigs' };
// POSITIONS: PG G SG | GF SF F | PF FC C
export const groupOf = pos => (pos <= 2 ? 'guards' : pos <= 5 ? 'wings' : 'bigs');

export const NEED_SKILLS = {
  playmaking: { label: 'Playmaking', attrs: ['PAS', 'DRB'] },
  shooting: { label: 'Shooting', attrs: ['TPT', 'MID'] },
  finishing: { label: 'Finishing', attrs: ['LAY', 'DNK'] },
  post: { label: 'Post scoring', attrs: ['INS'] },
  rebounding: { label: 'Rebounding', attrs: ['DRE', 'ORE'] },
  perimeterD: { label: 'Perimeter D', attrs: ['STL'] },
  rimProtection: { label: 'Rim protection', attrs: ['BLK'] },
};
// The skills that matter for each group.
export const GROUP_SKILLS = {
  guards: ['playmaking', 'shooting', 'perimeterD', 'finishing'],
  wings: ['shooting', 'perimeterD', 'finishing', 'playmaking', 'rebounding'],
  bigs: ['rebounding', 'rimProtection', 'finishing', 'post'],
};

const skillOf = (vecOrPlayer, attrs) => mean(attrs.map(k => (Array.isArray(vecOrPlayer)
  ? vecOrPlayer[SKILL_ATTRS.indexOf(k)] : vecOrPlayer.attributes[k][0])));
// A team's top two signed players in a group (the ones who play). A thin
// group borrows from the neighboring one (a team short on bigs plays its
// wings there).
const NEIGHBORS = { guards: ['wings'], wings: ['guards', 'bigs'], bigs: ['wings'] };
const strength = p => mean(topN(SKILL_ATTRS.map(k => p.attributes[k][0]), 8));
function groupTop(team, group) {
  const signed = team.roster.filter(p => p.status !== 4);
  const own = signed.filter(p => groupOf(p.pos) === group).sort((a, b) => strength(b) - strength(a)).slice(0, 2);
  if (own.length >= 2) return own;
  const fill = signed.filter(p => NEIGHBORS[group].includes(groupOf(p.pos)) && !own.includes(p))
    .sort((a, b) => strength(b) - strength(a)).slice(0, 2 - own.length);
  return [...own, ...fill];
}

// League average of each group's top two, per skill: { group: { skill: avg } }.
export function needBaseline(league) {
  const out = {};
  for (const g of POS_GROUPS) {
    out[g] = {};
    for (const s of GROUP_SKILLS[g]) {
      const vals = league.teams.flatMap(t => groupTop(t, g).map(p => skillOf(p, NEED_SKILLS[s].attrs)));
      out[g][s] = vals.length ? mean(vals) : 10;
    }
  }
  return out;
}

// A team's two biggest needs: [{ group, skill, label, gap }].
export function teamNeeds(league, team, baseline = needBaseline(league)) {
  const gaps = [];
  for (const g of POS_GROUPS) {
    const top = groupTop(team, g);
    for (const s of GROUP_SKILLS[g]) {
      const have = top.length ? mean(top.map(p => skillOf(p, NEED_SKILLS[s].attrs))) : 0;
      // Missing bodies at a group count as a gap too.
      const gap = baseline[g][s] - have;
      gaps.push({ group: g, skill: s, gap, label: `${GROUP_NAMES[g]} · ${NEED_SKILLS[s].label}` });
    }
  }
  gaps.sort((a, b) => b.gap - a.gap);
  // Two needs, from different groups when the gap is close.
  const first = gaps[0];
  const second = gaps.find(x => x !== first && (x.group !== first.group || x.gap > first.gap - 1)) || gaps[1];
  return [first, second].filter(Boolean);
}

// Which of a team's needs a prospect fills (same group, projected at or
// above the league average there).
export function needsFilled(p, needs, baseline, vec) {
  return needs.filter(n => groupOf(p.pos) === n.group && skillOf(vec, NEED_SKILLS[n.skill].attrs) >= baseline[n.group][n.skill]);
}

// Where a team is: 'contending', 'developing' or 'rebuilding', from last
// season's finish (record and playoff run) and the talent on the roster now
// (its best three players against the league).
export const STATUS_NAMES = { contending: 'Contending', developing: 'Developing', rebuilding: 'Rebuilding' };
export function teamStatus(league, team) {
  const r = teamRecord(team);
  const row = (team.season || []).find(x => x.yr === r.yr);
  const round = row?.round || 0;                               // deepest playoff round (4 = Finals)
  const top3 = t => mean(t.roster.filter(p => p.status !== 4).map(strength).sort((a, b) => b - a).slice(0, 3));
  const all = league.teams.map(top3);
  const m = mean(all), sd = Math.sqrt(mean(all.map(x => (x - m) ** 2))) || 1;
  const talent = (top3(team) - m) / sd;                        // z vs the league
  const score = (r.W + r.L ? r.pct : 0.5) + 0.04 * round + 0.06 * talent;
  return score >= 0.7 ? 'contending' : score <= 0.42 ? 'rebuilding' : 'developing';
}
export const isWinNow = (team, league = null) => (league ? teamStatus(league, team) === 'contending' : teamRecord(team).pct >= 0.6);

// Spread of ceilings and floors across the class, so the two weigh evenly.
export function classScales(players, ceilOf, floorOf) {
  const sd = a => { const m = mean(a); return { m, s: Math.sqrt(mean(a.map(x => (x - m) ** 2))) || 1 }; };
  const c = sd(players.map(p => mean(topN(ceilOf(p), 8))));
  const f = sd(players.map(p => mean(topN(floorOf(p), 8))));
  return { cm: c.m, cs: c.s, fm: f.m, fs: f.s };
}

// Draft value in class standard deviations. `team` = { winNow, needs,
// baseline } for a team's pick, or null for the consensus board.
export function draftScore(p, scales, { ceilOf, floorOf, potOf = null }, team = null) {
  const ceil = ceilOf(p), floor = floorOf(p);
  const zc = (mean(topN(ceil, 8)) - scales.cm) / scales.cs;
  const zf = (mean(topN(floor, 8)) - scales.fm) / scales.fs;
  // Ceiling leads and youth matters; contenders flip toward the floor and
  // barely mind age. (Three years younger outweighs a matching ceiling and
  // floor for everyone else.)
  const W = {
    contending: { c: 1.0, f: 1.2, age: 0.05 },
    developing: { c: 1.8, f: 0.4, age: 0.5 },
    rebuilding: { c: 2.0, f: 0.3, age: 0.6 },
    consensus: { c: 1.9, f: 0.35, age: 0.55 },
  }[team?.status || (team?.winNow ? 'contending' : team ? 'developing' : 'consensus')];
  const wc = W.c, wf = W.f;
  const both = Math.max(0, Math.min(zc, zf)) * 0.4;          // high floor + high ceiling
  const age = (20 - p.age) * W.age;
  // Expected potential (the scouted tier) leads everything.
  const tier = potOf ? (potOf(p) - 8) * W.c * 0.65 : 0;
  let need = 0;
  if (team?.needs) {
    const vec = ceil.map((c, i) => (c + floor[i]) / 2);
    need = needsFilled(p, team.needs, team.baseline, vec).length * 0.35;
  }
  return wc * zc + wf * zf + both + age + need + tier;
}
