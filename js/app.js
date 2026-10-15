import {
  parseSave, serializeSave, ATTRS, ATTR_NAMES, attrMin, ATTR_MAX, activeSkills, isLeveled, CATEGORIES, SKILL_MAX_LEVEL, POSITIONS, MODE_NAMES, PHASE_NAMES, BUMP_PHASES,
  playerName, heightStr, avgRating, lastSeasonMpg, leaguePlayers, snapshot, restore, diffPlayer,
} from './savefile.js';
import { DEFAULT_PARAMS, runProgression, buildSkillProfiles, rankSkillsFor, unlockSkill } from './progression.js';

const APP_VERSION = '0.2.1';
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
  awards: {},              // leagueIdx -> Map pid -> points awarded
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
      return { ...structuredClone(DEFAULT_PARAMS), ...saved };
    }
  } catch { /* storage unavailable */ }
  return structuredClone(DEFAULT_PARAMS);
}
function saveParams() {
  try { localStorage.setItem('hlc:params', JSON.stringify({ ...state.params, version: 3 })); } catch { /* ignore */ }
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
    state.awards = {};
    data.seasonLeagues.forEach((L, li) => {
      const players = leaguePlayers(L, true).map(e => e.p);
      for (const p of players) state.snaps.set(snapKey(p.id, li), snapshot(p));
      state.profiles[li] = buildSkillProfiles(players);
      const avg = ATTRS.map(() => 0);
      for (const p of players) ATTRS.forEach((k, i) => { avg[i] += p.attributes[k][0] / players.length; });
      state.leagueAvg[li] = avg;
    });
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

function buildExport() {
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
          <dt>Phase</dt><dd>${esc(PHASE_NAMES[s.phase] ?? `Phase ${s.phase}`)}</dd>
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
  if (BUMP_PHASES.includes(s.phase)) return '';
  return `<p class="note gold small" style="margin-top:10px">The bump is meant to run after the champion is crowned (Season Complete). This file is at ${esc(PHASE_NAMES[s.phase] ?? `phase ${s.phase}`)}.</p>`;
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

function bumpEntries() {
  return leaguePlayers(league(), state.params.includeFreeAgents);
}

function applyBump(seed) {
  const li = state.leagueIdx;
  // Start from the original file each time so re-rolls don't stack.
  for (const { p } of leaguePlayers(league(), true)) restore(p, snapOf(p));
  const entries = bumpEntries().map(e => ({
    ...e, leagueIdx: li, spend: state.params.spendCpuPoints && !isUserTeam(e.team),
  }));
  const awards = runProgression(entries, { ...state.params, seed }, state.profiles[li]);
  let players = 0, points = 0, mine = 0;
  for (const [pid, n] of awards) {
    if (!n) continue;
    players++;
    points += n;
  }
  for (const e of entries) if (isUserTeam(e.team)) mine += awards.get(e.p.id) || 0;
  state.awards[li] = awards;
  state.auto[li] = { seed, players, points, mine, total: entries.length, spent: state.params.spendCpuPoints };
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
  if (!(await confirmBox('Undo the offseason bump? Every player returns to the original file.', 'Undo'))) return;
  for (const { p } of leaguePlayers(league(), true)) restore(p, snapOf(p));
  delete state.auto[state.leagueIdx];
  delete state.awards[state.leagueIdx];
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
              <dt>CPU points</dt><dd>${auto.spent ? 'Spent into ratings' : 'Held for the game'}</dd>
              <dt>Seed</dt><dd>${auto.seed}</dd>
            </dl>
            <button class="btn focus" data-act="nav" data-to="report">📋 View Bump Report</button>
            <div class="grid2">
              <button class="btn" data-act="reroll">🎲 Re-roll</button>
              <button class="btn" data-act="undoAuto">↺ Undo</button>
            </div>`
          : `
            <p class="note">Players aged ${bands[bands.length - 1][0]} and under earn upgrade points (more for younger players and heavier minutes). Points go into each player's Finishing / Shooting / Creating / Defense pools to spend in-game. Every team gets the same rules, so CPU teams stay even.</p>
            <button class="btn big focus" data-act="runAuto">▶ Run Offseason Bump</button>
            <button class="btn small" data-act="nav" data-to="settings">☰ Bump Settings</button>`}
        </div>
      </fieldset>
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
    ${d.changed ? `<span class="chg">${esc(detail)} ${skillBadges(d)}</span>` : ''}
  </button>`;
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
  } else {
    body = `<p class="note">Optional: let the bump also unlock or level up skills. Off (0%) by default.</p>` +
      STEP_FIELDS.skills.map(([k, l, s]) => stepper(l, 'step', `data-k="${k}" data-s="${s}"`, P[k])).join('') +
      `<p class="note muted small">New skills are chosen to fit each player's strongest ratings.</p>`;
  }
  layout({
    title: 'Bump Settings',
    body: `
      <div class="tabs">
        ${[['general', 'General'], ['ages', 'Ages'], ['skills', 'Skills']].map(([k, l]) =>
          `<button class="btn ${k === tab ? 'on focus' : 'off'}" data-act="setTab" data-t="${k}">${l}</button>`).join('')}
      </div>
      ${body}
      ${state.auto[state.leagueIdx] ? '<p class="note gold small">The bump already ran. Changes apply the next time you run or re-roll it.</p>' : ''}`,
    action: { act: 'resetParams', label: 'Defaults' },
  });
};

actions.setTab = d => replace('settings', { tab: d.t });
actions.setOpt = d => { state.params[d.k] = JSON.parse(d.v); saveParams(); render(); };
actions.step = d => {
  const f = [...STEP_FIELDS.general, ...STEP_FIELDS.skills].find(x => x[0] === d.k);
  state.params[d.k] = Math.max(f[3], Math.min(f[4], state.params[d.k] + f[2] * +d.dir));
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
