// Game length. A league can play short games (6-minute quarters) while the box scores still read like full games:
// points, rebounds and assists stay as they are, but minutes shrink with the clock. Anything that reads minutes goes
// through here, scaled back to a 48-minute game, so 19 minutes in a 24-minute game reads as 38.
let SCALE = new Map();   // league index -> 48 / minutes in a game

// From the league's own stats: a team plays 5 × game-length minutes a night (overtime adds a little).
function gameMinutes(L, li) {
  if (L.settings?.gameLength === 10) return 48;
  const yrs = new Map();
  for (const t of L.teams || []) for (const p of t.roster || []) for (const s of p.stats || []) for (const r of (s.league === li ? s.season : null) || []) {
    if (!r.GP || !r.MIN) continue;
    const k = `${s.yr}:${r.tid}`, e = yrs.get(k) || { yr: s.yr, sec: 0, gp: 0 };
    e.sec += r.MIN[0]; e.gp = Math.max(e.gp, r.GP);
    yrs.set(k, e);
  }
  const all = [...yrs.values()].filter(e => e.gp >= 20);
  if (!all.length) return 48;
  const last = Math.max(...all.map(e => e.yr));
  // Only today's rosters are in the save, so a team's past minutes read low (players since gone); the teams near the
  // top of the list kept theirs. Snap to a real game length.
  const per = all.filter(e => e.yr === last).map(e => e.sec / 60 / e.gp / 5).sort((a, b) => a - b);
  const top = per[Math.floor(per.length * 0.9)];
  return [8, 12, 16, 20, 24, 32, 40, 48].reduce((a, b) => (Math.abs(b - top) < Math.abs(a - top) ? b : a));
}
export function setGameClock(leagues) {
  SCALE = new Map((leagues || []).map((L, i) => [i, 48 / gameMinutes(L, i)]));
}
export const minScale = (li = 0) => SCALE.get(li) ?? 1;
// Seconds played in a stat row, on the 48-minute scale.
export const secsOf = (r, li = 0) => (r?.MIN?.[0] || 0) * minScale(li);
export const shortGames = (li = 0) => minScale(li) > 1.01;
