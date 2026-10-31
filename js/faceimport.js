// Faces from the game's roster screen. Every row sits in the same blue box, the face at its left, so the rows are
// found by their light-blue borders and each face cut from the same spot in its row (scaled by the row's height, so
// any phone's screenshot works). The background turns see-through. Faces are matched to players by color: the game
// draws a face in the player's own skin, hair and eye colors, so the player whose colors fill the face is the one.
const BORDER = [14, 130, 206];
const BGS = [[14, 130, 206], [14, 65, 142], [15, 77, 163], [17, 53, 112]];
const near = (a, b, tol) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < tol;

// Rows: groups of lines where the border color crosses the table at 3 points; a row is the gap between two lines.
function findRows(px, W, H) {
  const at = (x, y) => { const i = (y * W + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
  const lines = [];
  for (let y = Math.floor(H * 0.24); y < H - Math.floor(H * 0.12); y++) {
    const n = [0.237, 0.474, 0.711].filter(f => near(at(Math.floor(W * f), y), BORDER, 30)).length;
    if (n >= 2) { const g = lines[lines.length - 1]; if (g && y - g[1] <= 2) g[1] = y; else lines.push([y, y]); }
  }
  const rows = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i][1] + 1, b = lines[i + 1][0], h = b - a;
    if (h > H * 0.034 && h < H * 0.06) rows.push([a, b]);
  }
  return { rows, at };
}

// Each face: { url (a transparent PNG), colors: Map('rrggbb' → pixels) }.
export function cutFaces(img) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, W, H).data;
  const { rows, at } = findRows(px, W, H);
  const out = [];
  for (const [a, b] of rows) {
    const h = b - a, mid = (a + b) >> 1;
    let bx = 0; while (bx < W / 2 && !near(at(bx, mid), BORDER, 30)) bx++;
    if (bx >= W / 2) continue;
    const x0 = Math.round(bx + 1.04 * h), x1 = Math.round(bx + 2.74 * h), y0 = a + 1;
    const w = x1 - x0, hh = b - y0;
    const fc = document.createElement('canvas'); fc.width = w; fc.height = hh;
    const fx = fc.getContext('2d'), data = fx.createImageData(w, hh), bg = at(Math.max(0, x0), mid), colors = new Map();
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const c = at(x0 + x, y0 + y), i = (y * w + x) * 4;
      if (BGS.some(g => near(c, g, 40)) || near(c, bg, 40)) continue;
      data.data[i] = c[0]; data.data[i + 1] = c[1]; data.data[i + 2] = c[2]; data.data[i + 3] = 255;
      const k = c.map(v => v.toString(16).padStart(2, '0')).join('');
      colors.set(k, (colors.get(k) || 0) + 1);
    }
    fx.putImageData(data, 0, 0);
    out.push({ url: fc.toDataURL('image/png'), colors });
  }
  return out;
}

// How well a face fits a player: skin counts most, then hair, then eyes (each by how many pixels are near his color).
const hex = s => [0, 2, 4].map(i => parseInt((s || '000000').slice(i, i + 2), 16));
function fit(face, p) {
  const a = p.appearance || {};
  let s = 0;
  for (const [k, w] of [['skinC', 3], ['hairC', 2], ['eyeC', 1]]) {
    const c = hex(a[k]); let n = 0;
    for (const [col, m] of face.colors) if (near(hex(col), c, 13)) n += m;
    s += w * Math.min(1, n / 10);
  }
  return s;
}
// One player per face, best fits first. `sure` is false when another player fits as well (the same colors).
export function matchFaces(faces, players) {
  const pairs = [];
  faces.forEach((f, i) => players.forEach(p => pairs.push({ i, p, s: fit(f, p) })));
  pairs.sort((x, y) => y.s - x.s);
  const got = new Map(), used = new Set();
  for (const x of pairs) if (!got.has(x.i) && !used.has(x.p.id) && x.s > 0) { got.set(x.i, x); used.add(x.p.id); }
  return faces.map((f, i) => {
    const g = got.get(i);
    const rivals = g ? pairs.filter(x => x.i === i && x.p !== g.p && x.s >= g.s).length : 0;
    return { face: f, p: g?.p || null, sure: !!g && g.s >= 5 && !rivals };
  });
}
