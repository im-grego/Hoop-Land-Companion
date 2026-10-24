// Custom draft classes. Each prospect is built from a real player the game generated (a current prospect or a
// college player at his position and around his tier), so every field the game expects is there in the shape it
// writes it, then reshaped: a new name and look, an age, ratings scaled to the class's polish and the target
// potential, ceilings to match, and his college stat line scaled with his ratings.
import { levelOf } from './savefile.js';
import { randomLook } from './recruits.js';
import { makeNamer, groupFor, lookFor } from './names.js';
import POOL from './appearance-pool.js';

export const STRENGTH = { weak: 'Weak', normal: 'Normal', strong: 'Strong', loaded: 'Loaded' };
export const POLISH = { raw: 'Raw', balanced: 'Balanced', ready: 'NBA-ready' };
export const AGES = { young: 'Young', mixed: 'Mixed', older: 'Experienced' };
export const LEAN = { none: 'Balanced', guards: 'Guards', wings: 'Wings', bigs: 'Bigs' };
export const DEFAULTS = { size: 75, strength: 'normal', stars: 1, polish: 'balanced', ages: 'mixed', intl: 10, lean: 'none', seed: 1 };

// Potential tiers by class strength (share of the class), from what the game's own classes look like.
const POT_W = {
  weak: { 4: 6, 5: 64, 6: 16, 7: 9, 8: 4, 9: 1 },
  normal: { 5: 58, 6: 17, 7: 11, 8: 8, 9: 5, 10: 1 },
  strong: { 5: 46, 6: 19, 7: 15, 8: 11, 9: 7, 10: 2 },
  loaded: { 5: 36, 6: 20, 7: 18, 8: 14, 9: 9, 10: 3 },
};
const AGE_W = { young: { 18: 45, 19: 35, 20: 15, 21: 5 }, mixed: { 18: 27, 19: 24, 20: 24, 21: 20, 22: 5 }, older: { 19: 10, 20: 30, 21: 35, 22: 25 } };
// Current level by tier, from the game's own classes (potential 5 averages about 52, 9 about 77).
const LEVEL_AT = { 4: 47, 5: 52, 6: 57, 7: 61, 8: 70, 9: 76, 10: 80 };
const POLISH_LV = { raw: -4, balanced: 0, ready: 4 };
const gauss = r => { const u = Math.max(1e-9, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const LEAN_W = { none: [1, 1, 1], guards: [1.8, 1, 0.7], wings: [0.8, 1.8, 0.8], bigs: [0.7, 1, 1.8] };
const group = pos => (pos <= 2 ? 0 : pos <= 5 ? 1 : 2);
const INTL = [['CA', 'Toronto'], ['AU', 'Melbourne'], ['FR', 'Paris'], ['RS', 'Belgrade'], ['DE', 'Berlin'], ['ES', 'Madrid'], ['LT', 'Kaunas'],
  ['NG', 'Lagos'], ['SN', 'Dakar'], ['BR', 'Sao Paulo'], ['GR', 'Athens'], ['TR', 'Istanbul'], ['SS', 'Juba'], ['JP', 'Tokyo'], ['IT', 'Bologna'], ['SI', 'Ljubljana']];
const COUNT_KEYS = ['PTS', 'FGM', 'FGA', 'TPM', 'TPA', 'FTM', 'FTA', 'REB', 'ORB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'DD', 'TD'];
const SKILL_KEYS = ['LAY', 'DNK', 'INS', 'MID', 'TPT', 'FTS', 'DRB', 'PAS', 'ORE', 'DRE', 'STL', 'BLK'];

export function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pickW = (r, w) => { const e = Object.entries(w); let x = r() * e.reduce((a, [, v]) => a + v, 0); for (const [k, v] of e) if ((x -= v) <= 0) return +k; return +e[e.length - 1][0]; };
const clone = o => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Donors: the game's own prospects and college players (18-23), by position group.
function donorPool(data) {
  const pro = data.seasonLeagues[0];
  const college = data.seasonLeagues.slice(1).flatMap(l => l.teams.flatMap(t => t.roster));
  const all = [...(pro.draftClass || []), ...college].filter(p => p.attributes && p.age >= 18 && p.age <= 23 && (p.stats || []).length);
  return [0, 1, 2].map(g => all.filter(p => group(p.pos) === g));
}

// Build a class. `o` = settings (DEFAULTS shape). Returns the new prospects (not yet in the save).
export function generateClass(data, o) {
  o = { ...DEFAULTS, ...o };
  const L = data.seasonLeagues[0];
  const r = mulberry((o.seed * 2654435761) ^ 0x51c1a55);
  const donors = donorPool(data);
  let nextId = 1 + Math.max(0, ...data.seasonLeagues.flatMap(l => [...l.teams.flatMap(t => t.roster), ...(l.freeAgents || []), ...(l.retirees || []), ...(l.draftClass || [])]).map(p => p.id));
  const keep = new Set((L.draftClass || []).map(p => p.id));
  const active = data.seasonLeagues.flatMap(l => [...l.teams.flatMap(t => t.roster), ...(l.freeAgents || [])]).filter(p => !keep.has(p.id));
  const namer = makeNamer(active, mulberry(o.seed ^ 0xa11ce), data.seasonLeagues.flatMap(l => l.retirees || []));
  // Tiers: the stars asked for first, then the rest by the strength curve.
  const pots = [];
  for (let i = 0; i < o.stars && pots.length < o.size; i++) pots.push(r() < 0.35 ? 10 : 9);
  while (pots.length < o.size) pots.push(pickW(r, POT_W[o.strength] || POT_W.normal));
  const out = [];
  for (const pot of pots) {
    const lw = LEAN_W[o.lean] || LEAN_W.none, gw = { 0: 1.2 * lw[0], 1: 1 * lw[1], 2: 0.9 * lw[2] };
    const g = pickW(r, gw);
    const pool = donors[g].length ? donors[g] : donors.flat();
    const near = pool.filter(p => Math.abs((p.pot || 5) - Math.min(pot, 9)) <= 1);
    const d = (near.length ? near : pool)[Math.floor(r() * (near.length || pool.length))];
    const p = clone(d);
    p.id = nextId++;
    p.tid = 0; p.status = 1; p.yrs = 0; p.num = d.num; p.linePos = -1; p.awards = []; p.records = 0;
    p.age = pickW(r, AGE_W[o.ages] || AGE_W.mixed);
    p.ht = clamp(Math.round(d.ht + (r() * 2 - 1) * 1.5), 70, 90);
    p.wt = clamp(Math.round(d.wt + (r() * 2 - 1) * 10 + (p.ht - d.ht) * 4), 160, 300);
    p.pot = pot;
    p.regressionAge = 30 + Math.floor(r() * 5);
    // Ratings: the donor's shape, scaled so his level lands where the game's own classes put his tier (older and more
    // polished a little higher), with each rating nudged; ceilings follow the target potential.
    const before = levelOf(d);
    const target = clamp(Math.round((LEVEL_AT[pot] ?? 52) + (p.age - 19.5) * 1.2 + (POLISH_LV[o.polish] ?? 0) + gauss(r) * 2.5), 35, 90);
    const want = 168 - 2 * (100 - target);
    const sum0 = SKILL_KEYS.reduce((a, k) => a + (d.attributes[k]?.[0] || 0), 0) || 1;
    for (const [k, v] of Object.entries(p.attributes)) {
      const phys = !SKILL_KEYS.includes(k);
      const cur = phys ? v[0] : clamp(Math.round(v[0] * want / sum0 + (r() * 2 - 1) * 1.2), 1, 20);
      const top = clamp(Math.max(cur, Math.round(v[1] * (1 + (pot - (d.pot || 5)) * 0.06) + (r() * 2 - 1))), 1, 20);
      p.attributes[k] = [cur, phys ? v[1] : top];
    }
    // Rounding drift: nudge the biggest ratings until the level is on target.
    for (let i = 0; i < 40 && levelOf(p) !== target; i++) {
      const up = levelOf(p) < target;
      const k = SKILL_KEYS.filter(x => up ? p.attributes[x][0] < 20 : p.attributes[x][0] > 1).sort((a, b) => p.attributes[b][0] - p.attributes[a][0])[up ? Math.floor(r() * 4) : 0];
      if (!k) break;
      p.attributes[k][0] += up ? 1 : -1;
      p.attributes[k][1] = Math.max(p.attributes[k][1], p.attributes[k][0]);
    }
    const f = levelOf(p) / Math.max(1, before);
    for (const s of p.stats || []) for (const row of [...(s.season || []), ...(s.playoffs || []), ...(s.finals || [])]) for (const k of COUNT_KEYS) if (typeof row[k] === 'number') row[k] = Math.max(0, Math.round(row[k] * f));
    if (p.traits) for (const k of Object.keys(p.traits)) p.traits[k] = 0;   // the app reads him fresh
    Object.assign(p.history || (p.history = {}), { yearDeclared: L.season.currentYear, draft: { pk: 0, rd: 0, tid: 0, otid: 0, yr: 0 }, yearRetired: 0, yearInducted: 0 });
    // Abroad or at home: a new look and name either way (a brother or twin keeps the family's).
    const abroad = r() * 100 < o.intl;
    if (abroad) {
      const [ctry, city] = INTL[Math.floor(r() * INTL.length)];
      p.ctry = ctry; p.home = `${city}, ${ctry}`;
      p.stats = (p.stats || []).filter(s => s.yr === L.season.currentYear - 1).slice(-1);   // one season over here, as most do
    } else if (d.ctry && d.ctry !== 'US') { p.ctry = 'US'; }
    const look = randomLook(r, p);
    p.appearance = { ...p.appearance, ...look.appearance };
    const tone = abroad ? lookFor(r, p.ctry, POOL.players) : null;
    if (tone) p.appearance = { ...p.appearance, ...tone };
    p.accessories = look.accessories.map(x => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v === look.appearance.skinC ? p.appearance.skinC : v])));
    namer.name(p, (abroad && groupFor(p.ctry)) || undefined, out);
    out.push(p);
  }
  return out;
}

// A scouting read of a class: tiers, levels, ages, positions, countries and its best prospects.
export const TIERS = [[10, 'Franchise'], [9, 'Star'], [8, 'Starter'], [7, 'Rotation'], [6, 'Bench'], [0, 'Long shot']];
export function classReport(cls, level = levelOf) {
  const n = cls.length || 1;
  const avg = f => cls.reduce((a, p) => a + f(p), 0) / n;
  const tier = p => TIERS.find(([min]) => (p.pot || 0) >= min)[1];
  const tiers = Object.fromEntries(TIERS.map(([, l]) => [l, 0]));
  for (const p of cls) tiers[tier(p)]++;
  const pos = [0, 0, 0];
  for (const p of cls) pos[group(p.pos)]++;
  const ages = {};
  for (const p of cls) ages[p.age] = (ages[p.age] || 0) + 1;
  const intl = cls.filter(p => p.ctry && p.ctry !== 'US').length;
  // One number for the class: the top 14 (a lottery's worth) by potential and level.
  const top = [...cls].sort((a, b) => (b.pot - a.pot) || (level(b) - level(a))).slice(0, 14);
  const grade = top.reduce((a, p) => a + p.pot * 6 + level(p) * 0.4, 0) / Math.max(1, top.length);
  return { n: cls.length, level: avg(level), pot: avg(p => p.pot || 0), tiers, pos, ages, intl, top, grade, tier };
}
