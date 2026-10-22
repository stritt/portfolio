// WebGL2 renderer for the desk and the ruled sheet.
//
// Two passes:
//   bake  — once, renders a tileable 2048² texture of paper structure
//           (r: fine tooth, g: fibres, b: formation/mottling, a: slow undulation)
//           covering 1024 CSS px, so one texel is half a CSS pixel.
//   frame — every frame, a fullscreen triangle that shades the desk and up
//           to two sheets in CSS-pixel space: the page at rest, and, during
//           a page change, a sheet on top of it being flipped over a fold
//           line, showing its back and casting shadow on what it uncovers.

const TILE_TEXELS = 2048;

const VERT = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec4 hash42(vec2 p) {
  vec4 p4 = fract(vec4(p.xyxy) * vec4(.1031, .1030, .0973, .1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}`;

const BAKE = /* glsl */ `#version 300 es
precision highp float;
out vec4 o;
const float T = 1024.0;   // tile period in CSS px
${COMMON}

// Periodic gradient noise: lattice hashed modulo 'per' so the tile wraps.
float gnoise(vec2 x, float per) {
  vec2 i = floor(x), f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash22(mod(i, per)) * 2.0 - 1.0, f);
  float b = dot(hash22(mod(i + vec2(1, 0), per)) * 2.0 - 1.0, f - vec2(1, 0));
  float c = dot(hash22(mod(i + vec2(0, 1), per)) * 2.0 - 1.0, f - vec2(0, 1));
  float d = dot(hash22(mod(i + vec2(1, 1), per)) * 2.0 - 1.0, f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 x, float cell, int oct) {
  float s = 0.0, amp = 0.5, norm = 0.0;
  for (int k = 0; k < 6; k++) {
    if (k >= oct) break;
    s += amp * gnoise(x / cell, T / cell);
    norm += amp;
    cell *= 0.5;
    amp *= 0.55;
  }
  return s / norm;
}

// Short, slightly bent cellulose fibres scattered on a periodic cell grid.
// Signed: most sit proud of the sheet, a few read as grooves.
float fibres(vec2 x, float cell, float lenMin, float lenMax, float wid, float seed) {
  float per = T / cell;
  vec2 g = floor(x / cell);
  float acc = 0.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 c = g + vec2(i, j);
    vec2 cw = mod(c, per);
    for (int k = 0; k < 3; k++) {
      vec4 h = hash42(cw * 1.37 + seed + float(k) * 17.31);
      vec2 center = (c + h.xy) * cell;
      // Machine direction: fibres lean toward horizontal.
      float ang = (h.z - 0.5) * 3.14159;
      ang *= 0.55 + 0.45 * abs(h.z - 0.5) * 2.0;
      float len = mix(lenMin, lenMax, h.w);
      vec2 dir = vec2(cos(ang), sin(ang));
      vec2 r = x - center;
      float half_ = len * 0.5;
      float t = clamp(dot(r, dir), -half_, half_);
      float tn = t / half_;
      float bend = (fract(h.w * 13.7) - 0.5) * len * 0.14;
      float dp = dot(r, vec2(-dir.y, dir.x)) - bend * (1.0 - tn * tn);
      float dl = dot(r, dir) - t;
      float dist = length(vec2(dl, dp));
      float w = wid * (0.6 + 0.8 * fract(h.z * 31.1));
      float prof = 1.0 - smoothstep(w * 0.25, w, dist);
      acc += prof * (1.0 - 0.6 * tn * tn) * (fract(h.x * 47.3) - 0.3);
    }
  }
  return acc;
}

void main() {
  vec2 x = gl_FragCoord.xy * (T / ${TILE_TEXELS.toFixed(1)});
  float white = hash12(mod(floor(gl_FragCoord.xy), ${TILE_TEXELS.toFixed(1)}));

  float tooth = 0.5 + 0.95 * fbm(x, 4.0, 3) + (white - 0.5) * 0.28;
  float fib = 0.5 + 0.38 * (fibres(x, 32.0, 10.0, 40.0, 0.95, 3.1)
                         + 0.7 * fibres(x, 16.0, 4.0, 14.0, 0.7, 9.7));
  float form = 0.5 + 1.1 * fbm(x, 128.0, 4);
  float slow = 0.5 + 1.1 * fbm(x, 512.0, 3);

  o = clamp(vec4(tooth, fib, form, slow), 0.0, 1.0);
}`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;      // canvas size, device px
uniform float uDpr;
uniform vec2 uView;     // viewport, CSS px
uniform vec4 uMain;     // resting sheet: centre x, y (viewport CSS px), half w, half h
uniform float uMainSeed;
uniform vec2 uTilt;     // resting sheet, turning sheet: radians each lies off square
uniform vec4 uFlip;     // sheet being flipped, same layout
uniform vec4 uFold;     // fold line: point x, y; unit normal x, y (toward the lifted side)
uniform float uCurl;    // radius the paper rolls over at the fold, CSS px
uniform vec2 uFlipInfo; // active, seed
uniform vec4 uRule;     // spacing, first rule y, bottom margin, margin line x
uniform vec4 uHole;     // centre x, radius, spacing, enabled
uniform float uInch;    // one inch at the sheet's scale, CSS px
uniform vec2 uMouse;    // 0..1
uniform float uTime;
uniform float uDark;
uniform int uBg;        // what the sheet lies on (see desk())
uniform int uLight;     // how the room is lit (see main())
uniform vec2 uDay;      // where the sun is: -1 morning .. 1 evening; how warm it's turned, 0..1
uniform sampler2D uInkMain; // each sheet's pencil, drawn by ink-worker.js
uniform sampler2D uInkFlip;
uniform vec4 uInkSize;      // main w, h; flip w, h (CSS px; 0 = no ink yet)
uniform sampler2D uInkPrev; // the page above in the pile, whose writing pressed into this one
uniform vec2 uPrevSize;
uniform sampler2D uDoodle;  // pencil drawn on the resting sheet by the reader (doodle.js)
uniform vec2 uDoodleSize;   // CSS px; 0 = none
uniform vec2 uStack;        // resting sheet stacked as several: each one's height, the gap between (0 = one)
uniform vec2 uStackF;       // the same for the sheet being turned
out vec4 o;

const float T = 1024.0;
const mat2 ROT = mat2(0.8776, 0.4794, -0.4794, 0.8776);
${COMMON}

// Two rotated, rescaled reads of the tile so its repeat never lines up.
vec4 stock(vec2 q) {
  vec4 a = texture(uTex, q / T);
  vec4 b = texture(uTex, (ROT * q * 0.913 + vec2(311.7, 97.3)) / T);
  return (a + b) * 0.5;
}
float relief(vec4 s) { return s.r * 0.5 + s.g * 0.4 + s.b * 0.3; }

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Exact box-filtered coverage of a line of half-width hw at distance d,
// over one device pixel (px CSS px wide). Hairlines stay hairlines.
float cover(float d, float hw, float px) {
  return clamp((min(d + px * 0.5, hw) - max(d - px * 0.5, -hw)) / px, 0.0, 1.0);
}

// Sun through a window, thrown across the desk: a soft-edged rectangle of
// panes in window space w (the caller shears and scales it to the angle of
// the sun), muntins across it, and leaves outside moving in the breeze.
float panes(vec2 p, vec2 w, vec2 size, vec2 cells, float soft, float bar, float leaves) {
  float m = smoothstep(0.0, soft, w.x) * smoothstep(0.0, soft, size.x - w.x)
          * smoothstep(0.0, soft, w.y) * smoothstep(0.0, soft, size.y - w.y);
  vec2 f = abs(fract(w / size * cells) - 0.5);
  vec2 dl = (0.5 - f) * size / cells;
  m *= mix(0.45, 1.0, smoothstep(bar, bar + soft, dl.x) * smoothstep(bar, bar + soft, dl.y));
  float leaf = texture(uTex, p / T * 0.55 + vec2(uTime * 0.0021, uTime * 0.0013)).a;
  return m * mix(1.0 - leaves, 1.0, smoothstep(0.38, 0.62, leaf));
}

// Sun through a four-light window, at an angle. The patch slides across
// the desk as the day goes on.
float windowLight(vec2 p) {
  vec2 w = mat2(1.0, -0.2, 0.42, 1.0) * (p / uView.y);
  w -= vec2(-0.08 - 0.35 * uDay.x, 0.06 + 0.08 * uDay.x) + 0.015 * vec2(sin(uTime * 0.05), cos(uTime * 0.037));
  return panes(p, w, vec2(0.95, 1.2), vec2(2.0), 0.12, 0.012, 0.22);
}

// Late sun, low in the sky: the window is stretched long across the desk
// and its edges go soft with the distance.
float goldenLight(vec2 p) {
  vec2 w = mat2(0.55, -0.55, 0.9, 0.9) * (p / uView.y);
  w -= vec2(0.54, -0.94) + 0.01 * vec2(sin(uTime * 0.04), cos(uTime * 0.031));
  return panes(p, w, vec2(0.7, 1.9), vec2(2.0, 3.0), 0.2, 0.01, 0.1);
}

// Venetian blinds: bright slats with the soft shadow of each slat between,
// within the window's frame.
float blindsLight(vec2 p) {
  vec2 w = mat2(1.0, -0.35, 0.3, 1.0) * (p / uView.y) - vec2(-0.25 + 0.22 * uDay.x, -0.1);
  float frame = smoothstep(0.0, 0.08, w.x) * smoothstep(0.0, 0.08, 1.3 - w.x)
              * smoothstep(0.0, 0.08, w.y) * smoothstep(0.0, 0.08, 1.4 - w.y);
  float slat = fract(w.y / 0.055 + 0.02 * sin(uTime * 0.07));
  float lit = smoothstep(0.08, 0.3, slat) * (1.0 - smoothstep(0.62, 0.86, slat));
  return frame * mix(0.12, 1.0, lit);
}

// Moonlight: a cool, faint window from the other side of the room.
float moonLight(vec2 p) {
  vec2 w = mat2(1.0, 0.25, -0.35, 1.0) * (p / uView.y) - vec2(0.45, -0.05);
  return panes(p, w, vec2(0.9, 1.15), vec2(2.0), 0.22, 0.012, 0.0);
}

// What the sheet lies on. Each is lit afterwards by the room.
vec3 desk(vec2 p) {
  vec4 ds = stock(p * 1.4 + 517.0);
  if (uBg == 1 || uBg == 2) {
    // Wood: long streaks of grain running across, gently warped, growth
    // rings drifting through, and the seam where two boards meet.
    vec2 w = vec2(p.x, p.y + 40.0 * texture(uTex, p / 2600.0).a + 12.0 * texture(uTex, p / 700.0).b);
    float fine = texture(uTex, vec2(w.x / 1600.0, w.y / 7.0)).r;
    float streak = texture(uTex, vec2(w.x / 2600.0, w.y / 40.0)).b;
    float broad = texture(uTex, vec2(w.x / 4000.0, w.y / 300.0)).a;
    float rings = 0.5 + 0.5 * sin((w.y + broad * 220.0) / 17.0 + streak * 6.0);
    float seam = 1.0 - 0.35 * exp(-abs(mod(p.y + 90.0, 340.0) - 170.0) / 0.8);
    vec3 lo = uBg == 1 ? vec3(0.66, 0.49, 0.32) : vec3(0.22, 0.14, 0.09);
    vec3 hi = uBg == 1 ? vec3(0.80, 0.64, 0.45) : vec3(0.38, 0.25, 0.16);
    vec3 c = mix(lo, hi, clamp(broad * 0.8 + streak * 0.5 - 0.15, 0.0, 1.0));
    c *= 0.86 + 0.16 * fine + 0.08 * smoothstep(0.35, 0.95, rings);
    return c * seam;
  }
  if (uBg == 3) {
    // Linen: a plain weave. Threads pass over and under each other in a
    // checker; each is round in section (bright down its middle, shaded at
    // its sides) and a little uneven in thickness, with the odd slub.
    vec2 t = p / 3.2;
    vec2 f = fract(t) - 0.5;
    float over = mod(floor(t.x) + floor(t.y), 2.0);
    float warp = texture(uTex, vec2(floor(t.x) / 337.0, p.y / 1400.0)).b;
    float weft = texture(uTex, vec2(p.x / 1400.0, floor(t.y) / 337.0)).b;
    float shape = mix(cos(f.y * 3.14159) * (0.8 + 0.4 * weft), cos(f.x * 3.14159) * (0.8 + 0.4 * warp), over);
    float slub = smoothstep(0.66, 0.9, texture(uTex, vec2(p.x / 700.0, floor(t.y) / 91.0)).a);
    vec3 c = vec3(0.8, 0.76, 0.68) * (0.8 + 0.22 * shape + 0.06 * slub);
    return c * (0.96 + 0.06 * ds.a);
  }
  if (uBg == 4) {
    // Concrete: cool, mottled, with pinhole pores.
    vec3 c = vec3(0.63, 0.63, 0.62) * (0.86 + 0.18 * ds.a + 0.1 * (ds.b - 0.5) + 0.06 * ds.r);
    vec2 cell = floor(p / 5.0);
    float pore = step(0.986, hash12(cell)) * (1.0 - smoothstep(0.4, 1.4, length(p - (cell + hash22(cell)) * 5.0)));
    return c * (1.0 - 0.35 * pore);
  }
  if (uBg == 5) {
    // Slate: near-black stone with a fine cleft grain.
    float cleft = texture(uTex, vec2(p.x / 800.0, p.y / 18.0)).b;
    return vec3(0.17, 0.18, 0.2) * (0.86 + 0.14 * ds.r + 0.12 * cleft + 0.06 * ds.a);
  }
  if (uBg == 6) {
    // A plain white tabletop: the shadows do the work.
    return vec3(0.93, 0.925, 0.91) * (0.985 + 0.02 * ds.a + 0.01 * ds.r);
  }
  // Plaster: warm grey, softly mottled.
  vec3 c = mix(vec3(0.75, 0.735, 0.70), vec3(0.24, 0.23, 0.22), uDark);
  return c * (0.92 + 0.12 * ds.r + 0.08 * (ds.b - 0.5) + 0.05 * (ds.g - 0.5));
}

// A point (and the light) in the frame of a sheet turned by angle a about c.
vec2 untilt(vec2 p, vec2 c, float a) {
  float s = sin(a), k = cos(a);
  vec2 d = p - c;
  return c + vec2(k * d.x + s * d.y, -s * d.x + k * d.y);
}
vec3 tiltL(vec3 L, float a) {
  return vec3(untilt(L.xy, vec2(0.0), a), L.z);
}

// Light on a tilted patch of paper, relative to lying flat: half diffuse,
// half the room's ambient, so a bend shades without going black.
float bendLight(vec3 N, vec3 L) {
  return clamp(0.5 + 0.5 * dot(N, L) / L.z, 0.7, 1.1);
}

vec3 shoulder(vec3 c) {
  vec3 k = 0.86 + 0.14 * (1.0 - exp(-(c - 0.86) / 0.14));
  return mix(c, k, step(0.86, c));
}

struct Sheet {
  vec3 col;     // lit paper colour
  float a;      // coverage
  float under;  // darkening of whatever lies beneath: cast shadow, or the hole's
};

// One sheet of loose-leaf. r is its centre and half-size; seed picks a
// different patch of paper stock so no two sheets share grain.
// A sheet never lies quite flat: one bottom corner (which, by seed) keeps a
// little lift from being torn off a pad. Height in CSS px.
float restLift(vec2 q, vec2 hs, float seed) {
  vec2 corner = vec2(hash12(vec2(seed, 5.3)) > 0.5 ? 2.0 * hs.x : 0.0, 2.0 * hs.y);
  float t = 1.0 - clamp(length(q - corner) / 240.0, 0.0, 1.0);
  return 7.0 * t * t * (3.0 - 2.0 * t);
}

// One sheet of loose-leaf. r is its centre and half-size; seed picks a
// different patch of paper stock so no two sheets share grain. The sheet's
// pencil (premultiplied, sheet-local, inkSize in CSS px; 0 = none) is laid
// into the paper here so it can sit in the tooth and catch the light;
// inkAmt below 1 shows it faintly, as writing seen through from the back.
// prevInk is the writing on the page that lay on top, pressed in as grooves.
// yo: how far down a stack this sheet lies, where its writing is read from.
Sheet sheet(vec2 p, vec4 r, float seed, vec3 L, vec3 light, float sun, float lamp, float px,
            sampler2D inkTex, vec2 inkSize, float inkAmt, sampler2D prevInk, vec2 prevSize, float doodleOn, float yo) {
  Sheet o;
  vec2 hs = r.zw;
  vec2 q = p - r.xy + hs;   // sheet-local, origin top-left
  vec2 qi = q + vec2(0.0, yo);
  // Guillotine-cut edges waver a hair, and the corners aren't needle sharp.
  float rc = 1.4;
  float wob = (texture(uTex, vec2((q.x + q.y) / 1900.0, seed * 0.137)).b - 0.5) * 0.7;
  float d0 = sdBox(q - hs, hs - rc) - rc + wob;

  // Shadow: tight where the paper touches the desk, thrown further and
  // softer where it's lifted off it.
  vec2 so = -L.xy / L.z;    // shadows fall away from the light
  float zE = restLift(clamp(q, vec2(0.0), 2.0 * hs), hs, seed);
  float sh = 0.15 * (1.0 - 0.7 * smoothstep(0.5, 3.0, zE)) * (1.0 - smoothstep(-1.0, 3.0, sdBox(q - hs - so * 0.8, hs)))
           + (0.09 + 0.05 * smoothstep(1.0, 6.0, zE)) * (1.0 - smoothstep(-14.0, 26.0 + zE * 3.0, sdBox(q - hs - so * (4.0 + 1.4 * zE), hs)))
           + 0.06 * (1.0 - smoothstep(-50.0, 120.0, sdBox(q - hs - so * (12.0 + zE) - vec2(0.0, 6.0), hs)));

  o.col = vec3(0.0);
  o.a = 0.0;
  o.under = sh;
  if (d0 > 1.0) return o;

  vec2 sq = q + seed * vec2(373.1, 211.7);
  vec4 s = stock(sq);

  // Punched holes: evenly spaced, centred down the sheet.
  float H = hs.y * 2.0;
  float hn = uHole.w * max(1.0, floor((H - 1.5 * uInch) / uHole.z) + 1.0);
  float hi = clamp(floor((q.y - hs.y) / uHole.z + (hn - 1.0) * 0.5 + 0.5), 0.0, max(hn - 1.0, 0.0));
  vec2 hc = vec2(uHole.x, hs.y + (hi - (hn - 1.0) * 0.5) * uHole.z);
  float hr = uHole.y + (s.g - 0.5) * 0.45;
  float dh = length(q - hc) - hr;                 // > 0 on paper
  float holeOn = step(0.5, hn);
  float holeA = clamp(0.5 - dh / px, 0.0, 1.0) * holeOn;
  float inner = hr - length(q - so * 2.2 - hc);   // how far past the cast edge
  float holeSh = 0.07 + 0.5 * (1.0 - smoothstep(0.0, 2.5, inner));

  // The cut edge is a little fibrous at the finest scale.
  float onSheet = clamp(0.5 - (d0 + (s.g - 0.5) * 0.6) / px, 0.0, 1.0);
  o.a = onSheet * (1.0 - holeA);
  o.under = mix(sh, holeSh, step(d0, 0.0));

  // ---- paper albedo ----
  vec3 alb = vec3(0.974, 0.968, 0.950);
  alb *= 1.0 + (s.b - 0.5) * 0.05 + (s.g - 0.5) * 0.022;
  alb *= mix(vec3(1.0), vec3(1.0, 0.993, 0.975), s.a);

  // Rare inclusions — the odd dark speck every sheet has.
  vec2 sc = floor(sq / 41.0);
  if (hash12(sc + 7.1) > 0.982) {
    vec2 sp = (sc + hash22(sc + 1.3)) * 41.0;
    float sd = length((sq - sp) * vec2(1.0, 1.0 + hash12(sc + 3.3))) - (0.3 + hash12(sc + 4.2) * 0.55);
    alb = mix(alb, alb * vec3(0.62, 0.58, 0.54), clamp(0.5 - sd / px, 0.0, 1.0) * (0.35 + 0.5 * hash12(sc + 9.1)));
  }

  // ---- printed rules ----
  // Offset-printed ink: it catches the tops of the tooth and skips the
  // valleys, wanders a hair, and bleeds a touch along the fibres.
  float ink = (0.78 + 0.22 * smoothstep(0.36, 0.64, s.r)) * (0.9 + 0.1 * s.a);
  // Each rule gets its own character: some print a little light or soft
  // (wider, lower peak, more bleed), and density drifts along its length.
  float Ls = uRule.x;
  float yy = q.y + (s.b - 0.5) * 0.2;
  float jj = floor(yy / Ls + 0.5);
  float lh = hash12(vec2(jj, 3.7 + seed));
  float soft = smoothstep(0.45, 1.0, hash12(vec2(jj, 9.1 + seed)));
  float ly = jj * Ls + (lh - 0.5) * 0.3;
  float last = floor((H - uRule.z) / Ls) * Ls;
  float ok = step(uRule.y - 0.5, ly) * step(ly, last + 0.5);
  float dy = abs(yy - ly);
  float along = texture(uTex, vec2(sq.x / 2400.0, jj * 0.0371 + 0.5)).b;
  float lineDen = mix(0.72, 1.0, lh) * clamp(0.72 + 0.5 * smoothstep(0.25, 0.75, along), 0.0, 1.0);
  float hw = (0.5 + (s.g - 0.5) * 0.14) * (1.0 + 0.6 * soft);
  float covB = ok * ink * lineDen
             * ((1.0 - 0.4 * soft) * cover(dy, hw, px) + (0.08 + 0.22 * soft) * cover(dy, hw * 3.0, px));
  alb *= mix(vec3(1.0), vec3(0.51, 0.69, 0.88), clamp(covB, 0.0, 1.0));

  float dx = abs(q.x - uRule.w + (s.b - 0.5) * 0.18);
  float covR = ink * (cover(dx, 0.62, px) + 0.08 * cover(dx, 1.9, px));
  alb *= mix(vec3(1.0), vec3(0.93, 0.5, 0.55), clamp(covR, 0.0, 1.0));

  // Punch rims crush the fibres; cut edges sit a touch darker.
  alb *= 1.0 - 0.1 * exp(-max(dh, 0.0) / 0.9) * holeOn;
  alb *= 1.0 - 0.035 * exp(d0 / 4.0);

  // ---- pencil ----
  float graphite = 0.0;
  if (inkSize.x > 0.0) {
    vec2 uv = qi / inkSize;
    vec4 k = texture(inkTex, uv);
    // Graphite only marks the peaks of the tooth under light pressure, so
    // strokes are flecked with paper; pressed harder, it fills the valleys.
    float peaks = smoothstep(0.3, 0.68, s.r + (hash12(floor(sq * 2.0)) - 0.5) * 0.3);
    float a = min(1.0, k.a * 1.15) * mix(mix(0.7, 1.0, peaks), 1.0, smoothstep(0.4, 0.9, k.a));
    vec3 c = k.rgb / max(k.a, 1e-4);
    // A hand resting on the page smears the odd line a little to the right.
    float Lr = uRule.x;
    float row = floor(qi.y / Lr);
    float smearOn = step(0.72, hash12(vec2(row, seed + 2.7)));
    vec2 tx = 1.0 / inkSize;
    float smear = (texture(inkTex, uv - tx * vec2(5.0, -1.0)).a + texture(inkTex, uv - tx * vec2(12.0, -2.0)).a) * 0.5;
    smear *= smearOn * smoothstep(0.2, 0.8, texture(uTex, vec2(q.x / 900.0, row * 0.071 + seed * 0.01)).b);
    alb *= 1.0 - 0.07 * smear * inkAmt;
    alb *= mix(vec3(1.0), c, a * inkAmt);
    graphite = a * step(0.99, inkAmt);
  }
  // A reader's doodles, laid into the tooth the same way.
  if (doodleOn > 0.5 && uDoodleSize.x > 0.0) {
    vec4 k = texture(uDoodle, qi / uDoodleSize);
    float peaks = smoothstep(0.3, 0.68, s.r + (hash12(floor(sq * 2.0)) - 0.5) * 0.3);
    float a = min(1.0, k.a * 1.15) * mix(mix(0.6, 1.0, peaks), 1.0, smoothstep(0.5, 0.95, k.a));
    alb *= mix(vec3(1.0), k.rgb / max(k.a, 1e-4), a);
    graphite = max(graphite, a);
  }

  // ---- paper relief ----
  float h0 = relief(s);
  float hx = relief(stock(sq + vec2(0.5, 0.0))) - h0;
  float hy = relief(stock(sq + vec2(0.0, 0.5))) - h0;
  vec3 n = normalize(vec3(-hx * 1.6, -hy * 1.6, 1.0));
  vec3 Ll = L;
  // How hard the light rakes across the tooth. A low sun would exaggerate
  // it (relief shading grows with the light's slant), so it's held to what
  // a midday light shows: the grain reads, but never as a texture overlay.
  float slant = min(1.0, 1.25 * Ll.z / max(length(Ll.xy), 1e-3));
  float rake = mix(0.08 + 0.3 * sun, 0.08 + 0.25 * lamp, uDark) * slant;
  float shade = 1.0 + (dot(n, Ll) / Ll.z - 1.0) * rake;

  // Slow undulation: the sheet is never perfectly flat.
  float ax = stock(sq + vec2(7.0, 0.0)).a - s.a;
  float ay = stock(sq + vec2(0.0, 7.0)).a - s.a;
  shade *= 1.0 + (-ax * Ll.x - ay * Ll.y) / Ll.z * 0.35 * slant;
  // A slight bow across the width from sitting in a binder.
  shade *= 1.0 - 0.03 * (q.x / (hs.x * 2.0) - 0.5);
  // The lifted corner tilts toward or away from the light.
  vec2 gz = vec2(restLift(q + vec2(2.0, 0.0), hs, seed) - restLift(q - vec2(2.0, 0.0), hs, seed),
                 restLift(q + vec2(0.0, 2.0), hs, seed) - restLift(q - vec2(0.0, 2.0), hs, seed)) / 4.0;
  shade *= 1.0 - dot(gz, Ll.xy) / Ll.z;

  // The writing on the page above was pressed into this one: soft grooves,
  // lit on the side away from the light and shaded on the near side.
  if (prevSize.x > 0.0) {
    // Wide taps: a groove under paper is soft, never a crisp copy.
    vec2 uv = qi / prevSize;
    vec2 e = 2.6 / prevSize;
    float gx = texture(prevInk, uv + vec2(e.x, 0.0)).a - texture(prevInk, uv - vec2(e.x, 0.0)).a;
    float gy = texture(prevInk, uv + vec2(0.0, e.y)).a - texture(prevInk, uv - vec2(0.0, e.y)).a;
    shade *= 1.0 + dot(vec2(gx, gy), Ll.xy) / Ll.z * 0.0055;
  }

  // The cut edge catches the light on the side facing it.
  vec2 de = abs(q - hs) - hs;
  vec2 en = de.x > de.y ? vec2(sign(q.x - hs.x), 0.0) : vec2(0.0, sign(q.y - hs.y));
  shade *= 1.0 + 0.07 * dot(en, -normalize(Ll.xy)) * exp(d0 / 0.7);

  o.col = alb * light * shade;

  // Graphite is faintly metallic. Where the light glances off it toward
  // the eye it turns silver-grey while the paper stays matte. The light
  // sits up beside the page where the pointer is, the eye above the middle
  // of the screen, so the glint slides over the writing as the pointer
  // moves, the way it does when a page is tilted under a lamp.
  if (graphite > 0.0) {
    vec3 lp = vec3(uMouse * uView, uView.y * 0.55);
    vec3 ep = vec3(uView * 0.5, uView.y * 1.6);
    vec3 H = normalize(normalize(lp - vec3(p, 0.0)) + normalize(ep - vec3(p, 0.0)));
    float spec = pow(max(dot(normalize(vec3(n.xy * 3.0, 1.0)), H), 0.0), 64.0);
    o.col += vec3(0.62, 0.64, 0.68) * spec * graphite * 0.7 * mix(1.0, 0.5, uDark);
  }
  return o;
}

// A note that runs over several sheets lies as a stack down the desk, one
// under the next with a little desk between. r spans the whole stack and st
// is each sheet's height and the gap (st.x = 0: just the one sheet). Each is
// drawn in its own frame, with its own edges, shadow, rules and grain, and
// its writing read from where it falls in the stack's.
Sheet stacked(vec2 p, vec4 r, vec2 st, float seed, vec3 L, vec3 light, float sun, float lamp, float px,
              sampler2D inkTex, vec2 inkSize, float inkAmt, sampler2D prevInk, vec2 prevSize, float doodleOn) {
  if (st.x <= 0.0) return sheet(p, r, seed, L, light, sun, lamp, px, inkTex, inkSize, inkAmt, prevInk, prevSize, doodleOn, 0.0);
  float P = st.x + st.y;
  float n = max(1.0, floor((2.0 * r.w + st.y) / P + 0.5));
  float y = p.y - (r.y - r.w);
  float i = clamp(floor(y / P), 0.0, n - 1.0);
  float top = r.y - r.w;
  Sheet a = sheet(p, vec4(r.x, top + i * P + st.x * 0.5, r.z, st.x * 0.5), seed + i * 17.0, L, light, sun, lamp, px,
                  inkTex, inkSize, inkAmt, prevInk, prevSize, doodleOn, i * P);
  // Near a gap, the neighbour's edge and shadow reach across it too.
  float local = y - i * P;
  float j = local > st.x - 90.0 ? i + 1.0 : local < 90.0 ? i - 1.0 : -1.0;
  if (j < 0.0 || j > n - 1.0) return a;
  Sheet b = sheet(p, vec4(r.x, top + j * P + st.x * 0.5, r.z, st.x * 0.5), seed + j * 17.0, L, light, sun, lamp, px,
                  inkTex, inkSize, inkAmt, prevInk, prevSize, doodleOn, j * P);
  Sheet o;
  o.a = clamp(a.a + b.a, 0.0, 1.0);
  o.col = (a.col * a.a + b.col * b.a) / max(a.a + b.a, 1e-4);
  o.under = 1.0 - (1.0 - a.under) * (1.0 - b.under);
  return o;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float px = 1.0 / uDpr;
  vec2 m = uMouse - 0.5;
  vec2 uv = p / uView;
  float amb = mix(1.0, 0.86, clamp(dot(uv, vec2(0.5, 0.6)), 0.0, 1.0));
  amb *= 1.0 - 0.22 * pow(length((uv - vec2(0.45, 0.4)) * vec2(1.0, 0.85)), 2.2);
  vec2 lampC = vec2(uView.x * 0.5, uMain.y - uMain.w + min(uView.y * 0.35, 260.0));
  float lamp = exp(-pow(length(p - lampC) / (uView.y * 0.85), 2.0) * 1.4);

  // ---- room light ----
  // Each light sets where it comes from (L, nudged by the pointer), its
  // colour across the scene, how much it rakes across the paper's tooth
  // (sun), and how hard the sheet's shadow is.
  vec3 L;
  vec3 light;
  float sun = 0.0;
  float shadowK = 1.0;
  // Sunlight warms toward the ends of the day; the sun swings round with it.
  vec3 sunCol = mix(vec3(1.0, 0.94, 0.84), vec3(1.0, 0.8, 0.56), uDay.y);
  float sunX = -0.6 - 0.22 * uDay.x;
  if (uLight == 1) {
    // Overcast: a big window off to the left, no sun. Even, cool, soft.
    L = normalize(vec3(-0.75 + m.x * 0.4, -0.25 + m.y * 0.4, 0.95));
    light = vec3(0.975, 0.985, 1.0) * mix(1.05, 0.86, smoothstep(-0.1, 1.1, uv.x)) * (1.0 - 0.1 * pow(length(uv - 0.45), 2.0));
    sun = 0.22;
    shadowK = 0.6;
  } else if (uLight == 2) {
    // Golden hour: low warm sun stretched across the desk, blue in the shade.
    L = normalize(vec3(-0.9 + m.x * 0.4, -0.32 + m.y * 0.4, 0.4));
    sun = goldenLight(p);
    light = vec3(0.88, 0.9, 0.97) * 0.85 * amb + vec3(1.0, 0.76, 0.48) * sun * 0.5;
    shadowK = 1.25;
  } else if (uLight == 3) {
    // Blinds: midday through venetian slats.
    L = normalize(vec3(sunX + 0.05 + m.x * 0.5, -0.8 + m.y * 0.5, 0.6));
    sun = blindsLight(p);
    light = vec3(1.0, 0.99, 0.98) * 0.92 * amb + sunCol * sun * 0.32;
  } else if (uLight == 4) {
    // Desk lamp in a dim room: a warm pool from above the page.
    L = normalize(vec3(m.x * 0.6, -0.35 + m.y * 0.6, 0.85));
    light = vec3(1.0, 0.9, 0.76) * (0.32 + 0.78 * lamp);
    shadowK = 0.9;
  } else if (uLight == 5) {
    // Night: the lamp alone.
    L = normalize(vec3(-0.6 + m.x * 0.5, -0.8 + m.y * 0.5, 0.62));
    light = vec3(1.0, 0.94, 0.86) * (0.1 + 0.84 * lamp);
  } else if (uLight == 6) {
    // Studio: flat, even, from high in front, like a scan.
    L = normalize(vec3(-0.25 + m.x * 0.3, -0.45 + m.y * 0.3, 0.95));
    light = vec3(1.0) * (1.0 - 0.05 * pow(length(uv - 0.5), 2.0));
    sun = 0.12;
    shadowK = 0.45;
  } else if (uLight == 7) {
    // Moonlight, with the room's own light low and warm behind it.
    L = normalize(vec3(0.55 + m.x * 0.4, -0.7 + m.y * 0.4, 0.7));
    sun = moonLight(p);
    light = vec3(0.88, 0.91, 1.0) * 0.84 * amb + vec3(0.72, 0.82, 1.0) * sun * 0.2;
    shadowK = 0.8;
  } else {
    // Window: midday sun through a four-light window, leaves outside.
    L = normalize(vec3(sunX + m.x * 0.5, -0.8 + m.y * 0.5, 0.62));
    sun = windowLight(p);
    light = vec3(1.0, 0.995, 0.985) * amb + sunCol * sun * 0.28;
  }

  vec3 col = desk(p) * light;

  // ---- the pile: resting sheet, then the one in flight ----
  // Each sheet is drawn in its own frame, turned by its tilt, with the
  // light turned to match.
  Sheet a = stacked(untilt(p, uMain.xy, uTilt.x), uMain, uStack, uMainSeed, tiltL(L, uTilt.x), light, sun, lamp, px,
                    uInkMain, uInkSize.xy, 1.0, uInkPrev, uPrevSize, 1.0);
  col = mix(col * (1.0 - a.under * shadowK), a.col, a.a);

  // ---- page flip ----
  if (uFlipInfo.x > 0.5) {
    // The top sheet is lifted past a fold line and bends over a cylinder
    // of radius uCurl (paper is stiff, so it bows rather than creases): up
    // the near side showing its face, over the top, and back down showing
    // its back, which then lies over the part still flat. Paper doesn't
    // stretch, so each screen point maps back to the paper point that lands
    // there; the back is drawn over the face because it's higher. The bend
    // is lit by its slope, and everything lifted throws a soft shadow away
    // from the light, softer the higher it rides.
    const float PI = 3.14159265;
    vec2 p = untilt(p, uFlip.xy, uTilt.y);
    vec3 L = tiltL(L, uTilt.y);
    vec2 F = uFold.xy, n = uFold.zw;
    float R = max(uCurl, 0.5);
    float dp = dot(p - F, n);
    vec2 foot = p - n * dp;
    vec2 hs = uFlip.zw;
    vec2 c = uFlip.xy;
    vec2 toLight = L.xy / L.z;   // something at height z shadows the point -toLight * z from it

    float edge = clamp((R - dp) / px + 0.5, 0.0, 1.0);   // the bend's far silhouette
    float onRoll = step(0.0, dp);
    float a = asin(clamp(dp / R, 0.0, 1.0));            // 0 flat .. pi/2 at the silhouette

    // How high the lifted paper rides: the far corner past the fold, carried
    // up the bend (all the way over, at most two radii). A corner just
    // raised is only a few px off the page, and so is its shadow.
    float dmax = max(max(dot(c - hs - F, n), dot(c + vec2(hs.x, -hs.y) - F, n)),
                     max(dot(c + vec2(-hs.x, hs.y) - F, n), dot(c + hs - F, n)));
    float H = dmax < PI * R ? R * (1.0 - cos(max(dmax, 0.0) / R)) : 2.0 * R;

    // Under the lifted paper the page below sees less of the room: a soft
    // occlusion where paper is overhead, growing from nothing at the fold
    // (where the paper still touches) so it never draws a line there.
    float crest = 1.0 - smoothstep(-2.0, 0.4 * R, sdBox(foot + n * (R * 1.5708) - c, hs));
    float overhead = smoothstep(0.0, 0.6 * R, dp) * exp(-max(dp - R, 0.0) / (0.5 * R + 3.0));
    col *= 1.0 - 0.14 * min(H / 12.0, 1.0) * overhead * crest;

    // Cast shadow: how much lifted paper lies between this point and the
    // light. The paper rides at every height from the fold up to H, so look
    // at three and average: a broad, soft-edged shadow rather than a hard
    // band.
    float lifted = 0.0;
    for (int i = 0; i < 3; i++) {
      float z = H * (0.22 + 0.35 * float(i));
      vec2 p2 = p + toLight * z;
      float dp2 = dot(p2 - F, n);
      vec2 f2 = p2 - n * dp2;
      float a2 = asin(clamp(dp2 / R, 0.0, 1.0));
      float soft = 0.25 * z + 4.0;
      float inR = 1.0 - smoothstep(R - soft, R + soft, dp2);
      float rollIn = (1.0 - smoothstep(-soft, soft, sdBox(f2 + n * (R * a2) - c, hs))) * smoothstep(0.0, soft, dp2) * inR;
      vec2 qB2 = f2 + n * mix(PI * R - dp2, R * (PI - a2), step(0.0, dp2));
      float backIn = (1.0 - smoothstep(-soft, soft, sdBox(qB2 - c, hs))) * inR;
      lifted += max(rollIn, backIn);
    }
    float shadow = 0.17 * lifted / 3.0;
    col *= 1.0 - shadow;

    // Face: flat before the fold, then rising up the near side of the bend.
    vec2 qF = foot + n * mix(dp, R * a, onRoll);
    Sheet front = stacked(qF, uFlip, uStackF, uFlipInfo.y, L, light, sun, lamp, px, uInkFlip, uInkSize.zw, 1.0, uInkFlip, vec2(0.0), 0.0);
    float litF = mix(1.0 - shadow, bendLight(vec3(-n * sin(a), cos(a)), L), onRoll);
    col = mix(col, front.col * litF, front.a * edge);

    // Back: over the top of the bend, then turned back over the sheet.
    float aB = mix(PI, PI - a, onRoll);
    vec2 qB = foot + n * mix(PI * R - dp, R * aB, onRoll);
    // The writing on the face shows through faintly, mirrored.
    Sheet back = stacked(qB, uFlip, uStackF, uFlipInfo.y, L, light, sun, lamp, px, uInkFlip, uInkSize.zw, 0.08, uInkFlip, vec2(0.0), 0.0);
    float litB = bendLight(vec3(n * sin(aB), -cos(aB)), L);
    col = mix(col, back.col * litB, back.a * edge);
  }

  col = shoulder(col);
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) || "shader compile failed");
  }
  return sh;
}

function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || "program link failed");
  }
  return p;
}

export function createPaper(canvas) {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  let state;
  let doodleTex = null;
  let doodleSize = [0, 0];

  function init() {
    // A restored context has lost every texture, doodles included.
    doodleTex = null;
    doodleSize = [0, 0];
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    // Bake the stock texture.
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, Math.log2(TILE_TEXELS) + 1, gl.RGBA8, TILE_TEXELS, TILE_TEXELS);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const bake = program(gl, BAKE);
    gl.viewport(0, 0, TILE_TEXELS, TILE_TEXELS);
    gl.useProgram(bake);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteProgram(bake);

    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    const prog = program(gl, FRAG);
    gl.useProgram(prog);
    const u = {};
    for (const name of [
      "uTex", "uRes", "uDpr", "uView", "uMain", "uMainSeed", "uTilt", "uFlip", "uFold", "uCurl", "uFlipInfo",
      "uRule", "uHole", "uInch", "uMouse", "uTime", "uDark", "uBg", "uLight", "uDay", "uInkMain", "uInkFlip", "uInkSize", "uInkPrev", "uPrevSize", "uDoodle", "uDoodleSize", "uStack", "uStackF",
    ]) {
      u[name] = gl.getUniformLocation(prog, name);
    }
    gl.uniform1i(u.uTex, 0);
    gl.uniform1i(u.uInkMain, 1);
    gl.uniform1i(u.uInkFlip, 2);
    gl.uniform1i(u.uInkPrev, 4);
    gl.uniform1i(u.uDoodle, 5);

    // Bound wherever a sheet has no ink yet.
    const blank = gl.createTexture();
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.activeTexture(gl.TEXTURE0);
    gen++;
    state = { u, blank };
  }

  // Ink textures die with the context; a handle from before a restore is
  // treated as no ink.
  let gen = 0;
  const live = (h) => h && h.gen === gen;

  init();

  canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
  canvas.addEventListener("webglcontextrestored", init);

  return {
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    ink(bitmap, w, h) {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.activeTexture(gl.TEXTURE0);
      return { tex, w, h, gen };
    },
    // The reader's doodles: a canvas the size of the sheet in CSS px times
    // its pixel ratio, re-sent whenever a stroke grows. null clears it.
    doodle(src, w, h) {
      if (!src) {
        doodleSize = [0, 0];
        return;
      }
      doodleTex ??= gl.createTexture();
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, doodleTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.activeTexture(gl.TEXTURE0);
      doodleSize = [w, h];
    },
    freeInk(h) {
      if (live(h)) gl.deleteTexture(h.tex);
    },
    resize(w, h, dpr) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    },
    draw(f) {
      if (gl.isContextLost()) return;
      const { u } = state;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform1f(u.uDpr, canvas.width / f.view[0]);
      gl.uniform2f(u.uView, f.view[0], f.view[1]);
      gl.uniform4f(u.uMain, ...f.main);
      gl.uniform1f(u.uMainSeed, f.mainSeed);
      gl.uniform2f(u.uTilt, ...(f.tilt ?? [0, 0]));
      gl.uniform4f(u.uFlip, ...f.flip);
      gl.uniform4f(u.uFold, ...f.fold);
      gl.uniform1f(u.uCurl, f.curl ?? 0);
      gl.uniform2f(u.uFlipInfo, ...f.flipInfo);
      gl.uniform4f(u.uRule, ...f.rule);
      gl.uniform4f(u.uHole, ...f.hole);
      gl.uniform1f(u.uInch, f.inch);
      gl.uniform2f(u.uMouse, ...f.mouse);
      gl.uniform1f(u.uTime, f.time);
      gl.uniform1f(u.uDark, f.dark);
      gl.uniform1i(u.uBg, f.bg ?? 0);
      gl.uniform1i(u.uLight, f.light ?? 0);
      gl.uniform2f(u.uDay, ...(f.day ?? [0, 0]));
      gl.uniform2f(u.uStack, ...(f.stack ?? [0, 0]));
      gl.uniform2f(u.uStackF, ...(f.stackFlip ?? [0, 0]));
      const m = live(f.inkMain) ? f.inkMain : null;
      const k = live(f.inkFlip) ? f.inkFlip : null;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, m ? m.tex : state.blank);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, k ? k.tex : state.blank);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform4f(u.uInkSize, m ? m.w : 0, m ? m.h : 0, k ? k.w : 0, k ? k.h : 0);
      const v = live(f.inkPrev) ? f.inkPrev : null;
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, v ? v.tex : state.blank);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(u.uPrevSize, v ? v.w : 0, v ? v.h : 0);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, doodleSize[0] ? doodleTex : state.blank);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(u.uDoodleSize, ...doodleSize);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
