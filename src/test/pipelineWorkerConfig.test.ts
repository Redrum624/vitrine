/**
 * Tests for the zero-drift module-worker config mapping.
 *
 * A real Worker cannot run in jsdom/jest, so we test the TRANSLATION layer that the
 * pipeline.worker.ts uses: ImageProcessingPipeline.applyWorkerConfig() — the single
 * inverse of getModuleParams that maps a WorkerModuleConfig[] back onto the real
 * registered modules. The worker does nothing more than call applyWorkerConfig() and
 * then processImage(..., useWebWorkers=false), so verifying this round-trip proves
 * the worker reproduces the exact same edit as the main-thread pipeline — with zero
 * duplicated pixel math.
 */
import { ImageProcessingPipeline } from '../services/ImageProcessingPipeline';
import type { WorkerModuleConfig } from '../services/WebWorkerImageProcessor';
import { createGradientImage } from './testUtils';

// Thin typed accessors — getModule<T> constrains T to PipelineModule; the concrete
// module setter/getter shapes are not on that interface, so cast through the module.
function setParams(p: ImageProcessingPipeline, id: string, params: Record<string, unknown>): void {
  (p.getModule(id) as unknown as { setParams(x: Record<string, unknown>): void }).setParams(params);
}
function getParams(p: ImageProcessingPipeline, id: string): Record<string, unknown> {
  return (p.getModule(id) as unknown as { getParams(): Record<string, unknown> }).getParams();
}

// Build the WorkerModuleConfig[] from a configured pipeline the SAME way
// ImageProcessingPipeline.processWithWebWorkers does (private), so the test exercises
// the real producer→consumer contract.
function buildConfig(pipeline: ImageProcessingPipeline): WorkerModuleConfig[] {
  const config: WorkerModuleConfig[] = [];
  for (const moduleId of pipeline.getProcessingOrder()) {
    const module = pipeline.getModules().get(moduleId);
    if (!module) continue;
    config.push({
      moduleId,
      enabled: module.isEnabled !== false,
      // getModuleParams is private; getOrderedModules() exposes the same snapshot.
      params: pipeline.getOrderedModules().find((m) => m.getId() === moduleId)!.getParams(),
    });
  }
  return config;
}

describe('Worker config → pipeline translation (applyWorkerConfig)', () => {
  it('round-trips per-module params onto a fresh pipeline', () => {
    const source = new ImageProcessingPipeline();
    setParams(source, 'basicadj', { exposure: 0.4, contrast: 0.3, saturation: 0.2 });
    setParams(source, 'temperature', { temperature: 4200, tint: 0.1 });

    const config = buildConfig(source);

    const target = new ImageProcessingPipeline();
    target.applyWorkerConfig(config);

    const basic = getParams(target, 'basicadj');
    expect(basic.exposure).toBeCloseTo(0.4);
    expect(basic.contrast).toBeCloseTo(0.3);
    expect(basic.saturation).toBeCloseTo(0.2);

    const wb = getParams(target, 'temperature');
    expect(wb.temperature).toBeCloseTo(4200);
    expect(wb.tint).toBeCloseTo(0.1);
  });

  it('produces pixel-identical output to the directly-configured pipeline', async () => {
    const width = 32;
    const height = 32;
    const context = { width, height, channels: 4 };
    const input = createGradientImage(width, height);

    // Pipeline A: configured directly (what the main thread runs).
    const direct = new ImageProcessingPipeline();
    setParams(direct, 'basicadj', { exposure: 0.3, contrast: 0.25, vibrance: 0.15 });
    setParams(direct, 'temperature', { temperature: 5000, tint: -0.05 });
    const expected = await direct.processImage(new Float32Array(input), context, { useWebWorkers: false });

    // Pipeline B: configured via the worker config path (what the worker runs).
    const config = buildConfig(direct);
    const viaConfig = new ImageProcessingPipeline();
    viaConfig.applyWorkerConfig(config);
    const actual = await viaConfig.processImage(new Float32Array(input), context, { useWebWorkers: false });

    expect(actual.length).toBe(expected.length);
    let maxDiff = 0;
    for (let i = 0; i < expected.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(actual[i] - expected[i]));
    }
    // Same modules, same params, same CPU math → bit-for-bit (allow float epsilon).
    expect(maxDiff).toBeLessThan(1e-6);
  });

  it('applies the enabled flag (disabled module is skipped)', async () => {
    const width = 16;
    const height = 16;
    const context = { width, height, channels: 4 };
    const input = createGradientImage(width, height);

    // Configure a non-identity edit, then DISABLE the module in the config.
    const source = new ImageProcessingPipeline();
    setParams(source, 'basicadj', { exposure: 0.5, contrast: 0.4 });
    const config = buildConfig(source).map((c) =>
      c.moduleId === 'basicadj' ? { ...c, enabled: false } : c,
    );

    const target = new ImageProcessingPipeline();
    target.applyWorkerConfig(config);
    const out = await target.processImage(new Float32Array(input), context, { useWebWorkers: false });

    // basicadj disabled + every other module identity → output == input.
    let maxDiff = 0;
    for (let i = 0; i < input.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(out[i] - input[i]));
    }
    expect(maxDiff).toBeLessThan(1e-6);
  });

  it('ignores unknown module ids without throwing', () => {
    const target = new ImageProcessingPipeline();
    expect(() =>
      target.applyWorkerConfig([{ moduleId: 'does-not-exist', enabled: true, params: {} }]),
    ).not.toThrow();
  });
});
