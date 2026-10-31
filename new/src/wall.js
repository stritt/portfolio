// The wall: what visitors leave behind. A doodle drawn on it (doodle.js) is
// pinned up with a name and waits for Brandon; once he approves it, it's
// drawn there for everyone, signed. Approved notes are listed on it too.
//
// Brandon is whoever holds the draft key on this device (see draft.js); on
// /wall/ he also sees what's waiting, with Approve and Remove.

import { rng } from "./hand.js";
import { INK, drawGraphiteStrokes } from "./pencil.js";
import { underline } from "./underline.js";

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

const authorKey = () => store.get("draftKey", "");
export const isAuthor = () => !!authorKey();

export async function wallApi(method, { sub = "", query = "", body } = {}) {
  const key = authorKey();
  const res = await fetch(`/api/wall${sub}${query ? `?${query}` : ""}`, {
    method,
    headers: { "content-type": "application/json", ...(key ? { "x-draft-key": key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Couldn’t reach the server (${res.status}). Try reloading.`);
  return data;
}

// The current published post's anchored comments live in Drafts, while wall
// notes and doodles live in Wall. Both arrive in this same approval panel.
const reviewPosts = [{ slug: "notes/interfaces-are-cattle", title: "Interfaces are cattle, not pets…" }];
async function commentApi(method, slug, { sub = "", query = "" } = {}) {
  const key = authorKey();
  const params = `slug=${encodeURIComponent(slug)}${query ? `&${query}` : ""}`;
  const res = await fetch(`/api/draft/annotations${sub}?${params}`, {
    method,
    headers: { ...(key ? { "x-draft-key": key } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Couldn’t reach the server (${res.status}). Try reloading.`);
  return data;
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// Keeps password managers from offering to fill a name field.
const quiet = (input) => {
  input.autocomplete = "off";
  input.setAttribute("data-1p-ignore", "");
  input.setAttribute("data-lpignore", "true");
  input.setAttribute("data-form-type", "other");
  return input;
};

// A sticky note: sign it and save it to the wall. send(name) does the saving.
export function pinUp({ title, send, onSuccess }) {
  document.querySelector(".pin-note")?.remove();
  const opener = document.activeElement;
  const note = el("form", "draft-note pin-note");
  note.tabIndex = -1;
  note.setAttribute("aria-label", title);
  note.append(el("p", null, title), el("p", "draft-note-by", "I read everything before it goes up."));
  const name = quiet(el("input", "pin-name"));
  name.placeholder = "Sign it";
  name.setAttribute("aria-label", "Your name, to sign the doodle");
  name.autocapitalize = "words";
  name.enterKeyHint = "done";
  name.required = true;
  name.maxLength = 40;
  name.value = store.get("wallName", "");
  const err = el("p", "draft-error");
  err.setAttribute("role", "alert");
  // In the page before it's filled, so the confirmation is announced.
  const said = el("p");
  said.setAttribute("role", "status");
  const pin = el("button", "draft-act", "Save doodle");
  const later = el("button", "draft-act", "Not now");
  later.type = "button";
  const actions = el("div", "draft-actions");
  actions.append(pin, later);
  note.append(name, actions, err, said);

  // Closing hands focus back to what opened the note, or the next best thing
  // still on screen (saving turns doodling off, which hides the bar).
  let timer = 0, left = 3200, since = 0;
  const visibility = new AbortController();
  const close = () => {
    clearTimeout(timer);
    visibility.abort();
    if (!note.isConnected) return;
    const had = note.contains(document.activeElement);
    note.remove();
    if (!had) return;
    const back = [opener, document.querySelector('.sheet [data-tool="doodle"]'), document.querySelector("#sheet h1")]
      .find((n) => n?.isConnected && n.getClientRects().length);
    if (back?.tagName === "H1") back.tabIndex = -1;
    back?.focus({ preventScroll: true });
  };
  later.onclick = close;
  note.addEventListener("keydown", (e) => e.key === "Escape" && close());

  note.addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = name.value.trim();
    if (!n) return name.focus();
    store.set("wallName", n);
    pin.disabled = true;
    err.textContent = "";
    try {
      await send(n);
      onSuccess?.();
      for (const c of [...note.children]) if (c !== said) c.remove();
      said.textContent = "Saved. It’ll go up once I’ve had a look.";
      note.focus({ preventScroll: true });
      // The thanks stays up for 3.2s of it actually being seen.
      const tick = () => { since = Date.now(); timer = setTimeout(close, left); };
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) { clearTimeout(timer); left -= Date.now() - since; }
        else tick();
      }, { signal: visibility.signal });
      tick();
    } catch (error) {
      err.textContent = error.message;
      pin.disabled = false;
    }
  });
  document.body.append(note);
  (name.value ? pin : name).focus();
}

// A note in its writer's hand: a line per line, then the signature.
function noteEl(item) {
  const box = el("div", "guest wall-note");
  for (const line of item.text.split("\n")) box.append(el("p", null, line || " "));
  if (item.name) box.append(el("p", "guest-by", `— ${item.name}`));
  return box;
}

// ---- /wall/ ----

let reviewError = "";
export async function prepareReview() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (!fragment.has("review")) return;
  const token = fragment.get("review");
  const url = new URL(location.href);
  if (!url.searchParams.has("review")) url.searchParams.set("review", "");
  history.replaceState(history.state, "", url.pathname + url.search);
  try {
    const res = await fetch("/api/review-session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
    const data = await res.json();
    if (!res.ok) reviewError = data.error;
  } catch { reviewError = "Couldn't sign in. Please reopen the link in your email."; }
}
function reviewUnavailable() {
  document.querySelector(".wall-queue")?.remove();
  const panel = el("aside", "wall-queue");
  panel.append(el("h2", null, "Private review"), el("p", null, reviewError || "Open the private link from your review notification email to sign in."));
  document.body.append(panel);
}
export async function showArticleReview() {
  const path = location.pathname;
  const post = reviewPosts.find(({ slug }) => `/${slug}/` === path);
  if (!post) return;
  // The review cookie is HttpOnly, so ask: anyone else gets author: false.
  let author = false;
  try {
    ({ author } = await commentApi("GET", post.slug, { query: "pending" }));
  } catch {}
  if (location.pathname !== path) return;
  if (author) showQueue();
  else if (new URLSearchParams(location.search).has("review")) reviewUnavailable();
}

export async function showWall(sheet) {
  const list = sheet.querySelector(".wall-notes");
  if (!list) return;
  let author = isAuthor();
  try {
    const data = await wallApi("GET", { query: "notes" });
    const { items } = data;
    author = data.author;
    list.replaceChildren(...items.map(noteEl));
    const pageNav = sheet.querySelector(".wall-pages");
    const page = Number(new URLSearchParams(location.search).get("sheet")) || 1;
    pageNav?.replaceChildren(el("span", null, `Page ${page} of ${data.sheets}`));
    for (const [label, number] of [["← Previous", page - 1], ["Next →", page + 1]]) {
      if (number < 1 || number > data.sheets) continue;
      const link = el("a", null, label);
      link.href = `/wall/?sheet=${number}`;
      link.setAttribute("data-reload", "");
      pageNav?.append(link);
    }
    if (pageNav) underline(pageNav);
  } catch {
    const retry = el("button", "tool", "Try again");
    retry.type = "button";
    retry.onclick = () => showWall(sheet);
    list.replaceChildren(el("p", "wall-empty", "The wall couldn't be reached. "));
    list.firstChild.append(retry);
  }
  if (author) showQueue();
  else if (new URLSearchParams(location.search).has("review")) reviewUnavailable();
}

let arranging = false;
let queueAbort = null;
window.addEventListener("sheet:swap", () => {
  if (location.pathname === "/wall/") return;
  arranging = false;
  queueAbort?.abort();
  document.querySelector(".wall-queue")?.remove();
  window.dispatchEvent(new CustomEvent("wall:arrange", { detail: { active: false } }));
});

function doodlePreview(item) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of item.strokes) {
    for (let i = 0; i < s.length; i += 3) {
      x0 = Math.min(x0, s[i]);
      x1 = Math.max(x1, s[i]);
      y0 = Math.min(y0, s[i + 1]);
      y1 = Math.max(y1, s[i + 1]);
    }
  }
  const pad = 12;
  const w = 248;
  const k = Math.min(w / (x1 - x0 + 2 * pad), 2);
  const c = document.createElement("canvas");
  c.setAttribute("role", "img");
  c.setAttribute("aria-label", item.name ? `Doodle by ${item.name}` : "Doodle");
  c.width = w * 2;
  c.height = Math.ceil(Math.min((y1 - y0 + 2 * pad) * k, 320) * 2);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fbfaf6";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(2, 2);
  ctx.translate((w - (x1 - x0) * k) / 2 - x0 * k, pad * k - y0 * k);
  ctx.fillStyle = INK;
  drawGraphiteStrokes(ctx, item.strokes, k, rng(7));
  return c;
}

// Brandon sees pending work and can hide or arrange approved doodles.
async function showQueue() {
  queueAbort?.abort();
  queueAbort = new AbortController();
  const panelAbort = queueAbort;
  document.querySelector(".wall-queue")?.remove();
  const panel = el("aside", "wall-queue");
  panel.tabIndex = 0;
  panel.setAttribute("aria-label", "Review submissions");
  document.body.append(panel);
  const path = location.pathname;
  const onWall = path === "/wall/";
  const posts = onWall ? reviewPosts : reviewPosts.filter(({ slug }) => `/${slug}/` === path);
  const focus = new URLSearchParams(location.search).get("review");
  let pending, approved, comments, sheets = 1;
  try {
    const results = await Promise.all([
      onWall ? wallApi("GET", { query: "pending" }) : Promise.resolve({ items: [] }),
      onWall ? wallApi("GET", { query: "approved" }) : Promise.resolve({ items: [] }),
      ...posts.map(({ slug }) => commentApi("GET", slug, { query: "pending" })),
    ]);
    pending = results[0].items;
    approved = results[1].items;
    sheets = results[1].sheets || 1;
    comments = results.slice(2).flatMap(({ items }, i) => items.map((item) => ({ ...item, ...posts[i] })));
  } catch (error) {
    panel.append(el("p", null, error.message));
    return;
  }
  if (location.pathname !== path || !panel.isConnected) {
    panel.remove();
    return;
  }
  panel.classList.toggle("wall-queue-arranging", arranging);
  const reviewNav = el("nav", "wall-queue-nav");
  reviewNav.setAttribute("aria-label", "Private review navigation");
  for (const post of reviewPosts) {
    const link = el("a", null, `Review comments: ${post.title}`);
    link.href = `/${post.slug}/?review`;
    link.setAttribute("data-reload", "");
    reviewNav.append(link);
  }
  panel.append(reviewNav);
  if (onWall) {
    const add = el("button", "wall-arrange", "Add a wall page");
    add.onclick = async () => {
      add.disabled = true;
      try {
        const data = await wallApi("POST", { sub: "/sheets" });
        location.assign(`/wall/?sheet=${data.sheets}`);
      } catch (error) { add.disabled = false; failed(add, error); }
    };
    reviewNav.append(add);
  }
  // What went wrong goes beside the button; its label keeps saying what it does.
  function failed(b, error) {
    const where = b.closest(".wall-item") ?? b.parentElement;
    where.querySelector(".wall-error")?.remove();
    const p = el("p", "draft-error wall-error", error.message);
    p.setAttribute("role", "alert");
    where.append(p);
  }
  const sheetPicker = (selected) => {
    const select = el("select");
    select.setAttribute("aria-label", "Wall page");
    for (let n = 1; n <= sheets; n++) {
      const option = el("option", null, `Page ${n}`);
      option.value = n; option.selected = n === selected;
      select.append(option);
    }
    return select;
  };
  // A destructive action asks twice: the first click arms it for 3s.
  const act = (label, run, confirm) => {
    const b = el("button", null, label);
    b.type = "button";
    let armed = 0;
    b.onclick = async () => {
      if (confirm && !armed) {
        b.textContent = confirm;
        armed = setTimeout(() => { armed = 0; b.textContent = label; }, 3000);
        return;
      }
      clearTimeout(armed);
      armed = 0;
      b.textContent = label;
      b.disabled = true;
      b.closest(".wall-item")?.querySelector(".wall-error")?.remove();
      try {
        await run();
        window.dispatchEvent(new Event("wall:refresh"));
        if (onWall) showWall(document.querySelector("#sheet"));
        else showQueue();
      } catch (error) {
        b.disabled = false;
        failed(b, error);
      }
    };
    return b;
  };

  if (focus) {
    const first = (a, b) => Number(b.id === focus) - Number(a.id === focus);
    pending.sort(first); approved.sort(first); comments.sort(first);
  }
  if (onWall) panel.append(el("h2", null, pending.length ? `Waiting (${pending.length})` : "Nothing waiting"));
  for (const item of pending) {
    const row = el("div", "wall-item");
    row.append(el("p", "wall-meta", `${item.kind === "note" ? "Note" : "Doodle for the wall"}${item.name ? ` · ${item.name}` : ""}`));
    row.append(item.kind === "note" ? el("p", "wall-text", item.text) : doodlePreview(item));
    const actions = el("div", "wall-actions");
    const picker = sheetPicker(item.sheet || 1);
    if (item.kind === "doodle") row.append(picker);
    actions.append(
      act("Approve", () => wallApi("POST", { sub: "/approve", query: `id=${encodeURIComponent(item.id)}&sheet=${picker.value}` })),
      act("Remove", () => wallApi("DELETE", { query: `id=${encodeURIComponent(item.id)}` }), "Click again to remove"),
    );
    row.append(actions);
    panel.append(row);
  }

  panel.append(el("h2", null, `Comments waiting (${comments.length})`));
  if (!comments.length) panel.append(el("p", "wall-meta", "No comments are waiting for approval. New comments will appear here with Approve and Remove buttons."));
  for (const item of comments) {
    const row = el("div", "wall-item");
    row.append(
      el("p", "wall-meta", `${item.title} · ${item.name}`),
      el("p", "wall-quote", `“${item.quote}”`),
      el("p", "wall-text", item.text),
    );
    const actions = el("div", "wall-actions");
    actions.append(
      act("Approve", () => commentApi("POST", item.slug, { sub: "/approve", query: `id=${encodeURIComponent(item.id)}` })),
      act("Remove", () => commentApi("DELETE", item.slug, { query: `id=${encodeURIComponent(item.id)}` }), "Click again to remove"),
    );
    row.append(actions);
    panel.append(row);
  }

  if (!onWall) return;
  const wallPage = Number(new URLSearchParams(location.search).get("sheet")) || 1;
  const current = approved.filter((item) => item.page === location.pathname && (item.sheet || 1) === wallPage && !item.hidden);
  const heading = el("div", "wall-queue-heading");
  heading.append(el("h2", null, `Approved doodles (${approved.length})`));
  if (current.length) {
    const arrange = el("button", "wall-arrange", arranging ? "Done arranging" : "Arrange on page");
    arrange.type = "button";
    arrange.setAttribute("aria-pressed", String(arranging));
    arrange.onclick = () => {
      arranging = !arranging;
      panel.classList.toggle("wall-queue-arranging", arranging);
      arrange.textContent = arranging ? "Done arranging" : "Arrange on page";
      arrange.setAttribute("aria-pressed", String(arranging));
      hint.hidden = !arranging;
      window.dispatchEvent(new CustomEvent("wall:arrange", { detail: { active: arranging } }));
    };
    heading.append(arrange);
  }
  panel.append(heading);
  const hint = el("p", "wall-arrange-hint", "Drag an outlined doodle to move it. It saves when you let go.");
  hint.hidden = !arranging;
  panel.append(hint);
  const onArrangeError = (e) => {
    hint.textContent = e.detail.message;
    hint.hidden = false;
  };
  window.addEventListener("wall:arrange-error", onArrangeError, { signal: panelAbort.signal });
  for (const item of approved) {
    const row = el("div", "wall-item");
    row.append(el("p", "wall-meta", `${item.hidden ? "Hidden" : "Visible"} · Page ${item.sheet || 1}${item.name ? ` · ${item.name}` : ""}`));
    row.append(doodlePreview(item));
    const actions = el("div", "wall-actions");
    actions.append(act(item.hidden ? "Show" : "Hide", () => wallApi("PATCH", {
      sub: "/visibility",
      query: `id=${encodeURIComponent(item.id)}&page=${encodeURIComponent(item.page)}`,
      body: { hidden: !item.hidden },
    })));
    row.append(actions);
    const picker = sheetPicker(item.sheet || 1);
    row.append(picker, act("Move to page", () => wallApi("PATCH", { sub: "/sheet", query: `id=${encodeURIComponent(item.id)}`, body: { sheet: Number(picker.value) } })));
    panel.append(row);
  }
}
