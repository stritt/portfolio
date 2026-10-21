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
uniform vec4 uFlip;     // sheet being flipped, same layout
uniform vec4 uFold;     // fold line: point x, y; unit normal x, y (toward the lifted side)
uniform vec2 uFlipInfo; // active, seed
uniform vec4 uRule;     // spacing, first rule y, bottom margin, margin line x
uniform vec4 uHole;     // centre x, radius, spacing, enabled
uniform float uInch;    // one inch at the sheet's scale, CSS px
uniform vec2 uMouse;    // 0..1
uniform float uTime;
uniform float uDark;
uniform sampler2D uInkMain; // each sheet's pencil, drawn by ink-worker.js
uniform sampler2D uInkFlip;
uniform vec4 uInkSize;      // main w, h; flip w, h (CSS px; 0 = no ink yet)
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

// Sun through a four-light window, thrown across the desk at an angle.
float windowLight(vec2 p) {
  vec2 v = p / uView.y;
  vec2 w = mat2(1.0, -0.2, 0.42, 1.0) * v;
  w -= vec2(-0.12, 0.06) + 0.015 * vec2(sin(uTime * 0.05), cos(uTime * 0.037));
  vec2 size = vec2(0.95, 1.2);
  float s = 0.12;
  float m = smoothstep(0.0, s, w.x) * smoothstep(0.0, s, size.x - w.x)
          * smoothstep(0.0, s, w.y) * smoothstep(0.0, s, size.y - w.y);
  vec2 cells = vec2(2.0, 2.0);
  vec2 f = abs(fract(w / size * cells) - 0.5);
  vec2 dl = (0.5 - f) * size / cells;
  float bar = 0.012;
  m *= mix(0.45, 1.0, smoothstep(bar, bar + s, dl.x) * smoothstep(bar, bar + s, dl.y));
  // Leaves outside the glass, drifting.
  float leaf = texture(uTex, p / T * 0.55 + vec2(uTime * 0.0021, uTime * 0.0013)).a;
  m *= mix(0.78, 1.0, smoothstep(0.38, 0.62, leaf));
  return m;
}

// Pencil on a sheet: premultiplied, sheet-local, multiplied into the paper
// the way graphite darkens it.
vec3 ink(sampler2D t, vec2 q, vec2 size) {
  if (size.x <= 0.0) return vec3(1.0);
  vec2 uv = q / size;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec3(1.0);
  vec4 k = texture(t, uv);
  return vec3(1.0 - k.a) + k.rgb;
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
Sheet sheet(vec2 p, vec4 r, float seed, vec3 L, vec3 light, float sun, float lamp, float px) {
  Sheet o;
  vec2 hs = r.zw;
  vec2 q = p - r.xy + hs;   // sheet-local, origin top-left
  float d0 = sdBox(q - hs, hs);

  vec2 so = -L.xy / L.z;    // shadows fall away from the light
  float sh = 0.15 * (1.0 - smoothstep(-1.0, 3.0, sdBox(q - hs - so * 0.8, hs)))
           + 0.09 * (1.0 - smoothstep(-14.0, 26.0, sdBox(q - hs - so * 4.0, hs)))
           + 0.06 * (1.0 - smoothstep(-50.0, 120.0, sdBox(q - hs - so * 12.0 - vec2(0.0, 6.0), hs)));

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

  float onSheet = clamp(0.5 - d0 / px, 0.0, 1.0);
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

  // ---- paper relief ----
  float h0 = relief(s);
  float hx = relief(stock(sq + vec2(0.5, 0.0))) - h0;
  float hy = relief(stock(sq + vec2(0.0, 0.5))) - h0;
  vec3 n = normalize(vec3(-hx * 1.6, -hy * 1.6, 1.0));
  vec3 Ll = L;
  float rake = mix(0.09 + 0.45 * sun, 0.08 + 0.25 * lamp, uDark);
  float shade = 1.0 + (dot(n, Ll) / Ll.z - 1.0) * rake;

  // Slow undulation: the sheet is never perfectly flat.
  float ax = stock(sq + vec2(7.0, 0.0)).a - s.a;
  float ay = stock(sq + vec2(0.0, 7.0)).a - s.a;
  shade *= 1.0 + (-ax * Ll.x - ay * Ll.y) / Ll.z * 0.35;
  // A slight bow across the width from sitting in a binder.
  shade *= 1.0 - 0.03 * (q.x / (hs.x * 2.0) - 0.5);

  o.col = alb * light * shade;
  return o;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float px = 1.0 / uDpr;
  vec2 m = uMouse - 0.5;
  vec3 L = normalize(vec3(-0.6 + m.x * 0.5, -0.8 + m.y * 0.5, 0.62));

  // ---- room light ----
  vec2 uv = p / uView;
  float amb = mix(1.0, 0.86, clamp(dot(uv, vec2(0.5, 0.6)), 0.0, 1.0));
  amb *= 1.0 - 0.22 * pow(length((uv - vec2(0.45, 0.4)) * vec2(1.0, 0.85)), 2.2);
  float sun = (1.0 - uDark) * windowLight(p);
  vec2 lampC = vec2(uView.x * 0.5, uMain.y - uMain.w + min(uView.y * 0.35, 260.0));
  float lamp = exp(-pow(length(p - lampC) / (uView.y * 0.85), 2.0) * 1.4);
  vec3 light = mix(vec3(1.0, 0.995, 0.985) * amb + vec3(1.0, 0.9, 0.74) * sun * 0.28,
                   vec3(1.0, 0.94, 0.86) * (0.1 + 0.84 * lamp), uDark);

  // ---- desk ----
  vec4 ds = stock(p * 1.4 + 517.0);
  vec3 desk = mix(vec3(0.75, 0.735, 0.70), vec3(0.24, 0.23, 0.22), uDark);
  desk *= 0.92 + 0.12 * ds.r + 0.08 * (ds.b - 0.5) + 0.05 * (ds.g - 0.5);
  vec3 col = desk * light;

  // ---- the pile: resting sheet, then the one in flight ----
  Sheet a = sheet(p, uMain, uMainSeed, L, light, sun, lamp, px);
  a.col *= ink(uInkMain, p - uMain.xy + uMain.zw, uInkSize.xy);
  col = mix(col * (1.0 - a.under), a.col, a.a);

  // ---- page flip ----
  // The top sheet is folded along a line. Past the line (dp > 0) it has
  // lifted away, uncovering what's beneath; before it (dp < 0) it lies flat.
  // The lifted part is mirrored across the line and lies on top: the flap,
  // showing the sheet's back. A crisp fold would read as origami, so the
  // flap is shaded as a curl: dim at the bend, with a bright rim on top.
  if (uFlipInfo.x > 0.5) {
    vec2 F = uFold.xy, n = uFold.zw;
    float dp = dot(p - F, n);
    vec2 hs = uFlip.zw;
    vec2 c = uFlip.xy;

    // The uncovered page sits in the lifted sheet's shadow near the fold.
    float inFlip = 1.0 - smoothstep(0.0, 24.0, sdBox(p - c, hs));
    col *= 1.0 - 0.3 * exp(-max(dp, 0.0) / 26.0) * step(0.0, dp) * inFlip;

    Sheet front = sheet(p, uFlip, uFlipInfo.y, L, light, sun, lamp, px);
    front.col *= ink(uInkFlip, p - c + hs, uInkSize.zw);
    col = mix(col, front.col, front.a * clamp(0.5 - dp / px, 0.0, 1.0));

    // The flap's shadow falls on everything under it, offset from the light.
    vec2 x2 = p - (-L.xy / L.z) * 7.0;
    float d2 = dot(x2 - F, n);
    vec2 r2 = x2 - 2.0 * d2 * n;
    float sdFlap = max(sdBox(r2 - c, hs), d2);
    float flapSh = 0.24 * (1.0 - smoothstep(-6.0, 30.0, sdFlap));

    vec2 pr = p - 2.0 * dp * n;
    Sheet back = sheet(pr, uFlip, uFlipInfo.y, L, light, sun, lamp, px);
    // The writing on the front shows through faintly, mirrored.
    back.col *= mix(vec3(1.0), ink(uInkFlip, pr - c + hs, uInkSize.zw), 0.1);
    float flapA = back.a * clamp(0.5 - dp / px, 0.0, 1.0);
    col *= 1.0 - flapSh * (1.0 - flapA);

    float bend = max(-dp, 0.0);   // clamped: exp() past the fold would overflow to inf, and inf * 0 is NaN
    float curl = mix(0.84, 1.0, smoothstep(0.0, 70.0, bend)) + 0.08 * exp(-bend / 4.0);
    col = mix(col, back.col * 0.975 * curl, flapA);
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

  function init() {
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
      "uTex", "uRes", "uDpr", "uView", "uMain", "uMainSeed", "uFlip", "uFold", "uFlipInfo",
      "uRule", "uHole", "uInch", "uMouse", "uTime", "uDark", "uInkMain", "uInkFlip", "uInkSize",
    ]) {
      u[name] = gl.getUniformLocation(prog, name);
    }
    gl.uniform1i(u.uTex, 0);
    gl.uniform1i(u.uInkMain, 1);
    gl.uniform1i(u.uInkFlip, 2);

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
      gl.uniform4f(u.uFlip, ...f.flip);
      gl.uniform4f(u.uFold, ...f.fold);
      gl.uniform2f(u.uFlipInfo, ...f.flipInfo);
      gl.uniform4f(u.uRule, ...f.rule);
      gl.uniform4f(u.uHole, ...f.hole);
      gl.uniform1f(u.uInch, f.inch);
      gl.uniform2f(u.uMouse, ...f.mouse);
      gl.uniform1f(u.uTime, f.time);
      gl.uniform1f(u.uDark, f.dark);
      const m = live(f.inkMain) ? f.inkMain : null;
      const k = live(f.inkFlip) ? f.inkFlip : null;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, m ? m.tex : state.blank);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, k ? k.tex : state.blank);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform4f(u.uInkSize, m ? m.w : 0, m ? m.h : 0, k ? k.w : 0, k ? k.h : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
