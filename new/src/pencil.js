// Drawing a pencil line on a 2D canvas, shared by doodling (doodle.js) and
// the wall's previews (wall.js). The canvas is then laid into the paper by
// the shader, which adds the tooth and the sheen.

export const INK = "#2e2f35";

// A pencil line is many overlapping touches of a point that's never quite
// round: laid closely along the stroke, each faint, nudged a hair off the
// line, so they build up to a grey with some grain in it. rnd: a source of
// randomness, seeded when a stroke is replayed. ctx.fillStyle is the ink.
export function layLine(ctx, [x0, y0], [x1, y1], press, rnd = Math.random) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const r = 0.55 + 0.6 * press;
  const n = Math.max(1, Math.ceil(len / 0.3));
  ctx.globalAlpha = 0.1 + 0.2 * press;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t + (rnd() - 0.5) * 0.5;
    const y = y0 + (y1 - y0) * t + (rnd() - 0.5) * 0.5;
    ctx.beginPath();
    ctx.ellipse(x, y, r * (0.8 + rnd() * 0.4), r * (0.8 + rnd() * 0.4), rnd() * 3, 0, 6.2832);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Replays strokes as kept: each a flat run of x, y, pressure, in the CSS px
// of the sheet they were drawn on, scaled by k to this one.
export function drawStrokes(ctx, strokes, k, rnd) {
  for (const s of strokes) {
    let last = [s[0] * k, s[1] * k];
    layLine(ctx, last, [last[0] + 0.1, last[1]], s[2], rnd);
    for (let i = 3; i < s.length; i += 3) {
      const p = [s[i] * k, s[i + 1] * k];
      layLine(ctx, last, p, s[i + 2], rnd);
      last = p;
    }
  }
}

// Finished pencil settles into the paper rather than looking like a thin
// pen. Bake its broken coverage and faint dust edge once, in a tight crop;
// moving it or repainting the sheet can then reuse the same small bitmap.
const graphiteCache = new WeakMap();
let tooth = null;
function pencilTooth() {
  if (tooth) return tooth;
  tooth = document.createElement("canvas");
  tooth.width = tooth.height = 128;
  const c = tooth.getContext("2d");
  const image = c.createImageData(128, 128);
  let seed = 74183;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < image.data.length; i += 4) {
    const density = random();
    image.data[i + 3] = density < 0.14 ? 0 : density < 0.31 ? 60 : 155 + random() * 100;
  }
  c.putImageData(image, 0, 0);
  return tooth;
}

function graphiteFinish(raw, resolution) {
  const finished = document.createElement("canvas");
  finished.width = raw.width; finished.height = raw.height;
  const f = finished.getContext("2d");
  f.globalAlpha = 0.07;
  f.drawImage(raw, -0.6 * resolution, 0.2 * resolution);
  f.drawImage(raw, 0.6 * resolution, -0.2 * resolution);
  const c = raw.getContext("2d");
  c.resetTransform();
  c.globalCompositeOperation = "destination-in";
  c.fillStyle = c.createPattern(pencilTooth(), "repeat");
  c.fillRect(0, 0, raw.width, raw.height);
  f.globalAlpha = 0.88;
  f.drawImage(raw, 0, 0);
  return finished;
}

const signatureCache = new Map();
export function drawGraphiteSignature(ctx, text, font, fs, x, y, width) {
  const transform = ctx.getTransform();
  const resolution = Math.min(2, Math.max(1, Math.hypot(transform.a, transform.b)));
  const key = `${text}|${font}|${resolution}|${width}`;
  let stamp = signatureCache.get(key);
  if (!stamp) {
    const w = Math.ceil(width + 8), h = Math.ceil(fs * 1.7 + 8);
    const raw = document.createElement("canvas");
    raw.width = Math.ceil(w * resolution); raw.height = Math.ceil(h * resolution);
    const c = raw.getContext("2d");
    c.scale(resolution, resolution);
    c.font = font;
    c.fillStyle = INK;
    const metrics = c.measureText(text);
    const asc = metrics.fontBoundingBoxAscent ?? fs * 0.9;
    const desc = metrics.fontBoundingBoxDescent ?? fs * 0.25;
    // Match the baseline in the original one-em DOM line box.
    c.fillText(text, 4, 4 + fs / 2 + (asc - desc) / 2);
    stamp = { canvas: graphiteFinish(raw, resolution), w, h };
    if (signatureCache.size >= 64) signatureCache.clear();
    signatureCache.set(key, stamp);
  }
  ctx.drawImage(stamp.canvas, x - 4, y - 4, stamp.w, stamp.h);
}

export function drawGraphiteStrokes(ctx, strokes, k, rnd) {
  if (!strokes.length) return;
  const transform = ctx.getTransform();
  const resolution = Math.min(2, Math.max(1, Math.hypot(transform.a, transform.b)));
  const key = `${k}@${resolution}`;
  let sizes = graphiteCache.get(strokes);
  if (!sizes) graphiteCache.set(strokes, sizes = new Map());
  let stamp = sizes.get(key);
  if (!stamp) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of strokes) for (let i = 0; i < s.length; i += 3) {
      x0 = Math.min(x0, s[i] * k); y0 = Math.min(y0, s[i + 1] * k);
      x1 = Math.max(x1, s[i] * k); y1 = Math.max(y1, s[i + 1] * k);
    }
    if (!Number.isFinite(x0)) return;
    const x = Math.floor(x0) - 4, y = Math.floor(y0) - 4;
    const w = Math.ceil(x1 - x + 4), h = Math.ceil(y1 - y + 4);
    const raw = document.createElement("canvas");
    raw.width = Math.ceil(w * resolution); raw.height = Math.ceil(h * resolution);
    const c = raw.getContext("2d");
    c.setTransform(resolution, 0, 0, resolution, -x * resolution, -y * resolution);
    c.fillStyle = INK;
    drawStrokes(c, strokes, k, rnd);
    stamp = { canvas: graphiteFinish(raw, resolution), x, y, w, h };
    // Retain the current preview and page sizes, without accumulating crops
    // indefinitely when a phone is rotated or a window is resized.
    if (sizes.size >= 2) sizes.clear();
    sizes.set(key, stamp);
  }
  ctx.drawImage(stamp.canvas, stamp.x, stamp.y, stamp.w, stamp.h);
}

// Where a doodle sits, for its signature: the bottom-right of its strokes.
export function corner(strokes, k) {
  let x = -Infinity;
  let y = -Infinity;
  for (const s of strokes) {
    for (let i = 0; i < s.length; i += 3) {
      x = Math.max(x, s[i] * k);
      y = Math.max(y, s[i + 1] * k);
    }
  }
  return [x, y];
}
