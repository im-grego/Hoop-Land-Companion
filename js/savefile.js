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
// Skills by category, in the game's order: the first in each is free (no
// levels), the last two are elite (need 16/20 in a related rating).
export const SKILL_CATEGORIES = [
  { name: 'Finishing', skills: ['HIG', 'CRA', 'SOF', 'TEA', 'BUL', 'DUN'] },
  { name: 'Shooting', skills: ['SPA', 'CLU', 'SPO', 'VOL', 'LIM', 'UNF'] },
  { name: 'Creating', skills: ['DIM', 'CHE', 'CLE', 'STE', 'FOO', 'HOT'] },
  { name: 'Defense', skills: ['CLA', 'LOC', 'MAG', 'TWO', 'BAL', 'SNA'] },
];
export const SKILL_NAMES = {
  HIG: 'Highlight Reel', CRA: 'Crafty', SOF: 'Soft Touch', TEA: 'Tear Dropper', BUL: 'Bully', DUN: 'Dunk Artist',
  SPA: 'Spark Plug', CLU: 'Clutch Gene', SPO: 'Spot Up', VOL: 'Volume Shooter', LIM: 'Limitless', UNF: 'Unfazed',
  DIM: 'Dimer', CHE: 'Chef', CLE: 'Cleanup Crew', STE: 'Step Dancer', FOO: 'Foot Surgeon', HOT: 'Hot Potato',
  CLA: 'Clamps', LOC: 'Locked In', MAG: 'Magnet', TWO: 'Two Way', BAL: 'Ball Hawk', SNA: 'Snatcher',
};
export const skillName = id => SKILL_NAMES[id] || id;
export const skillCategory = id => SKILL_CATEGORIES.find(c => c.skills.includes(id))?.name || '';
export const FREE_SKILLS = SKILL_CATEGORIES.map(c => c.skills[0]);
export const ELITE_SKILLS = SKILL_CATEGORIES.flatMap(c => c.skills.slice(4));
// Elite skills need 16/20 in a related rating to be earned (the game hands
// some out below that when generating players).
export const ELITE_MIN = 16;
export const ELITE_REQUIREMENTS = {
  BUL: 'INS', DUN: 'DNK', UNF: 'MID', LIM: 'TPT', FOO: 'DRB', HOT: 'PAS', BAL: 'STL', SNA: 'BLK',
};
// null = requirement unknown; true/false = meets it.
export function meetsEliteRequirement(p, id) {
  const k = ELITE_REQUIREMENTS[id];
  return k ? p.attributes[k][0] >= ELITE_MIN : null;
}
export const isFreeSkill = id => FREE_SKILLS.includes(id);
export const isEliteSkill = id => ELITE_SKILLS.includes(id);
export const UNLEVELED_SKILLS = FREE_SKILLS;
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

// The veteran bump runs in free agency (best on day 3, the last day before
// the new season), using players' new ages.
export const BUMP_PHASES = [PHASE_FREE_AGENCY];
export const BUMP_DAY = 3;

// Regression starts once a player's age passes their regressionAge.
export const POT_MIN = 4;
export const POT_MAX = 10; // 11 exists as a secret level; never set by the app
export const regressionYear = p => p.age - p.regressionAge; // 1 = first year of decline

// Injury type: body area + code (core 1-5, upperBody 1-6, lowerBody 1-10),
// with the game's names. Severity: minorSeverity 1-11 or majorSeverity 1-4.
export const INJURY_AREAS = ['core', 'upperBody', 'lowerBody'];
export const INJURY_PARTS = {
  core: [null, 'Head', 'Abs', 'Back', 'Groin', 'Hip'],
  upperBody: [null, 'Thumb', 'Finger', 'Hand', 'Wrist', 'Elbow', 'Shoulder'],
  lowerBody: [null, 'Toe', 'Foot', 'Ankle', 'Achilles', 'Calf', 'Hamstring', 'Thigh', 'ACL', 'MCL', 'Knee'],
};
export const MINOR_INJURY = [null, 'Bruised', 'Concussed', 'Jammed', 'Pulled', 'Sore', 'Sprained', 'Stiff', 'Strained', 'Swollen', 'Tweaked', 'Repaired'];
export const MAJOR_INJURY = [null, 'Broken', 'Dislocated', 'Fractured', 'Torn'];

export function injuryPart(i) {
  const a = INJURY_AREAS.find(k => i[k]);
  return a ? INJURY_PARTS[a][i[a]] || `${a} ${i[a]}` : null;
}

// e.g. "Torn Hamstring", "Sprained Ankle"
export function injuryName(i) {
  const part = injuryPart(i) || 'Injury';
  const kind = i.majorSeverity > 0 ? MAJOR_INJURY[i.majorSeverity] : MINOR_INJURY[i.minorSeverity];
  return kind ? `${kind} ${part}` : part;
}
export const injuryType = i => {
  const a = INJURY_AREAS.find(k => i[k]);
  return a ? `${a}:${i[a]}` : null;
};

// Time-loss injuries (major or minor) over the last `window` seasons ending at
// `year`: the worst one in `year`, plus how many others were the same type or
// the same body area (lingering / recurring injuries).
export function injuryHistory(p, year, window = 3) {
  const list = (p.history?.injuries || []).filter(i => i.gamesOut > 0 && i.yr <= year && i.yr > year - window);
  const cur = list.filter(i => i.yr === year);
  if (!cur.length) return null;
  const worst = cur.reduce((a, b) => (b.majorSeverity > a.majorSeverity || (b.majorSeverity === a.majorSeverity && b.gamesOut > a.gamesOut) ? b : a));
  const type = injuryType(worst);
  const area = type?.split(':')[0];
  const others = list.filter(i => i !== worst);
  const sameType = others.filter(i => injuryType(i) === type).length;
  const sameArea = others.filter(i => injuryType(i) !== type && i[area]).length;
  const games = cur.reduce((a, i) => a + i.gamesOut, 0);
  return { worst, type, games, sameType, sameArea };
}

export const injuryArea = i => ['core', 'upperBody', 'lowerBody'].filter(k => i[k])
  .map(k => ({ core: 'core', upperBody: 'upper body', lowerBody: 'lower body' })[k]).join(', ');

export function phaseName(season) {
  const name = PHASE_NAMES[season.phase];
  if (!name) return `Phase ${season.phase}`;
  return season.phase === PHASE_FREE_AGENCY ? `${name} · Day ${season.currentDay}` : name;
}


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
    pot: p.pot,
    regressionAge: p.regressionAge,
    tendencies: p.tendencies ? { ...p.tendencies } : null,
  };
}

export function restore(p, snap) {
  p.attributes = JSON.parse(JSON.stringify(snap.attributes));
  p.skills = JSON.parse(JSON.stringify(snap.skills));
  if (p.season?.ap) p.season.ap = [...snap.ap];
  p.pot = snap.pot;
  p.regressionAge = snap.regressionAge;
  if (snap.tendencies && p.tendencies) p.tendencies = { ...snap.tendencies };
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
  const potDelta = p.pot - snap.pot;
  const regDelta = p.regressionAge - snap.regressionAge;
  const changed = potDelta !== 0 || regDelta !== 0 || apDelta.some(Boolean) || points !== 0 || Object.keys(attrs).length > 0 || added.length || leveled.length || removed.length;
  return { attrs, points, added, leveled, removed, apDelta, potDelta, regDelta, changed };
}

// Jersey number for a player joining a team: their current number if free,
// else its single-digit version (#27 → 7, #55 → 5), else the lowest number
// that's neither worn nor retired. `p` is excluded from the "worn" check.
export function jerseyNumber(team, p, want = p.num) {
  const taken = new Set([
    ...team.roster.filter(x => x !== p).map(x => x.num),
    ...(team.retiredNumbers || []).map(r => r.num),
  ]);
  if (want >= 0 && !taken.has(want)) return want;
  if (want >= 10 && !taken.has(want % 10)) return want % 10;
  for (let n = 0; n < 100; n++) if (!taken.has(n)) return n;
  return want;
}

// Seasons a player has spent with a team (stats stints), for who keeps a
// contested number.
const tenure = (p, tid) => (p.stats || []).reduce((n, s) => n + (s.season || []).filter(r => r.tid === tid).length, 0);

// Clear duplicate and retired numbers on every roster with jerseyNumber():
// the longest-tenured player keeps a contested number. Updates the
// new-season stats row too. Returns [{ p, team, from, to }].
export function jerseyClashes(league) {
  const out = [];
  for (const t of league.teams) {
    const retired = new Set((t.retiredNumbers || []).map(r => r.num));
    const order = [...t.roster].sort((a, b) => tenure(b, t.id) - tenure(a, t.id) || (b.yrs || 0) - (a.yrs || 0));
    const kept = new Set();
    for (const p of order) {
      if (!retired.has(p.num) && !kept.has(p.num)) { kept.add(p.num); continue; }
      out.push({ p, team: t });
    }
  }
  return out;
}

export function fixJerseyNumbers(league) {
  const year = league.season.currentYear;
  const changes = [];
  for (const { p, team } of jerseyClashes(league)) {
    const from = p.num;
    // Only count teammates already settled: others in the clash list move too.
    p.num = -1;
    p.num = jerseyNumber(team, p, from);
    const row = (p.stats || []).filter(s => s.yr === year).pop();
    const stint = row?.season?.[row.season.length - 1];
    const stintNum = stint?.num;
    if (stint && !stint.GP && stint.tid === team.id) stint.num = p.num;
    changes.push({ p, team, from, to: p.num, stint, stintNum });
  }
  return changes;
}

export function undoJerseyNumbers(changes) {
  for (const c of [...changes].reverse()) {
    c.p.num = c.from;
    if (c.stint) c.stint.num = c.stintNum;
  }
}

// Level: the player's rating on a 100 scale. A maxed 5-star (potential 10:
// 168 total across the 12 skill ratings) is 100, and every two rating
// points is one level, so a maxed 4.5-star (154) is 93 and a maxed 4-star
// (140) is 86. Capped at 100 (107 for the secret legend tier).
const SKILL_KEYS = ['LAY', 'DNK', 'INS', 'MID', 'TPT', 'FTS', 'DRB', 'PAS', 'ORE', 'DRE', 'STL', 'BLK'];
export function levelOf(p) {
  const total = SKILL_KEYS.reduce((a, k) => a + (p.attributes?.[k]?.[0] ?? 0), 0);
  const cap = p.pot >= 11 ? 107 : 100;
  return Math.max(1, Math.min(cap, Math.round(100 - (168 - total) / 2)));
}
