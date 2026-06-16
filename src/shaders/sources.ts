/**
 * Shared GLSL source strings for WebGLImageProcessor.
 * Single source of truth — imported by WebGLImageProcessor and any future
 * pipeline that must compile the EXACT same shaders (so GPU self-checks remain meaningful).
 * No logic lives here; only raw GLSL string constants.
 */

export const VERT_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// Exposure: subtract black level (clamp-at-0), multiply by gain (2^stops), clamp to [0,1].
// Matches ExposureModule.processWithContext exactly: max(0, v-black)*gain, then clamp.
// u_gain  = pow(2, stops) — caller pre-computes.
// u_black = black-level offset (default 0 = no black adjustment).
export const FRAG_EXPOSURE = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform float u_gain;
uniform float u_black;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec4 c = texture(u_image, v_uv);
  vec3 rgb = clamp(max(c.rgb - u_black, 0.0) * u_gain, 0.0, 1.0);
  outColor = vec4(rgb, c.a);
}`;

// Per-channel gains + clamp (white balance applies pre-computed R/G/B factors).
export const FRAG_GAINS = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec3 u_gains;
in vec2 v_uv;
out vec4 outColor;
void main() { vec4 c = texture(u_image, v_uv); outColor = vec4(clamp(c.rgb * u_gains, 0.0, 1.0), c.a); }`;

// Non-Local Means denoise — a fast GPU replacement for the slow CPU BM3D/NLMeans.
// Each output pixel is a weighted average of its search-window neighbours, weighted
// by 3x3-patch similarity. Runs sub-second even on RAW (GPU does the gather).
export const FRAG_DENOISE = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_texel;   // (1/width, 1/height)
uniform float u_h2;     // filter strength denominator
in vec2 v_uv;
out vec4 outColor;
const int R = 4;        // search radius -> 9x9 window
const int P = 1;        // patch radius  -> 3x3 patch
void main() {
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int dy = -R; dy <= R; dy++) {
    for (int dx = -R; dx <= R; dx++) {
      vec2 off = vec2(float(dx), float(dy)) * u_texel;
      float dist = 0.0;
      for (int py = -P; py <= P; py++) {
        for (int px = -P; px <= P; px++) {
          vec2 po = vec2(float(px), float(py)) * u_texel;
          vec3 d = texture(u_image, v_uv + po).rgb - texture(u_image, v_uv + off + po).rgb;
          dist += dot(d, d);
        }
      }
      float w = exp(-dist / u_h2);
      sum += texture(u_image, v_uv + off).rgb * w;
      wsum += w;
    }
  }
  outColor = vec4(sum / max(wsum, 1e-6), texture(u_image, v_uv).a);
}`;

// Color Balance: 3-range tonal shift (shadows/midtones/highlights) + 8-hue HSL.
// Mirrors ColorBalanceModule + ColorUtils rgbToHsl/hslToRgb exactly.
export const FRAG_COLORBALANCE = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec3 u_shadows, u_mid, u_high;   // (cyan_red, magenta_green, yellow_blue)
uniform float u_sat[8];
uniform float u_lum[8];
uniform float u_hue[8];
in vec2 v_uv;
out vec4 outColor;

float tonal(float l, int r) {
  if (r == 0) return l < 0.33 ? 1.0 : max(0.0, (0.66 - l) / 0.33);
  if (r == 1) return (l >= 0.33 && l <= 0.66) ? 1.0 : (l < 0.33 ? max(0.0, l / 0.33) : max(0.0, (1.0 - l) / 0.34));
  return l > 0.66 ? 1.0 : max(0.0, (l - 0.33) / 0.33);
}
float cwRange(float h, float a, float b) {
  if (h >= a && h <= b) return 1.0;
  return max(0.0, 1.0 - min(abs(h - a), abs(h - b)) / 30.0);
}
float colorWeight(float h, int i) {
  if (i == 0) {
    if ((h >= 345.0 && h <= 360.0) || (h >= 0.0 && h <= 15.0)) return 1.0;
    return max(0.0, 1.0 - min(min(abs(h - 345.0), abs(h - 360.0)), min(abs(h), abs(h - 15.0))) / 30.0);
  }
  vec2 r = i == 1 ? vec2(15.0, 45.0) : i == 2 ? vec2(45.0, 75.0) : i == 3 ? vec2(75.0, 165.0)
         : i == 4 ? vec2(165.0, 195.0) : i == 5 ? vec2(195.0, 255.0) : i == 6 ? vec2(255.0, 285.0) : vec2(285.0, 345.0);
  return cwRange(h, r.x, r.y);
}
vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float diff = mx - mn, sum = mx + mn, h = 0.0, l = sum / 2.0, s = 0.0;
  if (diff != 0.0) {
    s = l > 0.5 ? diff / (2.0 - sum) : diff / sum;
    if (mx == c.r) h = (c.g - c.b) / diff + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / diff + 2.0;
    else h = (c.r - c.g) / diff + 4.0;
    h /= 6.0;
  }
  return vec3(h * 360.0, s * 100.0, l * 100.0);
}
vec3 hsl2rgb(float h, float s, float l) {
  h = mod(mod(h, 360.0) + 360.0, 360.0);
  s = clamp(s, 0.0, 100.0) / 100.0;
  l = clamp(l, 0.0, 100.0) / 100.0;
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float x = c * (1.0 - abs(mod(h / 60.0, 2.0) - 1.0));
  float m = l - c / 2.0;
  vec3 rgb = h < 60.0 ? vec3(c, x, 0.0) : h < 120.0 ? vec3(x, c, 0.0) : h < 180.0 ? vec3(0.0, c, x)
           : h < 240.0 ? vec3(0.0, x, c) : h < 300.0 ? vec3(x, 0.0, c) : vec3(c, 0.0, x);
  return rgb + m;
}
void main() {
  vec4 src = texture(u_image, v_uv);
  vec3 rgb = src.rgb;
  float lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
  float ws = tonal(lum, 0); if (ws > 0.01) rgb += u_shadows * ws * 0.1;
  float wm = tonal(lum, 1); if (wm > 0.01) rgb += u_mid * wm * 0.1;
  float wh = tonal(lum, 2); if (wh > 0.01) rgb += u_high * wh * 0.1;
  rgb = clamp(rgb, 0.0, 1.0);
  vec3 hsl = rgb2hsl(rgb);
  float nh = hsl.x, ns = hsl.y, nl = hsl.z;
  for (int i = 0; i < 8; i++) {
    float w = colorWeight(hsl.x, i);
    if (w > 0.01) { nh += u_hue[i] * w; ns += u_sat[i] * w; nl += u_lum[i] * w; }
  }
  outColor = vec4(clamp(hsl2rgb(nh, ns, nl), 0.0, 1.0), src.a);
}`;

// Tone Curve: base curve (luminance-preserve or per-channel) then per-channel RGB
// curves. The 65536-entry LUTs are uploaded as 256x256 R32F textures; floor(v*65535)
// indexes the exact texel (NEAREST). Mirrors ToneCurveModule (Rec.709 luma).
export const FRAG_TONECURVE = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform sampler2D u_master, u_red, u_green, u_blue;
uniform float u_preserveColors;
in vec2 v_uv;
out vec4 outColor;
float lut(sampler2D t, float v) {
  float idx = floor(clamp(v, 0.0, 1.0) * 65535.0);
  return texture(t, vec2((mod(idx, 256.0) + 0.5) / 256.0, (floor(idx / 256.0) + 0.5) / 256.0)).r;
}
void main() {
  vec4 src = texture(u_image, v_uv);
  vec3 rgb = src.rgb;
  if (u_preserveColors == 1.0) {
    float lum = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
    if (lum > 0.0) rgb = clamp(rgb * (lut(u_master, lum) / lum), 0.0, 1.0);
  } else {
    rgb = vec3(lut(u_master, rgb.r), lut(u_master, rgb.g), lut(u_master, rgb.b));
  }
  rgb = vec3(lut(u_red, rgb.r), lut(u_green, rgb.g), lut(u_blue, rgb.b));
  outColor = vec4(rgb, src.a);
}`;

// Lens vignetting: radial correction factor (position-dependent). gl_FragCoord-0.5
// is the array pixel index (the texture round-trip preserves row order).
export const FRAG_VIGNETTE = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_res;
uniform float u_strength, u_midpoint, u_roundness, u_feather;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec4 src = texture(u_image, v_uv);
  float cx = u_res.x / 2.0, cy = u_res.y / 2.0;
  float dx = ((gl_FragCoord.x - 0.5) - cx) / cx;
  float dy = (((gl_FragCoord.y - 0.5) - cy) / cy) * (1.0 + u_roundness);
  float nd = sqrt(dx * dx + dy * dy) / sqrt(2.0);
  float mask = 1.0;
  if (nd > 0.0) {
    float fs = u_midpoint * 0.5, fe = u_midpoint * 1.5;
    if (nd > fs) {
      float fp = min(1.0, (nd - fs) / (fe - fs));
      float t = clamp(fp, 0.0, 1.0);
      float sf = t * t * (3.0 - 2.0 * t);
      float ff = fp * (1.0 - u_feather) + sf * u_feather;
      mask = 1.0 - ff;
    }
  }
  float factor = 1.0 + u_strength * (1.0 / max(0.1, mask) - 1.0);
  outColor = vec4(src.rgb * factor, src.a);
}`;

// Hue Curves: 5 curves (hue->hue/sat/lum, sat->sat, lum->sat) as 256-entry uniform
// LUTs with linear interpolation. Mirrors HueCurvesModule (post HSL-scale fix).
export const FRAG_HUECURVES = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform float u_hh[256], u_hs[256], u_hl[256], u_ss[256], u_ls[256];
uniform float u_onHH, u_onHS, u_onHL, u_onSS, u_onLS, u_blend;
in vec2 v_uv;
out vec4 outColor;
vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float diff = mx - mn, sum = mx + mn, h = 0.0, l = sum / 2.0, s = 0.0;
  if (diff != 0.0) {
    s = l > 0.5 ? diff / (2.0 - sum) : diff / sum;
    if (mx == c.r) h = (c.g - c.b) / diff + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / diff + 2.0;
    else h = (c.r - c.g) / diff + 4.0;
    h /= 6.0;
  }
  return vec3(h * 360.0, s * 100.0, l * 100.0);
}
vec3 hsl2rgb(float h, float s, float l) {
  h = mod(mod(h, 360.0) + 360.0, 360.0);
  s = clamp(s, 0.0, 100.0) / 100.0;
  l = clamp(l, 0.0, 100.0) / 100.0;
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float x = c * (1.0 - abs(mod(h / 60.0, 2.0) - 1.0));
  float m = l - c / 2.0;
  vec3 rgb = h < 60.0 ? vec3(c, x, 0.0) : h < 120.0 ? vec3(x, c, 0.0) : h < 180.0 ? vec3(0.0, c, x)
           : h < 240.0 ? vec3(0.0, x, c) : h < 300.0 ? vec3(x, 0.0, c) : vec3(c, 0.0, x);
  return rgb + m;
}
float samp(float arr[256], float x) {
  float idx = clamp(x, 0.0, 1.0) * 255.0;
  int lo = int(floor(idx));
  int hi = min(lo + 1, 255);
  return mix(arr[lo], arr[hi], idx - float(lo));
}
void main() {
  vec4 src = texture(u_image, v_uv);
  vec3 hsl = rgb2hsl(src.rgb);
  float h = hsl.x / 360.0, s = hsl.y / 100.0, l = hsl.z / 100.0;
  if (u_onHH > 0.5) { float sh = samp(u_hh, h) - 0.5; h = mod(h + sh + 1.0, 1.0); }
  if (u_onHS > 0.5) s = min(1.0, s * (samp(u_hs, h) * 2.0));
  if (u_onHL > 0.5) l = min(1.0, l * (samp(u_hl, h) * 2.0));
  if (u_onSS > 0.5) s = samp(u_ss, s);
  if (u_onLS > 0.5) s = min(1.0, s * (samp(u_ls, l) * 2.0));
  vec3 nrgb = hsl2rgb(h * 360.0, s * 100.0, l * 100.0);
  outColor = vec4(src.rgb + (nrgb - src.rgb) * u_blend, src.a);
}`;

// Lens distortion: barrel + perspective + scale, sampled with MANUAL bilinear
// (texelFetch) so the result matches LensCorrectionsModule.correctDistortion exactly
// (out-of-bounds -> black, alpha preserved).
export const FRAG_DISTORTION = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_res;
uniform float u_barrel, u_scale, u_perspH, u_perspV;
in vec2 v_uv;
out vec4 outColor;
vec4 bilin(vec2 p) {
  float x0 = floor(p.x), y0 = floor(p.y);
  float wx = p.x - x0, wy = p.y - y0;
  int ix0 = int(x0), iy0 = int(y0);
  vec4 p00 = texelFetch(u_image, ivec2(ix0, iy0), 0);
  vec4 p01 = texelFetch(u_image, ivec2(ix0 + 1, iy0), 0);
  vec4 p10 = texelFetch(u_image, ivec2(ix0, iy0 + 1), 0);
  vec4 p11 = texelFetch(u_image, ivec2(ix0 + 1, iy0 + 1), 0);
  return mix(mix(p00, p01, wx), mix(p10, p11, wx), wy);
}
void main() {
  vec4 src = texture(u_image, v_uv);
  float cx = u_res.x / 2.0, cy = u_res.y / 2.0;
  float nx = ((gl_FragCoord.x - 0.5) - cx) / cx;
  float ny = ((gl_FragCoord.y - 0.5) - cy) / cy;
  if (u_barrel != 0.0) {
    float r = sqrt(nx * nx + ny * ny);
    if (r > 0.0) { float f = 1.0 + u_barrel * r * r; nx /= f; ny /= f; }
  }
  if (u_perspH != 0.0 || u_perspV != 0.0) {
    float cH = cos(u_perspH), sH = sin(u_perspH), cV = cos(u_perspV), sV = sin(u_perspV);
    float xr = nx * cH - sH;
    float zr = nx * sH + cH;
    float yr = ny * cV - zr * sV;
    float zf = ny * sV + zr * cV;
    if (zf > 0.1) { nx = xr / zf; ny = yr / zf; }
  }
  nx /= u_scale; ny /= u_scale;
  float srcX = nx * cx + cx;
  float srcY = ny * cy + cy;
  if (srcX >= 0.0 && srcX < u_res.x - 1.0 && srcY >= 0.0 && srcY < u_res.y - 1.0) {
    outColor = bilin(vec2(srcX, srcY));
  } else {
    outColor = vec4(0.0, 0.0, 0.0, src.a);
  }
}`;

// ─── Present shader pair ──────────────────────────────────────────────────────
// Used by GpuPreviewPipeline.present() to blit the final result texture to the
// default framebuffer (visible canvas) with zoom/pan and optional before/after split.
// We need a dedicated vertex shader because the quad is NOT always fullscreen —
// it covers only the dest rect (image scaled+panned within the canvas). We pass the
// rect as clip-space coords via uniforms and emit matching texcoords from a unit quad.
export const VERT_PRESENT = `#version 300 es
// Receives the four corners of a unit quad [0..1]×[0..1] in a_pos (same TRIANGLE_STRIP
// layout as VERT_SRC, but remapped from [-1,1] to [0,1] before use).
in vec2 a_pos;
// Clip-space rect for the destination image rectangle on the canvas.
// (x0,y0)=bottom-left, (x1,y1)=top-right — both in NDC [-1,1].
uniform vec4 u_destRect; // (x0, y0, x1, y1) in clip space
out vec2 v_uv;
void main() {
  // Map a_pos from [-1,1]^2 (clip quad) to [0,1]^2 (unit quad) for texcoords.
  vec2 unit = a_pos * 0.5 + 0.5;         // [0,1]
  // Texcoord: u goes left→right, v goes bottom→top in OpenGL convention.
  // The source texture was uploaded row-0-first (top of image = row 0 = low address).
  // texImage2D places row 0 at the BOTTOM of the texture in OpenGL (default framebuffer
  // is also bottom-origin). A naive v=unit.y would therefore show the image flipped.
  // Flip v so the image top (texture row 0) appears at the visual top of the quad.
  v_uv = vec2(unit.x, 1.0 - unit.y);
  // Map the unit quad to the dest rect in clip space.
  vec2 clipPos = mix(u_destRect.xy, u_destRect.zw, unit);
  gl_Position = vec4(clipPos, 0.0, 1.0);
}`;

// Fragment shader for the present pass.
// Samples u_image (processed result, already sRGB-display-encoded) or u_original
// (source texture) based on the before/after split position u_splitX.
// No color-space conversion — the pipeline output is already display-ready.
export const FRAG_PRESENT = `#version 300 es
precision highp float;
uniform sampler2D u_image;    // processed result texture (unit 0)
uniform sampler2D u_original; // source / original texture (unit 1)
// Canvas-pixel x-coordinate of the before/after split line.
// Fragments with gl_FragCoord.x < u_splitX show u_original; others show u_image.
// Set to -1.0 to disable the split (always show u_image).
uniform float u_splitX;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec4 color;
  if (u_splitX >= 0.0 && gl_FragCoord.x < u_splitX) {
    color = texture(u_original, v_uv);
  } else {
    color = texture(u_image, v_uv);
  }
  outColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
}`;

// Lateral chromatic aberration: radially shift the R and B channels, bilinear-sampled
// (manual, out-of-bounds -> 0). Mirrors correctLateralCA + sampleChannel.
export const FRAG_LATERALCA = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_res;
uniform float u_redShift, u_blueShift;
in vec2 v_uv;
out vec4 outColor;
float pick(vec4 v, int ch) { return ch == 0 ? v.r : ch == 2 ? v.b : v.g; }
float sampleCh(vec2 p, int ch) {
  if (p.x < 0.0 || p.x >= u_res.x - 1.0 || p.y < 0.0 || p.y >= u_res.y - 1.0) return 0.0;
  float x0 = floor(p.x), y0 = floor(p.y);
  float wx = p.x - x0, wy = p.y - y0;
  int ix0 = int(x0), iy0 = int(y0);
  float v00 = pick(texelFetch(u_image, ivec2(ix0, iy0), 0), ch);
  float v01 = pick(texelFetch(u_image, ivec2(ix0 + 1, iy0), 0), ch);
  float v10 = pick(texelFetch(u_image, ivec2(ix0, iy0 + 1), 0), ch);
  float v11 = pick(texelFetch(u_image, ivec2(ix0 + 1, iy0 + 1), 0), ch);
  return mix(mix(v00, v01, wx), mix(v10, v11, wx), wy);
}
void main() {
  vec4 src = texture(u_image, v_uv);
  float cx = u_res.x / 2.0, cy = u_res.y / 2.0;
  float maxR = sqrt(cx * cx + cy * cy);
  float dx = (gl_FragCoord.x - 0.5) - cx, dy = (gl_FragCoord.y - 0.5) - cy;
  float dist = sqrt(dx * dx + dy * dy) / maxR;
  float rs = 1.0 + u_redShift * dist * dist;
  float bs = 1.0 + u_blueShift * dist * dist;
  float r = sampleCh(vec2(cx + dx * rs, cy + dy * rs), 0);
  float b = sampleCh(vec2(cx + dx * bs, cy + dy * bs), 2);
  outColor = vec4(r, src.g, b, src.a);
}`;

// Faithful GLSL port of BasicAdjustmentsModule.process (see that file for intent).
export const FRAG_BASICADJ = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform float u_exposure, u_blackPoint, u_brightness, u_contrast;
uniform float u_dehazeActive, u_dehaze, u_hazeStrength, u_hazeDivisor;
uniform float u_hlActive, u_shActive, u_highlights, u_shadows;
uniform float u_saturation, u_vibrance;
in vec2 v_uv;
out vec4 outColor;
const vec3 W = vec3(0.299, 0.587, 0.114);

float adjustChannel(float pixel, float hMask, float sMask) {
  pixel *= pow(2.0, clamp(u_exposure, -1.0, 1.0));      // exposure
  pixel = max(0.0, pixel - u_blackPoint * 0.1);          // black point
  pixel += u_brightness * 0.1;                           // brightness
  pixel = 0.5 + (pixel - 0.5) * (1.0 + u_contrast * 0.1);// contrast around 0.5
  if (u_dehazeActive > 0.5) {                            // dehaze
    pixel = (pixel - u_hazeStrength) / u_hazeDivisor;
    pixel = 0.5 + (pixel - 0.5) * (1.0 + u_dehaze * 0.15);
  }
  pixel += u_hlActive * u_highlights * 0.4 * hMask;      // highlights (masked)
  pixel += u_shActive * u_shadows * 0.4 * sMask;         // shadows (masked)
  pixel = clamp(pixel, 0.0, 1.0);
  if (pixel > 0.0 && pixel < 0.001) pixel = 0.001;       // min visibility
  return pixel;
}

void main() {
  vec4 src = texture(u_image, v_uv);
  float lumHS = dot(src.rgb, W);
  float hMask = lumHS * lumHS;
  float sMask = (1.0 - lumHS) * (1.0 - lumHS);
  vec3 c = vec3(
    adjustChannel(src.r, hMask, sMask),
    adjustChannel(src.g, hMask, sMask),
    adjustChannel(src.b, hMask, sMask));

  float lum = dot(c, W);
  float dehazeSatBoost = (u_dehazeActive > 0.5) ? u_dehaze * 0.3 : 0.0;
  vec3 outc = c;
  if (u_saturation != 0.0 || dehazeSatBoost != 0.0) {
    float satFactor = max(0.0, 1.0 + u_saturation + dehazeSatBoost);
    outc = lum + (c - lum) * satFactor;
  }
  if (u_vibrance != 0.0) {
    float maxC = max(c.r, max(c.g, c.b));
    float minC = min(c.r, min(c.g, c.b));
    float curSat = maxC > 0.0 ? (maxC - minC) / maxC : 0.0;
    float vibFactor = 1.0 + u_vibrance * (1.0 - curSat);
    outc = clamp(lum + (outc - lum) * vibFactor, 0.0, 1.0);
  }
  outColor = vec4(outc, src.a);
}`;
