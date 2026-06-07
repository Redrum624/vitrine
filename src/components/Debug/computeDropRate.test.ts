import { computeDropRate } from './computeDropRate';

describe('computeDropRate', () => {
  it('returns 0% when frames match the 60fps target over 1000ms', () => {
    expect(computeDropRate(60, 1000)).toBe(0);
  });

  it('returns 50% when half the target frames were rendered', () => {
    expect(computeDropRate(30, 1000)).toBe(50);
  });

  it('returns 100% when no frames were rendered', () => {
    expect(computeDropRate(0, 1000)).toBe(100);
  });

  it('clamps to 0% when more frames than target were rendered', () => {
    expect(computeDropRate(90, 1000)).toBe(0);
  });

  it('returns 0% when the window has zero duration (no target)', () => {
    expect(computeDropRate(0, 0)).toBe(0);
  });

  it('honors a custom target fps', () => {
    // 30fps over 1000ms against a 30fps target -> no drops
    expect(computeDropRate(30, 1000, 30)).toBe(0);
    // 15fps over 1000ms against a 30fps target -> 50% drop
    expect(computeDropRate(15, 1000, 30)).toBe(50);
  });
});
