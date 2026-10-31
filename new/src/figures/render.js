// How bytes become this page, as an exploded drawing. Each stage is a
// sheet drawn in axonometric (the dimensional-drawing projection) that
// peels up off the one before it: bytes, the DOM, layout, and the pixels,
// which are this page. Pointing at a stage's name
// lifts it clear of the rest and lets the others fall back.

export default function render(pen, { w, h, narrow }) {
  const U = narrow ? 150 : 250; // a sheet's width and depth, flat
  const V = narrow ? 100 : 160;
  const M = [0.94, 0.17, -0.34, 0.47];
  const foot = { w: M[0] * U - M[2] * V, h: M[1] * U + M[3] * V };
  // How far apart they end up: as far as the figure's height allows.
  const GAP = (h - foot.h - 24) / 3;
  const ox = w - 6 - M[0] * U; // where the sheet's (0, 0) corner falls
  const oy = h - 8 - foot.h;
  const P = (u, v) => [ox + M[0] * u + M[2] * v, oy + M[1] * u + M[3] * v];
  const poly = (pts) => pts.map(([u, v]) => P(u, v));
  const fs = narrow ? 12 : 14;

  const stages = [
    { id: "bytes", label: "bytes", note: "what came down the wire", draw: bytes },
    { id: "dom", label: "dom", note: "the tags, as a tree", draw: dom },
    { id: "layout", label: "layout", note: "styled, and where every box goes", draw: layout },
    { id: "pixels", label: narrow ? "pixels" : "pixels: this page", note: "painted, on screen", draw: pixels },
  ];

  const lifts = [];
  // Each sheet is tracing paper: it veils what's under it.
  const veil = poly([[0, 0], [U, 0], [U, V], [0, V]]);
  for (const [i, s] of stages.entries()) {
    pen.group(s.id, { veil: i ? veil : null });
    // The sheet itself, drawn where the last one lies, then lifted off.
    pen.line(poly([[0, 0], [U, 0], [U, V], [0, V], [0, -2]]), { press: i === 3 ? 0.6 : 0.45, speed: 1.6, overlap: 0 });
    const lift = pen.t;
    lifts.push({ t: lift, d: i ? 0.55 : 0 });
    pen.at(lift + (i ? 0.3 : 0));
    s.draw();
    // Its name, out to the left, with a leader to its corner.
    const [cx, cy] = P(0, V * 0.5);
    const ly = cy + 5;
    pen.num(4, ly - 13, i + 1);
    pen.text(s.label, 26, ly, { size: fs });
    if (!narrow) pen.text(s.note, 26, ly + 17, { size: 12 });
    const lw = 26 + pen.width(s.label, fs) + 6;
    pen.line([[lw, ly - 4], [cx - 6, cy]], { press: 0.25, speed: 2.5 });
    s.hot = { x: 0, y: ly - 18 - i * GAP, w: lw + 4, h: narrow ? 24 : 38 };
    pen.wait(0.1);
  }

  // ---- what's on each sheet, in its own flat coordinates ----
  function bytes() {
    const lines = narrow
      ? ["<html>", " <body>", "  <p>I rece…"]
      : ["<!doctype html>", "<html><body>", "  <h1>How the web…", "  <p>When you type…", "</body></html>"];
    const step = narrow ? 22 : 30;
    for (const [k, s] of lines.entries()) {
      const [x, y] = P(12, 22 + k * step);
      pen.text(s, x, y, { size: narrow ? 10 : 12, m: M, dur: 0.25 });
    }
  }
  function dom() {
    const n = (u, v) => [u * U, v * V];
    const nodes = [n(0.5, 0.18), n(0.25, 0.5), n(0.75, 0.5), n(0.12, 0.82), n(0.38, 0.82), n(0.62, 0.82), n(0.88, 0.82)];
    const links = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6]];
    for (const [a, b] of links) pen.line(poly([nodes[a], nodes[b]]), { press: 0.3, speed: 2.5, overlap: 0.4 });
    for (const [u, v] of nodes) pen.line(ring(u, v, narrow ? 5 : 8), { press: 0.45, speed: 2.5, taper: false, overlap: 0.4 });
  }
  function boxes() {
    return [
      [12, 12, U - 24, V * 0.16],
      [12, V * 0.26, U * 0.6, V * 0.6],
      [U * 0.66, V * 0.26, U * 0.34 - 12, V * 0.6],
    ];
  }
  function layout() {
    for (const [u, v, bw, bh] of boxes()) {
      pen.dashed(poly([[u, v], [u + bw, v], [u + bw, v + bh], [u, v + bh], [u, v]]), { dash: 5, space: 4, press: 0.35 });
    }
  }
  function pixels() {
    // A ruled sheet: its margin and its lines, with a little writing.
    const margin = U * 0.2;
    pen.line(poly([[margin, 2], [margin, V - 2]]), { press: 0.35, speed: 2.5 });
    const rows = narrow ? 5 : 7;
    for (let k = 1; k <= rows; k++) {
      const v = (k * V) / (rows + 1);
      pen.line(poly([[4, v], [U - 4, v]]), { press: 0.18, speed: 4, wob: 0.2, overlap: 0.6 });
      if (k < rows - 1) pen.line(poly([[margin + 8, v - 3], [margin + 8 + (U - margin - 24) * [0.8, 0.95, 0.6, 0.9, 0.7, 0.4][k - 1], v - 3]]), { press: 0.4, speed: 2.5, overlap: 0.4 });
    }
  }
  function ring(u, v, r) {
    const pts = [];
    for (let i = 0; i <= 22; i++) {
      const a = (i / 20) * 6.2832;
      pts.push(P(u + Math.cos(a) * r, v + Math.sin(a) * r));
    }
    return pts;
  }

  const hotspots = stages.map((s) => ({ id: s.id, label: `${s.label}: ${s.note}`, ...s.hot }));
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

  return {
    duration: 7,
    // The pen's times are squeezed to fit; so are the lifts.
    scale(k) {
      for (const l of lifts) {
        l.t *= k;
        l.d = Math.max(l.d * k, l.d ? 0.4 : 0);
      }
    },
    hotspots,
    on(kind, id, state) {
      for (const s of stages) state.springs[s.id] ??= { v: 0, goal: 0, rate: 8 };
      // A tap lifts one layer and lets the last one settle back.
      if (kind === "press") for (const s of stages) state.springs[s.id].goal = 0;
      if (kind === "enter" || kind === "press") state.springs[id].goal = 1;
      if (kind === "leave") state.springs[id].goal = 0;
    },
    offsets(t, state) {
      const any = Math.max(0, ...stages.map((s) => state.springs[s.id]?.v ?? 0));
      const o = {};
      for (const [i, s] of stages.entries()) {
        const l = lifts[i];
        const k = l.d ? ease(Math.min(1, Math.max(0, (t - l.t) / l.d))) : 1;
        const mine = state.springs[s.id]?.v ?? 0;
        // The others settle back a little and fade, so the one pointed at
        // stands alone.
        o[s.id] = [0, -i * GAP * k - mine * 16 + (any - mine) * 4, 1 - (any - mine) * 0.6];
      }
      return o;
    },
  };
}
