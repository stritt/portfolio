import { createPaper } from "./paper.js";
import { createInk } from "./ink.js";

const root = document.documentElement;
const sheet = document.getElementById("sheet");
const canvas = document.getElementById("gl");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const darkMq = matchMedia("(prefers-color-scheme: dark)");
// ?theme=dark|light overrides the system setting (handy for previewing).
const forced = new URLSearchParams(location.search).get("theme");
if (forced) root.dataset.theme = forced;
const isDark = () => (forced ? forced === "dark" : darkMq.matches);
// Punched holes are off by default; ?holes brings them back to compare.
const showHoles = new URLSearchParams(location.search).has("holes");
// ?slow (or ?slow=N) plays page transitions N times slower, for tuning.
const slowParam = new URLSearchParams(location.search).get("slow");
const slow = slowParam === null ? 1 : Number(slowParam) || 6;

// ?plain leaves the text in the plain cut, without the Graphite ink.
const plainOnly = new URLSearchParams(location.search).has("plain");

// ---- sheet geometry ----------------------------------------------------
// Real US loose-leaf: 8.5in wide, wide-ruled at 11/32in, a red margin line
// 1.25in in, three 1/4in holes on 4.25in centres. Everything scales off the
// sheet width (u = one inch), except the rule spacing, which never drops
// below a comfortable line of text.

const geo = {};

function layout() {
  const vw = root.clientWidth;
  const gutter = vw < 640 ? 12 : 40;
  const W = Math.min(816, vw - gutter * 2);
  const u = W / 8.5;
  const L = Math.max(28, Math.round((u * 11) / 32));
  const n0 = Math.max(2, Math.ceil((u * 0.95) / L));
  const mx = Math.round(Math.max(46, u * 1.25));

  Object.assign(geo, {
    W,
    u,
    L,
    n0,
    mx,
    holeX: Math.max(17, u * 0.4),
    holeR: Math.max(6.5, u * 0.13),
  });

  const vars = {
    "--W": `${W}px`,
    "--L": `${L}px`,
    "--n0": n0,
    "--mx": `${mx}px`,
    "--pad-l": `${mx + Math.max(10, u * 0.2)}px`,
    "--pad-r": `${Math.max(14, u * 0.45)}px`,
    "--pad-b": `${(Math.ceil((u * 0.45) / L) + 1) * L}px`,
    "--H-min": `${(W * 11) / 8.5}px`,
    "--gutter": `${gutter}px`,
    "--top-gap": `${vw < 640 ? 16 : 72}px`,
    "--gap": `${Math.max(1, L * 0.04)}px`,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

// Baseline alignment needs the face's real ascent/descent; measure the face
// actually in use so a font change drops in without retuning.
const fontMetrics = { asc: 0.9, desc: 0.25 };
async function measureFont() {
  const family = getComputedStyle(sheet).fontFamily;
  try {
    await document.fonts.load(`100px ${family}`);
  } catch {}
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `100px ${family}`;
  const m = ctx.measureText("Hxgj");
  if (m.fontBoundingBoxAscent) {
    fontMetrics.asc = m.fontBoundingBoxAscent / 100;
    fontMetrics.desc = m.fontBoundingBoxDescent / 100;
    root.style.setProperty("--asc", (m.fontBoundingBoxAscent / 100).toFixed(4));
    root.style.setProperty("--desc", (m.fontBoundingBoxDescent / 100).toFixed(4));
  }
}

layout();
const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 200));
measureFont().then(() => {
  root.classList.add("ready");
  // Graphite (~3x the plain cut) never blocks first paint: the page shows in
  // the plain cut and its ink is swapped in once drawn (see ink.js).
  const later = () =>
    idle(
      () => {
        showMainInk(shownPath);
        prefetchLinkedInk();
      },
      { timeout: 2000 },
    );
  if (document.readyState === "complete") later();
  else window.addEventListener("load", later, { once: true });
});

// ---- renderer ----------------------------------------------------------

let paper = null;
try {
  paper = createPaper(canvas);
} catch (err) {
  console.error(err);
}
if (!paper) {
  root.classList.add("no-gl");
  canvas.remove();
}

let dpr = 1;
function resize() {
  layout();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  paper?.resize(root.clientWidth, window.innerHeight, dpr);
  dirty = true;
  // Ink is drawn for one sheet width and pixel ratio; redraw for the new one
  // once the resize settles, showing the plain cut meanwhile.
  if (ink && lastInkSize !== inkSize()) {
    lastInkSize = inkSize();
    ink.reset();
    mainInk = null;
    sheet.classList.remove("inked");
    clearTimeout(inkTimer);
    inkTimer = setTimeout(() => showMainInk(shownPath), 300);
  }
}

// ---- graphite ink ------------------------------------------------------

const ink = plainOnly || navigator.connection?.saveData ? null : createInk(paper, () => fontMetrics);
canvas.addEventListener?.("webglcontextrestored", () => {
  ink?.reset();
  mainInk = null;
  sheet.classList.remove("inked");
  showMainInk(shownPath);
});
let mainInk = null;
let inkTimer = 0;
const inkSize = () => `${geo.W}@${dpr}`;
let lastInkSize = "";
const inkKey = (path) => `${path}|${inkSize()}`;

// Swap the resting sheet from the plain cut to its ink, once it's drawn.
function showMainInk(path) {
  if (!ink) return;
  lastInkSize = inkSize();
  const key = inkKey(path);
  mainInk = ink.get(key);
  sheet.classList.toggle("inked", !!mainInk);
  dirty = true;
  if (mainInk) return;
  ink
    .request(key, sheet, dpr)
    .then((tex) => {
      if (shownPath !== path || inkKey(path) !== key) return;
      mainInk = tex;
      sheet.classList.add("inked");
      dirty = true;
    })
    .catch(() => {});
}

// Draw the ink for a page not on screen yet, so it's ready to turn to. Its
// sheet is laid out hidden (in the plain cut, which is cheap) to find where
// the text falls.
function prefetchInk(path) {
  if (!ink || ink.has(inkKey(path))) return;
  fetchPage(path)
    .then((page) => {
      if (ink.has(inkKey(path))) return;
      const el = sheet.cloneNode(false);
      el.removeAttribute("id");
      el.removeAttribute("style");
      el.classList.remove("inked");
      el.inert = true;
      el.innerHTML = page.html;
      Object.assign(el.style, { position: "absolute", left: "0", top: "0", visibility: "hidden" });
      document.body.append(el);
      ink.request(inkKey(path), el, dpr).catch(() => {});
      el.remove();
    })
    .catch(() => {});
}

function prefetchLinkedInk() {
  for (const a of sheet.querySelectorAll("a[href]")) {
    if (a.origin === location.origin && a.pathname !== shownPath) prefetchInk(a.pathname);
  }
}

// ---- smooth wheel scrolling --------------------------------------------
// The canvas is fixed and redrawn each frame; native threaded scrolling would
// move the text a frame ahead of the rules under it. Driving wheel scroll
// from the same rAF keeps ink and paper locked together.

let target = window.scrollY;
let current = target;
const maxScroll = () => root.scrollHeight - window.innerHeight;

window.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey || reduced.matches || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? window.innerHeight : 1;
    target = Math.min(Math.max(target + e.deltaY * k, 0), maxScroll());
  },
  { passive: false },
);

window.addEventListener(
  "scroll",
  () => {
    // Keyboard, scrollbar, touch, find-in-page: adopt their position.
    if (Math.abs(window.scrollY - current) > 1.5) target = current = window.scrollY;
    dirty = true;
  },
  { passive: true },
);

// ---- pages -------------------------------------------------------------
// Every page is a real HTML file. Internal links are intercepted: the next
// page's sheet is fetched and the change plays out on the pile of paper.
// Going deeper turns the top sheet over to reveal the next one beneath;
// going back turns the previous sheet back down on top.

// Each page is its own sheet, so each gets its own patch of paper grain.
const seedFor = (path) => {
  let h = 7;
  for (const c of path) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 97;
};
const depth = (path) => path.split("/").filter(Boolean).length;

let mainSeed = seedFor(location.pathname);
let currentPath = location.pathname;
let shownPath = currentPath;   // the page on the resting sheet (lags currentPath mid-turn)
history.scrollRestoration = "manual";

const pages = new Map();
function fetchPage(path) {
  if (!pages.has(path)) {
    const req = fetch(path)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${path}`);
        return r.text();
      })
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const next = doc.getElementById("sheet");
        if (!next) throw new Error(`no #sheet in ${path}`);
        return { title: doc.title, html: next.innerHTML };
      });
    req.catch(() => pages.delete(path));
    pages.set(path, req);
  }
  return pages.get(path);
}

const internalLink = (e) => {
  const a = e.target.closest?.("a[href]");
  if (!a || a.origin !== location.origin || a.target || a.hasAttribute("download")) return null;
  return a;
};

document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = internalLink(e);
  if (!a) return;
  if (a.pathname === location.pathname) {
    if (!a.hash) e.preventDefault();
    return;
  }
  e.preventDefault();
  go(a.pathname, true);
});

// Fetch on hover so the page is usually in hand by the time of the click.
document.addEventListener("pointerover", (e) => {
  const a = internalLink(e);
  if (a && a.pathname !== location.pathname) prefetchInk(a.pathname);
});

window.addEventListener("popstate", () => go(location.pathname, false));

// ---- page-turn sound ----
// A real sheet being turned, clipped from a recording. Decoded on the first
// interaction (audio can't start before one anyway), then played with a
// slight change of pitch and level each time so no two turns sound alike.
let audio = null;
let flipBuf = null;
function primeSound() {
  if (audio) return;
  const AC = window.AudioContext ?? window.webkitAudioContext;
  if (!AC) return;
  audio = new AC();
  fetch("/sounds/flip.mp3")
    .then((r) => r.arrayBuffer())
    .then((b) => audio.decodeAudioData(b))
    .then((buf) => (flipBuf = buf))
    .catch(() => {});
}
for (const ev of ["pointerdown", "keydown", "touchstart"]) {
  window.addEventListener(ev, primeSound, { once: true, passive: true });
}

function playFlip() {
  if (!audio || !flipBuf) return;
  if (audio.state === "suspended") audio.resume();
  const src = audio.createBufferSource();
  src.buffer = flipBuf;
  src.playbackRate.value = (0.94 + Math.random() * 0.12) / Math.sqrt(slow);
  const gain = audio.createGain();
  gain.gain.value = 0.32 + Math.random() * 0.08;
  src.connect(gain).connect(audio.destination);
  src.start();
}

function jumpScroll(y) {
  window.scrollTo(0, y);
  target = current = y;
}

function swap(page, path) {
  sheet.innerHTML = page.html;
  document.title = page.title;
  mainSeed = seedFor(path);
  shownPath = path;
  showMainInk(path);
  idle(prefetchLinkedInk, { timeout: 2000 });
  dirty = true;
}

// The sheet being turned: a fixed-position copy of a sheet. Its fold is
// mirrored into the shader, and both sheets' ink is clipped to the parts of
// paper it sits on, so DOM text and GL paper stay one object.
let flip = null;
let anim = null;

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function makeFlip(html, rect, seed, inkTex) {
  const el = sheet.cloneNode(false);
  el.removeAttribute("id");
  el.classList.toggle("inked", !!inkTex);
  el.classList.add("flip");
  el.setAttribute("aria-hidden", "true");
  el.inert = true;
  el.innerHTML = html;
  Object.assign(el.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px` });
  document.body.append(el);
  rect.h ??= el.offsetHeight;
  el.style.height = `${rect.h}px`;
  return { el, rect, seed, ink: inkTex, F: [0, 0], n: [0, 1] };
}

function endFlip() {
  flip?.el.remove();
  flip = null;
  sheet.style.clipPath = "";
  dirty = true;
}

function finishAnim() {
  if (!anim) return;
  const a = anim;
  anim = null;
  a.step(1);
  a.done();
}

// Turn the page up and over its top edge, like a legal pad. The lifted
// corner starts at bottom right, swings left on the way up so the fold runs
// diagonally, and ends straight, with the whole sheet folded above the
// viewport. k = 0 is flat, k = 1 is fully turned. The corner is taken at the
// bottom of the viewport when the sheet runs past it, so the turn is on
// screen from the first frame.
function setFold(k) {
  const { x, y, w, h } = flip.rect;
  const C = [x + w, Math.min(y + h, window.innerHeight + 20)];
  const top = Math.min(y, 0) - 40;          // final fold line, just off-screen
  const end = [C[0], 2 * top - C[1]];       // the corner mirrored over it
  const swing = w * 0.45 * Math.sin(Math.PI * k);
  const P = [C[0] + (end[0] - C[0]) * k - swing, C[1] + (end[1] - C[1]) * k];
  const nx = C[0] - P[0];
  const ny = C[1] - P[1];
  const len = Math.hypot(nx, ny);
  if (len < 1) {
    // Not started: park the fold just outside the corner.
    flip.n = [0.6, 0.8];
    flip.F = [C[0] + 1, C[1] + 1];
    return;
  }
  flip.n = [nx / len, ny / len];
  flip.F = [(C[0] + P[0]) / 2, (C[1] + P[1]) / 2];
}

async function go(path, push) {
  let page;
  try {
    page = await fetchPage(path);
  } catch {
    location.href = path;
    return;
  }
  finishAnim();
  if (push) history.pushState(null, "", path);
  document.title = page.title;
  const from = currentPath;
  currentPath = path;

  if (reduced.matches || !paper) {
    swap(page, path);
    jumpScroll(0);
    return;
  }

  const r = sheet.getBoundingClientRect();
  const dur = 600 * slow;
  playFlip();

  if (depth(path) >= depth(from)) {
    // Forward: the current page is turned over, the next one is beneath.
    flip = makeFlip(sheet.innerHTML, { x: r.left, y: r.top, w: r.width, h: r.height }, mainSeed, mainInk);
    swap(page, path);
    jumpScroll(0);
    anim = { start: performance.now(), dur, step: (t) => setFold(easeInOut(t)), done: endFlip };
  } else {
    // Back: the previous page is turned back down on top, landing where a
    // page sits at the top of the document while the one beneath scrolls up.
    const top0 = r.top + window.scrollY;
    flip = makeFlip(page.html, { x: r.left, y: top0, w: r.width }, seedFor(path), ink?.get(inkKey(path)));
    target = 0;
    anim = {
      start: performance.now(),
      dur,
      step: (t) => setFold(1 - easeInOut(t)),
      done() {
        swap(page, path);
        jumpScroll(0);
        endFlip();
      },
    };
  }
  setFold(depth(path) >= depth(from) ? 0 : 1);
}

// ---- ink clipping ----
// Both sheets are transparent DOM over the canvas. The turning sheet's ink
// shows only on its flat part (and is hidden under its own flap); the page
// beneath shows only where the turning sheet has lifted away.

function clipPoly(poly, F, n, keepAbove) {
  const side = ([x, y]) => ((x - F[0]) * n[0] + (y - F[1]) * n[1]) * (keepAbove ? 1 : -1);
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = side(a);
    const db = side(b);
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

const subpath = (poly, ox, oy) =>
  poly.length < 3
    ? ""
    : `M ${poly.map(([x, y]) => `${(x - ox).toFixed(1)} ${(y - oy).toFixed(1)}`).join(" L ")} Z `;

function updateFlip(mainRect) {
  const { el, rect, F, n } = flip;
  const box = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h],
  ];
  const reflect = ([x, y]) => {
    const d = (x - F[0]) * n[0] + (y - F[1]) * n[1];
    return [x - 2 * d * n[0], y - 2 * d * n[1]];
  };
  const flat = clipPoly(box, F, n, false);
  const flap = clipPoly(box, F, n, true).map(reflect);
  // evenodd: flat minus flap (the flap outside the flat part carries no ink).
  const d = subpath(flat, rect.x, rect.y) + subpath(flap, rect.x, rect.y);
  el.style.clipPath = d ? `path(evenodd, "${d.trim()}")` : "inset(50%)";

  const big = 1e5;
  const plane = clipPoly(
    [
      [-big, -big],
      [big, -big],
      [big, big],
      [-big, big],
    ],
    F,
    n,
    true,
  );
  const m = subpath(plane, mainRect.left, mainRect.top);
  sheet.style.clipPath = m ? `path("${m.trim()}")` : "inset(50%)";
}

// ---- pointer light -----------------------------------------------------

const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
window.addEventListener("pointermove", (e) => {
  mouse.tx = e.clientX / window.innerWidth;
  mouse.ty = e.clientY / window.innerHeight;
});

// ---- frame loop --------------------------------------------------------

let dirty = true;
let last = performance.now();
let tick = 0;
let time = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  tick++;

  if (Math.abs(target - current) > 0.3) {
    current += (target - current) * (1 - Math.exp(-dt * 14));
    window.scrollTo(0, current);
    dirty = true;
  } else if (current !== target) {
    current = target;
    window.scrollTo(0, current);
    dirty = true;
  }

  const k = 1 - Math.exp(-dt * 4);
  if (Math.abs(mouse.tx - mouse.x) + Math.abs(mouse.ty - mouse.y) > 1e-4) {
    mouse.x += (mouse.tx - mouse.x) * k;
    mouse.y += (mouse.ty - mouse.y) * k;
    dirty = true;
  }

  if (anim) {
    const t = Math.min((now - anim.start) / anim.dur, 1);
    anim.step(t);
    if (t >= 1) finishAnim();
    dirty = true;
  }

  // The light drifts slowly; idle frames redraw at a third of the rate.
  if (!reduced.matches) {
    time += dt;
    if (tick % 3 === 0) dirty = true;
  }

  if (dirty && paper) {
    dirty = false;
    const r = sheet.getBoundingClientRect();
    const { u, L, n0, mx } = geo;
    if (flip) updateFlip(r);
    const f = flip?.rect;
    paper.draw({
      view: [root.clientWidth, window.innerHeight],
      main: [r.left + r.width / 2, r.top + r.height / 2, r.width / 2, r.height / 2],
      mainSeed,
      flip: f ? [f.x + f.w / 2, f.y + f.h / 2, f.w / 2, f.h / 2] : [0, 0, 1, 1],
      fold: flip ? [...flip.F, ...flip.n] : [0, 0, 0, 1],
      flipInfo: flip ? [1, flip.seed] : [0, 0],
      rule: [L, n0 * L, u * 0.25, mx],
      hole: [geo.holeX, geo.holeR, u * 4.25, showHoles ? 1 : 0],
      inch: u,
      mouse: [mouse.x, mouse.y],
      time,
      dark: isDark() ? 1 : 0,
      inkMain: mainInk,
      inkFlip: flip?.ink ?? null,
    });
  }

  requestAnimationFrame(frame);
}

resize();
window.addEventListener("resize", resize);
darkMq.addEventListener("change", () => (dirty = true));
new ResizeObserver(() => (dirty = true)).observe(sheet);
requestAnimationFrame(frame);
