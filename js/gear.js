// Socks and sleeves that match the jersey: every player on a team wears the same
// accessory color with each of the four jerseys.
//
// - Jersey 1 and 2: white, unless the jersey is black.
// - Jersey 3 and 4: black when the jersey is black or close to it, otherwise the
//   jersey's own color, even one outside the team's main three.
// Tattoos, bare skin and odd wristband colors (a rubber band) are left alone.

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
  return (team.uniforms || []).map((u, i) => {
    const jersey = resolve(team, u.jersey);
    if (isBlackish(jersey)) return BLACK;
    return i <= 1 ? 'FFFFFF' : jersey;
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
function kind(v, skin, tattoos, known, own = new Set()) {
  const u = String(v || '').toUpperCase();
  if (!u) return 'skin';
  if (['PRI', 'SEC', 'TER'].includes(u)) return 'gear';
  if (u === String(skin).toUpperCase()) return 'skin';
  // A color on the tattoo list that is also one of his own team's colors reads as gear, not ink.
  if (tattoos?.includes(u) && !own.has(u)) return 'tattoo';
  if (isBlackish(u) || isWhiteish(u)) return 'gear';
  if (known.has(u)) return 'gear';
  if (HEX.test(u) && skin && dist(u, String(skin).toUpperCase()) <= 110) return 'tattoo';
  return 'odd';
}

// Recolor one team's players. `tattoos` maps a skin tone to its tattoo colors.
// Returns [{ p, i, key, was }] for undo.
export function matchTeam(team, known, tattoos = {}) {
  const want = targets(team), log = [], own = new Set([...(team.teamColors || []), ...(team.uniforms || []).flatMap(u => Object.values(u).map(v => resolve(team, v)))].map(x => String(x).toUpperCase()));
  const set = (p, a, i, key, val) => { if (a[key] !== val) { log.push({ p, i, key, was: a[key] }); a[key] = val; } };
  for (const p of team.roster) {
    const skin = p.appearance?.skinC, tat = (tattoos[skin] || tattoos[String(skin).toUpperCase()] || []).map(x => String(x).toUpperCase());
    (p.accessories || []).forEach((a, i) => {
      const w = want[i];
      if (!w) return;
      // Head gear and sleeves in a color from some old team still count as team gear; only a wrist color can be a one-off.
      const head = v => ['gear', 'odd'].includes(kind(v, skin, tat, known, own));
      if (a.headAcc && a.headAcc !== 'none' && head(a.headAccC)) set(p, a, i, 'headAccC', w);
      if (a.headAcc2 && a.headAcc2 !== 'none' && head(a.headAcc2C)) set(p, a, i, 'headAcc2C', w);
      for (const k of BODY) {
        const kd = kind(a[k], skin, tat, known, own);
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
