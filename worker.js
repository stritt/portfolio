const POST_SLUG = "cloudflares-all-that";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/comments") {
      const id = env.COMMENTS.idFromName(POST_SLUG);
      return env.COMMENTS.get(id).fetch(request);
    }

    if (url.pathname === "/") {
      url.pathname = "/index.html";
    }

    // The Cloudflare starter checklist, served at a clean extensionless path as
    // well as its real filename. Markdown has no browser renderer, so the
    // charset matters — without it the em dashes and arrows in the text come
    // through as mojibake.
    if (url.pathname === "/cloudflare-starter") {
      url.pathname = "/cloudflare-starter.md";
      const asset = await env.ASSETS.fetch(new Request(url.toString(), request));
      const headers = new Headers(asset.headers);
      headers.set("content-type", "text/markdown; charset=utf-8");
      return new Response(asset.body, { status: asset.status, headers });
    }

    return env.ASSETS.fetch(new Request(url.toString(), request));
  },
};

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
