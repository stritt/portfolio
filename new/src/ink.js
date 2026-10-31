// Graphite ink, drawn once per page off the main thread.
//
// Brandon Pencil Graphite paints pressure and grain as COLRv1 layers, and the
// browser redraws every layer of every glyph each time text is painted: ~2s
// of main-thread work for one sheet, again whenever a page turns or text
// scrolls into view. So the DOM keeps the plain cut (same outlines, same
// metrics) for layout, links and selection, with its fill hidden, while a
// worker draws the Graphite ink once into a bitmap. The paper shader lays
// that bitmap onto its sheet, so turning and scrolling never repaint text.

// Where every word sits on a laid-out sheet, in sheet-local CSS px with y
// on the baseline.
function collectRuns(el, metrics) {
  // Measured square to the page; the sheet's tilt is the shader's to apply.
  const tilt = el.style.transform;
  el.style.transform = "none";
  try {
    return measure(el, metrics);
  } finally {
    el.style.transform = tilt;
  }
}

function measure(el, { asc, desc }) {
  const box = el.getBoundingClientRect();
  const runs = [];
  const range = document.createRange();
  // Notes written at an angle are measured separately, below.
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    // Visitors' writing (.guest) and the "Save doodle" button, which comes
    // and goes, are shown as they are, never inked as Brandon's. Figures
    // draw themselves (figure.js).
    acceptNode: (n) => (n.parentElement.closest('.turn, .guest, .diagram, [data-tool="pin"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });

  // Word by word, each at the spot the plain cut put it: Graphite picks
  // its own alternates, and over a whole line their small differences
  // would add up.
  for (let node; (node = walker.nextNode()); ) {
    const css = getComputedStyle(node.parentElement);
    const fs = parseFloat(css.fontSize);
    const style = { fs, color: css.color, ls: css.letterSpacing === "normal" ? "0px" : css.letterSpacing };
    // Split after hyphens too: a line can break there, and each piece has
    // to be drawn where it landed.
    for (const m of node.data.matchAll(/[^\s\-–—]+[\-–—]*|[\-–—]+/g)) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const r = range.getClientRects()[0];
      if (!r) continue;
      // A text box's top is its baseline less the font's ascent.
      runs.push({ ...style, text: m[0], x: r.left - box.left, y: r.top - box.top + asc * fs });
    }
  }

  // List bullets are generated content, out of reach of ranges.
  for (const li of el.querySelectorAll("li")) {
    const b = getComputedStyle(li, "::before");
    if (!b.content || b.content === "none" || b.content === "normal") continue;
    const r = li.getBoundingClientRect();
    const fs = parseFloat(b.fontSize);
    runs.push({
      text: b.content.replace(/^["']|["']$/g, ""),
      x: r.left - box.left + (parseFloat(b.left) || 0),
      y: r.top - box.top + parseFloat(b.lineHeight) / 2 + ((asc - desc) * fs) / 2,
      fs,
      color: b.color,
      ls: "0px",
    });
  }
  // A note scrawled at an angle, like "turn over" in the corner. Its layout
  // box (offset*) is unturned; the angle comes from its transform.
  for (const t of el.querySelectorAll(".turn")) {
    const css = getComputedStyle(t);
    const m = new DOMMatrix(css.transform === "none" ? undefined : css.transform);
    const fs = parseFloat(css.fontSize);
    runs.push({
      text: t.textContent.trim(),
      x: t.offsetLeft + t.offsetWidth / 2,
      y: t.offsetTop + t.offsetHeight / 2 + ((asc - desc) * fs) / 2,
      fs,
      color: css.color,
      ls: "0px",
      rot: Math.atan2(m.b, m.a),
    });
  }

  // Highlighter passes go into the ink too, so they turn with the paper.
  // Same band as the CSS: 0.62em tall, 72% of the way down the text box.
  const marks = [];
  const marker = getComputedStyle(el).getPropertyValue("--marker").trim();
  for (const m of el.querySelectorAll("strong")) {
    const band = parseFloat(getComputedStyle(m).fontSize) * 0.62;
    for (const r of m.getClientRects()) {
      marks.push({ x: r.left - box.left, y: r.top - box.top + (r.height - band) * 0.72, w: r.width, h: band });
    }
  }
  // Sketches are pencil too, laid in under the writing.
  const images = [];
  for (const img of el.querySelectorAll(".sketch img")) {
    const r = img.getBoundingClientRect();
    images.push({ src: img.currentSrc || img.src, x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height });
  }
  return { w: box.width, h: box.height, runs, marks, marker, images };
}

import { hand, rng } from "./hand.js";

// Finished ink is kept in Cache Storage, so a page drawn once comes back
// on the next visit in a few ms instead of being painted again. Entries are
// named by a hash of everything the worker is given, under a cache named
// for this build of the code (the bundle's name is a hash of it, the
// worker's included), so a change to the page, the layout or the drawing
// never shows stale ink. Not used in development, where names don't change.
async function openStore() {
  if (import.meta.env.DEV || typeof caches === "undefined" || !crypto.subtle) return null;
  try {
    const name = `ink ${new URL(import.meta.url).pathname}`;
    for (const old of await caches.keys()) if (old.startsWith("ink ") && old !== name) caches.delete(old);
    return await caches.open(name);
  } catch {
    return null;
  }
}

async function addressOf(msg) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(msg)));
  const hex = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `/__ink/${hex}`;
}

export function createInk(paper, metrics) {
  if (!paper || typeof OffscreenCanvas === "undefined") return null;
  // One worker: most of the cost is painting each glyph the first time, and
  // that's per worker, so splitting a page between several only repeats it.
  let worker;
  try {
    worker = new Worker(new URL("./ink-worker.js", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
  const store = openStore();

  const jobs = new Map();
  let nextId = 0;
  worker.onmessage = ({ data }) => {
    const job = jobs.get(data.id);
    // The ink comes first, then a PNG of it to keep.
    if ("blob" in data) {
      jobs.delete(data.id);
      if (data.blob) job?.keep(data.blob);
    } else if (data.error) {
      jobs.delete(data.id);
      job.reject(new Error(data.error));
    } else {
      if (!data.keeping) jobs.delete(data.id);
      job.resolve(data);
    }
  };
  const send = (msg) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      jobs.set(id, { resolve, reject, keep: msg.keep });
      worker.postMessage({ ...msg, id, keep: !!msg.keep });
    });
  };

  async function draw(msg) {
    const [cache, url] = await Promise.all([store, store.then((c) => c && addressOf(msg)).catch(() => null)]);
    if (cache && url) {
      try {
        const hit = await cache.match(url);
        if (hit) return await createImageBitmap(await hit.blob(), { premultiplyAlpha: "premultiply" });
      } catch {}
    }
    const { runs, ...rest } = msg;
    const words = hand(runs, msg.h, rng(msg.seed));
    const keep = cache && url ? (blob) => cache.put(url, new Response(blob, { headers: { "content-type": "image/png" } })).catch(() => {}) : null;
    const d = await send({ ...rest, words, keep });
    return d.bitmap;
  }

  // key → { promise, value }. Keys carry the sheet width and pixel ratio, so
  // a bitmap is only ever drawn at the size it's shown.
  const cache = new Map();

  return {
    has: (key) => cache.has(key),
    get: (key) => cache.get(key)?.value ?? null,

    // Lays out nothing itself: el must be a sheet already laid out with the
    // page's content. Its runs are read synchronously, so el can be removed
    // as soon as this returns.
    request(key, el, scale) {
      if (cache.has(key)) return cache.get(key).promise;
      const { w, h, runs, marks, marker, images } = collectRuns(el, metrics());
      // The same page always comes out in the same hand.
      let seed = 2166136261;
      for (const c of key.split("|")[0]) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
      const s = Math.min(scale, paper.maxTexture / w, paper.maxTexture / h);
      const entry = { value: null };
      entry.promise = draw({ w, h, scale: s, runs, marks, marker, images, seed: seed >>> 0 }).then((bitmap) => {
        const tex = paper.ink(bitmap, w, h);
        bitmap.close();
        // Dropped by reset() while it was being drawn.
        if (cache.get(key) !== entry) {
          paper.freeInk(tex);
          throw new Error("stale ink");
        }
        tex.key = key;
        entry.value = tex;
        return tex;
      });
      entry.promise.catch(() => cache.get(key) === entry && cache.delete(key));
      cache.set(key, entry);
      return entry.promise;
    },

    // Forget one page's ink, as when its sheet has changed under it.
    drop(key) {
      const v = cache.get(key)?.value;
      if (v) paper.freeInk(v);
      cache.delete(key);
    },

    reset() {
      for (const { value } of cache.values()) if (value) paper.freeInk(value);
      cache.clear();
    },
  };
}
