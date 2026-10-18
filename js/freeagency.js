// Free agency, days 1–3: asking prices, player motivations, CPU bidding
// wars, decisions, and signings written the way the game writes them.
//
// The market: players with expiring deals (status 4, still listed on their
// old team) and unsigned free agents (status 5, league.freeAgents).
// Day 1: open market (cap space; a player's old team can go over the cap to
// re-sign them). Day 2: adds the mid-level exception (one per team over the
// cap, up to $15M for 1–2 years with an option). Day 3: adds $3M one-year
// veteran minimums, and asking prices drop (most for veterans).
//
// Contract options: opt 1 = team option, opt 2 = player option.

import { tr, traitsSet } from './traits.js';
import { jerseyNumber, playerName } from './savefile.js';
import { seasonLine } from './storylines.js';
import { playerValue, fairSalary } from './trades.js';
import { levelOf } from './savefile.js';
import { teamRecord } from './draft.js';

export const STATUS_SIGNED = 3, STATUS_EXPIRING = 4, STATUS_FREE = 5, STATUS_DRAFTED = 2;
export const OPT_NONE = 0, OPT_TEAM = 1, OPT_PLAYER = 2;

export const FA_DEFAULTS = {
  rosterMax: 18,                     // offseason limit (a few extra before cuts)
  seasonMax: 15,                     // final cuts get every team here
  cpuRosterMax: 17,                  // CPU teams stop adding here
  mle: 15, mleMaxYears: 2,
  vetMin: 3, vetMinAge: 30, vetYears: 10,
  minSalary: 2,
  maxYears: 5, birdMaxYears: 5,
  askDrop: [1, 0.9, 0.75],          // asking price by day
  vetAskDrop: 0.85,                  // extra on day 3 for 30+
  acceptPct: [0.92, 0.85, 0.75],     // lowest offer (vs ask) a player takes, by day
  cpuOverbid: 0.08,                  // CPU opening bids: ask × (1 ± this)
  cpuRaise: 0.1,                     // a raise round adds up to this much
  cpuMaxOverAsk: 1.3,                // CPU teams won't pay more than ask × this
};

export const MOTIVES = {
  greed: { icon: '💰', name: 'Money', text: 'chasing the biggest deal' },
  security: { icon: '🛡️', name: 'Security', text: 'wants the most years' },
  control: { icon: '🎛️', name: 'Control', text: 'wants a player option' },
  contender: { icon: '🏆', name: 'Contender', text: 'wants to win now' },
  role: { icon: '⏱️', name: 'Role', text: 'wants minutes and a bigger role' },
};

const hash = (a, b) => { let h = (a * 2654435761 ^ b * 40503) >>> 0; h ^= h >>> 13; h = Math.imul(h, 1274126177) >>> 0; return (h >>> 0) / 4294967296; };
const lastYear = league => Math.max(...league.teams.map(t => teamRecord(t).yr || 0));

// ---------------------------------------------------------------------------
// Market, payroll, asks

export function marketPlayers(league) {
  const out = [];
  for (const t of league.teams) for (const p of t.roster) if (p.status === STATUS_EXPIRING) out.push({ p, from: t });
  for (const p of league.freeAgents || []) if (p.status === STATUS_FREE) out.push({ p, from: null });
  return out;
}

export const signedRoster = team => team.roster.filter(p => p.status === STATUS_SIGNED || p.status === STATUS_DRAFTED);
export const payroll = team => signedRoster(team).reduce((s, p) => s + (p.contract?.sal || 0), 0);
// Dead money (cut players still being paid) is tracked by the app; set per
// team for the coming season.
let DEAD = new Map();
export function setDeadMoney(map) { DEAD = new Map(Object.entries(map || {}).map(([k, v]) => [+k, v])); }
export const deadMoney = team => DEAD.get(team.id) || 0;
export const capSpace = (league, team) => league.season.salaryCap - payroll(team) - deadMoney(team);

// Max salary by years in the league (the save's maxContract, % of the cap).
export function maxSalary(league, p) {
  const tiers = league.season.maxContract || [25, 30, 35];
  const pct = p.yrs >= 10 ? tiers[2] : p.yrs >= 7 ? tiers[1] : tiers[0];
  return Math.round(league.season.salaryCap * pct / 100);
}

// Asking salary ($M per year) from last season's production, youth and upside.
export function baseAsk(league, p, o = FA_DEFAULTS) {
  const l = seasonLine(p, 0, lastYear(league));
  const gs = l ? l.gs * Math.min(1, l.gp / 40) : 0;
  let ask = 2 * (gs - 8);
  if (p.age <= 25) ask += Math.max(0, p.pot - 6) * 2;
  if (p.age > p.regressionAge) ask *= Math.max(0.5, 1 - 0.1 * (p.age - p.regressionAge));
  return Math.max(o.minSalary, Math.min(maxSalary(league, p), Math.round(ask)));
}

export function askFor(league, p, day, o = FA_DEFAULTS) {
  let a = baseAsk(league, p, o) * o.askDrop[Math.min(2, day - 1)];
  if (day >= 3 && isVet(p, o)) a *= o.vetAskDrop;
  // Veterans still open above the veterans' minimum; they can be talked down.
  return Math.max(isVet(p, o) ? o.vetMin + 1 : o.minSalary, Math.round(a));
}

// What a player wants most (stable per player and season).
export function motiveOf(league, p) {
  const r = hash(p.id, league.season.currentYear);
  // With traits: the strongest pull wins (money → greed and control,
  // winning → contender, motor and youth → role, injury worry → security).
  if (traitsSet(p)) {
    const w = {
      greed: tr(p, 'money') * 1.1,
      contender: tr(p, 'winning') * (p.age >= 30 ? 1.2 : 0.9),
      role: tr(p, 'motor') * 0.6 + (p.age <= 27 ? 4 : 0),
      security: (21 - tr(p, 'durability')) * 0.5 + (p.age >= 31 ? 4 : 0) + 3,
      control: tr(p, 'money') * 0.5 + (p.age <= 29 ? 3 : 0),
    };
    for (const k of Object.keys(w)) w[k] += hash(p.id * 7 + k.length, league.season.currentYear) * 4;
    return Object.entries(w).sort((a, b) => b[1] - a[1])[0][0];
  }
  const l = seasonLine(p, 0, lastYear(league));
  const star = l && l.gs >= 20;
  const table = p.age >= 31 ? [['contender', 0.5], ['security', 0.2], ['greed', 0.15], ['role', 0.15]]
    : star ? [['greed', 0.35], ['control', 0.3], ['contender', 0.2], ['security', 0.15]]
    : p.age <= 25 ? [['security', 0.3], ['role', 0.3], ['greed', 0.25], ['control', 0.15]]
    : [['greed', 0.3], ['role', 0.3], ['security', 0.25], ['contender', 0.15]];
  let acc = 0;
  for (const [k, w] of table) { acc += w; if (r < acc) return k; }
  return table[0][0];
}

// ---------------------------------------------------------------------------
// How a player rates an offer

// Team strength 0..1: last season's record and its best players.
export function teamStrength(league, team) {
  const r = teamRecord(team, lastYear(league));
  const ly = lastYear(league);
  const top = signedRoster(team).map(p => playerValue(p, 0, ly)).sort((a, b) => b - a).slice(0, 3);
  const talent = Math.min(1, top.reduce((s, v) => s + v, 0) / 220);
  return 0.6 * (r.pct || 0) + 0.4 * talent;
}

// Role 0..1: where the player would rank on the team's signed roster.
export function roleFit(league, team, p) {
  const ly = lastYear(league);
  const v = playerValue(p, 0, ly);
  const rank = signedRoster(team).filter(x => x !== p && playerValue(x, 0, ly) > v).length + 1;
  return rank <= 3 ? 1 : rank <= 5 ? 0.75 : rank <= 8 ? 0.5 : 0.2;
}

// Score of an offer { tid, sal, yrs, opt } for player p.
export function offerScore(league, p, offer, ask, motive, oldTid = null, discounted = false) {
  const team = league.teams.find(t => t.id === offer.tid);
  const w = { greed: 1, security: 0.15, control: 0.12, contender: 0.25, role: 0.25 };
  w[motive] = motive === 'greed' ? 2 : w[motive] * 3;
  // A veteran taking a discount cares about what they're chasing, not a
  // couple of million more.
  if (discounted) w.greed = 0.3;
  const money = offer.sal / Math.max(1, ask);
  const years = motive === 'control' ? (offer.yrs <= 3 ? 0.5 : 0) : (offer.yrs - 1) / 4;
  const option = offer.opt === OPT_PLAYER ? 1 : offer.opt === OPT_TEAM ? -0.5 : 0;
  return w.greed * money + w.security * years + w.control * option +
    w.contender * teamStrength(league, team) + w.role * roleFit(league, team, p) + (offer.tid === oldTid ? 0.05 + Math.max(0, tr(p, 'loyalty') - 10) * 0.04 : 0);
}

export function why(motive, offer, strength = 1) {
  const m = MOTIVES[motive];
  if (motive === 'contender' && strength < 0.5) return `${m.icon} took the best offer left`;
  if (motive === 'greed') return `${m.icon} took the money ($${offer.sal * offer.yrs}M)`;
  if (motive === 'security') return `${m.icon} got ${offer.yrs} years of security`;
  if (motive === 'control') return `${m.icon} ${offer.opt === OPT_PLAYER ? 'got the player option' : 'wanted control'}`;
  if (motive === 'contender') return `${m.icon} chose a contender`;
  return `${m.icon} was promised a bigger role`;
}

// ---------------------------------------------------------------------------
// Rules for what a team can offer today

// The kinds of offers a team can make to p today. Returns
// { space, bird, mle, vetMin } (booleans) and the max salary allowed.
export function offerRoom(league, team, p, day, used = {}, o = FA_DEFAULTS) {
  const space = Math.max(0, capSpace(league, team));
  const bird = p.status === STATUS_EXPIRING && p.tid === team.id;
  const full = signedRoster(team).length >= o.rosterMax;
  const mle = day >= 2 && !used.mle?.has(team.id) && capSpace(league, team) < o.mle;
  const min = minOk(p);
  let max = bird ? maxSalary(league, p) : Math.min(maxSalary(league, p), space);
  if (mle) max = Math.max(max, o.mle);
  if (min) max = Math.max(max, minFor(p, o));
  return { full, bird, space: space > 0, mle, min, vetMin: min && isVet(p, o), max: full ? 0 : max };
}

// Is this offer allowed? Returns null or the reason it isn't.
export function checkOffer(league, team, p, offer, day, used = {}, o = FA_DEFAULTS) {
  const room = offerRoom(league, team, p, day, used, o);
  if (room.full) return `${team.shortName} roster is full (${o.rosterMax})`;
  if (offer.sal > maxSalary(league, p)) return `Max for ${playerName(p)} is $${maxSalary(league, p)}M`;
  if (offer.yrs < 1 || offer.yrs > (room.bird ? o.birdMaxYears : o.maxYears)) return `1–${room.bird ? o.birdMaxYears : o.maxYears} years`;
  if (!room.bird && offer.yrs < 2 && isRestricted(league, p)) return 'An offer sheet runs at least 2 years';
  if (room.bird) return null;
  const space = capSpace(league, team);
  if (offer.sal <= space) return null;
  if (room.mle && offer.sal <= o.mle && offer.yrs <= o.mleMaxYears) return null;
  if (room.min && offer.sal <= minFor(p, o) && offer.yrs <= minYears(p, o)) return null;
  const tools = [`cap space $${Math.max(0, space)}M`];
  if (room.mle) tools.push(`MLE up to $${o.mle}M × ${o.mleMaxYears}`);
  if (room.min) tools.push(`${isVet(p, o) ? 'vet min' : 'minimum'} $${minFor(p, o)}M × ${minYears(p, o) > 1 ? `1–${minYears(p, o)}` : 1}`);
  return `Over the cap: ${tools.join(', ')}`;
}

// Which exception an allowed offer uses ('space' | 'bird' | 'mle' | 'min' | 'vetMin').
export function offerKind(league, team, p, offer, day, used = {}, o = FA_DEFAULTS) {
  const room = offerRoom(league, team, p, day, used, o);
  if (room.bird) return 'bird';
  if (offer.sal <= capSpace(league, team)) return 'space';
  if (room.mle && offer.sal <= o.mle) return 'mle';
  return isVet(p, o) ? 'vetMin' : 'min';
}

// ---------------------------------------------------------------------------
// CPU bidding

// How much a CPU team wants a player: value plus need at the position.
function teamWant(league, team, p, ly) {
  const groups = { guard: 0, wing: 0, big: 0 };
  const role = x => (x.pos <= 2 ? 'guard' : x.pos <= 5 ? 'wing' : 'big');
  for (const x of signedRoster(team)) groups[role(x)]++;
  return playerValue(p, 0, ly) + Math.max(0, 5 - groups[role(p)]) * 4;
}

// Opening CPU bids. `market` = [{ p, from, ask, motive }]. `bids` = Map pid ->
// [{ tid, sal, yrs, opt, cpu }]. User bids already in `bids` stay.
export function cpuBids(league, market, bids, day, userTeams, rng, used = {}, o = FA_DEFAULTS) {
  const ly = lastYear(league);
  const teams = league.teams.filter(t => !userTeams.has(t.id)).sort(() => rng() - 0.5);
  for (const team of teams) {
    let budget = Math.max(0, capSpace(league, team));
    let slots = o.cpuRosterMax - signedRoster(team).length;
    // Best player they can afford first, then the best value for money.
    const cost = m => m.min ?? m.ask;
    const canPay = m => m.from?.id === team.id || cost(m) <= budget * 1.05 ||
      (day >= 2 && !used.mle?.has(team.id) && cost(m) <= o.mle * 1.1) ||
      (minOk(m.p) && cost(m) <= minFor(m.p, o) * 1.5);
    // Teams cool on players who already have a crowd of suitors.
    const crowd = m => 1 + 0.15 * (bids.get(m.p.id)?.length || 0);
    const pool = market
      .map(m => ({ ...m, want: teamWant(league, team, m.p, ly) / crowd(m) }))
      .filter(m => m.want > 6 + rng() * 6 && canPay(m));
    const byWant = [...pool].sort((a, b) => b.want - a.want);
    const byValue = [...pool].sort((a, b) => b.want / Math.max(3, cost(b)) - a.want / Math.max(3, cost(a)));
    const targets = [...new Set([...byWant.slice(0, 2), ...byValue.slice(0, 2)])];
    let made = 0;
    for (const m of targets) {
      if (made >= 2) break;
      const bird = m.from?.id === team.id;
      if (slots <= 0) break;
      let sal = Math.round(m.ask * (1 + (rng() * 2 - 1) * o.cpuOverbid));
      sal = Math.max(o.minSalary, Math.min(maxSalary(league, m.p), sal));
      let yrs = m.p.age >= 31 ? 1 + Math.floor(rng() * 2) : m.p.age <= 26 ? 3 + Math.floor(rng() * 3) : 2 + Math.floor(rng() * 3);
      let offer = { tid: team.id, sal, yrs, opt: rng() < 0.2 ? OPT_PLAYER : rng() < 0.2 ? OPT_TEAM : OPT_NONE, cpu: true };
      // A veteran who'll take the minimum gets the minimum.
      if (day >= 3 && m.min === o.vetMin && isVet(m.p, o)) offer = { ...offer, sal: o.vetMin, yrs: 1, opt: OPT_NONE };
      else if (!bird && sal > budget) {
        // Fall back to an exception.
        if (day >= 2 && !used.mle?.has(team.id) && m.ask <= o.mle * 1.1) offer = { ...offer, sal: Math.min(o.mle, Math.max(sal, m.ask)), yrs: Math.min(yrs, o.mleMaxYears), opt: rng() < 0.5 ? OPT_PLAYER : OPT_TEAM };
        else if (minOk(m.p) && m.ask <= minFor(m.p, o) * 1.5) offer = { ...offer, sal: minFor(m.p, o), yrs: 1, opt: OPT_NONE };
        else continue;
      }
      if (!bird && isRestricted(league, m.p)) offer.yrs = Math.max(2, offer.yrs);
      if (checkOffer(league, team, m.p, offer, day, used, o)) continue;
      const list = bids.get(m.p.id) || [];
      if (list.some(b => b.tid === team.id)) continue;
      list.push(offer);
      bids.set(m.p.id, list);
      if (offerKind(league, team, m.p, offer, day, used, o) === 'space') budget -= offer.sal;
      slots--;
      made++;
    }
  }
}

// A raise round: CPU teams that aren't leading a player's board raise (if
// they can afford it and the player is worth it). Returns the number of raises.
export function raiseRound(league, market, bids, day, rng, used = {}, o = FA_DEFAULTS) {
  let raises = 0;
  for (const m of market) {
    const list = bids.get(m.p.id);
    if (!list || list.length < 2) continue;
    const score = b => offerScore(league, m.p, b, m.ask, m.motive, m.from?.id, m.min < m.ask * 0.75);
    const best = Math.max(...list.map(score));
    for (const b of list) {
      if (!b.cpu || score(b) >= best) continue;
      const team = league.teams.find(t => t.id === b.tid);
      const cap = Math.round(m.ask * o.cpuMaxOverAsk);
      const sal = Math.min(cap, maxSalary(league, m.p), Math.round(b.sal * (1 + o.cpuRaise * (0.5 + rng() / 2))) + 1);
      const next = { ...b, sal, yrs: m.motive === 'security' ? Math.min(o.maxYears, b.yrs + 1) : b.yrs, opt: m.motive === 'control' ? OPT_PLAYER : b.opt };
      if (sal <= b.sal || checkOffer(league, team, m.p, next, day, used, o)) continue;
      Object.assign(b, next, { raised: (b.raised || 0) + 1 });
      raises++;
    }
  }
  return raises;
}

// ---------------------------------------------------------------------------
// Restricted free agents: players given a qualifying offer. Their old team can match any offer
// sheet, and a match beats every other offer.
// Qualifying offers decided at the options deadline: pid -> true (extended,
// restricted) / false (not extended, unrestricted). No entry = restricted.
let QO = new Map();
export function setQualifyingOffers(map) { QO = new Map(Object.entries(map || {}).map(([k, v]) => [+k, v])); }
// Eligible for a qualifying offer (NBA CBA): a free agent now (deal up,
// still on his team) with 3 or fewer years in the league (the save's `yrs`),
// or a first-round pick finishing his 4-year rookie deal.
export const isRookieScale = p => p.history?.draft?.rd === 1 && (p.yrs ?? 99) <= 4;
// Minimum deals (minimum salary exception): any free agent (no one in free
// agency is still bound by a rookie-scale deal) can be offered the minimum
// any day, over the cap, as often as a team likes, for 1 or 2 years: $2M, or
// the veterans' minimum ($3M) with 10+ years in the league.
export const isVet = (p, o = FA_DEFAULTS) => (p.yrs ?? 0) >= o.vetYears;
export const minFor = (p, o = FA_DEFAULTS) => isVet(p, o) ? o.vetMin : o.minSalary;
export const minYears = () => 2;
export const minOk = p => p.status === STATUS_EXPIRING || p.status === STATUS_FREE;
export const qoEligible = (league, p) => p.status === STATUS_EXPIRING && ((p.yrs ?? 99) <= 3 || isRookieScale(p));
export function isRestricted(league, p) {
  return qoEligible(league, p) && QO.get(p.id) !== false;
}

// Would a CPU team match an offer sheet? Yes unless it's well over what the
// player is worth to them.
export function cpuMatches(league, team, p, offer, o = FA_DEFAULTS) {
  if (signedRoster(team).length >= o.rosterMax) return false;
  return offer.sal <= fairSalary(levelOf(p)) * 1.2 + 3;
}

const bestOffer = (league, m, list) => {
  const score = b => offerScore(league, m.p, b, m.ask, m.motive, m.from?.id, m.min < m.ask * 0.75);
  return [...list].sort((a, b) => score(b) - score(a))[0];
};

// Your restricted free agents whose best offer is from another team (the
// match-or-let-go decisions before players decide).
export function pendingMatches(league, market, bids, day, userTeams, used = {}, o = FA_DEFAULTS) {
  const out = [];
  for (const m of market) {
    if (!m.from || !userTeams.has(m.from.id) || !isRestricted(league, m.p)) continue;
    const list = (bids.get(m.p.id) || []).filter(b => !checkOffer(league, league.teams.find(t => t.id === b.tid), m.p, b, day, used, o));
    if (!list.length) continue;
    const best = bestOffer(league, m, list);
    if (best.tid !== m.from.id && best.sal >= (m.min ?? m.ask * o.acceptPct[Math.min(2, day - 1)])) out.push({ m, best });
  }
  return out;
}

// After the last day: anyone still on a roster without a contract (an
// expiring deal nobody re-signed) is released to the free-agent pool, so
// the game doesn't carry them into the season. Returns records for undo.
// A restricted free agent nobody signed accepts his qualifying offer: one
// year with his team at the QO amount (`qoFor(p)`), then unrestricted.
// Those signings come back in `out.qo` (records for unsignPlayer()).
export function releaseUnsigned(league, { qoFor = null, day = 3, o = FA_DEFAULTS } = {}) {
  const year = league.season.currentYear;
  const out = [];
  out.qo = [];
  for (const team of league.teams) {
    for (const p of [...team.roster]) {
      if (p.status !== STATUS_EXPIRING) continue;
      if (qoFor && isRestricted(league, p) && signedRoster(team).length < o.rosterMax) {
        const rec = signPlayer(league, p, team, { yrs: 1, sal: qoFor(p), opt: OPT_NONE }, day);
        out.qo.push({ p, team, sal: qoFor(p), rec });
        continue;
      }
      out.push(releasePlayer(league, team, p));
    }
  }
  return out;
}
// One expiring player leaves his team for the free-agent pool (you let him
// walk). Returns a record for unreleaseUnsigned([rec]).
export function releasePlayer(league, team, p) {
  const year = league.season.currentYear;
  const idx = team.roster.indexOf(p);
  const row = (p.stats || []).filter(s => s.yr === year && s.league === 0).pop();
  const stint = row?.season?.[row.season.length - 1];
  const rec = { p, team, idx, tid: p.tid, linePos: p.linePos, stintTid: stint?.tid };
  team.roster.splice(idx, 1);
  p.status = STATUS_FREE;
  p.tid = 0;
  p.linePos = -1;
  if (stint && !stint.GP) stint.tid = 0;
  league.freeAgents.push(p);
  return rec;
}
export function unreleaseUnsigned(league, recs) {
  const year = league.season.currentYear;
  for (const q of [...(recs.qo || [])].reverse()) unsignPlayer(league, q.rec);
  for (const r of [...recs].reverse()) {
    league.freeAgents.splice(league.freeAgents.indexOf(r.p), 1);
    r.team.roster.splice(r.idx, 0, r.p);
    Object.assign(r.p, { status: STATUS_EXPIRING, tid: r.tid, linePos: r.linePos });
    const row = (r.p.stats || []).filter(s => s.yr === year && s.league === 0).pop();
    const stint = row?.season?.[row.season.length - 1];
    if (stint && r.stintTid != null) stint.tid = r.stintTid;
  }
}

// ---------------------------------------------------------------------------
// Decisions and signings

// Players decide, best players first. A team's cap space shrinks as it
// signs; offers that no longer fit are dropped. Returns
// [{ p, from, offer, motive, bidders, kind, why }] and the unsigned list.
// Restricted free agents: `matches` (Map pid -> bool) holds your match
// decisions; CPU teams decide with cpuMatches().
export function decide(league, market, bids, day, used = {}, o = FA_DEFAULTS, { matches = new Map(), userTeams = new Set() } = {}) {
  const ly = lastYear(league);
  const order = [...market].sort((a, b) => playerValue(b.p, 0, ly) - playerValue(a.p, 0, ly));
  const signings = [];
  const accept = o.acceptPct[Math.min(2, day - 1)];
  for (const m of order) {
    const list = (bids.get(m.p.id) || []).filter(b => {
      const team = league.teams.find(t => t.id === b.tid);
      return !checkOffer(league, team, m.p, b, day, used, o);
    });
    if (!list.length) continue;
    const score = b => offerScore(league, m.p, b, m.ask, m.motive, m.from?.id, m.min < m.ask * 0.75);
    let best = [...list].sort((a, b) => score(b) - score(a))[0];
    if (best.sal < (m.min ?? m.ask * accept)) continue;
    // Offer sheet on a restricted free agent: the old team may match.
    let matched = false;
    if (m.from && best.tid !== m.from.id && isRestricted(league, m.p)) {
      const yes = userTeams.has(m.from.id) ? !!matches.get(m.p.id) : cpuMatches(league, m.from, m.p, best, o);
      if (yes && signedRoster(m.from).length < o.rosterMax) { best = { ...best, tid: m.from.id, cpu: !userTeams.has(m.from.id) }; matched = true; }
    }
    const team = league.teams.find(t => t.id === best.tid);
    const kind = matched ? 'bird' : offerKind(league, team, m.p, best, day, used, o);
    if (kind === 'mle') (used.mle ||= new Set()).add(team.id);
    const rec = signPlayer(league, m.p, team, best, day);
    signings.push({ p: m.p, from: m.from, team, offer: best, motive: m.motive, bidders: list.length, kind, matched,
      why: matched ? `🔒 ${team.shortName} matched the offer sheet` : why(m.motive, best, teamStrength(league, team)), rec });
  }
  return signings;
}

// Sign a player the way the game does: move to the roster, status 3,
// contract { tid, pid, yrs, sal, opt }, the new season's stats row (team,
// number, salary), a signing news item, and their pending offers removed.
// Returns a record for unsignPlayer().
export function signPlayer(league, p, team, offer, day) {
  const year = league.season.currentYear;
  const fromTeam = league.teams.find(t => t.roster.includes(p)) || null;
  const rec = {
    p, team, fromTeam, fromIdx: fromTeam ? fromTeam.roster.indexOf(p) : league.freeAgents.indexOf(p),
    status: p.status, tid: p.tid, num: p.num, linePos: p.linePos, contract: structuredClone(p.contract),
    focus: p.season?.focus, block: p.season?.onTradeBlock,
    offers: league.contractOffers.map((o, i) => [o, i]).filter(([o]) => o.pid === p.id),
  };
  if (fromTeam !== team) {
    if (fromTeam) fromTeam.roster.splice(rec.fromIdx, 1);
    else league.freeAgents.splice(rec.fromIdx, 1);
    p.num = jerseyNumber(team, p);
    p.linePos = team.roster.length;
    team.roster.push(p);
  }
  p.tid = team.id;
  p.status = STATUS_SIGNED;
  Object.assign(p.contract, { tid: team.id, pid: p.id, type: 0, yrs: offer.yrs, sal: offer.sal, opt: offer.opt || 0 });
  if (p.season) { p.season.focus = 0; p.season.onTradeBlock = 0; }
  const row = (p.stats || []).filter(s => s.yr === year && s.league === 0).pop();
  rec.row = row ? { sal: row.sal, stint: row.season?.[row.season.length - 1] && { ...row.season[row.season.length - 1] } } : null;
  if (row) {
    row.sal = offer.sal;
    const stint = row.season?.[row.season.length - 1];
    if (stint && !stint.GP) { stint.tid = team.id; stint.num = p.num; }
  }
  league.contractOffers = league.contractOffers.filter(x => x.pid !== p.id);
  const template = league.season.news.find(n => n.data?.contract) || league.season.news[0];
  if (template) {
    const n = structuredClone(template);
    Object.assign(n, { league: 0, rating: offer.sal >= 20 ? 6 : offer.sal >= 10 ? 5 : 4, date: day, phase: league.season.phase, category: 2, type: 3, tid: team.id, pid: p.id, gid: 0, read: false });
    n.data.contract = { ...structuredClone(p.contract) };
    if (n.data.draftPick) n.data.draftPick = { pk: 0, rd: 0, tid: 0, otid: 0, yr: 0 };
    league.season.news.push(n);
    rec.news = n;
  }
  return rec;
}

export function unsignPlayer(league, rec) {
  const { p, team } = rec;
  if (rec.news) league.season.news.splice(league.season.news.indexOf(rec.news), 1);
  for (const [o, i] of rec.offers) league.contractOffers.splice(i, 0, o);
  if (rec.fromTeam !== team) {
    team.roster.splice(team.roster.indexOf(p), 1);
    if (rec.fromTeam) rec.fromTeam.roster.splice(rec.fromIdx, 0, p);
    else league.freeAgents.splice(rec.fromIdx, 0, p);
  }
  Object.assign(p, { status: rec.status, tid: rec.tid, num: rec.num, linePos: rec.linePos });
  p.contract = rec.contract;
  if (p.season) { p.season.focus = rec.focus; p.season.onTradeBlock = rec.block; }
  const row = (p.stats || []).filter(s => s.yr === league.season.currentYear && s.league === 0).pop();
  if (row && rec.row) {
    row.sal = rec.row.sal;
    if (rec.row.stint) Object.assign(row.season[row.season.length - 1], rec.row.stint);
  }
}

// Build today's market rows: { p, from, ask, motive }.
// The least a player takes today. On Day 3, veterans who aren't chasing
// money take the veterans' minimum rather than sit out the season, whatever
// they were asking for.
export function minAccept(p, ask, motive, day, o = FA_DEFAULTS) {
  if (day >= 3 && isVet(p, o) && motive !== 'greed') return o.vetMin;
  return Math.max(o.minSalary, Math.round(ask * o.acceptPct[Math.min(2, day - 1)]));
}

export function buildMarket(league, day, o = FA_DEFAULTS) {
  return marketPlayers(league).map(({ p, from }) => {
    const ask = askFor(league, p, day, o), motive = motiveOf(league, p);
    return { p, from, ask, motive, min: minAccept(p, ask, motive, day, o) };
  });
}

// ---------------------------------------------------------------------------
// Final cuts (end of the offseason): every team down to `seasonMax`. Who
// goes first: the lowest level, with young players' potential and real
// money (a guaranteed salary teams would rather not eat) keeping them around.
export function cutScore(p, level, year = 0) {
  // This year's picks: teams don't cut a first-rounder they just drafted.
  const d = p.history?.draft;
  const pick = d && d.yr === year ? (d.rd === 1 ? 40 : 6) : 0;
  return cutScoreBase(p, level) + pick;
}
function cutScoreBase(p, level) {
  const young = p.age <= 24 ? Math.max(0, (p.pot || 0) - 6) * (25 - p.age) * 0.8 : 0;  // pot: half stars (10 = 5★)
  return level + young + Math.min(10, (p.contract?.sal || 0) * 0.3);
}
export function cutPlayer(league, team, p) {
  const keep = { status: p.status, contract: structuredClone(p.contract) };
  const rec = releasePlayer(league, team, p);
  Object.assign(p.contract, { tid: 0, yrs: 0, sal: 0, opt: 0, canExt: false });
  const row = (p.stats || []).filter(s => s.yr === league.season.currentYear && s.league === 0).pop();
  if (row) { rec.rowSal = row.sal; row.sal = 0; }
  return { ...rec, keep };
}
export function uncut(league, recs) {
  unreleaseUnsigned(league, recs);
  for (const r of recs) {
    r.p.status = r.keep.status;
    r.p.contract = r.keep.contract;
    const row = (r.p.stats || []).filter(s => s.yr === league.season.currentYear && s.league === 0).pop();
    if (row && r.rowSal != null) row.sal = r.rowSal;
  }
}
