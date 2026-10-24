// Ego: how much a player needs to be the man. Read from his career (not stored in the save): how good he is, what
// he's won, how much of the offense he's carried, his age, and a lean from his traits. 1..20, 10 is ordinary.
// 🎭 Alpha (15+) wants the ball, the spotlight and the money that says so; Humble (6 or less) takes whatever role helps.
import { tr, traitsSet } from './traits.js';
import { seasonLine } from './storylines.js';
import { shownLevel as levelOf } from './regression.js';
import { mindExtra } from './mindset.js';

export const EGO = { icon: '🎭', hi: 'Alpha', lo: 'Humble', hiIcon: '🎭', loIcon: '🙏' };
const AW = { FMVP: 1, MVP: 2, ALL_NBA: 13, ALL_STAR: 23 };
// Known reads for real players (ego only; everyone else is read from his career).
const REAL_EGO = {
  'Kevin Durant': 15, 'James Harden': 17, 'Russell Westbrook': 18, 'Kyrie Irving': 16, 'Jimmy Butler': 17, 'Luka Doncic': 16,
  'LeBron James': 18, 'Dillon Brooks': 16, 'Draymond Green': 16, 'Ja Morant': 17, 'Trae Young': 16, 'Joel Embiid': 15,
  'Devin Booker': 15, 'Anthony Edwards': 16, 'Damian Lillard': 14, 'Stephen Curry': 11, 'Tim Duncan': 4, 'Nikola Jokic': 3,
  'Kawhi Leonard': 7, 'Jrue Holiday': 4, 'Mikal Bridges': 5, 'Al Horford': 4, 'Derrick White': 4, 'Tyrese Haliburton': 7,
  'Jalen Brunson': 9, 'Giannis Antetokounmpo': 9, 'Shai Gilgeous-Alexander': 11, 'Chris Paul': 13, 'Kyle Lowry': 8,
};
const won = (p, id) => (p.awards || []).filter(a => a.id === id && (a.league == null || a.league === 0)).reduce((n, a) => n + (a.yearsWon || []).length, 0);
const salt = id => { let h = Math.imul(id + 97, 2654435761) >>> 0; h ^= h >>> 15; return (h % 1000) / 1000; };   // stable per player

// { v, why[] } — the score and the reasons that moved it most.
export function egoRead(p) {
  const name = `${p.fn || ''} ${p.ln || ''}`.trim();
  if (REAL_EGO[name] != null) { const b = boost(p); return finish(p, REAL_EGO[name] + b.v, [`${REAL_EGO[name] < 10 ? '-' : ''}his reputation around the league`, ...b.why]); }
  const why = [];
  let v = 9.5 + salt(p.id) * 3;
  const lv = levelOf(p);
  if (!(p.stats || []).some(s => s.league === 0 && (s.season || []).some(r => r.GP > 0))) return finish(p, v + prospectEgo(p, why), why);
  const star = lv >= 90 ? 4 : lv >= 85 ? 2.5 : lv >= 80 ? 1 : lv <= 68 ? -1 : lv <= 72 ? -0.5 : 0;
  v += star; if (star >= 2.5) why.push('a star and he knows it'); else if (star < 0) why.push('-a role player');
  const mvp = won(p, AW.MVP), fmvp = won(p, AW.FMVP), allLg = won(p, AW.ALL_NBA);
  const aw = Math.min(3, mvp * 1.5 + fmvp + allLg * 0.4);
  v += aw; if (aw >= 1.5) why.push(mvp ? `${mvp > 1 ? `${mvp}× ` : ''}MVP` : 'the trophies');
  // How much he's carried: his best scoring seasons against where his level puts him.
  const yrs = [...new Set((p.stats || []).filter(s => s.league === 0).map(s => s.yr))].sort((a, b) => b - a).slice(0, 5);
  const lines = yrs.map(y => seasonLine(p, 0, y)).filter(l => l && l.gp >= 20);
  if (lines.length) {
    const peak = Math.max(...lines.map(l => l.ppg)), share = Math.max(...lines.map(l => l.ppg / Math.max(18, l.mpg)));
    const carry = (peak >= 27 ? 2 : peak >= 22 ? 1.2 : peak >= 17 ? 0.4 : peak <= 8 ? -1 : 0) + (share >= 0.8 ? 1 : share <= 0.35 ? -0.8 : 0);
    v += carry; if (carry >= 1.5) why.push('used to having the ball'); else if (carry <= -1) why.push('-never needed the ball');
  }
  // Young stars are at their loudest; long careers sand it down.
  if (p.age <= 25 && lv >= 80) { v += 1; why.push('a young star'); }
  if (p.age >= 34) { v -= 1.5; why.push('-a veteran who has seen it all'); }
  const b = boost(p);
  v += b.v; why.push(...b.why);
  if (traitsSet(p)) {
    const lean = (tr(p, 'money') - 10) * 0.15 - (tr(p, 'lockerRoom') - 10) * 0.18 - (tr(p, 'winning') - 10) * 0.08;
    v += lean;
    if (lean >= 1.2) why.push(tr(p, 'money') >= 15 ? 'chases the money and the spotlight' : 'not a locker room guy');
    else if (lean <= -1.2) why.push(tr(p, 'lockerRoom') >= 15 ? '-a great teammate' : '-puts winning first');
  }
  return finish(p, v, why);
}
// Before his first NBA game: the hype (where he's projected to go), his college role and his awards.
function prospectEgo(p, why) {
  let v = 0;
  const add = (n, text) => { v += n; if (text) why.push(n > 0 ? text : `-${text}`); };
  if (p.pot >= 9) add(2.5, 'projected to go early and he knows it'); else if (p.pot >= 8) add(1.2, 'hears his name in the lottery talk'); else if (p.pot <= 5) add(-1, 'not one of the names');
  if (p.age <= 19 && p.pot >= 8) add(0.8, 'young and hyped');
  const cs = (p.stats || []).filter(s => s.league > 0 && (s.season || []).some(r => r.GP > 0)).sort((a, b) => b.yr - a.yr)[0];
  if (cs) {
    const l = seasonLine(p, cs.league, cs.yr);
    if (l && l.ppg >= 12) add(1.8, 'the go-to scorer in college'); else if (l && l.ppg >= 9) add(0.8, 'a featured scorer in college'); else if (l && l.gp >= 10 && l.ppg <= 4) add(-1, 'a role player in college');
    const aw = id => (p.awards || []).some(a => a.id === id && a.league > 0);
    if (aw(2)) add(2, 'a national Player of the Year'); else if (aw(16)) add(1, 'an All-American');
  }
  if (traitsSet(p)) {
    const lean = (tr(p, 'money') - 10) * 0.15 - (tr(p, 'lockerRoom') - 10) * 0.18;
    v += lean;
    if (lean >= 1.2) why.push('not a locker room guy'); else if (lean <= -1.2) why.push('-a great teammate');
  }
  return v;
}
function finish(p, v, why) {
  for (const e of mindExtra(p, 'ego')) { v += e.v; if (e.why) why.push(e.v > 0 ? e.why : `-${e.why}`); }
  // Only the reasons that pushed him the way he landed ('-' marks one that pulls toward Humble).
  const out = Math.max(1, Math.min(20, Math.round(v))), lvl = [6, 8, 11, 14, 20].findIndex(m => out <= m);
  const keep = why.filter(w => (lvl < 2 ? w.startsWith('-') : lvl > 2 ? !w.startsWith('-') : true)).map(w => w.replace(/^-/, ''));
  return { v: out, why: keep.length ? keep : ['nothing stands out'] };
}
// What swells it for now: a fresh All-NBA (or All-Star) season and a big new deal, more so when he's paid past what
// his game is worth and starts to believe it. It fades as the season ages and the deal runs down.
const lastYr = p => Math.max(0, ...(p.stats || []).filter(s => s.league === 0 && (s.season || []).some(r => r.GP > 0)).map(s => s.yr));   // last season he played (the new one's rows exist empty)
const wonIn = (p, id, yr) => (p.awards || []).some(a => a.id === id && (a.league == null || a.league === 0) && (a.yearsWon || []).includes(yr));
const worth = lv => Math.max(2, (lv - 70) * 2.6);   // about what a level is paid ($M): 80 ≈ 26, 85 ≈ 39, 90 ≈ 52
function boost(p) {
  let v = 0; const why = [], ly = lastYr(p), c = p.contract || {};
  if (ly && wonIn(p, AW.ALL_NBA, ly)) { v += 2; why.push('fresh off an All-NBA season'); }
  else if (ly && wonIn(p, AW.ALL_STAR, ly)) { v += 0.8; why.push('fresh off an All-Star season'); }
  const sal = Math.max(c.ext?.yrs ? c.ext.sal : 0, (c.yrs ?? 0) >= 3 ? c.sal : 0);   // a new deal: an extension, or 3+ years left
  if (sal >= 40) { v += 1.5; why.push('just got paid'); }
  if (sal && sal - worth(levelOf(p)) >= 12) { v += 1; why.push('thinks he is worth more than he is'); }
  return { v, why };
}
// Five levels, low to high (Alpha and Humble are the ends that change how he acts).
export const EGO_LEVELS = [
  { max: 6, icon: '🙏', label: 'Humble', says: 'takes whatever role helps' },
  { max: 8, icon: '🌱', label: 'Modest', says: 'happy to fit in' },
  { max: 11, icon: '⚖️', label: 'Balanced', says: 'wants a fair role' },
  { max: 14, icon: '😎', label: 'Proud', says: 'wants his touches and his credit' },
  { max: 20, icon: '🎭', label: 'Alpha', says: 'needs to be the man' },
];
export const egoLevel = v => EGO_LEVELS.findIndex(l => v <= l.max);   // 0..4
export const egoVal = p => egoRead(p).v;
export const isAlpha = p => egoVal(p) >= 15;
export const isHumble = p => egoVal(p) <= 6;
export const egoTag = p => { const v = egoVal(p); return v >= 15 ? `${EGO.hiIcon} ${EGO.hi}` : v <= 6 ? `${EGO.loIcon} ${EGO.lo}` : ''; };
// How much he cares about his role in free agency: an Alpha about 1.6×, a Humble one about 0.6×.
export const roleWeight = p => { const v = egoVal(p); return v >= 15 ? 1.6 : v <= 6 ? 0.6 : 1 + (v - 10) * 0.08; };
