# Overworking your workers

A team recently [migrated a large Next.js app to Cloudflare Workers](https://tech.hello.ai/entry/vercel-cloudflare-migration) using OpenNext and ran into something very normal: `@sentry/nextjs` pulls in a ~5MB wasm file, Workers have a 10MB per-script limit, and suddenly your deploy fails. Their workaround was dropping Sentry from the bundle entirely, which works if you can live without it, but it stuck with me because sometimes you can’t drop the dependency. Prisma is big. Some validation stacks are big. Data SDKs are big. Sometimes “just make the bundle smaller” isn’t real advice.

My first instinct was the obvious one: shove big assets into KV or R2 and lazy load them. That works for some wasm cases, but falls apart quickly for normal JS libraries or anything that expects to live in a real runtime. Then I remembered Service Bindings exist, and every Worker gets its own script budget. Workers can call each other directly with RPC, and when they’re warm and colocated, those calls are fast enough that you can treat another Worker like a compute extension instead of a network hop.

That’s where [overwork](https://github.com/ygwyg/overwork) came from.

overwork is a CLI that splits oversized Workers into multiple Workers connected with Service Bindings. Instead of shrinking the dependency, it moves it into another Worker and generates the glue so your code can call it like it’s local.

Before:
```js
const formatted = format(sql, { language: "postgresql" });
```

After:
```js
const formatted = await format(sql, { language: "postgresql" });
```
Imports stay the same. The main change is that heavy dependency calls become async.

Under the hood, overwork uses an esbuild plugin to intercept imports and replace them with proxy stubs. The proxy records property chains, so something like `faker.person.fullName()` turns into one RPC call to a service Worker that actually holds the dependency.

I pushed a demo splitting three npm packages across four Workers just to see how it behaved. The main Worker dropped to basically nothing, and each dependency lived comfortably under the limit.

![worker split demo](assets/worker-split.mp4)

### what actually works

Some libraries just work. Pure functions, flat APIs, serializable inputs and outputs. sql-formatter, date-fns, lodash-es, zod, marked — most of these were basically drop-in, add await, done.

Some libraries mostly work but push you toward better boundaries. pdf-lib was a good example. Passing complex objects across the RPC boundary didn’t survive serialization, so instead of proxying everything I exposed higher level service methods like generatePdf(title, body). Fewer round trips, cleaner API, honestly a better design anyway.

Some libraries will never work this way. Anything that patches runtime behavior or depends on isolate-local state isn’t a fit. Sentry wraps handlers. Prisma maintains connection state. OpenTelemetry hooks execution context. These aren’t “big library” problems, they’re “lives inside your runtime” problems.


### performance, realistically

Cold starts are mostly the service Worker spinning up. Warm calls are usually tiny. The real performance killer is chatty APIs, which is the same rule as any distributed system: batch work on the service side.

This isn’t “free.” You are adding another Worker invocation and another compute boundary. The goal isn’t zero cost. The goal is “I can ship this dependency at all.”

### when this makes sense

Good: formatting, parsing, pdf/image generation, data transforms, batch compute, anything deterministic.

Bad: request lifecycle tooling, global patching, streaming, transaction-bound runtimes.

### using it

It’s intentionally boring. Just esbuild under the hood.

```bash
npx overwork analyze --entry src/index.ts
npx overwork build --entry src/index.ts --split sql-formatter,@faker-js/faker
npx overwork deploy --output .overwork
```

### the real long term question

If Workers could support lazy import() chunks that don’t count toward script size until loaded, most of this problem probably disappears.

Until then, pushing heavy dependencies behind RPC boundaries feels like a pretty reasonable middle ground between “rewrite everything” and “don’t deploy.”

Want to try it yourself? Check out [overwork on GitHub](https://github.com/ygwyg/overwork).
