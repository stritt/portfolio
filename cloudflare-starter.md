# The Cloudflare Starter Checklist

*From idea to shipped, monetized, agent-friendly product — entirely on
Cloudflare. Written for AI agents (and humans) to execute top to bottom: each
phase has exact commands, config, and an acceptance check. Every gotcha noted
here was hit for real in production. Skip phases that don't apply, but read
their gotchas anyway.*

---

## Phase 0 — Name and domain

- [ ] Check name availability without a registrar's upsell page: registry RDAP
      returns 404 for unregistered domains:
      `curl -so /dev/null -w "%{http_code}" https://rdap.org/domain/NAME.dev`
      (404 = available).
- [ ] Register through **Cloudflare Registrar** (at-cost pricing, and the zone
      lands in the same account as everything else — no DNS plumbing later).
- [ ] You can build and ship on `NAME.workers.dev` first; the domain can attach
      later with zero migration (Phase 5).

## Phase 1 — Scaffold: one Worker + static assets, zero dependencies

The strongest starter shape: **one `.mjs` file that is both a local CLI and
the Worker**, plus static assets served from the same deploy. No framework, no
build step, no npm.

- [ ] `wrangler.toml` skeleton:

```toml
name = "myapp"
main = "worker.mjs"
account_id = "YOUR_ACCOUNT_ID"
compatibility_date = "2026-08-01"
compatibility_flags = ["nodejs_compat"]   # lets the file import node:fs when run as a CLI

[assets]
directory = "."
binding = "ASSETS"
run_worker_first = ["/", "/api/*"]  # paths the Worker must handle even if an asset matches
```

- [ ] Create `.assetsignore` immediately — the assets directory is **served
      publicly**; exclude source, configs, tests, docs:
      `worker.mjs`, `wrangler.toml`, `.assetsignore`, `.git`, `.gitignore`,
      `README.md`, `test`, `node_modules`, `__pycache__`.
- [ ] Dual-mode entry pattern (worker export + CLI guard):

```js
export default {
  async fetch(req, env, ctx) { /* routes */ },
  async scheduled(event, env, ctx) { /* cron */ },
};
if (globalThis.process?.release?.name === "node" &&
    process.argv[1]?.endsWith("worker.mjs")) (async () => {
  const fs = await import("node:" + "fs/promises"); // non-literal: bundler skips it
  /* CLI work */
})().catch(e => { console.error(e); process.exit(1); });
```

**Gotchas:** no top-level `await` outside the guarded IIFE (bundler chokes);
assets serve `.html` files *extensionless* and 307-redirect the `.html` path —
have `/` fetch the extensionless name via the ASSETS binding.

- [ ] `npx wrangler deploy` → **Acceptance:** the workers.dev URL serves.
- [ ] `git init` + push to a repo **before** the project grows. Scrub secrets
      and account IDs from committed config (gitignore the real
      `wrangler.toml`, commit a `wrangler.example.jsonc` with placeholders).

## Phase 2 — State and schedules: KV + cron triggers

- [ ] `npx wrangler kv namespace create DATA` → paste the id into config.
- [ ] Crons: `[triggers] crons = ["*/5 * * * *"]`. For tiered work, run one
      cron and branch on the minute:
      `const fullRun = new Date(event.scheduledTime).getUTCMinutes() % 15 === 0;`
- [ ] Wrap scheduled work in `ctx.waitUntil(...)`.
- [ ] Seed/read KV from the CLI:
      `npx wrangler kv key put data --path data.json --namespace-id ID --remote`

**Gotchas (both hit in production):** KV is **eventually consistent** — reads
elsewhere can lag writes by ~60s; don't panic-debug a fresh write. And a cron
**in flight during a deploy** finishes on the old code and can overwrite your
freshly seeded keys — design writes to be idempotent and self-healing on the
next tick, then don't fight it.

## Phase 3 — Caching that is both fast AND live (Workers Cache)

- [ ] Enable: `[cache] enabled = true` (note: static-asset requests become
      billable at the standard request rate once on).
- [ ] Split browser vs edge TTLs — this prevents the "users need hard
      refreshes" bug: `cache-control: public, max-age=60, s-maxage=600,
      stale-while-revalidate=300` (browser 60s, edge 10min).
- [ ] Tag responses (`cache-tag: mydata`) and purge from the producer the
      moment content changes: `await ctx.cache?.purge({ tags: ["mydata"] })`
      — works from scheduled handlers.
- [ ] Purge **only when content actually changed** (compare against previous),
      or every quiet tick evicts warm entries and your hit rate dies.

**Acceptance:** `curl -sD - -o /dev/null URL | grep cf-cache-status` → MISS
then HIT; after a producer write, a fresh value within ~30s.

## Phase 4 — Browser Rendering (JS-rendered pages, screenshots)

- [ ] Prefer the **REST API** over the puppeteer binding: same product, plain
      `fetch`, zero npm, identical code local and deployed.
      `POST https://api.cloudflare.com/client/v4/accounts/{acct}/browser-rendering/content`
      body `{"url": "...", "gotoOptions": {"waitUntil": "load", "timeout": 45000}, "waitForTimeout": 4000}`
      with `Authorization: Bearer <token with Browser Rendering: Edit>`.
- [ ] Use `waitUntil: "load"` + a settle delay — `networkidle0` hangs forever
      on pages with analytics long-polling.
- [ ] Renders are metered minutes: cache results (hours-long TTL), don't
      re-render on every request.
- [ ] Free trick: `/screenshot` of your own homepage at 1200×630 = a live
      `og:image`; refresh it daily from the cron into KV.

**Gotchas:** bot-walled sites block Cloudflare's egress IPs — including
Cloudflare-protected sites (yes, really); test each target before promising
coverage. Locally, `wrangler`'s OAuth token can call the REST API for dev.

## Phase 5 — Custom domain

- [ ] In `wrangler.toml`:
      `routes = [{ pattern = "myapp.dev", custom_domain = true }, { pattern = "www.myapp.dev", custom_domain = true }]`
      then `npx wrangler deploy`. Certs provision in ~a minute; workers.dev
      keeps working as a fallback.
- [ ] **Acceptance:** `curl -s -o /dev/null -w "%{http_code}" https://myapp.dev/` → 200.

## Phase 6 — SEO and Search Console

- [ ] Head basics: unique `<title>`, meta description, `rel=canonical`,
      favicon (SVG is fine), OG + `twitter:card` tags, `og:image` (Phase 4).
- [ ] JSON-LD: pick the type that fits (`Dataset` for data products, `Product`
      + `AggregateOffer` for priced listings, `FAQPage`, `BreadcrumbList`).
      Escape `<` as `<` inside the script tag.
- [ ] If your app is client-rendered, know that **AI crawlers don't run JS**
      (Googlebot does). Server-render a plain-HTML page layer from your data
      (one page per entity), give each unique title/description/schema, real
      404s for unknown slugs, and link them hub-and-spoke: homepage → index
      pages → leaves. Don't wall the homepage with links; a compact strip plus
      hub pages is better SEO *and* better design.
- [ ] Serve `robots.txt` (welcome AI crawlers by name if that's your strategy)
      and a generated `sitemap.xml` from the Worker.
- [ ] **Search Console:** verify as a *Domain property* via DNS TXT (your DNS
      is already in Cloudflare — 2 minutes; skip Google's OAuth shortcut, it
      grants standing DNS access). Submit the sitemap. Do the same in Bing
      Webmaster Tools (feeds other engines and some AI browsing).

## Phase 7 — The agent surface (this is 2026; agents are users)

- [ ] **`/llms.txt`**: what the site is, every data endpoint with field docs,
      terms/attribution. Agents actually honor clearly stated terms; put your
      attribution requirement here.
- [ ] JSON endpoints: `access-control-allow-origin: *`, stable field names,
      a `source` + `terms` field inside the payload itself (survives copying).
- [ ] **MCP server** on the same Worker — a stateless streamable-HTTP JSON-RPC
      handler is ~100 lines with zero deps: answer `initialize`, `ping`,
      `tools/list`, `tools/call`; return 202 for notifications (no `id`);
      CORS on POST/OPTIONS. Tools = typed views over the data you already
      serve. Document it in llms.txt.
- [ ] Bake attribution into the data (e.g. `?ref=` params inside URLs you
      publish) rather than relying on consumers' goodwill.

## Phase 8 — Analytics

- [ ] **Workers Analytics Engine** for product analytics (events, clicks,
      feature usage): see the companion guide `agents.md` — binding, `/t`
      beacon endpoint with an event allowlist, `sendBeacon` client, and the
      `SUM(_sample_interval)` query rule.
- [ ] Zone dashboards you get for free: **HTTP Traffic** (per-country
      volumes), and **AI Crawl Control** — which AI bots (GPTBot, ClaudeBot,
      PerplexityBot…) are reading you, per day. Check it post-launch; it's
      the earliest signal your agent surface is working.
- [ ] Remember: edge-cache hits never reach the Worker — server-side counters
      undercount; client beacons are exact.

## Phase 9 — Secrets and key hygiene

- [ ] Everything sensitive goes in `npx wrangler secret put NAME` — never in
      committed config. Redeploy is not needed for new secrets.
- [ ] Third-party keys: always **least privilege** — restricted API keys
      (Stripe `rk_`), single-API keys (Google Cloud key restricted to one
      API), scoped tokens (Cloudflare token with only Browser Rendering).
- [ ] If you expose your own paid API: keys as KV entries
      (`apikey:<random-32-hex>` → metadata JSON), checked per request; 401
      body should *sell* (link the free tier and the signup).

## Phase 10 — Monetization (self-serve, no dependencies)

- [ ] **Stripe Payment Links** — hosted checkout, card data never touches your
      Worker. Create product/price/link via API; set the link's
      `after_completion.redirect.url` to
      `https://myapp.dev/key?session_id={CHECKOUT_SESSION_ID}`.
- [ ] `/key` route: verify the session
      (`GET /v1/checkout/sessions/:id`, `payment_status === "paid"`), mint a
      key into KV **idempotently per session** (store `session→key`), index
      `customer→key`, display on a bookmarkable page.
- [ ] `/stripe-webhook`: verify `stripe-signature` with WebCrypto HMAC-SHA256
      over `` `${t}.${body}` ``; on `customer.subscription.deleted` /
      `invoice.payment_failed`, delete the customer's key. That's automatic
      revocation — the whole lifecycle runs with no human.
- [ ] Referral/affiliate links for anything you link out to: it's how
      comparison and content sites actually monetize; join the programs and
      bake the links into your data.

**Gotchas:** old Stripe accounts get "capabilities paused" until a re-verification
task is done — check the dashboard banner before wiring live. Test mode first,
then swap link + secrets. Verify the flow with an *unpaid* session (shows the
"not confirmed" path) rather than typing card numbers.

## Phase 11 — Tests, CI, and ops

- [ ] Anything that parses external content **will rot**. Record real
      responses as gzipped fixtures; replay them offline in tests through the
      real code path (override `globalThis.fetch`); fail on zero/halved
      output or insane values. Redact credentials from fixture cache keys.
- [ ] GitHub Actions: syntax check + fixture replay on every push — runs in
      seconds, no secrets in CI.
- [ ] Failure design: on a failed upstream fetch, serve the last good data
      *marked stale* (never silently stale, never silently missing), and
      alert only when something has been broken for 24h+ (webhook to
      Slack/Discord/ntfy.sh — ntfy needs no account and pushes to a phone).
- [ ] Scan anything you commit for the session's secrets before pushing.

## Phase 12 — Launch-day list

- [ ] OG image renders in a card preview; title/description read well.
- [ ] `robots.txt`, `sitemap.xml`, `llms.txt`, main JSON endpoints all 200.
- [ ] Search Console + Bing verified, sitemaps submitted.
- [ ] Analytics beacons firing (check before traffic arrives, not after).
- [ ] Post where your users are; be present for the first two hours of
      comments; answer questions with shareable deep links into your product.
- [ ] Watch AI Crawl Control that first week — the bots arrive before the
      humans do.

---

*Total platform bill for everything above at hobby scale: the $5/mo Workers
Paid plan plus the at-cost domain. Every phase is independently removable;
none of it requires a framework, a build step, or a single npm package.*
