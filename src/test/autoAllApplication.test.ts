/**
 * v1.37.0 R2 — the extracted Auto All application seam (services/AutoAllService).
 *
 * D4: Auto All = the standalone Basic-Adjustments bundle (exposure toward
 * neutral, highlights/shadows recovery, black_point clip-lift) + the pixel
 * auto-WB (skipped on a camera-matched base) + auto-straighten (Part B).
 * The ExposureModule write and the App-level Shadows/Highlights fold are GONE.
 *
 * These tests drive the REAL composition (real pipeline singleton, real
 * AutoAdjustService) without a full <App/> render — the R1 handoff seam.
 */
import { applyAutoAll, type AutoAllDeps } from '../services/AutoAllService';
import { checkpointService } from '../services/CheckpointService';
import { autoAdjustService, CAMERA_MATCHED_AUTO_STRENGTH } from '../services/AutoAdjustService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { imageService } from '../services/ImageService';
import { useAppStore } from '../stores/appStore';
import { DEFAULT_RAW_DECODE_OPTIONS } from '../types/electron';

/** Same engineered scene as autoAllStrength.test.ts: every bundle key non-zero. */
function syntheticImage(): { data: Float32Array; width: number; height: number } {
  const width = 64;
  const height = 60;
  const data = new Float32Array(width * height * 4);
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const frac = i / (n - 1);
    let v: number;
    if (frac < 0.15) v = 0.001 + 0.002 * (frac / 0.15);
    else if (frac < 0.75) v = 0.25 + 0.08 * ((frac - 0.15) / 0.6);
    else v = 0.96 + 0.04 * ((frac - 0.75) / 0.25);
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 1;
  }
  return { data, width, height };
}

type ParamModule = {
  setParams: (p: Record<string, unknown>) => void;
  getParams: () => Record<string, unknown>;
  reset?: () => void;
};

const makeDeps = (): AutoAllDeps & { showSuccess: jest.Mock; showError: jest.Mock; showInfo: jest.Mock } => ({
  showSuccess: jest.fn(),
  showError: jest.fn(),
  showInfo: jest.fn(),
});

const img = syntheticImage();

function mockCurrentImage(overrides: Record<string, unknown> = {}) {
  jest.spyOn(imageService, 'getCurrentImage').mockReturnValue({
    data: img.data,
    width: img.width,
    height: img.height,
    fileName: 'synthetic.jpg',
    filePath: 'C:/img/synthetic.jpg',
    isRaw: false,
    ...overrides,
  } as unknown as ReturnType<typeof imageService.getCurrentImage>);
}

describe('applyAutoAll — composition (v1.37.0 D4)', () => {
  beforeEach(() => {
    useAppStore.getState().setDeveloping(false);
    useAppStore.getState().setRawDecodeOptions({ ...DEFAULT_RAW_DECODE_OPTIONS, cameraMatch: false });
    // Neutral module state before every run.
    (imageProcessingPipeline.getModule('basicadj') as unknown as ParamModule | undefined)?.reset?.();
    const crop = imageProcessingPipeline.getModule('crop') as unknown as { reset: () => void } | undefined;
    crop?.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes the FULL standalone bundle into Basic Adjustments (exposure + S/H + black_point live here now)', () => {
    mockCurrentImage();
    const deps = makeDeps();

    applyAutoAll(deps);

    const expected = autoAdjustService.autoBasicAdj(
      autoAdjustService.analyse(img.data, img.width, img.height),
      { standalone: true },
    ) as unknown as Record<string, number>;
    const written = (imageProcessingPipeline.getModule('basicadj') as unknown as ParamModule).getParams() as Record<string, number>;

    for (const k of ['exposure', 'contrast', 'brightness', 'saturation', 'vibrance', 'highlights', 'shadows', 'black_point']) {
      expect({ key: k, value: written[k] }).toEqual({ key: k, value: expected[k] });
    }
    // The engineered scene guarantees these are real (non-zero) writes.
    expect(written.exposure).toBeGreaterThan(0);
    expect(written.highlights).toBeLessThan(0);
    expect(written.shadows).toBeGreaterThan(0);
    expect(written.black_point).toBeGreaterThan(0);
    expect(deps.showSuccess).toHaveBeenCalled();
  });

  it('does NOT write the ExposureModule (the composed autoExposure path is gone)', () => {
    mockCurrentImage();
    const exposureMod = imageProcessingPipeline.getModule('exposure') as unknown as {
      setCurrentParams: (p: Record<string, unknown>) => void;
      getCurrentParams: () => Record<string, number>;
    };
    const spy = jest.spyOn(exposureMod, 'setCurrentParams');

    applyAutoAll(makeDeps());

    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT write the ShadowsHighlights module (no App-level fold — ONE S/H writer)', () => {
    mockCurrentImage();
    const shMod = imageProcessingPipeline.getModule('shadowshighlights') as unknown as ParamModule | undefined;
    if (!shMod) return; // module not registered in this build — nothing to protect
    const before = JSON.stringify(shMod.getParams());

    applyAutoAll(makeDeps());

    expect(JSON.stringify(shMod.getParams())).toBe(before);
  });

  it('runs the pixel auto-WB on a non-matched base', () => {
    mockCurrentImage();
    const wbMod = imageProcessingPipeline.getModule('temperature') as unknown as {
      autoDetectWhiteBalance: (d: Float32Array, ctx: Record<string, number>) => void;
    };
    const spy = jest.spyOn(wbMod, 'autoDetectWhiteBalance').mockImplementation(() => {});

    applyAutoAll(makeDeps());

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('skips auto-WB AND halves the bundle on a camera-matched base', () => {
    useAppStore.getState().setRawDecodeOptions({ ...DEFAULT_RAW_DECODE_OPTIONS, cameraMatch: true });
    mockCurrentImage({ isRaw: true });
    const wbMod = imageProcessingPipeline.getModule('temperature') as unknown as {
      autoDetectWhiteBalance: (d: Float32Array, ctx: Record<string, number>) => void;
    };
    const wbSpy = jest.spyOn(wbMod, 'autoDetectWhiteBalance').mockImplementation(() => {});

    applyAutoAll(makeDeps());

    expect(wbSpy).not.toHaveBeenCalled();

    const fullBundle = autoAdjustService.autoBasicAdj(
      autoAdjustService.analyse(img.data, img.width, img.height),
      { standalone: true },
    ) as unknown as Record<string, number>;
    const written = (imageProcessingPipeline.getModule('basicadj') as unknown as ParamModule).getParams() as Record<string, number>;
    for (const k of ['exposure', 'highlights', 'shadows', 'black_point', 'contrast', 'saturation']) {
      expect(Math.abs(written[k] - fullBundle[k] * CAMERA_MATCHED_AUTO_STRENGTH)).toBeLessThan(1e-9);
    }
  });

  it('bumps externalParamsVersion + processingVersion and sets the spinner', () => {
    mockCurrentImage();
    const before = useAppStore.getState();
    const pv = before.processingVersion;
    const ev = before.externalParamsVersion;

    applyAutoAll(makeDeps());

    const after = useAppStore.getState();
    expect(after.processingVersion).toBe(pv + 1);
    expect(after.externalParamsVersion).toBe(ev + 1);
    expect(after.isProcessing).toBe(true);
  });

  it('is blocked by the developing-window guard (info toast, no writes)', () => {
    mockCurrentImage();
    useAppStore.getState().setDeveloping(true);
    const baMod = imageProcessingPipeline.getModule('basicadj') as unknown as ParamModule;
    const before = JSON.stringify(baMod.getParams());
    const deps = makeDeps();

    applyAutoAll(deps);

    expect(deps.showInfo).toHaveBeenCalledWith('Auto All', expect.stringMatching(/developing/i));
    expect(deps.showSuccess).not.toHaveBeenCalled();
    expect(JSON.stringify(baMod.getParams())).toBe(before);
    useAppStore.getState().setDeveloping(false);
  });

  it('records ONE "Auto All" history checkpoint, and a repeat no-op click records nothing', () => {
    mockCurrentImage();
    const spy = jest.spyOn(checkpointService, 'recordLabeled');
    const recorded = jest.spyOn(checkpointService, 'record');

    applyAutoAll(makeDeps());

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('Auto All', undefined, true);
    const cps = checkpointService.getCheckpoints();
    expect(cps[cps.length - 1]?.label).toBe('Auto All');
    expect(recorded).not.toHaveBeenCalled(); // no generic describeChange entry for the transaction

    // Second click with identical resulting params → dedupe → no duplicate entry.
    const countAfterFirst = cps.length;
    applyAutoAll(makeDeps());
    expect(checkpointService.getCheckpoints().length).toBe(countAfterFirst);
  });

  it('errors cleanly with no image', () => {
    jest.spyOn(imageService, 'getCurrentImage').mockReturnValue(null as unknown as ReturnType<typeof imageService.getCurrentImage>);
    const deps = makeDeps();

    applyAutoAll(deps);

    expect(deps.showError).toHaveBeenCalledWith('Auto All', expect.any(String));
    expect(deps.showSuccess).not.toHaveBeenCalled();
  });
});

// ─── Part B: headless auto-straighten inside Auto All (D4) ──────────────────
// Auto All runs CropModule.autoStraighten on the CURRENT preview pixels ONLY
// for a fresh-photo crop state (no crop rect, no orientation, no angle) —
// already-rotated pixels would double-correct, and Auto All must never fight
// user framing. On detection it applies angle + the SHARED wedge-free crop
// patch via the v1.34.0 programmatic recipe (inner setParams enabled +
// adapter setEnabled + invalidateModuleCache).

import { CropPipelineModule } from '../modules/CropPipelineModule';

describe('applyAutoAll — auto-straighten (Part B)', () => {
  const getAdapter = () => imageProcessingPipeline.getModule<CropPipelineModule>('crop')!;

  beforeEach(() => {
    useAppStore.getState().setDeveloping(false);
    useAppStore.getState().setRawDecodeOptions({ ...DEFAULT_RAW_DECODE_OPTIONS, cameraMatch: false });
    getAdapter().reset();
    (imageProcessingPipeline.getModule('basicadj') as unknown as ParamModule | undefined)?.reset?.();
    // Preview pixels available in the store (what autoStraighten analyses).
    useAppStore.getState().setProcessedImageData({
      data: img.data, width: img.width, height: img.height,
    } as unknown as Parameters<ReturnType<typeof useAppStore.getState>['setProcessedImageData']>[0]);
    mockCurrentImage();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    useAppStore.getState().setProcessedImageData(null);
    getAdapter().reset();
  });

  /** Simulate a 2° detection the way the real autoStraighten applies it. */
  function mockDetection(angle = 2): jest.SpyInstance {
    const inner = getAdapter().getCropModule();
    return jest.spyOn(inner, 'autoStraighten').mockImplementation(() => {
      const auto = inner.calculateAutoCropForRotation(img.width, img.height, angle);
      inner.setParams({ angle, enabled: true, expandCanvas: true, ...auto });
      return true;
    });
  }

  it('fresh photo + detected angle → angle + wedge-free crop + adapter-enable mirror', () => {
    const spy = mockDetection(2);

    applyAutoAll(makeDeps());

    const inner = getAdapter().getCropModule();
    expect(spy).toHaveBeenCalledTimes(1);
    // Channels detected from the preview buffer, like the crop card does.
    expect(spy.mock.calls[0][1]).toEqual({ width: img.width, height: img.height, channels: 4 });

    const p = inner.getParams();
    const expected = inner.calculateAutoCropForRotation(img.width, img.height, 2);
    expect(p.angle).toBe(2);
    expect(p.enabled).toBe(true);
    expect(p.x).toBeCloseTo(expected.x, 10);
    expect(p.y).toBeCloseTo(expected.y, 10);
    expect(p.width).toBeCloseTo(expected.width, 10);
    expect(p.height).toBeCloseTo(expected.height, 10);
    expect(getAdapter().getEnabled()).toBe(true); // the v1.34.0 mirror
  });

  it('SKIPS silently when a crop rect exists (never fights user framing)', () => {
    getAdapter().getCropModule().setParams({ x: 0.1, y: 0.1, width: 0.7, height: 0.7, enabled: true });
    const spy = mockDetection();
    const before = getAdapter().getCropModule().getParams();

    applyAutoAll(makeDeps());

    expect(spy).not.toHaveBeenCalled();
    expect(getAdapter().getCropModule().getParams()).toEqual(before);
  });

  it('SKIPS silently when an orientation quarter-turn exists', () => {
    getAdapter().getCropModule().setParams({ orientation: 90, enabled: true });
    const spy = mockDetection();

    applyAutoAll(makeDeps());

    expect(spy).not.toHaveBeenCalled();
    expect(getAdapter().getCropModule().getParams().angle).toBe(0);
  });

  it('SKIPS silently when a straighten angle exists already', () => {
    getAdapter().getCropModule().setParams({ angle: 1.5, enabled: true });
    const spy = mockDetection();

    applyAutoAll(makeDeps());

    expect(spy).not.toHaveBeenCalled();
    expect(getAdapter().getCropModule().getParams().angle).toBe(1.5);
  });

  it('SKIPS when no preview pixels are available — the rest of Auto All still applies', () => {
    useAppStore.getState().setProcessedImageData(null);
    const spy = mockDetection();
    const deps = makeDeps();

    applyAutoAll(deps);

    expect(spy).not.toHaveBeenCalled();
    expect(deps.showSuccess).toHaveBeenCalled();
    const written = (imageProcessingPipeline.getModule('basicadj') as unknown as ParamModule).getParams() as Record<string, number>;
    expect(written.exposure).toBeGreaterThan(0); // adjustments landed regardless
  });

  it('leaves crop untouched when detection finds nothing (already straight)', () => {
    const inner = getAdapter().getCropModule();
    const spy = jest.spyOn(inner, 'autoStraighten').mockReturnValue(false);
    const before = inner.getParams();

    applyAutoAll(makeDeps());

    expect(spy).toHaveBeenCalledTimes(1);
    expect(inner.getParams()).toEqual(before);
    expect(getAdapter().getEnabled()).toBe(false); // reset() left it disabled; no write = no enable
  });
});
