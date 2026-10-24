// Ego: how much a player needs to be the man. Read from his career (not stored in the save): how good he is, what
// he's won, how much of the offense he's carried, his age, and a lean from his traits. 1..20, 10 is ordinary.
// 🎭 Alpha (15+) wants the ball, the spotlight and the money that says so; Humble (6 or less) takes whatever role helps.
import { tr, traitsSet } from './traits.js';
import { seasonLine } from './storylines.js';
import { shownLevel as levelOf } from './regression.js';

export const EGO = { icon: '🎭', hi: 'Alpha', lo: 'Humble', hiIcon: '🎭', loIcon: '🙏' };
const AW = { FMVP: 1, MVP: 2, ALL_NBA: 13 };
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
  if (REAL_EGO[name] != null) return { v: REAL_EGO[name], why: ['his reputation around the league'] };
  const why = [];
  let v = 9.5 + salt(p.id) * 3;
  const lv = levelOf(p);
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
  // Only the reasons that pushed him the way he landed ('-' marks one that pulls toward Humble).
  const out = Math.max(1, Math.min(20, Math.round(v))), down = out < 10;
  const keep = why.filter(w => w.startsWith('-') === down).map(w => w.replace(/^-/, ''));
  return { v: out, why: keep.length ? keep : ['nothing stands out'] };
}
export const egoVal = p => egoRead(p).v;
export const isAlpha = p => egoVal(p) >= 15;
export const isHumble = p => egoVal(p) <= 6;
export const egoTag = p => { const v = egoVal(p); return v >= 15 ? `${EGO.hiIcon} ${EGO.hi}` : v <= 6 ? `${EGO.loIcon} ${EGO.lo}` : ''; };
// How much he cares about his role in free agency: an Alpha about 1.6×, a Humble one about 0.6×.
export const roleWeight = p => { const v = egoVal(p); return v >= 15 ? 1.6 : v <= 6 ? 0.6 : 1 + (v - 10) * 0.08; };
