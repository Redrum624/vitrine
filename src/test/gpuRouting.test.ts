/**
 * Compute-routing decision tests for the live GPU path (Task 6).
 *
 * The AdjustmentPanel routes a preview frame to the GPU when:
 *   gpuPreviewPipeline.isAvailable() && buildPassList(orderedModules).cpuBridges.length === 0
 *
 * WebGL is unavailable in Jest, so we can't exercise gpuPreviewPipeline rendering — but
 * the *decision input* is pure logic: ImageProcessingPipeline.getOrderedModules() feeding
 * buildPassList(). These tests verify that accessor produces a builder-ready, correctly
 * ORDERED, correctly SHAPED module view (the bit that decides cpu-vs-gpu).
 */
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import type { PipelineModule } from '../services/ImageProcessingPipeline';
import { buildPassList } from '../shaders/passDescriptors';
import { LensCorrectionsPipelineModule } from '../modules/LensCorrectionsPipelineModule';
import { CropPipelineModule } from '../modules/CropPipelineModule';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { ShadowsHighlightsPipelineModule } from '../modules/ShadowsHighlightsPipelineModule';

describe('ImageProcessingPipeline.getOrderedModules()', () => {
  it('returns modules in the pipeline processing order', () => {
    const ordered = imageProcessingPipeline.getOrderedModules();
    const ids = ordered.map((m) => m.getId());
    expect(ids).toEqual(imageProcessingPipeline.getProcessingOrder());
  });

  it('every entry exposes getId/getParams (builder-ready shape)', () => {
    const ordered = imageProcessingPipeline.getOrderedModules();
    for (const m of ordered) {
      expect(typeof m.getId()).toBe('string');
      expect(typeof m.getParams()).toBe('object');
    }
  });

  it('reflects live isEnabled via getter (not a stale snapshot)', () => {
    // The adapter exposes isEnabled as a live getter onto the real module, so toggling
    // the module's enabled state through the pipeline's public setModuleEnabled() must be
    // visible on the adapter captured BEFORE the toggle.
    const basic = imageProcessingPipeline.getOrderedModules().find((m) => m.getId() === 'basicadj')!;
    // isEnabled lives on the PipelineModule interface (optional), not the concrete class.
    const realBasic = imageProcessingPipeline.getModule<PipelineModule>('basicadj')!;
    const original = realBasic.isEnabled;

    imageProcessingPipeline.setModuleEnabled('basicadj', false);
    expect(basic.isEnabled).toBe(false);
    imageProcessingPipeline.setModuleEnabled('basicadj', true);
    expect(basic.isEnabled).toBe(true);

    // Restore whatever the original state was (undefined ⇒ leave enabled).
    imageProcessingPipeline.setModuleEnabled('basicadj', original !== false);
  });

  it('lifts lenscorrections nested sub-effects to the top level for the builder', () => {
    const lens = imageProcessingPipeline.getModule<LensCorrectionsPipelineModule>('lenscorrections')!;
    // Enable a distortion sub-effect with a non-identity barrel.
    const cur = lens.getParameters().lensCorrectionsParams;
    lens.setParameters({
      lensCorrectionsParams: {
        ...cur,
        distortion: { ...cur.distortion, enabled: true, barrel: 25 },
      },
    });

    const ordered = imageProcessingPipeline.getOrderedModules();
    const lensView = ordered.find((m) => m.getId() === 'lenscorrections')!;
    const p = lensView.getParams() as { distortion?: { enabled?: boolean; barrel?: number } };
    // The builder reads params.distortion at the TOP level — the adapter must expose it.
    expect(p.distortion?.enabled).toBe(true);
    expect(p.distortion?.barrel).toBe(25);

    // And buildPassList should now emit a distortion GPU sub-pass for it.
    const { passes } = buildPassList([lensView]);
    expect(passes.map((x) => x.id)).toContain('lenscorrections:distortion');

    // Cleanup: reset lens corrections to defaults.
    lens.reset();
  });
});

describe('routing decision (cpuBridges gate)', () => {
  it('a single enabled basicadj produces a GPU pass and no cpu bridges', () => {
    const basic = imageProcessingPipeline.getModule<PipelineModule>('basicadj')!;
    const basicView = imageProcessingPipeline.getOrderedModules().find((m) => m.getId() === 'basicadj')!;
    // basicadj is enabled by default (isEnabled is undefined, treated as true).
    expect(basic.isEnabled).not.toBe(false);

    const { passes, cpuBridges } = buildPassList([basicView]);
    expect(passes.map((p) => p.id)).toEqual(['basicadj']);
    expect(cpuBridges).toEqual([]);
  });

  it('an active crop forces the cpu path (crop is a cpuBridge, never GPU)', () => {
    // Crop is not in GPU_MODULE_IDS, so an enabled crop module lands in cpuBridges →
    // cpuBridges.length !== 0 → AdjustmentPanel keeps renderMode = cpu.
    const cropView = {
      getId: () => 'crop',
      isEnabled: true,
      getParams: () => ({ enabled: true, x: 0.1, y: 0.1, width: 0.8, height: 0.8 }),
    };
    const { passes, cpuBridges } = buildPassList([cropView]);
    expect(passes).toEqual([]);
    expect(cpuBridges).toContain('crop');
  });

  it('local adjustments active forces the cpu path', () => {
    const laView = {
      getId: () => 'localadjustments',
      isEnabled: true,
      getParams: () => ({ enabled: true, layers: [{ id: 'x' }] }),
    };
    const { cpuBridges } = buildPassList([laView]);
    expect(cpuBridges).toContain('localadjustments');
  });
});

/**
 * The load-bearing Task 6 routing fix: with all 11 modules registered, buildPassList()
 * maps every CPU-only id (crop, exposure, sharpen, shadowshighlights, localadjustments,
 * noise-reduction) to cpuBridges PURELY BY ID — so raw cpuBridges is never empty. The
 * panel therefore can't gate on `cpuBridges.length === 0`. Instead it keeps only the
 * cpuBridges that are genuinely ACTIVE via imageProcessingPipeline.isModuleActive()
 * (enabled AND non-identity — the EXACT gate the CPU processImage loop uses at
 * ImageProcessingPipeline.ts ~556-564). Only active CPU-only work blocks the GPU path.
 *
 * NOTE on current defaults (see the report's "concerns"): a freshly-loaded pipeline has
 * crop (enabled:true full-frame), exposure (non-zero deflicker defaults), and
 * shadowshighlights (shadows/highlights:50 defaults) all reporting ACTIVE — the same
 * modules the CPU loop runs every frame today. Those CPU-only modules being GPU-ported is
 * explicitly Task 7 ("make the common chain fully GPU"). Until then the live path stays
 * CPU on a default image; this is consistent, not a regression. These tests assert the
 * MECHANISM (the gate is faithful to the CPU loop), not an aspirational all-GPU default.
 */
describe('isModuleActive() + activeCpuBridges gate (faithful to the CPU processImage gate)', () => {
  afterEach(() => {
    // Reset anything we mutated so other suites see the default pipeline.
    imageProcessingPipeline.getModule<CropPipelineModule>('crop')?.reset?.();
    imageProcessingPipeline.getModule<BasicAdjustmentsModule>('basicadj')?.resetParams?.();
    imageProcessingPipeline.setModuleEnabled('basicadj', true);
  });

  it('raw cpuBridges contains every CPU-only id even when those modules are inactive', () => {
    const ordered = imageProcessingPipeline.getOrderedModules();
    const { cpuBridges } = buildPassList(ordered);
    // buildPassList maps by id, so the inactive CPU-only modules are present regardless.
    expect(cpuBridges).toEqual(expect.arrayContaining(['noise-reduction']));
  });

  it('inactive CPU-only modules are filtered OUT of the active cpu bridges', () => {
    // noise-reduction (enabled:false) and localadjustments (no layers) are all inactive
    // by default → must not appear in the active set.
    expect(imageProcessingPipeline.isModuleActive('noise-reduction')).toBe(false);
    expect(imageProcessingPipeline.isModuleActive('localadjustments')).toBe(false);

    const { cpuBridges } = buildPassList(imageProcessingPipeline.getOrderedModules());
    const activeCpuBridges = cpuBridges.filter((id) => imageProcessingPipeline.isModuleActive(id));
    expect(activeCpuBridges).not.toContain('noise-reduction');
    expect(activeCpuBridges).not.toContain('localadjustments');
  });

  it('full-frame default crop (no rect, no rotation, no flip) is NOT active — does not block GPU', () => {
    // After reset(), CropPipelineModule is at identity defaults (x=0,y=0,w=1,h=1, angle=0, no flips).
    // isModuleActive('crop') must return false so the GPU path is not blocked on a fresh image.
    imageProcessingPipeline.getModule<CropPipelineModule>('crop')?.reset?.();
    expect(imageProcessingPipeline.isModuleActive('crop')).toBe(false);
  });

  it('a non-full-frame crop rect is still ACTIVE — must not silently skip processing', () => {
    const crop = imageProcessingPipeline.getModule<CropPipelineModule>('crop')!;
    crop.setCropRegion(0.1, 0.1, 0.8, 0.8);
    expect(imageProcessingPipeline.isModuleActive('crop')).toBe(true);
  });

  it('a rotation (non-zero angle) is still ACTIVE even when rect is full-frame', () => {
    const crop = imageProcessingPipeline.getModule<CropPipelineModule>('crop')!;
    crop.setEnabled(true); // ensure the pipeline-level enabled flag is on
    crop.getCropModule().setParams({ x: 0, y: 0, width: 1.0, height: 1.0, angle: 5.0 });
    expect(imageProcessingPipeline.isModuleActive('crop')).toBe(true);
  });

  it('a horizontal flip is still ACTIVE even when rect is full-frame', () => {
    const crop = imageProcessingPipeline.getModule<CropPipelineModule>('crop')!;
    crop.setEnabled(true); // ensure the pipeline-level enabled flag is on
    crop.getCropModule().setParams({ x: 0, y: 0, width: 1.0, height: 1.0, flipHorizontal: true });
    expect(imageProcessingPipeline.isModuleActive('crop')).toBe(true);
  });

  it('activating a CPU-only module (crop) makes it appear in the ACTIVE cpu bridges', () => {
    const crop = imageProcessingPipeline.getModule<CropPipelineModule>('crop')!;
    crop.setCropRegion(0.1, 0.1, 0.8, 0.8); // enables crop with a non-identity region
    expect(imageProcessingPipeline.isModuleActive('crop')).toBe(true);

    const { cpuBridges } = buildPassList(imageProcessingPipeline.getOrderedModules());
    const activeCpuBridges = cpuBridges.filter((id) => imageProcessingPipeline.isModuleActive(id));
    expect(activeCpuBridges).toContain('crop');
  });

  it('isModuleActive returns false for an unknown module id', () => {
    expect(imageProcessingPipeline.isModuleActive('does-not-exist')).toBe(false);
  });

  it('isModuleActive mirrors the enabled flag: disabling a non-identity GPU module makes it inactive', () => {
    const basic = imageProcessingPipeline.getModule<BasicAdjustmentsModule>('basicadj')!;
    basic.setParams({ exposure: 0.5 });
    expect(imageProcessingPipeline.isModuleActive('basicadj')).toBe(true);
    imageProcessingPipeline.setModuleEnabled('basicadj', false);
    expect(imageProcessingPipeline.isModuleActive('basicadj')).toBe(false);
    imageProcessingPipeline.setModuleEnabled('basicadj', true);
  });
});

// ---------------------------------------------------------------------------
// T9b — Neutral Shadows/Highlights identity (unblocks GPU path)
// ---------------------------------------------------------------------------
describe('ShadowsHighlights neutral identity (T9b)', () => {
  let sh: ShadowsHighlightsPipelineModule;

  beforeEach(() => {
    sh = imageProcessingPipeline.getModule<ShadowsHighlightsPipelineModule>('shadowshighlights')!;
    // Ensure fresh defaults before each test.
    sh.reset();
  });

  afterEach(() => {
    // Leave pipeline clean for other suites.
    sh.reset();
  });

  it('fresh default S/H (shadows=50, highlights=50, all offsets=0) is NOT active — does not block GPU', () => {
    // Default params: shadows=50, highlights=50, whitePoint=0, blackPoint=0,
    // compress=0, shadowsColorCorrection=0, highlightsColorCorrection=0.
    // With the fix, isModuleActive must return false.
    expect(imageProcessingPipeline.isModuleActive('shadowshighlights')).toBe(false);
  });

  it('neutral S/H with non-default maskBlur (maskBlur=1) is still NOT active — blurring a zero-effect mask is identity', () => {
    // maskBlur alone must not make S/H non-identity: blurring a mask that produces
    // zero effect still yields zero net change.
    sh.setParams({ maskBlur: 1.0 });
    expect(imageProcessingPipeline.isModuleActive('shadowshighlights')).toBe(false);
  });

  it('S/H with shadows=70 (non-neutral tonal change) IS active — must not be treated as identity', () => {
    sh.setParams({ shadows: 70 });
    expect(imageProcessingPipeline.isModuleActive('shadowshighlights')).toBe(true);
  });

  it('S/H with highlights=30 (non-neutral) IS active', () => {
    sh.setParams({ highlights: 30 });
    expect(imageProcessingPipeline.isModuleActive('shadowshighlights')).toBe(true);
  });

  it('S/H with whitePoint=1.0 (non-zero) IS active', () => {
    sh.setParams({ whitePoint: 1.0 });
    expect(imageProcessingPipeline.isModuleActive('shadowshighlights')).toBe(true);
  });

  it('S/H with compress=25 (non-zero) IS active', () => {
    sh.setParams({ compress: 25 });
    expect(imageProcessingPipeline.isModuleActive('shadowshighlights')).toBe(true);
  });

  it('ShadowsHighlightsPipelineModule.isNoOp() mirrors isModuleActive (single-source)', () => {
    // isNoOp() on the pipeline module itself must agree with the pipeline's routing decision.
    expect(sh.isNoOp()).toBe(true); // defaults → identity
    sh.setParams({ shadows: 70 });
    expect(sh.isNoOp()).toBe(false); // non-neutral → active
  });
});
