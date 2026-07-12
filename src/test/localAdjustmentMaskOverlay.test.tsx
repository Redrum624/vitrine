/**
 * Bug: circle AND gradient masks jumped to the top-left corner the moment you adjusted them.
 * Cause: LocalAdjustmentMaskOverlay derived its on-screen box (metrics/toLocal) from the 2D
 * <canvas>, which is `display:none` in GPU render mode — so offsetWidth and getBoundingClientRect
 * were 0, collapsing a mask's normalized centre 0.5 to screen (0,0). Fix: read the box + pointer
 * origin from the overlay's OWN always-visible root element.
 *
 * These tests give the overlay root a real 800×600 layout (jsdom does no layout, so we mock it),
 * drag a mask by 100px, and assert the geometry follows the cursor — not the corner. Against the
 * old code (box = 0) the mapping produced NaN/0, which these assertions reject.
 */
import { render, fireEvent } from '@testing-library/react';
import { LocalAdjustmentMaskOverlay } from '../components/Canvas/LocalAdjustmentMaskOverlay';
import type { MaskGeometry } from '../modules/LocalAdjustmentsModule';

function sizeElement(el: HTMLElement, w: number, h: number) {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: w });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: h });
  jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0, toJSON: () => ({}),
  });
}

const baseGeom: MaskGeometry = {
  type: 'radial', centerX: 0.5, centerY: 0.5, radiusX: 0.2, radiusY: 0.2,
  startX: 0.5, startY: 0.3, endX: 0.5, endY: 0.7, feather: 0.5, invert: false, rotation: 0,
};

describe('LocalAdjustmentMaskOverlay — box comes from the overlay root, not the hidden 2D canvas', () => {
  afterEach(() => jest.restoreAllMocks());

  it('moving a radial (circle) mask follows the cursor instead of jumping to (0,0)', () => {
    const onGeometryChange = jest.fn();
    const { container } = render(
      <LocalAdjustmentMaskOverlay
        viewport={{ zoom: 1, panX: 0, panY: 0 }}
        contentWidth={800}
        contentHeight={600}
        layerType="radial_gradient"
        geometry={baseGeom}
        onGeometryChange={onGeometryChange}
      />,
    );
    const root = container.firstChild as HTMLElement;
    sizeElement(root, 800, 600);

    // Centre 0.5,0.5 → screen (400,300). Grab it and drag +100px right (= +0.125 normalized).
    fireEvent.mouseDown(root, { clientX: 400, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 500, clientY: 300 });
    fireEvent.mouseUp(window);

    expect(onGeometryChange).toHaveBeenCalledTimes(1);
    const g = onGeometryChange.mock.calls[0][0] as MaskGeometry;
    expect(Number.isFinite(g.centerX)).toBe(true);
    expect(g.centerX).toBeCloseTo(0.625, 3);
    expect(g.centerY).toBeCloseTo(0.5, 3);
  });

  it('moving a linear (gradient) mask follows the cursor too', () => {
    const onGeometryChange = jest.fn();
    const { container } = render(
      <LocalAdjustmentMaskOverlay
        viewport={{ zoom: 1, panX: 0, panY: 0 }}
        contentWidth={800}
        contentHeight={600}
        layerType="linear_gradient"
        geometry={{ ...baseGeom, type: 'linear' }}
        onGeometryChange={onGeometryChange}
      />,
    );
    const root = container.firstChild as HTMLElement;
    sizeElement(root, 800, 600);

    // Centre 0.5,0.5 → (400,300); the line passes through it, so a press there grabs "move".
    fireEvent.mouseDown(root, { clientX: 400, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 400, clientY: 390 }); // +90px down = +0.15 normalized
    fireEvent.mouseUp(window);

    expect(onGeometryChange).toHaveBeenCalledTimes(1);
    const g = onGeometryChange.mock.calls[0][0] as MaskGeometry;
    expect(Number.isFinite(g.centerY)).toBe(true);
    expect(g.centerX).toBeCloseTo(0.5, 3);
    expect(g.centerY).toBeCloseTo(0.65, 3);
  });
});
