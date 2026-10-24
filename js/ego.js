// Ego: how much a player needs to be the man. A trait (in the save's playoffRiser slot) seeded from his career: how
// good he is, what he's won, how much of the offense he's carried, his deal, his age, and a lean from his traits.
// Events move it from there. 1..20 like every trait: 🎭 Alpha (16+) wants the ball, the spotlight and the money that
// says so; 🙏 Humble (4 or less) takes whatever role helps.
import { tr, traitsSet } from './traits.js';
import { seasonLine } from './storylines.js';
import { shownLevel as levelOf } from './regression.js';

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
  if (REAL_EGO[name] != null) return finish(p, REAL_EGO[name], [`${REAL_EGO[name] < 10 ? '-' : ''}his reputation around the league`]);
  const why = [];
  let v = 10 + salt(p.id) * 3;
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
  // Only the reasons that pushed him the way he landed ('-' marks one that pulls toward Humble). The start tops out at
  // 18: a big year (an All-NBA season, a max deal) is what takes a player to 19 or 20.
  const out = Math.max(1, Math.min(18, Math.round(v))), lvl = [6, 8, 11, 14, 20].findIndex(m => out <= m);
  const keep = why.filter(w => (lvl < 2 ? w.startsWith('-') : lvl > 2 ? !w.startsWith('-') : true)).map(w => w.replace(/^-/, ''));
  return { v: out, why: keep.length ? keep : ['nothing stands out'] };
}
// Ego lives in the save's playoffRiser trait slot (1-20, like every trait): egoRead() seeds it from his career, and
// events move it (a big deal, an All-Star season, getting humbled). Alpha is 16+, Humble 4 or less.
export const EGO_KEY = 'playoffRiser';
export const egoVal = p => (p?.traits?.[EGO_KEY] > 0 ? p.traits[EGO_KEY] : egoRead(p).v);
export const isAlpha = p => egoVal(p) >= 16;
export const isHumble = p => egoVal(p) <= 4;
// How much he cares about his role in free agency: an Alpha about 1.6×, a Humble one about 0.6×.
export const roleWeight = p => { const v = egoVal(p); return v >= 16 ? 1.6 : v <= 4 ? 0.6 : 1 + (v - 10) * 0.08; };
// What he thinks he's worth: an Alpha asks about 6% more, a Humble player about 6% less.
export const egoAsk = p => { const v = egoVal(p); return v >= 16 ? 1.06 : v >= 13 ? 1.03 : v <= 4 ? 0.94 : v <= 7 ? 0.97 : 1; };
