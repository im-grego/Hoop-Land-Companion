// Usage: node tests/smoke.test.mjs <save> [<save> ...]
// Loads each save in a real browser (the pre-installed Chromium via Playwright), opens every screen that applies to
// its mode and point in the season, builds the export, and fails on any page error. The app is served from a temp
// copy with tests/hook.js appended to js/app.js, so the test can reach the app's state.
import { cpSync, mkdtempSync, readFileSync, appendFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

// Playwright from the project, or the copy installed globally with the browser.
const { chromium } = await import('playwright').catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));

const saves = process.argv.slice(2);
if (!saves.length) { console.error('pass one or more save files'); process.exit(2); }
const root = new URL('..', import.meta.url).pathname, dir = mkdtempSync(join(tmpdir(), 'hlc-smoke-'));
for (const f of ['index.html', 'manifest.webmanifest', 'sw.js', 'js', 'css', 'img', 'icons']) cpSync(join(root, f), join(dir, f), { recursive: true });
appendFileSync(join(dir, 'js/app.js'), '\n' + readFileSync(join(root, 'tests/hook.js'), 'utf8'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const path = join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  try { const body = readFileSync(path); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); } catch { res.writeHead(404); res.end(); }
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
let failed = 0;
for (const save of saves) {
  const page = await (await browser.newContext({ viewport: { width: 430, height: 1000 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForTimeout(1200);
  await page.setInputFiles('input[type=file]', save);
  await page.waitForFunction(() => window.__L && (() => { try { return !!window.__L(); } catch { return false; } })(), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 4; i++) { const o = page.locator('.overlay button'); if (await o.count()) { await o.last().click().catch(() => {}); await page.waitForTimeout(250); } }
  const seen = await page.evaluate(async () => {
    const L = window.__L(), s = L.season, out = [];
    const career = s.mode === 2, commish = s.mode === 1;
    const list = ['main', 'export', 'editor', 'settings', 'news', 'leaders', 'classLab', 'checkin', 'lineup', 'roster',
      ...(career ? ['career', 'careerFA'] : []), ...(commish ? ['myteams'] : []), ...(s.phase === 9 ? ['deadline'] : []), ...(s.phase === 11 ? ['playoffs'] : [])];
    for (const n of list) { try { window.__go(n, {}); out.push(n); } catch (e) { out.push(`${n}!${e.message}`); } }
    if (career) for (const t of ['moves', 'story', 'legacy']) { try { window.__go('career', { tab: t }); out.push(`career:${t}`); } catch (e) { out.push(`career:${t}!${e.message}`); } }
    const file = window.__be(), text = await file.text();
    out.push(`export ${(text.length / 1e6).toFixed(1)}MB`);
    // A float copied without its class ({ raw } objects) can't be read by the game (it broke the league hub).
    const stray = (text.match(/\{"raw":/g) || []).length;
    if (stray) out.push(`stray floats!${stray}`);
    return out;
  });
  await page.waitForTimeout(300);
  const bad = seen.filter(x => x.includes('!'));
  if (errors.length || bad.length) { failed++; console.error(`FAIL ${save}\n  ${[...bad, ...errors].slice(0, 8).join('\n  ')}`); }
  else console.log(`ok ${save}: ${seen.join(', ')}`);
  await page.close();
}
await browser.close();
server.close();
rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
