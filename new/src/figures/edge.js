// Asking for the page: the browser sends GET to the edge nearby, which
// usually has it; only on a miss does the edge go to the origin. Pressing
// the edge sends a request it can answer; pressing the origin, one it
// can't.

import { browser, rack, requests, slow, spot } from "./parts.js";

export default function edge(pen, { w, h, data: v, narrow }) {
  const fs = narrow ? 12 : 13;
  const big = narrow ? 14 : 15;
  const colo = v.colo ? ` · ${v.colo}` : "";
  let you, near, far, out, back, down, up;
  if (narrow) {
    you = browser(pen, 4, 8, 120, 80);
    near = rack(pen, 4, 142, 120);
    far = { x: w - 108, y: 158, w: 104, h: 56 };
    out = [[24, you.y + you.h + 8], [24, near.y - 8]];
    back = [[100, near.y - 8], [100, you.y + you.h + 8]];
    down = [[near.x + near.w + 8, far.y + 16], [far.x - 8, far.y + 16]];
    up = [[far.x - 8, far.y + far.h - 16], [near.x + near.w + 8, far.y + far.h - 16]];
  } else {
    you = browser(pen, 6, 30, 140, 92);
    near = rack(pen, w / 2 - 50, 26, 120);
    far = { x: w - 140, y: 40, w: 134, h: 72 };
    out = [[you.x + you.w + 8, 58], [near.x - 8, 58]];
    back = [[near.x - 8, 92], [you.x + you.w + 8, 92]];
    down = [[near.x + near.w + 8, 58], [far.x - 8, 58]];
    up = [[far.x - 8, 92], [near.x + near.w + 8, 92]];
  }
  pen.text(`edge${colo}`, near.x + near.w / 2, near.y + near.h + 22, { size: big, align: "center" });
  if (!narrow) pen.text("a few miles away", near.x + near.w / 2, near.y + near.h + 40, { size: fs, align: "center" });

  pen.arrow(out, { press: 0.55 });
  pen.arrow(back, { press: 0.55 });
  if (narrow) {
    pen.text("GET /", out[0][0] + 8, (out[0][1] + out[1][1]) / 2 + 5, { size: fs });
    pen.text("200 · html", back[0][0] + 8, (out[0][1] + out[1][1]) / 2 + 5, { size: fs });
  } else {
    pen.text("GET /", (out[0][0] + out[1][0]) / 2, out[0][1] - 8, { size: fs, align: "center" });
    pen.text("200 · html", (back[0][0] + back[1][0]) / 2, back[0][1] + 18, { size: fs, align: "center" });
  }

  pen.arrow(down, { dashed: true, press: 0.4 });
  pen.arrow(up, { dashed: true, press: 0.4 });
  pen.dashed([[far.x, far.y], [far.x + far.w, far.y], [far.x + far.w, far.y + far.h], [far.x, far.y + far.h], [far.x, far.y]], { press: 0.45 });
  pen.text("origin", far.x + far.w / 2, far.y + far.h / 2 + 6, { size: big, align: "center" });
  pen.text("only on a miss", far.x + far.w / 2, far.y + far.h + 22, { size: fs, align: "center" });

  return {
    duration: 4.5,
    ...requests(
      [spot("you", "Ask the edge for the page", you), spot("edge", "Ask the edge for the page", near), spot("origin", "Ask for a page the edge doesn't have", far)],
      (id) => [
        { path: out, d: slow(v.wait / 2) },
        ...(id === "origin" ? [{ path: down, d: 0.7 }, { path: up, d: 0.7 }] : []),
        { path: back, d: slow(v.download) },
      ],
    ),
  };
}
