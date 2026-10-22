const POST_SLUG = "cloudflares-all-that";

const STARTER_ALIASES = new Set([
  "/starter",
  "/starter.md",
  "/cloudflare-starter",
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // A review session can moderate submissions, but cannot edit article drafts.
    const reviewRoute = (url.pathname.startsWith("/api/wall") &&
      (request.method !== "POST" || url.pathname.endsWith("/approve") || url.pathname.endsWith("/sheets"))) ||
      (url.pathname.startsWith("/api/draft/annotations") &&
        (request.method === "DELETE" || url.pathname.endsWith("/approve") ||
          (request.method === "GET" && url.searchParams.has("pending"))));
    if (reviewRoute && await validReviewSession(request, env)) {
      const headers = new Headers(request.headers);
      headers.set("x-draft-key", env.DRAFT_KEY);
      request = new Request(request, { headers });
    }

    if (url.pathname === "/api/review-link") return json({ error: "Use the private link in your notification email." }, 404);
    if (url.pathname === "/api/review-session") {
      if (request.headers.get("origin") !== url.origin) return json({ error: "Not allowed." }, 403);
      const { success } = await env.API_RATE_LIMITER.limit({ key: request.headers.get("CF-Connecting-IP") || "unknown" });
      if (!success) return json({ error: "Try again in a minute." }, 429);
      return env.WALL.get(env.WALL.idFromName("wall")).fetch(request);
    }

    // Limit public writes before they reach a Durable Object. Reads and the
    // owner's authenticated editing session are unaffected.
    if (url.pathname.startsWith("/api/") && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
        (!env.DRAFT_KEY || request.headers.get("x-draft-key") !== env.DRAFT_KEY)) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const { success } = await env.API_RATE_LIMITER.limit({ key: ip });
      if (!success) return json({ error: "Too many submissions. Try again in a minute." }, 429);
    }

    if (url.pathname === "/api/comments") {
      if (request.method === "POST") return json({ error: "Leave comments on the article instead." }, 410);
      const id = env.COMMENTS.idFromName(POST_SLUG);
      return env.COMMENTS.get(id).fetch(request);
    }

    // Drafts: /api/draft, /api/draft/annotations and /api/draft/live, each
    // with ?slug= naming the draft (a post's path, plus an optional name).
    // Only posts have drafts.
    if (url.pathname === "/api/draft" || url.pathname.startsWith("/api/draft/")) {
      const slug = url.searchParams.get("slug") || "";
      if (!/^notes\/[a-z0-9-]{1,100}(:[a-z0-9-]{1,40})?$/.test(slug)) {
        return json({ error: "Bad draft." }, 400);
      }
      return env.DRAFTS.get(env.DRAFTS.idFromName(slug)).fetch(request);
    }

    // The wall: visitors' doodles and notes, shown once Brandon approves them.
    if (url.pathname === "/api/wall" || url.pathname.startsWith("/api/wall/")) {
      return env.WALL.get(env.WALL.idFromName("wall")).fetch(request);
    }

    if (url.pathname === "/api/presence") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected websocket", { status: 426 });
      }
      const id = env.PRESENCE.idFromName("world");
      return env.PRESENCE.get(id).fetch(request);
    }

    if (url.pathname === "/") {
      url.pathname = "/index.html";
    }

    // The starter checklist. /starter is the name to share; the older
    // /cloudflare-starter paths stay alive because that link is already out
    // there, and the doc outgrew the Cloudflare-specific name rather than
    // moving. The file itself keeps its original filename so the .md URL that
    // was published still resolves.
    //
    // Only extensionless paths reach here — /cloudflare-starter.md matches a
    // real asset and is served before the Worker runs, which is also why it
    // comes back without the charset below. Markdown has no browser renderer,
    // and without the charset the em dashes and arrows render as mojibake.
    if (STARTER_ALIASES.has(url.pathname)) {
      url.pathname = "/cloudflare-starter.md";
      const asset = await env.ASSETS.fetch(new Request(url.toString(), request));
      const headers = new Headers(asset.headers);
      headers.set("content-type", "text/markdown; charset=utf-8");
      return new Response(asset.body, { status: asset.status, headers });
    }

    const res = await env.ASSETS.fetch(new Request(url.toString(), request));
    // Pages live at /notes/slug/; a link shared without the slash still lands.
    if (res.status === 404 && !url.pathname.endsWith("/") && !/\.[a-z0-9]+$/i.test(url.pathname)) {
      url.pathname += "/";
      const page = await env.ASSETS.fetch(new Request(url.toString(), request));
      if (page.ok) return Response.redirect(url.toString(), 301);
    }
    return res;
  },
};

// One global room relaying visitor positions over hibernating WebSockets.
// Nothing is stored — identity lives in the socket attachment (which survives
// hibernation) and getWebSockets() is the roster. Clients send {t:"s"} state
// at ~8Hz; the DO fans each message out to everyone else.
export class Presence {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const id = crypto.randomUUID().slice(0, 8);
    const hue = Math.floor(Math.random() * 360);

    this.state.acceptWebSocket(server);
    server.serializeAttachment({ id, hue });
    server.send(JSON.stringify({ t: "welcome", id, hue, peers: this.roster(id) }));
    this.broadcast({ t: "join", id, hue }, id);

    return new Response(null, { status: 101, webSocket: client });
  }

  roster(exceptId) {
    const peers = [];
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.id !== exceptId) peers.push({ id: a.id, hue: a.hue });
    }
    return peers;
  }

  webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > 256) return;
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    if (data.t !== "s") return;
    const a = ws.deserializeAttachment();
    if (!a) return;
    this.broadcast(
      {
        t: "s",
        id: a.id,
        hue: a.hue, // lets clients rebuild a peer they expired while it idled
        x: round2(data.x),
        z: round2(data.z),
        ry: round2(data.ry),
        m: data.m === "w" ? "w" : data.m === "j" ? "j" : "i",
      },
      a.id
    );
  }

  webSocketClose(ws) {
    this.leave(ws);
  }

  webSocketError(ws) {
    this.leave(ws);
  }

  leave(ws) {
    const a = ws.deserializeAttachment();
    if (a) this.broadcast({ t: "leave", id: a.id }, a.id);
  }

  broadcast(msg, exceptId) {
    const s = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.id === exceptId) continue;
      try {
        ws.send(s);
      } catch {
        // Peer already gone; close/error handler announces the leave.
      }
    }
  }
}

function round2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

const MAX_NAME = 40;
const MAX_COMMENT = 1000;
const MAX_COMMENTS = 500;
const COOLDOWN_MS = 30_000;

// Word-boundary matches on normalized text
const BAD_TOKENS = [
  "fuck", "shit", "bitch", "cunt", "asshole", "ass", "dick", "dickhead",
  "cock", "cocksucker", "pussy", "bastard", "slut", "whore", "nigger",
  "nigga", "faggot", "fag", "retard", "retarded", "piss", "twat", "wanker",
  "prick", "motherfucker", "bullshit", "dumbass", "jackass", "tits",
  "blowjob", "handjob", "dildo", "douchebag",
];

// Also caught when embedded inside longer words ("f*cking", "horsesh1t")
const BAD_SUBSTRINGS = [
  "fuck", "shit", "bitch", "cunt", "nigg", "faggot", "whore", "slut",
  "retard", "cocksuck", "blowjob", "handjob",
];

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[0]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/[4@]/g, "a")
    .replace(/[5$]/g, "s")
    .replace(/7/g, "t");
}

// In the collapsed text, characters commonly used to mask letters ("f*ck",
// "sh#t") become "." wildcards; each pattern requires the first letter to be
// real so runs of dots (ellipses) can't match on their own.
const MASK_CHARS = /[*#%_.\-]/;
const MASKED_PATTERNS = BAD_SUBSTRINGS.map(
  (w) =>
    new RegExp(
      w[0] +
        w
          .slice(1)
          .split("")
          .map((c) => `[${c}.]`)
          .join("")
    )
);

function hasProfanity(text) {
  const norm = normalize(text);
  const tokens = norm.split(/[^a-z]+/);
  if (BAD_TOKENS.some((w) => tokens.includes(w))) return true;

  let collapsed = "";
  for (const ch of norm) {
    if (ch >= "a" && ch <= "z") collapsed += ch;
    else if (MASK_CHARS.test(ch)) collapsed += ".";
  }
  return MASKED_PATTERNS.some((re) => re.test(collapsed));
}

export class Comments {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method === "GET") {
      return this.list();
    }
    if (request.method === "POST") {
      return this.add(request);
    }
    return json({ error: "Method not allowed." }, 405);
  }

  async list() {
    const entries = await this.state.storage.list({
      prefix: "c:",
      reverse: true,
      limit: 100,
    });
    return json({ comments: [...entries.values()] });
  }

  async add(request) {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid request." }, 400);
    }

    // Honeypot field — humans never see it
    if (String(payload?.website || "").trim()) {
      return json({ error: "Submission blocked." }, 400);
    }

    const name = String(payload?.name || "").trim().slice(0, MAX_NAME);
    const text = String(payload?.comment || "").trim();

    if (!text) {
      return json({ error: "Write something first." }, 400);
    }
    if (text.length > MAX_COMMENT) {
      return json({ error: `Keep it under ${MAX_COMMENT} characters.` }, 400);
    }
    if (/https?:\/\/|www\./i.test(text + " " + name)) {
      return json({ error: "Links aren't allowed in comments." }, 400);
    }
    if (hasProfanity(text) || hasProfanity(name)) {
      return json({ error: "Let's keep it friendly — try rewording that." }, 400);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const ipKey = "ip:" + ip;
    const now = Date.now();
    const lastPost = await this.state.storage.get(ipKey);
    if (lastPost && now - lastPost < COOLDOWN_MS) {
      return json({ error: "You're commenting too fast — give it a moment." }, 429);
    }

    const count = (await this.state.storage.get("count")) || 0;
    if (count >= MAX_COMMENTS) {
      return json({ error: "The guestbook is full." }, 400);
    }

    const comment = {
      name: name || "anonymous",
      text,
      ts: now,
    };

    const key = `c:${String(now).padStart(14, "0")}:${crypto
      .randomUUID()
      .slice(0, 8)}`;
    await this.state.storage.put({
      [key]: comment,
      [ipKey]: now,
      count: count + 1,
    });

    return json({ ok: true, comment });
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// ---- drafts ----
// One Durable Object per draft, holding Brandon's working text and
// everyone's marks on it: comments, and suggested edits (words to insert,
// words to cross out) for him to accept or reject. Only a request carrying
// DRAFT_KEY can change the text; anyone can mark it up. Marks are anchored
// by the text they cover (an insertion by the text either side of it), with
// a little context, not by position, so they survive edits around them.
// Everyone looking at the draft holds a hibernating WebSocket and is told
// to refetch whenever anything changes.

const MAX_DRAFT = 200_000;
const MAX_QUOTE = 600;
const MAX_CONTEXT = 64;
const MAX_NOTE = 1000;
const MAX_ANNOTATIONS = 1000;
const MAX_PENDING_COMMENTS = 200;
const MAX_PENDING_PER_IP = 3;
const NOTE_COOLDOWN_MS = 30_000;
const HIGHLIGHT_COOLDOWN_MS = 600;
const REVIEW_ALERT_COOLDOWN_MS = 5 * 60_000;

async function reviewSigningKey(env) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(`review:${env.DRAFT_KEY}`),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function reviewSession(env) {
  const value = `${Date.now() + 7 * 86400_000}.${crypto.randomUUID()}`;
  const signature = await crypto.subtle.sign("HMAC", await reviewSigningKey(env), new TextEncoder().encode(value));
  return `${value}.${Array.from(new Uint8Array(signature), (x) => x.toString(16).padStart(2, "0")).join("")}`;
}
async function validReviewSession(request, env) {
  if (!env.DRAFT_KEY) return false;
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)burcs_review=([^;]+)/)?.[1];
  if (!token) return false;
  const [expires, nonce, signature] = token.split(".");
  if (!(Number(expires) > Date.now()) || !nonce || !/^[a-f0-9]{64}$/.test(signature || "")) return false;
  return crypto.subtle.verify("HMAC", await reviewSigningKey(env),
    Uint8Array.from(signature.match(/../g), (x) => parseInt(x, 16)), new TextEncoder().encode(`${expires}.${nonce}`));
}
async function issueReviewToken(state) {
  const expired = await state.storage.list({ prefix: "login:" });
  for (const [key, expires] of expired) if (expires < Date.now()) await state.storage.delete(key);
  const token = crypto.randomUUID() + crypto.randomUUID();
  await state.storage.put(`login:${await sha256(token)}`, Date.now() + 86400_000);
  return token;
}
async function newReviewLink(env, state, path = "/wall/", id = "") {
  const destinationUrl = new URL(path, "https://burcs.dev");
  destinationUrl.searchParams.set("review", id);
  const destination = destinationUrl.href;
  if (state) return `${destination}#review=${await issueReviewToken(state)}`;
  const response = await env.WALL.get(env.WALL.idFromName("wall")).fetch("https://internal/internal/review-token", {
    method: "POST", headers: { "x-draft-key": env.DRAFT_KEY },
  });
  if (!response.ok) throw new Error("Could not create review link");
  const { token } = await response.json();
  return `${destination}#review=${token}`;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function notifyReview(state, env, what, id, path = "/wall/") {
  if (!env.REVIEW_EMAIL) return;
  const now = Date.now();
  const last = await state.storage.get("review:last-alert");
  if (last && now - last < REVIEW_ALERT_COOLDOWN_MS) return;
  try {
    const link = await newReviewLink(env, what === "comment" ? null : state, path, id);
    await env.REVIEW_EMAIL.send({
      from: "hello@burcs.dev",
      to: "brandonstrittmatter@gmail.com",
      subject: `New ${what} to review on burcs.dev`,
      text: `Someone left a ${what} for your approval. Sign in to review it: ${link}\n\nThis private link works once and expires in 24 hours.`,
    });
    await state.storage.put("review:last-alert", now);
  } catch (error) {
    console.error("Review email failed:", error);
  }
}

export class Drafts {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  isAuthor(request) {
    const key = this.env.DRAFT_KEY;
    return !!key && request.headers.get("x-draft-key") === key;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const author = this.isAuthor(request);

    if (url.pathname.endsWith("/live")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected websocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (url.pathname.endsWith("/annotations/approve")) {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      if (!author) return json({ error: "Only Brandon can approve comments." }, 403);
      return this.approveComment(url.searchParams.get("id"));
    }
    if (url.pathname.endsWith("/annotations")) {
      if (request.method === "GET" && url.searchParams.has("pending")) {
        if (!author) return json({ error: "Only Brandon can review comments." }, 403);
        return this.pendingComments();
      }
      if (request.method === "POST") return this.annotate(request, author);
      if (request.method === "DELETE") return this.unannotate(url.searchParams.get("id"), request, author);
      return json({ error: "Method not allowed." }, 405);
    }

    if (request.method === "GET") return this.read(author);
    if (request.method === "PUT") return this.write(request, author);
    return json({ error: "Method not allowed." }, 405);
  }

  async read(author) {
    const [html, entries] = await Promise.all([
      this.state.storage.get("html"),
      this.state.storage.list({ prefix: "a:", limit: MAX_ANNOTATIONS }),
    ]);
    const annotations = [...entries.values()].map(({ ownerHash, ipHash, ...a }) => a);
    return json({ html: html ?? null, annotations, author });
  }

  async pendingComments() {
    const entries = await this.state.storage.list({ prefix: "q:", limit: MAX_PENDING_COMMENTS });
    return json({ items: [...entries.values()].map(({ ownerHash, ipHash, ...comment }) => comment) });
  }

  async approveComment(id) {
    if (!id || !/^[a-z0-9-]{1,40}$/i.test(id)) return json({ error: "Bad comment." }, 400);
    const comment = await this.state.storage.get("q:" + id);
    if (!comment) return json({ error: "Comment not found." }, 404);
    const count = (await this.state.storage.list({ prefix: "a:", limit: MAX_ANNOTATIONS })).size;
    if (count >= MAX_ANNOTATIONS) return json({ error: "This post is full of comments." }, 409);
    const { ipHash, ...approved } = comment;
    await this.state.storage.put("a:" + id, approved);
    await this.state.storage.delete("q:" + id);
    this.broadcast();
    return json({ ok: true });
  }

  async write(request, author) {
    if (!author) return json({ error: "Only the author can edit this draft." }, 403);
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid request." }, 400);
    }
    const html = String(payload?.html ?? "");
    if (html.length > MAX_DRAFT) return json({ error: "That draft is too long." }, 413);
    await this.state.storage.put({ html, updated: Date.now() });
    this.broadcast();
    return json({ ok: true });
  }

  async annotate(request, author) {
    let p;
    try {
      p = await request.json();
    } catch {
      return json({ error: "Invalid request." }, 400);
    }
    // Honeypot field: humans never see it.
    if (String(p?.website || "").trim()) return json({ error: "Submission blocked." }, 400);

    const kind = ["comment", "insert", "delete"].includes(p?.kind) ? p.kind : "highlight";
    // Anyone but Brandon can only comment.
    if (!author && kind !== "comment") return json({ error: "Only comments, please." }, 403);
    const quote = String(p?.quote || "").trim();
    const prefix = String(p?.prefix || "").slice(-MAX_CONTEXT);
    const suffix = String(p?.suffix || "").slice(0, MAX_CONTEXT);
    // Typed insertions keep their spacing; comments are trimmed.
    const text = p?.kind === "insert" ? String(p?.text || "") : String(p?.text || "").trim();
    const name = author ? "Brandon" : String(p?.name || "").trim().slice(0, MAX_NAME);

    // An insertion covers no words: it sits between its prefix and suffix.
    if (kind === "insert" ? quote : !quote) return json({ error: "Bad selection." }, 400);
    if (quote.length > MAX_QUOTE) return json({ error: "Select a little less text." }, 400);
    if ((kind === "comment" || kind === "insert") && !text) return json({ error: "Write something first." }, 400);
    if (kind === "insert" && !prefix && !suffix) return json({ error: "Bad selection." }, 400);
    if (text.length > MAX_NOTE) return json({ error: `Keep it under ${MAX_NOTE} characters.` }, 400);
    if (kind !== "highlight" && !name) return json({ error: "Add your name." }, 400);
    if (!author) {
      if (/brandon|strittmatter|burcs/i.test(name.normalize("NFKC"))) {
        return json({ error: "Only Brandon can sign with that name." }, 400);
      }
      if (/https?:\/\/|www\./i.test(text + " " + name)) {
        return json({ error: "Links aren't allowed in comments." }, 400);
      }
      if (hasProfanity(text) || hasProfanity(name)) {
        return json({ error: "Let's keep it friendly — try rewording that." }, 400);
      }
      const ipKey = "ip:" + (request.headers.get("CF-Connecting-IP") || "unknown");
      const now = Date.now();
      const last = await this.state.storage.get(ipKey);
      if (last && now - last < (kind === "comment" ? NOTE_COOLDOWN_MS : HIGHLIGHT_COOLDOWN_MS)) {
        return json({ error: "Too fast — give it a moment." }, 429);
      }
      await this.state.storage.put(ipKey, now);
    }

    const prefixKey = !author && kind === "comment" ? "q:" : "a:";
    const limit = prefixKey === "q:" ? MAX_PENDING_COMMENTS : MAX_ANNOTATIONS;
    const entries = await this.state.storage.list({ prefix: prefixKey, limit });
    if (entries.size >= limit) return json({ error: "This post is full of notes for now." }, 409);
    const ipHash = prefixKey === "q:"
      ? await sha256(request.headers.get("CF-Connecting-IP") || "unknown")
      : null;
    if (ipHash && [...entries.values()].filter((item) => item.ipHash === ipHash).length >= MAX_PENDING_PER_IP) {
      return json({ error: "You have a few comments waiting for review already." }, 429);
    }

    // The creator gets a token to delete it later; only its hash is kept.
    const owner = crypto.randomUUID();
    const at = Date.now();
    const id = `${at.toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const annotation = { id, kind, quote, prefix, suffix, text, name, at };
    await this.state.storage.put(prefixKey + id, { ...annotation, ownerHash: await sha256(owner), ...(ipHash ? { ipHash } : {}) });
    if (prefixKey === "q:") {
      await notifyReview(this.state, this.env, "comment", id, `/${new URL(request.url).searchParams.get("slug").split(":")[0]}/`);
      return json({ ok: true, pending: true });
    }
    this.broadcast();
    return json({ annotation, owner });
  }

  async unannotate(id, request, author) {
    if (!id || !/^[a-z0-9-]{1,40}$/i.test(id)) return json({ error: "Bad note." }, 400);
    const approvedKey = "a:" + id;
    const pendingKey = "q:" + id;
    const stored = await this.state.storage.get(approvedKey) || await this.state.storage.get(pendingKey);
    if (!stored) return json({ ok: true });
    const owner = request.headers.get("x-owner") || "";
    if (!author && (!owner || (await sha256(owner)) !== stored.ownerHash)) {
      return json({ error: "That isn't yours to remove." }, 403);
    }
    const approved = !!(await this.state.storage.get(approvedKey));
    await this.state.storage.delete(approved ? approvedKey : pendingKey);
    if (approved) this.broadcast();
    return json({ ok: true });
  }

  broadcast() {
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send('{"t":"changed"}');
      } catch {}
    }
  }

  webSocketMessage() {}

  webSocketClose(ws, code) {
    try {
      ws.close(code, "bye");
    } catch {}
  }
}

// ---- the wall ----
// What visitors leave behind: doodles drawn on a page, and notes written on
// a blank one. Everything arrives pending and is seen by no one but Brandon
// (DRAFT_KEY) until he approves it; then doodles are drawn on the page they
// were made on, signed, and notes go up on /wall/. Keys:
//   p:<id>             pending, either kind
//   d:<page>|<id>      an approved doodle, by page
//   n:<id>             an approved note
// Ids start with the time, so listings come back oldest first.

const MAX_WALL_TEXT = 3000;
const MAX_POINTS = 12_000;
const MAX_STROKES = 600;
const MAX_PENDING = 500;
const WALL_COOLDOWN_MS = 15_000;

export class Wall {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  isAuthor(request) {
    const key = this.env.DRAFT_KEY;
    return !!key && request.headers.get("x-draft-key") === key;
  }

  async migrateDoodles() {
    await this.state.storage.transaction(async (txn) => {
      if (await txn.get("wall-only:v1")) return;
      const approved = await txn.list({ prefix: "d:" });
      const onWall = [...approved.values()].filter((item) => item.page === "/wall/" && !item.hidden);
      for (const [key, item] of approved) {
        if (item.page === "/wall/") continue;
        const moved = { ...item, page: "/wall/", h: Math.round(item.w * 11 / 8.5), dx: 0, dy: 0 };
        const spot = freeDoodleSpot(moved, onWall);
        if (spot) Object.assign(moved, spot);
        else moved.hidden = true;
        await txn.put(`d:/wall/|${item.id}`, moved);
        await txn.delete(key);
        if (!moved.hidden) onWall.push(moved);
      }
      const pending = await txn.list({ prefix: "p:" });
      for (const [key, item] of pending) {
        if (item.kind === "doodle" && item.page !== "/wall/") {
          await txn.put(key, { ...item, page: "/wall/", h: Math.round(item.w * 11 / 8.5) });
        }
      }
      await txn.put("wall-only:v1", true);
    });
  }

  async fetch(request) {
    await this.migrateDoodles();
    const url = new URL(request.url);
    const author = this.isAuthor(request);
    const id = url.searchParams.get("id") || "";
    const sheets = (await this.state.storage.get("wall:sheets")) || 1;
    if (url.pathname.endsWith("/sheets")) {
      if (request.method === "GET") return json({ sheets });
      if (request.method !== "POST" || !author) return json({ error: "Only Brandon can add wall pages." }, 403);
      if (sheets >= 100) return json({ error: "The wall has reached its page limit." }, 409);
      const next = await this.state.storage.transaction(async (txn) => {
        const count = (await txn.get("wall:sheets")) || 1;
        if (count >= 100) return null;
        await txn.put("wall:sheets", count + 1);
        return count + 1;
      });
      return next ? json({ sheets: next }) : json({ error: "The wall is full." }, 409);
    }
    if (url.pathname.endsWith("/sheet")) {
      if (request.method !== "PATCH" || !author) return json({ error: "Only Brandon can move doodles." }, 403);
      const body = await request.json().catch(() => null);
      if (!Number.isInteger(body?.sheet) || body.sheet < 1 || body.sheet > sheets) return json({ error: "Choose an existing wall page." }, 400);
      const key = `d:/wall/|${id}`;
      const item = await this.state.storage.get(key);
      if (!item) return json({ error: "Doodle not found." }, 404);
      const others = [...(await this.state.storage.list({ prefix: "d:/wall/|" })).values()]
        .filter((other) => other.id !== id && !other.hidden && (other.sheet || 1) === body.sheet);
      const moved = { ...item, sheet: body.sheet, dx: 0, dy: 0 };
      const spot = freeDoodleSpot(moved, others);
      if (!spot && !moved.hidden) return json({ error: "That page is full. Add another page first." }, 409);
      await this.state.storage.put(key, { ...moved, ...(spot || {}) });
      return json({ ok: true });
    }

    if (url.pathname === "/internal/review-token") {
      if (!author || request.method !== "POST") return json({ error: "Not allowed." }, 403);
      const token = await issueReviewToken(this.state);
      return json({ token });
    }
    if (url.pathname === "/api/review-session") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      if (request.headers.get("origin") !== url.origin) return json({ error: "Not allowed." }, 403);
      const body = await request.json().catch(() => null);
      if (typeof body?.token !== "string" || body.token.length > 100) return json({ error: "Invalid review link." }, 400);
      const key = `login:${await sha256(body.token)}`;
      const accepted = await this.state.storage.transaction(async (txn) => {
        const expires = await txn.get(key);
        await txn.delete(key);
        return expires > Date.now();
      });
      if (!accepted) return json({ error: "This link expired or was already used. Request a new one." }, 403);
      return new Response(JSON.stringify({ ok: true }), { headers: {
        "content-type": "application/json", "cache-control": "no-store",
        "set-cookie": `burcs_review=${await reviewSession(this.env)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`,
      } });
    }

    if (url.pathname.endsWith("/approve")) {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      if (!author) return json({ error: "Only Brandon can approve." }, 403);
      const targetSheet = url.searchParams.has("sheet") ? Number(url.searchParams.get("sheet")) : null;
      if (targetSheet !== null && (!Number.isInteger(targetSheet) || targetSheet < 1 || targetSheet > sheets)) return json({ error: "Choose an existing wall page." }, 400);
      return this.approve(id, targetSheet);
    }
    if (url.pathname.endsWith("/visibility") || url.pathname.endsWith("/position")) {
      if (request.method !== "PATCH") return json({ error: "Method not allowed." }, 405);
      if (!author) {
        // A forwarded request body must be closed before returning from a
        // Durable Object, including when the caller is refused.
        await request.text().catch(() => {});
        return json({ error: "Only Brandon can arrange the wall." }, 403);
      }
      const page = cleanPage(url.searchParams.get("page"));
      if (!page || !id) return json({ error: "Which doodle?" }, 400);
      return url.pathname.endsWith("/visibility")
        ? this.visibility(page, id, request)
        : this.position(page, id, request);
    }
    if (request.method === "DELETE") {
      if (!author) return json({ error: "Only Brandon can remove things." }, 403);
      return this.remove(id);
    }
    if (request.method === "POST") return this.submit(request, author);
    if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);

    if (url.searchParams.has("pending")) {
      if (!author) return json({ error: "Only Brandon can see what's waiting." }, 403);
      return json({ items: [...(await this.state.storage.list({ prefix: "p:" })).values()] });
    }
    if (url.searchParams.has("approved")) {
      if (!author) return json({ error: "Only Brandon can arrange the wall." }, 403);
      return json({ items: [...(await this.state.storage.list({ prefix: "d:" })).values()], sheets });
    }
    if (url.searchParams.has("notes")) {
      return json({ items: [...(await this.state.storage.list({ prefix: "n:" })).values()], author, sheets });
    }
    const page = cleanPage(url.searchParams.get("page"));
    if (!page) return json({ error: "Which page?" }, 400);
    if (page !== "/wall/") return json({ items: [], author });
    const sheet = Number(url.searchParams.get("sheet")) || 1;
    const items = [...(await this.state.storage.list({ prefix: `d:${page}|` })).values()].filter((item) => (item.sheet || 1) === sheet);
    return json({ items: author ? items : items.filter((item) => !item.hidden), author });
  }

  async submit(request, author) {
    let p;
    try {
      p = await request.json();
    } catch {
      return json({ error: "Invalid request." }, 400);
    }
    const kind = p?.kind === "note" ? "note" : p?.kind === "doodle" ? "doodle" : null;
    if (!kind) return json({ error: "Invalid request." }, 400);
    const name = String(p?.name ?? "").trim().slice(0, MAX_NAME);
    // Everyone signs what they leave, except Brandon on his own wall.
    if (!name && !author) return json({ error: "Sign it first." }, 400);

    const item = { kind, name, created: Date.now() };
    if (kind === "note") {
      const text = String(p?.text ?? "").replace(/\r\n?/g, "\n").trim();
      if (!text) return json({ error: "Write something first." }, 400);
      if (text.length > MAX_WALL_TEXT) return json({ error: "That's a bit long for the wall." }, 413);
      item.text = text;
    } else {
      if (p.page !== "/wall/") return json({ error: "Doodles belong on the wall. Draw at burcs.dev/wall/." }, 400);
      const doodle = cleanDoodle(p);
      if (!doodle) return json({ error: "That doodle didn't come through." }, 400);
      Object.assign(item, doodle);
      item.sheet = p.sheet ?? 1;
      const sheets = (await this.state.storage.get("wall:sheets")) || 1;
      if (!Number.isInteger(item.sheet) || item.sheet < 1 || item.sheet > sheets) return json({ error: "Choose an existing wall page." }, 400);
    }
    if (!author && hasProfanity(`${name}\n${item.text ?? ""}`)) {
      return json({ error: "Let's keep it friendly." }, 400);
    }

    // One pin every few seconds per visitor, and a cap on the backlog.
    if (!author) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rk = `rl:${await sha256(ip)}`;
      const last = await this.state.storage.get(rk);
      if (last && Date.now() - last < WALL_COOLDOWN_MS) return json({ error: "One at a time — try again in a moment." }, 429);
      await this.state.storage.put(rk, Date.now());
    }
    const pending = await this.state.storage.list({ prefix: "p:", limit: MAX_PENDING + 1 });
    if (pending.size >= MAX_PENDING) return json({ error: "The wall is full for now." }, 503);

    item.id = Date.now().toString(36) + crypto.randomUUID().slice(0, 6);
    await this.state.storage.put(`p:${item.id}`, item);
    if (!author) await notifyReview(this.state, this.env, kind, item.id, kind === "doodle" ? `/wall/?sheet=${item.sheet}` : "/wall/");
    return json({ ok: true, id: item.id });
  }

  async approve(id, targetSheet = null) {
    const item = await this.state.storage.get(`p:${id}`);
    if (!item) return json({ error: "Not found." }, 404);
    // Earlier submissions may name the homepage or projects; approval now
    // puts those drawings on the wall too, without changing their strokes.
    if (item.kind === "doodle") {
      item.page = "/wall/";
      if (targetSheet !== null) item.sheet = targetSheet;
    }
    const key = item.kind === "note" ? `n:${id}` : `d:${item.page}|${id}`;
    if (item.kind === "doodle") {
      const others = [...(await this.state.storage.list({ prefix: `d:${item.page}|` })).values()]
        .filter((other) => !other.hidden && (other.sheet || 1) === (item.sheet || 1));
      const spot = freeDoodleSpot(item, others);
      if (!spot) return json({ error: "There isn't room for this doodle yet. Move another one first." }, 409);
      Object.assign(item, spot);
    }
    await this.state.storage.put(key, { ...item, approved: Date.now() });
    await this.state.storage.delete(`p:${id}`);
    return json({ ok: true });
  }

  async visibility(page, id, request) {
    const key = `d:${page}|${id}`;
    const item = await this.state.storage.get(key);
    if (!item) return json({ error: "Not found." }, 404);
    const body = await request.json().catch(() => null);
    if (typeof body?.hidden !== "boolean") return json({ error: "Choose whether to show the doodle." }, 400);
    if (!body.hidden) {
      const others = [...(await this.state.storage.list({ prefix: `d:${page}|` })).values()]
        .filter((other) => other.id !== id && !other.hidden && (other.sheet || 1) === (item.sheet || 1));
      if (others.some((other) => doodlesOverlap(item, other))) {
        return json({ error: "Move another doodle before showing this one." }, 409);
      }
    }
    await this.state.storage.put(key, { ...item, hidden: body.hidden });
    return json({ ok: true });
  }

  async position(page, id, request) {
    const key = `d:${page}|${id}`;
    const item = await this.state.storage.get(key);
    if (!item) return json({ error: "Not found." }, 404);
    const body = await request.json().catch(() => null);
    const dx = body?.dx, dy = body?.dy;
    if (typeof dx !== "number" || typeof dy !== "number" || !Number.isFinite(dx) || !Number.isFinite(dy)) {
      return json({ error: "Invalid position." }, 400);
    }
    const moved = { ...item, dx: Math.round(dx * 2) / 2, dy: Math.round(dy * 2) / 2 };
    if (!doodleFits(moved)) return json({ error: "Keep the doodle on the page." }, 400);
    const others = [...(await this.state.storage.list({ prefix: `d:${page}|` })).values()]
      .filter((other) => other.id !== id && !other.hidden && (other.sheet || 1) === (item.sheet || 1));
    if (!item.hidden && others.some((other) => doodlesOverlap(moved, other))) {
      return json({ error: "That would overlap another doodle." }, 409);
    }
    await this.state.storage.put(key, moved);
    return json({ ok: true, dx: moved.dx, dy: moved.dy });
  }

  async remove(id) {
    if (!id) return json({ error: "Not found." }, 404);
    const keys = [`p:${id}`, `n:${id}`];
    for (const [k] of await this.state.storage.list({ prefix: "d:" })) if (k.endsWith(`|${id}`)) keys.push(k);
    await this.state.storage.delete(keys);
    return json({ ok: true });
  }
}

function cleanPage(page) {
  const p = String(page ?? "");
  return /^\/[a-z0-9\-/]{0,120}$/i.test(p) ? p : null;
}

// A doodle: the page it was drawn on, the sheet's size then (CSS px), and
// its strokes, each a flat run of x, y, pressure.
function cleanDoodle(p) {
  const page = cleanPage(p?.page);
  const w = Number(p?.w);
  const h = Number(p?.h);
  if (!page || !(w > 100 && w < 4000) || !(h > 100 && h < 40000)) return null;
  if (!Array.isArray(p?.strokes) || !p.strokes.length || p.strokes.length > MAX_STROKES) return null;
  let points = 0;
  const strokes = [];
  for (const s of p.strokes) {
    if (!Array.isArray(s) || s.length < 3 || s.length % 3) return null;
    points += s.length / 3;
    if (points > MAX_POINTS) return null;
    const out = [];
    for (let i = 0; i < s.length; i += 3) {
      const x = Number(s[i]);
      const y = Number(s[i + 1]);
      const z = Number(s[i + 2]);
      if (!(x > -20 && x < w + 20 && y > -20 && y < h + 20 && z >= 0 && z <= 1)) return null;
      out.push(Math.round(x * 2) / 2, Math.round(y * 2) / 2, Math.round(z * 100) / 100);
    }
    strokes.push(out);
  }
  return { page, w: Math.round(w), h: Math.round(h), strokes };
}

function doodleBounds(item, width = item.w) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const stroke of item.strokes) {
    for (let i = 0; i < stroke.length; i += 3) {
      x0 = Math.min(x0, stroke[i]);
      y0 = Math.min(y0, stroke[i + 1]);
      x1 = Math.max(x1, stroke[i]);
      y1 = Math.max(y1, stroke[i + 1]);
    }
  }
  const dx = item.dx || 0, dy = item.dy || 0;
  const k = width / item.w;
  return { x0: (x0 + dx) * k, y0: (y0 + dy) * k, x1: (x1 + dx) * k, y1: (y1 + dy) * k };
}

function doodleFits(item) {
  const b = doodleBounds(item);
  return b.x0 >= 4 && b.y0 >= 4 && b.x1 <= item.w - 4 && b.y1 <= item.h - 4;
}

function boxesOverlap(a, b) {
  const gap = 10;
  return a.x0 < b.x1 + gap && a.x1 + gap > b.x0 && a.y0 < b.y1 + gap && a.y1 + gap > b.y0;
}

function doodlesOverlap(a, b) {
  return boxesOverlap(doodleBounds(a), doodleBounds(b, a.w));
}

// Keep newly approved drawings clear of the ones already on the sheet.
function freeDoodleSpot(item, others) {
  const box = doodleBounds(item);
  const occupied = others.map((other) => doodleBounds(other, item.w));
  const fits = (dx, dy) => {
    const b = { x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy };
    return b.x0 >= 4 && b.y0 >= 4 && b.x1 <= item.w - 4 && b.y1 <= item.h - 4 &&
      occupied.every((other) => !boxesOverlap(b, other));
  };
  // A free rectangle can be slid against a page edge or another drawing.
  // Try those positions instead of scanning every pixel of a long article.
  const gap = 10;
  const xs = new Set([0, 4 - box.x0, item.w - 4 - box.x1]);
  const ys = new Set([0, 4 - box.y0, item.h - 4 - box.y1]);
  for (const other of occupied) {
    xs.add(other.x0 - gap - box.x1);
    xs.add(other.x1 + gap - box.x0);
    ys.add(other.y0 - gap - box.y1);
    ys.add(other.y1 + gap - box.y0);
  }
  const spots = [];
  for (const dx of xs) for (const dy of ys) spots.push({ dx, dy });
  spots.sort((a, b) => a.dx ** 2 + a.dy ** 2 - b.dx ** 2 - b.dy ** 2);
  for (const { dx, dy } of spots) {
    if (fits(dx, dy)) return { dx, dy };
  }
  return null;
}
