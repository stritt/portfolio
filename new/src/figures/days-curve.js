// /days/: hours a day together across their life, drawn as a hand would
// chart it. The years behind are drawn light; from "now" on the line is
// pressed harder and the area under it, the time that's left, is shaded in.
// data comes from days.js.

export default function daysCurve(pen, { w, h, data }) {
  const { pts = [], now = 0, marks = [] } = data ?? {};
  if (pts.length < 2 || now >= pts.length) return { duration: 0.1 };

  // Trim the long tail where the chance of either of you still being here
  // rounds to nothing, so the shape fills the drawing.
  const peak = Math.max(0.01, ...pts.map((p) => p.h));
  let end = pts.length - 1;
  while (end > now + 1 && pts[end].h < peak * 0.01) end--;
  const span = pts.slice(0, end + 1);
  // Headroom over the peak, for the words on the line from now.
  const yMax = [0.25, 0.5, 1, 2, 3, 4, 5, 6, 8].find((s) => peak * 1.3 <= s) ?? 8;
  const x0 = span[0].age;
  const x1 = span[span.length - 1].age;

  const pad = { l: 30, r: 8, t: 26, b: 26 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const sx = (age) => pad.l + ((age - x0) / Math.max(1, x1 - x0)) * iw;
  const sy = (v) => pad.t + ih - (v / yMax) * ih;
  // The line steps: a year's rate holds until the next one.
  const stepped = (from, to) => {
    const out = [];
    for (let i = from; i <= to; i++) {
      const p = span[i];
      if (i > from) out.push([sx(p.age), sy(span[i - 1].h)]);
      out.push([sx(p.age), sy(p.h)]);
    }
    return out;
  };

  // Axes first, quickly, the way you'd rule them.
  pen.line([[pad.l, pad.t - 4], [pad.l, pad.t + ih]], { press: 0.35, speed: 2 });
  pen.line([[pad.l, pad.t + ih], [pad.l + iw, pad.t + ih]], { press: 0.35, speed: 2 });
  pen.text(`${yMax}h`, pad.l - 6, sy(yMax) + 5, { size: 13, align: "right" });
  pen.text("0", pad.l - 6, sy(0) + 4, { size: 13, align: "right" });
  // Their age at either end, unless "now" is standing there.
  const nx0 = sx(span[now].age);
  if (nx0 > pad.l + 30) pen.text(String(x0), pad.l, h - 6, { size: 13 });
  if (nx0 < pad.l + iw - 30) pen.text(String(x1), pad.l + iw, h - 6, { size: 13, align: "right" });

  // Where the steps come from, named along the top.
  let lastX = -Infinity;
  for (const m of marks) {
    if (m.theirAge <= x0 + 0.5 || m.theirAge >= x1 - 0.5) continue;
    const mx = sx(m.theirAge);
    if (mx - lastX < 70) continue;
    lastX = mx;
    pen.dashed([[mx, pad.t - 2], [mx, pad.t + ih]], { press: 0.22, dash: 3, space: 5 });
    pen.text(m.label, Math.min(Math.max(mx, pad.l + 30), w - 40), pad.t - 9, { size: 13, align: "center" });
  }

  // The years behind, light.
  if (now > 0) pen.line(stepped(0, now), { press: 0.3, speed: 1.6, wob: 0.6 });

  // Now.
  const nx = sx(span[now].age);
  pen.line([[nx, pad.t - 4], [nx, pad.t + ih + 4]], { press: 0.5, speed: 2.4, wob: 0.4 });
  // Under its line, or beside it when it's close to either end.
  const nowAt = nx < pad.l + 26 ? ["left", nx + 3] : nx > pad.l + iw - 26 ? ["right", nx - 3] : ["center", nx];
  pen.text("now", nowAt[1], h - 6, { size: 13, align: nowAt[0] });

  // What's left: pressed hard, then shaded under in pencil strokes.
  const ahead = stepped(now, span.length - 1);
  pen.line(ahead, { press: 0.75, speed: 1.2 });
  const hatch = 5;
  for (let x = nx + 3; x < sx(x1) - 1; x += hatch) {
    const age = x0 + ((x - pad.l) / iw) * (x1 - x0);
    const p = span.findLast((q) => q.age <= age) ?? span[now];
    const top = sy(p.h) + 2;
    if (pad.t + ih - top < 3) continue;
    pen.line([[x, pad.t + ih - 1], [x + 3, top]], { press: 0.28, speed: 5, wob: 0.3, taper: false, dur: 0.05, gap: 0, overlap: 0.5 });
  }

  // How much that is from here, said in words, since a few days a year is
  // a line too close to the axis to read.
  const level = span[now].h;
  const said = level >= 1 ? `${level.toFixed(1)} hours a day` : `${Math.max(1, Math.round(level * 60))} min a day`;
  const ly = Math.max(pad.t + 16, Math.min(sy(level) - 26, pad.t + ih - 30));
  const lx = Math.min(nx + 16, w - pad.r - pen.width(said, 14) - 4);
  pen.wait(0.1).text(said, lx, ly, { size: 14 });
  // Pointing at this year's step, before the line drops to the next.
  const stepEnd = span[now + 1] ? sx(span[now + 1].age) - 2 : sx(x1) - 4;
  const tip = [Math.min(nx + 22, Math.max(nx + 4, stepEnd)), sy(level) - 3];
  pen.arrow(pen.curve([lx + 8, ly + 5], [lx - 2, (ly + tip[1]) / 2], tip), { press: 0.4, head: 5 });

  return { duration: 4 };
}
