// The hand a page is written in: where each word lands, how hard it was
// pressed, how blunt the pencil was. Planned by ink.js and drawn by
// ink-worker.js.

// Seeded, so a page's hand and erasures are the same every visit.
export function rng(seed) {
  let t = seed || 1;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Nobody writes like type. Each line starts a touch left or right of the
// last and drifts off its rule; each word has its own pressure; and the
// pencil dulls down the page (see lay() in ink-worker.js) until it's
// sharpened somewhere along the way. Words aren't turned: Graphite's glyphs
// are only cached square, and turning each one makes the page ~20x slower.
export function hand(runs, h, rnd) {
  const lines = new Map();
  const sharpen = 0.35 + rnd() * 0.35;
  // Pressure wanders slowly as the hand goes; it doesn't jump word to word.
  let press = 0.95;
  return runs.map((r) => {
    if (r.rot != null) return { ...r, a: 0.9, dull: 0.4 };
    const k = Math.round(r.y);
    let line = lines.get(k);
    if (!line) {
      line = { dx: (rnd() - 0.5) * 2.4, dy: (rnd() - 0.5) * 1.3, slope: (rnd() - 0.5) * 0.005, x0: r.x };
      press = Math.min(1, Math.max(0.88, press + (rnd() - 0.5) * 0.06));
      lines.set(k, line);
    }
    const t = r.y / h;
    const dull = t < sharpen ? 0.25 + t / sharpen * 0.75 : (t - sharpen) / (1 - sharpen);
    return {
      ...r,
      line: k,
      x: r.x + line.dx,
      y: r.y + line.dy + line.slope * (r.x - line.x0) + (rnd() - 0.5) * 0.5,
      a: Math.min(1, press + (rnd() - 0.5) * 0.04) * (1 - 0.05 * dull),
      dull,
    };
  });
}
