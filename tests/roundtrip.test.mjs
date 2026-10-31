// Usage: node tests/roundtrip.test.mjs <path-to-season-file>
import { readFileSync } from 'node:fs';
import { parseSave, serializeSave } from '../js/savefile.js';

const path = process.argv[2];
if (!path) { console.error('pass a season file path'); process.exit(2); }
const text = readFileSync(path, 'utf8');
let t = performance.now();
const data = parseSave(text);
const tp = performance.now() - t; t = performance.now();
const out = serializeSave(data);
const ts = performance.now() - t;
if (out !== text) {
  let i = 0; while (out[i] === text[i]) i++;
  console.error('MISMATCH at', i, '\norig:', text.slice(i - 80, i + 80), '\nours:', out.slice(i - 80, i + 80));
  process.exit(1);
}
console.log(`round-trip OK (${text.length} bytes, parse ${tp.toFixed(0)}ms, save ${ts.toFixed(0)}ms)`);
