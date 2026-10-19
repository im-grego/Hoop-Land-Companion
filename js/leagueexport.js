// Turn a franchise save back into a league file (the league object on its
// own, season blank) so new saves can start from it. Structure follows a fresh
// league file from the game (build 1.10): no news, schedule or playoffs, the
// season at phase 0 with startingYear set to the coming season, no current-
// season rows, no draft class (this year's is on the rosters), traits written
// on the file's 0-100 scale.
import { parseSave, serializeSave } from './savefile.js';
import { BLANK_GAME, BLANK_CAREER } from './leaguetemplate.js';
import { fillTraits } from './traits.js';

const TRAIT_KEYS = ['durability', 'winning', 'money', 'loyalty', 'motor', 'lockerRoom', 'playoffRiser', 'roadWarrior'];

export function saveToLeague(L, { suffix = true, cap = null, maxContract = null, keepDraft = false } = {}) {
  const C = parseSave(serializeSave(L));          // a copy; the open save is left alone
  const Y = C.season.currentYear;
  const S = C.season;
  Object.assign(S, { startingYear: Y, currentYear: 0, currentDay: 0, currentRound: 0, phase: 0, teamId: 0, tradeDeadline: 0, allStarWeekend: 0, news: [], schedule: [], playoffs: [], tradeOffers: [], draftWorkouts: [] });
  if (cap) S.salaryCap = cap;
  if (maxContract) S.maxContract = maxContract;
  C.meta.dataType = 1;
  if (suffix && C.meta.saveName && !/ \(league \d+\)$/.test(C.meta.saveName)) C.meta.saveName = `${C.meta.saveName} (league ${Y})`;
  if (!keepDraft) C.draftClass = [];
  C.contractOffers = [];
  C.currentGame = structuredClone(BLANK_GAME);
  C.career = structuredClone(BLANK_CAREER);
  fillTraits(C);                                   // judged from careers (known players) or generated, so the new league starts with them
  const people = [...C.teams.flatMap(t => t.roster), ...(C.freeAgents || [])];
  for (const t of C.teams.concat(C.starTeams || [])) {
    t.isPlayer = false;
    t.headToHeads = [];
    // The coming season's empty row isn't history yet; picks for drafts already held are spent.
    if (t.season) t.season = t.season.filter(r => !(r.yr >= Y && !(r.seasonStats?.GP > 0)));
    if (t.draftPicks) t.draftPicks = t.draftPicks.filter(pk => keepDraft ? pk.yr >= Y : pk.yr > Y);
  }
  for (const t of C.teams.concat(C.starTeams || [])) if (t.legacy === undefined) t.legacy = 0;
  for (const p of people) {
    if (p.stats) p.stats = p.stats.filter(r => !(r.league === 0 && r.yr >= Y && !(r.season || []).some(x => x.GP > 0)));
    // This year's class carries the draft year as the year before the save year, as in the exported saves.
    if (p.history?.draft?.yr === Y && p.history.draft.rd > 0) p.history.draft.yr = Y - 1;
    if (p.season?.xp) p.season.xp = p.season.xp.map(() => 0);
    if (p.season?.ap) p.season.ap = p.season.ap.map(() => 0);
    // Traits: the app keeps 0-20, the file 0-100.
    const t = p.traits || (p.traits = {});
    for (const k of TRAIT_KEYS) t[k] = Math.max(0, Math.min(100, Math.round((t[k] || 0) * 5)));
  }
  // The file carries a traits block on every player and on the commissioner and referees.
  const zero = () => Object.fromEntries(TRAIT_KEYS.map(k => [k, 0]));
  for (const x of [C.commissioner, ...(C.referees || []), ...(C.starTeams || []).flatMap(t => t.roster || []), ...(C.retirees || []), ...(C.hallOfFame || [])]) if (x && !x.traits) x.traits = zero();
  return C;
}
