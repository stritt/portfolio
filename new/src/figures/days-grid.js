// /days/: a dot for every stretch of time together, filled in row by row.
// The ones behind you are quick, faint flecks; the ones still ahead are
// pressed in hard, slower, and ringed at the end. data comes from days.js.

export default function daysGrid(pen, { w, h, data }) {
  const { spent = 0, left = 0 } = data ?? {};
  const n = spent + left;
  if (!n) return { duration: 0.1 };

  // The biggest cell that fits them all, leaving room under the grid for the
  // label on the ring and to its right for "now".
  const room = h - 26;
  const gw = w - 40;
  let cell = Math.min(18, Math.sqrt((gw * room) / n));
  let cols = Math.max(1, Math.floor(gw / cell));
  while (Math.ceil(n / cols) * cell > room && cell > 3) {
    cell -= 0.25;
    cols = Math.max(1, Math.floor(gw / cell));
  }
  const at = (i) => [(i % cols) * cell + cell / 2, Math.floor(i / cols) * cell + cell / 2];
  const r = Math.max(0.6, cell * 0.16);

  for (let i = 0; i < n; i++) {
    const [x, y] = at(i);
    if (i < spent) {
      pen.line([[x - r, y], [x + r * 0.4, y + r * 0.3]], { press: 0.16, speed: 6, wob: 0.2, taper: false, dur: 0.02, gap: 0, overlap: 0.6 });
    } else {
      // A dot is a little twist of the pencil, pressed in.
      const k = r * 1.5;
      pen.line([[x - k * 0.6, y - k * 0.2], [x + k * 0.5, y - k * 0.4], [x + k * 0.4, y + k * 0.5], [x - k * 0.5, y + k * 0.3], [x, y]],
        { press: 0.85, speed: 2, wob: 0.15, taper: false, dur: 0.06, gap: 0.01, overlap: 0.3 });
    }
  }

  if (!left) return { duration: Math.min(4, 1.2 + n / 500) };
  const first = at(spent);
  const last = at(n - 1);
  const rows = Math.floor((n - 1) / cols) - Math.floor(spent / cols) + 1;
  if (rows <= 3) {
    // A loose ring round what's left, open where it starts, labelled under.
    const x0 = rows > 1 ? 0 : first[0] - cell / 2;
    const x1 = rows > 1 ? cols * cell : last[0] + cell / 2;
    const cx = (x0 + x1) / 2;
    const cy = (first[1] + last[1]) / 2;
    const rx = Math.max(10, (x1 - x0) / 2 + 6);
    const ry = Math.max(9, (last[1] - first[1] + cell) / 2 + 5);
    const a0 = 2.2 + pen.rnd() * 0.5;
    const pts = [];
    for (let i = 0; i <= 34; i++) {
      const a = a0 + (i / 32) * 6.2832;
      pts.push([cx + Math.cos(a) * rx * (1 + i * 0.002), cy + Math.sin(a) * ry * (1 + i * 0.003)]);
    }
    pen.wait(0.2).line(pts, { press: 0.5, speed: 1.2 });
    const label = "what’s left";
    const half = pen.width(label, 15) / 2 + 4;
    pen.text(label, Math.min(Math.max(cx, half), w - half), Math.min(h - 4, cy + ry + 20), { size: 15, align: "center" });
  } else {
    // Most of it is still ahead: rule a line where the past stops, step and
    // all, and write "now" at its end.
    const top = first[1] - cell / 2;
    const bx = first[0] - cell / 2;
    const right = cols * cell;
    const pts = bx > 0 ? [[0, top + cell], [bx, top + cell], [bx, top], [right + 4, top]] : [[0, top], [right + 4, top]];
    pen.wait(0.2).line(pts, { press: 0.5, speed: 1.4 });
    pen.text("now", right + 8, top + 5, { size: 15 });
  }

  return { duration: Math.min(4, 1.2 + n / 500) };
}
