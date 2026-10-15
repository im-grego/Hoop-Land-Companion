import {
  parseSave, serializeSave, ATTRS, ATTR_NAMES, PHYSICAL, attrMin, ATTR_MAX, activeSkills, isLeveled, CATEGORIES, SKILL_MAX_LEVEL, POSITIONS, MODE_NAMES, phaseName, BUMP_PHASES, BUMP_DAY, POT_MIN, POT_MAX, regressionYear, injuryName, PHASE_POST_DRAFT, leagueRookies,
  playerName, heightStr, avgRating, lastSeasonMpg, leaguePlayers, snapshot, restore, diffPlayer,
} from './savefile.js';
import { DEFAULT_PARAMS, runProgression, buildSkillProfiles, rankSkillsFor, unlockSkill, mulberry32, runRookieBump, injuryRisk } from './progression.js';
import {
  SKILL_ATTRS, DRAFT_DROP, DRAFT_FLOOR, floorVector, ceilingVector, buildCompPool, prospectComps, prospectValue,
  lotterySetup, lotteryOdds, runLottery, draftOrder, teamRecord, cpuPick, tradePicks, pickValue, lotteryDone, actualDraftOrder, rookieComps,
  recoveryFor, projectedRookie, originalRatings, applySummerLeague,
} from './draft.js';

const APP_VERSION = '0.6.7';
const $app = document.getElementById('app');

// ---------------------------------------------------------------------------
// State

const state = {
  fileName: null,
  data: null,
  leagueIdx: 0,
  snaps: new Map(),        // `${leagueIdx}:${pid}` -> original attributes/skills
  profiles: [],            // per league skill profiles (from original data)
  leagueAvg: [],           // per league average attribute vector
  userTeams: new Set(),    // team ids the user controls (current league)
  auto: {},                // leagueIdx -> bump summary
  rookieAuto: {},          // leagueIdx -> rookie bump summary
  summer: {},              // leagueIdx -> { players, points } once summer league ran this session
  awards: {},              // leagueIdx -> Map pid -> points awarded
  draft: {},               // leagueIdx -> { lottery, mock, trades }
  compPools: {},
  compCache: {},
  params: loadParams(),
  dirty: false,
  stack: [],
};

function loadParams() {
  try {
    const saved = JSON.parse(localStorage.getItem('hlc:params'));
    if (saved) {
      // v3 changed the bump to award points; older settings don't apply.
      if ((saved.version || 0) < 3) return structuredClone(DEFAULT_PARAMS);
      // v4 flipped summer league recovery (older rookies win back more).
      if (saved.version < 4) delete saved.recoveryBands;
      // v5 rescaled injury risk for natural (unedited) injuries.
      if (saved.version < 5) for (const k of ['injuryMinGames', 'injuryPotPerGame']) delete saved[k];
      if (saved.version < 7) for (const k of ['softTissueParts', 'softTissueMult', 'softTissuePointsMult', 'structuralParts', 'structuralMult']) delete saved[k]; // v7 injury classes
      return { ...structuredClone(DEFAULT_PARAMS), ...saved };
    }
  } catch { /* storage unavailable */ }
  return structuredClone(DEFAULT_PARAMS);
}
function saveParams() {
  try { localStorage.setItem('hlc:params', JSON.stringify({ ...state.params, version: 7 })); } catch { /* ignore */ }
}
function teamsKey() { return `hlc:teams:${league().meta?.saveName || state.fileName}:${state.leagueIdx}`; }
function saveUserTeams() {
  try { localStorage.setItem(teamsKey(), JSON.stringify([...state.userTeams])); } catch { /* ignore */ }
}
function loadUserTeams() {
  let ids = null;
  try { ids = JSON.parse(localStorage.getItem(teamsKey())); } catch { /* ignore */ }
  if (!Array.isArray(ids)) {
    const L = league();
    ids = L.teams.filter(t => t.isPlayer).map(t => t.id);
    // Franchise saves: default to the team the save is built around.
    if (!ids.length && L.season.mode === 0 && L.teams.some(t => t.id === L.season.teamId)) ids = [L.season.teamId];
  }
  state.userTeams = new Set(ids);
}

const league = () => state.data.seasonLeagues[state.leagueIdx];

// Pre-draft ratings and the summer-league-done flag are remembered per
// league + season so they survive switching save files.
const seasonKey = (L = league()) => `${L.shortName}:${L.season.currentYear}`;
function loadOriginals(L = league()) {
  try { return JSON.parse(localStorage.getItem(`hlc:orig:${seasonKey(L)}`)) || {}; } catch { return {}; }
}
function saveOriginals(L, map) {
  const merged = { ...loadOriginals(L), ...map };
  try { localStorage.setItem(`hlc:orig:${seasonKey(L)}`, JSON.stringify(merged)); } catch { /* ignore */ }
  return merged;
}
function summerDone(L = league()) {
  try { return localStorage.getItem(`hlc:summer:${seasonKey(L)}`) === '1'; } catch { return false; }
}
function markSummerDone(L) {
  try { localStorage.setItem(`hlc:summer:${seasonKey(L)}`, '1'); } catch { /* ignore */ }
}
const snapKey = (pid, li = state.leagueIdx) => `${li}:${pid}`;
const snapOf = p => state.snaps.get(snapKey(p.id));
const isUserTeam = t => t && state.userTeams.has(t.id);

function allEntries() { return leaguePlayers(league(), true); }
function findPlayer(pid) { return allEntries().find(e => e.p.id === pid); }

// ---------------------------------------------------------------------------
// Utilities

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function stars(halfStars) {
  const full = Math.floor(halfStars / 2);
  return '★'.repeat(full) + (halfStars % 2 ? '½' : '');
}

function logoUrl(url) {
  if (!url) return '';
  return url.includes('dropbox.com') ? url.replace(/([?&])dl=0/, '$1raw=1') : url;
}
function logoImg(team, cls = 'logo-sm') {
  const u = logoUrl(team.logoURL);
  if (!u) return '';
  return `<img class="${cls}" src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`;
}

function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function overlay(html) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="box">${html}</div>`;
  document.body.appendChild(o);
  return o;
}

function confirmBox(msg, okLabel = 'Confirm') {
  return new Promise(resolve => {
    const o = overlay(`<p class="note">${msg}</p>
      <div class="grid2"><button class="btn off" data-r="0">Cancel</button><button class="btn focus" data-r="1">${esc(okLabel)}</button></div>`);
    o.addEventListener('click', e => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      o.remove();
      resolve(b.dataset.r === '1');
    });
  });
}

const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));

function changeSummary(d) {
  const parts = Object.entries(d.attrs).map(([k, v]) => `${k}${v > 0 ? '+' : ''}${v}`);
  return parts.join(' ');
}

function skillBadges(d) {
  return d.added.map(id => `<span class="badge new">+${esc(id)}</span>`).join('') +
    d.leveled.map(id => `<span class="badge lvl">${esc(id)}↑</span>`).join('') +
    d.removed.map(id => `<span class="badge">−${esc(id)}</span>`).join('');
}

function skillHint(id) {
  const prof = state.profiles[state.leagueIdx]?.[id];
  const avg = state.leagueAvg[state.leagueIdx];
  if (!prof || !avg) return '';
  return ATTRS.map((k, i) => [k, prof.v[i] - avg[i]])
    .sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]).join(' · ');
}

// ---------------------------------------------------------------------------
// Layout + routing

function layout({ title, left = '', right = '', body, action = null }) {
  const t = esc(title);
  $app.innerHTML = `
    <div class="header">
      ${left}
      <div class="marquee" role="heading" aria-level="1" aria-label="${t}">
        <div class="marquee-track" aria-hidden="true"><span>${t}</span><span>${t}</span></div>
      </div>
      ${right}
    </div>
    <main class="panel">${body}</main>
    <div class="bottom">
      ${state.stack.length > 1 ? `<button class="btn back" data-act="back" aria-label="Back">${BACK_ARROW}</button>` : '<span></span>'}
      ${action ? `<button class="btn action" data-act="${action.act}">${esc(action.label)}</button>` : ''}
    </div>`;
  window.scrollTo(0, 0);
}

const BACK_ARROW = `<svg width="40" height="28" viewBox="0 0 10 7" shape-rendering="crispEdges" aria-hidden="true">
  <path fill="#fff" d="M3 0h1v1h-1zM2 1h2v1h-2zM1 2h9v3h-9zM0 3h1v1h-1zM2 5h2v1h-2zM3 6h1v1h-1z"/></svg>`;

const screens = {};
const actions = {};

function go(name, args = {}) {
  state.stack.push({ name, args });
  history.pushState({ depth: state.stack.length }, '');
  render();
}
function back() {
  if (state.stack.length > 1) history.back();
}
function replace(name, args = {}) {
  state.stack[state.stack.length - 1] = { name, args };
  render();
}
function render() {
  const top = state.stack[state.stack.length - 1];
  screens[top.name](top.args);
}

window.addEventListener('popstate', () => {
  if (state.stack.length > 1) { state.stack.pop(); render(); }
});

window.addEventListener('beforeunload', e => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});

$app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'back') return back();
  const fn = actions[act];
  if (fn) fn(el.dataset, el, e);
});

$app.addEventListener('change', e => {
  if (e.target.id === 'fileInput' && e.target.files[0]) loadFile(e.target.files[0]);
  if (e.target.id === 'origInput' && e.target.files[0]) loadReference(e.target.files[0]);
});

// ---------------------------------------------------------------------------
// Loading / exporting

async function loadFile(file) {
  if (state.dirty && !(await confirmBox('You have unsaved changes. Load a different file anyway?', 'Load'))) return;
  const o = overlay('<div class="spinner"></div><p class="note">Reading season file…</p>');
  await nextFrame();
  try {
    const text = await file.text();
    const data = parseSave(text);
    if (!Array.isArray(data.seasonLeagues) || !data.seasonLeagues.length) throw new Error('No seasonLeagues found');
    state.fileName = file.name;
    state.data = data;
    state.leagueIdx = 0;
    state.snaps.clear();
    state.profiles = [];
    state.leagueAvg = [];
    state.auto = {};
    state.rookieAuto = {};
    state.summer = {};
    state.awards = {};
    state.draft = {};
    state.compPools = {};
    state.compCache = {};
    data.seasonLeagues.forEach((L, li) => {
      const players = leaguePlayers(L, true).map(e => e.p);
      for (const p of players) state.snaps.set(snapKey(p.id, li), snapshot(p));
      state.profiles[li] = buildSkillProfiles(players);
      const avg = ATTRS.map(() => 0);
      for (const p of players) ATTRS.forEach((k, i) => { avg[i] += p.attributes[k][0] / players.length; });
      state.leagueAvg[li] = avg;
    });
    data.seasonLeagues.forEach(L => { if (L.draftClass?.length) saveOriginals(L, originalRatings(L)); });
    loadUserTeams();
    state.dirty = false;
    o.remove();
    toast(`Loaded ${data.seasonLeagues[0].meta?.saveName || file.name}`);
    render();
  } catch (err) {
    o.remove();
    console.error(err);
    const b = overlay(`<p class="note">Couldn't read that file as a Hoop Land season.<br><span class="muted small">${esc(err.message)}</span></p><button class="btn">OK</button>`);
    b.querySelector('button').onclick = () => b.remove();
  }
}

// Read a pre-draft save only to remember the prospects' original ratings.
async function loadReference(file) {
  const o = overlay('<div class="spinner"></div><p class="note">Reading pre-draft ratings…</p>');
  await nextFrame();
  try {
    const ref = parseSave(await file.text());
    const L = ref.seasonLeagues.find(x => x.shortName === league().shortName) || ref.seasonLeagues[0];
    if (!L.draftClass?.length) throw new Error('That file has no draft class. Use a save from before the draft.');
    const rookies = new Set(leagueRookies(league()).map(r => r.p.id));
    const found = Object.keys(originalRatings(L)).filter(id => rookies.has(+id)).length;
    if (!found) throw new Error("None of that file's prospects match this season's rookies.");
    saveOriginals(league(), originalRatings(L));
    state.compCache = {};
    o.remove();
    toast(`Pre-draft ratings found for ${found} rookies`);
    render();
  } catch (err) {
    o.remove();
    const b = overlay(`<p class="note">${esc(err.message)}</p><button class="btn">OK</button>`);
    b.querySelector('button').onclick = () => b.remove();
  }
}

function buildExport() {
  state.data.seasonLeagues.forEach((L, li) => { if (state.summer[li]) markSummerDone(L); });
  const text = serializeSave(state.data);
  return new File([text], state.fileName, { type: 'application/octet-stream' });
}

actions.download = async () => {
  const o = overlay('<div class="spinner"></div><p class="note">Building file…</p>');
  await nextFrame();
  const file = buildExport();
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  o.remove();
  state.dirty = false;
  toast('Season file saved');
};

actions.share = async () => {
  const o = overlay('<div class="spinner"></div><p class="note">Building file…</p>');
  await nextFrame();
  const file = buildExport();
  o.remove();
  try {
    await navigator.share({ files: [file], title: file.name });
    state.dirty = false;
  } catch (err) {
    if (err.name !== 'AbortError') toast('Sharing failed, use Download instead');
  }
};

// ---------------------------------------------------------------------------
// Main menu

screens.main = () => {
  if (!state.data) {
    layout({
      title: 'Main Menu',
      body: `
        <fieldset class="frame"><legend>Hoop Land Companion</legend>
          <div class="stack">
            <p class="note">Load an end-of-season file to run an offseason bump: players 25 and under earn extra upgrade points based on age and minutes, for every team. Adjust your own players, then export the file back into the game.</p>
            <label class="btn big focus"><span class="ico">📂</span> Load Season File
              <input type="file" id="fileInput"></label>
            <p class="note muted small">Your file is read on this device only. Keep a backup of the original.</p>
          </div>
        </fieldset>
        <p class="center muted small">Version ${APP_VERSION}</p>`,
    });
    return;
  }
  const L = league();
  const s = L.season;
  const players = leaguePlayers(L, true).length;
  const auto = state.auto[state.leagueIdx];
  const yourTeams = L.teams.filter(isUserTeam).map(t => t.shortName).join(', ') || 'None picked';
  layout({
    title: 'Main Menu',
    body: `
      <fieldset class="frame"><legend>Season File</legend>
        <dl class="info">
          <dt>Save</dt><dd>${esc(L.meta?.saveName || state.fileName)}</dd>
          <dt>League</dt><dd>${esc(L.shortName)}</dd>
          <dt>Year</dt><dd>${s.currentYear}</dd>
          <dt>Mode</dt><dd>${esc(MODE_NAMES[s.mode] ?? s.mode)}</dd>
          <dt>Phase</dt><dd>${esc(phaseName(s))}</dd>
          <dt>Players</dt><dd>${players}</dd>
          <dt>Your teams</dt><dd>${esc(yourTeams)}</dd>
          <dt>Offseason bump</dt><dd>${auto ? `<span class="up">Applied</span>` : '<span class="muted">Not run</span>'}</dd>
          <dt>In-game CPU progression</dt><dd>${s.cpuProgression ? '<span class="gold">On</span>' : 'Off'}</dd>
        </dl>
        ${phaseWarning(s)}
      </fieldset>
      <fieldset class="frame"><legend>Modes</legend>
        <div class="stack">
          <button class="btn big left focus" data-act="nav" data-to="offseason"><span class="ico">🏆</span> Offseason Development</button>
          <div class="grid2">
            <button class="btn left" data-act="nav" data-to="draft"><span class="ico">🎓</span> Draft Room</button>
            <button class="btn left" data-act="nav" data-to="teams"><span class="ico">👥</span> Your Teams</button>
            <button class="btn left" data-act="nav" data-to="settings"><span class="ico">☰</span> Settings</button>
            <button class="btn left" data-act="nav" data-to="export"><span class="ico">💾</span> Export</button>
            <label class="btn left"><span class="ico">📂</span> Load File<input type="file" id="fileInput"></label>
          </div>
        </div>
      </fieldset>
      <p class="center muted small">Version ${APP_VERSION}</p>`,
  });
};

function phaseWarning(s) {
  if (BUMP_PHASES.includes(s.phase) && s.currentDay === BUMP_DAY) return '';
  if (BUMP_PHASES.includes(s.phase)) return `<p class="note gold small" style="margin-top:10px">Best run on Free Agency Day ${BUMP_DAY} (the last day before the new season), once rosters are set. This file is at ${esc(phaseName(s))}.</p>`;
  return `<p class="note gold small" style="margin-top:10px">The offseason bump is meant for free agency (Day ${BUMP_DAY}, before advancing to the new season). This file is at ${esc(phaseName(s))}.</p>`;
}

actions.nav = d => go(d.to, d.arg ? { arg: d.arg } : {});

// ---------------------------------------------------------------------------
// Team selection

screens.teams = (args) => {
  const L = league();
  const conf = args.conf ?? 0;
  const teams = L.teams.filter(t => (t.division < 3 ? 0 : 1) === conf || L.conferences.length < 2);
  layout({
    title: 'Select Your Teams',
    body: `
      ${L.conferences.length >= 2 ? `<div class="tabs">
        ${L.conferences.map((c, i) => `<button class="btn ${i === conf ? 'on focus' : 'off'}" data-act="conf" data-i="${i}">${esc(c)}</button>`).join('')}
      </div>` : ''}
      <p class="note">Tap the teams you control. They are skipped by auto progression and appear under Your Teams for hand-picked upgrades.</p>
      <div class="team-grid">
        ${teams.map(t => `<button class="team-tile ${isUserTeam(t) ? 'sel' : ''}" data-act="toggleTeam" data-id="${t.id}">
          ${t.logoURL ? logoImg(t, '') : `<div class="fallback">${esc(t.shortName)}</div>`}
          <span>${esc(t.shortName)}</span></button>`).join('')}
      </div>
      <p class="note muted small">${state.userTeams.size} selected</p>`,
    action: { act: 'back', label: 'Confirm' },
  });
};

actions.conf = d => replace('teams', { conf: +d.i });

actions.toggleTeam = async d => {
  const id = +d.id;
  if (state.userTeams.has(id)) state.userTeams.delete(id); else state.userTeams.add(id);
  saveUserTeams();
  if (state.auto[state.leagueIdx]?.spent) {
    // CPU points were spent into ratings; redo so the new split is respected.
    applyBump(state.auto[state.leagueIdx].seed);
    toast('Offseason bump re-applied');
  }
  render();
};

// ---------------------------------------------------------------------------
// Offseason bump

// The most recently completed season (the one injuries are judged on).
function lastSeasonYear() {
  return Math.max(...league().teams.map(t => teamRecord(t).yr || 0));
}

const rookieIds = () => new Set(leagueRookies(league()).map(r => r.p.id));

// Veteran bump: everyone except this year's rookies (they have their own).
function bumpEntries() {
  const rk = rookieIds();
  return leaguePlayers(league(), state.params.includeFreeAgents).filter(e => !rk.has(e.p.id));
}
function vetPlayers() {
  const rk = rookieIds();
  return leaguePlayers(league(), true).filter(e => !rk.has(e.p.id)).map(e => e.p);
}

function applyBump(seed) {
  const li = state.leagueIdx;
  // Start from the original file each time so re-rolls don't stack.
  for (const p of vetPlayers()) restore(p, snapOf(p));
  const injuryYear = lastSeasonYear();
  const entries = bumpEntries().map(e => ({
    ...e, leagueIdx: li, injuryYear, spend: state.params.spendCpuPoints && !isUserTeam(e.team),
  }));
  const awards = runProgression(entries, { ...state.params, seed }, state.profiles[li]);
  let players = 0, points = 0, mine = 0;
  for (const [pid, n] of awards) {
    if (!n) continue;
    players++;
    points += n;
  }
  let longevity = 0, potUps = 0, potDowns = 0;
  for (const e of entries) {
    if (isUserTeam(e.team)) mine += awards.get(e.p.id) || 0;
    const d = diffPlayer(e.p, snapOf(e.p));
    if (d.regDelta > 0) longevity++;
    if (d.potDelta > 0) potUps++;
    if (d.potDelta < 0) potDowns++;
  }
  const all = (state.awards[li] ||= new Map());
  for (const p of vetPlayers()) all.delete(p.id);
  for (const [k, v] of awards) all.set(k, v);
  state.auto[li] = { seed, players, points, mine, longevity, potUps, potDowns, total: entries.length, spent: state.params.spendCpuPoints };
  state.dirty = true;
}

actions.runAuto = async () => {
  if (state.auto[state.leagueIdx] && !(await confirmBox('Run the bump again? Manual changes made since the last run are reset.', 'Run'))) return;
  const o = overlay('<div class="spinner"></div><p class="note">Awarding offseason points…</p>');
  await nextFrame();
  applyBump(state.params.seed);
  o.remove();
  render();
};

actions.reroll = async () => {
  if (!(await confirmBox('Re-roll with a new seed? Manual changes are reset.', 'Re-roll'))) return;
  state.params.seed = Math.floor(Math.random() * 1e6);
  saveParams();
  const o = overlay('<div class="spinner"></div><p class="note">Awarding offseason points…</p>');
  await nextFrame();
  applyBump(state.params.seed);
  o.remove();
  render();
  toast(`New seed ${state.params.seed}`);
};

actions.undoAuto = async () => {
  if (!(await confirmBox('Undo the offseason bump? Those players return to the original file.', 'Undo'))) return;
  for (const p of vetPlayers()) { restore(p, snapOf(p)); state.awards[state.leagueIdx]?.delete(p.id); }
  delete state.auto[state.leagueIdx];
  render();
};

function applyRookieBump(seed) {
  const li = state.leagueIdx;
  const rookies = leagueRookies(league());
  // Reset only the points so summer league gains stay.
  for (const r of rookies) if (r.p.season?.ap) r.p.season.ap = [...snapOf(r.p).ap];
  const entries = rookies.map(r => ({ ...r, spend: state.params.spendCpuPoints && !isUserTeam(r.team) }));
  const awards = runRookieBump(entries, { ...state.params, seed });
  const all = (state.awards[li] ||= new Map());
  let players = 0, points = 0, mine = 0;
  for (const r of rookies) {
    const n = awards.get(r.p.id) || 0;
    all.set(r.p.id, n);
    if (n) players++;
    points += n;
    if (isUserTeam(r.team)) mine += n;
  }
  state.rookieAuto[li] = { seed, players, points, mine, total: rookies.length };
  state.dirty = true;
}

actions.runRookies = async () => {
  if (state.rookieAuto[state.leagueIdx] && !(await confirmBox('Re-roll the rookie bump? Manual changes to rookies are reset.', 'Re-roll'))) return;
  const seed = state.rookieAuto[state.leagueIdx] ? Math.floor(Math.random() * 1e6) : state.params.seed;
  applyRookieBump(seed);
  render();
};

actions.undoRookies = async () => {
  if (!(await confirmBox('Undo the rookie bump?', 'Undo'))) return;
  for (const r of leagueRookies(league())) {
    if (r.p.season?.ap) r.p.season.ap = [...snapOf(r.p).ap];
    state.awards[state.leagueIdx]?.delete(r.p.id);
  }
  delete state.rookieAuto[state.leagueIdx];
  render();
};

const awardOf = p => state.awards[state.leagueIdx]?.get(p.id) || 0;

// ---------------------------------------------------------------------------
// Offseason hub

screens.offseason = () => {
  const L = league();
  const auto = state.auto[state.leagueIdx];
  const mine = L.teams.filter(isUserTeam);
  const P = state.params;
  const bands = P.ageBands;
  layout({
    title: 'Offseason Development',
    body: `
      ${phaseWarning(L.season)}
      <fieldset class="frame"><legend>1 · Offseason Bump</legend>
        <div class="stack">
          ${auto ? `
            <dl class="info">
              <dt>Players bumped</dt><dd class="up">${auto.players} / ${auto.total}</dd>
              <dt>Points awarded</dt><dd class="up">+${auto.points}</dd>
              <dt>Your teams</dt><dd class="up">+${auto.mine}</dd>
              <dt>Regression delayed</dt><dd class="up">${auto.longevity ?? 0}</dd>
              <dt>Potential upgrades</dt><dd class="up">${auto.potUps ?? 0}</dd>
              <dt>Lost potential (injury)</dt><dd class="down">${auto.potDowns ?? 0}</dd>
              <dt>CPU points</dt><dd>${auto.spent ? 'Spent into ratings' : 'Held for the game'}</dd>
              <dt>Seed</dt><dd>${auto.seed}</dd>
            </dl>
            <button class="btn focus" data-act="nav" data-to="report">📋 View Bump Report</button>
            <div class="grid2">
              <button class="btn" data-act="reroll">🎲 Re-roll</button>
              <button class="btn" data-act="undoAuto">↺ Undo</button>
            </div>`
          : `
            <p class="note">Players aged ${bands[bands.length - 1][0]} and under (new age) earn upgrade points, more for younger players and heavier minutes. Points go into each player's Finishing / Shooting / Creating / Defense pools to spend in-game. Veterans entering regression may have it delayed a year (${P.regFirstYearChance}% chance in year one), young players get a rare potential upgrade (${P.potUpChance}%), and players who missed ${P.injuryMinGames}+ games to injury (or keep re-injuring the same thing) risk losing potential. Every team gets the same rules, so CPU teams stay even.</p>
            <button class="btn big focus" data-act="runAuto">▶ Run Offseason Bump</button>
            <button class="btn small" data-act="nav" data-to="settings">☰ Bump Settings</button>`}
        </div>
      </fieldset>
      ${rookieCard()}
      <fieldset class="frame"><legend>2 · Your Teams</legend>
        <div class="stack">
          ${mine.length ? mine.map(t => `
            <button class="btn left" data-act="nav" data-to="roster" data-arg="${t.id}">${logoImg(t)} ${esc(t.city)} ${esc(t.name)}</button>`).join('')
          : '<p class="note">No teams picked yet. Commissioner saves control every team, so tell the app which ones are yours.</p>'}
          <button class="btn small" data-act="nav" data-to="teams">👥 ${mine.length ? 'Change' : 'Pick'} Your Teams</button>
        </div>
      </fieldset>
      <fieldset class="frame"><legend>3 · Finish</legend>
        <div class="stack">
          <p class="note">Export the season file and replace the original in your Hoop Land saves folder, then continue the offseason and spend the points in-game.</p>
          <button class="btn" data-act="nav" data-to="export">💾 Export Season File</button>
        </div>
      </fieldset>`,
  });
};

function summerEligible() {
  const orig = loadOriginals();
  return leagueRookies(league())
    .filter(r => r.round > 0 || state.params.rookieIncludeUndrafted)
    .filter(r => orig[r.p.id]);
}

actions.runSummer = async () => {
  const bands = state.params.recoveryBands;
  const orig = loadOriginals();
  let players = 0, points = 0;
  for (const r of summerEligible()) {
    const g = applySummerLeague(r.p, orig[r.p.id], bands);
    const n = Object.values(g).reduce((a, b) => a + b, 0);
    if (n) { players++; points += n; }
  }
  state.summer[state.leagueIdx] = { players, points };
  state.compCache = {};
  state.dirty = true;
  render();
  toast(`Summer league: +${points} ratings across ${players} rookies`);
};

actions.undoSummer = async () => {
  if (!(await confirmBox('Undo summer league? Rookie ratings go back to their post-draft values.', 'Undo'))) return;
  for (const r of leagueRookies(league())) {
    const snap = snapOf(r.p);
    for (const k of SKILL_ATTRS) r.p.attributes[k] = [...snap.attributes[k]];
  }
  delete state.summer[state.leagueIdx];
  state.compCache = {};
  render();
};

function summerSection() {
  const L = league();
  const done = state.summer[state.leagueIdx];
  const bands = state.params.recoveryBands;
  const bandText = bands.map((b, i) => `${i === 0 ? '≤' : `${bands[i - 1][0] + 1}`}${b[0] >= 99 ? '+' : i === 0 ? b[0] : `–${b[0]}`}: +${b[1]}`).join(' · ');
  let body;
  if (done) {
    body = `<p class="note up">Applied: +${done.points} ratings across ${done.players} rookies. It's locked for this season once you export.</p>
      <button class="btn small" data-act="undoSummer">↺ Undo Summer League</button>`;
  } else if (summerDone(L)) {
    body = `<p class="note">Summer league was already applied for ${L.season.currentYear}, so it won't run again.</p>`;
  } else if (L.season.phase !== PHASE_POST_DRAFT) {
    body = `<p class="note muted">Summer league runs right after the draft (Post-Draft phase). This file is at ${esc(phaseName(L.season))}.</p>`;
  } else {
    const eligible = summerEligible();
    const total = leagueRookies(L).filter(r => r.round > 0 || state.params.rookieIncludeUndrafted).length;
    body = eligible.length
      ? `<p class="note">Older rookies win back part of the −${DRAFT_DROP} draft drop (${bandText}), never past their pre-draft rating. Pre-draft ratings found for ${eligible.length} / ${total} rookies.</p>
        <button class="btn big focus" data-act="runSummer">▶ Apply Summer League</button>`
      : `<p class="note">Summer league needs the rookies' pre-draft ratings. Load a save of this season from before the draft (it's only read, not changed).</p>`;
    if (eligible.length < total) body += `<label class="btn small">📂 Load Pre-Draft Save<input type="file" id="origInput"></label>`;
  }
  return `<fieldset class="frame"><legend>Summer League</legend><div class="stack">${body}</div></fieldset>`;
}

function rookieCard() {
  const rookies = leagueRookies(league());
  if (!rookies.length) return '';
  const r = state.rookieAuto[state.leagueIdx];
  const drafted = rookies.filter(x => x.round > 0).length;
  return summerSection() + `<fieldset class="frame"><legend>Rookie Bump</legend>
    <div class="stack">
      ${r ? `<dl class="info">
          <dt>Rookies bumped</dt><dd class="up">${r.players} / ${r.total}</dd>
          <dt>Points awarded</dt><dd class="up">+${r.points}</dd>
          <dt>Your rookies</dt><dd class="up">+${r.mine}</dd>
        </dl>
        <button class="btn focus" data-act="nav" data-to="rookies">📋 View Rookies</button>
        <div class="grid2"><button class="btn" data-act="runRookies">🎲 Re-roll</button><button class="btn" data-act="undoRookies">↺ Undo</button></div>`
      : `<p class="note">${drafted} drafted rookies${rookies.length > drafted ? ` + ${rookies.length - drafted} undrafted` : ''}. Give them a development bump in upgrade points (by age and draft round), on top of summer league.</p>
        <button class="btn big focus" data-act="runRookies">▶ Run Rookie Bump</button>
        <button class="btn small" data-act="nav" data-to="rookies">📋 View Rookies</button>`}
    </div>
  </fieldset>`;
}

screens.rookies = () => {
  const rookies = leagueRookies(league());
  layout({
    title: 'Rookie Class',
    body: `<p class="note muted small">${rookies.length} rookies by draft slot · tap to adjust</p>
      <div class="list">${rookies.map(r => {
        const d = diffPlayer(r.p, snapOf(r.p));
        const award = awardOf(r.p);
        return `<button class="prow ${isUserTeam(r.team) ? 'sel' : ''}" data-act="openPlayer" data-id="${r.p.id}">
          <span class="name">${r.pick ? `#${r.pick} ` : ''}${esc(playerName(r.p))}</span>
          <span class="right"><span class="stars">${stars(r.p.pot)}</span><br>${award ? `<span class="up">+${award} pts</span>` : '<span class="muted">—</span>'}</span>
          <span class="meta">${r.team ? esc(r.team.shortName) : 'Undrafted'} · ${r.round ? `R${r.round}` : 'FA'} · ${esc(POSITIONS[r.p.pos] ?? '')} · ${r.p.age}y · ${heightStr(r.p.ht)}</span>
          ${d.changed ? `<span class="chg">${esc([d.points ? `Summer +${d.points}: ${changeSummary(d)}` : '', apSummary(d)].filter(Boolean).join(' · '))}</span>` : ''}
        </button>`;
      }).join('')}</div>`,
  });
};

// ---------------------------------------------------------------------------
// Bump report (all teams)

screens.report = (args) => {
  const L = league();
  const groups = [
    ...L.teams.filter(isUserTeam),
    ...L.teams.filter(t => !isUserTeam(t)),
  ].map(t => ({ team: t, title: `${t.city} ${t.name}`, players: t.roster }));
  if (state.params.includeFreeAgents && L.freeAgents?.length) groups.push({ team: null, title: 'Free Agents', players: L.freeAgents });
  const gi = ((args.g ?? 0) % groups.length + groups.length) % groups.length;
  const g = groups[gi];
  const rows = g.players
    .map(p => ({ p, d: diffPlayer(p, snapOf(p)) }))
    .sort((a, b) => awardOf(b.p) - awardOf(a.p) || a.p.age - b.p.age);
  const prevT = groups[(gi - 1 + groups.length) % groups.length];
  const nextT = groups[(gi + 1) % groups.length];
  const total = rows.reduce((a, r) => a + awardOf(r.p), 0);
  layout({
    title: 'Bump Report',
    left: `<button class="nav-btn" data-act="reportNav" data-g="${gi - 1}" aria-label="Previous team">${prevT.team ? logoImg(prevT.team) : ''}◀</button>`,
    right: `<button class="nav-btn" data-act="reportNav" data-g="${gi + 1}" aria-label="Next team">▶${nextT.team ? logoImg(nextT.team) : ''}</button>`,
    body: `
      <h2 class="team-title">${g.team ? logoImg(g.team) : ''}${esc(g.title)}${isUserTeam(g.team) ? ' <span class="badge you">YOU</span>' : ''}</h2>
      <p class="note muted small">${rows.filter(r => awardOf(r.p)).length} players bumped · <span class="up">+${total}</span> points · tap a player to adjust</p>
      <div class="list">${rows.map(({ p, d }) => playerRow(p, d)).join('')}</div>`,
  });
};

actions.reportNav = d => replace('report', { g: +d.g });

function apSummary(d) {
  return CATEGORIES.map((c, i) => d.apDelta[i] ? `${c.key} ${d.apDelta[i] > 0 ? '+' : ''}${d.apDelta[i]}` : '')
    .filter(Boolean).join(' · ');
}

function playerRow(p, d) {
  const pos = POSITIONS[p.pos] ?? p.pos;
  const mpg = lastSeasonMpg(p, state.leagueIdx);
  const award = awardOf(p);
  const detail = [apSummary(d), d.points ? changeSummary(d) : ''].filter(Boolean).join(' · ');
  return `<button class="prow" data-act="openPlayer" data-id="${p.id}">
    <span class="name">${esc(playerName(p))}</span>
    <span class="right">
      <span class="stars">${stars(p.pot)}</span><br>
      ${award ? `<span class="up">+${award} pts</span>` : '<span class="muted">—</span>'}
    </span>
    <span class="meta">${esc(pos)} · ${p.age}y · ${mpg ? `${mpg.mpg.toFixed(1)} MPG` : 'DNP'} · AVG ${avgRating(p).toFixed(1)}</span>
    ${d.changed ? `<span class="chg">${esc(detail)} ${skillBadges(d)}${longevityBadges(p, d)}</span>` : ''}
  </button>`;
}

function injuryBadge(p) {
  const r = injuryRisk(p, lastSeasonYear(), state.params);
  return r ? `<span class="badge down-b">${esc(injuryName(r.worst))} · ${r.cls}</span>` : '';
}

function longevityBadges(p, d) {
  return (d.regDelta ? `<span class="badge lvl">Regress ${p.regressionAge - d.regDelta + 1}→${p.regressionAge + 1}</span>` : '') +
    (d.potDelta > 0 ? '<span class="badge new">POT ▲</span>' : d.potDelta < 0 ? '<span class="badge down-b">POT ▼ injury</span>' : '') +
    injuryBadge(p);
}

actions.openPlayer = d => go('player', { id: +d.id });

// ---------------------------------------------------------------------------
// Your team roster

screens.roster = (args) => {
  const L = league();
  const mine = L.teams.filter(isUserTeam);
  if (!mine.length) { replace('teams'); return; }
  let idx = mine.findIndex(t => t.id === +args.arg);
  if (idx < 0) idx = 0;
  const t = mine[idx];
  const rows = t.roster.map(p => ({ p, d: diffPlayer(p, snapOf(p)) }));
  const pts = rows.reduce((a, r) => a + r.d.apDelta.reduce((x, y) => x + y, 0), 0);
  const many = mine.length > 1;
  const prevT = mine[(idx - 1 + mine.length) % mine.length];
  const nextT = mine[(idx + 1) % mine.length];
  layout({
    title: 'Team Roster',
    left: many ? `<button class="nav-btn" data-act="nav" data-to="roster" data-arg="${prevT.id}" aria-label="Previous team">${logoImg(prevT)}◀</button>` : '',
    right: many ? `<button class="nav-btn" data-act="nav" data-to="roster" data-arg="${nextT.id}" aria-label="Next team">▶${logoImg(nextT)}</button>` : '',
    body: `
      <h2 class="team-title">${logoImg(t)}${esc(t.city)} ${esc(t.name)}</h2>
      <p class="note">${state.auto[state.leagueIdx] ? `Offseason points added: <span class="up">+${pts}</span>. Tap a player to adjust.` : 'Run the offseason bump first, or tap a player to add points by hand.'}</p>
      <div class="list">${rows.map(({ p, d }) => playerRow(p, d)).join('')}</div>`,
  });
};

// ---------------------------------------------------------------------------
// Player editor

screens.player = (args) => {
  const e = findPlayer(args.id);
  if (!e) { back(); return; }
  const { p, team } = e;
  const snap = snapOf(p);
  const d = diffPlayer(p, snap);
  const ceilMode = !!args.ceil;
  const mpg = lastSeasonMpg(p, state.leagueIdx);
  const ownedOrig = new Set(snap.skills.filter(s => s.level >= 1).map(s => s.id));
  const pos = POSITIONS[p.pos] ?? p.pos;
  layout({
    title: 'Player Development',
    body: `
      <div>
        <h2 class="team-title">${team ? logoImg(team) : ''}${esc(playerName(p))}</h2>
        <p class="note">${esc(team ? `${team.city} ${team.name}` : 'Free Agent')} · ${esc(pos)} · Age ${p.age} · ${heightStr(p.ht)} · <span class="stars">${stars(p.pot)}</span></p>
        <p class="note muted small">${esc(p.arc || '')}${mpg ? ` · ${mpg.yr}: ${mpg.mpg.toFixed(1)} MPG in ${mpg.gp} games` : ''}</p>
      </div>
      ${p.season?.ap ? `<fieldset class="frame"><legend>Upgrade Points</legend>
        <div class="stack">
          ${CATEGORIES.map((c, i) => `<div class="pts-row">
            <span class="grow">${esc(c.name)} <span class="muted small">${c.attrs.join(' · ')}</span></span>
            <button class="btn square" data-act="ap" data-i="${i}" data-dir="-1" aria-label="Fewer ${esc(c.name)} points">−</button>
            <span class="pts-val ${p.season.ap[i] ? 'gold' : 'muted'}">${p.season.ap[i]}${d.apDelta[i] ? `<span class="small ${d.apDelta[i] > 0 ? 'up' : 'down'}"> ${d.apDelta[i] > 0 ? '+' : ''}${d.apDelta[i]}</span>` : ''}</span>
            <button class="btn square" data-act="ap" data-i="${i}" data-dir="1" aria-label="More ${esc(c.name)} points">+</button>
          </div>`).join('')}
        </div>
        <p class="note muted small" style="margin-top:8px">Spent in-game. Green = added this offseason${awardOf(p) ? ` (bump gave +${awardOf(p)})` : ''}.</p>
      </fieldset>` : ''}
      <fieldset class="frame"><legend>Longevity &amp; Potential</legend>
        <div class="stack">
          <div class="pts-row">
            <span class="grow">Regression age<br><span class="muted small">${regressionText(p)}</span></span>
            <button class="btn square" data-act="regAge" data-dir="-1" aria-label="Earlier regression">−</button>
            <span class="pts-val ${d.regDelta ? 'gold' : ''}">${p.regressionAge}${d.regDelta ? `<span class="small up"> ${d.regDelta > 0 ? '+' : ''}${d.regDelta}</span>` : ''}</span>
            <button class="btn square" data-act="regAge" data-dir="1" aria-label="Later regression">+</button>
          </div>
          <div class="pts-row">
            <span class="grow">Potential<br><span class="stars">${stars(p.pot)}</span>${injuryText(p)}</span>
            <button class="btn square" data-act="potAdj" data-dir="-1" aria-label="Lower potential">−</button>
            <span class="pts-val ${d.potDelta ? 'gold' : ''}">${p.pot}${d.potDelta ? `<span class="small up"> ${d.potDelta > 0 ? '+' : ''}${d.potDelta}</span>` : ''}</span>
            <button class="btn square" data-act="potAdj" data-dir="1" aria-label="Higher potential">+</button>
          </div>
        </div>
      </fieldset>
      <div class="row">
        <p class="note grow">Rating changes: <span class="${d.points > 0 ? 'up' : d.points < 0 ? 'down' : ''}">${d.points > 0 ? '+' : ''}${d.points}</span></p>
        <button class="btn small ${ceilMode ? 'on focus' : 'off'}" data-act="ceilMode">Edit Ceilings</button>
      </div>
      <fieldset class="frame"><legend>Ratings</legend>
        <div class="stack">
          ${ATTRS.map(k => attrRow(p, snap, k, ceilMode)).join('')}
        </div>
        <p class="note muted small" style="margin-top:10px">Bar = current rating, green = gained this offseason, gold mark = ceiling. Raising a rating past its ceiling lifts the ceiling with it.</p>
      </fieldset>
      <fieldset class="frame"><legend>Skills (${activeSkills(p).length})</legend>
        <div class="stack">
          ${p.skills.map((s, i) => s.level < 1 ? '' : `
            <div class="skill ${ownedOrig.has(s.id) ? '' : 'added'}">
              <div><span class="code">${esc(s.id)}</span> <span class="hint">${esc(skillHint(s.id))}</span></div>
              <div class="ctrls">
                <button class="btn ${s.equipped ? 'on' : 'off'}" data-act="equip" data-i="${i}" aria-label="Toggle equipped">${s.equipped ? 'ON' : 'OFF'}</button>
                ${isLeveled(s.id) ? `
                <button class="btn" data-act="skillLv" data-i="${i}" data-dir="-1" aria-label="Level down">−</button>
                <span class="lv">Lv ${s.level}</span>
                <button class="btn" data-act="skillLv" data-i="${i}" data-dir="1" aria-label="Level up">+</button>` : '<span class="lv muted small">No levels</span>'}
                <button class="btn" data-act="skillDel" data-i="${i}" aria-label="Remove skill">✕</button>
              </div>
            </div>`).join('')}
          ${activeSkills(p).length ? '' : '<p class="note muted">No skills.</p>'}
          <button class="btn" data-act="addSkill">＋ Add Skill</button>
        </div>
      </fieldset>
      <div class="grid2">
        <button class="btn" data-act="autoOne">🎲 Re-roll Bump</button>
        <button class="btn" data-act="revertOne">↺ Revert</button>
      </div>`,
    action: { act: 'back', label: 'Done' },
  });
};

function attrRow(p, snap, k, ceilMode) {
  const [cur, ceil] = p.attributes[k];
  const orig = snap.attributes[k][0];
  const delta = cur - orig;
  const base = Math.min(cur, orig);
  return `<div class="attr">
    <button class="btn square" data-act="attr" data-k="${k}" data-dir="-1" aria-label="Lower ${ATTR_NAMES[k]}">−</button>
    <div class="body">
      <div class="top">
        <span class="lbl">${k} <span class="muted">${ATTR_NAMES[k]}</span></span>
        <span>${cur}${delta ? ` <span class="${delta > 0 ? 'up' : 'down'}">(${delta > 0 ? '+' : ''}${delta})</span>` : ''} <span class="gold">/ ${ceil}</span></span>
      </div>
      <div class="bar">
        <div class="fill" style="width:${base / ATTR_MAX * 100}%"></div>
        ${delta > 0 ? `<div class="gain" style="left:${orig / ATTR_MAX * 100}%;width:${delta / ATTR_MAX * 100}%"></div>` : ''}
        <div class="ceil" style="left:calc(${Math.min(ceil, ATTR_MAX) / ATTR_MAX * 100}% - 2px)"></div>
      </div>
    </div>
    <button class="btn square" data-act="attr" data-k="${k}" data-dir="1" aria-label="Raise ${ATTR_NAMES[k]}">${ceilMode ? '⇡' : '+'}</button>
  </div>`;
}

function currentPlayer() {
  const a = state.stack[state.stack.length - 1].args;
  return findPlayer(a.id)?.p;
}

actions.ceilMode = () => {
  const a = state.stack[state.stack.length - 1].args;
  replace('player', { ...a, ceil: !a.ceil });
};

actions.attr = d => {
  const p = currentPlayer();
  const a = state.stack[state.stack.length - 1].args;
  const v = p.attributes[d.k];
  const dir = +d.dir;
  if (a.ceil) {
    v[1] = Math.max(v[0], Math.min(ATTR_MAX, v[1] + dir));
  } else {
    v[0] = Math.max(attrMin(d.k), Math.min(ATTR_MAX, v[0] + dir));
    if (v[0] > v[1]) v[1] = v[0];
  }
  state.dirty = true;
  render();
};

const CLASS_LABEL = {
  standard: 'standard',
  nagging: 'nagging (held back)',
  structural: 'structural',
};

function injuryText(p) {
  const yr = lastSeasonYear();
  const r = injuryRisk(p, yr, state.params);
  if (!r) return '';
  const w = r.worst;
  const linger = [r.sameType ? `${r.sameType}× same injury` : '', r.sameArea ? `${r.sameArea}× same area` : ''].filter(Boolean).join(', ');
  return `<br><span class="small down">${yr}: ${esc(injuryName(w))}, ${r.games} games out · ${CLASS_LABEL[r.cls]}${linger ? ` · recurring: ${linger}` : ''}${r.chance ? ` · ${Math.round(r.chance)}% risk` : ''}</span>`;
}

function regressionText(p) {
  const y = regressionYear(p);
  if (y < 1) return `Declines after age ${p.regressionAge} (${-y + 1} season${-y + 1 === 1 ? '' : 's'} away)`;
  return y === 1 ? `First season of decline (age ${p.age})` : `Season ${y} of decline (age ${p.age})`;
}

actions.regAge = d => {
  const p = currentPlayer();
  p.regressionAge = Math.max(25, Math.min(45, p.regressionAge + +d.dir));
  state.dirty = true;
  render();
};

actions.potAdj = d => {
  const p = currentPlayer();
  p.pot = Math.max(POT_MIN, Math.min(POT_MAX, p.pot + +d.dir));
  state.dirty = true;
  render();
};

actions.ap = d => {
  const p = currentPlayer();
  const i = +d.i;
  p.season.ap[i] = Math.max(0, p.season.ap[i] + +d.dir);
  state.dirty = true;
  render();
};

actions.equip = d => {
  const s = currentPlayer().skills[+d.i];
  s.equipped = !s.equipped;
  state.dirty = true;
  render();
};

actions.skillLv = d => {
  const s = currentPlayer().skills[+d.i];
  s.level = Math.max(1, Math.min(SKILL_MAX_LEVEL, s.level + +d.dir));
  state.dirty = true;
  render();
};

actions.skillDel = async d => {
  const p = currentPlayer();
  const s = p.skills[+d.i];
  if (!(await confirmBox(`Remove ${esc(s.id)} from ${esc(playerName(p))}? Its XP is kept.`, 'Remove'))) return;
  if (snapOf(p).skills.some(x => x.id === s.id)) { s.level = 0; s.equipped = false; }
  else p.skills.splice(+d.i, 1);
  state.dirty = true;
  render();
};

function lockedXp(p, id) {
  const s = p.skills.find(x => x.id === id && x.level < 1);
  return s ? s.xp : 0;
}

actions.addSkill = () => {
  const p = currentPlayer();
  const ranked = rankSkillsFor(p, state.profiles[state.leagueIdx]);
  const o = overlay(`
    <p class="note">Add a skill to ${esc(playerName(p))}<br><span class="muted small">Sorted by fit with their ratings</span></p>
    <div class="stack" style="max-height:55vh;overflow:auto">
      ${ranked.map(s => `<button class="btn left" data-id="${esc(s.id)}">
        <span class="code" style="font-family:var(--pixel)">${esc(s.id)}</span>
        <span class="muted small" style="flex:1;text-align:left">${esc(skillHint(s.id))}</span>
        ${lockedXp(p, s.id) ? `<span class="muted small">${lockedXp(p, s.id)} xp</span>` : ''}
        <span class="${s.fit > 0.3 ? 'up' : s.fit > 0 ? '' : 'muted'}">${Math.round(Math.max(0, s.fit) * 100)}%</span>
      </button>`).join('') || '<p class="note">Already has every skill.</p>'}
    </div>
    <button class="btn off" data-close>Cancel</button>`);
  o.addEventListener('click', e => {
    const b = e.target.closest('[data-id],[data-close]');
    if (!b) return;
    if (b.dataset.id) {
      unlockSkill(p, b.dataset.id);
      state.dirty = true;
    }
    o.remove();
    render();
  });
};

actions.autoOne = () => {
  const li = state.leagueIdx;
  const e = findPlayer(state.stack[state.stack.length - 1].args.id);
  restore(e.p, snapOf(e.p));
  const awards = runProgression([{ ...e, leagueIdx: li, spend: state.params.spendCpuPoints && !isUserTeam(e.team) }],
    { ...state.params, seed: Math.floor(Math.random() * 1e6) }, state.profiles[li]);
  (state.awards[li] ||= new Map()).set(e.p.id, awards.get(e.p.id));
  state.dirty = true;
  render();
};

actions.revertOne = () => {
  const p = currentPlayer();
  restore(p, snapOf(p));
  state.awards[state.leagueIdx]?.set(p.id, 0);
  render();
  toast('Reverted to original');
};

// ---------------------------------------------------------------------------
// Settings

const STEP_FIELDS = {
  general: [
    ['seed', 'Random Seed', 1, 0, 999999],
    ['starterMpg', 'Starter MPG (bonus)', 1, 0, 48],
    ['benchMpg', 'Bench MPG (penalty below)', 1, 0, 48],
    ['regFirstYearChance', 'Delay Regression: 1st Year %', 5, 0, 100],
    ['regLaterChance', 'Delay Regression: Later Years %', 5, 0, 100],
    ['potUpChance', 'Potential Upgrade %', 1, 0, 100],
    ['potUpMaxAge', 'Potential Upgrade Max Age', 1, 18, 40],
    ['injuryMinGames', 'Injury: Min Games Missed', 1, 0, 82],
    ['injuryPotPerGame', 'Injury: % Risk Per Game', 0.1, 0, 2],
    ['injuryPotMax', 'Injury: Max Risk %', 5, 0, 100],
    ['injuryLowerBodyMult', 'Injury: Lower-Body Multiplier', 0.1, 1, 2],
    ['injuryLongevityCut', 'Injury: Cut To Regression Delay %', 5, 0, 100],
    ['naggingRiskMult', 'Nagging Injury: Risk ×', 0.05, 1, 3],
    ['naggingPointsMult', 'Nagging Injury: Bump Points ×', 0.05, 0, 1],
    ['structuralRiskMult', 'Structural Injury: Risk ×', 0.05, 1, 3],
    ['structuralLongevityCut', 'Structural: Cut To Regression Delay %', 5, 0, 100],
  ],
  skills: [
    ['newSkillChance', 'New Skill Chance %', 5, 0, 100],
    ['skillMaxAge', 'New Skill Max Age', 1, 18, 45],
    ['skillMinPoints', 'Min Points For New Skill', 1, 0, 20],
    ['maxSkills', 'Max Skills Per Player', 1, 0, 24],
    ['levelUpChance', 'Skill Level-Up Chance %', 5, 0, 100],
    ['levelUpMaxAge', 'Level-Up Max Age', 1, 18, 45],
  ],
};

function stepper(label, act, data, value) {
  return `<fieldset class="frame"><legend>${esc(label)}</legend>
    <div class="stepper">
      <button class="btn square" data-act="${act}" ${data} data-dir="-1" aria-label="Decrease">−</button>
      <div class="val">${esc(value)}</div>
      <button class="btn square" data-act="${act}" ${data} data-dir="1" aria-label="Increase">+</button>
    </div></fieldset>`;
}

function options(label, key, opts) {
  const v = state.params[key];
  return `<fieldset class="frame"><legend>${esc(label)}</legend><div class="opts">
    ${opts.map(([val, text]) => `<button class="btn ${v === val ? 'on focus' : 'off'}" data-act="setOpt" data-k="${key}" data-v='${JSON.stringify(val)}'>${esc(text)}</button>`).join('')}
  </div></fieldset>`;
}

screens.settings = (args) => {
  const tab = args.tab || 'general';
  const P = state.params;
  let body = '';
  if (tab === 'general') {
    body = `
      ${state.data && state.data.seasonLeagues.length > 1 ? `<fieldset class="frame"><legend>League</legend><div class="opts">
        ${state.data.seasonLeagues.map((L, i) => `<button class="btn ${i === state.leagueIdx ? 'on focus' : 'off'}" data-act="setLeague" data-i="${i}">${esc(L.shortName)}</button>`).join('')}
      </div></fieldset>` : ''}
      ${options('Include Free Agents', 'includeFreeAgents', [[false, 'Off'], [true, 'On']])}
      ${options('CPU Points', 'spendCpuPoints', [[false, 'Hold for Game'], [true, 'Spend Now']])}
      <p class="note muted small">Commissioner saves: the CPU holds points unless in-game auto progression is on. "Spend Now" applies CPU points to ratings in this app instead.</p>
      ${options('Point Focus', 'strengthBias', [[0, 'Room to Grow'], [0.5, 'Balanced'], [1, 'Strengths']])}
      ${STEP_FIELDS.general.map(([k, l, s]) => stepper(l, 'step', `data-k="${k}" data-s="${s}"`, P[k])).join('')}
      ${options('Starter Multiplier', 'starterMult', [[1, '×1.0'], [1.25, '×1.25'], [1.5, '×1.5']])}
      ${options('Bench Multiplier', 'benchMult', [[0.5, '×0.5'], [0.75, '×0.75'], [1, '×1.0']])}`;
  } else if (tab === 'ages') {
    let lo = 0;
    body = `<p class="note">Upgrade points each player earns this offseason, by age (before the minutes multiplier). Players older than the last band get nothing.</p>` +
      P.ageBands.map((b, i) => {
        const label = `Age ${lo === 0 ? 'up to ' : `${lo}–`}${b[0]}`;
        lo = b[0] + 1;
        return `<fieldset class="frame"><legend>${label}</legend>
          <div class="grid2">
            <div><p class="note muted small center">Min pts</p><div class="stepper">
              <button class="btn square" data-act="band" data-i="${i}" data-j="1" data-dir="-1" aria-label="Decrease">−</button>
              <div class="val">${b[1]}</div>
              <button class="btn square" data-act="band" data-i="${i}" data-j="1" data-dir="1" aria-label="Increase">+</button></div></div>
            <div><p class="note muted small center">Max pts</p><div class="stepper">
              <button class="btn square" data-act="band" data-i="${i}" data-j="2" data-dir="-1" aria-label="Decrease">−</button>
              <div class="val">${b[2]}</div>
              <button class="btn square" data-act="band" data-i="${i}" data-j="2" data-dir="1" aria-label="Increase">+</button></div></div>
          </div>
          <div class="stepper" style="margin-top:8px">
            <button class="btn square" data-act="band" data-i="${i}" data-j="0" data-dir="-1" aria-label="Decrease">−</button>
            <div class="val small">Up to age ${b[0]}</div>
            <button class="btn square" data-act="band" data-i="${i}" data-j="0" data-dir="1" aria-label="Increase">+</button></div>
        </fieldset>`;
      }).join('');
  } else if (tab === 'rookies') {
    let lo = 0;
    body = `<p class="note">Rookie bump after the draft: upgrade points by age, times a multiplier by draft round.</p>` +
      P.rookieBands.map((b, i) => {
        const last = i === P.rookieBands.length - 1;
        const label = last ? `Age ${lo}+` : `Age ${lo === 0 ? 'up to ' : `${lo}–`}${b[0]}`;
        lo = b[0] + 1;
        const st = (j, v, lbl) => `<div><p class="note muted small center">${lbl}</p><div class="stepper">
          <button class="btn square" data-act="rband" data-i="${i}" data-j="${j}" data-dir="-1" aria-label="Decrease">−</button>
          <div class="val">${v}</div>
          <button class="btn square" data-act="rband" data-i="${i}" data-j="${j}" data-dir="1" aria-label="Increase">+</button></div></div>`;
        return `<fieldset class="frame"><legend>${label}</legend><div class="grid2">${st(1, b[1], 'Min pts')}${st(2, b[2], 'Max pts')}</div></fieldset>`;
      }).join('') +
      `<fieldset class="frame"><legend>Summer League Recovery</legend><div class="stack">${P.recoveryBands.map((b, i) => `<div class="pts-row">
        <span class="grow">Age ${i === 0 ? `up to ${b[0]}` : b[0] >= 99 ? `${P.recoveryBands[i - 1][0] + 1}+` : `${P.recoveryBands[i - 1][0] + 1}–${b[0]}`}</span>
        <button class="btn square" data-act="recBand" data-i="${i}" data-dir="-1" aria-label="Less recovery">−</button>
        <span class="pts-val">+${b[1]}</span>
        <button class="btn square" data-act="recBand" data-i="${i}" data-dir="1" aria-label="More recovery">+</button></div>`).join('')}
        <p class="note muted small">Draft-drop points won back right after the draft (of the −${DRAFT_DROP}, at most +2).</p></div></fieldset>` +
      options('1st Round', 'rookieR1Mult', [[1, '×1.0'], [1.25, '×1.25'], [1.5, '×1.5']]) +
      options('2nd Round', 'rookieR2Mult', [[0.75, '×0.75'], [1, '×1.0'], [1.25, '×1.25']]) +
      options('Undrafted Rookies', 'rookieIncludeUndrafted', [[false, 'Skip'], [true, 'Include']]) +
      options('Undrafted Multiplier', 'rookieUndraftedMult', [[0.5, '×0.5'], [0.75, '×0.75'], [1, '×1.0']]);
  } else {
    body = `<p class="note">Optional: let the bump also unlock or level up skills. Off (0%) by default.</p>` +
      STEP_FIELDS.skills.map(([k, l, s]) => stepper(l, 'step', `data-k="${k}" data-s="${s}"`, P[k])).join('') +
      `<p class="note muted small">New skills are chosen to fit each player's strongest ratings.</p>`;
  }
  layout({
    title: 'Bump Settings',
    body: `
      <div class="tabs">
        ${[['general', 'General'], ['ages', 'Ages'], ['rookies', 'Rookies'], ['skills', 'Skills']].map(([k, l]) =>
          `<button class="btn ${k === tab ? 'on focus' : 'off'}" data-act="setTab" data-t="${k}">${l}</button>`).join('')}
      </div>
      ${body}
      ${state.auto[state.leagueIdx] ? '<p class="note gold small">The bump already ran. Changes apply the next time you run or re-roll it.</p>' : ''}`,
    action: { act: 'resetParams', label: 'Defaults' },
  });
};

actions.setTab = d => replace('settings', { tab: d.t });
actions.setOpt = d => {
  state.params[d.k] = JSON.parse(d.v);
  if (d.k === 'lotteryFormat' && state.data) { draftState().lottery = null; draftState().mock = null; }
  saveParams();
  render();
};
actions.step = d => {
  const f = [...STEP_FIELDS.general, ...STEP_FIELDS.skills].find(x => x[0] === d.k);
  state.params[d.k] = Math.round(Math.max(f[3], Math.min(f[4], state.params[d.k] + f[2] * +d.dir)) * 100) / 100;
  saveParams();
  render();
};
actions.band = d => {
  const bands = state.params.ageBands;
  const b = bands[+d.i];
  const j = +d.j;
  b[j] = Math.max(0, Math.min(j === 0 ? 60 : 20, b[j] + +d.dir));
  if (j === 1 && b[1] > b[2]) b[2] = b[1];
  if (j === 2 && b[2] < b[1]) b[1] = b[2];
  if (j === 0) {
    const prev = bands[+d.i - 1]?.[0] ?? 15;
    const next = bands[+d.i + 1]?.[0] ?? 99;
    b[0] = Math.max(prev + 1, Math.min(next - 1, b[0]));
  }
  saveParams();
  render();
};
actions.recBand = d => {
  const b = state.params.recoveryBands[+d.i];
  b[1] = Math.max(0, Math.min(2, b[1] + +d.dir)); // capped at +2
  state.compCache = {};
  saveParams();
  render();
};
actions.rband = d => {
  const b = state.params.rookieBands[+d.i];
  const j = +d.j;
  b[j] = Math.max(0, Math.min(20, b[j] + +d.dir));
  if (j === 1 && b[1] > b[2]) b[2] = b[1];
  if (j === 2 && b[2] < b[1]) b[1] = b[2];
  saveParams();
  render();
};
actions.resetParams = async () => {
  if (!(await confirmBox('Reset all bump settings to defaults?', 'Reset'))) return;
  state.params = structuredClone(DEFAULT_PARAMS);
  saveParams();
  render();
};
actions.setLeague = d => {
  state.leagueIdx = +d.i;
  loadUserTeams();
  render();
};

// ---------------------------------------------------------------------------
// Draft room

function draftState() {
  const li = state.leagueIdx;
  return (state.draft[li] ||= { lottery: null, mock: null, trades: [] });
}

function compPool() {
  const li = state.leagueIdx;
  return (state.compPools[li] ||= buildCompPool(league()));
}

function compsFor(p) {
  const cache = (state.compCache[state.leagueIdx] ||= new Map());
  if (!cache.has(p.id)) cache.set(p.id, prospectComps(p, compPool(), state.params.recoveryBands));
  return cache.get(p.id);
}

function rookieCompsFor(p) {
  const cache = (state.compCache[state.leagueIdx] ||= new Map());
  const key = `r${p.id}`;
  const pending = !state.summer[state.leagueIdx] && !summerDone();
  const orig = pending ? loadOriginals()[p.id] : null;
  if (!cache.has(key)) cache.set(key, rookieComps(p, compPool(), orig, state.params.recoveryBands));
  return cache.get(key);
}

const avg = v => v.reduce((a, b) => a + b, 0) / v.length;
const posName = p => POSITIONS[p.pos] ?? p.pos;

function boardOrder() {
  const bands = state.params.recoveryBands;
  return [...league().draftClass].sort((a, b) => prospectValue(b, bands) - prospectValue(a, bands));
}

function draftedMap() {
  const m = new Map();
  for (const pk of draftState().mock?.picks || []) if (pk.pid != null) m.set(pk.pid, pk);
  return m;
}

const DRAFT_TABS = [['board', 'Board'], ['lottery', 'Lottery'], ['mock', 'Mock'], ['trades', 'Trades']];

screens.draft = (args) => {
  const L = league();
  const tab = args.tab || 'board';
  if (!L.draftClass?.length && tab !== 'trades') {
    const rookies = leagueRookies(L);
    layout({
      title: 'Draft Room',
      body: rookies.length ? `
        <div class="tabs"><button class="btn on focus">Rookie Class</button><button class="btn off" data-act="draftTab" data-t="trades">Trades</button></div>
        <p class="note muted small">The draft is done. Floor = ratings after the −${DRAFT_DROP} drop${state.summer[state.leagueIdx] || summerDone() ? ' and summer league' : ' plus projected summer league recovery (when pre-draft ratings are known)'}; ceiling = top ratings.</p>
        <div class="list">${rookies.map(r => {
          const c = rookieCompsFor(r.p);
          return `<button class="prow ${isUserTeam(r.team) ? 'sel' : ''}" data-act="openPlayer" data-id="${r.p.id}">
            <span class="name">${r.pick ? `#${r.pick} ` : ''}${esc(playerName(r.p))}</span>
            <span class="right"><span class="stars">${stars(r.p.pot)}</span><br><span class="small">${r.team ? esc(r.team.shortName) : 'FA'}</span></span>
            <span class="meta">${esc(posName(r.p))} · ${r.p.age}y · ${heightStr(r.p.ht)}</span>
            <span class="chg">Floor: ${esc(c.floor[0]?.name || '—')} · Ceiling: <span class="up">${esc(c.ceiling[0]?.name || '—')}</span></span>
          </button>`;
        }).join('')}</div>`
      : `<p class="note">This file has no draft class yet. Prospects appear once the offseason starts (before the lottery).</p>
        <button class="btn" data-act="draftTab" data-t="trades">Pick Trades</button>`,
    });
    return;
  }
  const tabs = `<div class="tabs">${DRAFT_TABS.map(([k, l]) =>
    `<button class="btn ${k === tab ? 'on focus' : 'off'}" data-act="draftTab" data-t="${k}">${l}</button>`).join('')}</div>`;
  const body = { board: draftBoard, lottery: draftLottery, mock: draftMock, trades: draftTrades }[tab](args);
  layout({ title: 'Draft Room', body: tabs + body.html, action: body.action });
};

actions.draftTab = d => replace('draft', { tab: d.t });

function draftBoard() {
  const drafted = draftedMap();
  const rows = boardOrder();
  return {
    html: `
      <p class="note muted small">${rows.length} prospects · ranked by projection · Rookie = projected average skill rating after the −${DRAFT_DROP} draft drop (min ${DRAFT_FLOOR}) and age-based summer league recovery. Ceiling totals are capped league-wide, so comps show the shape of each ceiling.</p>
      <div class="list">${rows.map((p, i) => {
        const fl = avg(floorVector(p, state.params.recoveryBands));
        const c = compsFor(p);
        const pk = drafted.get(p.id);
        return `<button class="prow" data-act="openProspect" data-id="${p.id}">
          <span class="name">${i + 1}. ${esc(playerName(p))}</span>
          <span class="right"><span class="stars">${stars(p.pot)}</span><br>
            ${pk ? `<span class="badge">#${pk.overall} ${esc(pk.ownerShort)}</span>` : `<span class="small muted">Rookie</span> <span class="small">${fl.toFixed(1)}</span>`}</span>
          <span class="meta">${esc(posName(p))} · ${p.age}y · ${heightStr(p.ht)} · ${esc(p.home || '')}</span>
          <span class="chg">Floor: ${esc(c.floor[0]?.name || '—')} · Ceiling: <span class="up">${esc(c.ceiling[0]?.name || '—')}</span></span>
        </button>`;
      }).join('')}</div>`,
  };
}

actions.openProspect = d => go('prospect', { id: +d.id });

screens.prospect = (args) => {
  const p = league().draftClass.find(x => x.id === args.id);
  if (!p) { back(); return; }
  const c = compsFor(p);
  const rec = recoveryFor(p.age, state.params.recoveryBands);
  const fv = floorVector(p, state.params.recoveryBands), cv = ceilingVector(p);
  const compList = (list, cls) => list.map(x => `<div class="comp">
    <span class="grow"><b class="${cls}">${esc(x.name)}</b><br><span class="muted small">${esc(x.group)} · ${esc(POSITIONS[x.pos] ?? '')} · ${heightStr(x.ht)}</span></span>
    <span class="sim">${x.sim}<span class="small muted">%</span></span></div>`).join('');
  layout({
    title: 'Prospect',
    body: `
      <div>
        <h2 class="team-title">${esc(playerName(p))}</h2>
        <p class="note">${esc(posName(p))} · Age ${p.age} · ${heightStr(p.ht)} · ${p.wt} lb · <span class="stars">${stars(p.pot)}</span></p>
        <p class="note muted small">${esc(p.home || '')}${p.history?.coll ? ' · College' : ''}</p>
      </div>
      <div class="grid2">
        <fieldset class="frame"><legend>Floor</legend>${compList(c.floor, '')}</fieldset>
        <fieldset class="frame"><legend>Ceiling</legend>${compList(c.ceiling, 'up')}</fieldset>
      </div>
      <fieldset class="frame"><legend>Ratings</legend>
        <div class="rk-head"><span></span><span>Now</span><span>Rookie</span><span>Ceiling</span></div>
        ${SKILL_ATTRS.map((k, i) => `<div class="rk">
          <span>${k} <span class="muted small">${ATTR_NAMES[k]}</span></span>
          <span>${p.attributes[k][0]}</span>
          <span class="${fv[i] < p.attributes[k][0] ? 'down' : ''}">${fv[i]}${fv[i] < p.attributes[k][0] ? `<span class="small"> −${p.attributes[k][0] - fv[i]}</span>` : ''}</span>
          <span class="up">${cv[i]}</span>
          <div class="bar"><div class="fill" style="width:${fv[i] / ATTR_MAX * 100}%"></div><div class="gain" style="left:${fv[i] / ATTR_MAX * 100}%;width:${(cv[i] - fv[i]) / ATTR_MAX * 100}%"></div></div>
        </div>`).join('')}
        ${PHYSICAL.map(k => `<div class="rk"><span>${k} <span class="muted small">${ATTR_NAMES[k]}</span></span><span>${p.attributes[k][0]}</span><span>${p.attributes[k][0]}</span><span class="up">${p.attributes[k][1]}</span></div>`).join('')}
        <p class="note muted small" style="margin-top:8px">Rookie = projected line after the −${DRAFT_DROP} draft drop (min ${DRAFT_FLOOR}) and summer league (+${rec} back at age ${p.age}, never past today's rating): projected loss ${fv.reduce((a, v, i) => a + p.attributes[SKILL_ATTRS[i]][0] - v, 0)} points. The floor comps match this line and height against active players, free agents, retirees and Hall of Famers.</p>
      </fieldset>`,
  });
};

// ---- Lottery

function draftLottery() {
  const L = league();
  const ds = draftState();
  const P = state.params;
  const setup = lotterySetup(L, P.lotteryFormat, P.lotteryDraws);
  const draws = setup.draws;
  const odds = lotteryOdds(L, P.lotteryFormat, P.lotteryDraws, 5000, 1);
  const { table } = setup;
  const rec = new Map(table.map(r => [r.team.id, r]));
  const totalW = odds.reduce((a, r) => a + r.weight, 0) || 1;
  const actual = lotteryDone(L);
  const result = actual
    ? actualDraftOrder(L).filter(o => o.rd === 1).slice(0, setup.lotteryTeams.length)
        .map(o => ({ team: o.orig, seed: setup.lotteryTeams.indexOf(o.orig) }))
    : ds.lottery;
  if (actual) return {
    html: `<fieldset class="frame"><legend>Lottery Result</legend>
      <p class="note muted small" style="margin-bottom:8px">The lottery has been drawn in this save. The mock draft uses this order.</p>
      <div class="list">${result.map((r, i) => {
        const move = r.seed - i;
        const rr = rec.get(r.team.id);
        return `<div class="lot-row ${isUserTeam(r.team) ? 'mine' : ''}"><span class="pk">${i + 1}</span>${logoImg(r.team)}<span class="grow">${esc(r.team.shortName)} <span class="muted small">${rr.W}-${rr.L}</span></span>
          ${move > 0 ? `<span class="up">▲${move}</span>` : move < 0 ? `<span class="down">▼${-move}</span>` : '<span class="muted">—</span>'}</div>`;
      }).join('')}</div>
      <button class="btn" data-act="draftTab" data-t="mock" style="margin-top:10px">▶ Mock Draft</button></fieldset>`,
  };
  return {
    html: `
      ${options('Lottery Format', 'lotteryFormat', [['auto', 'Auto'], ['321', '3-2-1'], ['classic', 'Classic']])}
      ${setup.format === '321'
        ? `<p class="note muted small">${P.lotteryFormat === 'auto' ? 'Detected from your league settings. ' : ''}3-2-1 lottery (NBA 2027+): all ${draws} lottery picks are drawn; the 3 worst teams pick no lower than #12.</p>`
        : `<div class="stepper">
        <button class="btn square" data-act="lotteryDraws" data-dir="-1" aria-label="Fewer picks drawn">−</button>
        <div class="val small">Top ${draws} pick${draws > 1 ? 's' : ''} drawn</div>
        <button class="btn square" data-act="lotteryDraws" data-dir="1" aria-label="More picks drawn">+</button>
      </div>`}
      <button class="btn big focus" data-act="simLottery">🎲 Simulate Lottery</button>
      ${result ? `<fieldset class="frame"><legend>Lottery Result</legend><div class="list">
        ${result.map((r, i) => {
          const move = r.seed - i;
          return `<div class="lot-row ${isUserTeam(r.team) ? 'mine' : ''}"><span class="pk">${i + 1}</span>${logoImg(r.team)}<span class="grow">${esc(r.team.shortName)} <span class="muted small">${rec.get(r.team.id).W}-${rec.get(r.team.id).L}</span></span>
            ${move > 0 ? `<span class="up">▲${move}</span>` : move < 0 ? `<span class="down">▼${-move}</span>` : '<span class="muted">—</span>'}</div>`;
        }).join('')}
      </div>
      <button class="btn" data-act="draftTab" data-t="mock" style="margin-top:10px">▶ Mock Draft With This Order</button></fieldset>` : ''}
      <fieldset class="frame"><legend>Odds</legend>
        <div class="odds-head"><span>Seed</span><span>Team</span><span>Weight</span><span>#1</span><span>Top ${setup.format === '321' ? 4 : draws}</span></div>
        ${odds.map(r => {
          const rr = rec.get(r.team.id);
          const top = r.pct.slice(0, setup.format === '321' ? 4 : draws).reduce((a, b) => a + b, 0);
          return `<div class="odds-row ${isUserTeam(r.team) ? 'mine' : ''}"><span>${r.seed + 1}</span><span>${esc(r.team.shortName)} <span class="muted small">${rr.W}-${rr.L}</span></span><span>${(r.weight / totalW * 100).toFixed(1)}%</span><span>${r.pct[0].toFixed(1)}%</span><span>${top.toFixed(1)}%</span></div>`;
        }).join('')}
        <p class="note muted small" style="margin-top:8px">Weights come from your league's lottery settings (worst record = seed 1). Odds from 5,000 simulations.</p>
      </fieldset>`,
  };
}

actions.lotteryDraws = d => {
  const n = lotterySetup(league()).lotteryTeams.length;
  state.params.lotteryDraws = Math.max(1, Math.min(n, state.params.lotteryDraws + +d.dir));
  saveParams();
  render();
};

actions.simLottery = () => {
  const ds = draftState();
  ds.lottery = runLottery(league(), state.params.lotteryFormat, state.params.lotteryDraws, mulberry32(Math.floor(Math.random() * 1e9)));
  ds.mock = null;
  render();
};

// ---- Mock draft

function ensureMock() {
  const ds = draftState();
  if (!ds.mock) {
    const order = draftOrder(league(), ds.lottery?.map(r => r.team) || null, state.params.draftRounds);
    ds.mock = { picks: order.map(o => ({ ...o, ownerShort: o.owner.shortName, pid: null })) };
  }
  return ds.mock;
}

function mockAvailable(mock) {
  const taken = new Set(mock.picks.map(p => p.pid).filter(x => x != null));
  return league().draftClass.filter(p => !taken.has(p.id));
}

function simMock(untilUser) {
  const mock = ensureMock();
  for (const pk of mock.picks) {
    if (pk.pid != null) continue;
    if (untilUser && isUserTeam(pk.owner)) break;
    const p = cpuPick(pk.owner, mockAvailable(mock));
    if (!p) break;
    pk.pid = p.id;
  }
}

function draftMock() {
  const ds = draftState();
  const mock = ensureMock();
  const byId = new Map(league().draftClass.map(p => [p.id, p]));
  const onClock = mock.picks.find(p => p.pid == null);
  const userOnClock = onClock && isUserTeam(onClock.owner);
  return {
    html: `
      <p class="note muted small">${lotteryDone(league()) ? 'Using the real draft order from this save.' : ds.lottery ? 'Using your simulated lottery.' : 'No lottery simulated: order is by record.'} ${state.userTeams.size ? 'You pick for your teams.' : 'Pick your teams to draft for them.'}</p>
      <div class="grid2">
        <button class="btn" data-act="mockSim" data-u="1" ${onClock ? '' : 'disabled'}>⏩ To My Pick</button>
        <button class="btn" data-act="mockSim" data-u="0" ${onClock ? '' : 'disabled'}>⏭ Sim All</button>
      </div>
      ${userOnClock ? `<button class="btn big focus" data-act="mockChoose">🎯 ${esc(onClock.owner.shortName)} on the clock: make pick #${onClock.overall}</button>` : ''}
      <div class="list">
        ${mock.picks.map(pk => {
          const p = pk.pid != null ? byId.get(pk.pid) : null;
          const traded = pk.owner.id !== pk.orig.id;
          return `<div class="lot-row ${isUserTeam(pk.owner) ? 'mine' : ''} ${pk === onClock ? 'clock' : ''}">
            <span class="pk">${pk.overall}</span>${logoImg(pk.owner)}
            <span class="grow">${esc(pk.owner.shortName)}${traded ? ` <span class="muted small">via ${esc(pk.orig.shortName)}</span>` : ''}${pk.rd > 1 ? ` <span class="muted small">R${pk.rd}</span>` : ''}<br>
              ${p ? `<span class="small">${esc(playerName(p))} · ${esc(posName(p))} · ${heightStr(p.ht)} · <span class="stars">${stars(p.pot)}</span></span>` : `<span class="small muted">${pk === onClock ? 'On the clock' : '—'}</span>`}</span>
          </div>`;
        }).join('')}
      </div>`,
    action: { act: 'mockReset', label: 'Reset' },
  };
}

actions.mockSim = d => { simMock(d.u === '1'); render(); };
actions.mockReset = () => { draftState().mock = null; render(); };
actions.mockChoose = () => {
  const mock = ensureMock();
  const pk = mock.picks.find(p => p.pid == null);
  const avail = mockAvailable(mock).sort((a, b) => prospectValue(b) - prospectValue(a));
  const o = overlay(`
    <p class="note">${esc(pk.owner.shortName)} · Pick #${pk.overall}</p>
    <div class="stack" style="max-height:60vh;overflow:auto">
      ${avail.map(p => `<button class="btn left small" data-id="${p.id}"><span style="flex:1;text-align:left">${esc(playerName(p))}<br><span class="muted small">${esc(posName(p))} · ${p.age}y · ${heightStr(p.ht)} · ceil ${esc(compsFor(p).ceiling[0]?.name || '')}</span></span><span class="stars">${stars(p.pot)}</span></button>`).join('')}
    </div>
    <button class="btn off" data-close>Cancel</button>`);
  o.addEventListener('click', e => {
    const b = e.target.closest('[data-id],[data-close]');
    if (!b) return;
    if (b.dataset.id) pk.pid = +b.dataset.id;
    o.remove();
    render();
  });
};

// ---- Pick trades

function draftTrades(args) {
  const L = league();
  const teams = [...L.teams].sort((a, b) => a.shortName.localeCompare(b.shortName));
  const mine = teams.filter(isUserTeam);
  const aId = +(args.a ?? (mine[0] || teams[0]).id);
  const bId = +(args.b ?? teams.find(t => t.id !== aId).id);
  const A = L.teams.find(t => t.id === aId), B = L.teams.find(t => t.id === bId);
  const selA = new Set(args.selA || []), selB = new Set(args.selB || []);
  const key = pk => `${pk.yr}:${pk.rd}:${pk.otid}`;
  const tname = id => L.teams.find(t => t.id === id)?.shortName || '?';
  const picks = (T, sel, side) => [...T.draftPicks]
    .filter(pk => pk.yr >= L.season.currentYear)
    .sort((x, y) => x.yr - y.yr || x.rd - y.rd)
    .map(pk => `<button class="pick ${sel.has(key(pk)) ? 'sel' : ''}" data-act="togglePick" data-side="${side}" data-k="${key(pk)}">
      <span class="check"></span><span class="grow">${pk.yr} R${pk.rd}${pk.otid !== T.id ? ` <span class="muted small">(${esc(tname(pk.otid))})</span>` : ''}</span>
      <span class="muted small">${Math.round(pickValue(L, pk))}</span></button>`).join('') || '<p class="note muted">No picks.</p>';
  const valueOf = (T, sel) => T.draftPicks.filter(pk => sel.has(key(pk))).reduce((a, pk) => a + pickValue(L, pk), 0);
  const vA = valueOf(A, selA), vB = valueOf(B, selB);
  const teamSelect = (side, cur, other) => `<select class="sel-team" data-change="tradeTeam" data-side="${side}">
    ${teams.filter(t => t.id !== other).map(t => `<option value="${t.id}" ${t.id === cur ? 'selected' : ''}>${esc(t.shortName)} · ${esc(t.name)}${isUserTeam(t) ? ' (You)' : ''}</option>`).join('')}</select>`;
  const log = draftState().trades;
  return {
    html: `
      <p class="note muted small">Swap draft picks between any two teams. Trades are written to the season file. Value is a rough guide based on last season's record and how far out the pick is.</p>
      <div class="grid2 trade">
        <div class="stack">${teamSelect('a', aId, bId)}<div class="list">${picks(A, selA, 'a')}</div><p class="note center">Sends <b>${Math.round(vA)}</b></p></div>
        <div class="stack">${teamSelect('b', bId, aId)}<div class="list">${picks(B, selB, 'b')}</div><p class="note center">Sends <b>${Math.round(vB)}</b></p></div>
      </div>
      ${log.length ? `<fieldset class="frame"><legend>Trades This Session</legend><div class="stack">
        ${log.map((t, i) => `<div class="row"><p class="note grow small">${esc(t.text)}</p><button class="btn small" data-act="undoTrade" data-i="${i}">Undo</button></div>`).join('')}
      </div></fieldset>` : ''}`,
    action: { act: 'makeTrade', label: selA.size || selB.size ? 'Trade' : 'Pick Picks' },
  };
}

function tradeArgs() { return state.stack[state.stack.length - 1].args; }

$app.addEventListener('change', e => {
  if (e.target.dataset.change !== 'tradeTeam') return;
  const a = tradeArgs();
  replace('draft', { ...a, tab: 'trades', [e.target.dataset.side]: +e.target.value, selA: [], selB: [] });
});

actions.togglePick = d => {
  const a = tradeArgs();
  const k = d.side === 'a' ? 'selA' : 'selB';
  const s = new Set(a[k] || []);
  if (s.has(d.k)) s.delete(d.k); else s.add(d.k);
  replace('draft', { ...a, tab: 'trades', [k]: [...s] });
};

actions.makeTrade = async () => {
  const a = tradeArgs();
  const L = league();
  const teams = [...L.teams].sort((x, y) => x.shortName.localeCompare(y.shortName));
  const mine = teams.filter(isUserTeam);
  const aId = +(a.a ?? (mine[0] || teams[0]).id);
  const bId = +(a.b ?? teams.find(t => t.id !== aId).id);
  const A = L.teams.find(t => t.id === aId), B = L.teams.find(t => t.id === bId);
  const key = pk => `${pk.yr}:${pk.rd}:${pk.otid}`;
  const fromA = A.draftPicks.filter(pk => (a.selA || []).includes(key(pk)));
  const fromB = B.draftPicks.filter(pk => (a.selB || []).includes(key(pk)));
  if (!fromA.length && !fromB.length) { toast('Tap picks on either side first'); return; }
  const tname = id => L.teams.find(t => t.id === id)?.shortName || '?';
  const desc = list => list.map(pk => `${pk.yr} R${pk.rd}${pk.otid !== pk.tid ? ` (${tname(pk.otid)})` : ''}`).join(', ') || 'nothing';
  const text = `${A.shortName} send ${desc(fromA)} · ${B.shortName} send ${desc(fromB)}`;
  if (!(await confirmBox(esc(text), 'Trade'))) return;
  tradePicks(A, B, fromA, fromB);
  draftState().trades.push({ text, a: A.id, b: B.id, fromA, fromB });
  draftState().mock = null;
  state.dirty = true;
  replace('draft', { ...a, tab: 'trades', selA: [], selB: [] });
  toast('Trade complete');
};

actions.undoTrade = d => {
  const ds = draftState();
  const t = ds.trades[+d.i];
  const L = league();
  const A = L.teams.find(x => x.id === t.a), B = L.teams.find(x => x.id === t.b);
  tradePicks(A, B, t.fromB, t.fromA);
  ds.trades.splice(+d.i, 1);
  ds.mock = null;
  render();
  toast('Trade undone');
};

// ---------------------------------------------------------------------------
// Export

screens.export = () => {
  let players = 0, points = 0, ap = 0, skills = 0;
  state.data.seasonLeagues.forEach((L, li) => {
    for (const { p } of leaguePlayers(L, true)) {
      const d = diffPlayer(p, state.snaps.get(snapKey(p.id, li)));
      if (!d.changed) continue;
      players++;
      points += d.points;
      ap += d.apDelta.reduce((a, b) => a + b, 0);
      skills += d.added.length;
    }
  });
  const canShare = typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [new File(['x'], 'x', { type: 'application/octet-stream' })] });
  layout({
    title: 'Export Season',
    body: `
      <fieldset class="frame"><legend>Changes</legend>
        <dl class="info">
          <dt>File</dt><dd>${esc(state.fileName)}</dd>
          <dt>Players changed</dt><dd class="up">${players}</dd>
          <dt>Upgrade points (net)</dt><dd class="up">${ap >= 0 ? '+' : ''}${ap}</dd>
          <dt>Rating changes</dt><dd class="up">${points >= 0 ? '+' : ''}${points}</dd>
          <dt>Skills added</dt><dd class="up">${skills}</dd>
        </dl>
      </fieldset>
      <p class="note">Only upgrade points, ratings and skills are changed. Everything else in the file is written back exactly as it was, so the game picks up right where you left off.</p>
      <div class="stack">
        <button class="btn big focus" data-act="download">💾 Download File</button>
        ${canShare ? '<button class="btn" data-act="share">📤 Share / Save to Files</button>' : ''}
      </div>
      <p class="note muted small">Replace the original in your Hoop Land saves folder (keep a backup), then load it and continue the offseason.</p>`,
  });
};

// ---------------------------------------------------------------------------
// Boot

state.stack.push({ name: 'main', args: {} });
history.replaceState({ depth: 1 }, '');
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
