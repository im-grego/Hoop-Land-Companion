// Generated recruits: players built by the app and written into the save.
// A new player is a copy of an existing college player (so every field the
// game expects is there) with everything personal replaced. Ratings follow
// the player's position and archetype: potential sets how high his
// ceilings run, polish how much of them he has now.

import { jerseyNumber } from './savefile.js';
import POOL from './appearance-pool.js';

const SK = ['LAY', 'DNK', 'INS', 'MID', 'TPT', 'FTS', 'DRB', 'PAS', 'ORE', 'DRE', 'STL', 'BLK'];
// Skill weights by position group (relative ceilings).
const SHAPE = {
  guard: { LAY: 1.0, DNK: 0.55, INS: 0.6, MID: 1.05, TPT: 1.1, FTS: 1.05, DRB: 1.25, PAS: 1.2, ORE: 0.35, DRE: 0.55, STL: 1.0, BLK: 0.3 },
  wing: { LAY: 1.05, DNK: 0.9, INS: 0.8, MID: 1.0, TPT: 1.0, FTS: 0.95, DRB: 0.9, PAS: 0.75, ORE: 0.6, DRE: 0.8, STL: 0.95, BLK: 0.6 },
  big: { LAY: 0.95, DNK: 1.15, INS: 1.25, MID: 0.6, TPT: 0.45, FTS: 0.7, DRB: 0.45, PAS: 0.6, ORE: 1.2, DRE: 1.3, STL: 0.55, BLK: 1.25 },
};
const HT = [[73, 76], [74, 77], [75, 78], [77, 79], [78, 80], [79, 81], [80, 82], [81, 83], [82, 86]];   // by POSITIONS index
const FIRST = ['Jalen', 'Marcus', 'Darius', 'Tyrese', 'Caleb', 'Isaiah', 'Jordan', 'Malik', 'Andre', 'Cameron', 'Elijah', 'Xavier', 'Trey', 'Devin', 'Josiah', 'Micah', 'Amari', 'Jaylen', 'Kobe', 'Zion', 'Bryce', 'Kendrick', 'Dominic', 'Quentin', 'Rashad', 'Terrence', 'Corey', 'Desmond', 'Nolan', 'Luka', 'Mateo', 'Owen', 'Grant', 'Tristan', 'Keegan'];
const LAST = ['Johnson', 'Williams', 'Brown', 'Jackson', 'Harris', 'Thompson', 'Robinson', 'Walker', 'Mitchell', 'Carter', 'Bryant', 'Coleman', 'Hayes', 'Reed', 'Brooks', 'Wallace', 'Foster', 'Simmons', 'Hughes', 'Griffin', 'Barnes', 'Fisher', 'Hunter', 'Porter', 'Dawson', 'Sutton', 'Holloway', 'Pierce', 'Maddox', 'Vaughn', 'Okafor', 'Diallo', 'Novak', 'Petrov'];

const groupOf = pos => (pos <= 2 ? 'guard' : pos <= 5 ? 'wing' : 'big');
const gauss = r => { const u = Math.max(1e-9, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clone = o => JSON.parse(JSON.stringify(o));
// Potential (half stars) from the recruit's star rating, with spread.
const POT_BY_STARS = { 5: [9, 10], 4: [8, 9], 3: [6, 8], 2: [5, 6] };

function zeroStats(o) {
  for (const k of Object.keys(o)) {
    if (typeof o[k] === 'number' && !['tid', 'num'].includes(k)) o[k] = 0;
    else if (Array.isArray(o[k]) && o[k].every(x => typeof x === 'number')) o[k] = o[k].map(() => 0);
  }
  return o;
}

export function generateRecruit(L, li, rng, { stars = 3, id, template, pot: potIn }) {
  const p = clone(template);
  const pos = Math.floor(rng() * 9);
  const g = groupOf(pos);
  const [lo, hi] = POT_BY_STARS[stars];
  const drawn = clamp(Math.round(lo + rng() * (hi - lo + 0.99) - 0.49), 4, 10);
  const pot = potIn ?? drawn;
  const age = rng() < 0.75 ? 18 : 17;
  const polish = clamp(0.5 + gauss(rng) * 0.08 + (age === 18 ? 0.03 : 0) + (stars - 3) * 0.03, 0.35, 0.8);
  const [h0, h1] = HT[pos];
  const ht = Math.round(h0 + rng() * (h1 - h0) + gauss(rng) * 0.6);
  const wt = Math.round(ht * 2.75 - 18 + gauss(rng) * 9 + (g === 'big' ? 12 : 0));
  // Ceilings: the position shape (with a little individual variety) scaled
  // so they add up to the player's potential tier (14 points = half a star;
  // 168 = 5 stars).
  const total = 168 - (10 - pot) * 14;
  const w = Object.fromEntries(SK.map(k => [k, Math.max(0.2, SHAPE[g][k] * (1 + gauss(rng) * 0.18))]));
  const ws = SK.reduce((a, k) => a + w[k], 0);
  const attrs = {};
  for (const k of SK) {
    const max = clamp(Math.round((w[k] / ws) * total), 2, 20);
    const cur = clamp(Math.round(max * polish + gauss(rng) * 0.8), 1, max);
    attrs[k] = [cur, max];
  }
  const phys = { STR: g === 'big' ? 11 : 8, SPD: g === 'guard' ? 13 : g === 'wing' ? 11 : 8, STM: 11 };
  for (const k of ['STR', 'SPD', 'STM']) { const cur = clamp(Math.round(phys[k] + gauss(rng) * 2.2), 3, 18); attrs[k] = [cur, cur]; }
  const tnd = p.tendencies || {};
  const lean = { guard: { threePoint: 2, cross: 2, pass: 1, post: -3, offReb: -3, block: -3 }, wing: { twoPoint: 1, dunk: 1 }, big: { post: 2, dunk: 2, offReb: 2, defReb: 2, block: 2, threePoint: -3, cross: -3 } }[g];
  for (const k of Object.keys(tnd)) tnd[k] = clamp(Math.round((lean[k] || 0) + gauss(rng) * 1.6), -5, 5);
  Object.assign(p, {
    id, tid: 0, fn: FIRST[Math.floor(rng() * FIRST.length)], ln: LAST[Math.floor(rng() * LAST.length)], tag: '', home: '', ctry: 'US',
    loc: { x: Math.round(2500 + rng() * 6500), y: Math.round(-14500 + rng() * 9000) },
    age, ht, wt, yrs: 0, num: 0, pos, teamPos: Math.min(8, pos - (pos % 2)), posRnk: 0, linePos: -1, rating: p.rating, pri: 11, sec: 0, arc: '',
    pot, regressionAge: 32, attributes: attrs, skills: [], tendencies: tnd, awards: [], records: 0, status: 0,
  });
  Object.assign(p, randomLook(rng, template));
  if (p.traits) for (const k of Object.keys(p.traits)) p.traits[k] = 0;
  if (p.season) Object.assign(p.season, { xp: [0, 0, 0, 0, 0], ap: [0, 0, 0, 0, 0], morale: 100, onTradeBlock: 0, focus: 0, watch: false, scout: false, progress: 0, gpa: 0, relationship: 0, legacyPoints: 0, legacy: 0 });
  if (p.season?.injury) for (const k of Object.keys(p.season.injury)) p.season.injury[k] = 0;
  zeroStats(p.gameStats || {});
  for (const k of Object.keys(p.careerStats || {})) zeroStats(p.careerStats[k]);
  const h = p.history || {};
  Object.assign(h, { coll: 0, yrs: 0, id: 0, tid: 0, yearDeclared: 0, yearRetired: 0, yearInducted: 0, injuries: [], fantasyDrafts: [], expansionDrafts: [] });
  if (h.draft) Object.assign(h.draft, { pk: 0, rd: 0, tid: 0, otid: 0, yr: 0 });
  for (const k of Object.keys(h.collegeStats || {})) zeroStats(h.collegeStats[k]);
  if (p.careerGoals) for (const k of Object.keys(p.careerGoals)) for (const s of Object.keys(p.careerGoals[k])) p.careerGoals[k][s] = 0;
  p.stats = [];
  p.contract = { ...p.contract, tid: 0, pid: id, type: 0, yrs: 0, sal: 0, nil: 0, opt: 0, noTrd: 0, canExt: true, ext: { yrs: 0, sal: 0, opt: 0, noTrd: 0 } };
  p.stars = undefined;
  delete p.stars;
  return { p, stars, polish };
}

// Put a player on a school's roster: scholarship (4 years, the offer's
// money and NIL), jersey number, depth slot, this season's stats row and a
// spot in the lineup list.
export function signToSchool(L, li, team, p, { sal = 1, nil = 0, yr = L.season.currentYear } = {}) {
  p.tid = team.id;
  p.status = 0;
  p.num = jerseyNumber(team, p, Math.floor(Math.random() * 55));
  p.posRnk = team.roster.filter(x => x.teamPos === p.teamPos).length;
  p.linePos = team.roster.length;
  Object.assign(p.contract, { tid: team.id, pid: p.id, yrs: 4, sal, nil });
  const tmpl = team.roster.find(x => (x.stats || []).some(s => s.league === li && s.yr === yr));
  const row = tmpl ? clone(tmpl.stats.find(s => s.league === li && s.yr === yr)) : null;
  if (row) {
    row.sal = sal;
    row.season = row.season.slice(-1).map(r => ({ ...zeroStats(r), tid: team.id, num: p.num }));
    row.playoffs = []; row.finals = [];
    p.stats = [row];
  }
  team.roster.push(p);
  if (Array.isArray(team.startingLineup)) team.startingLineup.push({ linePos: p.linePos, pid: p.id, minutes: [0, 0, 0, 0, 0, 0] });
  return p;
}

export function nextPlayerId(L) {
  L.meta.uPID = (L.meta.uPID || 0) + 1;
  return L.meta.uPID;
}

// A random look from the active-player pool: skin, eye, brow and hair
// colors from one player (so they go together), hairstyle and facial hair
// from others, and sleeves / tattoos / socks / shoes from another player's
// pattern. A tattoo slot only takes a tattoo color that active players with
// this exact skin tone wear; with none, the slot stays bare skin.
export function randomLook(rng, template) {
  const pick = a => a[Math.floor(rng() * a.length)];
  const [skin, eye, brow, hairC, fHairC, uni] = pick(POOL.players);
  const hair = pick(POOL.players)[6], fHair = pick(POOL.players)[7];
  const appearance = { ...(template?.appearance || {}), skinC: skin, eyeC: eye, unibrow: !!uni, browC: brow, hair, hairC, fHair, fHairC };
  const palette = POOL.tattoos[skin] || [];
  const ink = palette.length ? pick(palette) : null;
  const donor = pick(POOL.players)[8];
  const accessories = donor.map(si => {
    const row = POOL.sets[si];
    const o = {};
    POOL.keys.forEach((k, i) => { const v = row[i]; o[k] = v === 0 ? skin : v === 1 ? (ink || skin) : v; });
    return o;
  });
  return { appearance, accessories };
}
