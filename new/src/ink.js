// Graphite ink, drawn once per page off the main thread.
//
// Brandon Pencil Graphite paints pressure and grain as COLRv1 layers, and the
// browser redraws every layer of every glyph each time text is painted: ~2s
// of main-thread work for one sheet, again whenever a page turns or text
// scrolls into view. So the DOM keeps the plain cut (same outlines, same
// metrics) for layout, links and selection, with its fill hidden, while a
// worker draws the Graphite ink once into a bitmap. The paper shader lays
// that bitmap onto its sheet, so turning and scrolling never repaint text.

// Where every run of text sits on a laid-out sheet, in sheet-local CSS px
// with y on the baseline.
function collectRuns(el, { asc, desc }) {
  const box = el.getBoundingClientRect();
  const runs = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const finish = (r) => ({ ...r.style, text: r.node.data.slice(r.start, r.end).replace(/\s+/g, " "), x: r.x, y: r.y });

  for (let node; (node = walker.nextNode()); ) {
    const css = getComputedStyle(node.parentElement);
    const fs = parseFloat(css.fontSize);
    const style = { fs, color: css.color, ls: css.letterSpacing === "normal" ? "0px" : css.letterSpacing };
    let run = null;
    for (const m of node.data.matchAll(/\S+/g)) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const r = range.getClientRects()[0];
      if (!r) continue;
      if (run && Math.abs(r.top - run.top) < 2) {
        run.end = m.index + m[0].length;
        continue;
      }
      if (run) runs.push(finish(run));
      // A text box's top is its baseline less the font's ascent.
      run = { node, style, start: m.index, end: m.index + m[0].length, top: r.top, x: r.left - box.left, y: r.top - box.top + asc * fs };
    }
    if (run) runs.push(finish(run));
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
  return { w: box.width, h: box.height, runs };
}

export function createInk(paper, metrics) {
  if (!paper || typeof OffscreenCanvas === "undefined") return null;
  let worker;
  try {
    worker = new Worker(new URL("./ink-worker.js", import.meta.url), { type: "module" });
  } catch {
    return null;
  }

  const jobs = new Map();
  let nextId = 0;
  worker.onmessage = ({ data }) => {
    const job = jobs.get(data.id);
    jobs.delete(data.id);
    if (data.error) job.reject(new Error(data.error));
    else job.resolve(data.bitmap);
  };

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
      const { w, h, runs } = collectRuns(el, metrics());
      const s = Math.min(scale, paper.maxTexture / w, paper.maxTexture / h);
      const id = nextId++;
      const entry = { value: null };
      entry.promise = new Promise((resolve, reject) => {
        jobs.set(id, { resolve, reject });
        worker.postMessage({ id, w, h, scale: s, runs });
      }).then((bitmap) => {
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

    reset() {
      for (const { value } of cache.values()) if (value) paper.freeInk(value);
      cache.clear();
    },
  };
}
