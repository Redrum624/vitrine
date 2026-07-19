/**
 * InteractiveCropHandles — v1.29 crop rework. Contracts under test:
 *  - ALL 8 resize handles (4 corners + 4 edges) render even when an aspect
 *    ratio is locked (edges were previously hidden for locked ratios)
 *  - free-ratio edge drag moves only that edge
 *  - ratio-locked edge drags keep the ratio: e/w fix the opposite edge and the
 *    vertical center; n/s fix the opposite edge and the horizontal center
 *  - ratio-locked corner drag keeps the opposite corner fixed (existing)
 *  - drag math is anchored on the crop params at mousedown: each mousemove is
 *    anchor + total delta (no incremental drift), so a mid-drag change of the
 *    displayed content (cropped -> full-frame flip) cannot corrupt the rect
 *  - bounds: ratio-locked drags shrink toward their anchor rather than
 *    breaking the ratio at the image edge
 */
import { render, fireEvent, act } from '@testing-library/react';
import { InteractiveCropHandles } from '../components/Canvas/InteractiveCropHandles';
import { CropParams } from '../modules/CropModule';

const baseCrop: CropParams = {
  x: 0.25, y: 0.25, width: 0.5, height: 0.5,
  aspectRatio: 'free', customAspectWidth: 1, customAspectHeight: 1,
  angle: 0, flipHorizontal: false, flipVertical: false, enabled: true,
} as CropParams;

// 800x600 canvas, content fills it, zoom 1, no pan:
// crop rect in pixels = (200,150)-(600,450), i.e. 400x300 (ratio 4:3).
const geometry = {
  imageWidth: 4000,
  imageHeight: 3000,
  viewport: { zoom: 1, panX: 0, panY: 0 },
  canvasDisplayWidth: 800,
  canvasDisplayHeight: 600,
  contentWidth: 800,
  contentHeight: 600,
  showHandles: true,
};

function makeCanvasRef() {
  return {
    current: {
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
    } as unknown as HTMLCanvasElement,
  };
}

function renderHandles(over: Partial<React.ComponentProps<typeof InteractiveCropHandles>> = {}) {
  const onCropChange = jest.fn();
  const utils = render(
    <InteractiveCropHandles
      {...geometry}
      cropParams={baseCrop}
      onCropChange={onCropChange}
      aspectRatio={null}
      canvasRef={makeCanvasRef()}
      {...over}
    />,
  );
  return { onCropChange, ...utils };
}

const lastCall = (fn: jest.Mock) => fn.mock.calls[fn.mock.calls.length - 1][0];

function drag(container: HTMLElement, handle: string, from: { x: number; y: number }, to: { x: number; y: number }) {
  const el = container.querySelector(`[data-testid="crop-handle-${handle}"]`)!;
  fireEvent.mouseDown(el, { clientX: from.x, clientY: from.y });
  act(() => {
    fireEvent.mouseMove(document, { clientX: to.x, clientY: to.y });
  });
  act(() => {
    fireEvent.mouseUp(document);
  });
}

describe('InteractiveCropHandles', () => {
  test('renders all 8 resize handles with a LOCKED aspect ratio', () => {
    const { container } = renderHandles({ aspectRatio: 4 / 3 });
    for (const h of ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w']) {
      expect(container.querySelector(`[data-testid="crop-handle-${h}"]`)).not.toBeNull();
    }
  });

  test('free ratio: east drag moves only the right edge', () => {
    const { container, onCropChange } = renderHandles();
    drag(container, 'e', { x: 600, y: 300 }, { x: 680, y: 300 });
    const c = lastCall(onCropChange);
    expect(c.x).toBeCloseTo(0.25, 3);
    expect(c.y).toBeCloseTo(0.25, 3);
    expect(c.width).toBeCloseTo(0.6, 3);
    expect(c.height).toBeCloseTo(0.5, 3);
  });

  test('locked ratio: east drag scales height around the vertical center', () => {
    const { container, onCropChange } = renderHandles({ aspectRatio: 4 / 3 });
    drag(container, 'e', { x: 600, y: 300 }, { x: 680, y: 300 });
    const c = lastCall(onCropChange);
    // width 480px -> height 360px, vertical center stays at 300px
    expect(c.x).toBeCloseTo(0.25, 3);
    expect(c.width).toBeCloseTo(0.6, 3);
    expect(c.height).toBeCloseTo(0.6, 3);
    expect(c.y).toBeCloseTo(0.2, 3); // (300 - 180) / 600
  });

  test('locked ratio: north drag scales width around the horizontal center, bottom fixed', () => {
    const { container, onCropChange } = renderHandles({ aspectRatio: 4 / 3 });
    drag(container, 'n', { x: 400, y: 150 }, { x: 400, y: 90 });
    const c = lastCall(onCropChange);
    // height 360px -> width 480px; bottom stays 450, horizontal center stays 400
    expect(c.height).toBeCloseTo(0.6, 3);
    expect(c.width).toBeCloseTo(0.6, 3);
    expect(c.x).toBeCloseTo(0.2, 3);   // (400 - 240) / 800
    expect(c.y).toBeCloseTo(0.15, 3);  // (450 - 360) / 600
  });

  test('locked ratio: nw corner drag keeps the se corner fixed', () => {
    const { container, onCropChange } = renderHandles({ aspectRatio: 4 / 3 });
    drag(container, 'nw', { x: 200, y: 150 }, { x: 120, y: 150 });
    const c = lastCall(onCropChange);
    // right/bottom fixed at (600,450); width 480 -> height 360
    expect(c.x + c.width).toBeCloseTo(0.75, 3);
    expect(c.y + c.height).toBeCloseTo(0.75, 3);
    expect(c.width).toBeCloseTo(0.6, 3);
    expect(c.height).toBeCloseTo(0.6, 3);
  });

  test('drag is anchored: two moves produce anchor + total delta, not drift', () => {
    const { container, onCropChange } = renderHandles();
    const el = container.querySelector('[data-testid="crop-handle-e"]')!;
    fireEvent.mouseDown(el, { clientX: 600, clientY: 300 });
    act(() => { fireEvent.mouseMove(document, { clientX: 640, clientY: 300 }); });
    act(() => { fireEvent.mouseMove(document, { clientX: 680, clientY: 300 }); });
    act(() => { fireEvent.mouseUp(document); });
    const c = lastCall(onCropChange);
    expect(c.width).toBeCloseTo(0.6, 3); // 400 + 80 = 480px, from the ANCHOR rect
  });

  test('locked ratio: east drag past the image edge shrinks to fit without breaking ratio', () => {
    const { container, onCropChange } = renderHandles({ aspectRatio: 4 / 3 });
    drag(container, 'e', { x: 600, y: 300 }, { x: 1400, y: 300 });
    const c = lastCall(onCropChange);
    const ratio = (c.width * 800) / (c.height * 600);
    expect(ratio).toBeCloseTo(4 / 3, 2);
    expect(c.x + c.width).toBeLessThanOrEqual(1.0001);
    expect(c.y).toBeGreaterThanOrEqual(-0.0001);
    expect(c.y + c.height).toBeLessThanOrEqual(1.0001);
  });

  test('center drag moves the rect and clamps inside the image', () => {
    const { container, onCropChange } = renderHandles();
    drag(container, 'center', { x: 400, y: 300 }, { x: 1000, y: 300 });
    const c = lastCall(onCropChange);
    expect(c.width).toBeCloseTo(0.5, 3);
    expect(c.height).toBeCloseTo(0.5, 3);
    expect(c.x + c.width).toBeLessThanOrEqual(1.0001); // pushed to the right edge, not past
  });

  test('re-crop: drag anchors on anchorCropParams, not the displayed full-frame rect', () => {
    // Applied-crop state: displayed rect is full-frame (handles on the cropped
    // image edges) while the REAL crop is (0.25,0.25,0.5,0.5). Grabbing 'e' and
    // moving +80px must resize from the REAL rect — width 400px -> 480px.
    const { container, onCropChange } = renderHandles({
      cropParams: { ...baseCrop, x: 0, y: 0, width: 1, height: 1 },
      anchorCropParams: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    });
    drag(container, 'e', { x: 800, y: 300 }, { x: 880, y: 300 });
    const c = lastCall(onCropChange);
    expect(c.x).toBeCloseTo(0.25, 3);
    expect(c.y).toBeCloseTo(0.25, 3);
    expect(c.width).toBeCloseTo(0.6, 3);
    expect(c.height).toBeCloseTo(0.5, 3);
  });

  test('mid-drag geometry flip (cropped→full frame) does not corrupt the delta', () => {
    // Applied-crop state: displayed content is the CROPPED fit (narrow), rect
    // is full-frame, real crop in anchorCropParams. Grabbing a handle flips
    // the display to the full frame mid-hold — the canvas geometry changes
    // under the drag. The delta must be client-anchored: a +80px move after
    // the flip resizes from the REAL rect by exactly 80px in new geometry.
    const onCropChange = jest.fn();
    const props = {
      ...geometry,
      onCropChange,
      aspectRatio: null,
      canvasRef: makeCanvasRef(),
      anchorCropParams: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    };
    const { container, rerender } = render(
      <InteractiveCropHandles
        {...props}
        cropParams={{ ...baseCrop, x: 0, y: 0, width: 1, height: 1 }}
        contentWidth={400}
        contentHeight={600}
      />,
    );
    const el = container.querySelector('[data-testid="crop-handle-e"]')!;
    fireEvent.mouseDown(el, { clientX: 610, clientY: 300 });

    // The suspension reprocess lands: full-frame content, real rect displayed.
    rerender(
      <InteractiveCropHandles
        {...props}
        cropParams={{ ...baseCrop, x: 0.25, y: 0.25, width: 0.5, height: 0.5 }}
        contentWidth={800}
        contentHeight={600}
      />,
    );
    act(() => { fireEvent.mouseMove(document, { clientX: 690, clientY: 300 }); });
    act(() => { fireEvent.mouseUp(document); });

    const c = lastCall(onCropChange);
    // Anchor right edge at 600px (full-frame geometry) + 80px = 680 → width 480px.
    expect(c.x).toBeCloseTo(0.25, 3);
    expect(c.width).toBeCloseTo(0.6, 3);
    expect(c.height).toBeCloseTo(0.5, 3);
  });

  test('onDragStart/onDragEnd fire around the drag', () => {
    const onDragStart = jest.fn();
    const onDragEnd = jest.fn();
    const { container } = renderHandles({ onDragStart, onDragEnd });
    drag(container, 'se', { x: 600, y: 450 }, { x: 620, y: 470 });
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });
});
