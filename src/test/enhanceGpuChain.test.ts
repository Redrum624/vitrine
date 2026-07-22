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
import { GpuPreviewPipeline } from '../shaders/GpuPreviewPipeline';
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
