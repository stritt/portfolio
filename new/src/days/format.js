// Number and duration formatting. The tool lives or dies on whether a figure
// reads as true, so nothing here rounds in a flattering direction.

export function commas(n) {
  return Math.round(n).toLocaleString("en-US");
}

export function percent(fraction) {
  const p = fraction * 100;
  // Never round a nearly-finished relationship up to a flat 100% - "99%" is
  // true and leaves the door open; "100%" says they're already gone.
  if (p > 99 && p < 100) return "99%";
  if (p < 1 && p > 0) return "under 1%";
  return `${Math.round(p)}%`;
}

// Always one decimal. These three figures are compared against each other in
// the same sentence, and whole years round the joint figure into a tie with
// the shorter individual one — which reads as an error in the arithmetic.
// The headline figure, as one number and one unit.
//
// The unit climbs until the number stops sounding like a fortune. 14,800 hours
// reads as a lot; the same span written as "1.7 years — of actual company, for
// the rest of your life" reads as what it is. Always the largest unit that
// still leaves a number worth saying.
export function heroFigure(hours) {
  const days = hours / 24;
  const weeks = days / 7;
  const months = days / 30.44;
  const years = days / 365.25;
  const pick = (v, one, many) => ({
    value: v,
    unit: String(v) === "1" ? one : many,
  });
  if (hours < 48) return pick(Math.round(hours), "hour", "hours");
  if (days < 14) return pick(Math.round(days), "day", "days");
  if (weeks < 16) return pick(Math.round(weeks), "week", "weeks");
  if (months < 36) return pick(Math.round(months), "month", "months");
  return pick(years.toFixed(1), "year", "years");
}

// The same ladder as a string, for every other span on the page. One ladder
// everywhere means "32 months" and "26 months of it" can be read against each
// other; mixing "32 months" with "2 years and 2 months" cannot.
export function spanOf(hours) {
  const f = heroFigure(hours);
  return `${f.value} ${f.unit}`;
}

// A rate small enough that hours stop meaning anything: ten days a year with
// your father, spread across that year, is ten minutes a day.
export function hoursPerDay(h) {
  if (h >= 1) return `${h.toFixed(1)} hours`;
  const min = Math.round(h * 60);
  return min >= 1 ? `${min} minutes` : "under a minute";
}

export function years(n) {
  return n.toFixed(1);
}

// Possessive form for the name people gave, so copy can say "Dad's" or
// "Alex's" without a special case at every call site.
export function possessive(name) {
  if (!name) return "their";
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}
