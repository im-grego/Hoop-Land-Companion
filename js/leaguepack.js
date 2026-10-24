// A league pack: what the app knows about a league that the game's own files
// can't carry. A league file you export goes into the game; the game then
// drops personality traits from its saves, forgets traded picks beyond its
// pick horizon, and starts its own extensions and re-signings. The pack keeps
// those, so a franchise started from your league can be given them back.
//
// It holds, from the exported league: every player's traits (the file's 0-100
// scale), every explicitly held draft pick (traded ones), and each team's
// fans and tag. Kept in this browser and downloadable as a file to load again.
import { TRAIT_KEYS } from './traits.js';

const KEYS = [...new Set([...TRAIT_KEYS, 'roadWarrior'])];
export const PACK_VERSION = 2;   // 2: the playoffRiser slot holds Ego

export const packKey = L => `${L.shortName || L.leagueName || 'league'}`;

const everyone = L => [...L.teams.flatMap(t => t.roster), ...(L.freeAgents || []), ...(L.draftClass || [])];

// From an exported league object (traits on the file's scale).
export function buildPack(C, name = '') {
  const traits = {};
  for (const p of everyone(C)) if (p.traits && KEYS.some(k => p.traits[k] > 0)) traits[p.id] = KEYS.map(k => p.traits[k] || 0);
  const picks = [];
  for (const t of C.teams) for (const pk of t.draftPicks || []) if (pk.otid !== pk.tid || pk.pk) picks.push([pk.yr, pk.rd, pk.otid, pk.tid, pk.pk || 0]);
  const teams = {};
  for (const t of C.teams) teams[t.id] = [t.frontOffice?.fans ?? 0, t.status ?? 0];
  return { hlcPack: PACK_VERSION, league: packKey(C), name: name || C.meta?.saveName || packKey(C), year: C.season?.startingYear || 0, made: Date.now(), keys: KEYS, traits, picks, teams };
}

const store = () => { try { return localStorage; } catch { return null; } };
export const savePack = pack => { try { store()?.setItem(`hlc:pack:${pack.league}`, JSON.stringify(pack)); return true; } catch { return false; } };
export const readPack = league => { try { return JSON.parse(store()?.getItem(`hlc:pack:${league}`) || 'null'); } catch { return null; } };
export const isPack = d => !!d && d.hlcPack >= 1 && d.traits && d.picks;

// How much of a pack's league a save is: share of the pack's players it has.
export function packMatch(pack, L) {
  const ids = new Set(everyone(L).map(p => String(p.id)));
  const have = Object.keys(pack.traits).filter(id => ids.has(id)).length;
  return Object.keys(pack.traits).length ? have / Object.keys(pack.traits).length : 0;
}

// Traits back onto the players, on the app's 0-20 scale. Returns how many players.
export function applyPackTraits(pack, L) {
  let n = 0;
  const byId = new Map(everyone(L).map(p => [String(p.id), p]));
  for (const [id, vals] of Object.entries(pack.traits)) {
    const p = byId.get(id);
    if (!p) continue;
    p.traits ||= {};
    // Packs from before Ego took the playoffRiser slot hold the old trait there: leave Ego to the app.
    pack.keys.forEach((k, i) => { if (vals[i] > 0 && !(k === 'playoffRiser' && (pack.hlcPack || 1) < 2)) p.traits[k] = Math.max(1, Math.min(20, Math.round(vals[i] / 5))); });
    n++;
  }
  return n;
}

// Picks the pack says are held by someone else than the save has them.
export function packPickDiffs(pack, L) {
  const holder = (otid, yr, rd) => {
    for (const t of L.teams) if ((t.draftPicks || []).some(p => p.yr === yr && p.rd === rd && p.otid === otid)) return t.id;
    return -1;
  };
  const out = [];
  for (const [yr, rd, otid, tid] of pack.picks) {
    if (otid === tid) continue;
    if (!L.teams.some(t => t.id === otid) || !L.teams.some(t => t.id === tid)) continue;
    if (yr < (L.season.currentYear || 0)) continue;           // a draft already held
    const now = holder(otid, yr, rd);
    if (now !== tid) out.push({ yr, rd, otid, tid, from: now });
  }
  return out;
}
export function applyPackPicks(diffs, L) {
  for (const d of diffs) {
    const from = L.teams.find(t => t.id === d.from), to = L.teams.find(t => t.id === d.tid);
    if (!to) continue;
    let pk = from?.draftPicks.find(p => p.yr === d.yr && p.rd === d.rd && p.otid === d.otid);
    if (pk) from.draftPicks.splice(from.draftPicks.indexOf(pk), 1);
    else pk = { pk: 0, rd: d.rd, tid: d.tid, otid: d.otid, yr: d.yr };
    pk.tid = d.tid;
    to.draftPicks.push(pk);
  }
  return diffs.length;
}

// Fans and tags that differ from the pack.
export function packTeamDiffs(pack, L) {
  const out = [];
  for (const t of L.teams) {
    const v = pack.teams[t.id];
    if (!v) continue;
    if ((t.frontOffice?.fans ?? 0) !== v[0] || (t.status ?? 0) !== v[1]) out.push({ t, fans: v[0], status: v[1] });
  }
  return out;
}
export function applyPackTeams(diffs) {
  for (const d of diffs) { if (d.t.frontOffice) d.t.frontOffice.fans = d.fans; d.t.status = d.status; }
  return diffs.length;
}
