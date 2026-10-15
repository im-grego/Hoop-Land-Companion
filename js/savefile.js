// Lossless load/save for Hoop Land season files.
//
// Season files are compact JSON written by Unity. Re-serialising with plain
// JSON.parse/JSON.stringify would rewrite float tokens such as
// 0.30000001192092898 or 0.0, so before parsing we wrap every non-integer
// number token in a marker string and restore the exact original text on save.

const FLOAT_TAG = '\u0001f:';

class RawNumber {
  constructor(raw) { this.raw = raw; }
  valueOf() { return Number(this.raw); }
  toJSON() { return FLOAT_TAG + this.raw; }
}

function isNumChar(c) {
  // 0-9 . e E + -
  return (c >= 48 && c <= 57) || c === 46 || c === 101 || c === 69 || c === 43 || c === 45;
}

// Wrap non-integer number tokens (outside strings) as "\u0001f:<raw>".
function protectFloats(text) {
  const out = [];
  let last = 0;
  let inStr = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (inStr) {
      if (c === 92) i++; // backslash: skip escaped char
      else if (c === 34) inStr = false;
      continue;
    }
    if (c === 34) { inStr = true; continue; }
    if ((c >= 48 && c <= 57) || c === 45) {
      let j = i + 1;
      let isFloat = false;
      while (j < n && isNumChar(text.charCodeAt(j))) {
        const cj = text.charCodeAt(j);
        if (cj === 46 || cj === 101 || cj === 69) isFloat = true;
        j++;
      }
      if (isFloat) {
        out.push(text.slice(last, i), '"\\u0001f:', text.slice(i, j), '"');
        last = j;
      }
      i = j - 1;
    }
  }
  out.push(text.slice(last));
  return out.join('');
}

export function parseSave(text) {
  return JSON.parse(protectFloats(text), (key, value) =>
    typeof value === 'string' && value.startsWith(FLOAT_TAG)
      ? new RawNumber(value.slice(FLOAT_TAG.length))
      : value
  );
}

const TAG_RE = new RegExp('"\\\\u0001f:([^"]*)"', 'g');

export function serializeSave(data) {
  return JSON.stringify(data).replace(TAG_RE, '$1');
}

// ---------------------------------------------------------------------------
// Domain helpers

export const ATTRS = ['LAY', 'DNK', 'INS', 'MID', 'TPT', 'FTS', 'DRB', 'PAS', 'ORE', 'DRE', 'STL', 'BLK', 'STR', 'SPD', 'STM'];

export const ATTR_NAMES = {
  LAY: 'Layup', DNK: 'Dunk', INS: 'Inside', MID: 'Mid-Range', TPT: '3-Point',
  FTS: 'Free Throw', DRB: 'Dribble', PAS: 'Passing', ORE: 'Off. Reb', DRE: 'Def. Reb',
  STL: 'Steal', BLK: 'Block', STR: 'Strength', SPD: 'Speed', STM: 'Stamina',
};

// The 12 skill ratings range 0-20; the physical ratings range 8-20.
export const PHYSICAL = ['STR', 'SPD', 'STM'];

// season.xp / season.ap are indexed by these categories. `ap` holds earned
// attribute points the CPU hasn't spent yet.
export const CATEGORIES = [
  { key: 'FIN', name: 'Finishing', attrs: ['LAY', 'DNK', 'INS'] },
  { key: 'SHO', name: 'Shooting', attrs: ['MID', 'TPT', 'FTS'] },
  { key: 'CRE', name: 'Creating', attrs: ['DRB', 'PAS', 'ORE'] },
  { key: 'DEF', name: 'Defense', attrs: ['DRE', 'STL', 'BLK'] },
  { key: 'PHY', name: 'Physical', attrs: PHYSICAL },
];
export const categoryOf = k => CATEGORIES.findIndex(c => c.attrs.includes(k));
export const ATTR_MAX = 20;
export const attrMin = k => (PHYSICAL.includes(k) ? 8 : 0);
export const SKILL_MAX_LEVEL = 3;
// Skills with no levels: they are only equipped or not (stored as level 1).
export const UNLEVELED_SKILLS = ['CLA', 'DIM', 'HIG', 'SPA'];
export const isLeveled = id => !UNLEVELED_SKILLS.includes(id);

// Verified against the in-game roster screen (PG = 0, F = 5, C = 8).
export const POSITIONS = ['PG', 'G', 'SG', 'GF', 'SF', 'F', 'PF', 'FC', 'C'];

export const MODE_NAMES = { 0: 'Franchise', 1: 'Commissioner' };

// Known season.phase values:
// 11 = champion crowned, offseason not started (ages not yet +1)
// 2  = offseason start, before the lottery (new year, ages +1, retirees gone)
// 4  = lottery done, before the draft (current-year picks get a 0-based pk)
// 5  = draft done (rookies on rosters / undrafted in free agency)
// 6  = free agency, season.currentDay 1-3 (rookie contracts signed on day 1;
//      advancing past day 3 starts the new season)
export const PHASE_SEASON_COMPLETE = 11;
export const PHASE_PRE_LOTTERY = 2;
export const PHASE_PRE_DRAFT = 4;
export const PHASE_POST_DRAFT = 5;
export const PHASE_FREE_AGENCY = 6;
export const PHASE_NAMES = {
  [PHASE_SEASON_COMPLETE]: 'Season Complete',
  [PHASE_PRE_LOTTERY]: 'Offseason · Pre-Lottery',
  [PHASE_PRE_DRAFT]: 'Offseason · Pre-Draft',
  [PHASE_POST_DRAFT]: 'Offseason · Post-Draft',
  [PHASE_FREE_AGENCY]: 'Free Agency',
};

export function phaseName(season) {
  const name = PHASE_NAMES[season.phase];
  if (!name) return `Phase ${season.phase}`;
  return season.phase === PHASE_FREE_AGENCY ? `${name} · Day ${season.currentDay}` : name;
}
// Phases where the bump is meant to run (final choice pending).
export const BUMP_PHASES = [PHASE_SEASON_COMPLETE];

export function playerName(p) { return `${p.fn} ${p.ln}`; }

export function heightStr(inches) { return `${Math.floor(inches / 12)}'${inches % 12}"`; }

export function avgRating(p) {
  let s = 0;
  for (const k of ATTRS) s += p.attributes[k][0];
  return s / ATTRS.length;
}

// Minutes per game for the player's most recent completed season in a league.
export function lastSeasonMpg(p, leagueIdx) {
  let best = null;
  for (const s of p.stats || []) {
    if (s.league !== leagueIdx) continue;
    let gp = 0, sec = 0;
    for (const row of s.season || []) { gp += row.GP; sec += row.MIN[0]; }
    if (gp > 0 && (!best || s.yr > best.yr)) best = { yr: s.yr, gp, mpg: sec / 60 / gp };
  }
  return best;
}

// Every player in a league, tagged with where they live in the file.
export function leaguePlayers(league, includeFreeAgents = true) {
  const out = [];
  for (const t of league.teams) for (const p of t.roster) out.push({ p, team: t });
  if (includeFreeAgents) for (const p of league.freeAgents || []) out.push({ p, team: null });
  return out;
}

// This year's rookies: drafted (history.draft.yr = this year) and undrafted
// prospects who declared this year. `round` is 0 for undrafted.
export function leagueRookies(league) {
  const yr = league.season.currentYear;
  const out = [];
  const check = (p, team) => {
    const h = p.history || {};
    if (h.draft?.yr === yr && h.draft.rd > 0) out.push({ p, team, round: h.draft.rd, pick: h.draft.pk });
    else if (h.yearDeclared === yr && !(h.draft?.yr)) out.push({ p, team, round: 0, pick: 0 });
  };
  for (const t of league.teams) for (const p of t.roster) check(p, t);
  for (const p of league.freeAgents || []) check(p, null);
  return out.sort((a, b) => (a.pick || 999) - (b.pick || 999));
}

export function snapshot(p) {
  return {
    attributes: JSON.parse(JSON.stringify(p.attributes)),
    skills: JSON.parse(JSON.stringify(p.skills)),
    ap: [...(p.season?.ap || [])],
  };
}

export function restore(p, snap) {
  p.attributes = JSON.parse(JSON.stringify(snap.attributes));
  p.skills = JSON.parse(JSON.stringify(snap.skills));
  if (p.season?.ap) p.season.ap = [...snap.ap];
}

export const heldPoints = p => (p.season?.ap || []).reduce((a, b) => a + b, 0);

// Skills at level 0 are locked: they sit in the list collecting XP until
// they unlock at level 1.
export const activeSkills = p => p.skills.filter(s => s.level >= 1);

export function diffPlayer(p, snap) {
  const attrs = {};
  let points = 0;
  for (const k of ATTRS) {
    const d = p.attributes[k][0] - snap.attributes[k][0];
    if (d) { attrs[k] = d; points += d; }
  }
  const before = new Map(snap.skills.map(s => [s.id, s.level]));
  const now = new Map(p.skills.map(s => [s.id, s.level]));
  const added = [], leveled = [], removed = [];
  for (const [id, lv] of now) {
    const was = before.get(id) || 0;
    if (lv >= 1 && was < 1) added.push(id);
    else if (lv >= 1 && lv !== was) leveled.push(id);
  }
  for (const [id, was] of before) if (was >= 1 && (now.get(id) || 0) < 1) removed.push(id);
  const apDelta = (p.season?.ap || []).map((v, i) => v - (snap.ap[i] || 0));
  const changed = apDelta.some(Boolean) || points !== 0 || Object.keys(attrs).length > 0 || added.length || leveled.length || removed.length;
  return { attrs, points, added, leveled, removed, apDelta, changed };
}
