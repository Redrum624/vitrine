/**
 * Aspect-adaptive dock thumbnail widths — portraits and landscapes both display
 * whole (the fixed 66/114×88 tiles + object-cover cropped portraits to a band
 * and the current landscape to a sliver).
 */
import { dockThumbWidth } from '../components/Panels/ThumbnailPanel';

describe('dockThumbWidth', () => {
  it('landscape 3:2 gets a wide tile (88 * 1.5 = 132)', () => {
    expect(dockThumbWidth(3 / 2)).toBe(132);
  });

  it('portrait 3:4 gets a narrow tile (88 * 0.75 = 66)', () => {
    expect(dockThumbWidth(3 / 4)).toBe(66);
  });

  it('square gets 88', () => {
    expect(dockThumbWidth(1)).toBe(88);
  });

  it('clamps extreme panoramas to the max width', () => {
    expect(dockThumbWidth(4)).toBe(132);
  });

  it('clamps extreme verticals to the min width', () => {
    expect(dockThumbWidth(0.3)).toBe(56);
  });

  it('falls back to the neutral width before the thumb reports its aspect', () => {
    expect(dockThumbWidth(undefined)).toBe(114);
    expect(dockThumbWidth(0)).toBe(114);
    expect(dockThumbWidth(NaN)).toBe(114);
  });
});
