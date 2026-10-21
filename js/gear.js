// Socks and sleeves that match the jersey: every player on a team wears the same
// accessory color with each of the four jerseys.
//
// - Every jersey: black when the jersey is black or close to it, otherwise white. Never a team color.
// - Head accessories follow the same rule, except glasses (0005, 0006, 0024), which stay black (202020).
// Tattoos, bare skin and rubber wristbands (one color on every jersey) are left alone.

export const BLACK = '141020';
export const GLASSES = new Set(['0005', '0006', '0024']), GLASSES_C = '202020';
const hasHead = v => !!v && v !== 'none' && v !== '0000';
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
      // Head gear and sleeves in a color from some old team still count as team gear; only a wrist color can be a one-off.
      const head = v => ['gear', 'odd'].includes(kind(v, skin, tat, known));
      if (hasHead(a.headAcc) && head(a.headAccC)) set(p, a, i, 'headAccC', GLASSES.has(a.headAcc) ? GLASSES_C : w);
      if (hasHead(a.headAcc2) && head(a.headAcc2C)) set(p, a, i, 'headAcc2C', GLASSES.has(a.headAcc2) ? GLASSES_C : w);
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
// Glasses are black on everyone: rosters, free agents, retirees and hall of famers.
export function matchGlasses(league) {
  const log = [];
  const people = [...league.teams.flatMap(t => t.roster), ...(league.freeAgents || []), ...(league.retirees || []), ...(league.hallOfFame || [])];
  for (const p of people) (p.accessories || []).forEach((a, i) => {
    for (const k of ['headAcc', 'headAcc2']) if (GLASSES.has(a[k]) && a[k + 'C'] !== GLASSES_C) { log.push({ p, i, key: k + 'C', was: a[k + 'C'] }); a[k + 'C'] = GLASSES_C; }
  });
  return log;
}
export function matchLeague(league, tattoos) {
  const known = knownColors(league);
  const log = league.teams.flatMap(t => matchTeam(t, known, tattoos));
  return [...log, ...matchGlasses(league)];
}
export function undoMatch(log) { for (const x of [...log].reverse()) x.p.accessories[x.i][x.key] = x.was; }

// Player suits (active, free agents, retirees, hall of famers; coaches keep theirs): black jacket and pants,
// white shirt, a team-color tie (the first of the primary, secondary and tertiary that isn't black or white).
// Hall of famers wear a gold jacket and a black tie. Head accessories and shoes are left alone.
export const HOF_JACKET = 'E57028';
export function suitTie(team) {
  const c = team.teamColors || [];
  const i = [0, 1, 2].find(k => c[k] && !isBlackish(String(c[k])) && !isWhiteish(String(c[k])));
  return ['PRI', 'SEC', 'TER'][i ?? 0];
}
export function matchSuits(people, { jacket = BLACK, tie = 'PRI' } = {}) {
  const log = [];
  for (const m of people) for (const [i, s] of (m.suits || []).entries())
    for (const [key, val] of [['jacketC', jacket], ['pantC', BLACK], ['shirtC', 'FFFFFF'], ['tieC', tie]])
      if (s[key] !== val) { log.push({ m, i, key, was: s[key] }); s[key] = val; }
  return log;
}
// Coach suits. The head coach and the assistant listed second: jacket, shirt and tie take the color of the jersey the
// suit goes with, pants and glasses are 202020, and no other head gear. The first suit is the one on display, so it
// uses the main (second, colored) jersey, which makes suits 1 and 2 alike; suits 3 and 4 use their own jerseys, white
// or not. Two exceptions for suits 1 and 2: a red, purple or yellow second jersey makes the tops 202020, and a dark
// (but not black) third jersey lends its color instead. The coaches listed third and fourth wear the player suit with black shoes.
const hsl = h => {
  const [r, g, b] = rgb(h).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2, sat = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  let hue = !d ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: hue * 60, sat, l };
};
export const isLoud = v => { if (!HEX.test(v)) return false; const { hue, sat } = hsl(v); return sat >= 0.35 && (hue <= 14 || hue >= 335 || (hue >= 255 && hue <= 320) || (hue >= 38 && hue <= 70)); };   // red, purple, yellow (gold)
export const isRedPurple = v => { if (!HEX.test(v)) return false; const { hue, sat } = hsl(v); return sat >= 0.5 && lum(v) > 0.03 && (hue <= 14 || hue >= 335 || (hue >= 255 && hue <= 320)); };   // any shade of red or purple
export const isDarkNotBlack = v => HEX.test(v) && !isBlackish(v) && lum(v) <= 0.26;
export function matchCoachSuits(team) {
  const log = [], u = team.uniforms || [];
  const colorOf = v => String(resolve(team, v) || '');
  const main = [u[1]?.jersey, u[0]?.jersey, 'PRI'].find(v => v && !isWhiteish(colorOf(v))) || 'PRI';
  let top = main;
  if (u[2] && isRedPurple(colorOf(u[2].jersey))) top = '202020';
  else if (u[2] && isDarkNotBlack(colorOf(u[2].jersey))) top = u[2].jersey;
  else if (isLoud(colorOf(main))) top = '202020';
  const staff = team.frontOffice?.staff || [];
  for (const m of staff.slice(0, 2)) (m.suits || []).forEach((s, i) => {
    const c = i <= 1 ? top : (u[i]?.jersey ?? main);
    const set = (key, val) => { if (s[key] !== val) { log.push({ m, i, key, was: s[key] }); s[key] = val; } };
    for (const k of ['jacketC', 'shirtC', 'tieC']) set(k, c);
    set('pantC', '202020'); set('shoeC', 'FFFFFF'); set('soleC', 'FFFFFF');
    if (GLASSES.has(s.headAcc)) set('headAccC', GLASSES_C); else if (hasHead(s.headAcc)) { set('headAcc', 'none'); set('headAccC', '000000'); }
  });
  const rest = matchSuits(staff.slice(2, 4), { tie: suitTie(team) });
  for (const m of staff.slice(2, 4)) (m.suits || []).forEach((s, i) => { if (s.shoeC !== '000000') { rest.push({ m, i, key: 'shoeC', was: s.shoeC }); s.shoeC = '000000'; } });
  return [...log, ...rest];
}
// Free-agent head coaches and assistants: white shoes and soles too (they have no jerseys to match).
export function matchPoolCoachShoes(league) {
  const log = [];
  for (const m of (league.coaches || []).filter(c => c.pos === 1 || c.pos === 2)) (m.suits || []).forEach((s, i) => {
    for (const key of ['shoeC', 'soleC']) if (s[key] !== 'FFFFFF') { log.push({ m, i, key, was: s[key] }); s[key] = 'FFFFFF'; }
  });
  return log;
}
export function matchSuitsLeague(league) {
  return [
    ...league.teams.flatMap(t => matchCoachSuits(t)),
    ...matchPoolCoachShoes(league),
    ...league.teams.flatMap(t => matchSuits(t.roster, { tie: suitTie(t) })),
    ...matchSuits(league.freeAgents || []),
    ...matchSuits(league.retirees || []),
    ...matchSuits(league.hallOfFame || [], { jacket: HOF_JACKET, tie: BLACK }),
  ];
}
export function undoSuits(log) { for (const x of [...log].reverse()) x.m.suits[x.i][x.key] = x.was; }
