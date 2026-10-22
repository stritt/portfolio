// Draft mode: ?draft on a post, or ?draft=name for a separate named draft.
// Other pages have no drafts.
//
// Brandon, with his key (?draft&key=…, kept on this device after the first
// visit and taken out of the address bar), edits the sheet directly and
// saves as he goes, crossing words out in graphite (Remove). Anyone else can
// only comment, and only on a post (/notes/…): select words and leave a
// note; it highlights them, puts a red pencil number in the margin, and
// opens as a sticky note. Suggestions left before that still show, for him
// to accept or reject.
//
// Everything is kept by the burcs-dev Worker (Drafts in worker/worker.js).
// Comments and suggestions are anchored to the words they cover, an
// insertion to the words either side of it, with a little context, so they
// survive edits nearby.

const params = new URLSearchParams(location.search);
const raw = params.get("draft");

// null outside draft mode; otherwise the draft's name ("" for the page's own).
export const draftParam = raw === null ? null : raw.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
// What to keep on the address bar while moving between pages in draft mode.
export const draftQuery = draftParam === null ? "" : draftParam ? `?draft=${draftParam}` : "?draft";

const store = {
  get(k, d) {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

// The author's key arrives once on the address bar and is kept on this
// device, so it doesn't linger in a URL that gets shared or screenshotted.
let key = store.get("draftKey", "");
if (draftParam !== null && params.get("key")) {
  key = params.get("key");
  store.set("draftKey", key);
  history.replaceState(history.state, "", location.pathname + draftQuery);
}

const slugFor = (path) => (path.replace(/^\/+|\/+$/g, "") || "home") + (draftParam ? `:${draftParam}` : "");

// ---- the API -------------------------------------------------------------

let slug = "";

async function api(method, sub = "", body, { query = "", headers = {} } = {}) {
  const res = await fetch(`/api/draft${sub}?slug=${encodeURIComponent(slug)}${query}`, {
    method,
    headers: { "content-type": "application/json", ...(key ? { "x-draft-key": key } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}).`);
  return data;
}

// ---- keeping drafted HTML to what the sheet can show --------------------

const ALLOWED = {
  P: [], H1: [], H2: [], H3: [], UL: [], OL: [], LI: [], BR: [],
  STRONG: [], EM: [], B: [], I: [], U: [], S: [], STRIKE: [],
  A: ["href"], DIV: ["class"], SPAN: ["class"],
};
const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "SVG", "MATH"]);
const CLASSES = new Set(["head", "when", "entries"]);

function clean(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  (function walk(node) {
    for (const el of [...node.children]) {
      if (DROP.has(el.tagName)) {
        el.remove();
        continue;
      }
      walk(el);
      if (!ALLOWED[el.tagName]) {
        el.replaceWith(...el.childNodes);
        continue;
      }
      for (const { name } of [...el.attributes]) {
        if (!ALLOWED[el.tagName].includes(name)) el.removeAttribute(name);
      }
      if (el.hasAttribute("class")) {
        const keep = [...el.classList].filter((c) => CLASSES.has(c));
        if (keep.length) el.className = keep.join(" ");
        else el.removeAttribute("class");
      }
      if (el.tagName === "A" && !/^(https?:|mailto:|\/(?!\/))/i.test(el.getAttribute("href") || "")) {
        el.removeAttribute("href");
      }
    }
  })(doc.body);
  return doc.body.innerHTML;
}

// Draft-mode decorations: comment marks, suggestions, margin numbers.
const SUGGESTED_TEXT = "ins.sg";
function undecorate(root, { keepPending = false } = {}) {
  const live = keepPending ? ":not(.pending)" : "";
  root.querySelectorAll(".dm").forEach((e) => e.remove());
  root.querySelectorAll(`${SUGGESTED_TEXT}${live}`).forEach((e) => e.remove());
  root.querySelectorAll(`mark[data-a], del.sg${live}`).forEach((e) => e.replaceWith(...e.childNodes));
  root.normalize();
}

// The sheet's writing as saved: without anyone's marks on it.
function serialize(sheet) {
  const copy = sheet.cloneNode(true);
  undecorate(copy);
  return copy.innerHTML.trim();
}

// ---- finding words on the sheet -----------------------------------------
// The sheet's own text (not suggested insertions or margin numbers) with
// runs of whitespace collapsed, as it reads, and for each character the
// text node and offset it came from.

function textIndex(sheet) {
  let text = "";
  const at = [];
  const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest(`.dm, ${SUGGESTED_TEXT}`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node; (node = walker.nextNode()); ) {
    for (let i = 0; i < node.data.length; i++) {
      const c = node.data[i];
      if (/\s/.test(c)) {
        if (!text || text.endsWith(" ")) continue;
        text += " ";
      } else {
        text += c;
      }
      at.push({ node, offset: i });
    }
  }
  return { text, at };
}

const CONTEXT = 32;
const around = (text, start, end) => ({
  prefix: text.slice(Math.max(0, start - CONTEXT), start),
  suffix: text.slice(end, end + CONTEXT),
});

// What a range covers, as words plus a little context either side.
function anchorOf(range, sheet) {
  const { text, at } = textIndex(sheet);
  let start = -1;
  let end = -1;
  for (let i = 0; i < at.length; i++) {
    if (range.comparePoint(at[i].node, at[i].offset) === 0) {
      if (start < 0) start = i;
      end = i + 1;
    }
  }
  if (start < 0) return null;
  const quote = text.slice(start, end).trim();
  if (!quote) return null;
  return { quote, ...around(text, start, end) };
}

// Where a node sits in the sheet's own text: the context either side of it.
function pointOf(node, sheet) {
  const { text, at } = textIndex(sheet);
  let i = at.findIndex((c) => node.compareDocumentPosition(c.node) & Node.DOCUMENT_POSITION_FOLLOWING);
  if (i < 0) i = at.length;
  return { quote: "", ...around(text, i, i) };
}

// Where an anchor's words are now: the occurrence whose surroundings best
// match the context it was left with. An insertion's "words" are empty, so
// it's found by its context alone and comes back as a collapsed range.
function locate({ text, at }, a) {
  const needle = a.quote || a.prefix + a.suffix;
  const offset = a.quote ? 0 : a.prefix.length;
  let best = null;
  for (let i = needle ? text.indexOf(needle) : -1; i >= 0; i = text.indexOf(needle, i + 1)) {
    const s = i + offset;
    let score = 0;
    const before = text.slice(Math.max(0, s - a.prefix.length), s);
    while (score < before.length && before[before.length - 1 - score] === a.prefix[a.prefix.length - 1 - score]) score++;
    const after = text.slice(s + a.quote.length);
    let s2 = 0;
    while (s2 < a.suffix.length && after[s2] === a.suffix[s2]) s2++;
    if (!best || score + s2 > best.score) best = { s, score: score + s2 };
  }
  if (!best) return null;
  const range = document.createRange();
  if (!a.quote) {
    const c = at[best.s];
    if (c) range.setStart(c.node, c.offset);
    else {
      const last = at[at.length - 1];
      range.setStart(last.node, last.offset + 1);
    }
    range.collapse(true);
    return range;
  }
  const first = at[best.s];
  const last = at[best.s + a.quote.length - 1];
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}

// Wrap every piece of the sheet's own text in a range in an element.
function wrap(range, make) {
  const root = range.commonAncestorContainer;
  const texts = [];
  if (root.nodeType === Node.TEXT_NODE) texts.push(root);
  else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); ) {
      if (range.intersectsNode(n) && !n.parentElement.closest(`.dm, ${SUGGESTED_TEXT}`)) texts.push(n);
    }
  }
  const out = [];
  for (let t of texts) {
    const s = t === range.startContainer ? range.startOffset : 0;
    const e = t === range.endContainer ? range.endOffset : t.data.length;
    if (s >= e || !t.data.slice(s, e).trim()) continue;
    if (e < t.data.length) t.splitText(e);
    if (s > 0) t = t.splitText(s);
    const w = make();
    t.replaceWith(w);
    w.append(t);
    out.push(w);
  }
  return out;
}

// ---- small things ----------------------------------------------------------

function ago(t) {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Not a login: keep password managers from offering to fill these.
const quiet = (f) => {
  f.autocomplete = "off";
  f.setAttribute("data-1p-ignore", "");
  f.setAttribute("data-lpignore", "true");
  return f;
};

function caretAt(node, offset) {
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

// ---- draft mode ----------------------------------------------------------

export function startDraft({ sheet, untilt }) {
  document.documentElement.classList.add("drafting");

  let author = false;
  let annotations = [];
  const owners = store.get("draftOwners", {});
  let socket = null;
  let saveTimer = 0;
  let saving = Promise.resolve();
  let saveState = "";   // the author's: "", "…", "saved", or what went wrong
  let dirtyMarks = false;
  let commitTimer = 0;
  let stale = false;    // a change arrived while suggestions were being typed

  // Status in the corner: what this mode is, and how it stands.
  const bar = el("div", "draft-bar");
  document.body.append(bar);
  const status = (text) => {
    const comments = annotations.filter((a) => a.kind === "comment").length;
    const suggestions = annotations.filter((a) => a.kind === "insert" || a.kind === "delete").length;
    bar.textContent =
      text ??
      [
        author ? "Drafting" : "Select words to leave a comment",
        author && saveState,
        comments && plural(comments, "comment"),
        suggestions && plural(suggestions, "suggestion"),
      ]
        .filter(Boolean)
        .join(" · ");
  };

  // ---- loading and live updates ----

  async function load(fresh) {
    slug = slugFor(location.pathname);
    let data;
    try {
      data = await api("GET");
    } catch (err) {
      status(`Draft unavailable · ${err.message}`);
      return;
    }
    author = data.author;
    annotations = data.annotations;
    // The author's open sheet is the truth while he's on it; everyone else
    // follows what's saved.
    if (data.html != null && (fresh || !author)) sheet.innerHTML = clean(data.html);
    // Only the author writes on the sheet; everyone else selects and comments.
    sheet.contentEditable = author ? "true" : "false";
    sheet.spellcheck = false;
    if (author) document.execCommand("defaultParagraphSeparator", false, "p");
    render(true);
    status();
  }

  // Someone else changed something. Suggestions still being typed would be
  // swept away by a reload, so it waits for them to be sent.
  function refresh() {
    if (sheet.querySelector(".pending")) stale = true;
    else load(false);
  }

  function connect() {
    socket?.close();
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/draft/live?slug=${encodeURIComponent(slug)}`);
    let timer = 0;
    ws.onmessage = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 150);
    };
    ws.onclose = () => {
      if (socket === ws) setTimeout(() => socket === ws && connect(), 3000);
    };
    socket = ws;
  }

  // ---- writing ----
  // The author's edits go straight into the sheet and are saved. Anyone
  // else's are caught before they land and turned into suggestions.

  sheet.addEventListener("input", () => {
    if (!author) return;
    saveState = "…";
    status();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 800);
  });

  function save() {
    const html = serialize(sheet);
    saving = saving
      .then(() => api("PUT", "", { html }))
      .then(() => (saveState = "saved"))
      .catch((err) => (saveState = `not saved: ${err.message}`))
      .then(() => status());
    return saving;
  }

  // Pasted text comes in as words only.
  sheet.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (author) document.execCommand("insertText", false, text);
    else if (ensureName()) suggestInsert(text);
  });

  // ⌘⇧X crosses the selection out.
  sheet.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "x") {
      e.preventDefault();
      remove();
    }
  });

  sheet.addEventListener("beforeinput", (e) => {
    if (author) return;
    e.preventDefault();
    const t = e.inputType;
    if (t === "insertText" || t === "insertReplacementText") {
      if (ensureName()) suggestInsert(e.data ?? e.dataTransfer?.getData("text/plain") ?? "");
    } else if (t === "insertParagraph" || t === "insertLineBreak") {
      commitSoon(0);
    } else if (t.startsWith("delete") && t !== "deleteByDrag") {
      if (ensureName()) suggestDelete(t.includes("Forward") ? "forward" : "backward", t.includes("Word") ? "word" : "character");
    }
  });

  // Cross out the selection in the author's own pencil.
  function remove() {
    if (author) document.execCommand("strikeThrough");
  }

  // ---- suggestions (anyone but the author) ----

  // Typed text: into the suggestion being written at the caret, or a new one.
  function suggestInsert(text) {
    const sel = getSelection();
    if (!text || !sel.rangeCount) return;
    if (!sel.isCollapsed) crossOut(sel.getRangeAt(0));
    let range = sel.getRangeAt(0).cloneRange();
    range.collapse(false);
    const own = range.startContainer.parentElement?.closest(`${SUGGESTED_TEXT}.pending`);
    if (own && range.startContainer.nodeType === Node.TEXT_NODE) {
      const node = range.startContainer;
      const at = range.startOffset;
      node.insertData(at, text);
      caretAt(node, at + text.length);
    } else {
      // Never inside someone else's suggestion or a crossing-out: after it.
      const inside = (range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer)
        ?.closest(`${SUGGESTED_TEXT}, del.sg`);
      if (inside && sheet.contains(inside)) {
        range = document.createRange();
        range.setStartAfter(inside);
      }
      const ins = el("ins", "sg pending mine");
      const node = document.createTextNode(text);
      ins.append(node);
      range.insertNode(ins);
      caretAt(node, text.length);
    }
    commitSoon();
  }

  // Backspace / delete: cross out the character or word beside the caret (or
  // the selection), growing the crossing-out being made; within the
  // suggestion being written, just take the characters back.
  function suggestDelete(direction, unit) {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    if (sel.isCollapsed) {
      const r = sel.getRangeAt(0);
      const own = r.startContainer.parentElement?.closest(`${SUGGESTED_TEXT}.pending`);
      if (own && r.startContainer.nodeType === Node.TEXT_NODE) {
        const node = r.startContainer;
        const at = r.startOffset;
        const from = direction === "backward" ? Math.max(0, at - 1) : at;
        const to = direction === "backward" ? at : Math.min(node.data.length, at + 1);
        if (from < to) {
          node.deleteData(from, to - from);
          if (!own.textContent) {
            const before = document.createRange();
            before.setStartBefore(own);
            own.remove();
            caretAt(before.startContainer, before.startOffset);
          } else caretAt(node, from);
          commitSoon();
          return;
        }
      }
      sel.modify("extend", direction, unit);
      if (sel.isCollapsed) return;
    }
    const marks = crossOut(sel.getRangeAt(0));
    if (marks.length) {
      const r = document.createRange();
      if (direction === "backward") r.setStartBefore(marks[0]);
      else r.setStartAfter(marks[marks.length - 1]);
      caretAt(r.startContainer, r.startOffset);
    }
    commitSoon();
  }

  function crossOut(range) {
    const marks = wrap(range, () => el("del", "sg pending mine"));
    // Run into neighbouring crossings-out being made, so one run of the
    // backspace key is one suggestion.
    for (const m of [...sheet.querySelectorAll("del.sg.pending")]) {
      const prev = m.previousSibling;
      if (prev?.nodeType === Node.ELEMENT_NODE && prev.matches("del.sg.pending")) {
        prev.append(...m.childNodes);
        m.remove();
      }
    }
    sheet.normalize();
    return marks.filter((m) => m.isConnected);
  }

  function commitSoon(ms = 1400) {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commit, ms);
  }
  sheet.addEventListener("blur", () => sheet.querySelector(".pending") && commitSoon(0));

  // Send the suggestions being written to the Worker.
  let committing = Promise.resolve();
  function commit() {
    committing = committing.then(async () => {
      for (const p of [...sheet.querySelectorAll(".pending")]) {
        if (!p.isConnected) continue;
        let body;
        if (p.matches(SUGGESTED_TEXT)) {
          body = { kind: "insert", text: p.textContent, ...pointOf(p, sheet) };
        } else {
          const r = document.createRange();
          r.selectNodeContents(p);
          const anchor = anchorOf(r, sheet);
          if (!anchor) {
            p.replaceWith(...p.childNodes);
            continue;
          }
          body = { kind: "delete", ...anchor };
        }
        try {
          const res = await api("POST", "/annotations", { ...body, name: store.get("draftName", "") });
          owners[res.annotation.id] = res.owner;
          store.set("draftOwners", owners);
          annotations.push(res.annotation);
          p.classList.remove("pending");
          p.dataset.a = res.annotation.id;
          if (p.matches(SUGGESTED_TEXT)) p.contentEditable = "false";
        } catch (err) {
          status(`Suggestion not sent · ${err.message}`);
          return;
        }
      }
      status();
      if (stale) {
        stale = false;
        load(false);
      }
    });
    return committing;
  }

  // ---- marks and margin notes ----

  function render(force) {
    if (!force && document.activeElement === sheet && (author || sheet.querySelector(".pending"))) {
      dirtyMarks = true;
      return;
    }
    dirtyMarks = false;
    undecorate(sheet, { keepPending: true });

    // Find everything first (ranges keep their place as the DOM changes),
    // then mark it up.
    const index = textIndex(sheet);
    const found = annotations.map((a) => [a, locate(index, a)]).filter(([, r]) => r);
    const firsts = [];
    for (const [a, range] of found) {
      if (a.kind === "insert") continue;
      const marks = wrap(range, () => {
        const m = a.kind === "delete" ? el("del", "sg") : el("mark", a.kind === "comment" ? "cm" : "hl");
        m.dataset.a = a.id;
        if (owners[a.id]) m.classList.add("mine");
        return m;
      });
      if (a.kind === "comment" && marks[0]) firsts.push([a, marks[0]]);
    }
    for (const [a, range] of found) {
      if (a.kind !== "insert") continue;
      const ins = el("ins", owners[a.id] ? "sg mine" : "sg", a.text);
      ins.dataset.a = a.id;
      ins.contentEditable = "false";
      range.insertNode(ins);
    }

    // A red pencil number in the margin beside each comment's first line,
    // measured square to the page (the sheet's tilt applies to both).
    untilt(() => {
      const box = sheet.getBoundingClientRect();
      const perLine = new Map();
      firsts
        .map(([a, m]) => [a, m.getBoundingClientRect().top - box.top])
        .sort((x, y) => x[1] - y[1])
        .forEach(([a, top], i) => {
          const row = Math.round(top / 10);
          const n = perLine.get(row) || 0;
          perLine.set(row, n + 1);
          const dot = el("button", "dm", String(i + 1));
          dot.contentEditable = "false";
          dot.dataset.a = a.id;
          dot.style.top = `${top}px`;
          dot.style.setProperty("--n", n);
          dot.title = `${a.name}: ${a.text}`;
          sheet.append(dot);
        });
    });
  }
  sheet.addEventListener("blur", () => dirtyMarks && setTimeout(() => render(), 0));

  // ---- the toolbar ----

  const tools = el("div", "draft-tools");
  tools.hidden = true;
  document.body.append(tools);
  let pending = null;   // the words a toolbar action applies to

  function selectionOnSheet() {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (!sheet.contains(range.commonAncestorContainer)) return null;
    return range;
  }

  function placeTools(rect) {
    const w = tools.offsetWidth;
    const x = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), innerWidth - w - 8);
    const above = rect.top - tools.offsetHeight - 10;
    const y = above > 8 ? above : rect.bottom + 10;
    tools.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function showTools() {
    if (tools.dataset.mode === "compose" || tools.dataset.mode === "name") return;
    const range = selectionOnSheet();
    if (!range) {
      hideTools();
      return;
    }
    pending = anchorOf(range, sheet);
    if (!pending) return;
    tools.dataset.mode = "pick";
    tools.replaceChildren(...(author ? [button("Remove", remove)] : []), button("Comment", compose));
    tools.hidden = false;
    placeTools(range.getBoundingClientRect());
  }

  function hideTools() {
    tools.hidden = true;
    tools.dataset.mode = "";
  }

  function button(label, onclick, cls = "") {
    const b = el("button", cls, label);
    b.type = "button";
    // Keep the selection while clicking.
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", onclick);
    return b;
  }

  let selTimer = 0;
  document.addEventListener("selectionchange", () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(showTools, 180);
  });

  function flash(message) {
    let msg = tools.querySelector(".draft-error");
    if (!msg) tools.append((msg = el("div", "draft-error")));
    msg.textContent = message;
  }

  // A name before someone's first suggestion, so Brandon knows whose it is.
  function ensureName() {
    if (author || store.get("draftName", "")) return true;
    askName();
    return false;
  }

  function askName() {
    const sel = getSelection();
    const saved = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    let rect = saved?.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) rect = sheet.getBoundingClientRect();
    tools.dataset.mode = "name";
    tools.replaceChildren();
    const form = el("form", "draft-compose");
    form.append(el("div", "draft-quote", "Your name, so Brandon knows whose suggestions these are"));
    const name = quiet(el("input"));
    name.placeholder = "Your name";
    name.maxLength = 40;
    form.append(name);
    const row = el("div", "draft-row");
    row.append(button("Cancel", hideTools), el("button", "draft-primary", "Start suggesting"));
    form.append(row);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!name.value.trim()) return;
      store.set("draftName", name.value.trim());
      hideTools();
      sheet.focus();
      if (saved) {
        sel.removeAllRanges();
        sel.addRange(saved);
      }
    });
    form.addEventListener("keydown", (e) => e.key === "Escape" && hideTools());
    tools.append(form);
    tools.hidden = false;
    placeTools(rect);
    name.focus();
  }

  // Writing a comment: a little form where the toolbar was.
  function compose() {
    if (!pending) return;
    const anchor = pending;
    const rect = tools.getBoundingClientRect();
    tools.dataset.mode = "compose";
    tools.replaceChildren();
    const form = el("form", "draft-compose");
    form.append(el("div", "draft-quote", `“${anchor.quote.length > 80 ? anchor.quote.slice(0, 80) + "…" : anchor.quote}”`));
    const text = quiet(el("textarea"));
    text.placeholder = "Leave a note…";
    text.maxLength = 1000;
    text.rows = 3;
    form.append(text);
    let name = null;
    if (!author) {
      name = quiet(el("input"));
      name.placeholder = "Your name";
      name.maxLength = 40;
      name.value = store.get("draftName", "");
      form.append(name);
    }
    // Honeypot: people never see or fill it.
    const trap = el("input");
    trap.name = "website";
    trap.tabIndex = -1;
    trap.autocomplete = "off";
    trap.className = "draft-trap";
    form.append(trap);
    const row = el("div", "draft-row");
    row.append(button("Cancel", hideTools), el("button", "draft-primary", "Post"));
    form.append(row);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (name) store.set("draftName", name.value.trim());
      try {
        const res = await api("POST", "/annotations", {
          kind: "comment",
          text: text.value,
          name: name?.value.trim() ?? "",
          website: trap.value,
          ...anchor,
        });
        owners[res.annotation.id] = res.owner;
        store.set("draftOwners", owners);
        annotations.push(res.annotation);
        getSelection().removeAllRanges();
        hideTools();
        render(true);
        status();
      } catch (err) {
        flash(err.message);
      }
    });
    form.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideTools();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.requestSubmit();
    });
    tools.append(form);
    tools.hidden = false;
    placeTools(rect);
    (name && !name.value ? name : text).focus();
  }

  // ---- reading a note, deciding on a suggestion ----

  const note = el("div", "draft-note");
  note.hidden = true;
  document.body.append(note);

  async function drop(id) {
    await api("DELETE", "/annotations", null, { query: `&id=${id}`, headers: owners[id] ? { "x-owner": owners[id] } : {} });
    annotations = annotations.filter((x) => x.id !== id);
    delete owners[id];
    store.set("draftOwners", owners);
  }

  // Accepting writes the suggestion into the sheet for real and saves it.
  async function accept(a) {
    const els = sheet.querySelectorAll(`[data-a="${a.id}"]`);
    if (a.kind === "insert") els.forEach((e) => e.replaceWith(document.createTextNode(e.textContent)));
    else els.forEach((e) => e.remove());
    sheet.normalize();
    await save();
    await drop(a.id);
  }

  function openNote(id, anchorEl) {
    const a = annotations.find((x) => x.id === id);
    if (!a) return;
    hideTools();
    note.replaceChildren();
    const act = (label, fn) =>
      button(label, async () => {
        try {
          await fn();
          note.hidden = true;
          render(true);
          status();
        } catch (err) {
          note.append(el("div", "draft-error", err.message));
        }
      }, "draft-act");
    const actions = el("div", "draft-actions");
    if (a.kind === "comment") {
      note.append(el("p", "draft-note-text", a.text), el("div", "draft-note-by", `— ${a.name}, ${ago(a.at)}`));
      if (author || owners[id]) actions.append(act("Remove", () => drop(id)));
    } else if (a.kind === "insert" || a.kind === "delete") {
      const what = a.kind === "insert" ? `Add “${a.text.trim()}”` : `Cross out “${a.quote}”`;
      note.append(el("p", "draft-note-text", what), el("div", "draft-note-by", `Suggested by ${a.name}, ${ago(a.at)}`));
      if (author) actions.append(act("Accept", () => accept(a)), act("Reject", () => drop(id)));
      else if (owners[id]) actions.append(act("Undo", () => drop(id)));
    } else {
      note.append(el("div", "draft-note-by", `Highlighted by ${a.name || "someone"}, ${ago(a.at)}`));
      if (author || owners[id]) actions.append(act("Remove", () => drop(id)));
    }
    if (actions.childElementCount) note.append(actions);
    const r = anchorEl.getBoundingClientRect();
    note.hidden = false;
    const x = Math.min(Math.max(8, r.left - 12), innerWidth - note.offsetWidth - 8);
    note.style.left = `${x + scrollX}px`;
    note.style.top = `${r.bottom + 8 + scrollY}px`;
  }

  document.addEventListener("click", (e) => {
    const target = e.target.closest?.(".dm, mark[data-a], ins.sg[data-a], del.sg[data-a]");
    if (target && sheet.contains(target)) {
      openNote(target.dataset.a, target);
      return;
    }
    if (!note.contains(e.target)) note.hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      note.hidden = true;
      if (tools.dataset.mode === "pick") hideTools();
    }
  });

  // ---- moving between pages ----

  window.addEventListener("sheet:swap", () => {
    hideTools();
    note.hidden = true;
    load(true).then(connect);
  });
  window.addEventListener("resize", () => render());

  status("Draft · loading…");
  load(true).then(connect);
}
