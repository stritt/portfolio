// "Nobody knows anything": the midwit bell curve, sketched in pencil and
// simply there (still), not drawn in. Grug on the left says just prompt it,
// the soyjak in the middle cries about tools, and the hooded sage on the
// right says just prompt it.

export default function midwit(pen, { w, h, narrow }) {
  const base = h - 30;
  const mu = w / 2;
  const sd = w * 0.13;
  const top = h * 0.42;
  const fs = narrow ? 12 : 14;
  const r = narrow ? 18 : 30;
  const rnd = pen.rnd;
  const j = (k = 1) => (rnd() - 0.5) * k;

  // Faces are drawn in units of r around their middle; a stroke through
  // those points is rounded off (Catmull-Rom) so it reads as one movement.
  const smooth = (pts, n = 4) => {
    if (pts.length < 3) return pts;
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i];
      const [p1, p2] = [pts[i], pts[i + 1]];
      const p3 = pts[i + 2] ?? p2;
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const t2 = t * t;
        const t3 = t2 * t;
        out.push([0, 1].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  };
  const face = (cx, cy) => {
    const P = (pts) => pts.map(([x, y]) => [cx + x * r, cy + y * r]);
    return {
      stroke: (pts, o = {}) => pen.line(smooth(P(pts)), { press: 0.5, wob: 0.4, taper: false, ...o }),
      fine: (pts, o = {}) => pen.line(smooth(P(pts)), { press: 0.38, wob: 0.3, taper: false, ...o }),
      dot: (x, y, s = 0.07) => pen.circle(cx + x * r, cy + y * r, Math.max(1.2, s * r), { press: 0.9 }),
      ring: (x, y, rad, o = {}) => pen.circle(cx + x * r, cy + y * r, rad * r, { press: 0.5, ...o }),
      hatch: (x0, y0, x1, y1, o = {}) => pen.line(P([[x0, y0], [x1, y1]]), { press: 0.24, wob: 0.15, taper: false, gap: 0, overlap: 0.5, ...o }),
    };
  };

  // ---- the curve
  pen.line([[4, base], [w - 4, base]], { press: 0.35 });
  const yAt = (x) => base - (base - top) * Math.exp(-(((x - mu) / sd) ** 2) / 2);
  const bell = [];
  for (let x = 6; x <= w - 6; x += 6) bell.push([x, yAt(x)]);
  pen.line(bell, { press: 0.6 });
  // Where the standard deviations fall, the mean among them, and the
  // scores under them.
  for (let k = -3; k <= 3; k++) {
    const x = mu + k * sd;
    if (Math.abs(k) < 3) pen.dashed([[x, yAt(x) + 4], [x, base]], { press: 0.2, dash: 3, space: 5 });
    pen.line([[x, base - 3], [x, base + 4]], { press: 0.3, wob: 0.2, taper: false });
    pen.text(String(100 + k * 15), x, base + 19, { size: narrow ? 10 : 12, align: "center" });
  }
  if (!narrow) {
    const mid = top + (base - top) * 0.45;
    pen.text("34%", mu - sd / 2, mid, { size: 12, align: "center" });
    pen.text("34%", mu + sd / 2, mid, { size: 12, align: "center" });
    pen.text("14%", mu - sd * 1.5, base - 26, { size: 12, align: "center" });
    pen.text("14%", mu + sd * 1.5, base - 26, { size: 12, align: "center" });
  }

  // ---- grug: bald and lumpy, ears out, a big nose and a dopey grin
  const gx = Math.max(r * 1.9 + 4, w * 0.13);
  const gy = base - r * 2.15;
  const g = face(gx, gy);
  g.stroke([[-0.95, -0.2], [-0.92, -0.65], [-0.62, -1.02], [-0.15, -1.15], [0.35, -1.1], [0.78, -0.86], [0.96, -0.22]]);
  g.stroke([[0.92, 0.32], [0.8, 0.78], [0.48, 1.05], [0.08, 1.14], [-0.32, 1.06], [-0.68, 0.8], [-0.9, 0.32]]);
  g.stroke([[-0.95, -0.22], [-1.28, -0.38], [-1.42, -0.05], [-1.3, 0.28], [-0.92, 0.3]]);
  g.stroke([[0.96, -0.22], [1.3, -0.36], [1.44, -0.02], [1.3, 0.3], [0.92, 0.32]]);
  g.fine([[-1.18, -0.12], [-1.28, 0.02], [-1.16, 0.14]]);
  g.fine([[1.18, -0.12], [1.3, 0.02], [1.18, 0.14]]);
  // Stray hairs, and a forehead creased with effort.
  for (const x of [-0.45, -0.25, 0.1, 0.32]) g.fine([[x, -1.12], [x + j(0.1) - 0.05, -1.3], [x + 0.06, -1.36]]);
  g.fine([[-0.55, -0.72], [-0.15, -0.78], [0.25, -0.74], [0.55, -0.66]]);
  g.fine([[-0.6, -0.56], [-0.2, -0.62], [0.2, -0.6], [0.6, -0.5]]);
  g.fine([[-0.45, -0.42], [0, -0.46], [0.4, -0.4]]);
  // Eyes set wide, under a heavy brow.
  g.stroke([[-0.78, -0.22], [-0.55, -0.27], [-0.32, -0.2]], { press: 0.55 });
  g.stroke([[0.32, -0.2], [0.55, -0.27], [0.78, -0.22]], { press: 0.55 });
  g.fine([[-0.72, -0.08], [-0.55, -0.15], [-0.38, -0.08], [-0.55, -0.02], [-0.72, -0.08]]);
  g.fine([[0.38, -0.08], [0.55, -0.15], [0.72, -0.08], [0.55, -0.02], [0.38, -0.08]]);
  g.dot(-0.53, -0.08);
  g.dot(0.57, -0.08);
  g.stroke([[0.02, -0.12], [0.16, 0.12], [0.3, 0.3], [0.18, 0.44], [-0.04, 0.4]]);
  g.fine([[-0.14, 0.3], [-0.24, 0.38], [-0.12, 0.45]]);
  g.stroke([[-0.38, 0.62], [-0.1, 0.74], [0.25, 0.7], [0.45, 0.56]]);
  g.fine([[0.42, 0.52], [0.5, 0.6]]);
  // A long thin neck on sloping shoulders.
  g.stroke([[-0.32, 1.02], [-0.36, 1.45], [-0.9, 1.8], [-1.75, 2.12]]);
  g.stroke([[0.36, 1.0], [0.38, 1.45], [0.95, 1.8], [1.8, 2.12]]);
  g.fine([[0.0, 1.35], [0.04, 1.45]]);
  pen.text("just prompt it", gx, gy - r * 1.6, { size: fs + 1, align: "center" });

  // ---- the soyjak: long face, messy hair, glasses, teeth, tears
  const sx = mu;
  const sy = top - r * 2.3;
  const s = face(sx, sy);
  s.stroke([[-0.68, -0.95], [-0.8, -0.35], [-0.84, 0.2], [-0.74, 0.72], [-0.48, 1.12], [-0.08, 1.3], [0.32, 1.18], [0.6, 0.85], [0.74, 0.3], [0.84, -0.32], [0.74, -0.95]]);
  s.stroke([[0.82, -0.36], [1.04, -0.46], [1.12, -0.12], [1.0, 0.2], [0.76, 0.22]]);
  // Hair: a thatch of strokes, standing up.
  for (let i = 0; i < 15; i++) {
    const x = -0.72 + (1.46 * i) / 14 + j(0.05);
    s.stroke([[x, -0.92], [x + 0.08 + j(0.06), -1.3 - rnd() * 0.25], [x + 0.18, -1.45 - rnd() * 0.2]], { press: 0.6 });
  }
  // Brows up in the middle, worried, with a crease between.
  s.stroke([[-0.62, -0.5], [-0.38, -0.6], [-0.14, -0.7]], { press: 0.55 });
  s.stroke([[0.14, -0.7], [0.36, -0.6], [0.6, -0.5]], { press: 0.55 });
  s.fine([[-0.04, -0.72], [-0.06, -0.58]]);
  s.fine([[0.04, -0.72], [0.06, -0.58]]);
  s.ring(-0.38, -0.25, 0.27);
  s.ring(0.36, -0.25, 0.27);
  s.fine([[-0.11, -0.28], [0, -0.32], [0.09, -0.28]]);
  s.fine([[0.63, -0.28], [0.82, -0.3]]);
  s.dot(-0.36, -0.22, 0.06);
  s.dot(0.34, -0.22, 0.06);
  s.fine([[-0.52, -0.12], [-0.38, -0.08], [-0.24, -0.12]]);
  s.fine([[0.22, -0.12], [0.36, -0.08], [0.5, -0.12]]);
  // Tears, in streams.
  for (const [x, d] of [[-0.48, -1], [-0.36, -1], [0.34, 1], [0.46, 1]]) s.fine([[x, 0.02], [x + d * 0.03, 0.45], [x - d * 0.02, 0.85], [x + d * 0.02, 1.05]], { press: 0.32 });
  s.stroke([[0.0, -0.08], [-0.1, 0.22], [0.04, 0.28]]);
  // Teeth, clenched, in a mouth pulled wide.
  s.stroke([[-0.42, 0.52], [-0.2, 0.46], [0.2, 0.46], [0.42, 0.52], [0.38, 0.84], [0.0, 0.9], [-0.38, 0.84], [-0.42, 0.52]]);
  s.fine([[-0.4, 0.68], [0.4, 0.68]]);
  for (let i = 1; i < 5; i++) s.fine([[-0.4 + 0.16 * i, 0.48], [-0.4 + 0.16 * i, 0.87]]);
  // Stubble along the jaw.
  for (let i = 0; i < 14; i++) {
    const a = 0.5 + (i / 13) * 2.15;
    const [x, y] = [Math.cos(a) * 0.66, 0.42 + Math.sin(a) * 0.7];
    s.hatch(x, y, x + 0.03, y + 0.05, { press: 0.4 });
  }
  s.stroke([[-0.3, 1.24], [-0.34, 1.7], [-1.0, 1.98], [-1.8, 2.25]]);
  s.stroke([[0.3, 1.16], [0.34, 1.7], [1.0, 1.98], [1.8, 2.25]]);
  const said = narrow ? ["no! you need", "MCPs, skills,", "sub-agents,", "loops, $NewTool…"] : ["no!! you need MCPs,", "skills, sub-agents,", "workflows, loops,", "$NewTool…"];
  said.forEach((line, i) => pen.text(line, sx + r * 1.35, sy - r * 1.05 + i * (fs + 4), { size: fs }));

  // ---- the sage: deep hood, fringe, a level look off to the side
  const hx = Math.min(w - r * 1.9 - 4, w * 0.87);
  const hy = base - r * 2.05;
  const m = face(hx, hy);
  // The hood rises to a point that falls back.
  m.stroke([[-1.75, 2.0], [-1.52, 1.2], [-1.3, 0.25], [-1.2, -0.75], [-0.85, -1.5], [-0.15, -1.92], [0.55, -2.15], [0.82, -2.25], [0.96, -1.65], [1.18, -0.65], [1.25, 0.35], [1.45, 1.3], [1.78, 2.0]], { press: 0.6 });
  // Its opening, and the shadow inside.
  m.stroke([[-0.86, 1.25], [-0.96, 0.3], [-0.88, -0.6], [-0.45, -1.06], [0.18, -1.12], [0.68, -0.78], [0.9, 0.0], [0.86, 0.85], [0.62, 1.28]]);
  m.stroke([[-0.86, 1.25], [-0.35, 1.58], [0.3, 1.6], [0.62, 1.28]], { press: 0.4 });
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    m.hatch(-1.22 + t * 0.05, -0.5 + t * 1.7, -0.96 + t * 0.02, -0.75 + t * 1.7);
    m.hatch(0.9 - t * 0.02, -0.55 + t * 1.6, 1.18 + t * 0.05, -0.75 + t * 1.6);
  }
  // The face in it.
  m.stroke([[-0.72, -0.3], [-0.7, 0.45], [-0.42, 0.95], [0.0, 1.12], [0.36, 0.96], [0.64, 0.42], [0.7, -0.3]]);
  // A fringe of dark hair, strand by strand.
  for (let i = 0; i < 16; i++) {
    const x = -0.78 + (1.52 * i) / 15;
    const end = -0.36 + Math.abs(Math.sin(i * 1.7)) * 0.08;
    m.fine([[x + 0.06, -1.02 + Math.abs(x) * 0.18], [x, end]], { press: 0.55 });
  }
  // Brows low and level, eyes open and off to one side.
  m.stroke([[-0.52, -0.2], [-0.32, -0.16], [-0.12, -0.12]], { press: 0.6 });
  m.stroke([[0.1, -0.12], [0.3, -0.16], [0.5, -0.2]], { press: 0.6 });
  m.fine([[-0.5, 0.0], [-0.32, -0.08], [-0.14, 0.0], [-0.32, 0.06], [-0.5, 0.0]]);
  m.fine([[0.12, 0.0], [0.3, -0.08], [0.48, 0.0], [0.3, 0.06], [0.12, 0.0]]);
  m.dot(-0.42, -0.01, 0.065);
  m.dot(0.2, -0.01, 0.065);
  m.stroke([[0.02, 0.06], [-0.1, 0.4], [0.06, 0.45]]);
  m.stroke([[-0.22, 0.7], [0.0, 0.67], [0.24, 0.7]]);
  // Shade down one side of the face.
  for (let i = 0; i < 6; i++) m.hatch(0.42 + i * 0.03, 0.1 + i * 0.14, 0.58, 0.02 + i * 0.14, { press: 0.2 });
  pen.text("just prompt it", hx, hy - r * 2.55, { size: fs + 1, align: "center" });

  return { still: true };
}
