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
import { INK, layLine, drawStrokes, drawGraphiteStrokes, drawGraphiteSignature, corner } from "./pencil.js";
import { pinUp, wallApi } from "./wall.js";

export const doodleParam = new URLSearchParams(location.search).has("doodle");
const wallSheet = () => Number(new URLSearchParams(location.search).get("sheet")) || 1;

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
  let canArrange = false;
  let arranging = false;
  const handles = new Map();

  // The sheet's margin tools can be below the viewport (and are absent on
  // small screens). Keep the action next to the drawing while it's in use.
  const bar = document.createElement("div");
  bar.className = "doodle-bar";
  const start = document.createElement("button");
  start.type = "button";
  start.dataset.tool = "doodle";
  start.textContent = "Doodle on this page";
  const help = document.createElement("span");
  help.className = "doodle-help";
  help.textContent = "Draw anywhere on the page";
  const save = document.createElement("button");
  save.type = "button";
  save.dataset.tool = "pin";
  save.textContent = "Save doodle";
  const done = document.createElement("button");
  done.type = "button";
  done.dataset.tool = "doodle";
  done.textContent = "Done";
  bar.append(start, help, save, done);
  document.body.append(bar);

  let active = false;
  const syncBar = () => {
    bar.classList.toggle("active", active);
    save.disabled = mine.length === 0;
    help.textContent = mine.length ? "Ready to pin to the wall" : "Draw anywhere on the page";
    document.documentElement.classList.toggle("has-doodle", mine.length > 0);
  };
  const set = (v) => {
    v = v && location.pathname === "/wall/";
    active = v;
    stroke = null;
    document.documentElement.classList.toggle("doodling", v);
    syncBar();
  };
  document.addEventListener("click", (e) => {
    const tool = e.target.closest?.("[data-tool]")?.dataset.tool;
    if (tool === "doodle") set(!active);
    if (tool === "pin") pin();
  });

  const bounds = (g, dx = g.dx || 0, dy = g.dy || 0) => {
    if (!g.rawBounds) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of g.strokes) {
        for (let i = 0; i < s.length; i += 3) {
          x0 = Math.min(x0, s[i]);
          y0 = Math.min(y0, s[i + 1]);
          x1 = Math.max(x1, s[i]);
          y1 = Math.max(y1, s[i + 1]);
        }
      }
      g.rawBounds = { x0, y0, x1, y1 };
    }
    const b = g.rawBounds;
    return { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy };
  };

  const canPlace = (g, dx, dy) => {
    const b = bounds(g, dx, dy);
    if (b.x0 < 4 || b.y0 < 4 || b.x1 > g.w - 4 || b.y1 > g.h - 4) return false;
    return guests.every((other) => {
      if (other.id === g.id || other.hidden) return true;
      const otherBounds = bounds(other);
      const k = g.w / other.w;
      const o = { x0: otherBounds.x0 * k, y0: otherBounds.y0 * k, x1: otherBounds.x1 * k, y1: otherBounds.y1 * k };
      return b.x0 >= o.x1 + 10 || b.x1 + 10 <= o.x0 || b.y0 >= o.y1 + 10 || b.y1 + 10 <= o.y0;
    });
  };

  function syncHandles() {
    if (!arranging || !canArrange) {
      for (const handle of handles.values()) handle.remove();
      handles.clear();
      return;
    }
    const visible = guests.filter((g) => !g.hidden);
    for (const g of visible) {
      let handle = handles.get(g.id);
      if (!handle) {
        handle = document.createElement("button");
        handle.type = "button";
        handle.className = "doodle-handle";
        handle.setAttribute("aria-label", `Move ${g.name ? `${g.name}'s` : "this"} doodle`);
        handle.addEventListener("pointerdown", (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          handle.setPointerCapture(e.pointerId);
          const start = local(e);
          const original = [g.dx || 0, g.dy || 0];
          const k = sheet.offsetWidth / g.w;
          handle.onpointermove = (move) => {
            if (move.pointerId !== e.pointerId) return;
            const at = local(move);
            const dx = Math.round((original[0] + (at[0] - start[0]) / k) * 2) / 2;
            const dy = Math.round((original[1] + (at[1] - start[1]) / k) * 2) / 2;
            if (!canPlace(g, dx, dy)) return;
            g.dx = dx;
            g.dy = dy;
            paint();
          };
          const finish = async (save) => {
            handle.onpointermove = handle.onpointerup = handle.onpointercancel = null;
            if (!save) {
              [g.dx, g.dy] = original;
              paint();
              return;
            }
            if ((g.dx || 0) === original[0] && (g.dy || 0) === original[1]) return;
            try {
              const moved = await wallApi("PATCH", {
                sub: "/position",
                query: `id=${encodeURIComponent(g.id)}&page=${encodeURIComponent(g.page)}`,
                body: { dx: g.dx || 0, dy: g.dy || 0 },
              });
              g.dx = moved.dx;
              g.dy = moved.dy;
            } catch (error) {
              [g.dx, g.dy] = original;
              window.dispatchEvent(new CustomEvent("wall:arrange-error", { detail: { message: error.message } }));
            }
            paint();
          };
          handle.onpointerup = (up) => {
            up.stopPropagation();
            finish(true);
          };
          handle.onpointercancel = () => finish(false);
        });
        handles.set(g.id, handle);
        sheet.append(handle);
      }
      const b = bounds(g);
      const k = sheet.offsetWidth / g.w;
      handle.style.left = `${b.x0 * k - 8}px`;
      handle.style.top = `${b.y0 * k - 8}px`;
      handle.style.width = `${(b.x1 - b.x0) * k + 16}px`;
      handle.style.height = `${(b.y1 - b.y0) * k + 16}px`;
    }
    for (const [id, handle] of handles) {
      if (visible.some((g) => g.id === id)) continue;
      handle.remove();
      handles.delete(id);
    }
  }

  // Rebuild the canvas when an approved doodle moves, preserving any drawing
  // the visitor has made on this sheet.
  function paint() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width / scale, canvas.height / scale);
    ctx.fillStyle = INK;
    sheet.querySelectorAll(".guest-sig").forEach((s) => s.remove());
    const w = sheet.offsetWidth;
    for (const g of guests) {
      if (g.hidden) continue;
      const k = w / g.w;
      ctx.save();
      ctx.translate((g.dx || 0) * k, (g.dy || 0) * k);
      drawGraphiteStrokes(ctx, g.strokes, k, rng(parseInt(g.id.slice(-6), 36) || 1));
      ctx.restore();
      if (!g.name) continue;
      const [x, y] = corner(g.strokes, k);
      const sig = document.createElement("span");
      sig.className = "guest guest-sig graphite-sig";
      sig.textContent = `— ${g.name}`;
      sig.style.left = `${Math.min(x + (g.dx || 0) * k, w - 12)}px`;
      sig.style.top = `${y + (g.dy || 0) * k + 2}px`;
      sheet.append(sig);
      const css = getComputedStyle(sig);
      const fs = parseFloat(css.fontSize);
      drawGraphiteSignature(ctx, sig.textContent, `${fs}px ${css.fontFamily}`, fs,
        parseFloat(sig.style.left) - sig.offsetWidth, parseFloat(sig.style.top), sig.offsetWidth);
    }
    if (mine.length) drawStrokes(ctx, mine, 1, rng(11));
    syncHandles();
    if (guests.some((g) => !g.hidden) || mine.length) upload();
    else { paper.doodle(null); redraw(); }
  }

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
    paint();
    syncBar();
  }

  let loadVersion = 0;
  async function refreshGuests(version = loadVersion) {
    const target = page;
    if (target !== "/wall/") return;
    try {
      const { items, author } = await wallApi("GET", { query: `page=${encodeURIComponent(target)}&sheet=${wallSheet()}` });
      if (version !== loadVersion || target !== location.pathname) return;
      guests = items;
      canArrange = !!author;
      paint();
    } catch {}
  }

  async function load() {
    ++loadVersion;
    page = location.pathname;
    guests = [];
    canArrange = false;
    fresh();
    refreshGuests();
  }
  load();
  set(on);
  window.addEventListener("wall:refresh", () => refreshGuests());
  window.addEventListener("wall:arrange", (e) => {
    arranging = !!e.detail.active;
    if (arranging) set(false);
    syncHandles();
  });

  function pin() {
    if (!mine.length || page !== "/wall/") return;
    const strokes = mine.map((s) => s.slice());
    const w = sheet.offsetWidth;
    const h = sheet.offsetHeight;
    pinUp({
      title: "Save your doodle to the wall?",
      send: (name) => wallApi("POST", { body: { kind: "doodle", page, sheet: wallSheet(), name, w, h, strokes } }),
      onSuccess: () => {
        mine = [];
        paint();
        set(false);
      },
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
    syncBar();
  };
  sheet.addEventListener("pointerup", end);
  sheet.addEventListener("pointercancel", end);

  // A new page loads its own doodles; a sheet laid out at a new size is
  // drawn again.
  window.addEventListener("sheet:swap", () => {
    set(false);
    document.querySelector(".pin-note")?.remove();
    load();
  });
  let lastSize = `${sheet.offsetWidth}x${sheet.offsetHeight}`;
  window.addEventListener("resize", () => {
    const size = `${sheet.offsetWidth}x${sheet.offsetHeight}`;
    if (size !== lastSize) {
      lastSize = size;
      fresh();
    }
  });

  // c clears your own strokes.
  window.addEventListener("keydown", (e) => {
    if (active && e.key === "c" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.closest?.("input, textarea, [contenteditable]")) {
      fresh();
    }
  });
}
