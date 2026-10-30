// The handshake: before anything is asked for, the browser and the edge
// agree how to talk privately. Three passes, drawn as a ladder; pressing
// it plays them.

import { requests, slow } from "./parts.js";

export default function handshake(pen, { w, h, data: v, narrow }) {
  const fs = narrow ? 12 : 13;
  const lx = narrow ? 40 : 120;
  const rx = w - lx;
  const top = 34;
  const bottom = h - 34;
  pen.text("you", lx, top - 12, { size: fs + 2, align: "center" });
  pen.text(`edge${v.colo ? ` · ${v.colo}` : ""}`, rx, top - 12, { size: fs + 2, align: "center" });
  pen.line([[lx, top], [lx, bottom]], { press: 0.45 });
  pen.line([[rx, top], [rx, bottom]], { press: 0.45 });

  const step = (bottom - top - 24) / 3;
  const passes = [
    ["hello", lx, rx],
    ["hello, and a certificate", rx, lx],
    ["finished", lx, rx],
  ].map(([label, a, b], i) => {
    const y0 = top + 14 + i * step;
    const dir = b > a ? 1 : -1;
    const path = [[a + 3 * dir, y0], [b - 3 * dir, y0 + step * 0.45]];
    pen.arrow(path, { press: 0.45, head: 7 });
    pen.text(label, (a + b) / 2, y0 - 6, { size: fs, align: "center" });
    return path;
  });
  const tls = Number.isFinite(v.tls) && v.tls ? `${v.tls} ms` : "";
  const ver = v.tlsVersion ? v.tlsVersion.replace("TLSv", "tls ") : "";
  pen.text([ver, tls].filter(Boolean).join(" · ") || "tls", w / 2, h - 8, { size: fs, align: "center" });

  const all = { id: "shake", label: "Play the handshake", x: lx - 20, y: top - 30, w: rx - lx + 40, h: bottom - top + 40 };
  return {
    duration: 3.5,
    ...requests([all], () => passes.map((path) => ({ path, d: slow(v.tls / 3) }))),
    hotspots: [all],
  };
}
