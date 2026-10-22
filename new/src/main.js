import { createPaper } from "./paper.js";
import { createInk } from "./ink.js";
import { draftParam, startDraft } from "./draft.js";
import { doodleParam, startDoodle } from "./doodle.js";
import { showWall, prepareReview, showArticleReview } from "./wall.js";
import { underline } from "./underline.js";

const root = document.documentElement;
const sheet = document.getElementById("sheet");
const canvas = document.getElementById("gl");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
// Punched holes are off by default; ?holes brings them back to compare.
const showHoles = new URLSearchParams(location.search).has("holes");
// ?slow (or ?slow=N) plays page transitions N times slower, for tuning.
const slowParam = new URLSearchParams(location.search).get("slow");
const slow = slowParam === null ? 1 : Number(slowParam) || 6;

// ?plain leaves the text in the plain cut, without the Graphite ink.
const plainOnly = new URLSearchParams(location.search).has("plain");
// ?draft is draft mode (see draft.js): the text is live and editable, so it
// stays in the plain cut and the sheets aren't picked up.
// Only posts have drafts.
const drafting = draftParam !== null && location.pathname.startsWith("/notes/");
if (doodleParam && location.pathname !== "/wall/") location.replace("/wall/?doodle");
let leaveDraft = null;
function clearModes() {
  const url = new URL(location.href);
  url.searchParams.delete("draft");
  url.searchParams.delete("doodle");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}
if (!drafting && draftParam !== null) clearModes();
window.addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  clearModes();
  if (drafting) location.reload();
  else window.dispatchEvent(new Event("sheet:swap"));
});

// ---- surroundings --------------------------------------------------------
// What the sheet lies on and how the room is lit, as indexes into the
// shader's desk() and lights. ?bg= and ?light= pick them; ?tune adds a
// small panel to try them live (the choice is remembered on this device).
const BACKGROUNDS = ["plaster", "oak", "walnut", "linen", "concrete", "slate", "white"];
const LIGHTS = ["window", "overcast", "golden", "blinds", "lamp", "night", "studio", "moon"];
const scene = { bg: null, light: null, theme: null };
try {
  Object.assign(scene, JSON.parse(localStorage.getItem("scene") || "{}"));
} catch {}
{
  const q = new URLSearchParams(location.search);
  if (BACKGROUNDS.includes(q.get("bg"))) scene.bg = q.get("bg");
  if (LIGHTS.includes(q.get("light"))) scene.light = q.get("light");
  // Query parameters still work as one-visit previews.
  if (["light", "dark"].includes(q.get("theme"))) scene.theme = q.get("theme");
}
if (!["light", "dark"].includes(scene.theme)) scene.theme = null;
const syncTheme = () => {
  root.dataset.theme = scene.theme ?? "light";
};
syncTheme();
const isDark = () => root.dataset.theme === "dark";
const saveScene = () => {
  try {
    localStorage.setItem("scene", JSON.stringify(scene));
  } catch {}
};
// New visitors see plaster and blinds. A saved or query-string choice still
// wins; the dark toggle changes the desk to slate. The sun's position and
// warmth still move through the day. ?hour=18 previews that movement.
const hourNow = () => {
  const q = parseFloat(new URLSearchParams(location.search).get("hour"));
  if (q >= 0 && q < 24) return q;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
};
// Sun position: -1 first thing in the morning to 1 at dusk; and how warm
// it's turned, from white at midday to amber at either end.
const dayNow = () => {
  const h = hourNow();
  const x = Math.max(-1, Math.min(1, (h - 13) / 7));
  return [x, Math.min(1, Math.abs(h - 13) / 6) ** 1.5];
};
const bgName = () => scene.bg ?? (isDark() ? "slate" : "plaster");
const lightName = () => scene.light ?? "blinds";
const CYCLE_LIGHTS = ["window", "golden", "blinds", "moon"];

function syncSceneControls() {
  const theme = sheet.querySelector('[data-scene-control="theme"]');
  const light = sheet.querySelector('[data-scene-control="light"]');
  if (theme) {
    const label = `Switch to ${isDark() ? "light" : "dark"} background`;
    theme.setAttribute("aria-label", label);
    theme.title = label;
  }
  if (light) {
    const current = lightName();
    const next = CYCLE_LIGHTS[(CYCLE_LIGHTS.indexOf(current) + 1) % CYCLE_LIGHTS.length];
    const label = `Lighting: ${current}. Change to ${next}`;
    light.setAttribute("aria-label", label);
    light.title = label;
  }
}
syncSceneControls();

sheet.addEventListener("click", (e) => {
  const button = e.target.closest?.("button[data-scene-control]");
  if (!button || !sheet.contains(button)) return;
  if (button.dataset.sceneControl === "theme") {
    scene.theme = isDark() ? "light" : "dark";
    scene.bg = null;
    syncTheme();
  } else {
    scene.light = CYCLE_LIGHTS[(CYCLE_LIGHTS.indexOf(lightName()) + 1) % CYCLE_LIGHTS.length];
  }
  saveScene();
  syncSceneControls();
  dirty = true;
});

function tunePanel() {
  const panel = document.createElement("div");
  panel.className = "tune";
  const row = (label, names, key) => {
    const r = document.createElement("div");
    r.innerHTML = `<span>${label}</span>`;
    for (const name of names) {
      const b = document.createElement("button");
      b.textContent = name;
      b.onclick = () => {
        scene[key] = name;
        saveScene();
        syncSceneControls();
        sync();
        dirty = true;
      };
      r.append(b);
    }
    return r;
  };
  panel.append(row("desk", BACKGROUNDS, "bg"), row("light", LIGHTS, "light"));
  const sync = () => {
    for (const b of panel.querySelectorAll("div:first-child button")) b.classList.toggle("on", b.textContent === bgName());
    for (const b of panel.querySelectorAll("div:last-child button")) b.classList.toggle("on", b.textContent === lightName());
  };
  sync();
  document.body.append(panel);
}
if (new URLSearchParams(location.search).has("tune")) tunePanel();

// ---- sheet geometry ----------------------------------------------------
// Real US loose-leaf: 8.5in wide, wide-ruled at 11/32in, a red margin line
// 1.25in in, three 1/4in holes on 4.25in centres. Everything scales off the
// sheet width (u = one inch), except the rule spacing, which never drops
// below a comfortable line of text.

const geo = {};
let layoutWidth = 0;
const STACK_GAP = 44;   // desk between stacked sheets, CSS px

// A note stacked over several sheets: each sheet's height and the gap
// between, for the paper under it; [0, 0] for a single sheet.
function stackOf(el) {
  if (!el.classList.contains("stacked") || root.classList.contains("flat")) return [0, 0];
  return [(geo.W * 11) / 8.5, STACK_GAP];
}

function layout() {
  const vw = root.clientWidth;
  layoutWidth = vw;
  const gutter = vw < 640 ? 12 : 40;
  const W = Math.min(816, vw - gutter * 2);
  const u = W / 8.5;
  const L = Math.max(28, Math.round((u * 11) / 32));
  // Keep the broad blank header above the first rule, like real ruled paper.
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
    "--top-gap": `${vw < 640 ? 12 : 44}px`,
    "--gap": `${Math.max(1, L * 0.04)}px`,
    "--stack-gap": `${STACK_GAP}px`,
  };
  // A stacked note is laid out for a full-width sheet; narrower, it's one.
  root.classList.toggle("flat", W < 816);
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
measureFont().then(async () => {
  await prepareReview();
  underline(sheet);
  root.classList.add("ready");
  wallPage();
  if (drafting) leaveDraft = startDraft({ sheet, untilt });
  else {
    startDoodle({
      on: doodleParam,
      paper,
      sheet,
      rect: sheetRect,
      tilt: () => tiltFor(shownPath),
      busy: () => !!(anim || drag || flip),
      redraw: () => (dirty = true),
    });
  }
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
let viewWidth = 0;
let viewHeight = 0;
const coarsePhone = matchMedia("(pointer: coarse) and (max-width: 640px)");
function resize() {
  const width = root.clientWidth;
  if (width !== layoutWidth) layout();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Safari's visible height changes as its toolbar hides. The canvas uses
  // the stable large viewport; size the backing store from that same CSS box
  // so its ink and paper are never stretched by a height-only resize.
  const height = canvas.getBoundingClientRect().height;
  const geometryChanged = width !== viewWidth || height !== viewHeight ||
      canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr);
  if (paper && geometryChanged) {
    viewWidth = width;
    viewHeight = height;
    paper.resize(width, height, dpr);
  }
  dirty = true;
  // Ink is drawn for one sheet width and pixel ratio; redraw for the new one
  // once the resize settles, showing the plain cut meanwhile.
  // Safari fires resize as its browser chrome moves. Only a real canvas or
  // layout change should make a held corner fall out of the reader's hand.
  if (drag && geometryChanged) {
    drag = null;
    endFlip();
    document.body.classList.remove("grabbing");
  }
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

const ink = plainOnly || drafting || navigator.connection?.saveData ? null : createInk(paper, () => fontMetrics);
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
      el.className = page.cls;
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
  // On a phone, painting several offscreen Graphite pages competes with
  // scrolling and is especially costly for a long note. Draw only the page
  // being read; a corner pickup or link hover can request the next one.
  if (coarsePhone.matches) return;
  // The neighbours first: they're what a grabbed sheet reveals.
  for (const path of [rel.next, rel.prev]) if (path) prefetchInk(path);
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
let lastScrollAt = -Infinity;
const maxScroll = () => root.scrollHeight - window.innerHeight;

window.addEventListener(
  "wheel",
  (e) => {
    if (e.target.closest?.(".wall-queue, .draft-note, .draft-tools")) return;
    if (e.ctrlKey || reduced.matches || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    if (drag) return;   // the page is in hand
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
    lastScrollAt = performance.now();
    dirty = true;
  },
  { passive: true },
);

// ---- pages -------------------------------------------------------------
// Every page is a real HTML file. Internal links are intercepted: the next
// page's sheet is fetched and the change plays out on the pile of paper.
// Pages also chain with <link rel="prev"/"next">: ← and → turn between
// them, and a sheet's corner can be picked up and turned over to the next
// (see "grabbing the paper"). Turning forward lifts the top sheet over to
// reveal the next one beneath; turning back brings the previous sheet back
// down on top.

// Each page is its own sheet, so each gets its own patch of paper grain.
const seedFor = (path) => {
  let h = 7;
  for (const c of path) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 97;
};
const depth = (path) => path.split("/").filter(Boolean).length;

// Nobody sets a sheet down perfectly square: each lies a fraction of a
// degree off, its own way, in radians.
const tiltFor = (path) => (((seedFor(path) * 37) % 97) / 96 - 0.5) * 0.0145;

// The sheet's own (untilted) rectangle on screen. Its bounding box grows
// when it's tilted; the centre stays put.
function sheetRect() {
  const b = sheet.getBoundingClientRect();
  const w = sheet.offsetWidth;
  const h = sheet.offsetHeight;
  const left = (b.left + b.right - w) / 2;
  const top = (b.top + b.bottom - h) / 2;
  return { left, top, width: w, height: h, right: left + w, bottom: top + h };
}

function setTilt(path) {
  sheet.style.setProperty("--tilt", `${tiltFor(path)}rad`);
}
setTilt(location.pathname);

let mainSeed = seedFor(location.pathname);
let currentPath = location.pathname;
let shownPath = currentPath;   // the page on the resting sheet (lags currentPath mid-turn)
history.scrollRestoration = "manual";
// Each history entry knows its place, so popstate can tell back from forward.
let histIndex = history.state?.i ?? 0;
history.replaceState({ i: histIndex }, "");

const relOf = (doc) => ({
  prev: doc.querySelector('link[rel="prev"]')?.getAttribute("href") ?? null,
  next: doc.querySelector('link[rel="next"]')?.getAttribute("href") ?? null,
});
let rel = relOf(document);
const pageHeadSelector = 'meta[name="description"], meta[name="robots"], meta[name^="twitter:"], meta[property^="og:"], meta[property^="article:"], link[rel="canonical"], link[rel="prev"], link[rel="next"], script[type="application/ld+json"]';
const pageHead = (doc) => [...doc.head.querySelectorAll(pageHeadSelector)].map((tag) => tag.outerHTML).join("");
function syncPageHead(page) {
  document.head.querySelectorAll(pageHeadSelector).forEach((tag) => tag.remove());
  document.head.insertAdjacentHTML("beforeend", page.head);
}

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
        return { title: doc.title, html: next.innerHTML, cls: next.className, rel: relOf(doc), head: pageHead(doc) };
      });
    req.catch(() => pages.delete(path));
    pages.set(path, req);
  }
  return pages.get(path);
}

const internalLink = (e) => {
  const a = e.target.closest?.("a[href]");
  // data-reload: a page that starts a mode on load (draft), so not turned to.
  if (!a || a.origin !== location.origin || a.target || (!drafting && a.search !== location.search) || a.hasAttribute("download") || a.hasAttribute("data-reload")) return null;
  return a;
};

document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  // Inside a sheet being written on, a click places the caret.
  if (e.target.closest?.('[contenteditable="true"]')) return;
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

window.addEventListener("popstate", (e) => {
  clearModes();
  const i = e.state?.i ?? 0;
  const dir = i < histIndex ? -1 : 1;
  histIndex = i;
  go(location.pathname, false, dir);
});

// ← and → turn to the neighbouring sheets.
window.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  if (e.target.closest?.("input, textarea, select, [contenteditable], .wall-queue")) return;
  const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
  const to = dir > 0 ? rel.next : dir < 0 ? rel.prev : null;
  if (!to || drag) return;
  e.preventDefault();
  go(to, true, dir);
});

// Neighbours turn the way they lie in the pile; anything else turns
// forward going deeper and back going up.
function dirTo(path) {
  if (path === rel.next) return 1;
  if (path === rel.prev) return -1;
  return depth(path) >= depth(currentPath) ? 1 : -1;
}

// ---- paper sounds ----
// A real sheet, clipped from one recording: picked up (lift) and turned
// (flip). Decoded on the first interaction (audio can't start before one
// anyway), then played with a slight change of pitch and level each time so
// no two sound alike.
let audio = null;
const sounds = {};
function primeSound() {
  if (audio) return;
  const AC = window.AudioContext ?? window.webkitAudioContext;
  if (!AC) return;
  audio = new AC();
  for (const name of ["flip", "lift"]) {
    fetch(`/sounds/${name}.mp3`)
      .then((r) => r.arrayBuffer())
      .then((b) => audio.decodeAudioData(b))
      .then((buf) => (sounds[name] = buf))
      .catch(() => {});
  }
}
for (const ev of ["pointerdown", "keydown", "touchstart"]) {
  window.addEventListener(ev, primeSound, { once: true, passive: true });
}

function play(name, level = 0.36, rate = 1) {
  if (!audio || !sounds[name]) return;
  if (audio.state === "suspended") audio.resume();
  const src = audio.createBufferSource();
  src.buffer = sounds[name];
  src.playbackRate.value = (rate * (0.94 + Math.random() * 0.12)) / Math.sqrt(slow);
  const gain = audio.createGain();
  gain.gain.value = level * (0.88 + Math.random() * 0.24);
  src.connect(gain).connect(audio.destination);
  src.start();
}

function jumpScroll(y) {
  window.scrollTo(0, y);
  target = current = y;
}

function swap(page, path) {
  sheet.className = page.cls;
  sheet.innerHTML = page.html;
  syncPageHead(page);
  syncSceneControls();
  underline(sheet);
  document.title = page.title;
  mainSeed = seedFor(path);
  setTilt(path);
  shownPath = path;
  rel = page.rel;
  updateGrips();
  showMainInk(path);
  idle(prefetchLinkedInk, { timeout: 2000 });
  dirty = true;
  window.dispatchEvent(new CustomEvent("sheet:swap", { detail: { path } }));
}

// The wall's notes are filled in after the sheet is laid out.
const wallPage = () => {
  if (shownPath.startsWith("/notes/")) showArticleReview();
  if (shownPath !== "/wall/") return;
  showWall(sheet).then(() => window.dispatchEvent(new Event("sheet:changed")));
};
window.addEventListener("sheet:swap", wallPage);

// Something on the resting sheet moved after its ink was drawn: draw again.
window.addEventListener("sheet:changed", () => {
  if (!ink) return;
  ink.drop(inkKey(shownPath));
  mainInk = null;
  sheet.classList.remove("inked");
  showMainInk(shownPath);
});

// Run fn with the sheet measured square to the page, its tilt lifted.
function untilt(fn) {
  const t = sheet.style.transform;
  sheet.style.transform = "none";
  try {
    return fn();
  } finally {
    sheet.style.transform = t;
  }
}

// The sheet being turned. Its fold goes to the shader, which draws the
// paper and its ink. A link-driven turn also carries a fixed-position copy
// of the sheet's DOM, clipped to the paper it sits on, for when the ink
// isn't drawn yet and the plain text is what shows.
let flip = null;
let anim = null;
// While a sheet is being pulled forward, the page that will be revealed
// lies beneath it where it'll sit once turned to.
let under = null;

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function makeFlip(html, cls, rect, seed, inkTex) {
  const el = sheet.cloneNode(false);
  el.removeAttribute("id");
  el.className = cls;
  el.classList.toggle("inked", !!inkTex);
  el.classList.add("flip");
  el.setAttribute("aria-hidden", "true");
  el.inert = true;
  el.innerHTML = html;
  Object.assign(el.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px` });
  document.body.append(el);
  rect.h ??= el.offsetHeight;
  el.style.height = `${rect.h}px`;
  return { el, rect, seed, ink: inkTex, stack: stackOf(el), tilt: parseFloat(el.style.getPropertyValue("--tilt")) || 0, F: [0, 0], n: [0, 1], R: 0 };
}

function endFlip() {
  flip?.el?.remove();
  flip = null;
  under = null;
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

// Paper is stiff: lifted, it bows over a radius rather than creasing. A
// corner just lifted bends tightly; pulled further, the sheet arcs up
// through the air in a wide curve instead of lying folded back flat.
const bendRadius = (lift) => {
  const base = Math.max(26, geo.W * 0.06);
  return Math.min(base + lift * 0.25, Math.max(base, Math.min(window.innerHeight * 0.24, 200)));
};

// On screen, how far a point of paper d past the fold (along the paper)
// moves back toward it: up and over the bend, then lying back flat.
const travel = (d, R) => (d <= Math.PI * R ? d - R * Math.sin(d / R) : 2 * d - Math.PI * R);

// And back: how far past the fold a point must be to have moved t.
function pastFold(t, R) {
  if (t >= Math.PI * R) return (t + Math.PI * R) / 2;
  let lo = 0;
  let hi = Math.PI * R;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (travel(mid, R) < t) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Fold the sheet so the paper point G lands at the screen point P.
// Unstretched paper puts the fold square to G→P, with G just far enough
// past it that bending over brings it back to P. A small lift is mostly
// the paper rising off the page, so it barely moves inward.
function foldFrom(f, G, P) {
  const dx = G[0] - P[0];
  const dy = G[1] - P[1];
  const len = Math.hypot(dx, dy);
  const R = (f.R = bendRadius(len));
  if (len < 0.05) {
    // Lying flat: park the fold far off the sheet.
    f.n = [0.6, 0.8];
    f.F = [G[0] + 6e3, G[1] + 8e3];
    return;
  }
  // Settling flat, the last fraction of a pixel keeps its direction.
  if (len > 1 || !f.lifted) f.n = [dx / len, dy / len];
  f.lifted = true;
  const d = pastFold(len, R);
  f.F = [G[0] - f.n[0] * d, G[1] - f.n[1] * d];
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
  foldFrom(flip, C, P);
}

async function go(path, push, dir = dirTo(path)) {
  if (drafting) {
    await leaveDraft?.();
    if (push) location.assign(path);
    else location.replace(path);
    return;
  }
  if (drag) return;
  let page;
  try {
    page = await fetchPage(path);
  } catch {
    location.href = path;
    return;
  }
  finishAnim();
  if (push) history.pushState({ i: ++histIndex }, "", path);
  document.title = page.title;
  currentPath = path;

  if (reduced.matches || !paper) {
    swap(page, path);
    jumpScroll(0);
    return;
  }

  const r = sheetRect();
  const dur = 600 * slow;
  play("flip");

  if (dir > 0) {
    // Forward: the current page is turned over, the next one is beneath.
    flip = makeFlip(sheet.innerHTML, sheet.className, { x: r.left, y: r.top, w: r.width, h: r.height }, mainSeed, mainInk);
    swap(page, path);
    jumpScroll(0);
    anim = { start: performance.now(), dur, step: (t) => setFold(easeInOut(t)), done: endFlip };
  } else {
    // Back: the previous page is turned back down on top, landing where a
    // page sits at the top of the document while the one beneath scrolls up.
    const top0 = r.top + window.scrollY;
    flip = makeFlip(page.html, page.cls, { x: r.left, y: top0, w: r.width }, seedFor(path), ink?.get(inkKey(path)));
    flip.el.style.setProperty("--tilt", `${tiltFor(path)}rad`);
    flip.tilt = tiltFor(path);
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
  setFold(dir > 0 ? 0 : 1);
}

// ---- grabbing the paper ------------------------------------------------
// A bottom corner of the sheet can be picked up and turned over to the next
// page, the way a thumb finds the corner of a pad. The corner follows the
// hand through a stiff spring (paper has a little weight to it), the sheet
// stays held along its top edge, and when let go it carries through or
// falls back by how far and how fast it was moving. With a mouse, a corner
// rises a little as the pointer nears it.
//
// Points here are sheet-local, with the origin at the sheet's top left.

let drag = null;

for (const side of ["left", "right"]) {
  const el = document.createElement("div");
  el.className = `grip ${side}`;
  el.setAttribute("aria-hidden", "true");
  document.querySelector(".desk").append(el);
  el.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && hover(side, e));
  el.addEventListener("pointermove", (e) => {
    if (drag?.phase === "hold") hold(e);
    else if (e.pointerType === "mouse") hover(side, e);
  });
  el.addEventListener("pointerleave", () => drag?.phase === "hover" && letGo(false));
  el.addEventListener("pointerdown", (e) => grab(side, e));
  el.addEventListener("pointerup", (e) => {
    if (drag?.phase !== "hold") return;
    hold(e);
    release(e);
  });
  el.addEventListener("pointercancel", () => drag?.phase === "hold" && letGo(false));
}

function updateGrips() {
  root.classList.toggle("can-turn", !!paper && !reduced.matches && !drafting && !!rel.next);
}
updateGrips();
reduced.addEventListener("change", updateGrips);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len2 = (v) => Math.hypot(v[0], v[1]);
const unit = (v) => {
  const l = len2(v) || 1;
  return [v[0] / l, v[1] / l];
};
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

// The pointer in the turning sheet's own frame, undoing its tilt.
function local(e) {
  const { x, y, w, h } = flip.rect;
  const dx = e.clientX - (x + w / 2);
  const dy = e.clientY - (y + h / 2);
  const c = Math.cos(flip.tilt);
  const s = Math.sin(flip.tilt);
  return [c * dx + s * dy + w / 2, -s * dx + c * dy + h / 2];
}

// Pick up the sheet by a corner, with the next page lying squarely beneath.
function pickUp(side) {
  if (drafting) return null;
  const to = rel.next;
  if (!to || anim || flip || !paper || reduced.matches) return null;
  const r = sheetRect();
  fetchPage(to).catch(() => {});
  prefetchInk(to);
  // The plain cut may still be showing while Graphite renders. Carry a DOM
  // copy through the fold in that case, as link-driven turns already do.
  flip = mainInk
    ? { el: null, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, seed: mainSeed, ink: mainInk, stack: stackOf(sheet), tilt: tiltFor(shownPath), F: [0, 0], n: [0, 1], R: 0 }
    : makeFlip(sheet.innerHTML, sheet.className, { x: r.left, y: r.top, w: r.width, h: r.height }, mainSeed, null);
  under = { seed: seedFor(to), path: to };
  // The very corner, a hair in so its fold never lands exactly on an edge.
  const G = [side === "left" ? 1 : r.width - 1, r.height - 1];
  return { to, side, phase: "hover", G, P: G.slice(), T: G.slice(), V: [0, 0] };
}

// Where the corner goes when turned: over the top and off-screen, as in
// setFold.
function endFor(d) {
  const top = Math.min(flip.rect.y, 0) - 40 - flip.rect.y;
  return [d.G[0], 2 * top - d.G[1]];
}

// Held at the top edge, like a pad: the corner can't end up further from
// the top corners than it is along the sheet.
function bind(d, P) {
  for (const T of [[0, 0], [flip.rect.w, 0]]) {
    const r = len2(sub(d.G, T));
    const v = sub(P, T);
    const l = len2(v);
    if (l > r) P = [T[0] + (v[0] * r) / l, T[1] + (v[1] * r) / l];
  }
  return P;
}

// The corner rises toward the pointer as it comes near, peeling in toward
// the middle of the sheet.
function hover(side, e) {
  if (drag && (drag.phase !== "hover" || drag.side !== side)) return;
  drag ??= pickUp(side);
  if (!drag) return;
  const d = drag;
  const near = 1 - clamp(len2(sub(local(e), d.G)) / 110, 0, 1);
  const u = unit(sub([flip.rect.w / 2, d.G[1] - Math.min(flip.rect.h, window.innerHeight) / 2], d.G));
  const lift = 3 + 9 * near;
  d.T = [d.G[0] + u[0] * lift, d.G[1] + u[1] * lift];
}

function grab(side, e) {
  if (e.button !== 0) return;
  if (drag && (drag.phase === "release" || drag.side !== side)) return;
  drag ??= pickUp(side);
  if (!drag) return;
  e.preventDefault();
  e.currentTarget.setPointerCapture(e.pointerId);
  const d = drag;
  d.phase = "hold";
  d.from = local(e);
  d.base = d.P.slice();
  d.pointerStart = [e.clientX, e.clientY];
  d.startedAt = performance.now();
  document.body.classList.add("grabbing");
  play("lift", 0.22);
}

function hold(e) {
  const d = drag;
  const m = sub(local(e), d.from);
  d.T = bind(d, [d.base[0] + m[0], d.base[1] + m[1]]);
}

function release(e) {
  const d = drag;
  // Touch flicks can finish between animation frames, before the spring's P
  // catches the finger. Judge the gesture from the pointer itself. Either
  // lifting the corner or pulling it in toward the page turns the sheet.
  const dx = e.clientX - d.pointerStart[0];
  const dy = e.clientY - d.pointerStart[1];
  const up = -dy;
  const inward = d.side === "right" ? -dx : dx;
  const speed = Math.hypot(dx, dy) / Math.max((performance.now() - d.startedAt) / 1000, 0.016);
  const tap = Math.hypot(dx, dy) < 8;
  letGo(tap || up > 56 || inward > 70 ||
    (speed > 350 && (up > 24 || inward > 30)));
}

function letGo(commit) {
  const d = drag;
  const held = d.phase === "hold";
  d.phase = "release";
  d.commit = commit;
  d.T = commit ? endFor(d) : d.G.slice();
  document.body.classList.remove("grabbing");
  if (commit) play("flip", 0.36, 1 + clamp(len2(d.V) / 6000, 0, 0.12));
  else if (held) play("lift", 0.14, 1.2);
}

function stepDrag(dt) {
  const d = drag;
  // Stiff while held, so the paper keeps up with the hand; looser once let
  // go, when it's the paper's own weight carrying it. Falling back flat it
  // settles without overshoot, which would fold it the other way.
  const k = d.phase === "hold" ? 700 : d.phase === "hover" ? 260 : 130;
  const c = 2 * Math.sqrt(k) * (d.phase === "release" && d.commit ? 0.8 : 1);
  const steps = 4;
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    for (const j of [0, 1]) {
      d.V[j] += (k * (d.T[j] - d.P[j]) - c * d.V[j]) * h;
      d.P[j] += d.V[j] * h;
    }
  }
  const o = [flip.rect.x, flip.rect.y];
  foldFrom(flip, [d.G[0] + o[0], d.G[1] + o[1]], [d.P[0] + o[0], d.P[1] + o[1]]);

  if (d.phase === "release") {
    const near = len2(sub(d.T, d.P)) < (d.commit ? 40 : 0.8);
    if (near && (d.commit || len2(d.V) < 12)) finishDrag();
  }
}

function finishDrag() {
  const d = drag;
  drag = null;
  if (!d.commit) {
    endFlip();
    return;
  }
  fetchPage(d.to)
    .then((page) => {
      history.pushState({ i: ++histIndex }, "", d.to);
      document.title = page.title;
      currentPath = d.to;
      // The new page is already where it lies; glide up to its top. The
      // document keeps its height until then, so a shorter page doesn't
      // jump the view.
      document.body.style.minHeight = `${root.scrollHeight}px`;
      swap(page, d.to);
      target = 0;
      endFlip();
    })
    .catch(() => (location.href = d.to));
}

// ---- ink clipping ----
// The DOM copy of a link-driven turn shows only on the turning sheet's flat
// part (hidden under the part turned back over it); the page beneath shows
// only past the roll.

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
  const { el, rect, F, n, R } = flip;
  const box = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h],
  ];
  // Paper more than half a turn past the fold lies back over the sheet,
  // mirrored across the line through the middle of the roll.
  const at = (k) => [F[0] + n[0] * k, F[1] + n[1] * k];
  const M = at((Math.PI * R) / 2);
  const reflect = ([x, y]) => {
    const d = (x - M[0]) * n[0] + (y - M[1]) * n[1];
    return [x - 2 * d * n[0], y - 2 * d * n[1]];
  };
  const flat = clipPoly(box, F, n, false);
  const back = clipPoly(box, at(Math.PI * R), n, true).map(reflect);
  // evenodd: flat minus what's turned back over it.
  const d = subpath(flat, rect.x, rect.y) + subpath(back, rect.x, rect.y);
  el.style.clipPath = d ? `path(evenodd, "${d.trim()}")` : "inset(50%)";

  const big = 1e5;
  const plane = clipPoly(
    [
      [-big, -big],
      [big, -big],
      [big, big],
      [-big, big],
    ],
    at(R),
    n,
    true,
  );
  const m = subpath(plane, mainRect.left, mainRect.top);
  sheet.style.clipPath = m ? `path("${m.trim()}")` : "inset(50%)";
}

// ---- pointer light -----------------------------------------------------

const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
window.addEventListener("pointermove", (e) => {
  // A finger moving during a scroll isn't a light source. Chasing it keeps
  // repainting the whole shader long after the scrolling has stopped.
  if (e.pointerType !== "mouse") return;
  mouse.tx = e.clientX / window.innerWidth;
  mouse.ty = e.clientY / window.innerHeight;
});

// ---- frame loop --------------------------------------------------------

let dirty = true;
let last = performance.now();
let time = 0;
let lastAmbientDraw = 0;
let wasFast = false;
// The room light moves slowly. Keep turns, scrolling and pointer light at
// display speed, but don't shade the entire viewport 20 times a second while
// the reader is just looking at a page.
const AMBIENT_FRAME_MS = 1000;

function frame(now) {
  const elapsed = (now - last) / 1000;
  const dt = Math.min(elapsed, 0.1);
  last = now;

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

  if (current === 0 && document.body.style.minHeight) document.body.style.minHeight = "";

  if (drag) {
    stepDrag(dt);
    dirty = true;
  }

  // Native touch scrolling must shade a new viewport every frame. Render
  // those moving frames at CSS-pixel density, then restore Retina detail
  // once the page settles. The ink texture and canvas stay full resolution,
  // so neither text layout nor Safari's compositor changes size mid-scroll.
  const fast = coarsePhone.matches && (now - lastScrollAt < 180 || !!drag || !!anim);
  if (wasFast && !fast) dirty = true;
  wasFast = fast;

  // The light drifts slowly; an idle redraw once a second is enough to keep
  // the motion alive without running the full-screen shader continuously.
  if (!reduced.matches && !coarsePhone.matches) {
    time += elapsed;
    if (now - lastAmbientDraw >= AMBIENT_FRAME_MS) dirty = true;
  }

  if (dirty && paper) {
    dirty = false;
    lastAmbientDraw = now;
    const r = sheetRect();
    const { u, L, n0, mx } = geo;
    if (flip?.el) updateFlip(r);
    const f = flip?.rect;
    // While a sheet is pulled forward, the page beneath is the next one.
    const underInk = under && ink ? ink.get(inkKey(under.path)) : null;
    const m = { x: r.left, y: r.top, w: r.width, h: under ? underInk?.h ?? r.height : r.height };
    paper.draw({
      fast,
      view: [viewWidth, viewHeight],
      main: [m.x + m.w / 2, m.y + m.h / 2, m.w / 2, m.h / 2],
      mainSeed: under ? under.seed : mainSeed,
      flip: f ? [f.x + f.w / 2, f.y + f.h / 2, f.w / 2, f.h / 2] : [0, 0, 1, 1],
      fold: flip ? [...flip.F, ...flip.n] : [0, 0, 0, 1],
      curl: flip?.R ?? 0,
      flipInfo: flip ? [1, flip.seed] : [0, 0],
      stack: under ? [0, 0] : stackOf(sheet),
      stackFlip: flip?.stack ?? [0, 0],
      tilt: [tiltFor(under ? under.path : shownPath), flip?.tilt ?? 0],
      rule: [L, n0 * L, u * 0.25, mx],
      hole: [geo.holeX, geo.holeR, u * 4.25, showHoles ? 1 : 0],
      inch: u,
      mouse: [mouse.x, mouse.y],
      time,
      dark: lightName() === "night" ? 1 : 0,
      bg: BACKGROUNDS.indexOf(bgName()),
      light: LIGHTS.indexOf(lightName()),
      day: dayNow(),
      inkMain: under ? underInk : mainInk,
      // The page lying on top of the resting sheet in the pile: while one
      // is being turned up, that's the one in hand; otherwise the previous.
      inkPrev: under ? mainInk : rel.prev && ink ? ink.get(inkKey(rel.prev)) : null,
      inkFlip: flip?.ink ?? null,
    });
  }

  requestAnimationFrame(frame);
}

resize();
window.addEventListener("resize", resize);
new ResizeObserver(() => (dirty = true)).observe(sheet);
requestAnimationFrame(frame);
