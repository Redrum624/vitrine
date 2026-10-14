/**
 * Task 12c — "Moving a mask should show everything applied in that mask moving with the mask."
 *
 * Root causes (plan, Owner bug batch): the overlay only updated its local outline during a drag
 * and committed on mouseup; maskCacheKey hashed ~64 strided samples of `layer.mask` + id/dims (no
 * geometry), so small moves collided and the GPU kept the old texture; the key was built from
 * `layer.mask`, not the mask actually uploaded.
 */
import { render, fireEvent, act } from '@testing-library/react';
import { LocalAdjustmentMaskOverlay } from '../components/Canvas/LocalAdjustmentMaskOverlay';
import { applyMaskGeometry } from '../components/Canvas/maskGeometryApply';
import { LocalAdjustmentsModule } from '../modules/LocalAdjustmentsModule';
import type { MaskGeometry } from '../modules/LocalAdjustmentsModule';
import { buildLocalAdjustmentsPass, maskCacheKey } from '../shaders/passDescriptors';
import type { MaskUpload } from '../shaders/passDescriptors';
import { GpuPreviewPipeline } from '../shaders/GpuPreviewPipeline';
import { CropModule } from '../modules/CropModule';

const radial: MaskGeometry = {
  type: 'radial', centerX: 0.3, centerY: 0.5, radiusX: 0.1, radiusY: 0.1,
  startX: 0.5, startY: 0.3, endX: 0.5, endY: 0.7, feather: 0.3, invert: false, rotation: 0,
};

function sizeElement(el: HTMLElement, w: number, h: number) {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: w });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: h });
  jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0, toJSON: () => ({}),
  });
}

// ── Fake requestAnimationFrame ────────────────────────────────────────────────
let rafQueue: Map<number, (t: number) => void>;
let rafSeq: number;
function installFakeRaf() {
  rafQueue = new Map();
  rafSeq = 0;
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { const id = ++rafSeq; rafQueue.set(id, cb); return id; });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { rafQueue.delete(id); });
}
function frame() {
  const cbs = [...rafQueue.values()];
  rafQueue.clear();
  act(() => { for (const cb of cbs) cb(performance.now()); });
}

describe('overlay: live geometry during a drag (rAF-coalesced) + one final commit', () => {
  beforeEach(installFakeRaf);
  afterEach(() => jest.restoreAllMocks());

  it('emits one live update per animation frame (latest value), then exactly one commit', () => {
    const onGeometryChange = jest.fn();
    const onGeometryPreview = jest.fn();
    const { container } = render(
      <LocalAdjustmentMaskOverlay
        viewport={{ zoom: 1, panX: 0, panY: 0 }}
        contentWidth={800}
        contentHeight={600}
        layerType="radial_gradient"
        geometry={{ ...radial, centerX: 0.5 }}
        onGeometryChange={onGeometryChange}
        onGeometryPreview={onGeometryPreview}
      />,
    );
    const root = container.firstChild as HTMLElement;
    sizeElement(root, 800, 600);

    fireEvent.mouseDown(root, { clientX: 400, clientY: 300 });
    // Frame 1: two moves coalesce to ONE live update carrying the latest geometry.
    fireEvent.mouseMove(window, { clientX: 420, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 440, clientY: 300 });
    expect(onGeometryPreview).not.toHaveBeenCalled();
    frame();
    expect(onGeometryPreview).toHaveBeenCalledTimes(1);
    expect((onGeometryPreview.mock.calls[0][0] as MaskGeometry).centerX).toBeCloseTo(0.55, 4);
    // Frames 2..4: one update each.
    for (let i = 1; i <= 3; i++) {
      fireEvent.mouseMove(window, { clientX: 440 + i * 10, clientY: 300 });
      frame();
    }
    expect(onGeometryPreview).toHaveBeenCalledTimes(4);
    // A frame with no movement emits nothing.
    frame();
    expect(onGeometryPreview).toHaveBeenCalledTimes(4);
    expect(onGeometryChange).not.toHaveBeenCalled();

    // A move then release in the same frame: the commit carries it and the stale frame is dropped.
    fireEvent.mouseMove(window, { clientX: 500, clientY: 300 });
    fireEvent.mouseUp(window);
    frame();
    expect(onGeometryChange).toHaveBeenCalledTimes(1);
    expect((onGeometryChange.mock.calls[0][0] as MaskGeometry).centerX).toBeCloseTo(0.625, 4);
    expect(onGeometryPreview).toHaveBeenCalledTimes(4);
  });

  it('unmounting mid-drag cancels the pending frame and removes the window listeners', () => {
    const onGeometryChange = jest.fn();
    const onGeometryPreview = jest.fn();
    const { container, unmount } = render(
      <LocalAdjustmentMaskOverlay
        viewport={{ zoom: 1, panX: 0, panY: 0 }} contentWidth={800} contentHeight={600}
        layerType="radial_gradient" geometry={{ ...radial, centerX: 0.5 }}
        onGeometryChange={onGeometryChange} onGeometryPreview={onGeometryPreview}
      />,
    );
    const root = container.firstChild as HTMLElement;
    sizeElement(root, 800, 600);
    fireEvent.mouseDown(root, { clientX: 400, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 420, clientY: 300 });
    unmount();
    frame();
    fireEvent.mouseMove(window, { clientX: 440, clientY: 300 });
    fireEvent.mouseUp(window);
    frame();
    expect(onGeometryPreview).not.toHaveBeenCalled();
    expect(onGeometryChange).not.toHaveBeenCalled();
  });
});

describe('applyMaskGeometry: live frames reprocess immediately; history/persistence only on release', () => {
  it('live → requestLivePreview (no processingVersion bump); commit → triggerReprocessing once', () => {
    const m = new LocalAdjustmentsModule();
    const id = m.createLayer('radial_gradient', 'L', 64, 48);
    m.setLayerGeometry(id, radial, 64, 48);
    const hooks = { invalidateModuleCache: jest.fn(), requestLivePreview: jest.fn(), triggerReprocessing: jest.fn() };
    for (let i = 1; i <= 10; i++) applyMaskGeometry(m, id, { ...radial, centerX: 0.3 + i * 0.01 }, 'live', hooks);
    applyMaskGeometry(m, id, { ...radial, centerX: 0.45 }, 'commit', hooks);
    expect(hooks.requestLivePreview).toHaveBeenCalledTimes(10);
    expect(hooks.triggerReprocessing).toHaveBeenCalledTimes(1); // History/persistence ride processingVersion
    expect(hooks.invalidateModuleCache).toHaveBeenCalledTimes(11);
    expect(m.getLayer(id)!.geometry!.centerX).toBeCloseTo(0.45, 6);
  });

  it('does NOT pre-bake: the mask is rebaked once, at the render size', () => {
    const m = new LocalAdjustmentsModule();
    const id = m.createLayer('radial_gradient', 'L', 64, 48);
    m.setLayerGeometry(id, radial, 64, 48);
    const spy = jest.spyOn(m, 'setLayerGeometry');
    const hooks = { invalidateModuleCache: jest.fn(), requestLivePreview: jest.fn(), triggerReprocessing: jest.fn() };
    applyMaskGeometry(m, id, { ...radial, centerX: 0.6 }, 'live', hooks);
    expect(spy).not.toHaveBeenCalled();
    m.updateLayerBasicAdj(id, { exposure: 1 });
    m.processImage(new Float32Array(40 * 30 * 4).fill(0.2), 40, 30);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(m.getLayer(id)!.mask.length).toBe(40 * 30);
  });
});

describe('CPU path: a moved mask is rebuilt at its new centre (incl. a cropped frame)', () => {
  const at = (mask: Float32Array, w: number, nx: number, ny: number, h: number) =>
    mask[Math.round(ny * (h - 1)) * w + Math.round(nx * (w - 1))];

  function moved(w: number, h: number) {
    const m = new LocalAdjustmentsModule();
    const id = m.createLayer('radial_gradient', 'L', w, h);
    m.updateLayerBasicAdj(id, { exposure: 1 });
    m.setLayerGeometry(id, radial, w, h);
    const before = m.getLayer(id)!.mask;
    expect(at(before, w, 0.3, 0.5, h)).toBeGreaterThan(0.9);
    expect(at(before, w, 0.7, 0.5, h)).toBeLessThan(0.1);
    m.setLayerGeometryDeferred(id, { ...radial, centerX: 0.7 });
    const out = m.processImage(new Float32Array(w * h * 4).fill(0.25), w, h);
    const after = m.getLayer(id)!.mask;
    expect(after).not.toBe(before); // a fresh buffer — in-place mutation would hide the change
    expect(after.length).toBe(w * h);
    expect(at(after, w, 0.7, 0.5, h)).toBeGreaterThan(0.9);
    expect(at(after, w, 0.3, 0.5, h)).toBeLessThan(0.1);
    // The brightened region moved with the mask.
    const px = (nx: number) => out[(Math.round(0.5 * (h - 1)) * w + Math.round(nx * (w - 1))) * 4];
    expect(px(0.7)).toBeGreaterThan(px(0.3) + 0.1);
  }

  it('full frame', () => moved(120, 80));

  it('cropped frame (post-crop output dims)', () => {
    const crop = new CropModule();
    crop.setParams({ enabled: true, x: 0.1, y: 0.2, width: 0.5, height: 0.5 });
    const out = crop.getOutputDimensions(240, 160);
    expect(out.width).toBeLessThan(240);
    moved(out.width, out.height);
  });
});

describe('GPU mask cache key + bounded per-layer texture cache', () => {
  it('maskCacheKey differs for a 1-px centre shift at 1024 px wide', () => {
    const W = 1024, H = 683;
    const m = new LocalAdjustmentsModule();
    const id = m.createLayer('radial_gradient', 'L', 8, 8);
    m.setLayerGeometry(id, radial, W, H);
    const a = maskCacheKey(m.getLayer(id)!, m.getLayer(id)!.mask, W, H);
    m.setLayerGeometry(id, { ...radial, centerX: radial.centerX + 1 / W }, W, H);
    const b = maskCacheKey(m.getLayer(id)!, m.getLayer(id)!.mask, W, H);
    expect(a).not.toBe(b);
  });

  it('the key is built from the mask actually uploaded (the rebuilt one), not layer.mask', () => {
    const W = 16, H = 16;
    const m = new LocalAdjustmentsModule();
    const id = m.createLayer('radial_gradient', 'L', W, H);
    m.updateLayerBasicAdj(id, { exposure: 0.5 });
    m.setLayerGeometryDeferred(id, radial); // stale (empty) layer.mask
    const params = { enabled: true, layers: m.getLayers() } as Record<string, unknown>;
    const keyFor = (fill: number) => {
      const pass = buildLocalAdjustmentsPass(params, W, H, () => new Float32Array(W * H).fill(fill));
      const up = pass!.subPasses![1].bindings![2].texture as MaskUpload;
      expect(up.data[0]).toBe(fill);
      return up.key;
    };
    expect(keyFor(0.25)).not.toBe(keyFor(0.75));
  });

  it('uploading a new key for the same layer evicts that layer\'s old texture (cache stays bounded)', () => {
    let created = 0;
    const deleted: unknown[] = [];
    const gl = {
      TEXTURE_2D: 1, TEXTURE_MIN_FILTER: 2, TEXTURE_MAG_FILTER: 3, NEAREST: 4, TEXTURE_WRAP_S: 5,
      TEXTURE_WRAP_T: 6, CLAMP_TO_EDGE: 7, R32F: 8, RED: 9, FLOAT: 10,
      createTexture: () => ({ n: ++created }),
      deleteTexture: (t: unknown) => { deleted.push(t); },
      bindTexture: () => undefined, texParameteri: () => undefined, texImage2D: () => undefined,
    } as unknown as WebGL2RenderingContext;
    const p = new GpuPreviewPipeline() as unknown as {
      width: number; height: number; maskCache: Map<string, unknown>;
      uploadMask(gl: WebGL2RenderingContext, u: MaskUpload): unknown;
    };
    p.width = 4; p.height = 4;
    const up = (layerId: string, n: number): MaskUpload =>
      ({ kind: 'mask', data: new Float32Array(16), key: `${layerId}:${n}`, width: 4, height: 4, layerId });
    const other = p.uploadMask(gl, up('B', 0));
    let last: unknown = null;
    for (let i = 0; i < 100; i++) last = p.uploadMask(gl, up('A', i)); // one per drag frame
    expect(p.maskCache.size).toBe(2);           // A's latest + B
    expect(deleted).toHaveLength(99);           // every superseded A texture freed
    expect(deleted).not.toContain(other);
    expect(deleted).not.toContain(last);
    // Re-requesting the current key is a hit (no upload, no eviction).
    expect(p.uploadMask(gl, up('A', 99))).toBe(last);
    expect(created).toBe(101);
  });
});
