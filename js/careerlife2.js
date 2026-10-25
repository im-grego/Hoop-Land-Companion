// Career mode, round two: life off the court, the team around him, contract terms, the season ahead and what comes
// after. Pure reads and plans; the app applies them.
import { playerName } from './savefile.js';
import { shownLevel as levelOf } from './regression.js';
import { tr } from './traits.js';
import { egoVal } from './ego.js';
import { seasonLine } from './storylines.js';
import { trophies, careerLog, rankIdx } from './career.js';

const roll = (seed, n) => (((Math.imul(seed + n * 7919, 2654435761) ^ (seed >>> 7)) >>> 0) % 10000) / 10000;
const lastLine = p => { const l = careerLog(p); return l[l.length - 1]?.l || null; };

// ---------------------------------------------------------------------------
// 1. Life events: one a summer, with a choice. fx as in careerlife (fans, ego, coach, morale, mates) plus coins
// and attr (+1 to his roomiest skill); gamble: [odds, fx if it goes well, fx if not].
export function lifeEvent(p, seed) {
  const pool = [];
  if (p.age >= 24) pool.push(['baby', 3]);
  pool.push(['homecoming', 3], ['viral', 3], ['legal', 1]);
  const total = pool.reduce((s, x) => s + x[1], 0);
  let r = roll(seed, 1) * total, k = pool[0][0];
  for (const [x, w] of pool) { if ((r -= w) < 0) { k = x; break; } }
  return { k, ...LIFE[k] };
}
const LIFE = {
  baby: { icon: '👶', text: 'Your first child was born this summer.', a: [
    { t: 'Take the summer with family', fx: { morale: 10, ego: -1 } },
    { t: 'Back in the gym in a week', fx: { morale: -3, attr: 1 } }] },
  homecoming: { icon: '🏡', text: 'Your hometown is throwing you a parade.', a: [
    { t: 'Throw a block party for everyone', fx: { fans: 0.04, coins: -30, morale: 4 } },
    { t: 'Keep it low-key with family', fx: { morale: 6 } }] },
  viral: { icon: '📱', text: 'A clip of you went viral: millions of views overnight.', a: [
    { t: 'Lean into it', fx: { fans: 0.08, ego: 1 } },
    { t: 'Stay humble', fx: { fans: 0.02, coach: 2 } }] },
  legal: { icon: '⚖️', text: 'A lawsuit from an old business partner hit the news.', a: [
    { t: 'Settle quietly', fx: { coins: -150, fans: -0.01 } },
    { t: 'Fight it in court', gamble: [0.5, { fans: 0.02, morale: 3 }, { fans: -0.08, morale: -8 }] }] },
};

// ---------------------------------------------------------------------------
// 2. Investments: coins in this summer, settled next summer. Each kind has its own risk.
export const INVEST = {
  restaurant: { icon: '🍽️', label: 'Restaurant', says: 'Steady if it works: most do. Some close.', outcomes: [[0.7, 1.25], [0.3, 0.6]] },
  startup: { icon: '🚀', label: 'Tech startup', says: 'Could triple. Could go to zero.', outcomes: [[0.3, 3], [0.3, 1], [0.4, 0]] },
  realestate: { icon: '🏢', label: 'Real estate', says: 'Slow and safe.', outcomes: [[0.9, 1.1], [0.1, 0.8]] },
};
export const STAKES = [50, 100, 250];
export function settleInvest(k, amt, seed) {
  let r = roll(seed, 3);
  for (const [w, m] of INVEST[k].outcomes) { if ((r -= w) < 0) return { mult: m, back: Math.round(amt * m) }; }
  return { mult: 1, back: amt };
}

// ---------------------------------------------------------------------------
// 3. Foundation: gifts of coins for fans and the room; 500 in all earns the community award.
export const GIFTS = [[50, 0.01, 'a youth clinic'], [150, 0.03, 'a summer camp'], [400, 0.06, 'a community center']];
export const FOUNDATION_AWARD = 500;

// ---------------------------------------------------------------------------
// 4. Nickname and signature move: earned by a big season.
const MOVES = { TPT: 'the step-back three', DNK: 'the tomahawk', LAY: 'the Euro step', MID: 'the fadeaway', INS: 'the dream shake', DRB: 'the killer crossover', PAS: 'the no-look dime', STL: 'the pickpocket', BLK: 'the chase-down block', DRE: 'the outlet', ORE: 'the putback' };
// Full nicknames by his best skill ({f} first name, {l} last name, {i} first initial).
const NICK = {
  TPT: ['Splash', 'The Rainmaker', 'The Flamethrower', 'Logo {l}', 'Deep {f}', 'Range Rover', '{i}-Splash', 'The Microwave', 'Chef {l}', 'Downtown {f}', 'The Sniper', 'Bombs Away', 'Heat Check', 'Limitless'],
  DNK: ['Air {l}', 'The Human Highlight', 'Skywalker', 'Rim Wrecker', 'Flight {l}', 'Thunder', 'The Jetpack', 'Poster {f}', 'Sky {l}', 'The Hammer', 'Vertical Limit', 'Liftoff'],
  LAY: ['Silk', 'The Glider', 'Smooth Operator', 'The Magician', 'Butter', 'The Escape Artist', 'Slick {f}', 'Smoke', 'Finger Roll {f}', 'The Ghost'],
  MID: ['Mr. Clutch', 'The Ice Man', 'Money {l}', 'The Closer', 'Cold Blooded', 'Automatic', 'The Professor', 'Cash {f}', 'The Executioner', 'Pull-Up {f}'],
  INS: ['The Dream', 'Big Fella', 'The Bully', 'Brick House', 'Block Party', 'Post Office', 'Big Body {l}', 'The Hook', 'Low Post {f}'],
  DRB: ['Ankle Breaker', 'The Professor', 'Mixtape', 'Yo-Yo', 'Shake {l}', 'Crossover King', 'Shifty {f}', 'Wiggle', 'Handles', 'The Puppeteer'],
  PAS: ['The Maestro', 'Point God', 'Magic {l}', 'The Conductor', 'Floor General', 'Dime Dropper', 'The Quarterback', 'No-Look {f}', 'Vision', 'The Architect'],
  STL: ['The Glove', 'The Pickpocket', 'Sticky Fingers', 'The Burglar', 'Clamps', 'The Bandit', 'Swipe {l}', 'Quick Hands', 'The Thief'],
  BLK: ['The Wall', 'The Eraser', 'Stop Sign', 'The Swat Team', 'Shot Doctor', 'Denied', 'Not In My House', 'The Tower', 'Rejection {l}'],
  DRE: ['Glass Cleaner', 'The Vacuum', 'Board Man', 'The Worm', 'The Mailman', 'Double-Double {f}', 'Mr. Rebound'],
  ORE: ['Putback King', 'The Motor', 'Second Chance {f}', 'Hustle {l}', 'Garbage Man', 'Energizer', 'Tip Drill'],
};
const fill = (s, p) => s.replace('{f}', p.fn).replace('{l}', p.ln).replace('{i}', p.fn[0]);
const WINNER = ['The Closer', 'Big Game {l}', 'Ice in His Veins', 'Mr. June', 'Ringmaster', 'The Finisher', 'Trophy {f}'];
const BIG = ['Big {l}', 'The Tower', 'Skyscraper', 'Mount {l}', 'Big Country'];
const SMALL = ['Little {f}', 'Pocket Rocket', 'Mighty Mouse', 'Tiny', 'Small Package'];
const SCORER = ['Bucket {f}', 'Buckets', 'Walking Bucket', 'Mr. 30', 'Microwave', 'Instant Offense'];
const ALLIT = { A: ['Air', 'Ace', 'Assassin'], B: ['Bucket', 'Big', 'Boom'], C: ['Clutch', 'Cold', 'Cash'], D: ['Dime', 'Dream', 'Deadeye'], E: ['Easy', 'Electric'], F: ['Flash', 'Fadeaway'], G: ['Glass', 'Ghost', 'Greedy'], H: ['Handles', 'Hammer', 'Hollywood'], I: ['Ice', 'Iron'], J: ['Jet', 'Jumper'], K: ['King', 'Killer'], L: ['Laser', 'Lights-Out'], M: ['Money', 'Magic', 'Microwave'], N: ['Nasty', 'No-Look'], O: ['Ocho', 'Outlaw'], P: ['Pistol', 'Prime'], R: ['Range', 'Rocket'], S: ['Splash', 'Silk', 'Smooth'], T: ['Thunder', 'Torch'], V: ['Vision', 'Velvet'], W: ['Wizard', 'Wheels', 'Wet'], Y: ['Yo-Yo'], Z: ['Zoom'] };
export function bestSkill(p) {
  return Object.keys(MOVES).filter(k => p.attributes?.[k]).sort((a, b) => p.attributes[b][0] - p.attributes[a][0])[0] || 'MID';
}
export function earnsNickname(L, p, yr) {
  const l = seasonLine(p, 0, yr), t = trophies(p);
  const has = id => (p.awards || []).some(a => a.id === id && (a.league ?? 0) === 0 && (a.yearsWon || []).includes(yr));
  return !!((l && l.ppg >= 28) || has(0) || has(2) || has(1) || (t.allNba >= 2));
}
// Every nickname that fits him: his best two skills, his name, his size, his scoring, his city, his team, his
// trophies. ctx: { city (home town), team (city name), rings, fmvp, ppg }.
export function nicknamePool(p, ctx = {}) {
  const skills = Object.keys(MOVES).filter(x => p.attributes?.[x]).sort((a, b) => p.attributes[b][0] - p.attributes[a][0]);
  const out = new Set();
  for (const n of NICK[skills[0]] || NICK.MID) out.add(fill(n, p));
  for (const n of (NICK[skills[1]] || []).slice(0, 5)) out.add(fill(n, p));
  for (const nm of [p.fn, p.ln]) for (const a of ALLIT[nm?.[0]?.toUpperCase()] || []) out.add(`${a} ${nm}`);
  if (p.ht >= 84) for (const b of BIG) out.add(fill(b, p));
  if (p.ht <= 74) for (const b of SMALL) out.add(fill(b, p));
  if ((ctx.ppg || 0) >= 25) for (const b of SCORER) out.add(fill(b, p));
  if (ctx.rings || ctx.fmvp) for (const w of WINNER) out.add(fill(w, p));
  const city = (ctx.city || '').split(',')[0].trim();
  if (city) { out.add(`The Pride of ${city}`); out.add(`${city}'s Own`); }
  if (ctx.team) { out.add(`King of ${ctx.team}`); out.add(`Mr. ${ctx.team}`); }
  out.add(`${p.fn[0]}${p.ln[0]}`); out.add(`${p.ln[0]}-${['Train', 'Money', 'Dawg', 'Time'][p.id % 4]}`);
  return [...out];
}
// Three to choose from, stable for the season.
export function nicknameOptions(p, seed, ctx = {}) {
  const pool = nicknamePool(p, ctx), out = [];
  for (let i = 0; out.length < 3 && i < 60; i++) { const n = pool[Math.floor(roll(seed, 20 + i) * pool.length)]; if (!out.includes(n)) out.push(n); }
  return out.map(nick => ({ nick, move: MOVES[bestSkill(p)] }));
}
export function nicknameFor(p, seed, ctx) { return nicknameOptions(p, seed, ctx)[0]; }

// ---------------------------------------------------------------------------
// 5. Teammate asks: one a summer. { kind, m, text, yes: { t, bond, fx }, no: { t, bond, fx } }
export function teammateAsk(L, p, team, seed, inFA) {
  if (!team) return null;
  const mates = team.roster.filter(x => x.id !== p.id && x.status === 3);
  const asks = [];
  const deal = mates.filter(m => m.contract?.yrs === 1 && levelOf(m) >= 75).sort((a, b) => levelOf(b) - levelOf(a))[0];
  if (deal) asks.push({ kind: 'deal', m: deal, text: `${playerName(deal)} is in the last year of his deal and wants you to back him publicly.`,
    yes: { t: 'Back him: "Pay the man."', bond: 10, fx: { coach: -3, fans: 0.01 } }, no: { t: 'Stay out of it', bond: -8, fx: {} } });
  const scorer = mates.filter(m => egoVal(m) >= 13 && levelOf(m) >= levelOf(p) - 6).sort((a, b) => levelOf(b) - levelOf(a))[0];
  if (scorer) asks.push({ kind: 'shots', m: scorer, text: `${playerName(scorer)} wants more shots this year, some of them yours.`,
    yes: { t: 'Share the load', bond: 10, fx: { ego: -1, mates: 1 } }, no: { t: '"Earn them."', bond: -8, fx: { ego: 1 } } });
  if (inFA) {
    const friendOf = mates.map(m => ({ m, f: L.teams.flatMap(t => t.roster).concat(L.freeAgents || []).find(x => x.id !== p.id && (x.status === 4 || x.status === 5) && levelOf(x) >= 70 && x.tid !== team.id && (x.season?.relationship || 0) >= 0 && Math.abs((x.age || 0) - (m.age || 0)) <= 3 && x.ctry === m.ctry) })).find(x => x.f);
    if (friendOf) asks.push({ kind: 'recruit', m: friendOf.m, f: friendOf.f, text: `${playerName(friendOf.m)} wants you to help recruit his friend ${playerName(friendOf.f)}.`,
      yes: { t: 'Make the call', bond: 8, fx: {} }, no: { t: 'Not my job', bond: -5, fx: {} } });
  }
  return asks.length ? asks[Math.floor(roll(seed, 9) * asks.length)] : null;
}

// ---------------------------------------------------------------------------
// 6. Summer runs, and a team trip when a teammate's home is in Europe, South America or Australia.
const EUROPE = ['GR', 'RS', 'FR', 'LT', 'ES', 'FI', 'LV', 'TR', 'HR', 'SI', 'IT', 'UK', 'GB', 'DE', 'PL', 'BE', 'CH', 'AT', 'UA', 'HU', 'CZ', 'SK', 'SE', 'NO', 'DK', 'NL', 'PT', 'IE', 'ME', 'BA', 'MK', 'BG', 'RO', 'EE', 'GE', 'IS', 'BY', 'RU', 'LU', 'AL', 'XK'];
const SOUTH_AMERICA = ['AR', 'BR', 'UY', 'VE', 'CL', 'CO', 'PE', 'EC', 'PY', 'BO'];
const OCEANIA = ['AU', 'NZ'];
const COUNTRY = { GR: 'Greece', RS: 'Serbia', FR: 'France', LT: 'Lithuania', ES: 'Spain', FI: 'Finland', LV: 'Latvia', TR: 'Turkey', HR: 'Croatia', SI: 'Slovenia', IT: 'Italy', UK: 'England', GB: 'England', DE: 'Germany', PL: 'Poland', BE: 'Belgium', CH: 'Switzerland', AT: 'Austria', UA: 'Ukraine', HU: 'Hungary', CZ: 'Czechia', SE: 'Sweden', NL: 'the Netherlands', PT: 'Portugal', ME: 'Montenegro', BA: 'Bosnia', AR: 'Argentina', BR: 'Brazil', UY: 'Uruguay', VE: 'Venezuela', CL: 'Chile', CO: 'Colombia', AU: 'Australia', NZ: 'New Zealand' };
export const tripRegion = c => (EUROPE.includes(c) ? 'Europe' : SOUTH_AMERICA.includes(c) ? 'South America' : OCEANIA.includes(c) ? 'Australia' : null);
export const countryName = c => COUNTRY[c] || c;
export const RUN_COST = 60, TRIP_COST = 180;
export function tripHosts(p, team) {
  if (!team) return [];
  return team.roster.filter(m => m.id !== p.id && m.status === 3 && tripRegion(m.ctry)).sort((a, b) => levelOf(b) - levelOf(a)).slice(0, 3);
}
// What a young teammate picks up from his runs: his best habit trait.
export function runLesson(p) {
  return ['motor', 'lockerRoom', 'winning'].sort((a, b) => tr(p, b) - tr(p, a))[0];
}

// ---------------------------------------------------------------------------
// 7. Training camp battle: someone's pushing for his spot.
export function campOdds(p, rival) {
  return Math.max(0.15, Math.min(0.85, 0.5 + (levelOf(p) - levelOf(rival)) * 0.06 + (tr(p, 'motor') - 10) * 0.02));
}

// ---------------------------------------------------------------------------
// 8. Trade rumors: when the buzz is high, a team gets named.
export function tradeRumor(L, p, team, buzz, seed) {
  if (!team || p.status !== 3 || buzz < 0.12 || roll(seed, 11) > buzz * 2.2) return null;
  const others = L.teams.filter(t => t.id !== team.id);
  const t = others[Math.floor(roll(seed, 12) * others.length)];
  return { tid: t.id, text: `Sources: the ${t.shortName} have called about ${playerName(p)}.` };
}

// ---------------------------------------------------------------------------
// 9. Contract terms: a no-trade clause or an All-Star bonus, each paid for out of the salary.
export const TERMS = { ntc: { label: 'No-trade clause', cut: 0.08 }, bonus: { label: 'All-Star bonus (150 coins a selection)', cut: 0.05, coins: 150 } };
export const withTerms = (sal, terms) => Math.max(1, Math.round(sal * (1 - (terms?.ntc ? TERMS.ntc.cut : 0) - (terms?.bonus ? TERMS.bonus.cut : 0))));

// ---------------------------------------------------------------------------
// 10. Hometown: the team closest to where he grew up.
export function hometownTeam(L, p) {
  if (!p.loc || p.loc.x == null) return null;
  const d = t => (t.location ? Math.hypot(t.location.x - p.loc.x, t.location.y - p.loc.y) : Infinity);
  const t = [...L.teams].sort((a, b) => d(a) - d(b))[0];
  return t && d(t) < 2500 ? t : null;
}

// ---------------------------------------------------------------------------
// 11. Agent trust: 0-100, starts at 60. Overrule him and it falls; at 20 or less he walks.
export const TRUST_START = 60, TRUST_WALK = 20;

// ---------------------------------------------------------------------------
// 12. Award race: where he'd stand in each race, from the league's best (val: trade value) and the right stats.
export function awardRace(L, p, val) {
  const ps = L.teams.flatMap(t => t.roster).filter(x => x.status === 3 || x.status === 2);
  // This season once it's 20 games old (the All-Star break), last season before that.
  const cur = L.season.currentYear, yr = (seasonLine(p, 0, cur)?.gp || 0) >= 20 ? cur : Math.max(...careerLog(p).filter(x => x.y < cur).map(x => x.y), 0);
  const prod = x => { const l = seasonLine(x, 0, yr); return l ? l.gs * Math.min(1, l.gp / 50) : 0; };
  const mvp = x => levelOf(x) * 2 + prod(x) * 3;
  const def = x => ['STL', 'BLK', 'DRE'].reduce((s, k) => s + (x.attributes?.[k]?.[0] || 0), 0) + levelOf(x) * 0.3;
  const rank = f => [...ps].sort((a, b) => f(b) - f(a)).findIndex(x => x.id === p.id) + 1;
  const odds = (r, cut, top) => (r <= top ? Math.max(0.05, Math.min(0.9, 1 - (r - 1) / (cut * 1.2))) : r <= cut ? Math.max(0.05, 0.5 - (r - top) / (cut * 2)) : 0.02);
  const m = rank(mvp), a = rank(mvp), d = rank(def);
  return [
    { k: 'mvp', label: 'MVP', rank: m, odds: m === 1 ? 0.35 : m <= 3 ? 0.15 : m <= 6 ? 0.05 : 0.01 },
    { k: 'allstar', label: 'All-Star', rank: a, odds: odds(a, 30, 18) },
    { k: 'allnba', label: 'All-NBA', rank: a, odds: odds(a, 20, 10) },
    { k: 'dpoy', label: 'Defensive Player of the Year', rank: d, odds: d === 1 ? 0.3 : d <= 3 ? 0.12 : d <= 8 ? 0.04 : 0.01 },
  ];
}

// ---------------------------------------------------------------------------
// 13. Rookie and vet duties.
export const isRookie = p => (p.yrs ?? 0) <= 1;
export const isVet = p => p.age >= 30;

// ---------------------------------------------------------------------------
// 14. After the career: broadcaster, front office or coaching (coaching writes him into the coach pool).
export const AFTER = {
  broadcast: { icon: '🎙️', label: 'Broadcaster', says: 'The studio show. Your fans follow you to TV.' },
  office: { icon: '💼', label: 'Front office', says: 'A seat in the front office of your last team.' },
  coach: { icon: '📋', label: 'Coaching', says: 'Start on the sidelines: you join the coach pool, and teams can hire you.' },
};
// A coach built from his career: development from how coachable he was, motivation from his motor, leadership from
// his locker room; ceilings by how big a name he was. Template: a coach in the save with no games coached (for the
// fields the game wants, a clean career line among them).
export const coachTemplate = L => (L.coaches || []).find(c => c.attributes && c.career?.season && !c.career.season.GP) || (L.coaches || [])[0] || null;
export function coachFromPlayer(L, p, template) {
  const c = structuredClone(template);
  const ids = [...(L.coaches || []), ...L.teams.flatMap(t => t.frontOffice?.staff || [])].map(x => x.id || 0);
  const r = rankIdx(p), at = (k, lo) => Math.max(lo, Math.min(20, Math.round(tr(p, k) * 0.7 + r * 0.8)));
  Object.assign(c, { id: Math.max(0, ...ids) + 1, tid: 0, fn: p.fn, ln: p.ln, tag: p.tag || '', home: p.home, ctry: p.ctry, loc: p.loc, age: p.age + 1, ht: p.ht, wt: p.wt, yrs: 0, gender: p.gender ?? 0,
    pos: 1, status: 3, retiring: false, yearRetired: 0, rp: 0, rpEarned: 0, tradeRequested: false, following: false, causeOfDeath: 0,
    awards: [], pot: Math.max(4, Math.min(10, 4 + Math.round(r * 0.7))) });
  c.attributes = { development: [at('roadWarrior', 4), Math.min(20, at('roadWarrior', 4) + 6)], motivation: [at('motor', 4), Math.min(20, at('motor', 4) + 6)], leadership: [at('lockerRoom', 4), Math.min(20, at('lockerRoom', 4) + 6)] };
  c.contract = { tid: 0, pid: 0, type: 0, yrs: 0, sal: 0, nil: 0, opt: 0, noTrd: 0, canExt: true, ext: { yrs: 0, sal: 0, opt: 0, noTrd: 0 } };
  // His face: the template's appearance fields, filled from his.
  for (const k of Object.keys(c.appearance || {})) if (p.appearance?.[k] !== undefined) c.appearance[k] = structuredClone(p.appearance[k]);
  return c;
}

// ---------------------------------------------------------------------------
// 15. Jersey nights: the teams where his number has a case (the app's iconCase decides).
