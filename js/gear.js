// Socks and sleeves that match the jersey: every player on a team wears the same
// accessory color with each of the four jerseys.
//
// - Every jersey: black when the jersey is black or close to it, otherwise white. Never a team color.
// Tattoos, bare skin, head accessories and rubber wristbands (one color on every jersey) are left alone.

export const BLACK = '141020';
const HEX = /^[0-9a-f]{6}$/i;
const rgb = h => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = h => { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
const dist = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
export const isBlackish = v => HEX.test(v) && lum(v) <= 0.14;
const isWhiteish = v => HEX.test(v) && lum(v) >= 0.93;
export const resolve = (team, v) => { const c = team.teamColors || []; const t = { PRI: c[0], SEC: c[1], TER: c[2] }[v]; return String(t || v || '').toUpperCase(); };

// The color for each of a team's four jerseys.
export function targets(team) {
  return (team.uniforms || []).map(u => {
    const jersey = resolve(team, u.jersey);
    return isBlackish(jersey) ? BLACK : 'FFFFFF';
  });
}

// Every color that is part of some team's look, so an old team's color on a traded player still counts as gear.
export function knownColors(league) {
  const s = new Set();
  for (const t of league.teams) {
    for (const c of t.teamColors || []) s.add(String(c).toUpperCase());
    for (const u of t.uniforms || []) for (const v of Object.values(u)) { const r = resolve(t, v); if (HEX.test(r)) s.add(r); }
  }
  return s;
}

const BODY = ['L_Shoulder', 'R_Shoulder', 'L_Elbow', 'R_Elbow', 'L_Wrist', 'R_Wrist', 'L_Knee', 'R_Knee', 'L_Shin', 'R_Shin'];

// What a body or head slot holds: skin, a tattoo, team gear, or something odd.
function kind(v, skin, tattoos, known) {
  const u = String(v || '').toUpperCase();
  if (!u) return 'skin';
  if (['PRI', 'SEC', 'TER'].includes(u)) return 'gear';
  if (u === String(skin).toUpperCase()) return 'skin';
  if (tattoos?.includes(u)) return 'tattoo';
  if (isBlackish(u) || isWhiteish(u)) return 'gear';
  if (known.has(u)) return 'gear';
  if (HEX.test(u) && skin && dist(u, String(skin).toUpperCase()) <= 110) return 'tattoo';
  return 'odd';
}

// Recolor one team's players. `tattoos` maps a skin tone to its tattoo colors.
// Returns [{ p, i, key, was }] for undo.
export function matchTeam(team, known, tattoos = {}) {
  const want = targets(team), log = [];
  const set = (p, a, i, key, val) => { if (a[key] !== val) { log.push({ p, i, key, was: a[key] }); a[key] = val; } };
  for (const p of team.roster) {
    const skin = p.appearance?.skinC, tat = (tattoos[skin] || tattoos[String(skin).toUpperCase()] || []).map(x => String(x).toUpperCase());
    // A wristband in the same color with all four jerseys (not white) is a rubber band he wears for himself: it stays.
    const rubber = new Set(BODY.filter(k => k.endsWith('Wrist')).filter(k => {
      const vals = (p.accessories || []).map(a => String(a[k] || '').toUpperCase());
      return vals.length >= 2 && vals.every(v => v === vals[0]) && HEX.test(vals[0]) && vals[0] !== String(skin).toUpperCase() && !isWhiteish(vals[0]);
    }));
    (p.accessories || []).forEach((a, i) => {
      const w = want[i];
      if (!w) return;
      // Sleeves in a color from some old team still count as team gear; only a wrist color can be a one-off.
      for (const k of BODY) {
        if (rubber.has(k)) continue;
        const kd = kind(a[k], skin, tat, known);
        if (kd !== 'gear' && !(kd === 'odd' && !k.endsWith('Wrist'))) continue;
        set(p, a, i, k, w);
      }
      set(p, a, i, 'sockC', w);
    });
  }
  return log;
}
export function matchLeague(league, tattoos) {
  const known = knownColors(league);
  return league.teams.flatMap(t => matchTeam(t, known, tattoos));
}
export function undoMatch(log) { for (const x of [...log].reverse()) x.p.accessories[x.i][x.key] = x.was; }

// Staff suits: black jacket and pants, white shirt, a team-color tie (the first of the primary, secondary
// and tertiary that isn't black or white). Head accessories and shoes are left alone.
export function suitTie(team) {
  const c = team.teamColors || [];
  const i = [0, 1, 2].find(k => c[k] && !isBlackish(String(c[k])) && !isWhiteish(String(c[k])));
  return ['PRI', 'SEC', 'TER'][i ?? 0];
}
export function matchSuits(team, staff = team.frontOffice?.staff || []) {
  const tie = suitTie(team), log = [];
  for (const m of staff) for (const [i, s] of (m.suits || []).entries()) {
    for (const [key, val] of [['jacketC', BLACK], ['pantC', BLACK], ['shirtC', 'FFFFFF'], ['tieC', tie]])
      if (s[key] !== val) { log.push({ m, i, key, was: s[key] }); s[key] = val; }
  }
  return log;
}
export function matchSuitsLeague(league) {
  return [...league.teams.flatMap(t => matchSuits(t)), ...(league.coaches || []).flatMap(c => matchSuits({ teamColors: [] }, [c]))];
}
export function undoSuits(log) { for (const x of [...log].reverse()) x.m.suits[x.i][x.key] = x.was; }
