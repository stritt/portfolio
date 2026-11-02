// "Nobody knows anything": the midwit bell curve, sketched in pencil and
// simply there (still), not drawn in. Laid out like the meme: a narrow
// curve shaded in, the bands and percentages around it, grug on the left
// tail, the crying soyjak on the peak and the hooded sage on the right.

export default function midwit(pen, { w, h, narrow }) {
  const base = h - 30;
  const mu = w / 2;
  const sd = w * (narrow ? 0.1 : 0.085);
  const top = h * 0.36;
  const fs = narrow ? 12 : 14;
  const rnd = pen.rnd;
  const j = (k = 1) => (rnd() - 0.5) * k;
  const yAt = (x) => base - (base - top) * Math.exp(-(((x - mu) / sd) ** 2) / 2);
  // How far from the middle, in sd, the curve comes down to height y.
  const reach = (y) => Math.sqrt(-2 * Math.log(Math.max(1e-4, (base - y) / (base - top))));

  // A stroke through points, rounded off (Catmull-Rom) into one movement.
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

  // Shade inside polygons (even-odd, so one inside another is a hole) with
  // parallel strokes at an angle, the way you'd fill an area in pencil.
  const shade = (polys, { gap = 3.5, angle = 0.9, press = 0.2 } = {}) => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const rot = polys.map((poly) => poly.map(([x, y]) => [x * c + y * s, -x * s + y * c]));
    const vs = rot.flat().map((p) => p[1]);
    for (let v = Math.min(...vs) + gap / 2; v < Math.max(...vs); v += gap) {
      const us = [];
      for (const poly of rot) {
        for (let i = 0; i < poly.length; i++) {
          const [a, b] = [poly[i], poly[(i + 1) % poly.length]];
          if ((a[1] <= v) !== (b[1] <= v)) us.push(a[0] + ((v - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      us.sort((p, q) => p - q);
      for (let i = 0; i + 1 < us.length; i += 2) {
        const [u0, u1] = [us[i] + 0.6 + j(0.8), us[i + 1] - 0.6 + j(0.8)];
        if (u1 - u0 < 1.5) continue;
        const back = (u) => [u * c - v * s, u * s + v * c];
        pen.line([back(u0), back(u1)], { press: press * (0.85 + rnd() * 0.3), wob: 0.15, taper: false, soft: true, gap: 0, overlap: 0.5 });
      }
    }
  };

  // Faces are drawn in units of r around their middle.
  const face = (cx, cy, r) => {
    const P = (pts) => pts.map(([x, y]) => [cx + x * r, cy + y * r]);
    return {
      P,
      stroke: (pts, o = {}) => pen.line(smooth(P(pts)), { press: 0.55, wob: 0.4, taper: false, ...o }),
      fine: (pts, o = {}) => pen.line(smooth(P(pts)), { press: 0.38, wob: 0.3, taper: false, ...o }),
      dot: (x, y, s = 0.07) => {
        for (let k = 1; k <= 3; k++) pen.circle(cx + x * r, cy + y * r, Math.max(0.6, (s * r * k) / 3), { press: 0.9 });
      },
      ring: (x, y, rad, o = {}) => pen.circle(cx + x * r, cy + y * r, rad * r, { press: 0.55, ...o }),
      shade: (polys, o) => shade(polys.map(P), o),
    };
  };

  // ---- the curve, shaded under, with its bands
  const t0 = mu - 3.9 * sd;
  const t1 = mu + 3.9 * sd;
  const bell = [];
  for (let x = t0; x <= t1 + 0.1; x += 4) bell.push([x, Math.min(base - 2.5, yAt(x))]);
  shade([[...bell, [t1, base], [t0, base]]], { gap: 3.2, angle: 1.05, press: 0.17 });
  pen.line([[t0 - 6, base], [t1 + 6, base]], { press: 0.4 });
  pen.line(bell, { press: 0.6 });
  for (let k = -3; k <= 3; k++) {
    const x = mu + k * sd;
    if (Math.abs(k) < 3) pen.dashed([[x, yAt(x) + 3], [x, base]], { press: 0.32, dash: 4, space: 4 });
    pen.line([[x, base - 3], [x, base + 4]], { press: 0.35, wob: 0.2, taper: false });
    pen.text(String(100 + k * 15), x, base + 19, { size: narrow ? 10 : 13, align: "center" });
  }
  const small = narrow ? 10 : 12;
  if (!narrow) {
    pen.text("IQ score", mu - 3 * sd - 16, base + 18, { size: 11, align: "right" });
    const y68 = yAt(mu + sd);
    pen.dashed([[mu - sd, y68], [mu + sd, y68]], { press: 0.25, dash: 3, space: 4 });
    pen.text("68%", mu, y68 - 4, { size: 10, align: "center" });
    const y95 = base - 9;
    pen.dashed([[mu - 2 * sd, y95], [mu + 2 * sd, y95]], { press: 0.25, dash: 3, space: 4 });
    pen.text("95%", mu, y95 - 4, { size: 10, align: "center" });
  }
  // The percentages sit just outside the curve, as in the meme.
  const outside = (str, y, side) => {
    const x = mu + side * (reach(y - 4) * sd + 5);
    pen.text(str, x, y, { size: small + 1, align: side < 0 ? "right" : "left" });
  };
  outside("34%", top + 16, -1);
  outside("34%", top + 16, 1);
  if (!narrow) {
    outside("14%", base - (base - top) * 0.28, -1);
    outside("14%", base - (base - top) * 0.28, 1);
    pen.text("2%", mu - 2.55 * sd, base - 14, { size: small, align: "center" });
    pen.text("0.1%", mu - 3.45 * sd, base - 14, { size: small, align: "center" });
  }

  // ---- grug: pear skull with bumps, tufts, eyes out in the bumps, hook nose, grin
  const gr = Math.min(h * 0.1, w * 0.07);
  const gx = Math.max(gr * 1.45 + 4, w * 0.19);
  const gy = base - 24 - gr * 2.1;
  const g = face(gx, gy, gr);
  g.stroke([[-0.87, 0.3], [-1.06, 0.3], [-1.2, 0.14], [-1.21, -0.1], [-1.06, -0.26], [-0.86, -0.18], [-0.8, -0.6], [-0.58, -1.0], [-0.18, -1.14], [0.3, -1.1], [0.62, -0.92], [0.8, -0.52], [0.86, -0.18], [1.06, -0.26], [1.21, -0.1], [1.2, 0.14], [1.06, 0.3], [0.87, 0.3]]);
  g.stroke([[0.86, 0.3], [0.8, 0.7], [0.52, 1.02], [0.12, 1.12], [-0.3, 1.05], [-0.62, 0.8], [-0.86, 0.3]]);
  for (const x of [-0.32, 0.22]) g.fine([[x - 0.14, -1.11], [x - 0.08, -1.3], [x - 0.02, -1.13], [x + 0.04, -1.34], [x + 0.1, -1.12], [x + 0.16, -1.27]]);
  g.fine([[-0.52, -0.66], [-0.1, -0.73], [0.35, -0.7], [0.58, -0.62]]);
  g.fine([[-0.5, -0.5], [-0.05, -0.56], [0.4, -0.52]]);
  // Eyes set so wide they sit out in the bumps of his skull.
  for (const sx of [-1, 1]) {
    g.stroke([[sx * 1.13, 0.0], [sx * 1.0, -0.07], [sx * 0.87, 0.0]], { press: 0.65 });
    g.fine([[sx * 1.13, 0.01], [sx * 1.0, 0.09], [sx * 0.87, 0.01]]);
    g.dot(sx * 1.02, 0.01, 0.07);
  }
  g.stroke([[0.12, -0.24], [0.2, 0.06], [0.34, 0.3], [0.24, 0.43], [0.06, 0.4]]);
  g.fine([[-0.1, 0.26], [-0.2, 0.34], [-0.08, 0.42]]);
  g.stroke([[-0.1, 0.62], [0.14, 0.7], [0.4, 0.6]]);
  g.fine([[0.38, 0.55], [0.46, 0.63]]);
  g.stroke([[-0.3, 1.05], [-0.27, 1.45], [-0.55, 1.72], [-1.0, 1.92], [-1.55, 2.1]]);
  g.stroke([[0.38, 1.0], [0.4, 1.4], [0.72, 1.72], [1.15, 1.9], [1.6, 2.1]]);
  g.fine([[0.04, 1.55], [0.07, 1.68]]);
  pen.text("just prompt it", gx, gy - gr * 1.55, { size: fs + 1, align: "center" });

  // ---- the soyjak: swept hair, long jaw, glasses, tears, teeth bared
  const sr = Math.min((top - 6) / 3.75, w * 0.075);
  const sx = mu - sr * 0.15;
  const sy = top - sr * 2.25;
  const s = face(sx, sy, sr);
  s.stroke([[-0.68, -0.88], [-0.76, -0.3], [-0.84, 0.2], [-0.8, 0.6], [-0.62, 0.95], [-0.38, 1.15], [-0.04, 1.22], [0.26, 1.1], [0.56, 0.84], [0.8, 0.4], [0.94, -0.02], [0.9, -0.6], [0.76, -0.9]]);
  s.stroke([[0.9, -0.45], [1.12, -0.52], [1.2, -0.2], [1.1, 0.12], [0.92, 0.14]]);
  // Hair: a thick tuft swept to one side.
  for (let i = 0; i < 26; i++) {
    const x = -0.74 + (1.6 * i) / 25 + j(0.04);
    const lift = 0.45 + rnd() * 0.25;
    s.stroke([[x, -0.86 + Math.abs(x) * 0.05], [x + 0.12 + j(0.05), -0.86 - lift * 0.6], [x + 0.34 + j(0.08), -0.86 - lift]], { press: 0.6 + rnd() * 0.25 });
  }
  // Stubble above the ear.
  for (let i = 0; i < 14; i++) {
    const [x, y] = [0.64 + rnd() * 0.2, -0.78 + rnd() * 0.34];
    s.fine([[x, y], [x + 0.02, y + 0.02]], { press: 0.6 });
  }
  s.stroke([[-0.66, -0.48], [-0.38, -0.5], [-0.14, -0.44]], { press: 0.7 });
  s.stroke([[0.12, -0.44], [0.38, -0.5], [0.66, -0.48]], { press: 0.7 });
  for (let i = 0; i < 6; i++) s.fine([[-0.5 + i * 0.2, -0.58], [-0.46 + i * 0.2, -0.53]], { press: 0.3 });
  s.ring(-0.4, -0.2, 0.26);
  s.ring(0.36, -0.2, 0.26);
  s.fine([[-0.14, -0.22], [-0.02, -0.27], [0.1, -0.22]]);
  s.fine([[0.62, -0.24], [0.95, -0.36]]);
  for (const ex of [-0.4, 0.36]) {
    s.fine([[ex - 0.14, -0.18], [ex, -0.25], [ex + 0.14, -0.18], [ex, -0.13], [ex - 0.14, -0.18]]);
    s.dot(ex + 0.02, -0.19, 0.055);
  }
  // Tears, in streams down to the jaw.
  for (const [x, len] of [[-0.52, 0.85], [-0.42, 0.95], [0.3, 1.0], [0.42, 0.9]]) s.fine([[x, -0.02], [x + j(0.04), len * 0.5], [x + 0.02, len]], { press: 0.35 });
  s.stroke([[0.0, -0.06], [-0.12, 0.22], [0.0, 0.29], [0.1, 0.25]]);
  // Teeth bared in an open grimace.
  s.stroke([[-0.52, 0.52], [-0.12, 0.44], [0.26, 0.5], [0.3, 0.86], [-0.1, 0.96], [-0.5, 0.84], [-0.52, 0.52]]);
  s.fine([[-0.5, 0.69], [0.28, 0.69]]);
  for (let i = 1; i < 5; i++) s.fine([[-0.5 + 0.156 * i, 0.48], [-0.5 + 0.156 * i, 0.9]]);
  s.stroke([[-0.24, 1.2], [-0.28, 1.78], [-0.9, 2.0], [-1.6, 2.25]]);
  s.stroke([[0.3, 1.08], [0.4, 1.72], [1.05, 1.96], [1.7, 2.25]]);
  s.fine([[0.04, 1.58], [0.06, 1.7]]);
  const said = narrow ? ["no! you need", "MCPs, skills,", "sub-agents,", "loops, $NewTool…"] : ["no!! you need MCPs,", "skills, sub-agents,", "workflows, loops,", "$NewTool…"];
  said.forEach((line, i) => pen.text(line, sx + sr * 1.45, sy - sr * 0.95 + i * (fs + 4), { size: fs }));

  // ---- the sage: a shaded hood, a fringe, a calm, knowing look
  const hr = Math.min(h * 0.1, w * 0.07);
  const hx = Math.min(w - hr * 1.8 - 4, w * 0.79);
  const hy = base - hr * 2.0 - 2;
  const m = face(hx, hy, hr);
  const hood = [[-1.75, 2.0], [-1.52, 1.2], [-1.3, 0.25], [-1.2, -0.75], [-0.85, -1.5], [-0.15, -1.92], [0.55, -2.15], [0.82, -2.25], [0.96, -1.65], [1.18, -0.65], [1.25, 0.35], [1.45, 1.3], [1.78, 2.0]];
  const opening = [[-0.86, 1.25], [-0.96, 0.3], [-0.88, -0.6], [-0.45, -1.06], [0.18, -1.12], [0.68, -0.78], [0.9, 0.0], [0.86, 0.85], [0.62, 1.28], [0.3, 1.6], [-0.35, 1.58]];
  // Barely shaded, like the rest: a second line inside the rim and the
  // folds, so it reads as cloth without filling it in.
  const rim = opening.slice(0, 9).map(([x, y]) => [x * 1.14, y * 1.08 - 0.04]);
  m.fine(rim, { press: 0.3 });
  // Folds falling from the shoulders.
  for (const [x0, y0, x1, y1] of [[-1.3, 0.9, -1.1, 1.95], [-1.05, 1.3, -0.8, 1.98], [1.08, 0.6, 1.25, 1.6], [1.2, 1.1, 1.5, 1.98], [0.95, 1.4, 1.05, 1.98]]) m.fine([[x0, y0], [(x0 + x1) / 2 + j(0.08), (y0 + y1) / 2], [x1, y1]], { press: 0.3 });
  m.stroke(hood, { press: 0.65 });
  m.stroke(opening.slice(0, 9), { press: 0.55 });
  m.fine([[-1.25, 1.55], [-0.95, 1.98]]);
  m.fine([[1.05, 1.5], [1.32, 1.98]]);
  // The face, the fringe filled in dark over it.
  m.stroke([[-0.72, -0.4], [-0.7, 0.45], [-0.42, 0.95], [0.0, 1.12], [0.36, 0.96], [0.64, 0.42], [0.72, -0.4]]);
  m.fine([[-0.3, 1.04], [-0.3, 1.5]]);
  m.fine([[0.3, 1.0], [0.32, 1.5]]);
  const fringe = [[-0.84, -0.5], [-0.62, -0.98], [0.0, -1.1], [0.56, -0.86], [0.8, -0.48], [0.62, -0.34], [0.38, -0.42], [0.14, -0.32], [-0.12, -0.4], [-0.38, -0.31], [-0.62, -0.42]];
  m.shade([fringe], { gap: 1.3, angle: 1.4, press: 0.95 });
  m.shade([fringe], { gap: 2.5, angle: 1.2, press: 0.6 });
  m.stroke([...fringe, fringe[0]], { press: 0.5 });
  m.shade([[[0.7, -0.28], [0.4, -0.22], [0.42, 0.4], [0.36, 0.9], [0.64, 0.45]]], { gap: 3.2, angle: 1.2, press: 0.13 });
  m.shade([[[-0.36, 0.98], [0.32, 1.0], [0.3, 1.32], [-0.3, 1.32]]], { gap: 2.8, angle: 1.2, press: 0.2 });
  // Calm: soft brows, lids half lowered over a steady look, the faintest
  // smile. He's seen it all before.
  m.fine([[-0.52, -0.17], [-0.34, -0.21], [-0.14, -0.17]], { press: 0.45 });
  m.fine([[0.12, -0.17], [0.32, -0.21], [0.5, -0.17]], { press: 0.45 });
  for (const ex of [-0.33, 0.31]) {
    m.stroke([[ex - 0.18, 0.02], [ex - 0.05, -0.03], [ex + 0.08, -0.03], [ex + 0.18, 0.02]], { press: 0.6 });
    m.fine([[ex - 0.15, 0.04], [ex, 0.08], [ex + 0.15, 0.04]], { press: 0.3 });
    m.dot(ex, 0.03, 0.05);
  }
  m.stroke([[0.02, 0.1], [-0.08, 0.4], [0.02, 0.45], [0.1, 0.42]], { press: 0.45 });
  m.fine([[-0.18, 0.7], [0.0, 0.71], [0.16, 0.68], [0.22, 0.65]], { press: 0.5 });
  pen.text("just prompt it", hx, hy - hr * 2.5, { size: fs + 1, align: "center" });

  return { still: true };
}
