// Confidence: how a player feels about his own game right now, read only from how he has played (never from his
// role, team or contract; that's morale). 1..20, 10 is steady. Last season against what his level should produce,
// his trend, his shot, the playoffs, a long injury and the awards he just won. It resets with each new season's results.
import { seasonLine } from './storylines.js';
import { shownLevel as levelOf } from './regression.js';

// Five levels, low to high, for confidence and for ego (ego's own scale lives in ego.js).
export const CONF_LEVELS = [
  { max: 4, icon: '🥶', label: 'Shaken', says: 'doubting his game' },
  { max: 7, icon: '😬', label: 'Unsure', says: 'not quite trusting his game' },
  { max: 12, icon: '➖', label: 'Steady', says: 'steady' },
  { max: 14, icon: '💪', label: 'Confident', says: 'confident in his game' },
  { max: 20, icon: '🔥', label: 'Fearless', says: 'thinks he can\'t miss' },
];
export const confLevel = v => CONF_LEVELS.findIndex(l => v <= l.max);   // 0..4

const AW = { CHAMP: 0, FMVP: 1, MVP: 2, ROTY: 4, MIP: 6, ALL_NBA: 13, ALL_STAR: 23 };
const wonIn = (p, id, yr) => (p.awards || []).some(a => a.id === id && (a.league == null || a.league === 0) && (a.yearsWon || []).includes(yr));
const played = p => [...new Set((p.stats || []).filter(s => s.league === 0 && (s.season || []).some(r => r.GP > 0)).map(s => s.yr))].sort((a, b) => b - a);
const sum = (rows, k) => rows.reduce((a, r) => a + (k === 'MIN' ? (r.MIN?.[0] || 0) / 60 : r[k] || 0), 0);
const ts = rows => { const fga = sum(rows, 'FGA'), fta = sum(rows, 'FTA'); return fga + fta > 50 ? sum(rows, 'PTS') / (2 * (fga + 0.44 * fta)) : null; };
// Per-36 game score a level produces in this league (fit on a full season of a real save).
const expected36 = lv => 22.5 + 0.435 * (lv - 76.5);
const salt = id => { let h = Math.imul(id + 131, 2246822519) >>> 0; h ^= h >>> 13; return (h % 1000) / 1000; };

// { v, why[] }. `extra` = [{ v, why }] the app adds (Summer League, Media Day) on top.
export function confRead(p, extra = []) {
  const yrs = played(p), ly = yrs[0], why = [];
  let v = 9.5 + salt(p.id);
  const add = (n, text) => { v += n; if (text && Math.abs(n) >= 0.9) why.push(n > 0 ? text : `-${text}`); };
  const l = ly ? seasonLine(p, 0, ly) : null;
  if (l && l.gp >= 15 && l.mpg >= 12) {
    const r = (l.gs * 36 / l.mpg - expected36(levelOf(p)) + 0.8) / 1.6;   // centred: the median player reads steady
    add(Math.max(-3.5, Math.min(3.5, r)), r > 0 ? 'outplayed his rating last season' : 'played below his rating last season');
    const prev = yrs[1] ? seasonLine(p, 0, yrs[1]) : null;
    if (prev && prev.gp >= 15 && prev.mpg >= 12) {
      const d = l.gs * 36 / l.mpg - prev.gs * 36 / prev.mpg;
      if (Math.abs(d) >= 3) add(d > 0 ? 1 : -1, d > 0 ? 'took a step forward' : 'took a step back');
    }
    const st = (p.stats || []).find(s => s.league === 0 && s.yr === ly);
    const now = ts(st?.season || []), before = yrs[1] ? ts((p.stats || []).find(s => s.league === 0 && s.yr === yrs[1])?.season || []) : null;
    if (now != null && before != null && Math.abs(now - before) >= 0.03) add(now > before ? 1 : -1, now > before ? 'his shot is falling' : 'his shot went cold');
    const po = st?.playoffs || [];
    if (sum(po, 'GP') >= 4) {
      const g = rows => sum(rows, 'PTS') + 0.7 * sum(rows, 'REB') + 0.7 * sum(rows, 'AST') + sum(rows, 'STL') + 0.7 * sum(rows, 'BLK') - 0.7 * sum(rows, 'TO') - 0.4 * (sum(rows, 'FGA') - sum(rows, 'FGM'));
      const ratio = (g(po) / sum(po, 'GP')) / Math.max(1, l.gs);
      if (ratio >= 1.1) add(1.5, 'rose in the playoffs'); else if (ratio <= 0.8) add(-1.5, 'shrank in the playoffs');
    }
    const inj = sum(st?.season || [], 'INJ');
    if (inj >= 25) add(inj >= 50 ? -3 : -2, 'coming back from a long injury');
  } else if (ly) {
    const inj = sum((p.stats || []).find(s => s.league === 0 && s.yr === ly)?.season || [], 'INJ');
    if (inj >= 25) add(-3, 'coming back from a long injury');
  }
  if (ly) {
    if (wonIn(p, AW.MVP, ly)) add(3, 'the reigning MVP');
    else if (wonIn(p, AW.ALL_NBA, ly)) add(1.5, 'made All-NBA');
    else if (wonIn(p, AW.ALL_STAR, ly)) add(1, 'made the All-Star team');
    if (wonIn(p, AW.FMVP, ly)) add(2, 'the Finals MVP');
    else if (wonIn(p, AW.CHAMP, ly)) add(1, 'a champion');
    if (wonIn(p, AW.MIP, ly)) add(2, 'Most Improved');
    if (wonIn(p, AW.ROTY, ly)) add(2, 'Rookie of the Year');
  }
  for (const e of extra) add(e.v, e.why);
  const out = Math.max(1, Math.min(20, Math.round(v))), lvl = confLevel(out);
  const keep = why.filter(w => (lvl < 2 ? w.startsWith('-') : lvl > 2 ? !w.startsWith('-') : true)).map(w => w.replace(/^-/, ''));
  return { v: out, level: lvl, why: keep.length ? keep : [ly ? 'a normal season for him' : 'no NBA games yet'] };
}
export const confVal = p => confRead(p).v;
// Offseason growth: a confident player gets a little more out of his work, a shaken one a little less.
export const confMult = p => [0.9, 0.95, 1, 1.05, 1.1][confRead(p).level];
// Free agency ask: a confident one asks for more, a shaken one takes less to prove himself.
export const confAsk = p => [0.9, 0.96, 1, 1.04, 1.08][confRead(p).level];
