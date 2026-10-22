// Doodling on the page in pencil: "doodle" in the margin turns it on and
// off (?doodle starts with it on). Strokes are drawn into a canvas the size
// of the resting sheet, in its own square frame, and the paper shader lays
// them into the tooth like the writing: flecked where the pencil was light,
// filled where it was pressed, catching the light as you move.
//
// Your own strokes stay on this page until you turn it or press c, or you
// pin them up for Brandon to approve (wall.js). Doodles he's approved are
// drawn on their page for everyone, each signed by whoever drew it.

import { rng } from "./hand.js";
import { INK, layLine, drawStrokes, corner } from "./pencil.js";
import { pinUp, wallApi } from "./wall.js";

export const doodleParam = new URLSearchParams(location.search).has("doodle");

// on: start with the pencil in hand. sheet: the resting sheet's element.
// rect(): its untilted box on screen. tilt(): how far it's turned, in
// radians. busy(): true while a page is being turned. redraw(): asks for a
// frame.
export function startDoodle({ on, paper, sheet, rect, tilt, busy, redraw }) {
  if (!paper) return;

  let canvas = null;
  let ctx = null;
  let scale = 1;
  let stroke = null;
  let pending = false;
  let mine = [];      // this visit's strokes: flat runs of x, y, pressure
  let guests = [];    // approved doodles for this page
  let page = location.pathname;

  let active = false;
  const set = (v) => {
    active = v;
    stroke = null;
    document.documentElement.classList.toggle("doodling", v);
  };
  document.addEventListener("click", (e) => {
    const tool = e.target.closest?.("[data-tool]")?.dataset.tool;
    if (tool === "doodle") set(!active);
    if (tool === "pin") pin();
  });

  // A clean sheet, with the approved doodles drawn back on.
  function fresh() {
    scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas = document.createElement("canvas");
    canvas.width = Math.ceil(sheet.offsetWidth * scale);
    canvas.height = Math.ceil(sheet.offsetHeight * scale);
    ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = INK;
    mine = [];
    stroke = null;
    sheet.querySelectorAll(".guest-sig").forEach((s) => s.remove());
    const w = sheet.offsetWidth;
    for (const g of guests) {
      const k = w / g.w;
      drawStrokes(ctx, g.strokes, k, rng(parseInt(g.id.slice(-6), 36) || 1));
      if (!g.name) continue;
      const [x, y] = corner(g.strokes, k);
      const sig = document.createElement("span");
      sig.className = "guest guest-sig";
      sig.textContent = `— ${g.name}`;
      sig.style.left = `${Math.min(x, w - 12)}px`;
      sig.style.top = `${y + 2}px`;
      sheet.append(sig);
    }
    if (guests.length) upload();
    else paper.doodle(null);
    redraw();
  }

  async function load() {
    page = location.pathname;
    guests = [];
    fresh();
    try {
      const { items } = await wallApi("GET", { query: `page=${encodeURIComponent(page)}` });
      if (page !== location.pathname) return;
      guests = items;
      if (guests.length) fresh();
    } catch {}
  }
  load();
  set(on);

  function pin() {
    if (!mine.length) return;
    const strokes = mine.map((s) => s.slice());
    const w = sheet.offsetWidth;
    const h = sheet.offsetHeight;
    pinUp({
      title: "Pin your doodle to the wall?",
      send: (name) => wallApi("POST", { body: { kind: "doodle", page, name, w, h, strokes } }),
    });
  }

  // Re-send the canvas once per frame at most, however many events came in.
  function upload() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      paper.doodle(canvas, canvas.width / scale, canvas.height / scale);
      redraw();
    });
  }

  // A screen point in the sheet's own frame, undoing its tilt.
  function local(e) {
    const r = rect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const c = Math.cos(tilt());
    const s = Math.sin(tilt());
    return [c * dx + s * dy + r.width / 2, -s * dx + c * dy + r.height / 2];
  }

  // A pen reports pressure; a mouse or finger doesn't, so speed stands in
  // for it: a slow line is a pressed one.
  function pressure(e, speed) {
    if (e.pointerType === "pen" && e.pressure > 0) return Math.min(1, 0.25 + e.pressure);
    return Math.min(1, Math.max(0.35, 1.05 - speed / 2.2));
  }

  const keep = (p, press) => stroke.points.push(Math.round(p[0] * 2) / 2, Math.round(p[1] * 2) / 2, Math.round(press * 100) / 100);

  sheet.addEventListener("pointerdown", (e) => {
    if (!active || e.button !== 0 || busy() || e.target.closest("a, button, input, textarea, .tools")) return;
    e.preventDefault();
    sheet.setPointerCapture(e.pointerId);
    const p = local(e);
    stroke = { last: p, t: e.timeStamp, press: 0.7, id: e.pointerId, points: [] };
    mine.push(stroke.points);
    keep(p, 0.7);
    layLine(ctx, p, [p[0] + 0.1, p[1]], 0.7);
    upload();
  });

  sheet.addEventListener("pointermove", (e) => {
    if (!stroke || e.pointerId !== stroke.id) return;
    for (const c of e.getCoalescedEvents?.() ?? [e]) {
      const p = local(c);
      const dt = Math.max(1, c.timeStamp - stroke.t);
      const speed = Math.hypot(p[0] - stroke.last[0], p[1] - stroke.last[1]) / dt;
      // Pressure eases from touch to touch; a hand doesn't jump.
      stroke.press += (pressure(c, speed) - stroke.press) * 0.25;
      layLine(ctx, stroke.last, p, stroke.press);
      // Kept a little sparser than drawn: enough to redraw it faithfully.
      if (Math.hypot(p[0] - stroke.points.at(-3), p[1] - stroke.points.at(-2)) >= 1.5) keep(p, stroke.press);
      stroke.last = p;
      stroke.t = c.timeStamp;
    }
    upload();
  });

  const end = (e) => {
    if (!stroke || e.pointerId !== stroke.id) return;
    keep(stroke.last, stroke.press);
    stroke = null;
    document.documentElement.classList.toggle("has-doodle", mine.length > 0);
  };
  sheet.addEventListener("pointerup", end);
  sheet.addEventListener("pointercancel", end);

  // A new page loads its own doodles; a sheet laid out at a new size is
  // drawn again.
  window.addEventListener("sheet:swap", () => {
    document.documentElement.classList.remove("has-doodle");
    load();
  });
  let lastSize = `${sheet.offsetWidth}x${sheet.offsetHeight}`;
  window.addEventListener("resize", () => {
    const size = `${sheet.offsetWidth}x${sheet.offsetHeight}`;
    if (size !== lastSize) {
      lastSize = size;
      fresh();
      document.documentElement.classList.remove("has-doodle");
    }
  });

  // c clears your own strokes.
  window.addEventListener("keydown", (e) => {
    if (active && e.key === "c" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.closest?.("input, textarea, [contenteditable]")) {
      fresh();
      document.documentElement.classList.remove("has-doodle");
    }
  });
}
