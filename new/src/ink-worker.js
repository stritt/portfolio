// Draws one page's ink in Brandon Pencil Graphite. Runs on a CPU canvas
// (willReadFrequently) so the slow COLRv1 painting stays in this thread and
// never ties up the GPU process the page renders through.

const face = new FontFace("Graphite", 'url("/fonts/BrandonPencilGraphite-Regular.woff2")');
const ready = face.load().then((f) => self.fonts.add(f));

let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue
    .then(() => draw(data))
    .catch((err) => self.postMessage({ id: data.id, error: String(err) }));
};

async function draw({ id, w, h, scale, runs }) {
  await ready;
  const canvas = new OffscreenCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.scale(scale, scale);
  ctx.fontKerning = "normal";
  for (const r of runs) {
    ctx.font = `${r.fs}px Graphite`;
    ctx.fillStyle = r.color;
    ctx.letterSpacing = r.ls;
    ctx.fillText(r.text, r.x, r.y);
  }
  const bitmap = canvas.transferToImageBitmap();
  self.postMessage({ id, bitmap }, [bitmap]);
}
