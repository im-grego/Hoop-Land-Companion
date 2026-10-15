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

// Prospect floor: the projected rookie line (net of drop and recovery).
export function floorVector(p, bands = DEFAULT_RECOVERY) {
  return SKILL_ATTRS.map(k => projectedRookie(p.attributes[k][0], p.age, bands));
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
export function ceilingVector(p) {
  return SKILL_ATTRS.map(k => Math.max(p.attributes[k][0], p.attributes[k][1]));
}

// ---------------------------------------------------------------------------
// Tiers (by potential) and comps

export const TIERS = [
  [10, 'Legend'], [9, 'Hall of Fame'], [8, 'All-Star'], [7, 'Starter'], [6, 'Role Player'], [0, 'Bench Depth'],
];
export const tierFor = pot => TIERS.find(([min]) => pot >= min)[1];

// Comparison pool: active players + free agents (current ratings), retirees
// and Hall of Famers (best of their two stored values). This year's rookies
// are left out so prospects aren't compared with each other.
export function buildCompPool(league) {
  const pool = [];
  const yr = league.season.currentYear;
  const isRookie = p => p.history?.draft?.yr === yr || p.history?.yearDeclared === yr;
  const add = (p, group, vec) => {
    if (!p?.attributes || !p.ht || isRookie(p)) return;
    const v = vec(p);
    if (v.reduce((a, b) => a + b, 0) < 40) return; // empty/placeholder records
    pool.push({ p, group, v, ht: p.ht, wt: p.wt || 0, pos: p.pos });
  };
  for (const t of league.teams) for (const p of t.roster) add(p, 'Active', x => SKILL_ATTRS.map(k => x.attributes[k][0]));
  for (const p of league.freeAgents || []) add(p, 'Free Agent', x => SKILL_ATTRS.map(k => x.attributes[k][0]));
  for (const p of league.retirees || []) add(p, 'Retired', ceilingVector);
  for (const p of league.hallOfFame || []) add(p, 'Hall of Fame', ceilingVector);
  return pool;
}

// How much size and position count against rating differences:
// 1 inch = 1.5 rating points, 10 lb = 0.8, one position step (PG..C) = 2.
const HEIGHT_WEIGHT = 1.5;
const WEIGHT_WEIGHT = 0.08;
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
export function findComps(v, body, pool, n = 3, excludeId = null) {
  return pool
    .filter(e => e.p.id !== excludeId)
    .map(e => ({ ...e, dist: compDistance(v, body, e) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n)
    .map(e => ({ name: playerName(e.p), group: e.group, ht: e.ht, wt: e.wt, pos: e.p.pos, tier: tierFor(e.p.pot), sim: Math.max(0, Math.round(100 - e.dist * 3)), id: e.p.id }));
}

export function prospectComps(p, pool, bands = DEFAULT_RECOVERY) {
  return {
    floor: findComps(floorVector(p, bands), bodyOf(p), pool, 3, p.id),
    ceiling: findComps(ceilingVector(p), bodyOf(p), pool, 3, p.id),
  };
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
export function scoutingReport(p, league) {
  const st = positionStats(league, p.pos);
  const pos = POSITIONS[p.pos] ?? '';
  const items = ATTRS.map(k => {
    const [cur, ceil] = p.attributes[k];
    const top = Math.max(cur, ceil);
    // Strength judged on what they can become; weakness on today + ceiling.
    return {
      k,
      up: (top - st[k].m) / st[k].sd,
      down: ((cur + top) / 2 - st[k].m) / st[k].sd,
      detail: top > cur ? `${k} ${cur} → ${top} ceiling` : `${k} ${cur}`,
    };
  });
  const htZ = (p.ht - st.ht.m) / st.ht.sd;
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

export function prospectValue(p, bands = DEFAULT_RECOVERY) {
  const ceil = mean(topN(ceilingVector(p), 8));
  const floor = mean(topN(floorVector(p, bands), 8));
  return ceil * 0.65 + floor * 0.35 + p.pot * 0.4 + (21 - p.age) * 0.25;
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
  return SKILL_ATTRS.map((k, i) => {
    const cur = p.attributes[k][0];
    return original ? Math.max(cur, projectedRookie(original[i], p.age, bands)) : cur;
  });
}

export function rookieComps(p, pool, original = null, bands = DEFAULT_RECOVERY) {
  return {
    floor: findComps(rookieFloorVector(p, original, bands), bodyOf(p), pool, 3, p.id),
    ceiling: findComps(ceilingVector(p), bodyOf(p), pool, 3, p.id),
  };
}

// Best available for a team: value plus a small bonus for positions the
// roster is thin at.
export function cpuPick(team, available) {
  const counts = {};
  for (const p of team.roster) counts[p.pos] = (counts[p.pos] || 0) + 1;
  let best = null, bestScore = -Infinity;
  for (const p of available) {
    const score = prospectValue(p) + (counts[p.pos] ? 0 : 0.6);
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
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
