// Links are underlined by hand, in the link's own colour: a pencil line a
// little past both ends, never quite level, heavier in the middle, and now
// and then gone over again at the start. Each link gets its own line
// (seeded by where it goes and what it says), drawn as an SVG under it so it
// can be drawn in when the link is pointed at (see .sheet a in style.css).

import { rng } from "./hand.js";

const H = 8;   // the line's box, CSS px tall

function line(w, color, rnd) {
  const x0 = 1 + rnd() * 2;
  const x1 = w - 1 - rnd() * 2;
  const y0 = H / 2 + (rnd() - 0.5) * 1.6;
  const y1 = H / 2 + (rnd() - 0.5) * 1.6;
  const n = Math.max(3, Math.round(w / 14));
  const pass = (t0, t1) => {
    let d = "";
    let wob = 0;
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      wob += (rnd() - 0.5) * 0.5 - wob * 0.3;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t + wob + Math.sin(t * Math.PI) * 0.5;
      d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(2)}`;
    }
    return d;
  };
  const back = rnd() < 0.4 ? `<path d='${pass(rnd() * 0.08, 0.2 + rnd() * 0.3)}' stroke-width='0.8' stroke-opacity='0.5'/>` : "";
  // Graphite on paper: the stroke is flecked where the pencil skipped.
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${H}' viewBox='0 0 ${w} ${H}'>` +
    `<filter id='g' x='0' y='0' width='1' height='1'><feTurbulence type='fractalNoise' baseFrequency='0.9' seed='${Math.floor(rnd() * 99)}' result='n'/>` +
    `<feColorMatrix in='n' type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2.2 1.75'/><feComposite in='SourceGraphic' operator='in'/></filter>` +
    `<g fill='none' stroke='${color}' stroke-linecap='round' stroke-linejoin='round' filter='url(#g)'>` +
    `<path d='${pass(0, 1)}' stroke-width='1.35' stroke-opacity='0.9'/>${back}</g></svg>`
  );
}

export function underline(root) {
  for (const a of root.querySelectorAll("a[href]:not(.tool)")) {
    const rect = a.getClientRects()[0];
    if (!rect) continue;
    let seed = 2166136261;
    for (const c of a.getAttribute("href") + a.textContent) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
    const svg = line(Math.max(8, Math.round(rect.width)), getComputedStyle(a).color, rng(seed >>> 0));
    a.style.setProperty("--line", `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
  }
}
