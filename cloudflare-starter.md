# The Cloudflare Starter Checklist

*From idea to a shipped, monetized, agent-friendly product, entirely on
Cloudflare. Written so an AI agent (or a human) can execute it top to bottom.
Each phase has exact commands, config, and a check to confirm it worked. Every
gotcha listed here happened in a real production build. Skip phases you don't
need, but read their gotchas anyway.*

---

## Phase 0 - Name and domain

- [ ] Search and register in one place: Cloudflare dashboard -> **Domain
      Registration -> Register Domains**. The search is fast, shows real
      at-cost prices, and registering there puts the zone in the same account
      as everything else you're about to build. No DNS setup later.
- [ ] Scripted availability check (useful for agents comparing many names):
      registry RDAP returns 404 for unregistered domains:
      `curl -so /dev/null -w "%{http_code}" https://rdap.org/domain/NAME.dev`
- [ ] You can build and ship on `NAME.workers.dev` first. The domain attaches
      later with zero migration (Phase 5).

## Phase 1 - Scaffold: one Worker + static assets, zero dependencies

The strongest starter shape: **one `.mjs` file that is both a local CLI and
the Worker**, plus static files served from the same deploy. No framework, no
build step, no npm.

- [ ] `wrangler.jsonc` skeleton:

```jsonc
{
  "name": "myapp",
  "main": "worker.mjs",
  "account_id": "YOUR_ACCOUNT_ID",
  "compatibility_date": "2026-08-01",
  "compatibility_flags": ["nodejs_compat"], // lets the file import node:fs when run as a CLI

  "assets": {
    "directory": ".",
    "binding": "ASSETS",
    // paths the Worker must handle even when a file with that name exists
    "run_worker_first": ["/", "/api/*"]
  }
}
```

- [ ] Create `.assetsignore` immediately. The assets directory is **served
      publicly**, so exclude source, configs, tests, and docs:
      `worker.mjs`, `wrangler.jsonc`, `.assetsignore`, `.git`, `.gitignore`,
      `README.md`, `test`, `node_modules`, `__pycache__`.
- [ ] Dual-mode entry (Worker export + CLI guard in the same file):

```js
export default {
  async fetch(req, env, ctx) { /* routes */ },
  async scheduled(event, env, ctx) { /* cron */ },
};
if (globalThis.process?.release?.name === "node" &&
    process.argv[1]?.endsWith("worker.mjs")) (async () => {
  const fs = await import("node:" + "fs/promises"); // non-literal so the bundler skips it
  /* CLI work */
})().catch(e => { console.error(e); process.exit(1); });
```

Gotchas: no top-level `await` outside that guarded block (the bundler rejects
it). Assets serve `page.html` at `/page` and 307-redirect `/page.html`, so
your `/` route should fetch the extensionless name through the ASSETS binding.

- [ ] `npx wrangler deploy`. Check: the workers.dev URL serves.
- [ ] `git init` and push now, before the project grows. Keep secrets and
      account IDs out of the repo: gitignore the real `wrangler.jsonc`, commit
      a `wrangler.example.jsonc` with placeholders.

## Phase 2 - State and schedules: KV + cron triggers

- [ ] `npx wrangler kv namespace create DATA`, then add to config:

```jsonc
{
  "kv_namespaces": [{ "binding": "DATA", "id": "PASTE_ID" }],
  "triggers": { "crons": ["*/5 * * * *"] }
}
```

- [ ] For tiered schedules (light work often, heavy work sometimes), run one
      cron and branch on the minute:
      `const fullRun = new Date(event.scheduledTime).getUTCMinutes() % 15 === 0;`
- [ ] Wrap scheduled work in `ctx.waitUntil(...)`.
- [ ] Seed or inspect KV from the CLI:
      `npx wrangler kv key put data --path data.json --namespace-id ID --remote`

Gotchas (both real): KV is **eventually consistent** - reads elsewhere can lag
a write by up to a minute, so don't debug a fresh write too early. And a cron
that is mid-run during a deploy finishes on the old code and can overwrite
keys you just seeded. Make writes idempotent so the next tick self-heals.

## Phase 3 - Caching that is fast AND live (Workers Cache)

- [ ] Enable it: `"cache": { "enabled": true }`. Note: once on, static-asset
      requests are billed at the normal request rate.
- [ ] Split browser and edge lifetimes. This is the fix for "users need a
      hard refresh":
      `cache-control: public, max-age=60, s-maxage=600, stale-while-revalidate=300`
      (browser 60s, edge 10 min).
- [ ] Tag cacheable responses (`cache-tag: mydata`) and purge from the code
      that writes new data: `await ctx.cache?.purge({ tags: ["mydata"] })`.
      This works inside scheduled handlers.
- [ ] Purge **only when the data actually changed** (compare with the previous
      value). Purging on every quiet tick evicts warm entries for nothing and
      ruins your hit rate.

Check: `curl -sD - -o /dev/null URL | grep cf-cache-status` shows MISS then
HIT, and fresh content appears within ~30s of a producer write.

## Phase 4 - Browser Rendering (JS-only pages, screenshots)

- [ ] Use the **REST API**, not the puppeteer binding: same product, plain
      `fetch`, zero npm, and identical code locally and deployed.
      `POST https://api.cloudflare.com/client/v4/accounts/{acct}/browser-rendering/content`
      with body
      `{"url": "...", "gotoOptions": {"waitUntil": "load", "timeout": 45000}, "waitForTimeout": 4000}`
      and `Authorization: Bearer TOKEN` (token permission: Browser Rendering Edit).
- [ ] Use `waitUntil: "load"` plus a settle delay. `networkidle0` hangs
      forever on pages with long-polling analytics.
- [ ] Renders are metered minutes. Cache results for hours; never render per
      request.
- [ ] Free trick: the `/screenshot` endpoint pointed at your own homepage at
      1200x630 is a live `og:image`. Refresh it daily from the cron into KV.

Gotchas: bot-walled sites block Cloudflare's rendering IPs - including some
sites that are themselves behind Cloudflare - so test each target before
promising coverage. For local dev, wrangler's OAuth token can call this API.

## Phase 5 - Custom domain

- [ ] Add to config and deploy:

```jsonc
{
  "routes": [
    { "pattern": "myapp.dev", "custom_domain": true },
    { "pattern": "www.myapp.dev", "custom_domain": true }
  ]
}
```

Certificates provision in about a minute; workers.dev keeps working as a
fallback. Check: `curl -s -o /dev/null -w "%{http_code}" https://myapp.dev/`
returns 200.

## Phase 6 - SEO and Search Console

- [ ] Head basics: unique `<title>`, meta description, `rel=canonical`, a
      favicon (SVG works), OG and `twitter:card` tags, `og:image` (Phase 4).
- [ ] JSON-LD for your content type: `Dataset` for data products, `Product`
      with `AggregateOffer` for priced listings, `FAQPage`, `BreadcrumbList`.
      Escape `<` inside the script tag.
- [ ] If your app renders client-side, remember: **AI crawlers do not run
      JavaScript** (Googlebot does). Serve a plain-HTML page per entity from
      the same data, each with its own title, description, and schema. Return
      real 404s for unknown slugs. Link hub-and-spoke: homepage -> index
      pages -> detail pages. Keep the homepage itself clean; a compact link
      strip plus hub pages beats a wall of links.
- [ ] Serve `robots.txt` (welcome AI crawlers by name if that fits your
      strategy) and a generated `sitemap.xml` from the Worker.
- [ ] Google Search Console: verify as a *Domain property* via a DNS TXT
      record - your DNS is already in Cloudflare, so this takes two minutes.
      Skip Google's OAuth shortcut (it grants standing DNS access). Submit
      the sitemap. Repeat in Bing Webmaster Tools.

## Phase 7 - The agent surface (agents are users now)

- [ ] Serve **`/llms.txt`**: what the site is, every data endpoint with field
      docs, and your terms. Agents follow clearly stated terms surprisingly
      well; put attribution requirements here.
- [ ] JSON endpoints: `access-control-allow-origin: *`, stable field names,
      and a `source` + `terms` field inside the payload itself, so the
      attribution survives copying.
- [ ] **MCP server** on the same Worker. A stateless streamable-HTTP JSON-RPC
      handler is about 100 lines with no dependencies: handle `initialize`,
      `ping`, `tools/list`, `tools/call`; return 202 for notifications
      (messages without an `id`); add CORS for POST and OPTIONS. Tools are
      typed views over data you already serve. Document it in llms.txt.
- [ ] Bake attribution into the data itself (for example `?ref=` params on
      URLs you publish) instead of hoping consumers preserve credit.

## Phase 8 - Analytics

- [ ] **Workers Analytics Engine** for product analytics (page views, clicks,
      feature usage). Full agent-executable guide in the companion file
      `agents.md`: dataset binding, a `/t` beacon endpoint with an event
      allowlist, a `sendBeacon` client, and the one query rule - always
      `SUM(_sample_interval)`, never `COUNT(*)`.
- [ ] Free zone dashboards: **HTTP Traffic** (volume by country) and **AI
      Crawl Control** - which AI bots (GPTBot, ClaudeBot, PerplexityBot...)
      are reading you. Check it in week one; bots usually arrive before
      humans.
- [ ] Remember: requests served from the edge cache never reach the Worker,
      so server-side counters undercount. Client beacons are exact.

## Phase 9 - Secrets and key hygiene

- [ ] Every sensitive value goes in `npx wrangler secret put NAME`, never in
      committed config. New secrets do not require a redeploy.
- [ ] Third-party keys: least privilege always. Stripe restricted keys
      (`rk_`), Google Cloud keys restricted to one API, Cloudflare tokens
      scoped to one product.
- [ ] If you sell your own API: keys are KV entries
      (`apikey:<random-32-hex>` -> metadata JSON) checked per request. Make
      the 401 body sell: link the free tier and the signup page.

## Phase 10 - Monetization (self-serve, no dependencies)

- [ ] **Stripe Payment Links**: hosted checkout, so card data never touches
      your Worker. Create product, price, and link via the API. Set the
      link's `after_completion.redirect.url` to
      `https://myapp.dev/key?session_id={CHECKOUT_SESSION_ID}`.
- [ ] `/key` route: verify the session with
      `GET /v1/checkout/sessions/:id` (`payment_status === "paid"`), mint a
      key into KV **idempotently per session** (store session -> key), index
      customer -> key, and show the key on a bookmarkable page.
- [ ] `/stripe-webhook`: verify the `stripe-signature` header with WebCrypto
      HMAC-SHA256 over `t + "." + body`. On `customer.subscription.deleted`
      or `invoice.payment_failed`, delete that customer's key. Revocation is
      now automatic; the whole lifecycle runs with no human.
- [ ] Referral links for anything you already link out to: join the
      programs and bake the links into your data. This is how comparison and
      content sites actually get paid.

Gotchas: dormant Stripe accounts show "capabilities paused" until a
re-verification task is completed - check the dashboard banner before going
live. Wire test mode first, then swap the link and secrets. Verify the flow
with an *unpaid* checkout session (it exercises the "not confirmed" path)
instead of typing card numbers.

## Phase 11 - Tests, CI, and ops

- [ ] Anything that parses external content **will break eventually**. Record
      real responses as gzipped fixtures, replay them offline through the
      real code path (override `globalThis.fetch`), and fail on zero rows,
      halved rows, or insane values. Redact credentials from fixture cache
      keys.
- [ ] GitHub Actions: syntax check plus fixture replay on every push. Runs in
      seconds and needs no secrets.
- [ ] Failure design: when an upstream fetch fails, serve the last good data
      *marked stale* - never silently stale, never silently missing. Alert
      only after something has been broken 24h+ (webhook to Slack, Discord,
      or ntfy.sh - ntfy needs no account and pushes to a phone).
- [ ] Before every push, scan the diff for any secret that passed through the
      session.

## Phase 12 - Launch day

- [ ] OG image renders in a link preview; title and description read well.
- [ ] `robots.txt`, `sitemap.xml`, `llms.txt`, and the main JSON endpoints
      all return 200.
- [ ] Search Console and Bing verified, sitemaps submitted.
- [ ] Analytics beacons confirmed firing before the traffic arrives.
- [ ] Post where your users are and stay for the first two hours of comments.
      Answer questions with shareable deep links into the product.
- [ ] Watch AI Crawl Control during week one.

---

*Total platform bill for all of the above at hobby scale: the $5/mo Workers
Paid plan plus an at-cost domain. Every phase is independently removable, and
none of it needs a framework, a build step, or a single npm package.*
