/**
 * Structural + graceful-degradation tests for the GPU deterministic enhance chain (Task S2).
 *
 * WebGL2 is unavailable in jsdom, so — exactly like gpuPreviewPipeline.test.ts — the real
 * numeric correctness gate is the in-app selfTest() (runEnhanceChain vs CPU enhanceImage,
 * captured by the dev probe). These tests guard the STRUCTURE that keeps that parity honest:
 *   - the shaders use the same BT.601 / sRGB / CAS / Lanczos constants as the CPU chain,
 *   - the RL division keeps its epsilon (never weakened — the P5 doctrine),
 *   - runEnhanceChain runs the passes in enhanceImage's order,
 *   - the draw() binding loop selects the texture unit BEFORE binding (P5's bug class),
 *   - the self-test gates 'enhance' / 'enhance-upscale' (incl. the thrown-error path),
 *   - runEnhanceChain degrades to null (→ CPU) when WebGL2 is unavailable.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { GpuPreviewPipeline, FRAG_ENH_EDGE_MAG, FRAG_MAX_REDUCE4 } from '../shaders/GpuPreviewPipeline';
import { ENHANCE_PROGRAM_SOURCES } from '../shaders/enhance.frag';
import { DEFAULT_ENHANCE_PARAMS } from '../utils/enhanceChain';

const pipelineSrc = readFileSync(join(__dirname, '..', 'shaders', 'GpuPreviewPipeline.ts'), 'utf8');

describe('enhance.frag shader sources', () => {
  it('exports all 12 enhance programs, each a #version 300 es fragment shader', () => {
    const keys = Object.keys(ENHANCE_PROGRAM_SOURCES);
    expect(keys.length).toBe(12);
    for (const key of keys) {
      const src = ENHANCE_PROGRAM_SOURCES[key];
      expect(src.startsWith('#version 300 es')).toBe(true);
      expect(src).toContain('void main()');
      expect(src).toContain('outColor');
    }
  });

  it('rgb→YCrCb uses the exact BT.601 coefficients of rgbaToYCrCb', () => {
    const s = ENHANCE_PROGRAM_SOURCES.enh_rgb2ycc;
    expect(s).toContain('0.299 * c.r + 0.587 * c.g + 0.114 * c.b');
    expect(s).toContain('(c.r - y) * 0.713 + 0.5');
    expect(s).toContain('(c.b - y) * 0.564 + 0.5');
  });

  it('YCrCb→rgb uses the exact inverse coefficients of yCrCbToRgba', () => {
    const s = ENHANCE_PROGRAM_SOURCES.enh_ycc2rgb;
    expect(s).toContain('1.403 * crd');
    expect(s).toContain('0.714 * crd');
    expect(s).toContain('0.344 * cbd');
    expect(s).toContain('1.773 * cbd');
  });

  it('RL ratio keeps the divide-by-zero epsilon (never weakened)', () => {
    // The P5 doctrine: NEVER weaken/remove an epsilon. rlDeconvLuma divides by max(conv, 1e-6).
    expect(ENHANCE_PROGRAM_SOURCES.enh_rl_ratio).toContain('max(conv, 1e-6)');
    expect(ENHANCE_PROGRAM_SOURCES.enh_rl_update).toContain('clamp(v, 0.0, 1.0)');
  });

  it('CAS uses the FidelityFX peak formula of enhanceOps.cas, via the SHARED casPeak helper', () => {
    // out = clamp01((e + wv*(b+d+f+h)) / (1 + 4*wv)); peak passed in as u_peak.
    expect(ENHANCE_PROGRAM_SOURCES.enh_cas).toContain('(e + wv * (b + d + f + h)) / (1.0 + 4.0 * wv)');
    // C1/F2 (v1.36.0): the peak coefficient is COMPUTED by enhanceOps.casPeak on both the CPU
    // chain and this GPU parity port — lockstep by construction (was a duplicated literal).
    expect(pipelineSrc).toContain('casPeak(params.sharpness)');
    // Zero must mean OFF on the GPU route too: the enh_cas draw is gated on sharpness > 0.
    expect(pipelineSrc).toContain('if (params.sharpness > 0)');
  });

  it('Lanczos resample is a linear-light sinc window (a=4) via texelFetch', () => {
    const s = ENHANCE_PROGRAM_SOURCES.enh_lanczos;
    expect(s).toContain('sin(p) / p');       // sinc
    expect(s).toContain('sincf(x) * sincf(x / u_a)');
    expect(s).toContain('texelFetch');       // exact integer texel (no filtering)
    // sRGB↔linear conversions match enhanceColor.
    expect(ENHANCE_PROGRAM_SOURCES.enh_srgb2lin).toContain('pow((c + 0.055) / 1.055, 2.4)');
    expect(ENHANCE_PROGRAM_SOURCES.enh_lin2srgb).toContain('1.055 * pow(v, 1.0 / 2.4) - 0.055');
  });

  it('chroma denoise is guided by luma (.r) and skips out-of-bounds neighbours', () => {
    const s = ENHANCE_PROGRAM_SOURCES.enh_denoise_chroma;
    expect(s).toContain('float gc = c.r');                 // luma guide
    expect(s).toContain('if (uv2.x < 0.0 || uv2.x >= 1.0 || uv2.y < 0.0 || uv2.y >= 1.0) continue');
  });
});

describe('runEnhanceChain structure', () => {
  it('runs the passes in enhanceImage order (rgb2ycc → denoise → RL → graft → ycc2rgb → lanczos → cas)', () => {
    const start = pipelineSrc.indexOf('runEnhanceChain(');
    const end = pipelineSrc.indexOf('Dev-only runtime correctness gate', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = pipelineSrc.slice(start, end);
    const idx = (needle: string) => body.indexOf(needle);
    const rgb2ycc = idx("'enh_rgb2ycc'");
    const denoise = idx("'enh_denoise_chroma'");
    const rlRatio = idx("'enh_rl_ratio'");
    const graft = idx("'enh_graft'");
    const ycc2rgb = idx("'enh_ycc2rgb'");
    const lanczos = idx("'enh_lanczos'");
    const cas = idx("'enh_cas'");
    for (const v of [rgb2ycc, denoise, rlRatio, graft, ycc2rgb, lanczos, cas]) expect(v).toBeGreaterThan(-1);
    expect(rgb2ycc).toBeLessThan(denoise);
    expect(denoise).toBeLessThan(rlRatio);
    expect(rlRatio).toBeLessThan(graft);
    expect(graft).toBeLessThan(ycc2rgb);
    expect(ycc2rgb).toBeLessThan(lanczos);
    expect(lanczos).toBeLessThan(cas);
  });

  it('the draw() binding loop selects the texture unit BEFORE binding (no unit clobber — P5 class)', () => {
    const loopStart = pipelineSrc.indexOf('for (let u = 0; u < inputs.length; u++)');
    expect(loopStart).toBeGreaterThan(-1);
    const loopBody = pipelineSrc.slice(loopStart, loopStart + 400);
    const active = loopBody.indexOf('gl.activeTexture(gl.TEXTURE0 + u)');
    const bind = loopBody.indexOf('gl.bindTexture(gl.TEXTURE_2D, inputs[u].tex)');
    expect(active).toBeGreaterThan(-1);
    expect(bind).toBeGreaterThan(-1);
    expect(active).toBeLessThan(bind);
  });

  it('gates on the enhance self-test flags and the output-size cap', () => {
    const start = pipelineSrc.indexOf('runEnhanceChain(');
    const body = pipelineSrc.slice(start, start + 3000);
    expect(body).toContain("unsafeIds.has('enhance')");
    expect(body).toContain("unsafeIds.has('enhance-upscale')");
    expect(body).toContain('MAX_GPU_ENHANCE_OUTPUT_PIXELS');
  });

  it('self-test marks enhance ids unsafe, including on the thrown-error path', () => {
    expect(pipelineSrc).toContain("if (!enhSharpenOk) unsafe.push('enhance')");
    expect(pipelineSrc).toContain("if (!enhUpOk) unsafe.push('enhance-upscale')");
    // The catch-all must also list them so a throw during the enhance sub-test routes to CPU.
    const catchList = pipelineSrc.slice(pipelineSrc.indexOf('A thrown self-test means'));
    expect(catchList).toContain("'enhance'");
    expect(catchList).toContain("'enhance-upscale'");
  });
});

describe('self-test gates noise-reduction + enhance-resident (v1.40.0 Task 3)', () => {
  const lf = pipelineSrc.replace(/\r\n/g, '\n');
  const stStart = lf.indexOf('selfTest(): {');
  const st = lf.slice(stStart);

  it('pushes both ids unsafe on sub-test failure', () => {
    expect(st).toContain("if (!nrOk) unsafe.push('noise-reduction')");
    expect(st).toContain("if (!enhResOk) unsafe.push('enhance-resident')");
    // existing gates untouched
    expect(st).toContain("if (!enhSharpenOk) unsafe.push('enhance')");
    expect(st).toContain("if (!enhUpOk) unsafe.push('enhance-upscale')");
  });

  it('catch-all list contains both ids', () => {
    const catchList = lf.slice(lf.indexOf('A thrown self-test means'));
    expect(catchList).toContain("'noise-reduction'");
    expect(catchList).toContain("'enhance-resident'");
  });

  it('both sub-tests feed ok / maxDiff and log PASS/FAIL lines', () => {
    expect(st).toMatch(/const ok = [^;]*nrOk[^;]*enhResOk/);
    expect(st).toContain('[GPU-PIPELINE] noise-reduction self-test');
    expect(st).toContain('[GPU-PIPELINE] enhance-resident self-test');
  });

  it('NR sub-test compares against webGLImageProcessor.denoise at 1e-4 and fails on a null reference', () => {
    const a = st.indexOf('12. noise-reduction');
    const b = st.indexOf('13. enhance-resident');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    const nr = st.slice(a, b);
    expect(nr).toContain('webGLImageProcessor.denoise(');
    expect(nr).toContain("id: 'noise-reduction'");
    expect(nr).toContain('1e-4');
    expect(nr).toMatch(/!refNr|refNr\s*===\s*null|refNr\s*\?/);
  });

  it('enhance-resident sub-test covers native, kernelScale 0.5, and an exposure pass before enhance', () => {
    const b = st.indexOf('13. enhance-resident');
    const c = st.indexOf('const ok = ', b);
    const body = st.slice(b, c);
    expect(body).toContain('residentStep');
    expect(body).toContain('enhanceImage(');
    expect(body).toContain('0.5');
    expect(body).toContain('failedSteps');
    expect(body).toContain('ENH_SHARPEN_EPS');
    const exp = body.indexOf('exposure1EvPass');
    expect(body).toMatch(/\(\[\s*exposure1EvPass,\s*enhResPass\s*\]/);
    expect(exp).toBeGreaterThan(-1);
    expect(body).toContain('new ExposureModule()');
  });

  it('runEnhanceChain still gates on enhance / enhance-upscale only', () => {
    const start = lf.indexOf('runEnhanceChain(');
    const body = lf.slice(start, start + 3000);
    expect(body).not.toContain('enhance-resident');
  });
});

describe('runEnhanceChain graceful degradation (no WebGL2 in jsdom)', () => {
  it('returns null (→ CPU worker) when the pipeline is not attached', () => {
    const pipeline = new GpuPreviewPipeline();
    pipeline.attach(); // false in jsdom
    const w = 8, h = 8;
    const rgba = new Float32Array(w * h * 4).fill(0.5);
    const params = { ...DEFAULT_ENHANCE_PARAMS, enabled: true, sharpen: true, upscale: false };
    expect(pipeline.runEnhanceChain(rgba, w, h, params)).toBeNull();
  });
});

describe('runResidentEnhance structure (v1.40.0 Task 2 — in-chain resident sharpen)', () => {
  // Normalise CRLF so the 2-space method-closing brace is a stable end anchor.
  const lfSrc = pipelineSrc.replace(/\r\n/g, '\n');
  const start = lfSrc.indexOf('private runResidentEnhance(');
  const end = lfSrc.indexOf('\n  }\n', start);
  const body = lfSrc.slice(start, end);

  it('exists as a private method', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('runs the stages in runEnhanceChain order, minus Lanczos and base readback', () => {
    const order = [
      "'enh_rgb2ycc'",
      "'enh_denoise_chroma'",
      "'enh_rl_ratio'",
      "'enh_rl_update'",
      "'enh_edge_mag'",
      "'max_reduce4'",
      "'enh_sobel'",
      "'enh_graft'",
      "'enh_ycc2rgb'",
    ];
    let prev = -1;
    for (const needle of order) {
      const i = body.indexOf(needle, prev + 1);
      expect({ needle, found: i > prev }).toEqual({ needle, found: true });
      prev = i;
    }
    // Phase 3 (after the first ycc2rgb): rgb2ycc → cas → chroma gauss → final ycc2rgb.
    const firstYcc2rgb = body.indexOf("'enh_ycc2rgb'");
    const rgb2yccF = body.indexOf("'enh_rgb2ycc'", firstYcc2rgb);
    const cas = body.indexOf("'enh_cas'", rgb2yccF);
    const chroma = body.indexOf('params.chromaClean', cas);
    const finalYcc2rgb = body.indexOf("'enh_ycc2rgb'", chroma);
    for (const v of [rgb2yccF, cas, chroma, finalYcc2rgb]) expect(v).toBeGreaterThan(firstYcc2rgb);
    expect(rgb2yccF).toBeLessThan(cas);
    expect(cas).toBeLessThan(chroma);
    expect(chroma).toBeLessThan(finalYcc2rgb);
    expect(body).not.toContain("'enh_lanczos'");
    expect(body).not.toContain('readPixels(0, 0, w, h');
  });

  it('derives the edge max from the CHAIN INPUT on the GPU (never srcData / computeGlobalEdgeMax)', () => {
    expect(body).not.toContain('computeGlobalEdgeMax');
    expect(body).not.toContain('srcData');
    expect(body).toContain('edgeMaxReductionSizes(');
    expect(body).toContain('Math.max(1e-6, ');
    expect(body).toContain("gl.uniform1f(loc(prog, 'u_gamma'), 0.75)");
  });

  it('uses the shared kernel/CAS helpers and gates CAS on sharpness > 0', () => {
    expect(body).toContain('effectiveEnhanceKernels(');
    expect(body).toContain('casPeak(');
    expect(body).toContain('if (params.sharpness > 0)');
  });

  it('selects the texture unit BEFORE binding in its draw loop (P5 class)', () => {
    const loop = body.indexOf('for (let u = 0; u < inputs.length; u++)');
    expect(loop).toBeGreaterThan(-1);
    const loopBody = body.slice(loop, loop + 400);
    const active = loopBody.indexOf('gl.activeTexture(gl.TEXTURE0 + u)');
    const bind = loopBody.indexOf('gl.bindTexture(gl.TEXTURE_2D, inputs[u].tex)');
    expect(active).toBeGreaterThan(-1);
    expect(active).toBeLessThan(bind);
  });

  it('never writes scratch or the source texture; fails safe (returns false)', () => {
    expect(body).not.toContain('ensureScratch');
    expect(body).not.toContain('this.scratch');
    expect(body).not.toContain('this.srcTexture');
    expect(body).toContain('return false');
  });
});

describe('runResidentEnhance wiring parity with runEnhanceChain', () => {
  // Order-only pins would miss a swapped sampler (graft u_running/u_detail), swapped
  // estA/estB, or a wrong u_twoSigma2. This extracts every draw target, sampler binding,
  // uniform expression, gauss call and chain-state assignment from BOTH bodies, normalises
  // naming-only differences, and asserts the sequences are identical — excluding Lanczos /
  // base readback (runEnhanceChain only) and the GPU edge-max reduction (resident only).
  const lf = pipelineSrc.replace(/\r\n/g, '\n');
  const methodBody = (sig: string): string => {
    const s = lf.indexOf(sig);
    expect(s).toBeGreaterThan(-1);
    return lf.slice(s, lf.indexOf('\n  }\n', s));
  };
  const cut = (text: string, from: string, to: string): string => {
    const a = text.indexOf(from);
    const b = text.indexOf(to, a);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    return text.slice(0, a) + text.slice(b + to.length);
  };
  const RENAMES: Array<[RegExp, string]> = [
    [/\.(tex|texture|framebuffer)\b/g, ''],
    [/\bsrcTex\b/g, 'input'],
    [/\bcurFinal\b/g, 'cur'],
    [/\benhFbo\b/g, 'dst'],
    [/\bout\b/g, 'dst'],
    [/\b(dw|ww)\b/g, 'w'],
    [/\b(dh|hh)\b/g, 'h'],
    [/\bfreeRes\b/g, 'release'],
    [/allocFbo\(\w+, \w+\)/g, 'acquire()'],
  ];
  const EVENT = new RegExp([
    String.raw`draw\('(?<dkey>\w+)', (?<ddst>\w+), w, h`,
    String.raw`\{ tex: (?<btex>\w+), sampler: '(?<bs>\w+)' \}`,
    String.raw`gl\.uniform\w+\(loc\(prog, '(?<un>\w+)'\), (?<ue>[^;]+)\);`,
    String.raw`gauss\((?<gargs>\w+, (?:w, h, )?\w+, (?:true|false), \w+, [^)]+)\)`,
    String.raw`const (?<cn>two\w+|sSigma|yccTex|estNext|finalEst|estA) = (?<ce>[^;]+);`,
    String.raw`(?<an>curEst|running|casTex|chromaTex) = (?<ae>\w+);`,
    String.raw`if \((?<cond>runRL|runDenoise|params\.sharpness > 0|params\.chromaClean)\)`,
    String.raw`release\((?<rel>[^)]+)\)`,
  ].join('|'), 'g');
  const events = (body: string): string[] => {
    let t = body;
    for (const [re, to] of RENAMES) t = t.replace(re, to);
    const out: string[] = [];
    for (const m of t.matchAll(EVENT)) {
      const g = m.groups!;
      if (g.dkey) out.push(`draw ${g.dkey} -> ${g.ddst}`);
      else if (g.bs) out.push(`  bind ${g.bs} = ${g.btex}`);
      else if (g.un) out.push(`  uniform ${g.un} = ${g.ue}`);
      else if (g.gargs) out.push(`gauss(${g.gargs.replace(/, w, h, /, ', ')})`);
      else if (g.cn) out.push(`const ${g.cn} = ${g.ce}`);
      else if (g.an) out.push(`${g.an} = ${g.ae}`);
      else if (g.cond) out.push(`if ${g.cond}`);
      // `release r` = runEnhanceChain's finally-loop teardown of its private allocations;
      // the resident pool persists across frames by design, so it has no counterpart.
      else if (g.rel && g.rel !== 'r') out.push(`release ${g.rel}`);
    }
    return out;
  };

  const chain = cut(
    methodBody('runEnhanceChain(rgba: Float32Array'),
    'const lanczos = ', '// ── Phase 3',
  );
  const resident = cut(
    methodBody('private runResidentEnhance('),
    'const mag = acquire();', 'const mmax = Math.max(1e-6, px[0]);',
  );

  it('extracts a substantial event list from both bodies', () => {
    expect(events(chain).length).toBeGreaterThan(60);
  });

  it('every draw target, sampler binding, uniform and chain assignment matches stage by stage', () => {
    expect(events(resident)).toEqual(events(chain));
  });
});

describe('resident helper shaders', () => {
  it('enh_edge_mag is the exact FRAG_ENH_SOBEL stencil without pow/normalisation', () => {
    expect(FRAG_ENH_EDGE_MAG.startsWith('#version 300 es')).toBe(true);
    for (const line of [
      'float a = at(vec2(-t.x, -t.y)), b = at(vec2(0.0, -t.y)), c = at(vec2(t.x, -t.y));',
      'float d = at(vec2(-t.x, 0.0)),                            f = at(vec2(t.x, 0.0));',
      'float g = at(vec2(-t.x,  t.y)), h = at(vec2(0.0,  t.y)), i = at(vec2(t.x,  t.y));',
      'float gx = -a - 2.0 * d - g + c + 2.0 * f + i;',
      'float gy = -a - 2.0 * b - c + g + 2.0 * h + i;',
      'float mag = sqrt(gx * gx + gy * gy);',
    ]) {
      expect(FRAG_ENH_EDGE_MAG).toContain(line);
      expect(ENHANCE_PROGRAM_SOURCES.enh_sobel).toContain(line);
    }
    expect(FRAG_ENH_EDGE_MAG).not.toContain('pow(');
    expect(FRAG_ENH_EDGE_MAG).not.toContain('u_invMmax');
  });

  it('max_reduce4 takes a bounds-checked 4x4 texelFetch max', () => {
    expect(FRAG_MAX_REDUCE4).toContain('texelFetch');
    expect(FRAG_MAX_REDUCE4).toContain('u_srcSize');
    expect(FRAG_MAX_REDUCE4).toMatch(/max\(/);
  });

  it('the new programs live in PROGRAM_SOURCES, not ENHANCE_PROGRAM_SOURCES', () => {
    expect(ENHANCE_PROGRAM_SOURCES).not.toHaveProperty('enh_edge_mag');
    expect(ENHANCE_PROGRAM_SOURCES).not.toHaveProperty('max_reduce4');
    expect(pipelineSrc).toMatch(/^\s+enh_edge_mag: FRAG_ENH_EDGE_MAG,\r?$/m);
    expect(pipelineSrc).toMatch(/^\s+max_reduce4: FRAG_MAX_REDUCE4,\r?$/m);
  });
});
