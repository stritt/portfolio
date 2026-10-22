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
