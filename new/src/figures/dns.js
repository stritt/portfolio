// Looking up burcs.dev: the browser asks DNS where it is and gets an
// address back. Pressing either sends the question across.

import { browser, requests, slow, spot } from "./parts.js";

export default function dns(pen, { w, h, data: v, narrow }) {
  const fs = narrow ? 12 : 13;
  const you = narrow ? browser(pen, 4, 30, 112, 80) : browser(pen, 6, 26, 150, 96);
  const book = narrow ? { x: w - 104, y: 40, w: 100, h: 52 } : { x: w - 200, y: 38, w: 120, h: 60 };
  pen.rect(book.x, book.y, book.w, book.h);
  pen.line([[book.x + 12, book.y + 2], [book.x + 12, book.y + book.h - 2]], { press: 0.35 });
  pen.text("DNS", book.x + book.w / 2 + 6, book.y + book.h / 2 + 6, { size: narrow ? 14 : 16, align: "center" });
  pen.text("the address book", book.x + book.w / 2, book.y + book.h + 22, { size: fs, align: "center" });

  const ax = you.x + you.w + 8;
  const bx = book.x - 8;
  const ask = pen.curve([ax, you.y + 30], [(ax + bx) / 2, you.y + 6], [bx, book.y + 16]);
  const answer = pen.curve([bx, book.y + book.h - 14], [(ax + bx) / 2, book.y + book.h + 8], [ax, you.y + you.h - 22]);
  pen.arrow(ask, { press: 0.5 });
  pen.text("where's burcs.dev?", (ax + bx) / 2, narrow ? you.y - 10 : you.y + 6, { size: fs, align: "center" });
  pen.arrow(answer, { dashed: true, press: 0.45 });
  const took = Number.isFinite(v.dns) ? (v.dns ? `${v.dns} ms` : "0 ms, it remembered") : "";
  pen.text(`an address${took && !narrow ? ` · ${took}` : ""}`, (ax + bx) / 2, book.y + book.h + (narrow ? 40 : 28), { size: fs, align: "center" });

  return {
    duration: 4,
    ...requests([spot("you", "Ask DNS where burcs.dev is", you), spot("dns", "Ask DNS where burcs.dev is", book)], () => [
      { path: ask, d: slow(v.dns / 2) },
      { path: answer, d: slow(v.dns / 2) },
    ]),
  };
}
