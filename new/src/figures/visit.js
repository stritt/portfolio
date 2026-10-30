// The reader's own visit to this page, measured (see visit() in
// figure.js), as a chain of dimensions: looking up the address, connecting,
// the handshake, waiting, and the page coming down. Pressing it plays the
// visit back, slowed down, with a cursor running along it.

import { requests, slow } from "./parts.js";

export default function visit(pen, { w, h, data: v, narrow }) {
  const phases = [
    { code: "t1", name: "dns", ms: v.dns },
    { code: "t2", name: "connect", ms: v.connect },
    { code: "t3", name: "tls", ms: v.tls },
    { code: "t4", name: "wait", ms: v.wait },
    { code: "t5", name: "download", ms: v.download },
  ];
  const known = phases.every((p) => Number.isFinite(p.ms));
  const total = known ? phases.reduce((s, p) => s + p.ms, 0) : 0;
  const x0 = 4;
  const x1 = w - 4;
  const ty = narrow ? h - 50 : h - 34;
  const fs = narrow ? 12 : 14;

  pen.text(
    known ? `your visit to this page: ${total} ms${v.proto ? `, over ${v.proto}` : ""}` : "your visit to this page: not measured here",
    x0, ty - (narrow ? 34 : 38), { size: fs },
  );
  const minW = narrow ? 44 : 78;
  const spare = x1 - x0 - minW * phases.length;
  let x = x0;
  for (const p of phases) {
    p.x0 = x;
    p.x1 = x + minW + (total ? (spare * p.ms) / total : spare / phases.length);
    x = p.x1;
    pen.dim(p.x0, p.x1, ty, narrow ? p.code : `${p.code} ${p.name}`, { size: narrow ? 11 : 12, below: known ? `${p.ms} ms` : "[tbd]" });
  }
  if (narrow) pen.text("t1 dns · t2 connect · t3 tls · t4 wait · t5 download", x0, h - 4, { size: 10.5 });

  const all = { id: "visit", label: "Play your visit back, slowed down", x: 0, y: 0, w, h };
  return {
    duration: 3,
    ...requests([all], () => phases.map((p) => ({ phase: p, d: slow(p.ms) })), {
      drawn(ctx, o, { leg, k }) {
        const p = leg.phase;
        const cx = p.x0 + (p.x1 - p.x0) * k;
        o.line(ctx, [[x0, ty + 1.5], [cx, ty + 1.5]], { press: 0.9, seed: 9 });
        o.line(ctx, [[cx, ty - 9], [cx, ty + 9]], { press: 0.7, seed: 4 });
        if (!known) return;
        const before = phases.slice(0, phases.indexOf(p)).reduce((s, q) => s + q.ms, 0);
        ctx.font = `${fs}px "Brandon Pencil", cursive`;
        ctx.fillText(`${Math.round(before + p.ms * k)} ms`, Math.min(Math.max(cx - 14, x0), x1 - 44), ty - (narrow ? 18 : 20));
      },
    }),
    // No ring around the whole thing; the cursor is enough.
    hotspots: [all],
  };
}
