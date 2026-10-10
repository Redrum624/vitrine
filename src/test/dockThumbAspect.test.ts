/**
 * Aspect-adaptive filmstrip thumbnail widths — portraits and landscapes both
 * display whole (fixed tiles + object-cover cropped portraits to a band and the
 * current landscape to a sliver). The docked filmstrip uses 64px-tall tiles.
 */
import { dockThumbWidth } from '../components/Panels/ThumbnailPanel';

describe('dockThumbWidth', () => {
  it('landscape 3:2 gets a wide tile (64 * 1.5 = 96)', () => {
    expect(dockThumbWidth(3 / 2)).toBe(96);
  });

  it('portrait 3:4 gets a narrow tile (64 * 0.75 = 48)', () => {
    expect(dockThumbWidth(3 / 4)).toBe(48);
  });

  it('square gets 64', () => {
    expect(dockThumbWidth(1)).toBe(64);
  });

  it('clamps extreme panoramas to the max width', () => {
    expect(dockThumbWidth(4)).toBe(96);
  });

  it('clamps extreme verticals to the min width', () => {
    expect(dockThumbWidth(0.3)).toBe(40);
  });

  it('falls back to the neutral width before the thumb reports its aspect', () => {
    expect(dockThumbWidth(undefined)).toBe(86);
    expect(dockThumbWidth(0)).toBe(86);
    expect(dockThumbWidth(NaN)).toBe(86);
  });
});
