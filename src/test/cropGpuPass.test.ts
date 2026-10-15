/**
 * @jest-environment node
 */
/**
 * v1.40.0 Task 10a — GPU crop/rotate/orientation pass (core).
 *
 * jsdom/node has no WebGL, so the shader itself is proven live by selfTest()'s crop probe.
 * Here we pin everything around it:
 *  - cropRenderGeometry is THE render geometry (CropModule.getRenderGeometry delegates), incl.
 *    the Task 9b drag-suspension rule;
 *  - cropPassDescriptor's uniforms come only from computeCropGeometry, and the dims match the
 *    CPU CropModule (5200x3904 @ 0.84 deg -> 5257x3980 expanded; the 90 deg swap);
 *  - a line-by-line JS emulation of FRAG_CROP, driven by the EXACT uniform values the setter
 *    writes, reproduces CropModule.processWithGeometry for every orientation x flip x method;
 *  - FRAG_CROP source pins (texelFetch, pixel-centre mapping, fill predicate, bicubic clamp).
 */
jest.mock('../utils/Logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { CropModule, CropParams } from '../modules/CropModule';
import { computeCropGeometry, cropRenderGeometry, frameRectOf, isPixelRectWedgeFree, type CropGeometry } from '../modules/cropGeometry';
import { cropPassDescriptor } from '../shaders/passDescriptors';
import { FRAG_CROP, cropUniforms } from '../shaders/cropShader';

type Uniforms = Record<string, number[]>;

/** A GL stand-in that records every uniform write by name. */
function recordUniforms(set: (gl: WebGL2RenderingContext, prog: WebGLProgram) => void): Uniforms {
  const out: Uniforms = {};
  const rec = (name: unknown, ...v: number[]) => { out[name as string] = v; };
  const gl = {
    getUniformLocation: (_p: WebGLProgram, name: string) => name,
    uniform1i: rec, uniform1f: rec, uniform2f: rec, uniform2i: rec, uniform4f: rec,
  } as unknown as WebGL2RenderingContext;
  set(gl, {} as WebGLProgram);
  return out;
}

const f32 = (v: number) => Math.fround(v);

/**
 * JS twin of FRAG_CROP's main(): integer index o = fragCoord - 0.5 + cropOrigin, the
 * pixel-centre inverse rotation, the CPU fill predicate, taps in the oriented+flipped grid
 * mapped back to the input by un-flip / un-orient. Uniforms are rounded to float32 like
 * the GPU sees them.
 */
function emulate(u: Uniforms, src: Float32Array): { data: Float32Array; w: number; h: number } {
  const [outW, outH] = u.u_outSize;
  const [cropX, cropY] = u.u_cropOrigin.map(f32);
  const [offX, offY] = u.u_off.map(f32);
  const [bx, by] = u.u_base.map(f32);
  const [c, s] = u.u_cs.map(f32);
  const [oriW, oriH] = u.u_oriSize;
  const [inW, inH] = u.u_inSize;
  const [orientation] = u.u_orientation;
  const [flipH, flipV] = u.u_flip;
  const [rotated] = u.u_rotated;
  const [method] = u.u_method;
  const [wedgeFree] = u.u_wedgeFree;
  const fill = u.u_fill;
  const tap = (tx: number, ty: number): number[] => {
    let x = Math.max(0, Math.min(oriW - 1, tx));
    let y = Math.max(0, Math.min(oriH - 1, ty));
    if (flipH === 1) x = oriW - 1 - x;
    if (flipV === 1) y = oriH - 1 - y;
    let sx = x; let sy = y;
    if (orientation === 90) { sx = y; sy = inH - 1 - x; }
    else if (orientation === 180) { sx = inW - 1 - x; sy = inH - 1 - y; }
    else if (orientation === 270) { sx = inW - 1 - y; sy = x; }
    const i = (sy * inW + sx) * 4;
    return [src[i], src[i + 1], src[i + 2], src[i + 3]];
  };
  const cw = (t: number) => {
    const a = Math.abs(t);
    if (a <= 1) return 1.5 * a * a * a - 2.5 * a * a + 1;
    if (a < 2) return -0.5 * a * a * a + 2.5 * a * a - 4 * a + 2;
    return 0;
  };
  const data = new Float32Array(outW * outH * 4);
  for (let py = 0; py < outH; py++) {
    for (let px = 0; px < outW; px++) {
      const ox = px + cropX; const oy = py + cropY;
      let v: number[];
      if (rotated === 0) {
        v = tap(ox, oy);
      } else {
        const dx = ox + 0.5 - offX; const dy = oy + 0.5 - offY;
        let sx = dx * c + dy * s + bx;
        let sy = -dx * s + dy * c + by;
        if (wedgeFree === 1) {
          sx = Math.max(0, Math.min(oriW - 1 - 1e-3, sx));
          sy = Math.max(0, Math.min(oriH - 1 - 1e-3, sy));
        }
        if (wedgeFree !== 1 && (sx < 0 || sx >= oriW - 1 || sy < 0 || sy >= oriH - 1)) {
          v = fill;
        } else if (method === 0) {
          v = tap(Math.floor(sx + 0.5), Math.floor(sy + 0.5));
        } else if (method === 1) {
          const x0 = Math.floor(sx); const y0 = Math.floor(sy);
          const wx = sx - x0; const wy = sy - y0;
          const a = tap(x0, y0); const b = tap(x0 + 1, y0); const cc = tap(x0, y0 + 1); const d = tap(x0 + 1, y0 + 1);
          v = [0, 1, 2, 3].map((k) => (a[k] * (1 - wx) + b[k] * wx) * (1 - wy) + (cc[k] * (1 - wx) + d[k] * wx) * wy);
        } else {
          const x0 = Math.floor(sx); const y0 = Math.floor(sy);
          const fx = sx - x0; const fy = sy - y0;
          v = [0, 0, 0, 0];
          for (let ky = -1; ky <= 2; ky++) {
            for (let kx = -1; kx <= 2; kx++) {
              const t = tap(x0 + kx, y0 + ky);
              const wgt = cw(fx - kx) * cw(fy - ky);
              for (let k = 0; k < 4; k++) v[k] += t[k] * wgt;
            }
          }
          v = v.map((x) => Math.max(0, Math.min(1, x)));
        }
      }
      data.set(v, (py * outW + px) * 4);
    }
  }
  return { data, w: outW, h: outH };
}

function synthetic(w: number, h: number): Float32Array {
  const d = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = x / w;
      d[i + 1] = y / h;
      d[i + 2] = ((x * 7 + y * 3) % 11) / 11;
      d[i + 3] = 1;
    }
  }
  return d;
}

const maxDiff = (a: Float32Array, b: Float32Array) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

function cropParams(over: Partial<CropParams>): CropParams {
  const m = new CropModule();
  m.setParams({ enabled: true, ...over });
  return m.getParams();
}

describe('cropRenderGeometry (single render-geometry source)', () => {
  it('equals CropModule.getRenderGeometry, incl. the drag-suspension rule', () => {
    const p = cropParams({ angle: 4, orientation: 90, flipHorizontal: true });
    const m = new CropModule();
    m.setParams(p);
    for (const suspended of [false, true]) {
      expect(cropRenderGeometry(p, 640, 480, suspended)).toEqual(m.getRenderGeometry(640, 480, suspended));
    }
    // suspended + full frame -> the whole expanded canvas; otherwise the backstop clamps.
    const open = cropRenderGeometry(p, 640, 480, true);
    expect([open.outW, open.outH]).toEqual([open.expW, open.expH]);
    const clamped = cropRenderGeometry(p, 640, 480, false);
    expect(clamped.outW).toBeLessThan(clamped.expW);
    // A real crop is never un-clamped by a stale suspension flag.
    const real = cropParams({ angle: 4, x: 0, y: 0, width: 0.9, height: 0.9 });
    expect(cropRenderGeometry(real, 640, 480, true)).toEqual(cropRenderGeometry(real, 640, 480, false));
  });
});

describe('cropPassDescriptor uniforms == CPU CropModule dims', () => {
  it('5200x3904 @ 0.84 deg: expanded 5257x3980, out dims == CropModule.getOutputDimensions', () => {
    const p = cropParams({ angle: 0.84 });
    const geom = cropRenderGeometry(p, 5200, 3904);
    expect([geom.expW, geom.expH]).toEqual([5257, 3980]);
    const desc = cropPassDescriptor(geom);
    const u = recordUniforms((gl, prog) => desc.setUniforms(gl, prog, { width: 0, height: 0, dehaze: { active: false, hazeStrength: 0, hazeDivisor: 1 } }));
    expect(u.u_off).toEqual([geom.offX, geom.offY]);
    expect(u.u_cropOrigin).toEqual([geom.cropX, geom.cropY]);
    expect(u.u_outSize).toEqual([geom.outW, geom.outH]);
    const m = new CropModule();
    m.setParams(p);
    expect(m.getOutputDimensions(5200, 3904)).toEqual({ width: geom.outW, height: geom.outH });
    expect(desc.geometryStep).toEqual({ kind: 'crop', geom, frameRect: frameRectOf(geom) });
  });

  it('the 90 deg swap: oriented frame and output dims swap like the CPU', () => {
    const p = cropParams({ orientation: 90, x: 0.1, y: 0.2, width: 0.5, height: 0.6 });
    const geom = cropRenderGeometry(p, 5200, 3904);
    expect([geom.oriW, geom.oriH]).toEqual([3904, 5200]);
    const u = recordUniforms(cropUniforms(geom));
    expect(u.u_oriSize).toEqual([3904, 5200]);
    expect(u.u_inSize).toEqual([5200, 3904]);
    expect(u.u_orientation).toEqual([90]);
    const m = new CropModule();
    m.setParams(p);
    expect(m.getOutputDimensions(5200, 3904)).toEqual({ width: geom.outW, height: geom.outH });
    // And on a small frame the real CPU render has exactly those dims.
    const g2 = cropRenderGeometry(p, 52, 39);
    const out = m.process(synthetic(52, 39), { width: 52, height: 39, channels: 4 });
    expect(out.length).toBe(g2.outW * g2.outH * 4);
  });
});

describe('FRAG_CROP emulation (driven by the recorded uniforms) == CropModule.processWithGeometry', () => {
  const W = 23, H = 15;
  const src = synthetic(W, H);
  const cases: Array<{ name: string; geom: CropGeometry }> = [];
  for (const orientation of [0, 90, 180, 270]) {
    for (const [flipHorizontal, flipVertical] of [[false, false], [true, false], [false, true], [true, true]] as const) {
      for (const resampleMethod of ['nearest', 'bilinear', 'bicubic'] as const) {
        for (const angle of [0, 3.3, -7]) {
          const p = cropParams({ angle, orientation, flipHorizontal, flipVertical, resampleMethod, x: 0.05, y: 0.1, width: 0.8, height: 0.85 });
          // Both a backstop-clamped rect and the suspended expanded canvas (fill exercised).
          cases.push({ name: `o${orientation} fh${+flipHorizontal} fv${+flipVertical} ${resampleMethod} a${angle}`, geom: cropRenderGeometry(p, W, H) });
          cases.push({ name: `full o${orientation} fh${+flipHorizontal} fv${+flipVertical} ${resampleMethod} a${angle}`, geom: computeCropGeometry({ ...p, x: 0, y: 0, width: 1, height: 1, fillColor: [0.2, 0.4, 0.6, 1] }, W, H) });
        }
      }
    }
  }
  it.each(cases)('$name', ({ geom }) => {
    const ref = new CropModule().processWithGeometry(new Float32Array(src), geom, 4);
    const gpu = emulate(recordUniforms(cropUniforms(geom)), src);
    expect([gpu.w, gpu.h]).toEqual([geom.outW, geom.outH]);
    expect(gpu.data.length).toBe(ref.length);
    expect(maxDiff(gpu.data, ref)).toBeLessThan(1e-3);
  });
});

describe('FRAG_CROP source pins', () => {
  it('reads with texelFetch only (RGBA32F is not linear-filterable)', () => {
    expect(FRAG_CROP).toContain('texelFetch(u_image');
    expect(FRAG_CROP).not.toMatch(/\btexture\s*\(/);
  });
  it('pixel-centre mapping from the integer canvas index', () => {
    expect(FRAG_CROP).toContain('gl_FragCoord.xy - 0.5 + u_cropOrigin');
    expect(FRAG_CROP).toContain('o + 0.5 - u_off');
  });
  it('CPU fill predicate and bicubic clamp', () => {
    expect(FRAG_CROP).toContain('s.x < 0.0 || s.x >= float(u_oriSize.x - 1) || s.y < 0.0 || s.y >= float(u_oriSize.y - 1)');
    expect(FRAG_CROP).toContain('clamp(acc, 0.0, 1.0)');
    expect(FRAG_CROP).toContain('clamp(t, ivec2(0), u_oriSize - 1)');
  });
});

describe('float32 boundary: a wedge-free rect never fills on the GPU (fix round 1)', () => {
  /**
   * The shader's per-pixel coordinate math in float32 (each GLSL op rounded with
   * Math.fround). Returns whether the pixel would be FILL: with the fix, a wedge-free
   * geometry clamps s and never fills; without it, only the CPU predicate decides.
   */
  function fills32(u: Uniforms, px: number, py: number, withFix: boolean): boolean {
    const F = Math.fround;
    const [cropX, cropY] = u.u_cropOrigin.map(F);
    const [offX, offY] = u.u_off.map(F);
    const [bx, by] = u.u_base.map(F);
    const [c, s] = u.u_cs.map(F);
    const [oriW, oriH] = u.u_oriSize;
    const ox = F(F(px + 0.5) - 0.5 + cropX); const oy = F(F(py + 0.5) - 0.5 + cropY);
    const dx = F(F(ox + 0.5) - offX); const dy = F(F(oy + 0.5) - offY);
    let sx = F(F(F(dx * c) + F(dy * s)) + bx);
    let sy = F(F(F(-dx * s) + F(dy * c)) + by);
    if (withFix && u.u_wedgeFree?.[0] === 1) {
      // s = clamp(s, vec2(0.0), vec2(u_oriSize - 1) - 1e-3)
      sx = Math.min(Math.max(sx, 0), F(F(oriW - 1) - F(1e-3)));
      sy = Math.min(Math.max(sy, 0), F(F(oriH - 1) - F(1e-3)));
    }
    return sx < 0 || sx >= oriW - 1 || sy < 0 || sy >= oriH - 1;
  }

  // Rects pinned EXACTLY on the boundary at ~5000 px: a fixed integer inset rect, the
  // angle bisected (float64) to the last wedge-free value, so a corner pixel sits ~1e-12 px
  // inside the valid region (what the backstop clamp can produce). expandCanvas:false keeps
  // the rect fixed relative to the frame so the margin is continuous in the angle.
  const cases: CropGeometry[] = [];
  for (const [w, h, inset] of [[5200, 3904, 60], [5200, 3904, 200], [3904, 5200, 90], [4999, 3333, 41], [6000, 4000, 300]] as const) {
    for (const sign of [1, -1]) {
      const at = (a: number): CropGeometry => ({
        ...computeCropGeometry({ angle: sign * a, x: 0, y: 0, width: 1, height: 1, expandCanvas: false, resampleMethod: 'bilinear' }, w, h),
        cropX: inset, cropY: inset, outW: w - 2 * inset, outH: h - 2 * inset,
      });
      let lo = 0.02; let hi = 30;
      for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        if (isPixelRectWedgeFree(at(mid))) lo = mid; else hi = mid;
      }
      cases.push(at(lo));
    }
  }

  const perimeter = (g: CropGeometry): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let x = 0; x < g.outW; x++) out.push([x, 0], [x, g.outH - 1]);
    for (let y = 1; y < g.outH - 1; y++) out.push([0, y], [g.outW - 1, y]);
    return out;
  };

  it('every boundary rect is wedge-free in float64 (the CPU paints no fill) and sets u_wedgeFree', () => {
    for (const g of cases) {
      expect(isPixelRectWedgeFree(g)).toBe(true);
      expect(recordUniforms(cropUniforms(g)).u_wedgeFree).toEqual([1]);
    }
  });

  it('with u_wedgeFree the float32 shader math emits no fill on any rect edge pixel', () => {
    let fills = 0;
    for (const g of cases) {
      const u = recordUniforms(cropUniforms(g));
      for (const [px, py] of perimeter(g)) if (fills32(u, px, py, true)) fills++;
    }
    expect(fills).toBe(0);
  });

  it('the shader carries exactly that clamp branch, gated by u_wedgeFree', () => {
    expect(FRAG_CROP).toContain('if (u_wedgeFree == 1) {');
    expect(FRAG_CROP).toContain('s = clamp(s, vec2(0.0), vec2(u_oriSize - 1) - 1e-3);');
  });

  it('control: without u_wedgeFree the float32 predicate DOES fill edge pixels (the bug)', () => {
    let fills = 0;
    for (const g of cases) {
      const u = recordUniforms(cropUniforms(g));
      for (const [px, py] of perimeter(g)) if (fills32(u, px, py, false)) fills++;
    }
    expect(fills).toBeGreaterThan(0);
  });

  it('the suspended full-canvas drag preview keeps the predicate (fill is real there)', () => {
    const g = cropRenderGeometry(cropParams({ angle: 3.3 }), 640, 480, true);
    expect(recordUniforms(cropUniforms(g)).u_wedgeFree).toEqual([0]);
  });
});

describe('FRAG_CROP tap(): the shader\'s OWN un-flip / un-orient lines == CropModule (fix round 1)', () => {
  // Extract the GLSL index-remap lines from tap() and evaluate them as JS, so a wrong
  // 90/180/270 or flip mapping in the shader source fails here (not only live).
  const tapBody = FRAG_CROP.slice(FRAG_CROP.indexOf('vec4 tap(ivec2 t) {'), FRAG_CROP.indexOf('float cubicWeight'));
  const js = (expr: string) => expr
    .replace(/u_inSize\.x/g, 'inW').replace(/u_inSize\.y/g, 'inH')
    .replace(/u_oriSize\.x/g, 'oriW').replace(/u_oriSize\.y/g, 'oriH')
    .replace(/t\.x/g, 'tx').replace(/t\.y/g, 'ty');
  const orient = new Map<number, (tx: number, ty: number, inW: number, inH: number) => [number, number]>();
  for (const m of tapBody.matchAll(/u_orientation == (\d+)\) p = ivec2\((.*)\);/g)) {
    orient.set(Number(m[1]), new Function('tx', 'ty', 'inW', 'inH', `return [${js(m[2])}];`) as never);
  }
  const flipX = tapBody.match(/if \(u_flip\.x == 1\) t\.x = (.*);/)![1];
  const flipY = tapBody.match(/if \(u_flip\.y == 1\) t\.y = (.*);/)![1];
  const unflipX = new Function('tx', 'oriW', `return ${js(flipX)};`) as (tx: number, oriW: number) => number;
  const unflipY = new Function('ty', 'oriH', `return ${js(flipY)};`) as (ty: number, oriH: number) => number;

  it('extracts all three quarter turns and both flips', () => {
    expect([...orient.keys()].sort()).toEqual([180, 270, 90]);
    expect(tapBody).toContain('t = clamp(t, ivec2(0), u_oriSize - 1);');
  });

  const W = 5, H = 3;
  const src = new Float32Array(W * H * 4).map((_, i) => i); // every texel unique
  for (const orientation of [0, 90, 180, 270] as const) {
    for (const [fh, fv] of [[false, false], [true, false], [false, true], [true, true]] as const) {
      it(`o${orientation} fh${+fh} fv${+fv}`, () => {
        const geom = computeCropGeometry({ x: 0, y: 0, width: 1, height: 1, angle: 0, orientation, flipHorizontal: fh, flipVertical: fv }, W, H);
        const ref = new CropModule().processWithGeometry(new Float32Array(src), geom, 4);
        for (let ty0 = 0; ty0 < geom.oriH; ty0++) {
          for (let tx0 = 0; tx0 < geom.oriW; tx0++) {
            const tx = fh ? unflipX(tx0, geom.oriW) : tx0;
            const ty = fv ? unflipY(ty0, geom.oriH) : ty0;
            const [px, py] = orientation === 0 ? [tx, ty] : orient.get(orientation)!(tx, ty, W, H);
            const o = (ty0 * geom.oriW + tx0) * 4;
            expect(src[(py * W + px) * 4]).toBe(ref[o]);
          }
        }
      });
    }
  }
});
