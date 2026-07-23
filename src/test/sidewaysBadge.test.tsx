/**
 * v1.37.0 R2 Part C — the "may be sideways?" suggestion badge.
 *
 * NEVER auto-rotates: the heuristic only surfaces a dismissible glass chip
 * near the toolbar. One click applies the lossless quarter-turn in the
 * computed direction via the v1.34.0 orientation mechanism (programmatic
 * crop-write recipe, orientation only); dismiss hides it for that photo for
 * the session. Badge state is per-image, recomputed on image open only.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { Toolbar } from '../components/Layout/Toolbar';
import {
  computeSidewaysHintForImage,
  acceptSidewaysHint,
  dismissCurrentSidewaysHint,
} from '../services/SidewaysHintService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { imageService } from '../services/ImageService';
import { CropPipelineModule } from '../modules/CropPipelineModule';
import { useAppStore } from '../stores/appStore';

// The Toolbar renders an empty shell outside Electron (jsdom) — pretend we are in it.
jest.mock('../services/ElectronService', () => ({
  electronService: { isElectron: () => true, openFile: jest.fn() },
}));

const W = 120;
const H = 90;

/** Sideways-landscape preview (sky left → rotate 90). */
function sidewaysPreview(): { data: Float32Array; width: number; height: number } {
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = x < W * 0.45 ? 0.85 : 0.25;
      const i = (y * W + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 1;
    }
  }
  return { data, width: W, height: H };
}

/** Upright preview (horizontal horizon — no hint). */
function uprightPreview(): { data: Float32Array; width: number; height: number } {
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = y < H * 0.45 ? 0.85 : 0.25;
      const i = (y * W + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 1;
    }
  }
  return { data, width: W, height: H };
}

const getAdapter = () => imageProcessingPipeline.getModule<CropPipelineModule>('crop')!;

/** Mock the ImageService BASE image (the compute's pixel source since the
 *  wiring fix — the processed preview is cleared/re-published asynchronously
 *  around opens and raced the original design; see the R2 report). */
function mockBase(img: { data: Float32Array; width: number; height: number } | null, filePath = 'C:/img/base.jpg') {
  jest.spyOn(imageService, 'getCurrentImage').mockReturnValue(
    (img ? { ...img, fileName: 'base.jpg', filePath } : null) as unknown as ReturnType<typeof imageService.getCurrentImage>,
  );
}

describe('SidewaysHintService — per-image hint state', () => {
  beforeEach(() => {
    getAdapter().reset();
    const st = useAppStore.getState();
    st.setSidewaysHint(null);
    st.clearSidewaysDismissals();
    mockBase(sidewaysPreview());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    getAdapter().reset();
  });

  test('sideways base → hint set for that image with the computed direction', () => {
    computeSidewaysHintForImage('img-a');
    expect(useAppStore.getState().sidewaysHint).toEqual({ imageId: 'img-a', rotate: 90 });
  });

  test('upright base → no hint', () => {
    mockBase(uprightPreview());
    computeSidewaysHintForImage('img-a');
    expect(useAppStore.getState().sidewaysHint).toBeNull();
  });

  test('no base pixels → no hint (and never throws)', () => {
    mockBase(null);
    computeSidewaysHintForImage('img-a');
    expect(useAppStore.getState().sidewaysHint).toBeNull();
  });

  test('path mismatch (decode not landed) → hint untouched, no wrong-photo analysis', () => {
    mockBase(sidewaysPreview(), 'C:/img/PREVIOUS.jpg');
    computeSidewaysHintForImage('img-b', 'C:/img/base.jpg');
    // The previous photo's base must NOT produce a hint for the new image;
    // the follow-up snapshot bump (with the right base) retries.
    expect(useAppStore.getState().sidewaysHint).toBeNull();
  });

  test('path match → computes normally', () => {
    mockBase(sidewaysPreview(), 'C:/img/base.jpg');
    computeSidewaysHintForImage('img-b', 'C:/img/base.jpg');
    expect(useAppStore.getState().sidewaysHint).toEqual({ imageId: 'img-b', rotate: 90 });
  });

  test('an already-applied quarter-turn suppresses the hint (base pixels predate it)', () => {
    getAdapter().getCropModule().setParams({ orientation: 90, enabled: true });
    computeSidewaysHintForImage('img-a');
    expect(useAppStore.getState().sidewaysHint).toBeNull();
  });

  test('accept applies the lossless quarter-turn via the crop-write recipe and clears the hint', () => {
    computeSidewaysHintForImage('img-a');
    const pv = useAppStore.getState().processingVersion;
    const ev = useAppStore.getState().externalParamsVersion;

    acceptSidewaysHint();

    const inner = getAdapter().getCropModule();
    expect(inner.normalizedOrientation()).toBe(90);
    expect(inner.getParams().enabled).toBe(true);
    expect(getAdapter().getEnabled()).toBe(true); // v1.34.0 adapter-enable mirror
    // Orientation ONLY — no crop rect, no angle.
    const p = inner.getParams();
    expect([p.x, p.y, p.width, p.height, p.angle]).toEqual([0, 0, 1, 1, 0]);
    // Single refresh + reprocess for the write.
    expect(useAppStore.getState().processingVersion).toBe(pv + 1);
    expect(useAppStore.getState().externalParamsVersion).toBe(ev + 1);
    expect(useAppStore.getState().sidewaysHint).toBeNull();
  });

  test('STALE hint (orientation set between compute and click) → discarded, nothing applied', () => {
    // A hint is only ever born at orientation 0 (the compute gate). If a
    // persisted orientation restores between compute and click, applying the
    // delta would land 180° on an already-fixed photo — the click must
    // discard the hint instead.
    useAppStore.getState().setSidewaysHint({ imageId: 'img-a', rotate: 90 });
    getAdapter().getCropModule().setParams({ orientation: 90, enabled: true });
    const pv = useAppStore.getState().processingVersion;

    acceptSidewaysHint();

    expect(getAdapter().getCropModule().normalizedOrientation()).toBe(90); // untouched
    expect(useAppStore.getState().sidewaysHint).toBeNull();                // discarded
    expect(useAppStore.getState().processingVersion).toBe(pv);             // no reprocess
  });

  test('dismiss hides the hint for that photo for the session (recompute stays hidden)', () => {
    computeSidewaysHintForImage('img-a');
    expect(useAppStore.getState().sidewaysHint).not.toBeNull();

    dismissCurrentSidewaysHint();
    expect(useAppStore.getState().sidewaysHint).toBeNull();

    // Reopening the same photo recomputes — the dismissal must hold.
    computeSidewaysHintForImage('img-a');
    expect(useAppStore.getState().sidewaysHint).toBeNull();

    // A DIFFERENT photo with sideways pixels still gets its own hint.
    computeSidewaysHintForImage('img-b');
    expect(useAppStore.getState().sidewaysHint).toEqual({ imageId: 'img-b', rotate: 90 });
  });

  test('accept without a hint is a no-op (no crop write)', () => {
    useAppStore.getState().setSidewaysHint(null);
    const pv = useAppStore.getState().processingVersion;
    acceptSidewaysHint();
    expect(getAdapter().getCropModule().normalizedOrientation()).toBe(0);
    expect(useAppStore.getState().processingVersion).toBe(pv);
  });
});

describe('Toolbar — the sideways suggestion chip', () => {
  test('renders the chip when a hint is active; click fires the rotate handler', () => {
    const onRotate = jest.fn();
    const onDismiss = jest.fn();
    render(<Toolbar hasImage sidewaysHint onSidewaysRotate={onRotate} onSidewaysDismiss={onDismiss} />);

    const chip = screen.getByRole('button', { name: /may be sideways/i });
    fireEvent.click(chip);
    expect(onRotate).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  test('the × dismiss control fires the dismiss handler (not rotate)', () => {
    const onRotate = jest.fn();
    const onDismiss = jest.fn();
    render(<Toolbar hasImage sidewaysHint onSidewaysRotate={onRotate} onSidewaysDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onRotate).not.toHaveBeenCalled();
  });

  test('no chip without a hint', () => {
    render(<Toolbar hasImage />);
    expect(screen.queryByRole('button', { name: /may be sideways/i })).toBeNull();
  });

  test('no chip without an image (stale hint can never render over an empty canvas)', () => {
    render(<Toolbar hasImage={false} sidewaysHint />);
    expect(screen.queryByRole('button', { name: /may be sideways/i })).toBeNull();
  });
});
