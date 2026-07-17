/**
 * Regression: gallery number-key rating was silently dead because the
 * KeyboardShortcutsService swallowed matched digits at CAPTURE phase
 * (preventDefault + stopPropagation) even when the rating action would no-op
 * for viewMode === 'gallery' — so GalleryView's bubble-phase 1-5/0 listener
 * never received the event (live-verified in the packaged app).
 *
 * The fix: KeyboardShortcut.when — evaluated BEFORE the swallow. When false,
 * the event must pass through untouched; when true/absent, classic behavior.
 */
import { KeyboardShortcutsService, createRatingShortcuts } from '../services/KeyboardShortcutsService';

function pressKey(key: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  jest.spyOn(e, 'preventDefault');
  jest.spyOn(e, 'stopPropagation');
  document.dispatchEvent(e);
  return e;
}

describe('rating shortcuts yield to Gallery via the when gate', () => {
  let service: KeyboardShortcutsService;
  let rated: number[];
  let inGallery: boolean;

  beforeEach(() => {
    service = new KeyboardShortcutsService();
    rated = [];
    inGallery = false;
    createRatingShortcuts((r) => rated.push(r), () => !inGallery)
      .forEach((s) => service.register(s));
  });

  afterEach(() => {
    service.destroy();
  });

  it('fires and swallows the digit outside the gallery', () => {
    const e = pressKey('3');
    expect(rated).toEqual([3]);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
  });

  it('neither fires NOR swallows when the gate returns false (gallery open)', () => {
    inGallery = true;
    const e = pressKey('3');
    expect(rated).toEqual([]);
    // The event must remain untouched so bubble-phase listeners (GalleryView's
    // selection rating) still receive it.
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(e.stopPropagation).not.toHaveBeenCalled();
  });

  it('a bubble-phase listener still receives the gated keydown', () => {
    inGallery = true;
    const seen: string[] = [];
    const bubbleListener = (e: KeyboardEvent) => seen.push(e.key);
    document.addEventListener('keydown', bubbleListener);
    try {
      pressKey('5');
      expect(seen).toEqual(['5']);
    } finally {
      document.removeEventListener('keydown', bubbleListener);
    }
  });

  it('shortcuts without a when gate keep classic swallow behavior', () => {
    const plain = new KeyboardShortcutsService();
    const fired: string[] = [];
    plain.register({
      id: 'test-x', key: 'x', description: 't', category: 'edit',
      action: () => fired.push('x'),
    });
    try {
      const e = pressKey('x');
      expect(fired).toEqual(['x']);
      expect(e.preventDefault).toHaveBeenCalled();
    } finally {
      plain.destroy();
    }
  });
});
