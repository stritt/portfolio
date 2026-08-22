# How I'd build a platform in 2026

When I say platform I mean something that’s multi-tenant, and even further than that a place where people own their chunk of the platform. Users want to have more customization, more ownership, more freedom to build out what they want and the less they’re locked into one way of doing things the better.

You already have an idea, and now you need to form the shape of it, whatever you choose here is going to lock you in early. Things like how does your data communicate with each other, where do your tenants live, how isolated are they, and what happens when someone wants or does something you weren’t expecting.

The first decision I would make actually has nothing to do with coding or infrastructure really. The first choice I would make would be choosing the right domain.

If my tenants are running arbitrary code or serving custom content, I would never put them on my main domain. Even if the runtime isolation is perfect, the risk is too great and reputation doesn’t work that way. If someone has bad intentions and puts up a phishing site on

random.acme.com

it’s going to potentially ruin our business.

So instead of that I would register a separate domain altogether. Ideally something with the same name but maybe a different tld so instead of

acme.com

it’s now

acme.app

That domain exists for one job and one job only, hosting tenant workloads. That way our main site stays clean.

It’s similar to warming up a new domain for sending out cold outreach, if you’ve ever done this you know it’s crucial to use a new domain that way your main domain doesn’t get blacklisted further preventing you from communicating to your users.

This maybe sounds like overkill and I’m potentially doubling my spend on domains, but if I didn’t do it and the first abuse report shows up, I would be kicking myself.

Once you’ve done all that you’ll run into the next hurdle. Browsers treat subdomains as siblings by default. It makes sense right? I would want browsers to know that

docs.acme.com

and

blogs.acme.com

and are related and let my cookies be shared across those subdomains. Obviously this is not the case for the multi-tenant platform. You can try to paper over this with cookie prefixes and an extreme amount of discipline, but trust me when I say discipline doesn’t scale.

Thankfully there’s an answer to this, it’s the PSL (and no we aren’t talking about the fall starbucks favorite Pumpkin Spice Latte).

If your platform is on the Public Suffix List, browsers treat each subdomain as a separate site.

tenant-1.acme.com

cannot set cookies for

tenant-2.acme.com

. Storage stays entirely isolated and the browser enforces it for you.

That being said the PSL isn’t automatic. You have to submit a pull request to the github repo explaining that the domains host UGC (User Generated Content), and then wait. It can take weeks, but don’t worry that’s normal. Also it’s why you want to start early, before tenants depend on the domain.

I want to be clear here though, PSL solves isolation not reputation. Sadly abuse on a subdomain can still reflect poorly on the rest of the domain. You’ll notice major players app domains being blocked from things like facebook because of that. So the PSL is a necessity, but it doesn’t save you from everything. Just one more reason to register that secondary domain.

Now with domains sorted out we can start to think about the shape of your platform. How does data travel through it, how are you isolating users, what does your schema look like? This is one of the biggest pieces to get right today, because changing it in the future is going to be extremely painful.

If your tenants are untrusted, for instance you’re letting them run their own usercode, you’re going to want a way to completely isolate them from each other. Thankfully again there’s an answer for this. Cloudflare has something called Workers for Platforms, and it’s honestly nothing too crazy to get started with, it basically gives you a platform worker that defines the routing and policies that direct to the tenant workers that do the actual work. Giving you a clear and defined shape, each tenant runs in it’s own isolate and if one breaks the other’s don’t.

You could also run everything in one single instance and branch on tenant ID. It’s straightforward and people do it all the time, but it gets fragile fast, the database bloats and it becomes a ton of overhead. Instead what you’re going to want to do is use something called a Dispatch Worker.

Instead of hard coding the tenants at deployment, the platform worker dynamically routes the request for you. A request comes in, you look at the hostname, resolve it to the correct tenant ID, and then ask the dispatch namespace for that worker. If the tenant exists, great forward the request, and if not you simply 404.

The important thing here is the order of operation. Tenants do not control routing, they don’t even know each other exists, the platform decides who runs what and when.

You’re probably thinking that sounds like a lot of work, how do we control storage for each tenant, how does this not end up turning into a spaghetti infra mess. Bindings, bindings are what keep this from turning into a tumbleweed.

So each tenant Worker gets only what it needs. A database, storage, maybe a limited platform API, but nothing else. There’s no shared global state and no extra access. If a tenant needs something new, you add a binding and redeploy. The friction here is intentional. It makes access explicit and mistakes harder.

At some point, if you’re doing well, and more importantly your customers are doing well, they are going to ask for custom domains. Meaning they don’t want traffic to go to

tenant-1.acme.com

they want it to go to

tenant-1.com

. That’s a very good thing.

Custom domains are the long-term play. They move the whole reputation and trust layer away from you and onto the tenant. The flow here is actually pretty straightforward. The tenant adds a domain, you give them a DNS target, they point it to you, you verify ownership, and you simply store that mapping. From then on, routing is just another lookup. Cloudflare handles all of the certificates and TLS automatically.

Over time, this creates natural user segments. Early or casual users stay on the platform domain. Serious users move to their own.

Now there is a caveat to all of this and that is limits.

Cloudflare has real limits around CPU time, memory, and request duration. They vary by plan, but they’re always there. You can’t run long jobs in a request. You can’t hold unlimited state. You probably shouldn’t try.

Instead of fighting those limits, I’d surface them. Map them directly to plans and quotas. Make behavior predictable. Make your billing plans reflect the limits, so as your users scale their usage they are also increasing their spend too.

Now you’ve architected a really robust platform that’s isolated and well designed, but guess what your tenants don’t care. Nor should they, a platform that is extremely well architected but hard to use is destined to fail.

From a tenant’s point of view, the rest of the platform doesn’t exist.

They don’t care how routing works or where code runs. They care about shipping their app. That means the two things that matter most are a clean API, and an interface that helps when things go wrong.

The API is the product.

Tenants should be able to build their entire product using HTTP calls. Create resources. Read and write data. Trigger actions. Integrate with their own systems. If something only works in the UI, the platform is leaking.

This API doesn’t need to expose your internals. It should instead speak in the tenant’s language and what they care about their resources, their workflows, their limits. Internally, it fans out across the platforms Workers and storage. Externally though it’s one thought, it should feel like one surface.

This also future-proofs the platform. Once everything is accessible over an API, it doesn’t matter whether the caller is a person, a script, or an AI agent. The same surface works. New interfaces can come later without rewriting what’s underneath.

The interface exists for your non-technical users or when the api isn’t enough.

Depending on what you are building, your users might not be visiting the dashboard often. Things are running smoothly, and they might check in once in a while on billing. However, when something breaks, traffic spikes, or when a domain isn’t resolving. The UI’s job is to make those situations immediately clear, not to hide them in settings or simply mirror the API.

On Cloudflare, the split here is natural. The platform Worker owns the API and policy. Tenant Workers stay focused on serving requests. Complexity stays on your side of the boundary.

If your tenants never have to ask how the platform works, you probably got this right.

Once you’ve got the foundation in place, you have room to grow without breaking it.

You can start adding heavier execution models where they make sense. Longer-running jobs. Background work. More flexible compute for specific workloads. These don’t replace Workers. They extend them.

You can introduce sandboxes for riskier execution. Containers for workloads that need a different shape. You can route certain requests away from the edge when they don’t belong there.

The key is that these become choices, not defaults.

Because routing is explicit, you can decide which workloads run where. Because isolation is already real, you can mix execution models without collapsing boundaries. Because domains and trust are already sorted, you don’t have to revisit them every time you add a capability.

You end up with a platform that can grow in power without growing sideways.

That’s the real advantage of starting with Cloudflare’s primitives. Not that they do everything, but that they give you a clean place to stand while you decide what to add next.

The goal isn’t to build the biggest platform on day one.

It’s to build one that can keep growing, without having to revisit past mistakes every time you do.
