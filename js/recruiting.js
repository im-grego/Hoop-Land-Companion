// College recruiting run by the app, in place of the game's: a generated
// high-school class (250-300) plus the transfer portal, four weeks of
// offers, calls and visits against every CPU school, commitments and flips,
// then Signing Day. Signings are written into the save (recruits.js).
//
// The class is rebuilt from a stored seed on every load (so nothing big is
// kept in storage); the market (offers, interest, commitments) is small and
// kept per save and season by the app.

import { generateRecruit, signToSchool } from './recruits.js';
import { generateTraits, TRAIT_KEYS } from './traits.js';
import { levelOf } from './savefile.js';
import { makeNamer } from './names.js';

export const WEEKS = 4;
export const LIMITS = { calls: 12, homes: 3, officials: 5 };
export const PITCHES = [
  { k: 'nil', label: 'NIL', icon: '💰' },
  { k: 'win', label: 'Winning', icon: '🏆' },
  { k: 'home', label: 'Close to Home', icon: '📍' },
  { k: 'pt', label: 'Playing Time', icon: '⏱️' },
];

export function rngOf(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const gauss = r => { const u = Math.max(1e-9, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const pickW = (r, list, w) => { let x = r() * list.reduce((a, e) => a + w(e), 0); for (const e of list) { x -= w(e); if (x <= 0) return e; } return list[list.length - 1]; };
export const GROUP = p => (p.pos <= 2 ? 'Guards' : p.pos <= 5 ? 'Wings' : 'Bigs');
const WANT = { Guards: 4, Wings: 3, Bigs: 3 };
export const ROSTER_MAX = 15;

// Hometowns: [city, state, lat, lon, weight] (weight = how much talent).
const CITIES = [
  ['Los Angeles', 'CA', 34.05, -118.24, 10], ['Houston', 'TX', 29.76, -95.37, 9], ['Dallas', 'TX', 32.78, -96.8, 9], ['Atlanta', 'GA', 33.75, -84.39, 10],
  ['Chicago', 'IL', 41.88, -87.63, 9], ['New York', 'NY', 40.71, -74.01, 8], ['Philadelphia', 'PA', 39.95, -75.17, 7], ['Washington', 'DC', 38.91, -77.04, 8],
  ['Baltimore', 'MD', 39.29, -76.61, 5], ['Charlotte', 'NC', 35.23, -80.84, 6], ['Raleigh', 'NC', 35.78, -78.64, 5], ['Indianapolis', 'IN', 39.77, -86.16, 6],
  ['Detroit', 'MI', 42.33, -83.05, 6], ['Memphis', 'TN', 35.15, -90.05, 5], ['New Orleans', 'LA', 29.95, -90.07, 4], ['Miami', 'FL', 25.76, -80.19, 5],
  ['Orlando', 'FL', 28.54, -81.38, 4], ['Jacksonville', 'FL', 30.33, -81.66, 3], ['Tampa', 'FL', 27.95, -82.46, 3], ['Las Vegas', 'NV', 36.17, -115.14, 4],
  ['Phoenix', 'AZ', 33.45, -112.07, 5], ['Seattle', 'WA', 47.61, -122.33, 4], ['Portland', 'OR', 45.52, -122.68, 3], ['Oakland', 'CA', 37.8, -122.27, 4],
  ['Sacramento', 'CA', 38.58, -121.49, 3], ['San Diego', 'CA', 32.72, -117.16, 3], ['Denver', 'CO', 39.74, -104.99, 3], ['Minneapolis', 'MN', 44.98, -93.27, 4],
  ['Milwaukee', 'WI', 43.04, -87.91, 4], ['St. Louis', 'MO', 38.63, -90.2, 4], ['Kansas City', 'MO', 39.1, -94.58, 3], ['Oklahoma City', 'OK', 35.47, -97.52, 3],
  ['San Antonio', 'TX', 29.42, -98.49, 3], ['Austin', 'TX', 30.27, -97.74, 3], ['Birmingham', 'AL', 33.52, -86.8, 3], ['Nashville', 'TN', 36.16, -86.78, 4],
  ['Louisville', 'KY', 38.25, -85.76, 4], ['Lexington', 'KY', 38.04, -84.5, 2], ['Cincinnati', 'OH', 39.1, -84.51, 3], ['Columbus', 'OH', 39.96, -83.0, 4],
  ['Cleveland', 'OH', 41.5, -81.69, 4], ['Pittsburgh', 'PA', 40.44, -79.99, 2], ['Newark', 'NJ', 40.74, -74.17, 5], ['Boston', 'MA', 42.36, -71.06, 3],
  ['Hartford', 'CT', 41.76, -72.67, 2], ['Richmond', 'VA', 37.54, -77.44, 3], ['Norfolk', 'VA', 36.85, -76.29, 3], ['Greensboro', 'NC', 36.07, -79.79, 3],
  ['Columbia', 'SC', 34.0, -81.03, 3], ['Little Rock', 'AR', 34.75, -92.29, 2], ['Jackson', 'MS', 32.3, -90.18, 3], ['Salt Lake City', 'UT', 40.76, -111.89, 2],
  ['Albuquerque', 'NM', 35.08, -106.65, 1], ['Omaha', 'NE', 41.26, -95.93, 1], ['Des Moines', 'IA', 41.59, -93.62, 1], ['Wichita', 'KS', 37.69, -97.34, 1],
  ['Tulsa', 'OK', 36.15, -95.99, 2], ['Fresno', 'CA', 36.74, -119.79, 2], ['Boise', 'ID', 43.62, -116.2, 1], ['Spokane', 'WA', 47.66, -117.43, 1],
  ['Buffalo', 'NY', 42.89, -78.88, 2], ['Rochester', 'NY', 43.16, -77.61, 1], ['Gary', 'IN', 41.59, -87.35, 2], ['Flint', 'MI', 43.01, -83.69, 2],
  ['Toledo', 'OH', 41.65, -83.54, 1], ['Savannah', 'GA', 32.08, -81.09, 2], ['Mobile', 'AL', 30.69, -88.04, 2], ['Shreveport', 'LA', 32.53, -93.75, 2],
  ['Baton Rouge', 'LA', 30.45, -91.19, 2], ['Toronto', 'ON', 43.65, -79.38, 2],
];
// Distance in miles between two save locations (latitude and longitude x 100).
export function miles(a, b) {
  if (!a || !b) return 9999;
  const lat = ((a.x + b.x) / 2 / 100) * Math.PI / 180;
  return Math.hypot((a.x - b.x) / 100 * 69, (a.y - b.y) / 100 * 69 * Math.cos(lat));
}

// Potential weights for the high-school class (half stars), a little richer
// at the top than the league already is.
const POT_W = { 10: 1.5, 9: 4, 8: 9, 7: 17, 6: 24, 5: 26, 4: 18.5 };
const ASK = { 5: [7, 10], 4: [4, 7], 3: [2, 4], 2: [1, 2] };

// Traits → what he weighs: NIL (money), winning, staying close (loyalty),
// playing time (a mix of motor and ambition, more for transfers).
function motivesOf(p, transfer, r) {
  const t = k => p.traits?.[k] || 10;
  const w = {
    nil: 0.4 + t('money') / 20 + gauss(r) * 0.12,
    win: 0.4 + t('winning') / 20 + gauss(r) * 0.12,
    home: 0.25 + t('loyalty') / 20 + gauss(r) * 0.15,
    pt: (transfer ? 0.9 : 0.5) + t('motor') / 40 + gauss(r) * 0.15,
  };
  for (const k of Object.keys(w)) w[k] = Math.max(0.1, w[k]);
  const s = Object.values(w).reduce((a, v) => a + v, 0);
  for (const k of Object.keys(w)) w[k] /= s;
  return w;
}

// High school stats from the ratings (made up, but they follow the player).
function hsLine(p, lv, r) {
  const g = GROUP(p);
  const q = clamp((lv - 30) / 30, 0, 1.4);
  const ppg = clamp(9 + q * 15 + gauss(r) * 3, 4, 38);
  const rpg = clamp((g === 'Bigs' ? 7 : g === 'Wings' ? 4.5 : 3) + q * (g === 'Bigs' ? 5 : 2.5) + gauss(r) * 1.4, 1, 18);
  const apg = clamp((g === 'Guards' ? 3.5 : g === 'Wings' ? 2 : 1) + q * (g === 'Guards' ? 3.5 : 1.5) + gauss(r) * 1, 0.3, 12);
  return { ppg: Math.round(ppg * 10) / 10, rpg: Math.round(rpg * 10) / 10, apg: Math.round(apg * 10) / 10 };
}

function setTraits(p) {
  if (!p.traits) return;
  const g = generateTraits(p, 0);
  for (const k of TRAIT_KEYS) p.traits[k] = clamp(Math.round(g[k]), 1, 20);
}

// Build the class (deterministic from the seed). Transfers are the portal
// players the market started with (their ids are kept in the market).
export function buildClass(C, li, M) {
  const r = rngOf(M.seed);
  const everyone = C.teams.flatMap(t => t.roster).concat(C.freeAgents || []);
  const template = C.teams.flatMap(t => t.roster).reduce((a, p) => (!a || p.id < a.id ? p : a), null);
  const archPool = {};
  for (const p of [...everyone].sort((a, b) => a.id - b.id)) if (p.id <= M.baseId) (archPool[p.pos] ||= []).push([p.pri, p.sec]);
  // Names on their own stream (so the class itself is unchanged), against the players the save had when the period opened.
  const namer = makeNamer(everyone.filter(p => p.id <= M.baseId), rngOf((M.seed ^ 0x5eed) >>> 0));
  const n = M.size;
  const pots = Object.keys(POT_W).map(Number);
  const hs = [];
  for (let i = 0; i < n; i++) {
    const pot = pickW(r, pots, k => POT_W[k]);
    const tier = pot >= 9 ? 5 : pot >= 8 ? 4 : pot >= 6 ? 3 : 2;
    const { p, polish } = generateRecruit(C, li, r, { stars: tier, pot, id: M.baseId + 1 + i, template });
    const city = pickW(r, CITIES, c => c[4]);
    r(); r();   // the old name draws, so the rest of the class comes out as it always has
    // Stored like the game's own players: "City, ST" with country US, or
    // "City, CC" (country code) abroad, e.g. "Toronto, CA" with country CA.
    p.ctry = city[1] === 'ON' ? 'CA' : 'US';
    p.home = `${city[0]}, ${p.ctry === 'US' ? city[1] : p.ctry}`;
    p.loc = { x: Math.round(city[2] * 100 + gauss(r) * 25), y: Math.round(city[3] * 100 + gauss(r) * 25) };
    namer.name(p, undefined, hs.map(x => x.p));   // a brother or twin takes the family's hometown
    const arch = archPool[p.pos]?.length ? archPool[p.pos][Math.floor(r() * archPool[p.pos].length)] : [p.pri, p.sec];
    [p.pri, p.sec] = arch;
    setTraits(p);
    const lv = levelOf(p);
    const grade = pot + (lv - 45) / 10 + gauss(r) * 0.7;
    const [hc, hst] = String(p.home).split(', ');
    hs.push({ id: p.id, p, polish, city: hc || city[0], st: p.ctry === 'US' ? hst || city[1] : city[1], lv, grade, hs: hsLine(p, lv, r), w: motivesOf(p, false, r), ready: 0, transfer: false });
  }
  // Rank by the scouts' grade; stars by rank.
  hs.sort((a, b) => b.grade - a.grade);
  hs.forEach((x, i) => {
    x.rank = i + 1;
    const f = i / n;
    x.stars = f < 0.072 ? 5 : f < 0.32 ? 4 : f < 0.72 ? 3 : 2;
    const [a, b] = ASK[x.stars];
    x.ask = Math.round((a + r() * (b - a)) * (0.8 + (x.p.traits?.money || 10) / 50) * 2) / 2;
    x.ready = clamp({ 5: 3, 4: 2, 3: 1, 2: 1 }[x.stars] + Math.floor(r() * 2), 1, WEEKS);
  });
  // Transfers: as they sit in the save (in the pool, or signed by now).
  const pool = new Map(everyone.map(p => [p.id, p]));
  const tr = (M.transferIds || []).map(id => pool.get(id)).filter(Boolean).map(p => {
    const lv = levelOf(p);
    const stars = lv >= 64 ? 5 : lv >= 56 ? 4 : lv >= 47 ? 3 : 2;
    const [a, b] = ASK[stars];
    return { id: p.id, p, city: '', st: '', lv, grade: p.pot + (lv - 45) / 10, hs: null, w: motivesOf(p, true, r), stars, ask: Math.round((a + r() * (b - a)) * 0.8 * 2) / 2, ready: 1 + Math.floor(r() * 2), transfer: true };
  }).sort((a, b) => b.lv - a.lv);
  tr.forEach((x, i) => { x.rank = i + 1; });
  const all = [...hs, ...tr];
  return { hs, tr, all, byId: new Map(all.map(x => [x.id, x])), maxId: M.baseId + n };
}

// A new market for this offseason.
export function newMarket(C, seed = (Math.random() * 2 ** 31) | 0) {
  const r = rngOf(seed ^ 0x5bd1e995);
  return {
    v: 1, seed, baseId: C.meta?.uPID || 0, size: 250 + Math.floor(r() * 51),
    transferIds: (C.freeAgents || []).filter(p => (p.yrs ?? 0) >= 1).map(p => p.id),
    week: 1, offers: {}, int: {}, commit: {}, acts: {}, officials: {}, scouted: {}, log: [], showcase: null, applied: false,
  };
}

// Schools as recruits see them this week.
export function schoolsOf(C, M, cls) {
  const yr = C.season.currentYear - 1;
  const commits = {};
  for (const [rid, tid] of Object.entries(M.commit)) (commits[tid] ||= []).push(+rid);
  const maxP = Math.max(1, ...C.teams.map(t => t.prestigePoints || 0));
  const list = C.teams.map(t => {
    const s = (t.season || []).find(x => x.yr === yr)?.seasonStats || {};
    const gp = (s.W || 0) + (s.L || 0);
    const groups = { Guards: [], Wings: [], Bigs: [] };
    for (const p of t.roster) groups[GROUP(p)].push(levelOf(p));
    const mine = (commits[t.id] || []).map(id => cls.byId.get(id)).filter(Boolean);
    for (const x of mine) if (!t.roster.includes(x.p)) groups[GROUP(x.p)].push(x.lv);
    const budget = Math.round(10 + ((t.prestigePoints || 0) / 139) * 30);
    const spent = Object.entries(M.offers).reduce((a, [rid, o]) => a + (o[t.id] && (M.commit[rid] === undefined || M.commit[rid] === t.id) ? o[t.id] : 0), 0);
    return {
      t, id: t.id, prest: (t.prestigePoints || 0) / maxP, win: gp ? (s.W || 0) / gp : 0.5, groups, budget, spent,
      seats: Math.max(0, ROSTER_MAX - t.roster.length - mine.filter(x => !t.roster.includes(x.p)).length),
      commits: mine,
    };
  });
  return { list, byId: new Map(list.map(s => [s.id, s])) };
}

// What a school offers him, 0-1 for each motive. NIL from its offer.
export function components(x, s, M) {
  const g = GROUP(x.p);
  const better = s.groups[g].filter(l => l >= x.lv - 2).length;
  const have = s.groups[g].length;
  const nil = M.offers[x.id]?.[s.id] || 0;
  return {
    nil: x.ask > 0 ? clamp(nil / x.ask, 0, 1.3) : 1,
    win: clamp(0.65 * s.prest + 0.35 * s.win, 0, 1),
    home: clamp(1 - (miles(x.p.loc, s.t.location) - 75) / 900, 0, 1),
    pt: clamp(1 - better * 0.22 + (have < WANT[g] ? 0.15 : 0), 0.05, 1),
  };
}
export const fitOf = (x, s, M) => { const c = components(x, s, M); return Object.keys(x.w).reduce((a, k) => a + x.w[k] * c[k], 0); };
// Interest has diminishing returns, so effort can't fully outweigh fit.
export const effInt = v => 45 * (1 - Math.exp(-(v || 0) / 35));
// The best prospects also want a big-time program.
const BRAND = { 5: 22, 4: 12, 3: 4, 2: 0 };
export const scoreOf = (x, s, M) => 55 * fitOf(x, s, M) + effInt(M.int[x.id]?.[s.id]) + (BRAND[x.stars] || 0) * s.prest;
export const pitchMult = (x, s, M, k) => 0.55 + 2.2 * x.w[k] * components(x, s, M)[k];
const bestPitch = (x, s, M) => PITCHES.map(p => p.k).reduce((a, k) => (pitchMult(x, s, M, k) > pitchMult(x, s, M, a) ? k : a), 'nil');
const addInt = (M, rid, tid, v) => { const o = (M.int[rid] ||= {}); o[tid] = Math.round(((o[tid] || 0) + v) * 10) / 10; };

// The race: every school with an offer fills its own bar toward 100%; the
// first to get there (the highest, if several get there the same week)
// gets the commitment. Better recruits take more to win over.
export const GOAL = { 5: 82, 4: 67, 3: 54, 2: 46 };
export const goalOf = x => GOAL[x.stars] || 60;
export function race(x, S, M) {
  const offs = M.offers[x.id] || {};
  const goal = goalOf(x);
  const list = Object.keys(offs).map(Number).map(tid => S.byId.get(tid)).filter(Boolean).map(s => ({ s, score: scoreOf(x, s, M), nil: offs[s.id] }));
  list.sort((a, b) => b.score - a.score);
  for (const e of list) e.pct = Math.min(100, Math.round((e.score / goal) * 100));
  return list;
}

// CPU schools: offers to realistic targets, NIL from what's left, and
// their own calls and visits.
function cpuWeek(C, M, cls, S, userIds, r, effort = true) {
  const open = cls.all.filter(x => M.commit[x.id] === undefined);
  const byPrest = [...S.list].sort((a, b) => b.prest - a.prest || b.win - a.win);
  const n = cls.all.length;
  byPrest.forEach((s, i) => { s.aim = (i / S.list.length) * n * 0.9; });
  for (const s of S.list) {
    if (userIds.has(s.id)) continue;
    // Pull offers that can't land: committed elsewhere, or no seat left.
    for (const [rid, o] of Object.entries(M.offers)) {
      if (o[s.id] === undefined) continue;
      const c = M.commit[rid];
      if ((c !== undefined && c !== s.id) || (s.seats <= 0 && c !== s.id)) { delete o[s.id]; }
    }
    if (s.seats <= 0) continue;
    const mine = open.filter(x => M.offers[x.id]?.[s.id] !== undefined);
    const want = s.seats * 2 + 1;
    const value = x => {
      const talent = x.stars * 2 + x.lv / 25;
      const g = GROUP(x.p);
      const need = s.groups[g].length < WANT[g] ? 1.25 : 1;
      const reach = Math.max(0, (s.aim - x.rank) / (n * 0.2));
      return talent * need * fitOf(x, s, { ...M, offers: { [x.id]: { [s.id]: x.ask } } }) / (1 + reach * reach) * (0.7 + r() * 0.6);
    };
    if (mine.length < want) {
      const cands = open.filter(x => M.offers[x.id]?.[s.id] === undefined).map(x => ({ x, v: value(x) })).sort((a, b) => b.v - a.v);
      let left = s.budget - s.spent;
      for (const { x } of cands.slice(0, want - mine.length)) {
        const nil = Math.max(0.5, Math.round(Math.min(x.ask * (0.85 + r() * 0.4), Math.max(0.5, left / Math.max(1, s.seats))) * 2) / 2);
        if (left < 0.5) break;
        (M.offers[x.id] ||= {})[s.id] = nil;
        left -= nil; s.spent += nil;
      }
    }
    if (!effort) continue;
    // Effort: everyone offered gets a call; the top two a home visit; from
    // week 2 the top target an official visit.
    const targets = open.filter(x => M.offers[x.id]?.[s.id] !== undefined).map(x => ({ x, v: value(x) })).sort((a, b) => b.v - a.v);
    targets.forEach(({ x }, i) => {
      const m = pitchMult(x, s, M, bestPitch(x, s, M));
      addInt(M, x.id, s.id, 4 * m + 4 * s.prest);
      if (i < 3) addInt(M, x.id, s.id, 9 * m);
      if (i < 2 && M.week >= 2) addInt(M, x.id, s.id, 14 * m);
    });
  }
}

// The user's calls and visits this week (recorded as he makes them).
function userWeek(M, cls, S) {
  for (const [rid, a] of Object.entries(M.acts)) {
    const x = cls.byId.get(+rid);
    if (!x) continue;
    for (const [tid, act] of Object.entries(a)) {
      const s = S.byId.get(+tid);
      if (!s) continue;
      const offered = M.offers[rid]?.[s.id] !== undefined;
      const k = (offered ? 1 : 0.5) * (M.culture?.[s.id] || 1);
      if (act.call) addInt(M, x.id, s.id, 4 * k * pitchMult(x, s, M, act.call));
      if (act.home) addInt(M, x.id, s.id, 9 * k * pitchMult(x, s, M, act.home));
      if (act.official) addInt(M, x.id, s.id, 14 * k * pitchMult(x, s, M, act.official));
    }
  }
}

// The period opens: CPU schools' first offers (no calls or visits yet).
export function openMarket(C, M, cls, userIds) {
  cpuWeek(C, M, cls, schoolsOf(C, M, cls), userIds, rngOf(M.seed ^ 0x1234567), false);
  M.opened = true;
}

// End the week: everyone recruits, interest builds, recruits decide.
// Week 4 ends with Signing Day. Returns this week's news.
export function advanceWeek(C, li, M, cls, userIds, rngSeed) {
  const r = rngOf((M.seed + M.week * 7919) ^ (rngSeed || 0));
  let S = schoolsOf(C, M, cls);
  cpuWeek(C, M, cls, S, userIds, r);
  userWeek(M, cls, S);
  // Holding an offer keeps a little interest building.
  for (const [rid, o] of Object.entries(M.offers)) for (const tid of Object.keys(o)) addInt(M, +rid, +tid, 2);
  const news = { week: M.week, commits: [], flips: [], signed: [], late: [] };
  S = schoolsOf(C, M, cls);
  // Flips first (a committed player can be pried loose).
  if (M.week >= 2) {
    for (const [rid, tid] of Object.entries(M.commit)) {
      const x = cls.byId.get(+rid);
      if (!x) continue;
      const rc = race(x, S, M);
      const cur = rc.find(e => e.s.id === tid);
      const best = rc.find(e => e.s.id !== tid && e.s.seats > 0);
      if (cur && best && best.score > cur.score * 1.2 && r() < (22 - (x.p.traits?.loyalty || 10)) / 50) {
        M.commit[rid] = best.s.id;
        news.flips.push({ id: x.id, from: tid, to: best.s.id });
        S = schoolsOf(C, M, cls);
      }
    }
  }
  const last = M.week >= WEEKS;
  const order = cls.all.filter(x => M.commit[x.id] === undefined).sort((a, b) => a.rank - b.rank - (a.transfer ? 0.5 : 0));
  for (const x of order) {
    const rc = race(x, S, M).filter(e => e.s.seats > 0);
    if (!rc.length) continue;
    const lead = rc[0];
    // He commits once a school's bar is full (and he's ready to decide);
    // on Signing Day everyone still out there takes the leader.
    const go = last || (M.week >= x.ready && lead.pct >= 100);
    if (!go) continue;
    const pick = lead;
    M.commit[x.id] = pick.s.id;
    (last ? news.signed : news.commits).push({ id: x.id, to: pick.s.id });
    pick.s.seats--; pick.s.commits.push(x); pick.s.groups[GROUP(x.p)].push(x.lv);
  }
  if (last) {
    // Late signings: schools short of 12 take the best left that fits.
    const left = cls.all.filter(x => M.commit[x.id] === undefined).sort((a, b) => a.rank - b.rank);
    for (const x of left) {
      const S2 = S.list.filter(s => s.seats > 0 && !userIds.has(s.id) && s.t.roster.length + s.commits.filter(c => !s.t.roster.includes(c.p)).length < 12);
      if (!S2.length) break;
      const s = S2.reduce((a, b) => (fitOf(x, b, M) > fitOf(x, a, M) ? b : a));
      M.commit[x.id] = s.id;
      (M.offers[x.id] ||= {})[s.id] = M.offers[x.id][s.id] || 1;
      news.late.push({ id: x.id, to: s.id });
      s.seats--; s.commits.push(x); s.groups[GROUP(x.p)].push(x.lv);
    }
  }
  M.log.push(news);
  M.acts = {};
  M.week++;
  return news;
}

// The user's actions (recorded now, counted at the end of the week).
export function usedThisWeek(M, tid) {
  let calls = 0, homes = 0;
  for (const a of Object.values(M.acts)) { const e = a[tid]; if (!e) continue; if (e.call) calls++; if (e.home) homes++; }
  const officials = Object.values(M.officials).filter(o => o === tid || (Array.isArray(o) && o.includes(tid))).length;
  return { calls, homes, officials };
}
export function act(M, rid, tid, kind, pitch) {
  const u = usedThisWeek(M, tid);
  const e = ((M.acts[rid] ||= {})[tid] ||= {});
  if (kind === 'call') { if (e.call || u.calls >= LIMITS.calls) return false; e.call = pitch; return true; }
  if (kind === 'home') { if (e.home || u.homes >= LIMITS.homes) return false; e.home = pitch; M.scouted[rid] = 1; return true; }
  if (kind === 'official') {
    const had = M.officials[rid] || [];
    if (had.includes(tid) || u.officials >= LIMITS.officials) return false;
    M.officials[rid] = [...had, tid]; e.official = pitch; M.scouted[rid] = 1; return true;
  }
  return false;
}

// Class rankings: each school's commits (stars, with a bump for the very
// top), best first.
export function classRankings(M, cls, S) {
  const by = new Map();
  for (const [rid, tid] of Object.entries(M.commit)) {
    const x = cls.byId.get(+rid);
    if (!x) continue;
    const c = by.get(tid) || { s: S.byId.get(tid), list: [], pts: 0 };
    c.list.push(x);
    c.pts += ({ 5: 10, 4: 6, 3: 3, 2: 1 }[x.stars] || 1) + (x.transfer ? 0 : Math.max(0, (60 - x.rank) / 30));
    by.set(tid, c);
  }
  const list = [...by.values()].filter(c => c.s).sort((a, b) => b.pts - a.pts);
  list.forEach((c, i) => { c.rank = i + 1; c.list.sort((a, b) => b.stars - a.stars || a.rank - b.rank); });
  return list;
}

// All-American Showcase: the top 20 of the class, East (the 10 from
// furthest east) vs West. A made-up game from their ratings.
export function playShowcase(M, cls) {
  const r = rngOf(M.seed ^ 0x2545f491);
  const top = cls.hs.slice(0, 20).sort((a, b) => b.p.loc.y - a.p.loc.y);
  const sides = [top.slice(0, 10), top.slice(10)];
  const box = {};
  const totals = sides.map(side => {
    const str = side.reduce((a, x) => a + x.lv, 0) / side.length;
    const target = Math.round(108 + (str - 55) * 0.6 + gauss(r) * 9);
    const w = side.map(x => Math.max(0.2, (x.lv - 30) / 10 + r() * 2));
    const ws = w.reduce((a, v) => a + v, 0);
    let pts = 0;
    side.forEach((x, i) => {
      const g = GROUP(x.p);
      const p = Math.max(0, Math.round((target * w[i]) / ws + gauss(r) * 2));
      pts += p;
      const fga = Math.max(p ? 1 : 0, Math.round(p / (1.15 + r() * 0.35)));
      box[x.id] = {
        min: Math.round(12 + (w[i] / ws) * 120 + r() * 4), pts: p,
        reb: Math.max(0, Math.round((g === 'Bigs' ? 6 : g === 'Wings' ? 3.5 : 2) + gauss(r) * 2)),
        ast: Math.max(0, Math.round((g === 'Guards' ? 4.5 : g === 'Wings' ? 2 : 1) + gauss(r) * 1.6)),
        fgm: Math.round(fga * (0.45 + r() * 0.15)), fga,
      };
    });
    return pts;
  });
  if (totals[0] === totals[1]) { const x = sides[0][0]; box[x.id].pts += 2; totals[0] += 2; }
  const win = totals[0] > totals[1] ? 0 : 1;
  const mvp = sides[win].reduce((a, x) => (box[x.id].pts + box[x.id].reb + box[x.id].ast > box[a.id].pts + box[a.id].reb + box[a.id].ast ? x : a));
  M.showcase = { east: sides[0].map(x => x.id), west: sides[1].map(x => x.id), score: totals, box, mvp: mvp.id };
  return M.showcase;
}

// Signing Day results into the save: every signing onto its roster, and the
// game's own recruiting cleared (its pool and offers).
// Safe to run again on a fresh load of the same save.
export function applySignings(data, li, M, cls) {
  const C = data.seasonLeagues[li];
  const T = new Map(C.teams.map(t => [t.id, t]));
  const on = new Set(C.teams.flatMap(t => t.roster.map(p => p.id)));
  const added = [];
  const order = Object.entries(M.commit).map(([rid, tid]) => [cls.byId.get(+rid), T.get(tid)]).filter(([x, t]) => x && t).sort((a, b) => a[0].rank - b[0].rank);
  for (const [x, t] of order) {
    if (on.has(x.id) || t.roster.length >= ROSTER_MAX) continue;
    const sal = clamp(Math.round(M.offers[x.id]?.[t.id] || 1), 1, 12);
    signToSchool(C, li, t, x.p, { sal });
    added.push(x.p);
  }
  // The game's showcase is left alone (it has already been played), but its
  // recruit pool goes: news and posts that point at those recruits go with
  // it, or the game draws a missing player in the news box.
  const gone = new Set((C.freeAgents || []).map(p => p.id).filter(id => !on.has(id) && !added.some(p => p.id === id)));
  if (gone.size) for (const k of ['news', 'posts']) if (Array.isArray(C.season[k])) C.season[k] = C.season[k].filter(n => !gone.has(n.pid));
  C.freeAgents = [];
  C.contractOffers = [];
  C.meta.uPID = Math.max(C.meta.uPID || 0, cls.maxId);
  M.applied = true;
  return added;
}
