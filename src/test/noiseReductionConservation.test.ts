/**
 * Noise Reduction buffer conservation (v1.32.0) — regression for the shredded
 * NR exports. Root cause: the CPU "wavelet" denoiser was a placeholder that
 * returned a quarter-resolution buffer, and auto-selection routed EVERY >1MP
 * CPU denoise into it (only exports hit the CPU path — previews use the GPU).
 * Contracts:
 *  - the wavelet stub is an honest identity (length-conserving)
 *  - denoiseSync conserves length for every method at any size
 *  - the tiled GPU path stitches full coverage with no unprocessed seams
 *  - the pipeline guard skips any module whose output length lies
 */
import { AdvancedDenoisingService } from '../services/AdvancedDenoisingService';
import { NoiseReductionModule } from '../modules/NoiseReductionModule';
import { webGLImageProcessor } from '../services/WebGLImageProcessor';
import { ImageProcessingPipeline } from '../services/ImageProcessingPipeline';

const rgba = (w: number, h: number, v = 0.5): Float32Array => {
  const d = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 1; }
  return d;
};

describe('AdvancedDenoisingService length conservation', () => {
  const svc = new AdvancedDenoisingService();

  test.each(['wavelet', 'bm3d', 'nlmeans', 'hybrid'] as const)('%s conserves buffer length', (method) => {
    const W = 32; const H = 24;
    const out = svc.denoiseSync(rgba(W, H), W, H, { method, strength: 50 });
    expect(out.length).toBe(W * H * 4);
  });
});

describe('NoiseReductionModule guards', () => {
  test('large image with no GPU passes through unchanged (no quarter-res shred)', () => {
    // >1MP with GPU unavailable (jsdom): the old code routed into the broken
    // wavelet stub; now it must be an identity pass at FULL length.
    const W = 1200; const H = 900; // 1.08MP
    const input = rgba(W, H, 0.4);
    const mod = new NoiseReductionModule();
    mod.setParams({ enabled: true, strength: 40, method: 'auto' });
    const out = mod.process(input, { width: W, height: H, channels: 4 });
    expect(out.length).toBe(input.length);
    expect(Array.from(out.slice(0, 8))).toEqual(Array.from(input.slice(0, 8)));
  });

  test('tiled GPU path covers every pixel without seams', () => {
    // Mock the GPU kernel: +0.25 on every channel. Tile size 8 with apron 2 on
    // a 20x12 image forces a multi-tile grid incl. partial edge tiles.
    const spy = jest.spyOn(webGLImageProcessor, 'denoise').mockImplementation(
      (data: Float32Array) => {
        const out = new Float32Array(data.length);
        for (let i = 0; i < data.length; i++) out[i] = data[i] + 0.25;
        return out;
      },
    );
    try {
      const W = 20; const H = 12;
      const input = rgba(W, H, 0.25);
      const mod = new NoiseReductionModule();
      const out = mod.denoiseTiledGPU(input, W, H, 50, 8, 2);
      expect(out).not.toBeNull();
      expect(out!.length).toBe(input.length);
      // EVERY pixel must have been processed exactly once (+0.25).
      for (let i = 0; i < input.length; i += 4) {
        expect(out![i]).toBeCloseTo(0.5, 5);
      }
    } finally {
      spy.mockRestore();
    }
  });

  test('tiled GPU path returns null when a tile fails (caller falls back)', () => {
    const spy = jest.spyOn(webGLImageProcessor, 'denoise').mockReturnValue(null);
    try {
      const mod = new NoiseReductionModule();
      expect(mod.denoiseTiledGPU(rgba(20, 12), 20, 12, 50, 8, 2)).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('pipeline buffer-conservation guard', () => {
  test('a module returning a short buffer is skipped, not propagated', async () => {
    const W = 32; const H = 24;
    const p = new ImageProcessingPipeline();
    for (const m of p.getOrderedModules()) p.setModuleEnabled(m.getId(), m.getId() === 'noise-reduction');
    const nr = p.getModule('noise-reduction') as NoiseReductionModule;
    nr.setParams({ enabled: true, strength: 40 });
    // Lie about the output size — the guard must discard it.
    jest.spyOn(nr, 'process').mockReturnValue(new Float32Array(8 * 6 * 4));
    const context = { width: W, height: H, channels: 4 };
    const out = await p.processImage(rgba(W, H), context, { useWebWorkers: false, cacheResults: false });
    expect(out.length).toBe(W * H * 4);
    expect(context.width).toBe(W);
    expect(context.height).toBe(H);
  });
});
