# The harness is the product

Weekly, if not daily, there’s a new SOTA model released and then like clockwork a few weeks later there’s an open-source model that catches up and often even surpasses them. It seems like everyone has a favorite model for writing code, or docs, or just chatting with, but they all rank relatively close to one another, at least in the LLM Leaderboards.

LLM Leaderboard from Artificial Analysis at time of this post

However now that all eyes are on Agents, the model is only half the story, and the harness becomes the other half, often even becoming more important than the actual model itself.

what is a harness?

Typically you’d think of a set of straps to hold an object in place, control an animal, something along those lines... With that mindset you’re not too far off, but now we are using them for agents. (Maybe the goal is to personify everything so whenever they revolt against us it’ll feel more deserving?).

If we keep going down this parallel the model is the brain of the beast, and the harness is the guiding reigns, the supporting safety gear, or the leash of constraints.

If you strip away the analogies, it's just the layer that decides what context the model sees, what tools it can use, what gets remembered, how work is broken into steps, and how we decide if it actually succeeded.

So the dfiference looks like this, if you’re interacting with an llm the chain of events is:

Where the agents are closer to:

The harness owns that loop almost entirely.

why harnesses matter

Without harnesses, LLMs are basically weird remote computers. They’re stateless, probabilistic, context-limited, surprisingly capable, and just as surprisingly fragile. They turn on and immediately back off. If you ask them to do one task they feel almost all-knowing. If you ask them to run your project for 24 hours they start to fall apart and it feels like AGI is never actually going to come.

So, if you want an agent to write software, trade stocks, monitor systems, or operate continuously, you need something that remembers what happened last time and can act on that knowledge.

That something is the harness.

Most teams discover this the hard way. They keep swapping models and wonder why results barely improve. The real bottleneck ends up being prompt structuring, context management, tool orchestration, state continuity, failure recovery, and progress tracking.

Which all inevitably becomes harness engineering.

what harnesses really buy you

The first thing a harness gives an agent is continuity.

Without one, every session is like

Memento

. You paste in context like you’re pinning photographs to a wall. You’re basically adding tattoos onto the prompt and hoping it doesn’t forget why they mattered.

Me sharing a screenshot with ChatGPT

Real continuity means the agent can pick up where it left off without you reconstructing its life story every time. It can keep a running record of decisions and learn the shape of how you work.

The second thing a harness gives an agent is tools.

A model can only talk. That’s a very limited amount of power and probably not what you need.

Most real work isn’t writing text. It’s fetching data, running code, reading files, writing files, scheduling work, checking results, and trying again when things don't work. The harness is the part that turns the conversation into actions.

Once an agent has continuity and tools, it stops being a chatbot and starts being a system.

harnesses are going to become products

A lot of companies think they’re building AI agents.

What they’re actually building is a harness with domain expertise.

It never starts that way. At first it’s just enough structure to make the model usable. Some tools. Some memory. Some rules to keep it from doing obviously bad things. Maybe a dashboard so you can see what it did while you were asleep.

Then reality shows up.

The agent hammers an API and you add rate limits. It makes a decision you didn’t expect and suddenly you want a kill switch. You wake up one morning and realize it quietly spent real money overnight, so now you need cost visibility. It repeats the same mistake twice and you add a rule that only exists because of that exact incident.

After a while the harness starts to feel less like code and more like experience. It accumulates the odd, specific lessons you only learn by running something continuously in the real world.

That’s the part competitors can’t easily copy. Not because it’s hidden. Because it’s learned through time, trial-and-error, and expertise.

And that’s why harnesses will become products in their own right. Not “an AI assistant,” but an environment where agents can safely and reliably do a certain class of work.

personal agents are coming

Right now most AI forward products assume you will talk directly to their agent. You go to their dashboard. Interact with their interface. You live inside their guidelines of how work should happen.

That probably isn’t the final shape of this.

What? Clawbot is evolving!

The more natural model is that people will have personal agents. Not just chat history, but something that actually understands how they operate. Knows what you care about, how you make tradeoffs, and what “good enough” means to you. Something that can hold your payment details securely and PII and use it sparingly without oversharing.

But that personal agent won’t be an expert at everything.

When it needs to do something specialized, it will reach out to a harness that lives inside that domain. Like APIs today, except stateful and operational instead of just request and response.

Your agent might decide you want to move money, but execution happens inside a finance harness built to do that safely. It might decide you want to ship code, but the real work happens inside a coding harness that knows how to build, test, and verify software. It might decide you want to run long research loops and hand that off to a research harness built for days-long work.

In that world, companies stop selling “AI agents” and start selling places where agents go when they need to do something real.

why durable objects feel made for this

If you tried to design the ideal harness from first principles, you’d invent something that looks a lot like durable objects.

You want the agent to have an identity that doesn’t change.
You want state that survives restarts.
You want code that can wake itself up on a schedule.
You want it to run without someone’s laptop acting as the heart monitor.

That’s basically what a durable object is.

The magical part isn’t any one feature. It’s that state and compute live together. The agent’s mind and body aren’t split across ten services and a cron job and a redis instance and a queue you hope is configured right.

It’s one thing. It stays up. It remembers.

When you run a harness inside a durable object, you stop thinking in “runs” and start thinking in “a living process.”

Your agent doesn’t just execute tasks in a vacuum on demand. It exists.

where this goes

Right now we still talk about models like they’re all that matters.

Soon it will feel normal to talk about harnesses instead. We'll have leaderboards for them, competitive startups will form around them, and we'll hear about them more and more.

The conversation is no longer all about “what model are you on?”
But it becomes “what harness are you connected to?”
"What tools does it have? What does it remember? How does it recover? How do you see what it did?"

Models will still keep improving. And that’s good news for everyone.

But the harness is where the magic is.
