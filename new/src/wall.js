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
export function pinUp({ title, send }) {
  document.querySelector(".pin-note")?.remove();
  const note = el("form", "draft-note pin-note");
  note.append(el("p", null, title), el("p", "draft-note-by", "Brandon reads everything before it goes up."));
  const name = quiet(el("input", "pin-name"));
  name.placeholder = "Sign it";
  name.maxLength = 40;
  name.value = store.get("wallName", "");
  const err = el("p", "draft-error");
  const pin = el("button", "draft-act", "Pin it");
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
      note.replaceChildren(el("p", null, "Pinned. It'll go up once Brandon's had a look."));
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
  try {
    const { items } = await wallApi("GET", { query: "notes" });
    list.replaceChildren(...items.map(noteEl));
  } catch {
    list.replaceChildren(el("p", "wall-empty", "The wall couldn't be reached."));
  }
  if (isAuthor()) showQueue();
}

// What's waiting, for Brandon: each note or doodle with Approve and Remove.
async function showQueue() {
  document.querySelector(".wall-queue")?.remove();
  const panel = el("aside", "wall-queue");
  document.body.append(panel);
  let items;
  try {
    ({ items } = await wallApi("GET", { query: "pending" }));
  } catch (error) {
    panel.append(el("p", null, error.message));
    return;
  }
  panel.append(el("h2", null, items.length ? `Waiting (${items.length})` : "Nothing waiting"));
  for (const item of items) {
    const row = el("div", "wall-item");
    row.append(el("p", "wall-meta", `${item.kind === "note" ? "Note" : `Doodle on ${item.page}`}${item.name ? ` · ${item.name}` : ""}`));
    if (item.kind === "note") {
      row.append(el("p", "wall-text", item.text));
    } else {
      // A preview on white: just the drawing, fitted to the panel.
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
      row.append(c);
    }
    const act = (label, run) => {
      const b = el("button", null, label);
      b.onclick = async () => {
        b.disabled = true;
        try {
          await run();
          showWall(document.querySelector("#sheet"));
        } catch (error) {
          b.disabled = false;
          b.textContent = error.message;
        }
      };
      return b;
    };
    const actions = el("div", "wall-actions");
    actions.append(
      act("Approve", () => wallApi("POST", { sub: "/approve", query: `id=${encodeURIComponent(item.id)}` })),
      act("Remove", () => wallApi("DELETE", { query: `id=${encodeURIComponent(item.id)}` })),
    );
    row.append(actions);
    panel.append(row);
  }
}
