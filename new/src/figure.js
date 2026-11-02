// Figures: diagrams drawn in pencil on a post as the reader gets to them.
//
// A <figure class="diagram" data-fig="name"> keeps its place in the text
// (whole rules tall, see .diagram in style.css); the drawing itself comes
// from src/figures/<name>.js. The scene lays out pencil strokes and writing
// with a pen that moves through them in order, and this file plays that
// pen forward: each frame it lays only the next stretch of each line, in
// the same stamped graphite as a doodle (pencil.js), and hands the picture
// to the paper shader for its box on the sheet. Nothing is ever undrawn;
// playing it again rubs it out and starts over.
//
// Parts can be drawn in groups that move as one (a layer lifting off a
// stack), and spots on the drawing are real buttons, so a reader can point
// at or press them. Without WebGL the picture is shown as a plain canvas.

import { layLine, INK } from "./pencil.js";
import { rng } from "./hand.js";

const scenes = import.meta.glob("./figures/*.js");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const FONT = '"Brandon Pencil", cursive';

// ---- the pen --------------------------------------------------------------
// A scene is a function (pen, box) → { hotspots?, offsets?, overlay?, ... }.
// It calls the pen's drawing methods in the order a hand would make them;
// each mark starts when the last is nearly done (or at pen.at(t)).

function makePen(seed) {
  const rnd = rng(seed);
  const marks = [];
  const groups = new Map([["base", { name: "base" }]]);
  let group = "base";
  let cursor = 0;
  const SPEED = 520; // px of line a second, at full tilt

  // A hand never quite follows the ruler: resample, and let each point
  // drift a little off the line, drifting back again.
  function wobble(pts, amt = 0.7) {
    const out = [];
    let drift = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.round(len / 5));
      const nx = -(y1 - y0) / (len || 1);
      const ny = (x1 - x0) / (len || 1);
      for (let j = 0; j < n; j++) {
        const t = j / n;
        drift += (rnd() - 0.5) * 0.45 * amt - drift * 0.12;
        out.push([x0 + (x1 - x0) * t + nx * drift, y0 + (y1 - y0) * t + ny * drift]);
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function add(mark, { gap = 0.04, overlap = 0.15 } = {}) {
    mark.group = group;
    mark.start ??= cursor;
    marks.push(mark);
    cursor = mark.start + mark.dur * (1 - overlap) + gap;
    return mark;
  }

  const pen = {
    rnd,
    get t() {
      return cursor;
    },
    at(t) {
      cursor = t;
      return pen;
    },
    wait(dt) {
      cursor += dt;
      return pen;
    },
    group(name, opts = {}) {
      if (!groups.has(name)) groups.set(name, { name, ...opts });
      group = name;
      return pen;
    },

    // A stroke through pts, pressed 0–1. speed scales the pen.
    line(pts, { press = 0.55, speed = 1, wob = 1, taper = true, ...o } = {}) {
      const p = wobble(pts, wob);
      const cum = [0];
      for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
      const len = cum[cum.length - 1];
      const dur = o.dur ?? 0.08 + len / (SPEED * speed);
      // Lighter as the pencil lands and lifts.
      const pr = (s) => (taper ? press * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, Math.max(0, s / len)))) : press);
      return add({ kind: "line", p, cum, len, pr, dur, start: o.start }, o);
    },
    // A box in two strokes, overshooting its corners a hair.
    rect(x, y, w, h, o = {}) {
      const k = () => (rnd() - 0.3) * 2.5;
      pen.line([[x - k(), y], [x + w + k() * 0.5, y], [x + w, y - k() * 0.4], [x + w, y + h + k()]], { ...o, overlap: 0.3 });
      return pen.line([[x + w + k() * 0.5, y + h], [x - k() * 0.5, y + h], [x, y + h + k() * 0.4], [x, y - k()]], o);
    },
    circle(cx, cy, r, o = {}) {
      const a0 = rnd() * 6.28;
      const n = Math.max(12, Math.round(r));
      const pts = [];
      for (let i = 0; i <= n * 1.08; i++) {
        const a = a0 + (i / n) * 6.2832;
        const rr = r * (1 + (i / n) * 0.04);
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
      }
      return pen.line(pts, { taper: false, ...o });
    },
    dashed(pts, { dash = 7, space = 5, ...o } = {}) {
      // Walk the polyline, putting the pencil down for each dash.
      const segs = [];
      let on = true;
      let left = dash;
      let cur = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        let [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        let len = Math.hypot(x1 - x0, y1 - y0);
        while (len > 0) {
          const step = Math.min(left, len);
          const t = step / len;
          const x = x0 + (x1 - x0) * t;
          const y = y0 + (y1 - y0) * t;
          if (on) cur.push([x, y]);
          x0 = x;
          y0 = y;
          len -= step;
          left -= step;
          if (left <= 1e-6) {
            if (on) segs.push(cur);
            on = !on;
            left = on ? dash : space;
            cur = [[x0, y0]];
          }
        }
      }
      if (on && cur.length > 1) segs.push(cur);
      let last;
      for (const s of segs) last = pen.line(s, { speed: 1.6, wob: 0.4, taper: false, ...o, gap: 0, overlap: 0.4 });
      return last;
    },
    arrow(pts, { head = 8, both = false, ...o } = {}) {
      const tip = (a, b) => {
        const ang = Math.atan2(a[1] - b[1], a[0] - b[0]);
        const s = 0.42;
        pen.line([[a[0] - Math.cos(ang - s) * head, a[1] - Math.sin(ang - s) * head], a, [a[0] - Math.cos(ang + s) * head, a[1] - Math.sin(ang + s) * head]],
          { press: o.press ?? 0.55, speed: 1.4, wob: 0.3, taper: false, overlap: 0.2 });
      };
      const m = o.dashed ? pen.dashed(pts, o) : pen.line(pts, o);
      tip(pts[pts.length - 1], pts[pts.length - 2]);
      if (both) tip(pts[0], pts[1]);
      return m;
    },
    // A quadratic bend from a to b through the pull of c, as points.
    curve(a, c, b, n = 16) {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
      }
      return pts;
    },

    // Writing, revealed left to right as if written. y is the baseline.
    // m: an optional [a, b, c, d] to slant it onto a plane.
    text(str, x, y, { size = 15, align = "left", m = null, ...o } = {}) {
      const w = measure(str, size);
      const x0 = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
      const dur = o.dur ?? 0.1 + str.length * 0.045;
      return add({ kind: "text", str, x: x0, y, size, w, m, dur, start: o.start }, { overlap: 0.1, ...o });
    },
    width: (str, size = 15) => measure(str, size),

    // A dimension, as on a drawing: ticks at both ends, a line between
    // with heads, and its label riding above.
    dim(x0, x1, y, label, { size = 13, ticks = 6, below = "", ...o } = {}) {
      pen.line([[x0, y - ticks], [x0, y + ticks]], { press: 0.3, speed: 2, wob: 0.2, overlap: 0.3, ...o });
      pen.line([[x1, y - ticks], [x1, y + ticks]], { press: 0.3, speed: 2, wob: 0.2, overlap: 0.3 });
      if (x1 - x0 > 16) pen.arrow([[x0 + 1, y], [x1 - 1, y]], { both: true, head: Math.min(6, (x1 - x0) / 4), press: 0.3, wob: 0.3 });
      else pen.line([[x0, y], [x1, y]], { press: 0.3, wob: 0.2 });
      if (label) pen.text(label, (x0 + x1) / 2, y - 6, { size, align: "center" });
      if (below) pen.text(below, (x0 + x1) / 2, y + size + 3, { size, align: "center" });
      return pen;
    },
    // A note number in a little box.
    num(x, y, n, { size = 12 } = {}) {
      const s = size + 4;
      pen.rect(x, y, s, s, { press: 0.35, speed: 2 });
      return pen.text(String(n), x + s / 2, y + s - 4, { size, align: "center", dur: 0.12 });
    },

    _done: () => ({ marks, groups, end: Math.max(0, ...marks.map((m) => m.start + m.dur)) }),
  };
  return pen;
}

let measurer;
function measure(str, size) {
  measurer ??= document.createElement("canvas").getContext("2d");
  measurer.font = `${size}px ${FONT}`;
  return measurer.measureText(str).width;
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// ---- one figure on the sheet ---------------------------------------------

// Where el sits on the sheet, in the sheet's own CSS px, measured square
// to the page (the sheet's tilt is the shader's to apply).
function offsetIn(el, sheet) {
  const tilt = sheet.style.transform;
  sheet.style.transform = "none";
  try {
    const r = el.getBoundingClientRect();
    const s = sheet.getBoundingClientRect();
    return [r.left - s.left, r.top - s.top];
  } finally {
    sheet.style.transform = tilt;
  }
}

async function mountFigure(el, { paper, sheet, redraw, data }) {
  let slot = null; // which of the paper's figure slots it's drawn in, if any
  const load = scenes[`./figures/${el.dataset.fig}.js`];
  if (!load) return null;
  const { default: scene } = await load();

  let built = null;
  let groups = [];
  let out = null;
  let outCtx = null;
  let dpr = 1;
  let t = 0;
  let playing = false;
  let shown = false;
  let raf = 0;
  let lastNow = 0;
  const state = { hover: null, springs: {}, events: [], now: 0, get reduced() { return reduced.matches; } };
  let fallback = null;
  let pos = null;

  function build() {
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pen = makePen(0x9e3779b1 ^ el.dataset.fig.length * 7919);
    const api = scene(pen, { w, h, data: data(), narrow: w < 520 });
    const { marks, groups: gs, end: penEnd } = pen._done();
    // However much there is to draw, it's drawn in about the same time.
    const k = Math.min(1, (api.duration ?? 6) / (penEnd || 1));
    for (const m of marks) {
      m.start *= k;
      m.dur *= k;
    }
    api.scale?.(k);
    const end = penEnd * k;
    built = { ...api, marks, end, w, h };
    pos = null;

    // Each group gets a canvas just big enough for what's drawn on it.
    groups = [...gs.values()].map((g) => {
      const mine = marks.filter((m) => m.group === g.name);
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const m of mine) {
        const pts = m.kind === "line" ? m.p : textBox(m);
        for (const [x, y] of pts) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      }
      if (!mine.length) [x0, y0, x1, y1] = [0, 0, 1, 1];
      const pad = 6;
      const box = { x: Math.floor(x0 - pad), y: Math.floor(y0 - pad), w: Math.ceil(x1 - x0 + 2 * pad), h: Math.ceil(y1 - y0 + 2 * pad) };
      const c = document.createElement("canvas");
      c.width = Math.ceil(box.w * dpr);
      c.height = Math.ceil(box.h * dpr);
      const ctx = c.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, -box.x * dpr, -box.y * dpr);
      ctx.fillStyle = INK;
      return { ...g, box, c, ctx, marks: mine };
    });
    out = document.createElement("canvas");
    out.width = Math.ceil(w * dpr);
    out.height = Math.ceil(h * dpr);
    outCtx = out.getContext("2d");
    if (!paper) {
      fallback?.remove();
      fallback = out;
      out.className = "diagram-canvas";
      el.append(out);
    }
    hotspots();
    reset(shown ? built.end : 0);
  }

  function textBox(m) {
    const pts = [[m.x, m.y - m.size], [m.x + m.w, m.y - m.size], [m.x, m.y + m.size * 0.35], [m.x + m.w, m.y + m.size * 0.35]];
    if (!m.m) return pts;
    const [a, b, c, d] = m.m;
    return pts.map(([x, y]) => [m.x + a * (x - m.x) + c * (y - m.y), m.y + b * (x - m.x) + d * (y - m.y)]);
  }

  // Rub everything out and draw up to time t at once.
  function reset(to = 0) {
    for (const g of groups) {
      g.ctx.save();
      g.ctx.setTransform(1, 0, 0, 1, 0, 0);
      g.ctx.clearRect(0, 0, g.c.width, g.c.height);
      g.ctx.restore();
      for (const m of g.marks) m.done = 0;
    }
    t = 0;
    advance(to);
  }

  // Lay the pencil from wherever each mark got to, up to time t.
  function advance(to) {
    t = to;
    for (const g of groups) {
      const ctx = g.ctx;
      for (const m of g.marks) {
        if (t <= m.start || m.done >= 1) continue;
        const k = ease(Math.min(1, (t - m.start) / m.dur));
        if (k <= m.done) continue;
        if (m.kind === "line") drawLine(ctx, m, m.done, k);
        else drawText(ctx, m, m.done, k);
        m.done = k;
      }
    }
  }

  function drawLine(ctx, m, from, to) {
    const a = from * m.len;
    const b = to * m.len;
    const r = rng(((m.start * 1000) | 0) + Math.round(a * 10));
    let i = 1;
    while (i < m.p.length && m.cum[i] < a) i++;
    let prev = at(m, a, i);
    for (; i < m.p.length && m.cum[i - 1] < b; i++) {
      const s = Math.min(b, m.cum[i]);
      const next = at(m, s, i);
      layLine(ctx, prev, next, m.pr(s), r);
      prev = next;
    }
  }
  function at(m, s, i) {
    const [x0, y0] = m.p[i - 1];
    const [x1, y1] = m.p[Math.min(i, m.p.length - 1)];
    const seg = m.cum[Math.min(i, m.p.length - 1)] - m.cum[i - 1] || 1;
    const u = Math.min(1, Math.max(0, (s - m.cum[i - 1]) / seg));
    return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u];
  }

  function drawText(ctx, m, from, to) {
    // Writing is set once into its own little canvas, then uncovered.
    if (!m.stamp) {
      const pad = 4;
      const h = m.size * 1.5 + pad * 2;
      const c = document.createElement("canvas");
      c.width = Math.ceil((m.w + pad * 2) * dpr);
      c.height = Math.ceil(h * dpr);
      const x = c.getContext("2d");
      x.scale(dpr, dpr);
      x.font = `${m.size}px ${FONT}`;
      x.fillStyle = INK;
      x.fillText(m.str, pad, pad + m.size * 1.05);
      m.stamp = { c, pad, h };
    }
    const { c, pad, h } = m.stamp;
    const sx0 = Math.floor(from * c.width);
    const sx1 = Math.ceil(to * c.width);
    if (sx1 <= sx0) return;
    ctx.save();
    if (m.m) {
      ctx.translate(m.x, m.y);
      ctx.transform(...m.m, 0, 0);
      ctx.translate(-m.x, -m.y);
    }
    ctx.drawImage(c, sx0, 0, sx1 - sx0, c.height, m.x - pad + sx0 / dpr, m.y - pad - m.size * 1.05, (sx1 - sx0) / dpr, h);
    ctx.restore();
  }

  // Put the groups together where they are now, with anything passing over.
  function compose() {
    outCtx.setTransform(1, 0, 0, 1, 0, 0);
    outCtx.clearRect(0, 0, out.width, out.height);
    const off = built.offsets?.(t, state) ?? {};
    for (const g of groups) {
      const [dx, dy, alpha = 1] = off[g.name] ?? [0, 0];
      if (g.veil) {
        // A group drawn on tracing paper mostly hides what's beneath it.
        outCtx.setTransform(dpr, 0, 0, dpr, dx * dpr, dy * dpr);
        outCtx.globalCompositeOperation = "destination-out";
        outCtx.globalAlpha = 0.82 * alpha;
        outCtx.beginPath();
        g.veil.forEach(([x, y], i) => (i ? outCtx.lineTo(x, y) : outCtx.moveTo(x, y)));
        outCtx.fill();
        outCtx.globalCompositeOperation = "source-over";
        outCtx.setTransform(1, 0, 0, 1, 0, 0);
      }
      outCtx.globalAlpha = alpha;
      outCtx.drawImage(g.c, (g.box.x + dx) * dpr, (g.box.y + dy) * dpr, g.c.width, g.c.height);
    }
    outCtx.globalAlpha = 1;
    if (built.overlay) {
      outCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      outCtx.fillStyle = INK;
      built.overlay(outCtx, { t, state, layLine, rng, pen: overlayPen });
    }
    if (paper && slot !== null) {
      pos ??= offsetIn(el, sheet);
      paper.figure(slot, out, [pos[0], pos[1], built.w, built.h]);
      redraw();
    }
  }

  // Springs for anything the scene wants eased toward a goal (a layer
  // lifting under the pointer). Returns whether any is still moving.
  function springs(dt) {
    let moving = false;
    for (const s of Object.values(state.springs)) {
      const d = s.goal - s.v;
      if (Math.abs(d) < 0.002 || reduced.matches) s.v = s.goal;
      else {
        s.v += d * (1 - Math.exp(-dt * (s.rate ?? 10)));
        moving = true;
      }
    }
    return moving;
  }

  function tick(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - (lastNow || now)) / 1000);
    lastNow = now;
    state.now = now / 1000;
    if (playing) {
      advance(Math.min(built.end, t + dt));
      if (t >= built.end) playing = false;
    }
    const moving = springs(dt);
    const busy = built.busy?.(state) ?? false;
    compose();
    if (playing || moving || busy) raf = requestAnimationFrame(tick);
    else lastNow = 0;
  }
  const wake = () => {
    if (!raf && built) raf = requestAnimationFrame(tick);
  };

  function play() {
    shown = true;
    if (reduced.matches) {
      reset(built.end);
      compose();
      return;
    }
    reset(0);
    playing = true;
    wake();
  }

  // ---- what a reader can point at ----
  const spots = [];
  function hotspots() {
    for (const s of spots) s.remove();
    spots.length = 0;
    for (const h of built.hotspots ?? []) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "diagram-spot";
      b.setAttribute("aria-label", h.label);
      Object.assign(b.style, { left: `${h.x}px`, top: `${h.y}px`, width: `${h.w}px`, height: `${h.h}px` });
      const enter = () => {
        state.hover = h.id;
        state.now = performance.now() / 1000;
        built.on?.("enter", h.id, state);
        wake();
      };
      const leave = () => {
        if (state.hover === h.id) state.hover = null;
        state.now = performance.now() / 1000;
        built.on?.("leave", h.id, state);
        wake();
      };
      // Only a mouse hovers; a tap is a press, and a tap's focus isn't a hover.
      b.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && enter());
      b.addEventListener("pointerleave", (e) => e.pointerType === "mouse" && leave());
      b.addEventListener("focus", () => b.matches(":focus-visible") && enter());
      b.addEventListener("blur", leave);
      b.addEventListener("click", () => {
        if (h.id === "again") return play();
        state.now = performance.now() / 1000;
        built.on?.("press", h.id, state);
        wake();
      });
      // Pressing a spot mustn't pick up the page.
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      el.append(b);
      spots.push(b);
    }
  }

  // An overlay pen: marks that come and go each frame (a packet in
  // flight, a ring around what's pointed at). Seeded, so they hold still.
  const overlayPen = {
    line(ctx, pts, { press = 0.5, seed = 1, upto = 1 } = {}) {
      const r = rng(seed);
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      let left = total * upto;
      for (let i = 1; i < pts.length && left > 0; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const u = Math.min(1, left / (len || 1));
        layLine(ctx, a, [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], press, r);
        left -= len;
      }
    },
    ring(ctx, cx, cy, rx, ry, { seed = 3, upto = 1, press = 0.45 } = {}) {
      const r = rng(seed);
      const a0 = r() * 6.28;
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const a = a0 + (i / 36) * 6.2832;
        const k = 1 + (i / 40) * 0.08 + (r() - 0.5) * 0.02;
        pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
      }
      overlayPen.line(ctx, pts, { seed, upto, press });
    },
    dot(ctx, x, y, rad = 3.5, seed = 5) {
      const r = rng(seed);
      for (let a = 0; a < 6.28; a += 0.5) layLine(ctx, [x, y], [x + Math.cos(a) * rad, y + Math.sin(a) * rad], 0.9, r);
    },
  };

  build();
  const io = new IntersectionObserver(
    ([e]) => {
      if (e.isIntersecting && !shown) {
        io.disconnect();
        play();
      }
    },
    { threshold: 0.35 },
  );
  io.observe(el);
  let lastW = el.clientWidth;
  const ro = new ResizeObserver(() => {
    if (el.clientWidth === lastW && built?.h === el.clientHeight) return;
    lastW = el.clientWidth;
    build();
    compose();
  });
  ro.observe(el);
  // New data: rub it out and draw it again, if it's been drawn already.
  const update = () => {
    build();
    if (!built) return;
    if (shown) play();
    else compose();
  };
  el.addEventListener("figure:update", update);
  compose();

  return {
    stop() {
      el.removeEventListener("figure:update", update);
      io.disconnect();
      ro.disconnect();
      cancelAnimationFrame(raf);
      for (const s of spots) s.remove();
      fallback?.remove();
      if (slot !== null) paper?.figure(slot, null);
    },
    get slot() {
      return slot;
    },
    // Given one of the paper's slots to draw in, or null to give it back.
    setSlot(n) {
      if (n === slot) return;
      if (slot !== null && n === null) paper?.figure(slot, null);
      slot = n;
      if (built && slot !== null) compose();
      else redraw();
    },
    el,
    // The sheet moved under the figure (text above it reflowed).
    place() {
      pos = null;
      if (built) compose();
    },
  };
}

// ---- the reader's own visit, for figures that measure it -------------------

let visitP = null;
function visit() {
  visitP ??= (async () => {
    const v = {};
    const n = performance.getEntriesByType?.("navigation")?.[0];
    if (n) {
      const ms = (a, b) => Math.max(0, Math.round(b - a));
      v.dns = ms(n.domainLookupStart, n.domainLookupEnd);
      v.connect = ms(n.connectStart, n.secureConnectionStart > 0 ? n.secureConnectionStart : n.connectEnd);
      v.tls = n.secureConnectionStart > 0 ? ms(n.secureConnectionStart, n.connectEnd) : 0;
      v.wait = ms(n.requestStart, n.responseStart);
      v.download = ms(n.responseStart, n.responseEnd);
      v.proto = n.nextHopProtocol || "";
      v.bytes = n.transferSize || 0;
      v.reused = n.connectEnd === n.connectStart;
    }
    // Which Cloudflare data centre answered, from its trace page.
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 1500);
      const res = await fetch("/cdn-cgi/trace", { signal: ctl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const kv = Object.fromEntries((await res.text()).trim().split("\n").map((l) => l.split("=")));
        v.colo = kv.colo || "";
        v.http = kv.http || "";
        v.tlsVersion = kv.tls || "";
      }
    } catch {}
    return v;
  })();
  return visitP;
}

// ---- all the figures on the shown sheet ------------------------------------

const SLOTS = 4;

export function startFigures({ paper, sheet, redraw }) {
  let live = [];
  let gen = 0;
  let near = null;
  // The paper has four slots for figures; they go to whichever figures are
  // on or near the screen, and are handed back as a figure scrolls away.
  function share() {
    const want = live.filter((f) => f.near);
    for (const f of live) if (!f.near && f.slot !== null) f.setSlot(null);
    const used = new Set(want.map((f) => f.slot).filter((n) => n !== null));
    for (const f of want) {
      if (f.slot !== null) continue;
      let n = 0;
      while (used.has(n) && n < SLOTS) n++;
      if (n >= SLOTS) break;
      used.add(n);
      f.setSlot(n);
    }
  }
  async function mountAll() {
    const mine = ++gen;
    near?.disconnect();
    for (const f of live) f.stop();
    live = [];
    const els = [...sheet.querySelectorAll("figure.diagram[data-fig]")];
    if (!els.length) return;
    const v = await visit();
    if (mine !== gen) return;
    // A page can hand a figure its own data (el.figData; see days.js).
    const mounted = await Promise.all(els.map((el) => mountFigure(el, { paper, sheet, redraw, data: () => el.figData ?? v })));
    if (mine !== gen) return mounted.forEach((f) => f?.stop());
    live = mounted.filter(Boolean);
    near = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const f = live.find((x) => x.el === e.target);
          if (f) f.near = e.isIntersecting;
        }
        share();
      },
      { rootMargin: "50% 0px" },
    );
    for (const f of live) near.observe(f.el);
  }
  mountAll();
  window.addEventListener("sheet:swap", mountAll);
  // Safari fires resize as its toolbar moves; a new width is handled by each
  // figure's ResizeObserver, so only re-place when the viewport really changes.
  let placedWidth = innerWidth;
  window.addEventListener("resize", () => {
    if (innerWidth === placedWidth) return;
    placedWidth = innerWidth;
    live.forEach((f) => f.place());
  });
}
