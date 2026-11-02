// /days/: a worksheet. The reader fills in the blanks in the sentences at the
// top and the answer is written underneath, in the plain cut (.live, never
// inked, like visitors' writing), with the dot grid and the hours drawn in
// pencil by src/figures/days-*.js. The arithmetic is src/days/model.js.
//
// Everything stays in the page. The answers are kept in the URL fragment,
// which browsers never send to a server, so a link shares them.

import {
  analyze,
  FREQUENCIES,
  RELATIONSHIPS,
  defaultFrequency,
  defaultTogetherYears,
  movesOutLater,
  milestones,
  MOVE_OUT_AGE,
} from "./days/model.js";
import { commas, spanOf, percent, years, hoursPerDay } from "./days/format.js";
import { pencilLine } from "./underline.js";
import { rng } from "./hand.js";

const PLACEHOLDERS = { parent: "Dad", child: "Rosie", partner: "Sam", sibling: "Alex", friend: "Chris" };
const FALLBACK = { parent: "your parent", child: "your kid", partner: "your partner", sibling: "your sibling", friend: "your friend" };

// One dot has to mean something a person can hold, and the grid has to stay
// a readable size. Between those, the sliver wins: time left too small to
// see is the one thing this drawing can't get wrong.
const UNITS = [
  { days: 1, one: "day", many: "days" },
  { days: 7, one: "week", many: "weeks" },
  { days: 30.44, one: "month", many: "months" },
  { days: 365.25, one: "year", many: "years" },
];
function unitFor(totalDays, leftDays) {
  const dots = (u) => totalDays / u.days;
  let i = UNITS.findIndex((u) => dots(u) <= 1200);
  if (i < 0) i = UNITS.length - 1;
  while (i > 0 && leftDays / UNITS[i].days < 3 && dots(UNITS[i - 1]) <= 3000) i--;
  return UNITS[i];
}

const you = { age: 34, sex: "male" };
let them = null;

function newPerson(relation) {
  const age = relation === "child" ? 6 : relation === "parent" ? 66 : 34;
  return {
    relation,
    name: "",
    age,
    sex: relation === "parent" ? "male" : "female",
    freq: defaultFrequency(relation, age, you.age),
    togetherYears: defaultTogetherYears(relation, age, you.age),
  };
}

const nameOf = (p) => p.name.trim() || FALLBACK[p.relation] || "them";
const clampNum = (raw, lo, hi, fallback) => {
  const n = Number(raw);
  return raw === "" || !Number.isFinite(n) ? fallback : Math.min(Math.max(Math.round(n), lo), hi);
};

let sheet = null;
const $ = (id) => sheet.querySelector(`#${id}`);

function fill(sel, items, value) {
  sel.replaceChildren(...items.map(({ value: v, label }) => Object.assign(document.createElement("option"), { value: String(v), textContent: label })));
  sel.value = String(value);
}

function nearestFreq(days) {
  return FREQUENCIES.reduce((a, f) => (Math.abs(f.days - days) < Math.abs(a - days) ? f.days : a), FREQUENCIES[0].days);
}

// While someone still lives at home every day already counts, so the only
// open question is what happens once that ends.
function freqLead() {
  const who = them.name.trim();
  if (!movesOutLater(them.relation, them.age, you.age)) return "We’re in the same place";
  return them.relation === "child"
    ? `Once ${who || "they"} move${who ? "s" : ""} out, we’ll be in the same place`
    : "Once I move out, we’ll be in the same place";
}

// The life table only asks which column; say it the way you'd say it of
// someone that age.
function sexLabels(sel, age) {
  sel.options[0].textContent = age < 18 ? "boy" : "man";
  sel.options[1].textContent = age < 18 ? "girl" : "woman";
}

function syncForm() {
  $("you-age").value = you.age;
  $("you-sex").value = you.sex;
  $("rel").value = them.relation;
  $("name").value = them.name;
  $("name").placeholder = PLACEHOLDERS[them.relation];
  $("age").value = them.age;
  $("sex").value = them.sex;
  // Only ask how long you've known each other when the ages don't say.
  $("since-line").hidden = RELATIONSHIPS[them.relation].shared;
  $("since").value = them.togetherYears;
  $("since-verb").textContent = them.relation === "partner" ? "been together" : "known each other";
  $("freq").value = String(nearestFreq(them.freq));
}

function readForm() {
  you.age = clampNum($("you-age").value, 0, 119, you.age);
  you.sex = $("you-sex").value;
  them.name = $("name").value.slice(0, 24);
  them.age = clampNum($("age").value, 0, 119, them.age);
  them.sex = $("sex").value;
  them.freq = Number($("freq").value) || them.freq;
  them.togetherYears = clampNum($("since").value, 0, Math.min(you.age, them.age), them.togetherYears);
}

// Days still ahead while the household is shared, or null once that's behind.
function daysAtHome(r) {
  if (!movesOutLater(them.relation, them.age, you.age)) return null;
  let days = 0;
  for (const y of r.future) if ((them.relation === "child" ? y.theirAge : y.yourAge) < MOVE_OUT_AGE) days += y.days;
  return days;
}

function li(text) {
  return Object.assign(document.createElement("li"), { textContent: text });
}

// The written part of the answer: changes at once, as they type.
function write() {
  readForm();
  $("freq-lead").textContent = freqLead();
  sexLabels($("you-sex"), you.age);
  sexLabels($("sex"), them.age);
  const name = nameOf(them);
  const r = analyze(you, them);
  const left = Math.round(r.leftDays);

  const head = $("headline");
  head.replaceChildren("About ", Object.assign(document.createElement("strong"), { textContent: commas(left) }), ` ${left === 1 ? "day" : "days"} left with ${name}.`);

  const unit = unitFor(r.totalDays, r.leftDays);
  const spentDots = Math.round(r.spentDays / unit.days);
  const leftDots = Math.max(r.leftDays > 0 ? 1 : 0, Math.round(r.leftDays / unit.days));
  $("grid-key").textContent = `Each dot is a ${unit.one}: ${commas(spentDots)} behind you, ${commas(leftDots)} ahead.`;

  const rows = [
    `Awake together on those days: ${hoursPerDay(r.leftHours / Math.max(1, r.leftDays))}`,
    `Back to back, that’s ${spanOf(r.leftHours)}`,
    `Already behind you: ${percent(r.fractionSpent)}`,
  ];
  // The Tail End's real finding, for anyone still at home: nearly all the
  // time left is packed into the years before they go.
  const home = daysAtHome(r);
  if (home !== null && r.leftDays > 0) {
    const who = them.relation === "child" ? `${name} turns` : "you turn";
    rows.push(`Before ${who} ${MOVE_OUT_AGE}: ${commas(home)} of them, ${percent(home / r.leftDays)}`);
  }
  // The only lever anyone has is how often, so the list ends on it.
  if (them.freq < 358) {
    const more = analyze(you, { ...them, freq: Math.min(365, them.freq + 7) });
    rows.push(`One more week a year: ${commas(more.leftDays - r.leftDays)} more days`);
  }
  $("stats").replaceChildren(...rows.map(li));

  $("expectancy").textContent =
    `On these tables you have about ${years(r.yourYears)} more years, and ${name} about ` +
    `${years(r.theirYears)}. You only get the years you’re both here for: ${years(r.jointYears)}.`;

  writeHash();
  return { r, unit, spentDots, leftDots, name };
}

// The drawn part: given the figures to redraw once typing settles, since
// each redraw rubs out and draws the whole thing again.
function draw({ r, unit, spentDots, leftDots, name }) {
  const grid = $("days-grid");
  const curve = $("days-curve");
  grid.figData = { spent: spentDots, left: leftDots, unit: unit.one };
  const pts = [...r.past, ...r.future].map((p) => ({ age: p.theirAge, h: p.hours / 365 }));
  curve.figData = { pts, now: r.past.length, marks: milestones(you, them), name };
  for (const f of [grid, curve]) f.dispatchEvent(new Event("figure:update"));
}

// Writing that moved under the ink (a line appearing, a list growing) has to
// be inked again; text that only changed in place is .live and doesn't.
function inkedLayout() {
  return [...sheet.querySelectorAll("p, h2, li, .diagram")]
    .filter((e) => !e.closest(".live"))
    .map((e) => (e.closest("[hidden]") ? "-" : e.offsetTop))
    .join();
}

// Each blank is underlined by hand, as long as it is.
function underlineBlanks() {
  for (const b of sheet.querySelectorAll(".blank")) {
    const w = Math.max(8, Math.round(b.offsetWidth));
    if (b.dataset.lined === String(w)) continue;
    b.dataset.lined = String(w);
    const svg = pencilLine(w, getComputedStyle(b).color, rng(w * 7919 + b.id.length));
    b.style.setProperty("--line", `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
  }
}

// A select is as wide as its longest option; size it to the chosen one, so
// "kid" doesn't leave a gap the width of "the holidays, and once besides".
let measurer;
function fitSelects() {
  measurer ??= document.createElement("canvas").getContext("2d");
  for (const s of sheet.querySelectorAll("select.blank")) {
    const css = getComputedStyle(s);
    measurer.font = `${css.fontSize} ${css.fontFamily}`;
    s.style.width = `${Math.ceil(measurer.measureText(s.selectedOptions[0]?.textContent ?? "").width) + 6}px`;
  }
}

function writeHash() {
  const p = [encodeURIComponent(them.name), them.relation, them.age, them.sex[0], Math.round(them.freq), them.togetherYears].join(",");
  history.replaceState(history.state, "", `#${you.age}${you.sex[0]}/${p}`);
}

// Links from the old page carried several people; the first is the one shown.
function readHash() {
  const [me, first] = location.hash.slice(1).split("/");
  const m = /^(\d{1,3})([mf])$/.exec(me ?? "");
  if (!m || !first) return false;
  const [name, relation, age, sex, freq, since] = first.split(",");
  if (!RELATIONSHIPS[relation]) return false;
  you.age = Math.min(119, Number(m[1]));
  you.sex = m[2] === "f" ? "female" : "male";
  let decoded = "";
  try {
    decoded = decodeURIComponent(name || "");
  } catch {}
  them = {
    relation,
    name: decoded.slice(0, 24),
    age: Math.min(119, Math.max(0, Number(age) || 0)),
    sex: sex === "f" ? "female" : "male",
    freq: Math.min(365, Math.max(1, Number(freq) || 12)),
    togetherYears: Math.max(0, Number(since) || 0),
  };
  return true;
}

export function startDays(el) {
  sheet = el;
  if (!readHash() || !them) them = newPerson("parent");
  fill($("rel"), Object.entries(RELATIONSHIPS).map(([k, v]) => ({ value: k, label: v.label })), them.relation);
  fill($("freq"), FREQUENCIES.map((f) => ({ value: f.days, label: f.label })), nearestFreq(them.freq));
  syncForm();

  let laid = "";
  let timer = 0;
  const update = ({ now = false } = {}) => {
    const answer = write();
    fitSelects();
    underlineBlanks();
    clearTimeout(timer);
    timer = setTimeout(() => {
      draw(answer);
      const now = inkedLayout();
      if (laid && now !== laid) window.dispatchEvent(new Event("sheet:changed"));
      laid = now;
    }, now ? 0 : 450);
  };

  const form = $("days-form");
  form.addEventListener("submit", (e) => e.preventDefault());
  form.addEventListener("input", (e) => {
    if (e.target.id === "rel") {
      // A new relationship keeps the ages and name, not how often or how long.
      them.relation = $("rel").value;
      them.freq = defaultFrequency(them.relation, them.age, you.age);
      them.togetherYears = defaultTogetherYears(them.relation, them.age, you.age);
      syncForm();
    }
    update();
  });
  // A number typed out of range is put right when they move on.
  form.addEventListener("change", () => syncForm());
  update({ now: true });
  // The layout the first ink was drawn from, before anything was typed.
  laid = inkedLayout();
}
