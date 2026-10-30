// What the figures on how-the-web-works share: the same browser window and
// rack of machines wherever they turn up, and the same way of sending a
// request along a drawing when a part of it is pressed. Not a figure itself.

// A browser window: three dots, an address bar, a few lines of page.
export function browser(pen, x, y, w, h) {
  pen.rect(x, y, w, h);
  pen.line([[x + 2, y + 20], [x + w - 2, y + 20]], { press: 0.4 });
  for (let i = 0; i < 3; i++) pen.circle(x + 11 + i * 9, y + 10, 2.6, { press: 0.4, speed: 2 });
  pen.rect(x + 40, y + 4, w - 48, 12, { press: 0.3, speed: 2 });
  pen.text("burcs.dev", x + 46, y + 14, { size: 11 });
  const rows = Math.max(1, Math.floor((h - 28) / 17));
  for (let k = 0; k < rows; k++) {
    const yy = y + 34 + k * 17;
    pen.line([[x + 12, yy], [x + 12 + (w - 24) * [0.7, 0.85, 0.5, 0.65][k % 4], yy]], { press: 0.28, speed: 2 });
  }
  return { x, y, w, h };
}

// A rack of n machines, each with a light. Returns its box.
export function rack(pen, x, y, w, n = 3) {
  for (let i = 0; i < n; i++) {
    const yy = y + i * 34;
    pen.rect(x, yy, w, 28, { press: 0.5 });
    pen.circle(x + w - 12, yy + 14, 3, { press: 0.5, speed: 2 });
    pen.line([[x + 10, yy + 10], [x + 44, yy + 10]], { press: 0.25, speed: 2 });
    pen.line([[x + 10, yy + 18], [x + 34, yy + 18]], { press: 0.25, speed: 2 });
  }
  return { x, y, w, h: n * 34 - 6 };
}

// The point a fraction k of the way along a polyline.
export function along(pts, k) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let left = total * Math.min(1, Math.max(0, k));
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (left <= len) {
      const u = len ? left / len : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u];
    }
    left -= len;
  }
  return pts[pts.length - 1];
}

// How long a stretch of the reader's visit takes on the page: slowed down
// enough to follow, but never so slow it drags.
export const slow = (ms, extra = 0) => Math.min(1.8, Math.max(0.45, ((Number.isFinite(ms) ? ms : 40) * 14) / 1000)) + extra;

export const spot = (id, label, b, pad = 6) => ({ id, label, x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 });

// Pressing a spot sends a request: trip(id) gives the legs it travels,
// each { path, d } (a polyline, seconds), plus anything extra to draw
// with it. Pointing at a spot rings it in pencil.
export function requests(hotspots, trip, { drawn } = {}) {
  return {
    hotspots,
    on(kind, id, state) {
      state.springs[id] ??= { v: 0, goal: 0, rate: 9 };
      if (kind === "enter") state.springs[id].goal = 1;
      if (kind === "leave") state.springs[id].goal = 0;
      if (kind === "press") {
        let at = 0;
        const legs = trip(id).map((l) => ({ ...l, t0: (at += l.d) - l.d }));
        state.trip = { start: state.now, legs, total: at };
      }
    },
    busy: (state) => !!state.trip,
    overlay(ctx, { state, pen: o }) {
      for (const s of hotspots) {
        const k = state.springs[s.id]?.v ?? 0;
        if (k > 0.01) o.ring(ctx, s.x + s.w / 2, s.y + s.h / 2, s.w / 2 + 6, s.h / 2 + 8, { upto: k, seed: s.id.length * 31 });
      }
      const trip = state.trip;
      if (!trip) return;
      const e = state.now - trip.start;
      if (e > trip.total + 0.6) {
        state.trip = null;
        return;
      }
      const leg = trip.legs.find((l) => e < l.t0 + l.d) ?? trip.legs[trip.legs.length - 1];
      const k = Math.min(1, Math.max(0, (e - leg.t0) / leg.d));
      if (leg.path) {
        const [px, py] = along(leg.path, k);
        o.dot(ctx, px, py, 4);
      }
      drawn?.(ctx, o, { leg, k, e, trip });
    },
  };
}
