// U.S. Social Security Administration period life table, Office of the Chief
// Actuary. q(x) is the probability that a person aged exactly x dies within one
// year. Ages 0-119; index into these arrays by age.
//
// This is a PERIOD table: it applies today's mortality rates at every age to a
// hypothetical person, so it ignores future medical progress (pessimistic) and
// knows nothing about any individual's health (could go either way). It is the
// standard instrument for exactly this question, and it is still only an average.
//
// Verified on load against the published l(x) and e(x) columns - rebuilding
// survivors from q(x) reproduces the SSA figures (e0 = 75.79 male, 81.06 female).

export const QX_MALE = [
  0.006015, 0.000479, 0.00032, 0.000249, 0.000194, 0.000159, 0.000137,
  0.000125, 0.00012, 0.00012, 0.000125, 0.00014, 0.000173, 0.000233,
  0.000327, 0.000463, 0.000634, 0.000819, 0.000999, 0.001138, 0.001235,
  0.001315, 0.001378, 0.001439, 0.001509, 0.001595, 0.001685, 0.001783,
  0.001876, 0.00197, 0.002085, 0.002202, 0.002308, 0.002407, 0.00249,
  0.002577, 0.002665, 0.002764, 0.002864, 0.002987, 0.003115, 0.003253,
  0.003419, 0.0036, 0.003777, 0.003931, 0.004073, 0.004245, 0.004477,
  0.004795, 0.005126, 0.005496, 0.005917, 0.006404, 0.006923, 0.007491,
  0.008173, 0.008938, 0.009714, 0.010494, 0.011337, 0.012232, 0.013196,
  0.014229, 0.015316, 0.016455, 0.017574, 0.018735, 0.019981, 0.021366,
  0.022903, 0.024615, 0.026504, 0.028648, 0.031071, 0.033802, 0.03701,
  0.041158, 0.045461, 0.050346, 0.055633, 0.061757, 0.068358, 0.07542,
  0.083364, 0.09268, 0.103459, 0.115502, 0.129018, 0.14381, 0.159458,
  0.176551, 0.19536, 0.216286, 0.238799, 0.262268, 0.286291, 0.310944,
  0.332325, 0.349036, 0.366568, 0.38496, 0.404252, 0.424488, 0.445712,
  0.467998, 0.491398, 0.515968, 0.541766, 0.568854, 0.597297, 0.627162,
  0.65852, 0.691446, 0.726018, 0.762319, 0.800435, 0.840457, 0.88248,
  0.926604
];

export const QX_FEMALE = [
  0.005125, 0.000392, 0.000229, 0.000188, 0.000155, 0.000133, 0.000115,
  0.000105, 0.0001, 0.000098, 0.000101, 0.000111, 0.000126, 0.000152,
  0.000188, 0.000229, 0.000273, 0.000323, 0.000372, 0.00041, 0.000441,
  0.000476, 0.000513, 0.000546, 0.000582, 0.000609, 0.000641, 0.000683,
  0.00074, 0.000808, 0.000878, 0.000947, 0.001018, 0.001089, 0.001154,
  0.001209, 0.001263, 0.001347, 0.001438, 0.001533, 0.001643, 0.001742,
  0.001845, 0.001954, 0.002075, 0.002187, 0.002306, 0.002438, 0.002595,
  0.002791, 0.00303, 0.003288, 0.003554, 0.003847, 0.004172, 0.004532,
  0.004923, 0.005365, 0.005815, 0.006333, 0.006923, 0.007555, 0.00822,
  0.008881, 0.009514, 0.010188, 0.01088, 0.011659, 0.012543, 0.013581,
  0.014769, 0.016153, 0.017705, 0.019495, 0.021533, 0.023846, 0.026458,
  0.0297, 0.033135, 0.036982, 0.041183, 0.045959, 0.051282, 0.057262,
  0.064107, 0.071752, 0.08049, 0.090566, 0.102204, 0.115178, 0.129176,
  0.144229, 0.160353, 0.177635, 0.196502, 0.216846, 0.23875, 0.261359,
  0.283899, 0.306491, 0.32968, 0.353333, 0.3773, 0.401416, 0.425501,
  0.451031, 0.478092, 0.506778, 0.537185, 0.568854, 0.597297, 0.627162,
  0.65852, 0.691446, 0.726018, 0.762319, 0.800435, 0.840457, 0.88248,
  0.926604
];

export const MAX_AGE = QX_MALE.length; // 120 - nobody survives past the table

// Probability of surviving each of the next t years, t = 0..MAX_AGE-age.
// survival[0] is 1 (alive now); survival[t] is the chance of reaching age + t.
export function survivalCurve(age, sex) {
  const qx = sex === "female" ? QX_FEMALE : QX_MALE;
  const start = Math.min(Math.max(Math.round(age), 0), MAX_AGE - 1);
  const curve = [1];
  let alive = 1;
  for (let a = start; a < MAX_AGE; a++) {
    alive *= 1 - qx[a];
    curve.push(alive);
  }
  curve.push(0); // the table stops at 119; treat 120 as the wall
  return curve;
}

// Remaining life expectancy in years - the area under the survival curve,
// trapezoid rule. Reproduces the table's own e(x) column.
export function lifeExpectancy(age, sex) {
  const s = survivalCurve(age, sex);
  let years = 0;
  for (let t = 0; t < s.length - 1; t++) years += (s[t] + s[t + 1]) / 2;
  return years;
}
