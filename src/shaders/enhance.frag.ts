/**
 * GLSL fragment sources for the GPU deterministic enhance chain (Task S2).
 *
 * These shaders are a faithful, byte-parity port of the CPU enhance chain
 * (src/utils/enhanceChain.ts + enhanceOps/enhanceRestore/enhanceColor/lanczos), run as
 * whole-frame WebGL2 fragment passes by GpuPreviewPipeline.runEnhanceChain(). The pass
 * ORDER and per-pixel math match the CPU exactly; the GPU/CPU divergence is float32
 * rounding order only, gated by the self-test epsilon (a FAIL routes enhance to the CPU
 * worker transparently).
 *
 * Every pass runs on RGBA32F textures (the pipeline's internal format) with NEAREST +
 * CLAMP_TO_EDGE sampling, so:
 *   - Discrete-kernel taps (gauss / Sobel / CAS) read the exact texel the CPU indexes.
 *   - Out-of-bounds taps clamp to the edge texel — identical to the CPU's
 *     `Math.min(dim-1, Math.max(0, i))` index clamp.
 *   - Richardson-Lucy division (y0 / max(conv, eps)) carries full float32 precision — 16F
 *     would lose ~3 decimal digits over 12 iterations and fail RL parity, so it is NOT used.
 *
 * All shaders share VERT_SRC (from sources.ts) which emits v_uv in [0,1].
 */

// ── Colour-space conversions (mirror enhanceColor.ts) ────────────────────────────

/** RGBA (sRGB display domain) → (Y, Cr, Cb, A). BT.601: exactly rgbaToYCrCb. */
export const FRAG_ENH_RGB2YCC = `#version 300 es
precision highp float;
uniform sampler2D u_image;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec4 c = texture(u_image, v_uv);
  float y = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  float cr = (c.r - y) * 0.713 + 0.5;
  float cb = (c.b - y) * 0.564 + 0.5;
  outColor = vec4(y, cr, cb, c.a);
}`;

/**
 * (Y, Cr, Cb, A) → RGBA, exactly yCrCbToRgba (with per-channel clamp01).
 * Luma+alpha are read from u_luma (.r/.a) and chroma from u_chroma (.g/.b) so the finish
 * can take Y from the CAS output and Cr/Cb from the chroma-cleaned buffer. For a
 * single-source conversion bind the SAME texture to both samplers.
 */
export const FRAG_ENH_YCC2RGB = `#version 300 es
precision highp float;
uniform sampler2D u_luma;
uniform sampler2D u_chroma;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec4 l = texture(u_luma, v_uv);
  vec4 ch = texture(u_chroma, v_uv);
  float y = l.r;
  float crd = ch.g - 0.5;
  float cbd = ch.b - 0.5;
  float r = clamp(y + 1.403 * crd, 0.0, 1.0);
  float g = clamp(y - 0.714 * crd - 0.344 * cbd, 0.0, 1.0);
  float b = clamp(y + 1.773 * cbd, 0.0, 1.0);
  outColor = vec4(r, g, b, l.a);
}`;

// ── Joint-bilateral chroma denoise (mirror enhanceRestore.denoiseChroma) ─────────

/**
 * Chroma (Cr/Cb) smoothed by a spatial Gaussian gated by the LUMA guide difference.
 * Input is the (Y,Cr,Cb,A) texture; Y is the guide (center = c.r). Out-of-window and
 * out-of-bounds neighbours are SKIPPED (renormalised by accumulated weight), exactly as
 * the CPU does (`continue` on xx<0||xx>=w). The [0,1) uv test on a texel-centered sample
 * is equivalent to the CPU's integer bounds test. Y and A pass through unchanged.
 *   u_s2 = 2*spatialSigma^2 ; u_r2 = 2*rangeSigma^2 (rangeSigma=0.10 → 0.02) ; u_radius = ceil(spatialSigma*3).
 */
export const FRAG_ENH_DENOISE_CHROMA = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_texel;
uniform int u_radius;
uniform float u_s2;
uniform float u_r2;
in vec2 v_uv;
out vec4 outColor;
const int MAXR = 5;
void main() {
  vec4 c = texture(u_image, v_uv);
  float gc = c.r;
  float accCr = 0.0, accCb = 0.0, wsum = 0.0;
  for (int dy = -MAXR; dy <= MAXR; dy++) {
    if (dy < -u_radius || dy > u_radius) continue;
    for (int dx = -MAXR; dx <= MAXR; dx++) {
      if (dx < -u_radius || dx > u_radius) continue;
      vec2 uv2 = v_uv + vec2(float(dx), float(dy)) * u_texel;
      if (uv2.x < 0.0 || uv2.x >= 1.0 || uv2.y < 0.0 || uv2.y >= 1.0) continue;
      vec4 s = texture(u_image, uv2);
      float spatial = exp(-(float(dx * dx + dy * dy)) / u_s2);
      float dl = s.r - gc;
      float range = exp(-(dl * dl) / u_r2);
      float wgt = spatial * range;
      accCr += s.g * wgt;
      accCb += s.b * wgt;
      wsum += wgt;
    }
  }
  outColor = vec4(c.r, accCr / wsum, accCb / wsum, c.a);
}`;

// ── Separable Gaussian (mirror enhanceOps.gaussianBlur1) ─────────────────────────

/**
 * One separable Gaussian axis. u_dir = (1/w, 0) for the horizontal pass, (0, 1/h) for the
 * vertical. Weights k[t]=exp(-t^2/(2σ^2)) normalised by their sum — identical to
 * gaussianBlur1 (which normalises the same discrete kernel). CLAMP_TO_EDGE reproduces the
 * CPU's index clamp. Operates on all 4 channels; callers use only the channels they need.
 *   u_twoSigma2 = 2*sigma^2 ; u_radius = max(1, ceil(sigma*3)).
 */
export const FRAG_ENH_GAUSS = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_dir;
uniform int u_radius;
uniform float u_twoSigma2;
in vec2 v_uv;
out vec4 outColor;
const int MAXR = 16;
void main() {
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int t = -MAXR; t <= MAXR; t++) {
    if (t < -u_radius || t > u_radius) continue;
    float wt = exp(-(float(t * t)) / u_twoSigma2);
    acc += texture(u_image, v_uv + float(t) * u_dir) * wt;
    wsum += wt;
  }
  outColor = acc / wsum;
}`;

// ── Richardson-Lucy support passes (mirror enhanceRestore.rlDeconvLuma) ───────────

/** rel = y0 / max(conv, eps). y0 = original luma (.r of u_y0); conv = blurred estimate (.r). */
export const FRAG_ENH_RL_RATIO = `#version 300 es
precision highp float;
uniform sampler2D u_y0;
uniform sampler2D u_conv;
in vec2 v_uv;
out vec4 outColor;
void main() {
  float y0 = texture(u_y0, v_uv).r;
  float conv = texture(u_conv, v_uv).r;
  float rel = y0 / max(conv, 1e-6);
  outColor = vec4(rel, rel, rel, 1.0);
}`;

/** est' = clamp01(est * corr). Both scalars in .r. */
export const FRAG_ENH_RL_UPDATE = `#version 300 es
precision highp float;
uniform sampler2D u_est;
uniform sampler2D u_corr;
in vec2 v_uv;
out vec4 outColor;
void main() {
  float v = texture(u_est, v_uv).r * texture(u_corr, v_uv).r;
  v = clamp(v, 0.0, 1.0);
  outColor = vec4(v, v, v, 1.0);
}`;

// ── Edge mask (mirror enhanceOps.edgeMask, pre-blur) ─────────────────────────────

/**
 * Sobel gradient magnitude of the luma (.r), then pow(mag/mmax, gamma). mmax is the
 * WHOLE-IMAGE max gradient, computed once on the CPU (computeGlobalEdgeMax — byte-identical
 * to edgeMask's own buffer max) and threaded in as u_invMmax = 1/mmax. A GPU reduction is
 * avoided so the normalisation constant is exact. The result is blurred (FRAG_ENH_GAUSS,
 * sigma 2.0) then clamped in the graft pass.
 */
export const FRAG_ENH_SOBEL = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_texel;
uniform float u_invMmax;
uniform float u_gamma;
in vec2 v_uv;
out vec4 outColor;
float at(vec2 o) { return texture(u_image, v_uv + o).r; }
void main() {
  vec2 t = u_texel;
  float a = at(vec2(-t.x, -t.y)), b = at(vec2(0.0, -t.y)), c = at(vec2(t.x, -t.y));
  float d = at(vec2(-t.x, 0.0)),                            f = at(vec2(t.x, 0.0));
  float g = at(vec2(-t.x,  t.y)), h = at(vec2(0.0,  t.y)), i = at(vec2(t.x,  t.y));
  float gx = -a - 2.0 * d - g + c + 2.0 * f + i;
  float gy = -a - 2.0 * b - c + g + 2.0 * h + i;
  float mag = sqrt(gx * gx + gy * gy);
  float pw = pow(mag * u_invMmax, u_gamma);
  outColor = vec4(pw, pw, pw, 1.0);
}`;

// ── Luma graft / unsharp (mirror enhanceOps.lumaGraft) ───────────────────────────

/**
 * newY = clamp01(origY + alpha * clamp01(mask) * hp), hp = detail - lowpass.
 *   u_running : the (Y,Cr,Cb,A) texture — origY = .r, and its Cr/Cb/A pass through.
 *   u_mask    : blurred Sobel edge mask (.r), clamped here (edgeMask clamps after its blur).
 *   u_detail  : RL-restored luma (.r).
 *   u_lowpass : Gaussian(restored, hpSigma) (.r) — so detail-lowpass is the highpass.
 */
export const FRAG_ENH_GRAFT = `#version 300 es
precision highp float;
uniform sampler2D u_running;
uniform sampler2D u_mask;
uniform sampler2D u_detail;
uniform sampler2D u_lowpass;
uniform float u_alpha;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec4 run = texture(u_running, v_uv);
  float mask = clamp(texture(u_mask, v_uv).r, 0.0, 1.0);
  float hp = texture(u_detail, v_uv).r - texture(u_lowpass, v_uv).r;
  float newY = clamp(run.r + u_alpha * mask * hp, 0.0, 1.0);
  outColor = vec4(newY, run.g, run.b, run.a);
}`;

// ── Contrast-adaptive sharpen (mirror enhanceOps.cas) ────────────────────────────

/**
 * AMD FidelityFX CAS on the luma (.r). 3x3 min/max → adaptive weight, cross-tap sharpen.
 * Cr/Cb/A pass through. u_peak = casPeak(sharpness) = -0.2*clamp01(sharpness) (caller
 * pre-computes via the shared enhanceOps.casPeak; the pass is skipped at sharpness <= 0).
 */
export const FRAG_ENH_CAS = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_texel;
uniform float u_peak;
in vec2 v_uv;
out vec4 outColor;
float at(vec2 o) { return texture(u_image, v_uv + o).r; }
void main() {
  vec4 c = texture(u_image, v_uv);
  vec2 t = u_texel;
  float a = at(vec2(-t.x, -t.y)), b = at(vec2(0.0, -t.y)), cc = at(vec2(t.x, -t.y));
  float d = at(vec2(-t.x, 0.0)),  e = c.r,                 f  = at(vec2(t.x, 0.0));
  float g = at(vec2(-t.x,  t.y)), h = at(vec2(0.0,  t.y)), ii = at(vec2(t.x,  t.y));
  float mn = min(min(min(min(b, d), e), f), h);
  mn = min(mn, min(min(min(a, cc), g), ii));
  float mx = max(max(max(max(b, d), e), f), h);
  mx = max(mx, max(max(max(a, cc), g), ii));
  float amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, 1e-6), 0.0, 1.0));
  float wv = amp * u_peak;
  float ny = clamp((e + wv * (b + d + f + h)) / (1.0 + 4.0 * wv), 0.0, 1.0);
  outColor = vec4(ny, c.g, c.b, c.a);
}`;

// ── Lanczos resample in linear light (mirror lanczos.ts) ─────────────────────────

/** sRGB → linear per channel (alpha unchanged). Matches enhanceColor.srgbToLinear. */
export const FRAG_ENH_SRGB2LIN = `#version 300 es
precision highp float;
uniform sampler2D u_image;
in vec2 v_uv;
out vec4 outColor;
float s2l(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
void main() {
  vec4 c = texture(u_image, v_uv);
  outColor = vec4(s2l(c.r), s2l(c.g), s2l(c.b), c.a);
}`;

/** linear → sRGB per channel (clamp01 first; alpha unchanged). Matches linearToSrgb. */
export const FRAG_ENH_LIN2SRGB = `#version 300 es
precision highp float;
uniform sampler2D u_image;
in vec2 v_uv;
out vec4 outColor;
float l2s(float c) {
  float v = clamp(c, 0.0, 1.0);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}
void main() {
  vec4 c = texture(u_image, v_uv);
  outColor = vec4(l2s(c.r), l2s(c.g), l2s(c.b), c.a);
}`;

/**
 * One separable Lanczos-a axis on a LINEAR-light texture. For each destination pixel d
 * (from gl_FragCoord along u_axis), center=(d+0.5)*ratio-0.5, and taps s in
 * [floor(center-a)+1, floor(center+a)] weighted by sinc(x)*sinc(x/a). The 9-iteration
 * loop (k=0..8 from lo=floor(center-a)+1) covers that window exactly — taps beyond `hi`
 * carry weight 0 (|x|>=a) and are excluded from wsum, identical to buildTaps' `if(w!==0)`.
 * texelFetch with a clamped integer index reproduces the CPU's edge clamp.
 *   u_axis: 0 = x (width w→dw), 1 = y (height h→dh). u_a = 4.0.
 */
export const FRAG_ENH_LANCZOS = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform int u_srcSize;
uniform int u_dstSize;
uniform int u_axis;
uniform float u_a;
in vec2 v_uv;
out vec4 outColor;
float sincf(float x) {
  if (abs(x) < 1e-8) return 1.0;
  float p = 3.141592653589793 * x;
  return sin(p) / p;
}
float lanczosW(float x) {
  if (x <= -u_a || x >= u_a) return 0.0;
  return sincf(x) * sincf(x / u_a);
}
void main() {
  ivec2 frag = ivec2(gl_FragCoord.xy);
  int d = (u_axis == 0) ? frag.x : frag.y;
  int other = (u_axis == 0) ? frag.y : frag.x;
  float ratio = float(u_srcSize) / float(u_dstSize);
  float center = (float(d) + 0.5) * ratio - 0.5;
  int lo = int(floor(center - u_a)) + 1;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int k = 0; k < 9; k++) {
    int s = lo + k;
    float w = lanczosW(center - float(s));
    if (w != 0.0) {
      int sc = clamp(s, 0, u_srcSize - 1);
      ivec2 coord = (u_axis == 0) ? ivec2(sc, other) : ivec2(other, sc);
      acc += texelFetch(u_image, coord, 0) * w;
      wsum += w;
    }
  }
  outColor = acc / (wsum == 0.0 ? 1.0 : wsum);
}`;

/** programKey → source for the enhance chain's dedicated program set. */
export const ENHANCE_PROGRAM_SOURCES: Record<string, string> = {
  enh_rgb2ycc: FRAG_ENH_RGB2YCC,
  enh_ycc2rgb: FRAG_ENH_YCC2RGB,
  enh_denoise_chroma: FRAG_ENH_DENOISE_CHROMA,
  enh_gauss: FRAG_ENH_GAUSS,
  enh_rl_ratio: FRAG_ENH_RL_RATIO,
  enh_rl_update: FRAG_ENH_RL_UPDATE,
  enh_sobel: FRAG_ENH_SOBEL,
  enh_graft: FRAG_ENH_GRAFT,
  enh_cas: FRAG_ENH_CAS,
  enh_srgb2lin: FRAG_ENH_SRGB2LIN,
  enh_lin2srgb: FRAG_ENH_LIN2SRGB,
  enh_lanczos: FRAG_ENH_LANCZOS,
};
