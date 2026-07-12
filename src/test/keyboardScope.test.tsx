/**
 * Round-7 Task Q1 — systemic aria-modal keyboard gap (batch fix).
 *
 * Round-6's whole-branch review found the "don't fire under an open dialog" guard
 * had been added PIECEMEAL three separate times, while several other global keydown
 * listeners still fired beneath open modals. This suite covers the single shared
 * guard (`keyboardEventBlocked`, src/utils/keyboardScope.ts) and each listener that
 * now routes through it:
 *   - keyboardEventBlocked itself (input / textarea / contentEditable / aria-modal).
 *   - KeyboardShortcutsService.handleKeyDown (Ctrl+E, rating keys, …) — behavioural.
 *   - ThumbnailPanel arrows/Esc (the WORST offender: had no input check at all) —
 *     behavioural.
 *   - BasicAdjustmentsModuleComponent mask-Delete — behavioural.
 *   - App's numpad-rating + gallery-Del listeners — source-order assertions (the
 *     effect closures aren't exported/mountable; mirrors galleryView.test.tsx's
 *     'App onNumpadRating gallery guard (source-order regression)' precedent).
 * GalleryView's rating listener is covered by galleryView.test.tsx's existing
 * 'does NOT rate beneath an open modal' test, which stays green after the refactor.
 */
import fs from 'fs';
import path from 'path';
import { render, fireEvent, act } from '@testing-library/react';
import { keyboardEventBlocked } from '../utils/keyboardScope';
import {
  KeyboardShortcutsService,
  createRatingShortcuts,
} from '../services/KeyboardShortcutsService';
import { ThumbnailPanel } from '../components/Panels/ThumbnailPanel';
import { BasicAdjustmentsModuleComponent } from '../components/Modules/BasicAdjustmentsModuleComponent';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { imageService } from '../services/ImageService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { useAppStore } from '../stores/appStore';
import type { ImageFileInfo } from '../services/FileSystemService';

const mountModal = () => {
  const el = document.createElement('div');
  el.setAttribute('aria-modal', 'true');
  document.body.appendChild(el);
  return el;
};

// ─────────────────────────────────────────────────────────────────────────────
describe('keyboardEventBlocked (the shared guard)', () => {
  it('is false for a plain document-level keydown (no field focus, no dialog)', () => {
    const e = { target: document.body } as unknown as KeyboardEvent;
    expect(keyboardEventBlocked(e)).toBe(false);
  });

  it('is true when the target is an INPUT / TEXTAREA / contentEditable', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    // jsdom doesn't compute isContentEditable, so define it to match what a real
    // browser reports for a contenteditable host — the property the helper reads.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(keyboardEventBlocked({ target: input } as unknown as KeyboardEvent)).toBe(true);
    expect(keyboardEventBlocked({ target: textarea } as unknown as KeyboardEvent)).toBe(true);
    expect(keyboardEventBlocked({ target: editable } as unknown as KeyboardEvent)).toBe(true);
  });

  it('is true whenever any [aria-modal="true"] element is in the DOM, regardless of target', () => {
    const modal = mountModal();
    try {
      expect(keyboardEventBlocked({ target: document.body } as unknown as KeyboardEvent)).toBe(true);
    } finally {
      modal.remove();
    }
    // …and false again once it's gone.
    expect(keyboardEventBlocked({ target: document.body } as unknown as KeyboardEvent)).toBe(false);
  });

  it('tolerates a non-element target (e.g. window / document)', () => {
    expect(keyboardEventBlocked({ target: window } as unknown as KeyboardEvent)).toBe(false);
    expect(keyboardEventBlocked({ target: null } as unknown as KeyboardEvent)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('KeyboardShortcutsService — blocked by an open dialog', () => {
  let service: KeyboardShortcutsService;
  let onRate: jest.Mock;

  beforeEach(() => {
    onRate = jest.fn();
    service = new KeyboardShortcutsService();
    createRatingShortcuts(onRate).forEach((s) => service.register(s));
  });
  afterEach(() => {
    service.destroy();
    document.querySelectorAll('[aria-modal="true"]').forEach((el) => el.remove());
  });

  it('fires normally when no dialog is open (baseline)', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    expect(onRate).toHaveBeenCalledWith(3);
  });

  it('does NOT fire while a modal dialog is open', () => {
    mountModal();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    expect(onRate).not.toHaveBeenCalled();
  });

  it('does NOT preventDefault/stopPropagation when blocked — the event still reaches the dialog', () => {
    mountModal();
    const ev = new KeyboardEvent('keydown', { key: '3', cancelable: true });
    const preventSpy = jest.spyOn(ev, 'preventDefault');
    const stopSpy = jest.spyOn(ev, 'stopPropagation');
    document.dispatchEvent(ev);
    expect(onRate).not.toHaveBeenCalled();
    expect(preventSpy).not.toHaveBeenCalled();
    expect(stopSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ThumbnailPanel arrows/Esc — blocked by an open dialog or a focused field', () => {
  const images = [
    { id: 'img1', path: '/p/1.jpg', name: '1.jpg', format: 'JPG' },
    { id: 'img2', path: '/p/2.jpg', name: '2.jpg', format: 'JPG' },
    { id: 'img3', path: '/p/3.jpg', name: '3.jpg', format: 'JPG' },
  ] as unknown as ImageFileInfo[];

  const renderPanel = () => {
    const onImageSelect = jest.fn();
    const onClose = jest.fn();
    render(
      <ThumbnailPanel
        images={images}
        selectedImage={images[0]}
        onImageSelect={onImageSelect}
        onClose={onClose}
        visible={true}
      />,
    );
    return { onImageSelect, onClose };
  };

  beforeEach(() => {
    useAppStore.setState({
      imageRatings: {},
      selectedImageIds: [],
      selectionAnchorId: null,
      ratingFilter: 0,
      alignmentAxisX: null,
    });
    // Give loadThumbnail a data URL so it doesn't hit jsdom's unimplemented
    // canvas.toDataURL placeholder path (which logs a noisy not-implemented error).
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      readImageAsDataURL: jest.fn().mockResolvedValue('data:image/jpeg;base64,aaaa'),
      readImageRating: jest.fn().mockResolvedValue(null),
    };
    document.querySelectorAll('[aria-modal="true"]').forEach((el) => el.remove());
  });
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('ArrowRight switches the loaded photo and Escape closes the filmstrip (baseline)', async () => {
    const { onImageSelect, onClose } = renderPanel();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onImageSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'img2' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    // Drain loadThumbnail's async setState so it doesn't warn about updates outside act.
    await act(async () => { await Promise.resolve(); });
  });

  it('ArrowRight does NOT switch and Escape does NOT close while a modal dialog is open', () => {
    const { onImageSelect, onClose } = renderPanel();
    mountModal();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onImageSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ArrowRight does NOT switch the photo while typing in a text field (the input check it never had)', () => {
    const { onImageSelect } = renderPanel();
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      fireEvent.keyDown(input, { key: 'ArrowRight' });
      expect(onImageSelect).not.toHaveBeenCalled();
    } finally {
      input.remove();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('BasicAdjustmentsModuleComponent mask-Delete — blocked by an open dialog', () => {
  let removeLayer: jest.Mock;

  const setupFakeLA = () => {
    const layers: Array<{ id: string; type: string; name: string; basicAdj: unknown }> = [];
    removeLayer = jest.fn((id: string) => {
      const i = layers.findIndex((l) => l.id === id);
      if (i >= 0) layers.splice(i, 1);
    });
    const fakeLA = {
      getParameters: () => ({ layers }),
      createLayer: (type: string, name: string) => {
        layers.push({ id: 'mask1', type, name, basicAdj: {} });
        return 'mask1';
      },
      updateLayerBasicAdj: jest.fn(),
      setActiveLayer: jest.fn(),
      clearActiveLayer: jest.fn(),
      setLayerGeometry: jest.fn(),
      removeLayer,
    };
    jest.spyOn(imageProcessingPipeline, 'getModule').mockReturnValue(fakeLA as never);
    jest.spyOn(imageProcessingPipeline, 'invalidateModuleCache').mockImplementation(() => {});
    jest.spyOn(imageService, 'getCurrentImage').mockReturnValue({ width: 100, height: 100 } as never);
  };

  const renderWithSelectedMask = () => {
    const module = new BasicAdjustmentsModule();
    const utils = render(<BasicAdjustmentsModuleComponent module={module} onParamsChange={() => {}} />);
    // Create + auto-select a radial mask so selectedMaskId is set (Del has a target).
    fireEvent.click(utils.getByTitle('Add a circle / oval mask'));
    return utils;
  };

  beforeEach(() => {
    setupFakeLA();
    document.querySelectorAll('[aria-modal="true"]').forEach((el) => el.remove());
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Delete removes the selected mask when no dialog is open (baseline)', () => {
    renderWithSelectedMask();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' })); });
    expect(removeLayer).toHaveBeenCalledWith('mask1');
  });

  it('Delete does NOT remove the mask while a modal dialog is open', () => {
    renderWithSelectedMask();
    mountModal();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' })); });
    expect(removeLayer).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// App's numpad-rating + gallery-Del effect closures aren't exported/mountable
// (the ~30 service/module dependency problem documented across the App suites),
// so assert the source routes each through the shared guard. Mirrors
// keyboardShortcutsSingleRegistration.test.ts / galleryView.test.tsx.
describe('App global key listeners route through keyboardEventBlocked (source-order)', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');

  function arrowBody(source: string, constName: string): string {
    const decl = source.indexOf(`const ${constName} = `);
    if (decl === -1) throw new Error(`${constName} not found in App.tsx`);
    const braceStart = source.indexOf('{', decl);
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) return source.slice(braceStart, i + 1);
    }
    throw new Error(`could not brace-balance ${constName}`);
  }

  it('imports the shared guard', () => {
    expect(appSource).toMatch(/import\s*\{[^}]*keyboardEventBlocked[^}]*\}\s*from\s*'\.\/utils\/keyboardScope'/);
  });

  it('onNumpadRating early-returns on keyboardEventBlocked BEFORE preventDefault/stopPropagation', () => {
    const body = arrowBody(appSource, 'onNumpadRating');
    const guardIdx = body.indexOf('keyboardEventBlocked(e)');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(body.indexOf('e.preventDefault()'));
    expect(guardIdx).toBeLessThan(body.indexOf('e.stopPropagation()'));
  });

  it('onGalleryDelete guards on keyboardEventBlocked and still composes the removeTargetIds React-state check', () => {
    const body = arrowBody(appSource, 'onGalleryDelete');
    expect(body).toContain('keyboardEventBlocked(e)');
    // CAUTION 3: the P11 Del flow ANDs the DOM guard with the non-DOM state.
    expect(body).toMatch(/dialogOpen:\s*removeTargetIds\s*!==\s*null/);
  });
});
