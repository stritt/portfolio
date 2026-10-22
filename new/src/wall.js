// The wall: what visitors leave behind. A doodle drawn on it (doodle.js) is
// pinned up with a name and waits for Brandon; once he approves it, it's
// drawn there for everyone, signed. Approved notes are listed on it too.
//
// Brandon is whoever holds the draft key on this device (see draft.js); on
// /wall/ he also sees what's waiting, with Approve and Remove.

import { rng } from "./hand.js";
import { INK, drawStrokes } from "./pencil.js";

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
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}).`);
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
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}).`);
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

// A sticky note: sign it and pin it up. send(name) does the pinning.
export function pinUp({ title, send, onSuccess }) {
  document.querySelector(".pin-note")?.remove();
  const note = el("form", "draft-note pin-note");
  note.append(el("p", null, title), el("p", "draft-note-by", "Brandon reads everything before it goes up."));
  const name = quiet(el("input", "pin-name"));
  name.placeholder = "Sign it";
  name.maxLength = 40;
  name.value = store.get("wallName", "");
  const err = el("p", "draft-error");
  const pin = el("button", "draft-act", "Save doodle");
  const later = el("button", "draft-act", "Not now");
  later.type = "button";
  later.onclick = () => note.remove();
  const actions = el("div", "draft-actions");
  actions.append(pin, later);
  note.append(name, actions, err);
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
      note.replaceChildren(el("p", null, "Saved. It'll go up once Brandon's had a look."));
      setTimeout(() => note.remove(), 3200);
    } catch (error) {
      err.textContent = error.message;
      pin.disabled = false;
    }
  });
  document.body.append(note);
  name.focus();
}

// A note in its writer's hand: a line per line, then the signature.
function noteEl(item) {
  const box = el("div", "guest wall-note");
  for (const line of item.text.split("\n")) box.append(el("p", null, line || " "));
  if (item.name) box.append(el("p", "guest-by", `— ${item.name}`));
  return box;
}

// ---- /wall/ ----

export async function showWall(sheet) {
  const list = sheet.querySelector(".wall-notes");
  if (!list) return;
  let reviewError = "";
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has("review")) {
    const token = fragment.get("review");
    history.replaceState(history.state, "", "/wall/?review");
    try {
      const res = await fetch("/api/review-session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await res.json();
      if (!res.ok) reviewError = data.error;
    } catch { reviewError = "Couldn't sign in. Please try again."; }
  }
  let author = isAuthor();
  try {
    const data = await wallApi("GET", { query: "notes" });
    const { items } = data;
    author = data.author;
    list.replaceChildren(...items.map(noteEl));
  } catch {
    list.replaceChildren(el("p", "wall-empty", "The wall couldn't be reached."));
  }
  if (author) showQueue();
  else if (new URLSearchParams(location.search).has("review")) {
    document.querySelector(".wall-queue")?.remove();
    const panel = el("aside", "wall-queue");
    panel.setAttribute("aria-label", "Owner sign in");
    panel.append(el("h2", null, "Review submissions"), el("p", null, reviewError || "Brandon: sign in to see the doodles and comments waiting for approval."));
    const button = el("button", "wall-arrange", "Email me a sign-in link");
    const status = el("p", null, "");
    status.setAttribute("role", "status");
    button.onclick = async () => {
      button.disabled = true;
      try {
        const res = await fetch("/api/review-link", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        status.textContent = "Sent to your Gmail inbox. Open the private link on this device to review submissions.";
      } catch (error) { status.textContent = error.message; button.disabled = false; }
    };
    const close = el("a", null, "Back to the wall");
    close.href = "/wall/";
    panel.append(button, status, close);
    document.body.append(panel);
  }
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
  c.width = w * 2;
  c.height = Math.ceil(Math.min((y1 - y0 + 2 * pad) * k, 320) * 2);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fbfaf6";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(2, 2);
  ctx.translate((w - (x1 - x0) * k) / 2 - x0 * k, pad * k - y0 * k);
  ctx.fillStyle = INK;
  drawStrokes(ctx, item.strokes, k, rng(7));
  return c;
}

// Brandon sees pending work and can hide or arrange approved doodles.
async function showQueue() {
  queueAbort?.abort();
  queueAbort = new AbortController();
  const panelAbort = queueAbort;
  document.querySelector(".wall-queue")?.remove();
  const panel = el("aside", "wall-queue");
  document.body.append(panel);
  let pending, approved, comments;
  try {
    const results = await Promise.all([
      wallApi("GET", { query: "pending" }),
      wallApi("GET", { query: "approved" }),
      ...reviewPosts.map(({ slug }) => commentApi("GET", slug, { query: "pending" })),
    ]);
    pending = results[0].items;
    approved = results[1].items;
    comments = results.slice(2).flatMap(({ items }, i) => items.map((item) => ({ ...item, ...reviewPosts[i] })));
  } catch (error) {
    panel.append(el("p", null, error.message));
    return;
  }
  if (location.pathname !== "/wall/" || !panel.isConnected) {
    panel.remove();
    return;
  }
  panel.classList.toggle("wall-queue-arranging", arranging);
  const act = (label, run) => {
    const b = el("button", null, label);
    b.onclick = async () => {
      b.disabled = true;
      try {
        await run();
        window.dispatchEvent(new Event("wall:refresh"));
        showWall(document.querySelector("#sheet"));
      } catch (error) {
        b.disabled = false;
        b.textContent = error.message;
      }
    };
    return b;
  };

  panel.append(el("h2", null, pending.length ? `Waiting (${pending.length})` : "Nothing waiting"));
  for (const item of pending) {
    const row = el("div", "wall-item");
    row.append(el("p", "wall-meta", `${item.kind === "note" ? "Note" : `Doodle on ${item.page}`}${item.name ? ` · ${item.name}` : ""}`));
    row.append(item.kind === "note" ? el("p", "wall-text", item.text) : doodlePreview(item));
    const actions = el("div", "wall-actions");
    actions.append(
      act("Approve", () => wallApi("POST", { sub: "/approve", query: `id=${encodeURIComponent(item.id)}` })),
      act("Remove", () => wallApi("DELETE", { query: `id=${encodeURIComponent(item.id)}` })),
    );
    row.append(actions);
    panel.append(row);
  }

  panel.append(el("h2", null, `Comments waiting (${comments.length})`));
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
      act("Remove", () => commentApi("DELETE", item.slug, { query: `id=${encodeURIComponent(item.id)}` })),
    );
    row.append(actions);
    panel.append(row);
  }

  const current = approved.filter((item) => item.page === location.pathname && !item.hidden);
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
    row.append(el("p", "wall-meta", `${item.hidden ? "Hidden" : "Visible"} · ${item.page}${item.name ? ` · ${item.name}` : ""}`));
    row.append(doodlePreview(item));
    const actions = el("div", "wall-actions");
    actions.append(act(item.hidden ? "Show" : "Hide", () => wallApi("PATCH", {
      sub: "/visibility",
      query: `id=${encodeURIComponent(item.id)}&page=${encodeURIComponent(item.page)}`,
      body: { hidden: !item.hidden },
    })));
    row.append(actions);
    panel.append(row);
  }
}
