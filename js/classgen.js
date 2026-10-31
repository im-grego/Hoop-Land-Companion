// Custom draft classes. Each prospect is built from a real player the game generated (a current prospect or a
// college player at his position and around his tier), so every field the game expects is there in the shape it
// writes it, then reshaped: a new name and look, an age, ratings bent toward an archetype and scaled to the class's
// polish and the target potential, ceilings to match, and his college stat line scaled with his ratings.
// One builder (makeOne) makes every prospect: the generated class, a reroll, an edit, a headliner you design, and
// the storylines (twins, a legend's son, the mystery teenager from abroad, the fifth-year senior, the hometown kid).
import { levelOf } from './savefile.js';
import { randomLook } from './recruits.js';
import { makeNamer, groupFor, lookFor } from './names.js';
import POOL from './appearance-pool.js';

export const STRENGTH = { weak: 'Weak', normal: 'Normal', strong: 'Strong', loaded: 'Loaded' };
export const POLISH = { raw: 'Raw', balanced: 'Balanced', ready: 'NBA-ready' };
export const AGES = { young: 'Young', mixed: 'Mixed', older: 'Experienced' };
export const LEAN = { none: 'Balanced', guards: 'Guards', wings: 'Wings', bigs: 'Bigs' };
export const FLAVOR = { mixed: 'Mixed', shooters: 'Shooters', playmakers: 'Playmakers', athletes: 'Athletes', bigs: 'Old-school bigs', defenders: 'Defenders' };
export const DEPTH = { top: 'Top-heavy', normal: 'Normal', deep: 'Deep' };
export const BOOM = { none: 'None', some: 'A few', lots: 'Lots' };
export const DEFAULTS = { size: 75, strength: 'normal', stars: 1, polish: 'balanced', ages: 'mixed', intl: 10, lean: 'none', flavor: 'mixed', depth: 'normal', boom: 'some', stories: 3, seed: 1 };

// Potential tiers by class strength (share of the class): most of a class is 3.5-4 stars (7-8), 3 stars (6) is less
// common and 2.5 (5) rare; the top end grows with the class. Guaranteed stars come on top of this.
const POT_W = {
  weak: { 5: 12, 6: 26, 7: 38, 8: 20, 9: 4 },
  normal: { 5: 6, 6: 16, 7: 38, 8: 30, 9: 8, 10: 2 },
  strong: { 5: 4, 6: 12, 7: 34, 8: 34, 9: 13, 10: 3 },
  loaded: { 5: 2, 6: 8, 7: 30, 8: 38, 9: 17, 10: 5 },
};
// Older prospects: closer to what they'll be. Potential tops out lower (22+ at 8, 21 at 9) and they come in nearer
// their ceiling, the reason a senior can be pro-ready without being a star in the making.
export const AGE_POT_CAP = age => (age >= 22 ? 8 : age >= 21 ? 9 : 10);
const AGE_W = { young: { 18: 45, 19: 35, 20: 15, 21: 5 }, mixed: { 18: 27, 19: 24, 20: 24, 21: 20, 22: 5 }, older: { 19: 10, 20: 30, 21: 35, 22: 25 } };
// Current level by tier, from the game's own classes (potential 5 averages about 52, 9 about 77).
const LEVEL_AT = { 4: 47, 5: 52, 6: 57, 7: 61, 8: 70, 9: 76, 10: 80 };
const POLISH_LV = { raw: -4, balanced: 0, ready: 4 };
const gauss = r => { const u = Math.max(1e-9, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const LEAN_W = { none: [1, 1, 1], guards: [1.8, 1, 0.7], wings: [0.8, 1.8, 0.8], bigs: [0.7, 1, 1.8] };
export const group = pos => (pos <= 2 ? 0 : pos <= 5 ? 1 : 2);
const INTL = [['CA', 'Toronto'], ['AU', 'Melbourne'], ['FR', 'Paris'], ['RS', 'Belgrade'], ['DE', 'Berlin'], ['ES', 'Madrid'], ['LT', 'Kaunas'],
  ['NG', 'Lagos'], ['SN', 'Dakar'], ['BR', 'Sao Paulo'], ['GR', 'Athens'], ['TR', 'Istanbul'], ['SS', 'Juba'], ['JP', 'Tokyo'], ['IT', 'Bologna'], ['SI', 'Ljubljana']];
export const COUNTRIES = Object.fromEntries(INTL.map(([c, city]) => [c, city]));
const COUNT_KEYS = ['PTS', 'FGM', 'FGA', 'TPM', 'TPA', 'FTM', 'FTA', 'REB', 'ORB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'DD', 'TD'];
const SKILL_KEYS = ['LAY', 'DNK', 'INS', 'MID', 'TPT', 'FTS', 'DRB', 'PAS', 'ORE', 'DRE', 'STL', 'BLK'];

// Archetypes: which ratings he leans on (×), which positions play it (0 PG … 8 C), and a touch of body.
export const ARCHETYPES = {
  floor: { label: 'Floor General', pos: [0, 1], w: { PAS: 1.7, DRB: 1.5, TPT: 1.1, STL: 1.1, INS: 0.5, BLK: 0.5, ORE: 0.6 } },
  creator: { label: 'Shot Creator', pos: [0, 1, 2, 3], w: { MID: 1.6, DRB: 1.4, TPT: 1.3, LAY: 1.2, BLK: 0.5, ORE: 0.6, INS: 0.6 } },
  shooter: { label: 'Sharpshooter', pos: [1, 2, 3, 4], w: { TPT: 1.8, FTS: 1.6, MID: 1.3, DNK: 0.6, INS: 0.5, BLK: 0.5, ORE: 0.6 } },
  threeD: { label: '3-and-D Wing', pos: [2, 3, 4, 5], w: { TPT: 1.5, STL: 1.6, DRE: 1.2, BLK: 1.1, DRB: 0.8, INS: 0.6, PAS: 0.8 } },
  slasher: { label: 'Slasher', pos: [1, 2, 3, 4], w: { LAY: 1.6, DNK: 1.7, DRB: 1.2, TPT: 0.7, MID: 0.8 }, body: { SPD: 2 } },
  pointFwd: { label: 'Point Forward', pos: [4, 5, 6], w: { PAS: 1.6, DRB: 1.3, DRE: 1.2, LAY: 1.1, TPT: 0.8, BLK: 0.8 } },
  stretch: { label: 'Stretch Big', pos: [5, 6, 7, 8], w: { TPT: 1.6, MID: 1.4, DRE: 1.2, FTS: 1.2, INS: 0.8, DNK: 0.7 } },
  rim: { label: 'Rim Protector', pos: [6, 7, 8], w: { BLK: 1.9, DRE: 1.5, DNK: 1.3, INS: 1.1, TPT: 0.3, MID: 0.5, DRB: 0.5, PAS: 0.6 }, body: { STR: 2 } },
  post: { label: 'Post Scorer', pos: [6, 7, 8], w: { INS: 1.9, ORE: 1.5, LAY: 1.3, DRE: 1.1, TPT: 0.4, DRB: 0.5 }, body: { STR: 2 } },
  athlete: { label: 'Raw Athlete', pos: [1, 2, 3, 4, 5, 6], w: { DNK: 1.8, LAY: 1.3, BLK: 1.2, STL: 1.2, TPT: 0.6, MID: 0.6, FTS: 0.6, PAS: 0.7 }, body: { SPD: 3, STR: 1 } },
};
// How a class flavor tilts which archetypes come up (1 = as usual).
const FLAVOR_W = {
  mixed: {},
  shooters: { shooter: 3, stretch: 2.2, threeD: 1.8, creator: 1.4 },
  playmakers: { floor: 3, pointFwd: 2.5, creator: 1.6 },
  athletes: { athlete: 3, slasher: 2.4, rim: 1.4 },
  bigs: { post: 3, rim: 2.6, stretch: 0.6 },
  defenders: { threeD: 2.8, rim: 2.2, floor: 1.2 },
};

export function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pickW = (r, w) => { const e = Object.entries(w); let x = r() * e.reduce((a, [, v]) => a + v, 0); for (const [k, v] of e) if ((x -= v) <= 0) return isNaN(+k) ? k : +k; const k = e[e.length - 1][0]; return isNaN(+k) ? k : +k; };
const clone = o => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Donors: the game's own prospects and college players (18-23), by position group.
function donorPool(data) {
  const pro = data.seasonLeagues[0];
  const college = data.seasonLeagues.slice(1).flatMap(l => l.teams.flatMap(t => t.roster));
  const all = [...(pro.draftClass || []), ...college].filter(p => p.attributes && p.age >= 18 && p.age <= 23 && (p.stats || []).length);
  return [0, 1, 2].map(g => all.filter(p => group(p.pos) === g));
}
const everyone = data => data.seasonLeagues.flatMap(l => [...l.teams.flatMap(t => t.roster), ...(l.freeAgents || []), ...(l.retirees || []), ...(l.draftClass || []), ...(l.hallOfFame || [])]);

// The shared state for building prospects: rng, donors, the namer and the next free id. `extra`: prospects already
// made (a preview) that ids and names must not clash with.
export function makeCtx(data, o, extra = []) {
  o = { ...DEFAULTS, ...o };
  const L = data.seasonLeagues[0];
  const keep = new Set((L.draftClass || []).map(p => p.id));
  const active = data.seasonLeagues.flatMap(l => [...l.teams.flatMap(t => t.roster), ...(l.freeAgents || [])]).filter(p => !keep.has(p.id));
  return {
    data, o, L, r: mulberry((o.seed * 2654435761) ^ 0x51c1a55), donors: donorPool(data),
    nextId: 1 + Math.max(0, ...everyone(data).map(p => p.id), ...extra.map(p => p.id)),
    namer: makeNamer([...active, ...extra], mulberry(o.seed ^ 0xa11ce), data.seasonLeagues.flatMap(l => l.retirees || [])),
  };
}
// An archetype for a position group, by the class flavor.
function pickArch(ctx, g, flavor) {
  const fw = FLAVOR_W[flavor] || {}, w = {};
  for (const [k, a] of Object.entries(ARCHETYPES)) if (a.pos.some(x => group(x) === g)) w[k] = fw[k] ?? 1;
  return pickW(ctx.r, w);
}

// One prospect. spec (all optional): pot, g (position group), pos, arch, age, ht, abroad, ctry, city, fn, ln,
// level (current level to aim for, instead of the tier's), body ({ SPD: +n }), id, batch (named alongside him).
export function makeOne(ctx, spec = {}) {
  const { r, o, L } = ctx;
  const pot = spec.pot ?? pickW(r, POT_W[o.strength] || POT_W.normal);
  const lw = LEAN_W[o.lean] || LEAN_W.none;
  const g = spec.pos != null ? group(spec.pos) : spec.g ?? pickW(r, { 0: 1.2 * lw[0], 1: 1 * lw[1], 2: 0.9 * lw[2] });
  const arch = spec.arch || pickArch(ctx, g, o.flavor);
  const A = ARCHETYPES[arch];
  const pool = ctx.donors[g].length ? ctx.donors[g] : ctx.donors.flat();
  const near = pool.filter(p => Math.abs((p.pot || 5) - Math.min(pot, 9)) <= 1 && (spec.pos == null || Math.abs(p.pos - spec.pos) <= 1));
  const d = (near.length ? near : pool)[Math.floor(r() * (near.length || pool.length))];
  const p = clone(d);
  p.id = spec.id ?? ctx.nextId++;
  // A donor can be a college player: the prospect belongs to the pro league's draft (league 0), as the game's own are.
  p.league = 0; p.tid = 0; p.status = 1; p.yrs = 0; p.linePos = -1; p.awards = []; p.records = 0;
  p.pos = spec.pos ?? (A.pos.includes(d.pos) ? d.pos : A.pos.filter(x => group(x) === g)[Math.floor(r() * A.pos.filter(x => group(x) === g).length)] ?? d.pos);
  p.age = spec.age ?? pickW(r, AGE_W[o.ages] || AGE_W.mixed);
  p.ht = spec.ht ?? clamp(Math.round(d.ht + (r() * 2 - 1) * 1.5 + (p.pos - d.pos) * 0.8), 70, 90);
  p.wt = clamp(Math.round(d.wt + (r() * 2 - 1) * 10 + (p.ht - d.ht) * 4), 160, 300);
  p.pot = spec.pot != null && spec.keepPot ? pot : Math.min(pot, AGE_POT_CAP(p.age));
  p.regressionAge = 30 + Math.floor(r() * 5);
  // Ratings: the donor's shape bent toward the archetype, scaled so his level lands where the game's own classes put
  // his tier (older and more polished a little higher), with each rating nudged; ceilings follow the target potential.
  const before = levelOf(d);
  const target = clamp(Math.round(spec.level ?? ((LEVEL_AT[p.pot] ?? 52) + (p.age - 19.5) * 2.4 + (POLISH_LV[o.polish] ?? 0) + gauss(r) * 2.5)), 35, 92);
  const want = 168 - 2 * (100 - target);
  const bent = Object.fromEntries(SKILL_KEYS.map(k => [k, Math.max(1, (d.attributes[k]?.[0] || 1) * (0.55 + 0.45 * (A.w[k] ?? 1)) * (A.w[k] ?? 1) ** 0.5)]));
  const sum0 = SKILL_KEYS.reduce((a, k) => a + bent[k], 0) || 1;
  const body = { ...(A.body || {}) };
  for (const [k, n] of Object.entries(spec.body || {})) body[k] = (body[k] || 0) + n;
  for (const [k, v] of Object.entries(p.attributes)) {
    const phys = !SKILL_KEYS.includes(k);
    const cur = phys ? clamp(v[0] + (body[k] || 0), 1, 20) : clamp(Math.round(bent[k] * want / sum0 + (r() * 2 - 1) * 1.2), 1, 20);
    p.attributes[k] = [cur, phys ? clamp(Math.max(cur, v[1] + (body[k] || 0)), 1, 20) : cur];
  }
  // Rounding drift: nudge the archetype's ratings until the level is on target.
  for (let i = 0; i < 60 && levelOf(p) !== target; i++) {
    const up = levelOf(p) < target;
    const k = SKILL_KEYS.filter(x => up ? p.attributes[x][0] < 20 : p.attributes[x][0] > 1).sort((a, b) => ((A.w[b] ?? 1) - (A.w[a] ?? 1)) * (up ? 1 : -1) || p.attributes[b][0] - p.attributes[a][0])[up ? Math.floor(r() * 3) : 0];
    if (!k) break;
    p.attributes[k][0] += up ? 1 : -1;
  }
  for (const k of SKILL_KEYS) p.attributes[k][1] = Math.max(p.attributes[k][1], p.attributes[k][0]);
  // Ceilings: room to grow into what his potential promises (the same ladder recruits use: a 10 tops out near a
  // 20/20 total, each step down 14 points less), spread by the donor's own room and the archetype.
  const ceilSum = 168 - (10 - Math.min(10, p.pot)) * 14, curSum = SKILL_KEYS.reduce((a, k) => a + p.attributes[k][0], 0);
  const roomW = Object.fromEntries(SKILL_KEYS.map(k => [k, (Math.max(0, (d.attributes[k]?.[1] || 0) - (d.attributes[k]?.[0] || 0)) + 1) * (A.w[k] ?? 1) * (0.8 + r() * 0.4)]));
  let need = Math.max(0, ceilSum - curSum);
  for (let pass = 0; pass < 3 && need > 0; pass++) {
    const open = SKILL_KEYS.filter(k => p.attributes[k][1] < 20), tw = open.reduce((a, k) => a + roomW[k], 0) || 1;
    let used = 0;
    for (const k of open) { const add = Math.min(20 - p.attributes[k][1], Math.round(need * roomW[k] / tw)); p.attributes[k][1] += add; used += add; }
    need -= used;
    if (!used) break;
  }
  const f = levelOf(p) / Math.max(1, before);
  for (const s of p.stats || []) for (const row of [...(s.season || []), ...(s.playoffs || []), ...(s.finals || [])]) for (const k of COUNT_KEYS) if (typeof row[k] === 'number') row[k] = Math.max(0, Math.round(row[k] * f));
  if (p.traits) for (const k of Object.keys(p.traits)) p.traits[k] = 0;   // the app reads him fresh
  Object.assign(p.history || (p.history = {}), { yearDeclared: L.season.currentYear, draft: { pk: 0, rd: 0, tid: 0, otid: 0, yr: 0 }, yearRetired: 0, yearInducted: 0 });
  // Abroad or at home: a new look and name either way.
  const abroad = spec.abroad ?? (spec.ctry ? spec.ctry !== 'US' : r() * 100 < o.intl);
  if (abroad) {
    const [ctry, city] = spec.ctry && spec.ctry !== 'US' ? [spec.ctry, spec.city || COUNTRIES[spec.ctry] || ''] : INTL[Math.floor(r() * INTL.length)];
    p.ctry = ctry; p.home = city ? `${city}, ${ctry}` : '';
    p.stats = (p.stats || []).filter(s => s.yr === L.season.currentYear - 1).slice(-1);   // one season over here, as most do
  } else { p.ctry = 'US'; if (spec.city) p.home = spec.city; }
  const look = randomLook(r, p);
  p.appearance = { ...p.appearance, ...look.appearance };
  const tone = abroad ? lookFor(r, p.ctry, POOL.players) : null;
  if (tone) p.appearance = { ...p.appearance, ...tone };
  p.accessories = look.accessories.map(x => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v === look.appearance.skinC ? p.appearance.skinC : v])));
  ctx.namer.name(p, (abroad && groupFor(p.ctry)) || undefined, spec.batch || []);
  if (spec.fn) p.fn = spec.fn;
  if (spec.ln) p.ln = spec.ln;
  return { p, arch };
}

// The potentials for a class: the stars asked for, then the strength curve, bent by the depth dial.
function classPots(ctx, n) {
  const { r, o } = ctx, pots = [];
  for (let i = 0; i < o.stars && pots.length < n; i++) pots.push(r() < 0.35 ? 10 : 9);
  while (pots.length < n) {
    let t = pickW(r, POT_W[o.strength] || POT_W.normal);
    if (o.depth === 'top' && t >= 6 && t <= 8 && r() < 0.5) t -= 1;           // a clear top, thin after
    if (o.depth === 'top' && t === 9 && r() < 0.3) t = 10;
    if (o.depth === 'deep' && t >= 5 && t <= 6 && r() < 0.35) t += 1;          // real value late
    if (o.depth === 'deep' && t === 10) t = 9;
    pots.push(t);
  }
  return pots;
}

// The storylines, in the order the dial adds them.
export const STORY_KINDS = ['twins', 'son', 'mystery', 'senior', 'hometown'];
export const STORY_LABEL = { twins: 'Twins', son: 'A legend\'s son', mystery: 'Mystery man from abroad', senior: 'Fifth-year senior', hometown: 'Hometown kid', sleeper: 'Sleeper', bust: 'Bust risk', headliner: 'Headliner' };
function storyProspects(ctx, kind, homeTeam) {
  const { r, data } = ctx;
  if (kind === 'twins') {
    const a = makeOne(ctx, { pot: 6 + Math.floor(r() * 3) });
    const b = makeOne(ctx, { pot: Math.max(5, a.p.pot - 1 - Math.floor(r() * 2)), g: group(a.p.pos), age: a.p.age, abroad: a.p.ctry !== 'US', ctry: a.p.ctry, ht: a.p.ht + (r() < 0.5 ? 0 : 1), ln: a.p.ln });
    b.p.home = a.p.home; b.p.appearance = { ...b.p.appearance, skinC: a.p.appearance.skinC, eyeC: a.p.appearance.eyeC, hairC: a.p.appearance.hairC };
    return [{ ...a, tag: `Twins: ${a.p.fn} and ${b.p.fn} ${a.p.ln}` }, { ...b, tag: `Twins: ${a.p.fn} and ${b.p.fn} ${a.p.ln}` }];
  }
  if (kind === 'son') {
    const legends = data.seasonLeagues[0] ? [...(data.seasonLeagues[0].hallOfFame || []), ...(data.seasonLeagues[0].retirees || [])].filter(x => x.ln && levelOf(x) >= 84) : [];
    const dad = legends[Math.floor(r() * legends.length)];
    if (!dad) return [];
    const s = makeOne(ctx, { pot: 7 + Math.floor(r() * 3), pos: clamp(dad.pos + Math.round((r() * 2 - 1) * 1), 0, 8), abroad: (dad.ctry || 'US') !== 'US', ctry: dad.ctry, ln: dad.ln, ht: clamp(dad.ht + Math.round(r() * 2 - 1), 70, 90) });
    s.p.home = dad.home || s.p.home; s.p.appearance = { ...s.p.appearance, skinC: dad.appearance?.skinC ?? s.p.appearance.skinC };
    return [{ ...s, tag: `Son of ${dad.fn} ${dad.ln}` }];
  }
  if (kind === 'mystery') {
    const s = makeOne(ctx, { pot: r() < 0.4 ? 10 : 9, age: 18, abroad: true, level: 60 + Math.floor(r() * 6) });
    for (const st of s.p.stats || []) for (const row of st.season || []) for (const k of COUNT_KEYS) if (typeof row[k] === 'number') row[k] = Math.round(row[k] * 0.35);
    return [{ ...s, tag: `Mystery man from ${s.p.ctry}` }];
  }
  if (kind === 'senior') {
    const pot = 5 + Math.floor(r() * 2);
    return [{ ...makeOne(ctx, { pot, age: 23, abroad: false, level: (LEVEL_AT[pot] ?? 52) + 9 }), tag: 'Fifth-year senior' }];
  }
  if (kind === 'hometown' && homeTeam) {
    const s = makeOne(ctx, { pot: 6 + Math.floor(r() * 3), abroad: false, city: homeTeam.home || homeTeam.city });
    return [{ ...s, tag: `Hometown kid (${homeTeam.city || homeTeam.name})` }];
  }
  return [];
}

// Build a class. `o` = settings (DEFAULTS shape). `locked`: prospects to keep as they are. `homeTeam`: { city, home,
// name } for the hometown kid. Returns { cls, meta: { pid: { arch, tags: [] } } }.
export function generate(data, o, { locked = [], homeTeam = null, meta: keepMeta = {} } = {}) {
  const ctx = makeCtx(data, o, locked);
  o = ctx.o;
  const meta = {}, out = [...locked];
  for (const p of locked) meta[p.id] = keepMeta[p.id] || { arch: null, tags: [] };
  const n = Math.max(0, o.size - locked.length);
  // Storylines first (they take their own spots), then the rest.
  const stories = STORY_KINDS.slice(0, o.stories).flatMap(k => storyProspects(ctx, k, homeTeam));
  for (const s of stories.slice(0, n)) { out.push(s.p); meta[s.p.id] = { arch: s.arch, tags: [s.tag] }; }
  const pots = classPots(ctx, n - Math.min(n, stories.length));
  // Sleepers and busts: what a scout sees and what he becomes don't match.
  const flips = { none: 0, some: 2, lots: 5 }[o.boom] ?? 0;
  pots.forEach((pot, i) => {
    let spec = { pot, batch: out };
    // The guaranteed stars are young (the age cap would take their ceiling otherwise).
    if (i < o.stars) spec.age = 18 + Math.floor(ctx.r() * 3);
    let tag = null;
    if (i >= o.stars && i < o.stars + flips) { spec = { ...spec, pot: 8 + Math.floor(ctx.r() * 2), level: 50 + Math.floor(ctx.r() * 5) }; tag = 'sleeper'; }
    else if (i >= o.stars + flips && i < o.stars + 2 * flips) { spec = { ...spec, pot: 5, level: 68 + Math.floor(ctx.r() * 6), body: { SPD: 2, STR: 1 } }; tag = 'bust'; }
    const { p, arch } = makeOne(ctx, spec);
    out.push(p);
    meta[p.id] = { arch, tags: tag ? [tag] : [] };
  });
  return { cls: out, meta };
}
// The old entry point: just the class.
export const generateClass = (data, o) => generate(data, o).cls;

// Schools: where a prospect played (his last college season), and the college teams to pick from.
export function schools(data) {
  return data.seasonLeagues.slice(1).flatMap((l, i) => l.teams.map(t => ({ li: i + 1, tid: t.id, name: `${t.city ? `${t.city} ` : ''}${t.name || ''}`.trim() || t.shortName })));
}
export function schoolOf(data, p) {
  const s = [...(p.stats || [])].reverse().find(x => x.league > 0 && (x.season || []).length);
  if (!s) return null;
  const tid = s.season[s.season.length - 1].tid, t = data.seasonLeagues[s.league]?.teams.find(x => x.id === tid);
  return t ? `${t.city ? `${t.city} ` : ''}${t.name || ''}`.trim() || t.shortName : null;
}
// Move his college seasons to another school (stats stay; only where he played them changes).
export function setSchool(p, li, tid) {
  for (const s of p.stats || []) if (s.league > 0) { s.league = li; for (const row of s.season || []) row.tid = tid; for (const row of s.playoffs || []) row.tid = tid; }
}

// Past drafts by the potential of their top 14 picks (what they turned into, as the save rates them now).
export function pastClasses(L) {
  const seen = new Set(), by = new Map();
  for (const p of [...L.teams.flatMap(t => t.roster), ...(L.freeAgents || []), ...(L.retirees || []), ...(L.hallOfFame || [])]) {
    if (seen.has(p.id)) continue; seen.add(p.id);
    const d = p.history?.draft;
    if (!d?.yr || d.rd !== 1 || d.pk > 14) continue;
    (by.get(d.yr) || by.set(d.yr, []).get(d.yr)).push(p);
  }
  return [...by].filter(([, list]) => list.length >= 8).map(([yr, list]) => ({ yr, pot: list.reduce((a, p) => a + (p.pot || 0), 0) / list.length, stars: list.filter(p => levelOf(p) >= 85).length, n: list.length })).sort((a, b) => b.yr - a.yr);
}
export const topPot = cls => { const top = [...cls].sort((a, b) => (b.pot - a.pot) || (levelOf(b) - levelOf(a))).slice(0, 14); return top.reduce((a, p) => a + (p.pot || 0), 0) / Math.max(1, top.length); };

// A class as a file to keep or share, and back: fresh ids, schools moved to ones this save has.
export const packClass = (cls, meta, from) => ({ kind: 'hlc-class', v: 1, from, prospects: cls, meta });
export function unpackClass(data, pack) {
  if (pack?.kind !== 'hlc-class' || !Array.isArray(pack.prospects)) throw new Error('That isn\'t a draft class file.');
  let id = 1 + Math.max(0, ...everyone(data).map(p => p.id));
  const sch = schools(data), meta = {};
  const cls = pack.prospects.map(p0 => {
    const p = clone(p0), old = p.id;
    p.id = id++;
    for (const s of p.stats || []) if (s.league > 0) {
      const ok = data.seasonLeagues[s.league]?.teams.some(t => (s.season || []).every(r => r.tid === t.id));
      if (!ok && sch.length) { const pick = sch[old % sch.length]; s.league = pick.li; for (const row of [...(s.season || []), ...(s.playoffs || [])]) row.tid = pick.tid; }
    }
    if (!sch.length) p.stats = (p.stats || []).filter(s => s.league === 0);
    if (pack.meta?.[old]) meta[p.id] = pack.meta[old];
    return p;
  });
  return { cls, meta };
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
