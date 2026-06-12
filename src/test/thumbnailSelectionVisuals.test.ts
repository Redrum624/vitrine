/**
 * Unit tests for the filmstrip thumbnail selection frame (blue intensity hierarchy).
 *
 * One visual language: the current canvas image gets a strong blue border + subtle
 * glow; other multi-selected images get a dimmed blue border (no glow); unselected
 * thumbnails get a transparent border of the SAME width so nothing shifts size.
 * The old white border / white top-right dot / blue check badge are gone.
 */
import { getThumbFrameStyle } from '../components/Panels/ThumbnailPanel';

describe('getThumbFrameStyle', () => {
  it('current canvas image → strong blue border + subtle glow', () => {
    const s = getThumbFrameStyle(true, false);
    expect(s.borderWidth).toBe('2px');
    expect(s.borderColor).toBe('#3b82f6');
    expect(s.boxShadow).toBe('0 0 0 1px rgba(59, 130, 246, 0.35)');
  });

  it('in multi-select but not current → dimmed blue border, no glow', () => {
    const s = getThumbFrameStyle(false, true);
    expect(s.borderWidth).toBe('2px');
    expect(s.borderColor).toBe('rgba(59, 130, 246, 0.45)');
    expect(s.boxShadow).toBe('none');
  });

  it('current AND in multi-select → the strong (current) treatment wins', () => {
    expect(getThumbFrameStyle(true, true)).toEqual(getThumbFrameStyle(true, false));
  });

  it('neither → transparent border of the same width (no size shift), no glow', () => {
    const s = getThumbFrameStyle(false, false);
    expect(s.borderWidth).toBe('2px');
    expect(s.borderColor).toBe('transparent');
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
