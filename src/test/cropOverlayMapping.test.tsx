/**
 * v1.40.0 Task 9b — overlay == result. The crop overlay and the handles map
 * the crop rect (normalised to the expanded rotated canvas) through the frame
 * ACTUALLY displayed (processedImageData.frameRect, the effective clamped rect
 * the pass rendered):  screen = box + (r - d.xy) / d.wh * box.
 *
 * Contracts:
 *  - the owner-measured case: displayed frame {.0881,.0194,.9111,.9031}, rect
 *    {.08855,.01982,.90425,.90446} draws 1170/1179 * boxW wide (+-1 px) — for
 *    both the overlay border and the handles' centre (move) area
 *  - CropPipelineModule.process reports the EFFECTIVE rect it rendered on the
 *    context (cropFrameRect): the render backstop's clamp, quantised to pixels
 *  - straighten grid: on an already-inscribed frame it spans the whole box (no
 *    double shrink); with a crop applied it is clipped to the displayed frame
 *  - fix round 1 (owner decision): a drag-SUSPENSION pass (context.cropSuspended
 *    + full-frame rect) renders the WHOLE expanded canvas, frameRect = full; every
 *    other pass keeps the wedge-free backstop, including a flagged pass whose rect
 *    is a real crop; the flag never reaches saved params; the handles are bounded
 *    by the full canvas + clampRect, so a wedge-free 16:9 crop pushed off-centre on
 *    a rotated 4:3 photo survives a drag unchanged
 */
import { render, fireEvent, act } from '@testing-library/react';
import { CropTransformOverlay } from '../components/Canvas/CropTransformOverlay';
import { InteractiveCropHandles } from '../components/Canvas/InteractiveCropHandles';
import { mapRectToBox } from '../components/Canvas/cropFrameMapping';
import { CropPipelineModule } from '../modules/CropPipelineModule';
import { CropParams } from '../modules/CropModule';
import {
  autoCropRectForRotation, clampRectWedgeFree, computeCropGeometry, isPixelRectWedgeFree,
  type CropClampAnchor, type NormalizedCropRect,
} from '../modules/cropGeometry';
import { FULL_FRAME } from '../components/Canvas/cropFrameMapping';
import type { ProcessingContext } from '../services/ImageProcessingPipeline';

const FRAME = { x: 0.0881, y: 0.0194, width: 0.9111, height: 0.9031 };
const RECT = { x: 0.08855, y: 0.01982, width: 0.90425, height: 0.90446 };
const BOX_W = 1179;
const BOX_H = 800;

const baseCrop = {
  x: 0, y: 0, width: 1, height: 1,
  aspectRatio: 'free', customAspectWidth: 1, customAspectHeight: 1,
  angle: 0, flipHorizontal: false, flipVertical: false, enabled: true,
} as CropParams;

// Recording 2D-context stub (jsdom has no canvas backend).
type Call = { fn: string; args: number[] };
function installCanvasRecorder(): Call[] {
  const calls: Call[] = [];
  const rec = (fn: string) => (...args: number[]) => { calls.push({ fn, args }); };
  const ctx = {
    scale: rec('scale'), clearRect: rec('clearRect'), fillRect: rec('fillRect'),
    strokeRect: rec('strokeRect'), beginPath: rec('beginPath'), moveTo: rec('moveTo'),
    lineTo: rec('lineTo'), stroke: rec('stroke'), arc: rec('arc'), fillText: rec('fillText'),
    setLineDash: () => {}, save: () => {}, restore: () => {},
    measureText: () => ({ width: 30 }),
  };
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
  return calls;
}

function renderOverlay(props: Partial<React.ComponentProps<typeof CropTransformOverlay>>) {
  return render(
    <CropTransformOverlay
      imageWidth={1000}
      imageHeight={700}
      originalWidth={5200}
      originalHeight={3904}
      cropParams={baseCrop}
      viewport={{ zoom: 1, panX: 0, panY: 0 }}
      canvasDisplayWidth={BOX_W}
      canvasDisplayHeight={BOX_H}
      contentWidth={BOX_W}
      contentHeight={BOX_H}
      showOverlay
      {...props}
    />,
  );
}

function renderHandles(props: Partial<React.ComponentProps<typeof InteractiveCropHandles>>) {
  const onCropChange = jest.fn();
  const utils = render(
    <InteractiveCropHandles
      imageWidth={5200}
      imageHeight={3904}
      cropParams={baseCrop}
      onCropChange={onCropChange}
      viewport={{ zoom: 1, panX: 0, panY: 0 }}
      canvasDisplayWidth={BOX_W}
      canvasDisplayHeight={BOX_H}
      contentWidth={BOX_W}
      contentHeight={BOX_H}
      showHandles
      aspectRatio={null}
      canvasRef={{ current: document.createElement('canvas') }}
      {...props}
    />,
  );
  return { onCropChange, ...utils };
}

afterEach(() => jest.restoreAllMocks());

describe('mapRectToBox', () => {
  test('owner case: rect through the displayed frame is 1170/1179 of the box wide', () => {
    const r = mapRectToBox(RECT, FRAME, { left: 0, top: 0, width: BOX_W, height: BOX_H });
    expect(Math.abs(r.width - 1170)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.left - ((RECT.x - FRAME.x) / FRAME.width) * BOX_W)).toBeLessThan(1e-9);
  });
  test('rect == frame fills the box exactly', () => {
    const r = mapRectToBox(FRAME, FRAME, { left: 10, top: 20, width: 300, height: 200 });
    expect(r.left).toBeCloseTo(10, 9);
    expect(r.top).toBeCloseTo(20, 9);
    expect(r.width).toBeCloseTo(300, 9);
    expect(r.height).toBeCloseTo(200, 9);
  });
});

describe('CropTransformOverlay maps through the displayed frame', () => {
  test('owner case: the border draws 1170/1179 * boxW wide (+-1 px)', () => {
    const calls = installCanvasRecorder();
    renderOverlay({ cropParams: { ...baseCrop, ...RECT }, displayFrame: FRAME });
    const border = calls.filter((c) => c.fn === 'strokeRect').pop()!;
    expect(border).toBeDefined();
    expect(Math.abs(border.args[2] - (1170 / 1179) * BOX_W)).toBeLessThanOrEqual(1);
  });

  test('straighten grid on an already-inscribed frame covers the whole box (no double shrink)', () => {
    const calls = installCanvasRecorder();
    const angle = 5;
    const inscribed = autoCropRectForRotation(5200, 3904, angle);
    renderOverlay({
      cropParams: { ...baseCrop, angle, ...inscribed },
      displayFrame: inscribed,
      showOverlay: false,
      showRotationGrid: true,
    });
    // Vertical thirds lines: x = left + i*w/3 → the grid spans the full box.
    const xs = calls.filter((c) => c.fn === 'moveTo').map((c) => c.args[0]);
    expect(Math.abs(xs[0] - BOX_W / 3)).toBeLessThanOrEqual(1);
    expect(Math.abs(xs[1] - (2 * BOX_W) / 3)).toBeLessThanOrEqual(1);
  });
});

describe('straighten grid with a crop applied (fix round 1)', () => {
  test('grid is clipped to the displayed (cropped) frame — never drawn off the image', () => {
    const calls = installCanvasRecorder();
    const angle = 5;
    const inscribed = autoCropRectForRotation(5200, 3904, angle);
    // Applied crop strictly inside the inscribed rect.
    const crop = { x: inscribed.x + 0.05, y: inscribed.y + 0.05, width: inscribed.width / 2, height: inscribed.height / 2 };
    renderOverlay({
      cropParams: { ...baseCrop, angle, ...crop },
      displayFrame: crop,
      showOverlay: false,
      showRotationGrid: true,
    });
    const xs = calls.filter((c) => c.fn === 'moveTo').map((c) => c.args[0]);
    expect(Math.abs(xs[0] - BOX_W / 3)).toBeLessThanOrEqual(1);
    expect(Math.abs(xs[1] - (2 * BOX_W) / 3)).toBeLessThanOrEqual(1);
  });
});

describe('InteractiveCropHandles maps through the displayed frame', () => {
  test('owner case: the move area is 1170/1179 * boxW wide (+-1 px)', () => {
    const { container } = renderHandles({ cropParams: { ...baseCrop, ...RECT }, displayFrame: FRAME });
    const centre = container.querySelector('[data-testid="crop-handle-center"]') as HTMLElement;
    expect(Math.abs(parseFloat(centre.style.width) - (1170 / 1179) * BOX_W)).toBeLessThanOrEqual(1);
    expect(Math.abs(parseFloat(centre.style.left) - ((RECT.x - FRAME.x) / FRAME.width) * BOX_W)).toBeLessThanOrEqual(1);
  });

  test('drag deltas convert through the frame scale and stay bounded to boundsRect', () => {
    const angle = 5;
    const inscribed = autoCropRectForRotation(5200, 3904, angle);
    const { container, onCropChange } = renderHandles({
      cropParams: { ...baseCrop, angle, ...inscribed },
      displayFrame: inscribed,
      boundsRect: inscribed,
    });
    const e = container.querySelector('[data-testid="crop-handle-e"]')!;
    // Pull the east edge 100 px LEFT: width shrinks by 100/BOX_W of the frame width.
    fireEvent.mouseDown(e, { clientX: 1000, clientY: 400 });
    act(() => { fireEvent.mouseMove(document, { clientX: 900, clientY: 400 }); });
    const shrunk = onCropChange.mock.calls[onCropChange.mock.calls.length - 1][0];
    expect(shrunk.width).toBeCloseTo(inscribed.width - (100 / BOX_W) * inscribed.width, 6);
    // Pull it far RIGHT: stops at the suspension frame's edge, not the expanded canvas.
    act(() => { fireEvent.mouseMove(document, { clientX: 3000, clientY: 400 }); });
    const grown = onCropChange.mock.calls[onCropChange.mock.calls.length - 1][0];
    expect(grown.x + grown.width).toBeCloseTo(inscribed.x + inscribed.width, 6);
    act(() => { fireEvent.mouseUp(document); });
  });
});

describe('suspended drag: full-canvas bounds + wedge-free clamp (owner decision)', () => {
  test('a wedge-free 16:9 crop pushed off-centre on a rotated 4:3 photo survives a drag unchanged', () => {
    const W = 4000; const H = 3000; const angle = 3;
    const params = { ...baseCrop, angle, aspectRatio: 'free' } as CropParams;
    const inscribed = autoCropRectForRotation(W, H, angle);
    const geom0 = computeCropGeometry({ ...params }, W, H);
    // A wide 16:9 strip, off-centre (upper part), clamped wedge-free: wider than the
    // inscribed 4:3 rect — i.e. outside the old inscribed drag bounds.
    // 0.95*W wide (inscribed 4:3 is ~0.936*W at 3 deg), 16:9 in pixels, shifted up 0.04*W.
    const wN = (0.95 * W) / geom0.expW;
    const hN = (wN * geom0.expW * 9) / 16 / geom0.expH;
    const strip: NormalizedCropRect = { x: 0.5 - wN / 2, y: 0.5 - hN / 2 - (0.04 * W) / geom0.expH, width: wN, height: hN };
    expect(isPixelRectWedgeFree(computeCropGeometry({ ...params, ...strip }, W, H))).toBe(true);
    expect(strip.x).toBeLessThan(inscribed.x);

    const clampRect = (r: NormalizedCropRect, anchor: CropClampAnchor) => clampRectWedgeFree(r, W, H, params, anchor);
    const { container, onCropChange } = renderHandles({
      cropParams: { ...params, ...strip },
      displayFrame: FULL_FRAME,
      boundsRect: FULL_FRAME,
      clampRect,
    });
    const centre = container.querySelector('[data-testid="crop-handle-center"]')!;
    fireEvent.mouseDown(centre, { clientX: 500, clientY: 300 });
    act(() => { fireEvent.mouseMove(document, { clientX: 500, clientY: 300 }); });
    act(() => { fireEvent.mouseUp(document); });
    const moved = onCropChange.mock.calls[onCropChange.mock.calls.length - 1][0];
    expect(moved.x).toBeCloseTo(strip.x, 9);
    expect(moved.y).toBeCloseTo(strip.y, 9);
    expect(moved.width).toBeCloseTo(strip.width, 9);
    expect(moved.height).toBeCloseTo(strip.height, 9);
  });

  test('an e-drag past the wedge stops wedge-free, not at an inscribed bound', () => {
    const W = 4000; const H = 3000; const angle = 3;
    const params = { ...baseCrop, angle, aspectRatio: 'free' } as CropParams;
    const inscribed = autoCropRectForRotation(W, H, angle);
    const clampRect = (r: NormalizedCropRect, anchor: CropClampAnchor) => clampRectWedgeFree(r, W, H, params, anchor);
    const start = { x: 0.4, y: 0.45, width: 0.2, height: 0.1 };
    const { container, onCropChange } = renderHandles({
      cropParams: { ...params, ...start }, displayFrame: FULL_FRAME, boundsRect: FULL_FRAME, clampRect,
    });
    const e = container.querySelector('[data-testid="crop-handle-e"]')!;
    fireEvent.mouseDown(e, { clientX: 700, clientY: 400 });
    act(() => { fireEvent.mouseMove(document, { clientX: 5000, clientY: 400 }); });
    act(() => { fireEvent.mouseUp(document); });
    const r = onCropChange.mock.calls[onCropChange.mock.calls.length - 1][0];
    expect(isPixelRectWedgeFree(computeCropGeometry({ ...params, ...r }, W, H))).toBe(true);
    // A thin middle strip reaches beyond the inscribed 4:3 rect's right edge.
    expect(r.x + r.width).toBeGreaterThan(inscribed.x + inscribed.width);
  });
});

describe('CropPipelineModule reports the effective rendered frame', () => {
  function run(params: Partial<CropParams>, w: number, h: number): ProcessingContext {
    const m = new CropPipelineModule();
    m.setParams({ ...params, enabled: true });
    const ctx: ProcessingContext = { width: w, height: h, channels: 4 };
    m.process(new Float32Array(w * h * 4).fill(0.5), ctx);
    return ctx;
  }

  test('a plain crop reports its pixel-quantised rect', () => {
    const ctx = run({ x: 0.1, y: 0.2, width: 0.5, height: 0.6, angle: 0 }, 200, 100);
    expect(ctx.cropFrameRect).toEqual({ x: 20 / 200, y: 20 / 100, width: 100 / 200, height: 60 / 100 });
    expect(ctx.width).toBe(100);
    expect(ctx.height).toBe(60);
  });

  test('NON-suspended full frame with an angle is clamped to the inscribed frame (backstop on)', () => {
    const angle = 5;
    const ctx = run({ x: 0, y: 0, width: 1, height: 1, angle }, 300, 200);
    const f = ctx.cropFrameRect!;
    expect(f.width).toBeLessThan(0.95);
    const geom = computeCropGeometry({ ...baseCrop, angle, ...f }, 300, 200);
    expect(geom.outW).toBe(ctx.width);
    expect(geom.outH).toBe(ctx.height);
    expect(f.width * geom.expW).toBeCloseTo(ctx.width, 6);
  });

  test('drag-SUSPENSION pass renders the whole expanded canvas (corners visible), frameRect = full', () => {
    const angle = 5;
    const m = new CropPipelineModule();
    m.setParams({ x: 0, y: 0, width: 1, height: 1, angle, enabled: true });
    const ctx: ProcessingContext = { width: 300, height: 200, channels: 4, cropSuspended: true };
    const out = m.process(new Float32Array(300 * 200 * 4).fill(0.5), ctx);
    const geom = computeCropGeometry({ ...baseCrop, angle }, 300, 200);
    expect(ctx.cropFrameRect).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(ctx.width).toBe(geom.expW);
    expect(ctx.height).toBe(geom.expH);
    expect(out.length).toBe(geom.expW * geom.expH * 4);
    expect(out[0]).toBe(0); // top-left corner = fill (the empty canvas corner)
    // The flag is pass-transient: it never lands in the module params (saved edits/history).
    expect(JSON.stringify(m.getParams())).not.toMatch(/suspend/i);
  });

  test('flag accidentally left set with a REAL crop rect still clamps (same as unflagged)', () => {
    const angle = 5;
    const rect = { x: 0, y: 0, width: 0.9, height: 0.9 }; // reaches into a wedge
    const flagged = new CropPipelineModule();
    flagged.setParams({ ...rect, angle, enabled: true });
    const fctx: ProcessingContext = { width: 300, height: 200, channels: 4, cropSuspended: true };
    flagged.process(new Float32Array(300 * 200 * 4).fill(0.5), fctx);
    const plain = run({ ...rect, angle }, 300, 200);
    expect(fctx.cropFrameRect).toEqual(plain.cropFrameRect);
    expect(fctx.width).toBe(plain.width);
    const geom = computeCropGeometry({ ...baseCrop, angle, ...fctx.cropFrameRect! }, 300, 200);
    expect(isPixelRectWedgeFree(geom)).toBe(true);
  });

  test('export / normal passes never carry the flag: only the interactive preview plumbing references it', () => {
    // Source pin: the transient flag is read from the store ONLY by AdjustmentPanel (the
    // interactive preview pass) and set ONLY by Canvas (handle drag). Export, bake, history
    // and persistence never mention it, so a stuck store flag cannot un-clamp their output.
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const root = path.join(__dirname, '..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'test' && e.name !== '__tests__') walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) continue;
        if (/cropDragSuspended/i.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(root, p).replace(/\\/g, '/'));
      }
    };
    walk(root);
    expect(hits.sort()).toEqual(['components/Layout/Canvas.tsx', 'components/Panels/AdjustmentPanel.tsx', 'stores/appStore.ts']);
  });

  test('orientation 90 reports the rect in the oriented (swapped) frame', () => {
    const ctx = run({ x: 0.25, y: 0, width: 0.5, height: 1, angle: 0, orientation: 90 } as Partial<CropParams>, 200, 100);
    // oriented frame 100x200: x .25*100=25, w 50.
    expect(ctx.cropFrameRect).toEqual({ x: 0.25, y: 0, width: 0.5, height: 1 });
    expect(ctx.width).toBe(50);
    expect(ctx.height).toBe(200);
  });
});
