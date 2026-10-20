// Real-world future draft picks (2027-2033), boiled down to the simple facts: this team's pick belongs to that team now.
// Anything conditional (swaps, "more favorable of", "if not already settled", rollovers) is left to the app's own system.
// Matching is by team name, so it works on any file. A pick is only moved when it still sits where it should
// (with its original team); a pick found anywhere else was traded in the game and stays put, unprotected.

export const TEAMS = {
  ATL: ['Atlanta Hawks', 'Hawks'], BOS: ['Boston Celtics', 'Celtics'], BRK: ['Brooklyn Nets', 'Nets'], CHA: ['Charlotte Hornets', 'Hornets'],
  CHI: ['Chicago Bulls', 'Bulls'], CLE: ['Cleveland Cavaliers', 'Cavaliers'], DAL: ['Dallas Mavericks', 'Mavericks'], DEN: ['Denver Nuggets', 'Nuggets'],
  DET: ['Detroit Pistons', 'Pistons'], GOS: ['Golden State Warriors', 'Warriors'], HOU: ['Houston Rockets', 'Rockets'], IND: ['Indiana Pacers', 'Pacers'],
  LAC: ['Los Angeles Clippers', 'Clippers'], LAL: ['Los Angeles Lakers', 'Lakers'], MEM: ['Memphis Grizzlies', 'Grizzlies'], MIA: ['Miami Heat', 'Heat'],
  MIL: ['Milwaukee Bucks', 'Bucks'], MIN: ['Minnesota Timberwolves', 'Timberwolves'], NOP: ['New Orleans Pelicans', 'Pelicans'], NYK: ['New York Knicks', 'Knicks'],
  OKC: ['Oklahoma City Thunder', 'Thunder'], ORL: ['Orlando Magic', 'Magic'], PHL: ['Philadelphia 76ers', '76ers'], PHX: ['Phoenix Suns', 'Suns'],
  POR: ['Portland Trail Blazers', 'Trail Blazers'], SAC: ['Sacramento Kings', 'Kings'], SAN: ['San Antonio Spurs', 'Spurs'], TOR: ['Toronto Raptors', 'Raptors'],
  UTH: ['Utah Jazz', 'Jazz'], WAS: ['Washington Wizards', 'Wizards'],
};
const SHORT = { BRK: 'BKN', CHA: 'CHO', GOS: 'GSW', PHL: 'PHI', SAN: 'SAS', UTH: 'UTA' };   // the codes a file's own abbreviations use
const ALT = { 'philadelphia sixers': 'PHL', 'portland blazers': 'POR' };

// "year round FROM>TO [top N]": FROM's pick now belongs to TO; a top-N protection sends it back if it lands in the top N.
// Protections are the closest of #1, top 4, top 8 and top 14.
const DATA = `
2027 1 ATL>SAN, NYK>BRK, DAL>CHA t4, MIA>CHA t14, LAL>MEM t4, PHX>HOU
2028 1 ORL>POR
2029 1 NYK>BRK, LAL>DAL, IND>LAC
2030 1 ORL>MEM, GOS>MEM t14
2031 1 PHL>BOS, CLE>DEN, MIA>MIL, PHX>MEM, NYK>BRK, MIN>SAC, LAL>UTH, TOR>LAC
2032 1 DEN>BRK
2033 1 MIN>CHA, PHX>CHA, MIA>MIL, LAL>UTH, TOR>LAC
2027 2 CHI>OKC, CLE>CHI, MEM>CHA, WAS>NYK, DEN>UTH, LAC>UTH, UTH>IND, MIN>POR
2028 2 ATL>BRK, MEM>BRK, HOU>CHA, ORL>CHA, DAL>LAC, MIN>DEN, NOP>SAN, CLE>UTH, UTH>OKC, NYK>DET, SAC>POR
2029 2 CLE>ATL, BOS>OKC, DAL>BRK, GOS>BRK, MEM>BRK, HOU>MEM, LAL>MEM, POR>MEM, LAC>SAN, NOP>SAN, PHX>NYK, SAC>NYK
2030 2 ATL>OKC, NYK>ATL, BOS>BRK, DAL>BRK, LAL>BRK, CLE>SAN, MIL>ORL, MIN>OKC, SAC>SAN, PHL>NYK, TOR>LAC
2031 2 DAL>DET, DET>OKC, LAL>BRK, WAS>LAL, MIL>CHA, PHX>CHA, DEN>CHI, NYK>CHI, SAC>DEN, TOR>NOP
2032 2 ATL>OKC, LAL>OKC, DAL>NYK, DEN>BRK, MIA>BRK, TOR>BRK, MIL>CHA, MIN>CHA, WAS>LAL, SAC>DEN, CLE>UTH
2033 2 SAC>ATL, DAL>WAS, WAS>MEM, OKC>MEM, HOU>CHA, MIN>CHA, MIA>MIL, PHX>NYK, TOR>LAC
`;
// Two-team swaps: the first team gets the better of the two picks, the second the worse. (Multi-team and conditional ones are left out.)
export const SWAPS = [
  { yr: 2027, rd: 1, best: 'HOU', worst: 'BRK' }, { yr: 2028, rd: 1, best: 'CHA', worst: 'MIN' }, { yr: 2028, rd: 1, best: 'OKC', worst: 'DAL' },
  { yr: 2029, rd: 1, best: 'PHL', worst: 'LAC' }, { yr: 2029, rd: 1, best: 'MEM', worst: 'ORL' }, { yr: 2030, rd: 1, best: 'UTH', worst: 'LAL' },
  { yr: 2030, rd: 2, best: 'CHI', worst: 'IND' }, { yr: 2030, rd: 2, best: 'ORL', worst: 'NOP' }, { yr: 2031, rd: 1, best: 'SAN', worst: 'SAC' },
];
// Forfeited first-rounders (the Clippers' scandal penalty): these picks don't exist, so they're taken out.
// IND's 2029 first was owed to LAC and goes with it.
export const FORFEITED = [{ yr: 2029, rd: 1, team: 'IND' }, { yr: 2030, rd: 1, team: 'LAC' }, { yr: 2031, rd: 1, team: 'LAC' }, { yr: 2032, rd: 1, team: 'LAC' }, { yr: 2033, rd: 1, team: 'LAC' }];
export const REAL_PICKS = DATA.trim().split('\n').flatMap(line => {
  const [yr, rd, ...rest] = line.trim().split(' ');
  return rest.join(' ').split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [mv, t] = s.split(' ');
    const [from, to] = mv.split('>');
    return { yr: +yr, rd: +rd, from, to, top: t ? +t.slice(1) : 0 };
  });
});

// The team in a file that a code stands for, matched by name (city + nickname), then nickname, then abbreviation.
export function teamFor(L, code) {
  const [full, nick] = TEAMS[code];
  const norm = s => String(s || '').trim().toLowerCase();
  const name = t => norm(`${t.city || ''} ${t.name || ''}`);
  return L.teams.find(t => name(t) === norm(full))
    || L.teams.find(t => norm(t.name) === norm(nick) || ALT[name(t)] === code)
    || L.teams.find(t => t.shortName === (SHORT[code] || code)) || null;
}

// Put every team's own picks in the file for these years (a league file lists only some of them).
export function fillDefaultPicks(L, years, rounds = [1, 2]) {
  const have = new Set(L.teams.flatMap(t => (t.draftPicks || []).map(p => `${p.yr}:${p.rd}:${p.otid}`)));
  let made = 0;
  for (const t of L.teams) {
    t.draftPicks ||= [];
    for (const yr of years) for (const rd of rounds) {
      if (have.has(`${yr}:${rd}:${t.id}`)) continue;
      t.draftPicks.push({ pk: 0, rd, tid: t.id, otid: t.id, yr });
      made++;
    }
  }
  return made;
}

// Apply the real assignments to a file's picks. Returns { moved, kept, voided, protections: [{ otid, yr, top, from }], missing }.
// `force` is for a clean file: nothing in it was traded in a game, so every pick goes where the real deal says, wherever it sits.
export function applyRealPicks(L, { years = null, force = false } = {}) {
  const out = { moved: 0, kept: 0, missing: 0, voided: 0, protections: [], swaps: [] };
  const holderOf = (otid, yr, rd) => {
    for (const t of L.teams) { const pk = (t.draftPicks || []).find(p => p.otid === otid && p.yr === yr && p.rd === rd); if (pk) return { t, pk }; }
    return null;
  };
  for (const r of REAL_PICKS) {
    if (years && !years.includes(r.yr)) continue;
    const X = teamFor(L, r.from), Z = teamFor(L, r.to);
    if (!X || !Z) { out.missing++; continue; }
    const at = holderOf(X.id, r.yr, r.rd);
    if (!at) { out.missing++; continue; }
    if ((at.t === X || force) && at.t !== Z) {
      at.t.draftPicks.splice(at.t.draftPicks.indexOf(at.pk), 1);
      at.pk.tid = Z.id;
      Z.draftPicks.push(at.pk);
      out.moved++;
    } else if (at.t !== Z) { out.kept++; continue; }          // traded in the game: honored as it stands, unprotected
    if (r.top && r.rd === 1) out.protections.push({ otid: X.id, yr: r.yr, top: r.top, from: X.id });
  }
  // A swap needs both picks with their original teams (or a clean file), each pick in only one swap.
  for (const w of SWAPS) {
    if (years && !years.includes(w.yr)) continue;
    const X = teamFor(L, w.best), Y = teamFor(L, w.worst);
    const hx = X && holderOf(X.id, w.yr, w.rd), hy = Y && holderOf(Y.id, w.yr, w.rd);
    if (!hx || !hy) { out.missing++; continue; }
    if (!force && (hx.t !== X || hy.t !== Y)) { out.kept++; continue; }
    out.swaps.push({ yr: w.yr, rd: w.rd, a: hx.t.id, b: hy.t.id, x: X.id, y: Y.id, mode: 'best' });
  }
  for (const f of FORFEITED) {
    if (years && !years.includes(f.yr)) continue;
    const X = teamFor(L, f.team);
    const at = X && holderOf(X.id, f.yr, f.rd);
    if (at && (at.t === X || force)) { at.t.draftPicks.splice(at.t.draftPicks.indexOf(at.pk), 1); out.voided++; }
  }
  return out;
}
