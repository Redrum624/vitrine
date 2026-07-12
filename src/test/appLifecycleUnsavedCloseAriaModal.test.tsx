/**
 * Round-8 S1 item 3 — AppLifecycleService's unsaved-changes confirm must be aria-modal.
 *
 * Before this fix, createUnsavedChangesModal appended a plain (non aria-modal) overlay: none of
 * the six keyboardEventBlocked-guarded global listeners (KeyboardShortcutsService, App's numpad
 * rating, GalleryView's rating, BasicAdjustmentsModuleComponent's mask-Del, ThumbnailPanel's
 * arrows/Esc, App's gallery-Del) treated it as blocking — e.g. a stray rating keypress behind the
 * confirm would still write an XMP rating to disk. The confirm now sets role="dialog" +
 * aria-modal="true", which keyboardEventBlocked() picks up for free (it queries
 * `[aria-modal="true"]` — see src/utils/keyboardScope.ts).
 *
 * The rating-no-op test mirrors galleryView.test.tsx's "does NOT rate beneath an open modal" test,
 * but drives the REAL AppLifecycleService dialog instead of a synthetic stand-in div.
 */
import fs from 'fs';
import path from 'path';
import { render, fireEvent } from '@testing-library/react';
import { useAppStore } from '../stores/appStore';
import { GalleryView } from '../components/Gallery/GalleryView';
import { appLifecycleService } from '../services/AppLifecycleService';
import type { ImageFileInfo } from '../services/FileSystemService';

const images = [
  { id: 'img1', path: '/p/1.jpg', name: '1.jpg', size: 100, format: 'JPG', type: 'image/jpeg', lastModified: 3000, dateModified: new Date(3000) },
] as unknown as ImageFileInfo[];

// Registered once — always reports an unsaved change so electron-app-close-request always opens
// the confirm. This test file owns a fresh AppLifecycleService module instance (Jest gives each
// test file its own module registry), so this doesn't bleed into other suites.
appLifecycleService.registerUnsavedChangesChecker({
  hasUnsavedChanges: () => true,
  getDescription: () => 'Unsaved test edit',
});

const resetStore = () => {
  useAppStore.setState({
    viewMode: 'develop',
    ratingFilter: 0,
    imageRatings: {},
    selectedImageIds: [],
    selectionAnchorId: null,
    gallerySortAscending: false,
    alignmentAxisX: null,
    imageDimensions: {},
  });
};

beforeEach(() => {
  resetStore();
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    readImageAsDataURL: jest.fn().mockResolvedValue(null),
    readImageRating: jest.fn().mockResolvedValue(null),
    writeImageRating: jest.fn().mockResolvedValue({ ok: true }),
  };
});

afterEach(() => {
  // Dismiss any still-open confirm through its REAL Escape path (not a raw DOM removal): the
  // dialog's capture-phase keydown listener is only detached by that path (button clicks don't
  // remove it either — a pre-existing, out-of-scope leak). A raw `.remove()` here would leave a
  // stale listener attached to `document` that intercepts the NEXT test's Escape via
  // stopImmediatePropagation before its own (fresh) listener ever runs.
  if (document.querySelector('[aria-modal="true"]')) {
    fireEvent.keyDown(document, { key: 'Escape' });
  }
});

describe('AppLifecycleService unsaved-close confirm — aria-modal', () => {
  it('renders with role="dialog" and aria-modal="true" when there are unsaved changes', () => {
    window.dispatchEvent(new CustomEvent('electron-app-close-request'));

    const dialog = document.querySelector('[aria-modal="true"]');
    expect(dialog).not.toBeNull();
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog?.textContent).toContain('Unsaved Changes');
  });

  it('blocks a rating keydown while the confirm is open (keyboardEventBlocked picks it up for free)', () => {
    useAppStore.setState({ selectedImageIds: ['img1'] });
    render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);

    window.dispatchEvent(new CustomEvent('electron-app-close-request'));
    expect(document.querySelector('[aria-modal="true"]')).not.toBeNull();

    fireEvent.keyDown(document, { key: '3' });

    expect(useAppStore.getState().imageRatings.img1).toBeUndefined();
    expect(window.electronAPI!.writeImageRating).not.toHaveBeenCalled();
  });

  it('dismisses on Escape (cancels the close) and removes the aria-modal node', () => {
    window.dispatchEvent(new CustomEvent('electron-app-close-request'));
    expect(document.querySelector('[aria-modal="true"]')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
  });
});

/**
 * ThumbnailPanel's own Esc listener is bubble-phase (document.addEventListener('keydown', fn) —
 * no capture flag) and was the WORST of the six pre-Q1 gaps (no input check at all). Rendering the
 * full app tree to exercise real capture-vs-bubble propagation against a focused descendant target
 * is impractical here (same ~30-service dependency problem the galleryView.test.tsx App-source
 * fallback documents) — so, matching that precedent, this pins the SOURCE CONTRACT instead: the
 * confirm's Esc handler must be registered on the CAPTURE phase and call
 * stopImmediatePropagation before tearing itself down, so it wins the race against
 * ThumbnailPanel's bubble-phase listener regardless of DOM registration order for a real
 * (non-document-target) keydown.
 */
describe('AppLifecycleService Esc handler — capture-phase source contract', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'AppLifecycleService.ts'),
    'utf8',
  );

  it('registers the modal keydown listener on the capture phase', () => {
    expect(source).toMatch(/document\.addEventListener\('keydown',\s*handleKeyDown,\s*true\)/);
  });

  it('calls stopImmediatePropagation before removing the listener / resolving', () => {
    const idx = source.indexOf("if (e.key === 'Escape')");
    expect(idx).toBeGreaterThan(-1);
    const body = source.slice(idx, idx + 400);
    const stopIdx = body.indexOf('stopImmediatePropagation');
    const removeIdx = body.indexOf('removeEventListener');
    expect(stopIdx).toBeGreaterThan(-1);
    expect(removeIdx).toBeGreaterThan(-1);
    expect(stopIdx).toBeLessThan(removeIdx);
  });
});
