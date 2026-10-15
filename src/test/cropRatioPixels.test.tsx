/**
 * Crop & Transform ratio chips must produce the chosen ratio in PIXELS on the canvas.
 * The rect is stored normalized to the (expanded) canvas, so a ratio applied in
 * normalized units came out stretched by W/H (1:1 on a 4:3 photo gave a 4:3 crop).
 * A chip on a fresh photo (inner params.enabled false after reset) also never
 * enabled the crop, so it did nothing on the canvas.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { CropModuleComponent } from '../components/Modules/CropModuleComponent';
import { CropModule } from '../modules/CropModule';
import { computeCropGeometry, isPixelRectWedgeFree } from '../modules/cropGeometry';

const W = 4000;
const H = 3000;

function setup(params: Parameters<CropModule['setParams']>[0] = {}) {
  const module = new CropModule();
  module.setOriginalDimensions(W, H);
  module.resetParams();
  module.setParams(params);
  render(<CropModuleComponent module={module} onParamsChange={jest.fn()} imageWidth={W} imageHeight={H} />);
  return module;
}

const pixelRatio = (m: CropModule) => {
  const g = computeCropGeometry(m.getParams(), W, H);
  return g.outW / g.outH;
};

describe('crop ratio chips apply the ratio in pixels', () => {
  test.each([
    ['1:1', 1],
    ['16:9', 16 / 9],
    ['3:2', 3 / 2],
  ])('%s on a fresh 4:3 photo enables the crop at that pixel ratio', (label, ratio) => {
    const m = setup();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(m.getParams().enabled).toBe(true);
    expect(pixelRatio(m)).toBeCloseTo(ratio, 2);
  });

  test('1:1 from full frame is the largest centred square', () => {
    const m = setup();
    fireEvent.click(screen.getByRole('button', { name: '1:1' }));
    const p = m.getParams();
    expect(p.height).toBeCloseTo(1, 6);
    expect(p.width).toBeCloseTo(0.75, 6);
    expect(p.x).toBeCloseTo(0.125, 6);
  });

  test('ratio under a 90° orientation uses the portrait frame', () => {
    const m = setup({ enabled: true, orientation: 90 });
    fireEvent.click(screen.getByRole('button', { name: '16:9' }));
    expect(pixelRatio(m)).toBeCloseTo(16 / 9, 2);
  });

  test('ratio on a straightened photo is pixel-exact and wedge-free', () => {
    const m = setup({ enabled: true, angle: 4, ...new CropModule().calculateAutoCropForRotation(W, H, 4) });
    fireEvent.click(screen.getByRole('button', { name: '1:1' }));
    expect(pixelRatio(m)).toBeCloseTo(1, 2);
    expect(isPixelRectWedgeFree(computeCropGeometry(m.getParams(), W, H))).toBe(true);
  });

  test('editing the custom ratio re-applies it to the rect', () => {
    const m = setup();
    fireEvent.click(screen.getByRole('button', { name: /custom/i }));
    const [wInput, hInput] = screen.getAllByRole('spinbutton');
    fireEvent.change(wInput, { target: { value: '2' } });
    fireEvent.change(hInput, { target: { value: '1' } });
    expect(pixelRatio(m)).toBeCloseTo(2, 2);
  });
});
