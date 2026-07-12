/**
 * Unit tests for the filmstrip dock thumbnail selection frame (blue intensity
 * hierarchy, ported to the Glass · Sectioned dock in Task 6).
 *
 * One visual language: the current canvas image gets a strong 2px accent border
 * + an 18px accent glow; other multi-selected images get a dimmed blue border
 * (no glow); unselected thumbnails get a faint rgba(255,255,255,.09) border of
 * the SAME width so nothing shifts size. The old white border / white top-right
 * dot / blue check badge are gone.
 */
import { getThumbFrameStyle } from '../components/Panels/ThumbnailPanel';

describe('getThumbFrameStyle', () => {
  it('current canvas image → strong accent border + 18px glow', () => {
    const s = getThumbFrameStyle(true, false);
    expect(s.borderWidth).toBe('2px');
    expect(s.borderColor).toBe('#3b82f6');
    expect(s.boxShadow).toBe('0 0 18px rgba(59, 130, 246, 0.45)');
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
