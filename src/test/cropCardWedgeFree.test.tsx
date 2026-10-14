/**
 * v1.40.0 Task 9a — the crop card's ratio and 90° handlers end wedge-free on a
 * straightened photo (they used to write the rect untouched, so a ratio change
 * or a quarter turn could push it into a fill wedge).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { CropModuleComponent } from '../components/Modules/CropModuleComponent';
import { CropModule } from '../modules/CropModule';
import { computeCropGeometry, isPixelRectWedgeFree } from '../modules/cropGeometry';

const W = 4000;
const H = 3000;

function straightened(rect: { x: number; y: number; width: number; height: number }) {
  const module = new CropModule();
  module.setOriginalDimensions(W, H);
  module.setParams({ enabled: true, angle: 4, aspectRatio: 'free', ...rect });
  const onParamsChange = jest.fn();
  render(<CropModuleComponent module={module} onParamsChange={onParamsChange} imageWidth={W} imageHeight={H} />);
  return { module, onParamsChange };
}

const wedgeFree = (m: CropModule) => isPixelRectWedgeFree(computeCropGeometry(m.getParams(), W, H));

describe('CropModuleComponent — wedge-free handlers', () => {
  test('ratio change on a straightened photo keeps the ratio and lands wedge-free', () => {
    // A tall narrow rect: the (normalized) 1:1 lock widens it to 0.9 x 0.9 — into the wedges.
    const { module } = straightened({ x: 0.05, y: 0.05, width: 0.3, height: 0.9 });
    fireEvent.click(screen.getByRole('button', { name: '1:1' }));
    const p = module.getParams();
    expect(wedgeFree(module)).toBe(true);
    // applyCropAspectRatio works in normalized units; the clamp keeps that ratio.
    expect(p.width / p.height).toBeCloseTo(1, 9);
  });

  test('90° turn under a straighten angle lands wedge-free', () => {
    // The 4° inscribed rect of the LANDSCAPE frame overshoots the portrait one.
    const auto = new CropModule().calculateAutoCropForRotation(W, H, 4);
    const { module } = straightened(auto);
    expect(wedgeFree(module)).toBe(true);
    fireEvent.click(screen.getByTitle('Rotate 90° clockwise'));
    expect(module.getParams().orientation).toBe(90);
    expect(wedgeFree(module)).toBe(true);
  });
});
