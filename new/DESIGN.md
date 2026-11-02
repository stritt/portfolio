# DESIGN.md: burcs.dev

A handwritten notebook. Every page is one sheet of ruled paper on a desk, drawn by a WebGL shader (`src/paper.js`); the text is ordinary DOM laid onto the rules. Everything a reader sees should look like Brandon wrote or drew it in pencil. If a change makes the page look like a website, it's wrong.

## Hard rules (owner's)

1. **Only Brandon's fonts on visible text.** `Brandon Pencil` (DOM) and `Brandon Pencil Graphite` (inked by the worker). Never add a webfont or a system font to anything a visitor sees. The only `ui-sans-serif` allowed is owner-only chrome (`.tune`, `.wall-queue`).
2. **One text size: 20px (`--fs`).** No `h1`/`h2` scale, no bold, no small print. Hierarchy comes from spacing (whole rules) and position. The single exception is `.sheet .turn` (the corner arrow, `2 * --fs`), because it's a mark, not writing. Slips laid over the sheet (comment tools, doodle bar, sticky-note bylines and actions) use `--fs-slip`, 16px.
3. **No click-to-turn.** Pages turn by dragging a corner (`.grip`), by ←/→, or by following a link. Never make a click on the sheet, a corner or a margin turn the page.
4. **Drafts only on posts.** `?draft` works only under `/notes/` (`main.js` `drafting`). Don't add draft mode to home, projects or the wall.
5. **Nothing goes public without Brandon's approval.** Visitor comments, notes and doodles land in a pending queue and show only after he approves them. Never add a path that publishes visitor content directly, and never deploy, post or announce anything without asking him.
6. **The draft key is never committed.** `DRAFT_KEY` lives in `/Users/brandon/Desktop/website/.dev.vars` (gitignored) and in Worker secrets. Don't print it, log it, put it in a URL you share, or write it to any tracked file.

## The rule grid

Everything sits on the rules. `main.js` writes these from the sheet width; `style.css :root` holds fallbacks.

- `--L` is one rule (33px at full width). Every line box is exactly `--L` tall.
- Vertical spacing is always a whole number of rules: `margin-top: var(--L)` (or `n * var(--L)`). Never use px, em or rem for vertical space inside `.sheet`.
- Text baselines land `--gap` above their rule via the shared `translateY` on `.head, h1, h2, p, li`. New text elements inside `.sheet` must join that selector, or they'll float between rules.
- Margins: `--pad-l` (left, holds the `.tools` margin notes), `--pad-r`, `--pad-b`. First line is rule `--n0`.
- `.sheet * { margin: 0; padding: 0 }`. Add spacing back explicitly, in rules.

```css
/* Correct */
.sheet .wall-note { margin-top: var(--L); }
/* Incorrect: breaks the grid */
.sheet .wall-note { margin-top: 24px; line-height: 1.5; }
```

## Type and ink

- DOM text is the plain cut (`Brandon Pencil`, `font-display: block`, preloaded on every page). Once `ink.js` has drawn the Graphite cut into the paper, `.sheet.inked` hides the DOM fill. Don't style text colour expecting it to show after inking; the ink colour comes from the worker.
- Weight is always 400. Emphasis is `<strong>`, which renders as a yellow highlighter pass (`--marker`), not bold.
- Text a visitor wrote (`.guest`) stays in the plain cut, never inked, so it reads as someone else's hand.
- Rendered copy uses typographic punctuation: ’ “ ” …
- Lists use the hand-drawn `–` marker from `.sheet li::before`. Note listings use `.entries` (title left, date right).

## Colour

No other colours exist. Don't add new hex values; use the `:root` tokens by role.

| Role | Value |
| --- | --- |
| Ink (text, pencil lines) | `--ink` #2e2f35 (also `INK` in `pencil.js`) |
| Hover/focus on margin icons | `--pen` #10288a |
| Highlighter, `strong`, `mark`, `::selection` | `--marker` #fff09a |
| Softer pencil: margin tools, bylines, empty states, placeholders | `--ink-soft` #55565d; guest writing #3a3b42 |
| Red pencil: suggestions, comment numbers | `--red` #b8322a |
| Red on the yellow note: actions, errors | `--red-deep` #a0281e |
| Paper slips over the page (doodle bar, comment tools) | `--slip` #f7f3e9 with `--slip-shadow` |
| Sticky note | gradient #fff6b0 → #fdef95 |
| Desk | #bfbab0 light, #1b1a19 dark (`html[data-theme]`) |
| No-WebGL fallback paper | #faf8f2, rules #9fc0e2, margin #e88c95 |

Theme: `data-theme` on `<html>` follows the system until the reader picks one (stored in `localStorage.scene`). Every page repeats the same inline pre-paint script; keep them identical.

## Links

`.sheet a` has no CSS underline. `underline.js` draws a seeded hand pencil line under each link, always visible, at rest and on hover (Brandon's call; don't make it draw in on hover). Links never change colour. Focus is `outline: 1px dashed currentColor`. Never add `text-decoration: underline` to a sheet link.

Internal links turn the page in place (`main.js` intercepts them). Add `data-reload` to a link that starts a mode (`?draft`, `?doodle`) so it does a real navigation.

## Pages

- Every page is its own HTML file with the same `<head>` skeleton, `<canvas id="gl">`, and `<article class="sheet" id="sheet">`. Copy an existing page; don't invent structure.
- Add each new page to `vite.config.js` `rollupOptions.input`, or it won't build.
- Chain neighbours with `<link rel="prev"/"next" vite-ignore>`. This drives ←/→ and the corner grips.
- A note longer than one sheet is `.sheet.stacked` with one `<section class="page">` per sheet, each starting with a `.head` (`<span></span><span>2 of 3</span>`).
- Published notes need: canonical, description, OG/Twitter tags with a hashed image in `public/social/`, `BlogPosting` JSON-LD, a homepage `.entries` line, a sitemap entry and an llms.txt line. Drafts get `<meta name="robots" content="noindex">` and none of those.

## Days (`/days/`)

A worksheet, not a note: the reader fills in blanks (`.blank` inputs and selects, underlined by hand in `days.js`) and the answer is written and drawn underneath. Text that changes as they type is `.live`: the ink worker skips it, so it stays in the plain cut, like visitors' writing. Static copy is inked as usual; `days.js` fires `sheet:changed` only when inked text actually moved. The arithmetic is `src/days/model.js` (SSA period life table); the drawings are `figures/days-grid.js` and `figures/days-curve.js`, fed through `el.figData` and redrawn on a `figure:update` event.

## Figures

Use a figure when a post needs a diagram the reader can watch being drawn or press. Use `<figure class="sketch">` + `<img>` for a static pencil scan (`public/sketches/`).

```html
<figure class="diagram" data-fig="dns" style="--rules: 5; --rules-narrow: 6"
        aria-label="What the drawing shows, and what pressing it does."></figure>
```

- `data-fig="name"` loads `src/figures/name.js` (globbed by `figure.js`). The default export is `(pen, { w, h, data, narrow }) => { duration, hotspots?, ... }`.
- Height is whole rules: `--rules`, and `--rules-narrow` for sheets under 520px. Always set both and lay out for `narrow`.
- Draw only with the pen, in the order a hand would: `line`, `rect`, `circle`, `dashed`, `arrow`, `curve`, `text`. Never draw with raw canvas calls or images.
- Reuse `src/figures/parts.js` (`browser`, `rack`, `spot`, `requests`, `slow`) instead of redrawing a window or a machine.
- Every hotspot is a real button with a verb label ("Ask DNS where burcs.dev is"). The `aria-label` on the `<figure>` describes the drawing and the interaction.
- Respect `prefers-reduced-motion`: `figure.js` already does; don't bypass it.

## Slips and notes

Anything a visitor uses on top of the sheet (the comment status, toolbar and compose form, the doodle bar) is a **slip of paper**: `--slip` background, `--slip-shadow`, square corners, `--ink` in `var(--fs-slip)` (16px) Brandon Pencil, a size down from the sheet. Actions are words, not buttons: secondary ones in `--ink-soft`, the main one underlined. Opened comments and the "save doodle" form are **sticky notes** (`.draft-note`, yellow, slightly rotated). Never use dark glass panels, rounded pills or filled buttons for visitor UI.

Panels and notes enter with opacity plus `scale: 0.97` over 150–200ms on `--ease-out` (`@starting-style`), and appear instantly under reduced motion.

## Modes

- **Comments (`?draft`, posts only).** Visitors select words, then press "Comment". Keyboard: Tab to the sheet, ↑ ↓ pick a paragraph, Tab to the toolbar, Escape returns. Each comment is a `mark.cm` plus a red numbered circle (`.dm`) in the margin. Opening one shows a sticky note (`.draft-note`). Only Brandon's session edits the text and accepts or rejects suggestions.
- **Doodle (`/wall/?doodle`, wall only).** Every other page's margin "doodle" link goes to the wall. Strokes are `pencil.js` graphite; c or ⌘Z takes back the last stroke; a signed doodle goes to the pending queue.
- **Owner review.** `.wall-queue` and `.doodle-handle` appear only for Brandon. This is the one place where system UI is fine.

## Motion

- Motion follows input: page turns follow the hand (spring on the grabbed corner), figures draw when reached or pressed. No scroll-triggered effects, no autoplay loops.
- Under `prefers-reduced-motion`, grips are disabled and smooth wheel scrolling is off. Any new motion needs the same gate.

## Open questions

- Figure labels use 10.5–16px canvas text. Decide whether drawn labels are exempt from rule 2, then record that decision here.
