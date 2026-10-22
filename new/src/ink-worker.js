// Draws one page's ink in Brandon Pencil Graphite. Runs on a CPU canvas
// (willReadFrequently) so the slow COLRv1 painting stays in this thread and
// never ties up the GPU process the page renders through.

import { rng } from "./hand.js";

const face = new FontFace("Graphite", 'url("/fonts/BrandonPencilGraphite-Regular.woff2")');
const ready = face.load().then((f) => self.fonts.add(f));

let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue
    .then(() => draw(data))
    .catch((err) => self.postMessage({ id: data.id, error: String(err) }));
};

// Sketches, fetched once each and kept for every page that shows them.
const sketches = new Map();
const sketch = (src) => {
  if (!sketches.has(src)) {
    sketches.set(src, fetch(src).then((r) => r.blob()).then((b) => createImageBitmap(b)));
  }
  return sketches.get(src);
};

async function draw({ id, w, h, scale, words, marks = [], marker, images = [], seed = 1, keep = false }) {
  const bitmaps = await Promise.all([ready, ...images.map((i) => sketch(i.src))]);
  const canvas = new OffscreenCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.scale(scale, scale);
  ctx.fontKerning = "normal";
  ctx.imageSmoothingQuality = "high";
  images.forEach((i, n) => ctx.drawImage(bitmaps[n + 1], i.x, i.y, i.w, i.h));
  let n = 1;
  for (const m of marks) highlight(ctx, m, marker, n++);
  erasures(ctx, words, w, h, rng(seed ^ 0x5bd1e995));
  // The writing goes on its own layer first, at full strength, and pressure
  // and dulling are laid on as copies of the finished bitmap. Painting
  // Graphite's colour layers is the slow part: done once per word, never
  // with transparency, which makes each glyph paint through its own layer.
  const layer = new OffscreenCanvas(canvas.width, canvas.height);
  const lx = layer.getContext("2d", { willReadFrequently: true });
  lx.scale(scale, scale);
  lx.fontKerning = "normal";
  for (const r of words) write(lx, r);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Snapshot once: drawing from the canvas itself copies all of it each time.
  const snap = layer.transferToImageBitmap();
  lay(ctx, snap, words, h, scale);
  snap.close();
  // A PNG to keep for next time, encoded after the ink has gone back so the
  // page isn't kept waiting (the blob is of the canvas as it is now).
  const blob = keep ? canvas.convertToBlob({ type: "image/png" }) : null;
  // WebGL ignores UNPACK_PREMULTIPLY_ALPHA_WEBGL for ImageBitmap. Safari's
  // transferToImageBitmap() keeps straight RGB even where alpha is tiny,
  // while the paper shader expects premultiplied RGB. Request it explicitly.
  const bitmap = await createImageBitmap(canvas, { premultiplyAlpha: "premultiply" });
  self.postMessage({ id, bitmap, keeping: keep }, [bitmap]);
  blob?.then((b) => self.postMessage({ id, blob: b })).catch(() => self.postMessage({ id, blob: null }));
}

// A highlighter pass: chisel ends cut at a slant, edges that waver a little
// as the hand moves, ink a touch heavier where the stroke starts.
function highlight(ctx, { x, y, w, h }, color, seed) {
  let t = seed * 9301 + 49297;
  const rnd = () => ((t = (t * 9301 + 49297) % 233280) / 233280);
  const steps = Math.max(2, Math.round(w / 18));
  const slant = h * 0.35;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - 2 + slant, y + (rnd() - 0.5));
  for (let i = 1; i <= steps; i++) ctx.lineTo(x + (w * i) / steps + (i === steps ? 2 + slant : 0), y + (rnd() - 0.5) * 1.4);
  for (let i = steps; i >= 0; i--) ctx.lineTo(x + (w * i) / steps + (i === steps ? 2 : i === 0 ? -2 : 0), y + h + (rnd() - 0.5) * 1.4);
  ctx.closePath();
  ctx.globalAlpha = 0.92;
  ctx.fill();
  ctx.globalAlpha = 0.18;
  ctx.fillRect(x - 2 + slant * 0.5, y, Math.min(10, w), h);
  ctx.restore();
}

function write(ctx, r) {
  ctx.save();
  ctx.font = `${r.fs}px Graphite`;
  ctx.fillStyle = r.color;
  ctx.letterSpacing = r.ls;
  if (r.rot != null) {
    ctx.translate(r.x, r.y);
    ctx.rotate(r.rot);
    ctx.textAlign = "center";
    ctx.fillText(r.text, 0, 0);
  } else {
    ctx.fillText(r.text, r.x, r.y);
  }
  ctx.restore();
}

// Lays the writing onto the sheet a band of lines at a time: at the hand's
// pressure there, and, where the point was blunt, with a wider, fainter line
// either side of the stroke (faint offset copies).
function lay(ctx, layer, words, h, scale) {
  const band = 33;
  for (let y = 0; y < h; y += band) {
    const inBand = words.filter((r) => r.rot == null && r.y >= y && r.y < y + band);
    const avg = (k, none) => (inBand.length ? inBand.reduce((s, r) => s + r[k], 0) / inBand.length : none);
    const d = avg("dull", 0);
    const sy = Math.round(y * scale);
    const sh = Math.min(layer.height - sy, Math.round((y + band) * scale) - sy);
    if (sh <= 0) break;
    ctx.globalAlpha = avg("a", 1);
    ctx.drawImage(layer, 0, sy, layer.width, sh, 0, sy, layer.width, sh);
    if (!d) continue;
    const o = d * 0.5 * scale;
    ctx.globalAlpha = 0.32 * d;
    ctx.drawImage(layer, 0, sy, layer.width, sh, o, sy + o * 0.6, layer.width, sh);
    ctx.drawImage(layer, 0, sy, layer.width, sh, -o * 0.7, sy - o * 0.4, layer.width, sh);
  }
  ctx.globalAlpha = 1;
}

// What was written and rubbed out: a word that was misspelled and written
// over, and a word at the end of a line that didn't survive. Each leaves a
// faint ghost in the tooth and a grey haze where the eraser dragged
// graphite around.
function erasures(ctx, words, w, h, rnd) {
  const body = words.filter((r) => r.rot == null && r.y > h * 0.12 && /^[a-z]{5,}$/i.test(r.text));
  if (!body.length) return [];
  const spots = [];
  const count = body.length > 40 ? 2 : 1;

  for (let i = 0; i < count; i++) {
    const over = i === 0;
    let r;
    let text;
    let x;
    if (over) {
      // Written over: the same word, once spelt wrong underneath.
      r = body[Math.floor(rnd() * body.length)];
      const j = 1 + Math.floor(rnd() * (r.text.length - 3));
      text = r.text.slice(0, j) + r.text[j + 1] + r.text[j] + r.text.slice(j + 2);
      x = r.x + (rnd() - 0.5) * 3;
    } else {
      // The end of a line: a word that came after and was thought better of.
      text = body[Math.floor(rnd() * body.length)].text.toLowerCase();
      const fits = (a) => {
        ctx.font = `${a.fs}px Graphite`;
        return a.x + ctx.measureText(`${a.text} ${text}`).width < w * 0.9;
      };
      const ends = words.filter(
        (a) => a.rot == null && a.y > h * 0.12 && !words.some((b) => b !== a && b.line === a.line && b.x > a.x) && fits(a),
      );
      r = ends[Math.floor(rnd() * ends.length)];
      if (!r) break;
      x = r.x + ctx.measureText(r.text + " ").width;
    }
    ctx.save();
    ctx.font = `${r.fs}px Graphite`;
    const tw = ctx.measureText(text).width;
    const cx = x + tw / 2;
    const cy = r.y - r.fs * 0.3;

    // The haze: graphite dragged into a smear the shape of the rubbing.
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, "rgba(60,60,66,0.045)");
    g.addColorStop(0.5, "rgba(60,60,66,0.03)");
    g.addColorStop(1, "rgba(60,60,66,0)");
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rnd() - 0.5) * 0.3);
    ctx.scale(tw * 0.62 + 10, r.fs * 0.75);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // The ghost: only what was pressed into the valleys survives.
    ctx.fillStyle = r.color;
    ctx.globalAlpha = over ? 0.26 : 0.3;
    ctx.translate(x, r.y + (rnd() - 0.3) * 1.5);
    ctx.rotate((rnd() - 0.5) * 0.03);
    ctx.fillText(text, 0, 0);
    ctx.restore();
    spots.push({ x: cx, y: cy, w: tw });
  }
  return spots;
}
