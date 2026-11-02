// The arithmetic of time left with someone.
//
// Two ideas do all the work:
//
//   1. Joint survival. You only get a year together if you BOTH live through
//      it, so the relevant curve is S_you(t) x S_them(t) - not either person's
//      life expectancy on its own, and never the smaller of the two. Losing
//      either of you ends the shared time, which is why the joint curve falls
//      away faster than either individual one.
//
//   2. A contact schedule. Years aren't the unit anyone feels; days together
//      are. Every year in the timeline carries a number of days you actually
//      spend in the same place, and that number changes when someone moves
//      out. Expected days in a future year = (days you'd spend together) x
//      (chance you're both still here for it).
//
// Sum the future and you get the headline. Sum the past the same way and you
// get the thing that actually stings: how little of the total is still ahead.

import { survivalCurve, MAX_AGE } from "./lifetable.js";

export const MOVE_OUT_AGE = 18; // when a household usually stops being shared
const DAYS_CO_RESIDENT = 365;

// Hours actually spent awake in each other's company, per day together.
//
// Days are what the story is told in - a day under the same roof is a day
// together, sleeping through most of it included. But the days are not equal,
// and this is what makes them unequal: a day with a seven-year-old is
// breakfast, the school run, and the stretch between pickup and bedtime. The
// chart is drawn in these hours so you can see the days thinning out even
// while the count of them stays flat.
//
// The figures are round, and anchored to the American Time Use Survey (via Our
// World in Data's series on who Americans spend their time with): time with
// children peaks near 4.2 hours a day averaged across all adults - higher for
// parents who actually live with one - and time with a partner runs between 3
// and 4.5 hours a day across adult life.
const HOURS = {
  // By the child's own age. The step down at 5 is school. The step at 13 is
  // everything else that starts competing with you for them.
  atHomeWithChild: (childAge) => (childAge < 5 ? 6 : childAge < 13 ? 4 : 3),
  // Two adults sharing a home, both with lives of their own.
  atHomeWithPartner: 4,
  // A day you make the trip to see someone. No school and no work, but not a
  // waking day either - there's the journey, and everyone else who came too.
  visit: 6,
};

// How often you're in the same place, in days per year. Each label finishes
// the sentence "We're in the same place …" and says its own number, so
// nobody has to guess what "a few times a year" was taken to mean: this is
// the one input the whole result hangs on.
export const FREQUENCIES = [
  { days: 365, label: "every day" },
  { days: 250, label: "most days" },
  { days: 104, label: "two days a week" },
  { days: 52, label: "one day a week" },
  { days: 24, label: "two days a month" },
  { days: 12, label: "one day a month" },
  { days: 10, label: "about ten days a year" },
  { days: 4, label: "a few days a year" },
  { days: 1, label: "one day a year" },
];

// `shared` marks relationships that begin under one roof: the early years run
// at 365 days whatever the visiting frequency says, because they did.
export const RELATIONSHIPS = {
  child: {
    noun: "child",
    label: "kid",
    shared: true,
    // The relationship is exactly as old as they are.
    startedYearsAgo: (_you, them) => them.age,
    // Home until they move out - measured on THEIR age.
    coResidentAt: ({ theirAge }) => theirAge < MOVE_OUT_AGE,
  },
  parent: {
    noun: "parent",
    label: "parent",
    shared: true,
    // The relationship is exactly as old as you are.
    startedYearsAgo: (you) => you.age,
    // Home until YOU moved out - measured on your age, not theirs.
    coResidentAt: ({ yourAge }) => yourAge < MOVE_OUT_AGE,
  },
  sibling: {
    noun: "sibling",
    label: "sibling",
    shared: true,
    // Starts when the younger of you arrived.
    startedYearsAgo: (you, them) => Math.min(you.age, them.age),
    // Under one roof only while you were both still children.
    coResidentAt: ({ theirAge, yourAge }) =>
      theirAge < MOVE_OUT_AGE && yourAge < MOVE_OUT_AGE,
  },
  partner: {
    noun: "partner",
    label: "partner",
    shared: false,
    startedYearsAgo: (you, them) => them.togetherYears,
    coResidentAt: () => false, // the frequency setting speaks for itself
  },
  friend: {
    noun: "friend",
    label: "friend",
    shared: false,
    startedYearsAgo: (you, them) => them.togetherYears,
    coResidentAt: () => false,
  },
};

// For anyone still living at home, this is the rate AFTER they move out — the
// years under one roof are already counted at 365 and aren't the question.
// Defaulting those to "we live together" was the whole bug: it projects the
// household forward forever and quietly deletes the cliff.
export function defaultFrequency(relation, theirAge, yourAge) {
  if (relation === "partner") return 365;
  if (relation === "child") return 24;
  if (relation === "sibling" || relation === "parent") return 10;
  return 12;
}

// True when the household is still ahead of them rather than behind: the
// frequency question has to be phrased about the years after it ends.
export function movesOutLater(relation, theirAge, yourAge) {
  const rel = RELATIONSHIPS[relation];
  if (!rel || !rel.shared) return false;
  if (relation === "child") return theirAge < MOVE_OUT_AGE;
  return yourAge < MOVE_OUT_AGE;
}

export function defaultTogetherYears(relation, theirAge, yourAge) {
  const younger = Math.min(theirAge, yourAge);
  if (relation === "partner") return clamp(younger - 24, 1, younger);
  return clamp(Math.round(younger / 2), 1, younger);
}

function clamp(n, lo, hi) {
  return Math.min(Math.max(n, lo), hi);
}

// The moments the curve steps down, expressed as THEIR age so the chart can
// label them. For your own parent or sibling the schedule was yours, so the
// milestones are your ages translated onto their timeline.
export function milestones(you, them) {
  const rel = RELATIONSHIPS[them.relation];
  if (!rel || !rel.shared) return [];
  const marks =
    them.relation === "child"
      ? [[5, "school"], [MOVE_OUT_AGE, "moves out"]]
      : [[5, "you start school"], [MOVE_OUT_AGE, "you move out"]];
  const offset = them.relation === "child" ? 0 : them.age - you.age;
  return marks.map(([age, label]) => ({ theirAge: age + offset, label }));
}

/**
 * Build the whole timeline of a relationship, past and future.
 *
 * @param {{age:number, sex:string}} you
 * @param {{age:number, sex:string, relation:string, freq:number,
 *          togetherYears:number}} them
 */
export function analyze(you, them) {
  const rel = RELATIONSHIPS[them.relation] || RELATIONSHIPS.friend;
  // A relationship cannot be older than the younger person in it. This also
  // keeps the timeline off negative ages when someone enters a parent younger
  // than themselves, or a partner they've known longer than either has lived.
  const startedAgo = Math.max(
    0,
    Math.min(Math.round(rel.startedYearsAgo(you, them)), you.age, them.age, MAX_AGE)
  );

  // A year of the relationship, in both units at once: the days you're in the
  // same place, and the hours of those days you're actually in each other's
  // company.
  const yearAt = (yourAge, theirAge) => {
    if (!rel.coResidentAt({ you, them, yourAge, theirAge })) {
      // Together every day is living together: two adults at home, not a
      // visit every day of the year.
      const perDay = them.freq >= DAYS_CO_RESIDENT ? HOURS.atHomeWithPartner : HOURS.visit;
      return { days: them.freq, hours: them.freq * perDay };
    }
    const perDay =
      them.relation === "partner"
        ? HOURS.atHomeWithPartner
        // For a parent or a sibling the child in the house is you, or the
        // younger of you - the schedule belongs to whoever is still at school.
        : HOURS.atHomeWithChild(
            them.relation === "child" ? theirAge
            : them.relation === "parent" ? yourAge
            : Math.min(yourAge, theirAge)
          );
    return { days: DAYS_CO_RESIDENT, hours: DAYS_CO_RESIDENT * perDay };
  };

  // ---- the past -------------------------------------------------------
  // One entry per year already lived together. No survival weighting here:
  // these years happened, at whatever rate the household was running.
  const past = [];
  let spentDays = 0;
  let spentHours = 0;
  for (let i = startedAgo; i >= 1; i--) {
    const yourAge = you.age - i;
    const theirAge = them.age - i;
    const y = yearAt(yourAge, theirAge);
    spentDays += y.days;
    spentHours += y.hours;
    past.push({ offset: -i, yourAge, theirAge, days: y.days, hours: y.hours, survival: 1 });
  }

  // ---- the future -----------------------------------------------------
  // Each year is discounted by the chance you're both alive to spend it. The
  // area under this curve IS the headline number - that's the whole design.
  const sYou = survivalCurve(you.age, you.sex);
  const sThem = survivalCurve(them.age, them.sex);
  const horizon = Math.min(sYou.length, sThem.length) - 1;
  const joint = (t) => (sYou[t] ?? 0) * (sThem[t] ?? 0);

  const future = [];
  let leftDays = 0;
  let leftHours = 0;
  let jointYears = 0;
  for (let t = 0; t < horizon; t++) {
    const yourAge = you.age + t;
    const theirAge = them.age + t;
    // Trapezoid across the year: the pair survives partway through the ones
    // they don't finish, and that partial credit is real time together.
    const weight = (joint(t) + joint(t + 1)) / 2;
    const y = yearAt(yourAge, theirAge);
    leftDays += y.days * weight;
    leftHours += y.hours * weight;
    jointYears += weight;
    future.push({
      offset: t, yourAge, theirAge,
      days: y.days * weight,
      hours: y.hours * weight,
      survival: weight,
    });
  }

  const totalDays = spentDays + leftDays;
  return {
    relation: them.relation,
    rel,
    startedAgo,
    past,
    future,
    // Days carry the story: a day under one roof is a day together.
    spentDays,
    leftDays,
    totalDays,
    fractionSpent: totalDays > 0 ? spentDays / totalDays : 0,
    // Hours carry the texture, and the chart is drawn in them.
    spentHours,
    leftHours,
    jointYears,
    // The years each of you can expect on your own, for the fine print. The
    // joint figure is always smaller than both, and people ask why.
    yourYears: expectedYears(sYou),
    theirYears: expectedYears(sThem),
  };
}

function expectedYears(curve) {
  let years = 0;
  for (let t = 0; t < curve.length - 1; t++) years += (curve[t] + curve[t + 1]) / 2;
  return years;
}
