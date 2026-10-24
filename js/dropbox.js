// Direct upload to Dropbox (OAuth 2 PKCE, no redirect: the user pastes the
// code Dropbox shows them). Uses the user's own Dropbox app key; tokens stay
// in this browser's storage.

const KEY = 'hlc:dropbox';
// The app's own Dropbox app key (public; PKCE needs no secret). When set,
// nobody has to create a Dropbox app: Connect just works.
export const BUILT_IN_APP_KEY = '';
const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const UPLOAD_URL = 'https://content.dropboxapi.com/2/files/upload';
const DOWNLOAD_URL = 'https://content.dropboxapi.com/2/files/download';

export function dropboxConfig() {
  const base = { folder: '/Hoop Land', overwrite: false, appKey: BUILT_IN_APP_KEY || '' };
  try { const c = { ...base, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; if (!c.appKey) c.appKey = base.appKey; return c; }
  catch { return base; }
}
export function saveDropboxConfig(patch) {
  const c = { ...dropboxConfig(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
  return c;
}
export const dropboxConnected = () => !!dropboxConfig().refreshToken;
export const disconnectDropbox = () => saveDropboxConfig({ refreshToken: null, accessToken: null, expires: 0, verifier: null });

const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Step 1: returns the URL to open; the verifier is kept for step 2.
export async function dropboxAuthUrl(appKey) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  saveDropboxConfig({ appKey, verifier });
  const q = new URLSearchParams({
    client_id: appKey, response_type: 'code', code_challenge: challenge,
    code_challenge_method: 'S256', token_access_type: 'offline',
  });
  return `${AUTH_URL}?${q}`;
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Dropbox said ${res.status}`);
  return json;
}

// Step 2: exchange the pasted code for tokens.
export async function dropboxFinishAuth(code) {
  const c = dropboxConfig();
  if (!c.appKey || !c.verifier) throw new Error('Start the connection again.');
  const t = await tokenRequest({ code: code.trim(), grant_type: 'authorization_code', code_verifier: c.verifier, client_id: c.appKey });
  saveDropboxConfig({ verifier: null, refreshToken: t.refresh_token, accessToken: t.access_token, expires: Date.now() + (t.expires_in - 60) * 1000 });
}

async function accessToken() {
  const c = dropboxConfig();
  if (!c.refreshToken) throw new Error('Not connected to Dropbox.');
  if (c.accessToken && Date.now() < c.expires) return c.accessToken;
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: c.appKey });
  saveDropboxConfig({ accessToken: t.access_token, expires: Date.now() + (t.expires_in - 60) * 1000 });
  return t.access_token;
}

// Dropbox-API-Arg must be ASCII: escape everything else as \uXXXX.
const headerJson = obj => JSON.stringify(obj).replace(/[\u007f-￿]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);

export function dropboxPath(name, folder = dropboxConfig().folder) {
  const dir = `/${(folder || '').replace(/^\/+|\/+$/g, '')}`;
  return `${dir === '/' ? '' : dir}/${name}`;
}

// Upload a Blob/File. Returns the saved path (Dropbox may rename on conflict).
export async function dropboxUpload(blob, name) {
  const c = dropboxConfig();
  const arg = { path: dropboxPath(name, c.folder), mode: c.overwrite ? 'overwrite' : 'add', autorename: true, mute: false };
  const send = async token => fetch(UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': headerJson(arg), 'Content-Type': 'application/octet-stream' },
    body: blob,
  });
  let res = await send(await accessToken());
  if (res.status === 401) { saveDropboxConfig({ accessToken: null, expires: 0 }); res = await send(await accessToken()); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_summary || `Upload failed (${res.status})`);
  return json.path_display;
}

// A content call with one retry on an expired token.
async function contentCall(url, arg, body = undefined) {
  const send = async token => fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': headerJson(arg), ...(body !== undefined ? { 'Content-Type': 'application/octet-stream' } : {}) },
    ...(body !== undefined ? { body } : {}),
  });
  let res = await send(await accessToken());
  if (res.status === 401) { saveDropboxConfig({ accessToken: null, expires: 0 }); res = await send(await accessToken()); }
  return res;
}
// Write text at an exact path, replacing what's there (small app files such as a save's traits).
export async function dropboxPut(path, text) {
  const res = await contentCall(UPLOAD_URL, { path, mode: 'overwrite', autorename: false, mute: true }, new Blob([text], { type: 'application/json' }));
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error_summary || `Upload failed (${res.status})`); }
  return true;
}
// Read a file's text; null when there's no file at that path.
export async function dropboxGet(path) {
  const res = await contentCall(DOWNLOAD_URL, { path });
  if (res.status === 409) return null;
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return res.text();
}
