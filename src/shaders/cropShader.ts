/**
 * GPU crop / straighten / orientation pass (v1.40.0 Task 10a).
 *
 * One draw from the SOURCE texture into an outW x outH target reproduces
 * CropModule.processWithGeometry (orientation -> flips -> fine rotation into the
 * expanded canvas -> integer crop). Every uniform comes from computeCropGeometry
 * (via cropRenderGeometry) — nothing is re-derived here.
 *
 * Per output texel:
 *   o = gl_FragCoord.xy - 0.5 + (cropX, cropY)        integer expanded-canvas index
 *   not rotated -> copy the texel at o (orientation/flips are a pure index remap; the
 *                  CPU copies too, so no fill predicate and no clamp)
 *   rotated     -> s = R^-1 (o + 0.5 - off) + (cx - 0.5, cy - 0.5)   (pixel-centre
 *                  convention of mapCanvasPixelToSource); fill unless
 *                  0 <= s < ori - 1 (CropModule.samplePixel's predicate); else
 *                  nearest / bilinear / Catmull-Rom exactly as the CPU samplers.
 * Taps are integer indices in the ORIENTED + FLIPPED grid (oriW x oriH), clamped to
 * [0, ori-1], then mapped back to the input texel: un-flip, then the inverse of
 * rotateOrthogonal. Reads are texelFetch — RGBA32F is not linear-filterable, and exact
 * texel addressing is the point anyway.
 */
import type { CropGeometry } from '../modules/cropGeometry';

export const FRAG_CROP = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_image;
uniform vec2 u_cropOrigin;   // (cropX, cropY) in expanded-canvas pixels
uniform ivec2 u_outSize;     // (outW, outH) — the target size (informational)
uniform vec2 u_off;          // canvas position of the rotation centre (offX, offY)
uniform vec2 u_base;         // (cx - 0.5, cy - 0.5): centre as a source INDEX
uniform vec2 u_cs;           // (cos, sin) of the fine angle
uniform ivec2 u_oriSize;     // oriented frame (oriW, oriH)
uniform ivec2 u_inSize;      // input frame (inW, inH)
uniform int u_orientation;   // 0 | 90 | 180 | 270 (clockwise)
uniform ivec2 u_flip;        // (flipH, flipV) as 0/1
uniform int u_rotated;       // 0 = no fine rotation (pure remap copy)
uniform int u_method;        // 0 nearest, 1 bilinear, 2 bicubic (Catmull-Rom)
uniform vec4 u_fill;
out vec4 outColor;

// Integer tap in the oriented+flipped grid -> input texel (inverse of flips, then of
// CropModule.rotateOrthogonal).
vec4 tap(ivec2 t) {
  t = clamp(t, ivec2(0), u_oriSize - 1);
  if (u_flip.x == 1) t.x = u_oriSize.x - 1 - t.x;
  if (u_flip.y == 1) t.y = u_oriSize.y - 1 - t.y;
  ivec2 p = t;
  if (u_orientation == 90) p = ivec2(t.y, u_inSize.y - 1 - t.x);
  else if (u_orientation == 180) p = ivec2(u_inSize.x - 1 - t.x, u_inSize.y - 1 - t.y);
  else if (u_orientation == 270) p = ivec2(u_inSize.x - 1 - t.y, t.x);
  return texelFetch(u_image, p, 0);
}

float cubicWeight(float t) {
  float a = abs(t);
  if (a <= 1.0) return 1.5 * a * a * a - 2.5 * a * a + 1.0;
  if (a < 2.0) return -0.5 * a * a * a + 2.5 * a * a - 4.0 * a + 2.0;
  return 0.0;
}

void main() {
  // Fragment centres sit at n + 0.5, so o is an exact integer canvas index.
  vec2 o = gl_FragCoord.xy - 0.5 + u_cropOrigin;
  if (u_rotated == 0) {
    outColor = tap(ivec2(floor(o + 0.5)));
    return;
  }
  vec2 d = o + 0.5 - u_off;
  vec2 s = vec2(d.x * u_cs.x + d.y * u_cs.y, -d.x * u_cs.y + d.y * u_cs.x) + u_base;
  if (s.x < 0.0 || s.x >= float(u_oriSize.x - 1) || s.y < 0.0 || s.y >= float(u_oriSize.y - 1)) {
    outColor = u_fill;
    return;
  }
  if (u_method == 0) {
    outColor = tap(ivec2(floor(s + 0.5)));
    return;
  }
  vec2 f0 = floor(s);
  ivec2 i0 = ivec2(f0);
  vec2 fr = s - f0;
  if (u_method == 1) {
    vec4 v0 = tap(i0) * (1.0 - fr.x) + tap(i0 + ivec2(1, 0)) * fr.x;
    vec4 v1 = tap(i0 + ivec2(0, 1)) * (1.0 - fr.x) + tap(i0 + ivec2(1, 1)) * fr.x;
    outColor = v0 * (1.0 - fr.y) + v1 * fr.y;
    return;
  }
  vec4 acc = vec4(0.0);
  for (int dy = -1; dy <= 2; dy++) {
    float wy = cubicWeight(fr.y - float(dy));
    for (int dx = -1; dx <= 2; dx++) {
      acc += tap(i0 + ivec2(dx, dy)) * (cubicWeight(fr.x - float(dx)) * wy);
    }
  }
  outColor = clamp(acc, 0.0, 1.0);
}`;

const METHOD_INDEX: Record<CropGeometry['method'], number> = { nearest: 0, bilinear: 1, bicubic: 2 };

/** True when the GPU pass implements this resample method (else the crop stays on the CPU). */
export function isGpuCropMethod(method: unknown): method is CropGeometry['method'] {
  return typeof method === 'string' && Object.prototype.hasOwnProperty.call(METHOD_INDEX, method);
}

/** Uniform setter for FRAG_CROP — every value read straight off the CropGeometry. */
export function cropUniforms(geom: CropGeometry): (gl: WebGL2RenderingContext, prog: WebGLProgram) => void {
  return (gl, prog) => {
    gl.uniform2f(gl.getUniformLocation(prog, 'u_cropOrigin'), geom.cropX, geom.cropY);
    gl.uniform2i(gl.getUniformLocation(prog, 'u_outSize'), geom.outW, geom.outH);
    gl.uniform2f(gl.getUniformLocation(prog, 'u_off'), geom.offX, geom.offY);
    gl.uniform2f(gl.getUniformLocation(prog, 'u_base'), geom.cx - 0.5, geom.cy - 0.5);
    gl.uniform2f(gl.getUniformLocation(prog, 'u_cs'), geom.cos, geom.sin);
    gl.uniform2i(gl.getUniformLocation(prog, 'u_oriSize'), geom.oriW, geom.oriH);
    gl.uniform2i(gl.getUniformLocation(prog, 'u_inSize'), geom.inW, geom.inH);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_orientation'), geom.orientation);
    gl.uniform2i(gl.getUniformLocation(prog, 'u_flip'), geom.flipH ? 1 : 0, geom.flipV ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_rotated'), geom.rotated ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_method'), METHOD_INDEX[geom.method]);
    gl.uniform4f(gl.getUniformLocation(prog, 'u_fill'), geom.fill[0], geom.fill[1], geom.fill[2], geom.fill[3]);
  };
}
