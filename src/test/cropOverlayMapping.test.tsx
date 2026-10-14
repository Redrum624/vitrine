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
 *  - drag-suspended full frame with an angle: the render shows the inscribed
 *    (wedge-free) frame; a full-frame-mapped inscribed rect fills the box, the
 *    straighten grid no longer shrinks twice, and the handles are bounded to
 *    the suspension frame
 */
import { render, fireEvent, act } from '@testing-library/react';
import { CropTransformOverlay } from '../components/Canvas/CropTransformOverlay';
import { InteractiveCropHandles } from '../components/Canvas/InteractiveCropHandles';
import { mapRectToBox } from '../components/Canvas/cropFrameMapping';
import { CropPipelineModule } from '../modules/CropPipelineModule';
import { CropParams } from '../modules/CropModule';
import { autoCropRectForRotation, computeCropGeometry } from '../modules/cropGeometry';
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

  test('suspended full frame with an angle reports the inscribed (clamped) frame, matching output dims', () => {
    const angle = 5;
    const ctx = run({ x: 0, y: 0, width: 1, height: 1, angle }, 300, 200);
    const f = ctx.cropFrameRect!;
    expect(f.width).toBeLessThan(0.95);
    const geom = computeCropGeometry({ ...baseCrop, angle, ...f }, 300, 200);
    expect(geom.outW).toBe(ctx.width);
    expect(geom.outH).toBe(ctx.height);
    expect(f.width * geom.expW).toBeCloseTo(ctx.width, 6);
  });

  test('orientation 90 reports the rect in the oriented (swapped) frame', () => {
    const ctx = run({ x: 0.25, y: 0, width: 0.5, height: 1, angle: 0, orientation: 90 } as Partial<CropParams>, 200, 100);
    // oriented frame 100x200: x .25*100=25, w 50.
    expect(ctx.cropFrameRect).toEqual({ x: 0.25, y: 0, width: 0.5, height: 1 });
    expect(ctx.width).toBe(50);
    expect(ctx.height).toBe(200);
  });
});
