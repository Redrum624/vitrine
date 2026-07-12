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
  float ws = tonal(lum, 0); if (ws > 0.01) rgb += u_shadows * ws * 0.3;
  float wm = tonal(lum, 1); if (wm > 0.01) rgb += u_mid * wm * 0.3;
  float wh = tonal(lum, 2); if (wh > 0.01) rgb += u_high * wh * 0.3;
  rgb = clamp(rgb, 0.0, 1.0);
  vec3 hsl = rgb2hsl(rgb);
  // Calibrated HSL bands — keep formula-identical with ColorBalanceModule.process
  // and WebGLImageProcessor.colorBalanceCPU (the GPU self-check compares them):
  // normalised band weights, chroma gate min(1, S/20), proportional saturation,
  // headroom-mapped luminance.
  float w[8];
  float wSum = 0.0;
  for (int i = 0; i < 8; i++) { w[i] = colorWeight(hsl.x, i); wSum += w[i]; }
  float scale = min(1.0, hsl.y / 20.0) / max(1.0, wSum);
  float hueShift = 0.0, satAdj = 0.0, lumAdj = 0.0;
  for (int i = 0; i < 8; i++) {
    float wf = w[i] * scale;
    hueShift += u_hue[i] * wf; satAdj += (u_sat[i] / 100.0) * wf; lumAdj += (u_lum[i] / 100.0) * wf;
  }
  float nh = hsl.x + hueShift;
  float ns = clamp(hsl.y * (1.0 + satAdj), 0.0, 100.0);
  float nl = clamp(lumAdj >= 0.0 ? hsl.z + (100.0 - hsl.z) * lumAdj : hsl.z + hsl.z * lumAdj, 0.0, 100.0);
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

// ─── Local-adjustment layer blend (Task 10) ───────────────────────────────────
// Blends a per-layer "adjusted" image back over the running "base" image weighted by
// a grayscale mask × opacity. This is the GPU equivalent of
// LocalAdjustmentsModule.applyBasicAdjLayer's per-channel blend:
//   imageData[i] = base + (mask*opacity) * (adjusted - base)
// i.e. out.rgb = mix(base.rgb, adjusted.rgb, mask*opacity), out.a = base.a.
//
// u_base     (unit 0) — the running image BEFORE this layer (the per-layer "original").
// u_adjusted (unit 1) — FRAG_BASICADJ applied to the running image (the "processed").
// u_mask     (unit 2) — R32F mask, value read from .r (0=no effect, 1=full effect).
// u_opacity          — the layer opacity (0..1).
//
// The CPU does NOT re-clamp here: applyBasicAdjLayer assigns the linear mix directly,
// and `processed` is already clamped to [0,1] by BasicAdjustmentsModule while `base`
// is the running image. The mix of two in-range values stays in range, so no extra
// clamp is applied (matching the CPU exactly). The mask×opacity weight is NOT clamped
// either — the CPU multiplies mask[i]*opacity raw (both are already 0..1).
export const FRAG_LAYER_BLEND = `#version 300 es
precision highp float;
uniform sampler2D u_base;
uniform sampler2D u_adjusted;
uniform sampler2D u_mask;
uniform float u_opacity;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec4 base = texture(u_base, v_uv);
  vec3 adjusted = texture(u_adjusted, v_uv).rgb;
  float w = texture(u_mask, v_uv).r * u_opacity;
  outColor = vec4(mix(base.rgb, adjusted, w), base.a);
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
  // Texcoord. Source data is uploaded row-0-first (image top = data row 0) and
  // texImage2D maps data row 0 to texture t=0 — there is NO implicit flip. The present
  // dest-rect is built so unit.y=0 → canvas TOP (presentDestRect[1] is the top edge in
  // NDC), so v=unit.y places the image top (t=0) at the canvas top. This matches the
  // render() ping-pong + readback path, which is self-test-verified to preserve
  // orientation — present MUST use the same convention; an extra (1.0 - unit.y) flip
  // here renders every image upside-down even though the self-tests still pass (they
  // exercise render+readback, not present).
  v_uv = vec2(unit.x, unit.y);
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

// Faithful GLSL port of ShadowsHighlightsModule.process (see that file for intent).
//
// IMPORTANT — single-pass validity requires maskBlur == 0. The CPU module box-blurs
// the shadow/highlight tone masks across neighbouring pixels (blurMask). That cross-
// pixel gather CANNOT be reproduced in a single analytic fragment pass, so this shader
// is only wired up (and only verified) for maskBlur == 0; the pass-list builder routes
// maskBlur > 0 to the CPU. With maskBlur == 0 the masks are purely a function of the
// per-pixel luminance, exactly as the CPU computes them, so GPU and CPU agree.
//
// Op order mirrors ShadowsHighlightsModule.process exactly:
//   1. luminance (Rec.709) → shadow mask + highlight mask (analytic, maskBlur==0)
//   2. iterations loop: shadow recovery → highlight recovery → white/black point
//      (lum recomputed from the running pixel each iteration, matching the CPU)
//   3. compression
//   4. color correction (shadow then highlight, gated on mask>0 like the CPU)
// bilateralFilter is NOT handled here — buildShadowsHighlightsPass routes it to CPU.
export const FRAG_SHADOWSHIGHLIGHTS = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform float u_shadows, u_highlights;             // 0..100 (50 = neutral)
uniform float u_shadowsRadius, u_highlightsRadius; // 0.1..100
uniform float u_shadowsColorTransfer, u_highlightsColorTransfer; // 0..100
uniform float u_whitePoint, u_blackPoint;          // -4..4
uniform float u_compress;                          // 0..100
uniform float u_shadowsColorCorrection, u_highlightsColorCorrection; // 0..100
uniform float u_maskFalloff;                       // mask falloff exponent
uniform float u_strength;                          // 0..2
uniform float u_preserveColor;                     // 1.0 = preserve, 0.0 = color transfer
uniform float u_iterations;                        // 1..5
in vec2 v_uv;
out vec4 outColor;
const vec3 W = vec3(0.2126, 0.7152, 0.0722);

float shadowMaskFn(float lum) {
  float radius = u_shadowsRadius / 100.0;
  if (lum < radius) return 1.0;
  if (lum < radius * 2.0) {
    float t = (lum - radius) / radius;
    return 1.0 - pow(t, u_maskFalloff);
  }
  return 0.0;
}
float highlightMaskFn(float lum) {
  float radius = u_highlightsRadius / 100.0;
  float threshold = 1.0 - radius;
  if (lum > threshold) return 1.0;
  if (lum > threshold * 0.5) {
    float t = (threshold - lum) / (threshold * 0.5);
    return 1.0 - pow(t, u_maskFalloff);
  }
  return 0.0;
}

void main() {
  vec4 src = texture(u_image, v_uv);
  vec3 rgb = src.rgb;

  // Masks are computed from the ORIGINAL luminance (the CPU builds them once, up front).
  float lum0 = dot(rgb, W);
  float shadowMask = shadowMaskFn(lum0);
  float highlightMask = highlightMaskFn(lum0);

  float shadowAmount = (u_shadows - 50.0) / 50.0;
  float highlightAmount = (u_highlights - 50.0) / 50.0;
  float sColorTransfer = u_shadowsColorTransfer / 100.0;
  float hColorTransfer = u_highlightsColorTransfer / 100.0;
  float whiteAdjust = 1.0 + u_whitePoint * 0.25;
  float blackAdjust = u_blackPoint / 100.0;

  bool doShadow = abs(u_shadows - 50.0) > 1e-6;
  bool doHighlight = abs(u_highlights - 50.0) > 1e-6;
  bool doWB = (abs(u_whitePoint) > 1e-6) || (abs(u_blackPoint) > 1e-6);

  // iterations: the CPU loops a small integer number of times. Cap at 5 (UI max) so
  // the loop bound is a compile-time constant (GLSL ES requires constant loop bounds).
  int iters = int(u_iterations + 0.5);
  for (int iter = 0; iter < 5; iter++) {
    if (iter >= iters) break;

    // ── shadow recovery ──
    if (doShadow) {
      float effect = shadowMask * shadowAmount * u_strength;
      if (effect != 0.0) {
        float lum = dot(rgb, W);
        float recovery = pow(1.0 - lum, 0.5) * effect;
        if (u_preserveColor > 0.5) {
          float lift = 1.0 + recovery;
          rgb = clamp(rgb * lift, 0.0, 1.0);
        } else {
          float mixAmount = sColorTransfer * abs(effect);
          float avg = (rgb.r + rgb.g + rgb.b) / 3.0;
          rgb = clamp(rgb + recovery + (avg - rgb) * mixAmount, 0.0, 1.0);
        }
      }
    }

    // ── highlight recovery ──
    if (doHighlight) {
      float effect = highlightMask * highlightAmount * u_strength;
      if (effect != 0.0) {
        float lum = dot(rgb, W);
        float recovery = pow(lum, 0.5) * effect * 0.3;
        if (u_preserveColor > 0.5) {
          rgb = clamp(rgb - recovery, 0.0, 1.0);
        } else {
          float mixAmount = hColorTransfer * abs(effect) * 0.3;
          float avg = (rgb.r + rgb.g + rgb.b) / 3.0;
          rgb = clamp(rgb - recovery + (avg - rgb) * mixAmount, 0.0, 1.0);
        }
      }
    }

    // ── white/black point ──
    if (doWB) {
      rgb = max(rgb - blackAdjust, 0.0);
      rgb = min(rgb * whiteAdjust, 1.0);
    }
  }

  // ── compression ──
  float compress = u_compress / 100.0;
  if (compress >= 0.01) {
    float factor = 1.0 - compress * 0.3;
    rgb = clamp(rgb * factor, 0.0, 1.0);
  }

  // ── color correction (shadow then highlight, gated on mask>0 like the CPU) ──
  float sCorr = u_shadowsColorCorrection / 100.0;
  float hCorr = u_highlightsColorCorrection / 100.0;
  if (abs(sCorr) >= 0.001 || abs(hCorr) >= 0.001) {
    if (shadowMask > 0.0 && abs(sCorr) > 0.001) {
      rgb = clamp(rgb * (1.0 + sCorr * shadowMask), 0.0, 1.0);
    }
    if (highlightMask > 0.0 && abs(hCorr) > 0.001) {
      rgb = clamp(rgb * (1.0 - hCorr * highlightMask), 0.0, 1.0);
    }
  }

  outColor = vec4(rgb, src.a);
}`;

// ── Highlight reconstruction (M1) ────────────────────────────────────────────
// Pointwise per-channel highlight recovery — reconstruct a clipped channel from the
// surviving ones, then desaturate blown whites cleanly. EXACT twin of the CPU
// recoverHighlights() (src/modules/HighlightRecoveryModule.ts); GLSL smoothstep is the
// same Hermite as hrSmoothstep, so the GPU self-test matches the CPU within float eps.
// u_strength is 0..100; 0 → identity.
export const FRAG_HIGHLIGHTRECOVERY = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform float u_strength;          // 0..100 (0 = off)
in vec2 v_uv;
out vec4 outColor;
const float KNEE = 0.75;
const float CLIP_LO = 0.9;
const float CLIP_HI = 1.0;
void main() {
  vec4 src = texture(u_image, v_uv);
  vec3 c = src.rgb;
  float s01 = u_strength / 100.0;
  float hi = max(max(c.r, c.g), c.b);
  if (s01 <= 0.0 || hi <= KNEE) { outColor = src; return; }
  float lo = min(min(c.r, c.g), c.b);
  float mid = c.r + c.g + c.b - hi - lo;                 // the median channel
  float t = smoothstep(KNEE, 1.0, hi);                  // depth into highlights
  float gate = smoothstep(KNEE, 1.0, mid);              // require a 2nd bright channel
  float a = t * gate * s01;
  vec3 w = 1.0 - smoothstep(vec3(CLIP_LO), vec3(CLIP_HI), c); // per-channel reliability
  float wsum = w.r + w.g + w.b;
  float guide = wsum > 1e-4 ? dot(w, c) / wsum : hi;    // survivor mean; all-clipped → white
  vec3 outc = c - max(c - vec3(guide), 0.0) * a;        // pull the over-guide cast toward survivors
  outColor = vec4(clamp(outc, 0.0, 1.0), src.a);
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
