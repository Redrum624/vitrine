/**
 * Unit tests for the filmstrip thumbnail selection frame (Safelight).
 *
 * One neutral visual language: the current canvas image gets a solid 2px
 * near-white ring; other multi-selected images a half-strength ring; unselected
 * thumbnails a faint rgba(255,255,255,.09) border of the SAME width so nothing
 * shifts size. No glows anywhere — the photos carry the colour.
 */
import { getThumbFrameStyle } from '../components/Panels/ThumbnailPanel';

describe('getThumbFrameStyle', () => {
  it('current canvas image → solid near-white ring, no glow', () => {
    const s = getThumbFrameStyle(true, false);
    expect(s.borderWidth).toBe('2px');
    expect(s.borderColor).toBe('#ececef');
    expect(s.boxShadow).toBe('none');
  });

  it('in multi-select but not current → half-strength ring, no glow', () => {
    const s = getThumbFrameStyle(false, true);
    expect(s.borderWidth).toBe('2px');
    expect(s.borderColor).toBe('rgba(236, 236, 239, 0.45)');
    expect(s.boxShadow).toBe('none');
  });

  it('current AND in multi-select → the strong (current) treatment wins', () => {
    expect(getThumbFrameStyle(true, true)).toEqual(getThumbFrameStyle(true, false));
  });

  it('neither → faint rgba(255,255,255,.09) border of the same width (no size shift), no glow', () => {
    const s = getThumbFrameStyle(false, false);
    expect(s.borderWidth).toBe('2px');
    expect(s.borderColor).toBe('rgba(255, 255, 255, 0.09)');
    expect(s.boxShadow).toBe('none');
  });

  it('all states reserve the same border width', () => {
    const widths = [
      getThumbFrameStyle(true, false).borderWidth,
      getThumbFrameStyle(false, true).borderWidth,
      getThumbFrameStyle(true, true).borderWidth,
      getThumbFrameStyle(false, false).borderWidth,
    ];
    expect(new Set(widths).size).toBe(1);
  });
});
