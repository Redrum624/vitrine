/**
 * Glass · Sectioned — Gallery view (Task 7, 5a).
 *
 * Covers the shared `viewMode` store field (round-trips without losing selection),
 * the grid's tile rendering (RAW badge, scrim meta, selected check badge), the
 * shared click selection semantics (shift range / ctrl toggle / plain select+load
 * — the same `handleImageClick` the filmstrip dock uses), double-click's
 * develop-view handoff, the shared rating filter hiding non-matching tiles, and
 * the Toolbar's Develop|Gallery segmented (Gallery toolbar variant only — see
 * the dedicated describe block below).
 */
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAppStore } from '../stores/appStore';
import { GalleryView } from '../components/Gallery/GalleryView';
import { Toolbar } from '../components/Layout/Toolbar';
import { electronService } from '../services/ElectronService';
import type { ImageFileInfo } from '../services/FileSystemService';

const images = [
  { id: 'img1', path: '/p/1.jpg', name: '1.jpg', size: 100, format: 'JPG', type: 'image/jpeg', lastModified: 3000, dateModified: new Date(3000) },
  { id: 'img2', path: '/p/2.cr3', name: '2.cr3', size: 200, format: 'CR3', type: 'image/x-canon-cr3', lastModified: 2000, dateModified: new Date(2000) },
  { id: 'img3', path: '/p/3.jpg', name: '3.jpg', size: 300, format: 'JPG', type: 'image/jpeg', lastModified: 1000, dateModified: new Date(1000) },
] as unknown as ImageFileInfo[];

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

const getTile = (id: string) => document.querySelector(`[data-image-id="${id}"]`) as HTMLElement;
const clickTile = (id: string, init?: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean }) => {
  fireEvent.click(getTile(id), init);
};

describe('appStore.viewMode', () => {
  it('defaults to develop and round-trips through the setter without losing selection', () => {
    expect(useAppStore.getState().viewMode).toBe('develop');
    useAppStore.getState().setSelection(['img1', 'img2'], 'img2');

    useAppStore.getState().setViewMode('gallery');
    expect(useAppStore.getState().viewMode).toBe('gallery');
    expect(useAppStore.getState().selectedImageIds).toEqual(['img1', 'img2']);

    useAppStore.getState().setViewMode('develop');
    expect(useAppStore.getState().viewMode).toBe('develop');
    expect(useAppStore.getState().selectedImageIds).toEqual(['img1', 'img2']);
  });
});

describe('GalleryView grid', () => {
  it('renders a tile per image with the RAW badge, scrim meta, and the selected check badge', () => {
    useAppStore.setState({ selectedImageIds: ['img2'], selectionAnchorId: 'img2' });
    render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);

    expect(getTile('img1')).toBeInTheDocument();
    expect(getTile('img2')).toBeInTheDocument();
    expect(getTile('img3')).toBeInTheDocument();

    // RAW badge only on the .cr3 file.
    expect(getTile('img2')).toHaveTextContent('RAW');
    expect(getTile('img1')).not.toHaveTextContent('RAW');

    // Scrim: filename + FMT meta (no pixel dimensions for a folder-scanned file).
    expect(getTile('img1')).toHaveTextContent('1.jpg');
    expect(getTile('img1')).toHaveTextContent('JPG');

    // Selected tile shows the check badge and the data-selected attribute; others don't.
    expect(getTile('img2')).toHaveAttribute('data-selected', 'true');
    expect(getTile('img2').querySelector('[data-testid="gallery-check-badge"]')).toBeInTheDocument();
    expect(getTile('img1')).not.toHaveAttribute('data-selected');
    expect(getTile('img1').querySelector('[data-testid="gallery-check-badge"]')).not.toBeInTheDocument();
  });

  it('renders nothing while not visible', () => {
    const { container } = render(<GalleryView images={images} onImageSelect={jest.fn()} visible={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('GalleryView tile meta — real dimensions from the thumbnail decode (Task B2)', () => {
  // Folder-scanned ImageFileInfo carries no `dimensions` (no per-file decode at
  // scan time). The CHEAPEST correct fix: the thumbnail `<img>` GalleryView
  // already renders decodes the image anyway (to paint it) — capturing its
  // `naturalWidth`/`naturalHeight` via `onLoad` is free (no extra IPC/decode)
  // and is written to the shared `imageDimensions` store map so the tile's own
  // meta line reacts once it's known, without mutating the `images` prop list.
  it('shows "W × H · FMT" once the rendered thumbnail reports its natural size', async () => {
    const widthSpy = jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1400);
    const heightSpy = jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900);
    (window.electronAPI!.readImageAsDataURL as jest.Mock).mockResolvedValue('data:image/jpeg;base64,aaaa');
    try {
      render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);
      await waitFor(() => expect(getTile('img1').querySelector('img')).toBeInTheDocument());

      // No dimensions known yet — format-only meta (same as the "GalleryView grid" test above).
      expect(getTile('img1')).toHaveTextContent('JPG');
      expect(getTile('img1')).not.toHaveTextContent('×');

      const img = getTile('img1').querySelector('img') as HTMLImageElement;
      Object.defineProperty(img, 'naturalWidth', { value: 4000, configurable: true });
      Object.defineProperty(img, 'naturalHeight', { value: 3000, configurable: true });
      fireEvent.load(img);

      await waitFor(() => expect(getTile('img1')).toHaveTextContent('4000 × 3000'));
      expect(getTile('img1')).toHaveTextContent('JPG');
    } finally {
      widthSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  // Critical review finding (fix round 1): `read-image-as-data-url` returns a
  // RAW preview downscaled to <=300x200 (embedded JPEG / sharp resize, see
  // electron/main.cjs), never the sensor's true dimensions. Recording that
  // preview's naturalWidth/naturalHeight as "the" dimensions is confidently
  // wrong (e.g. a 24MP ORF would show "300 × 200"). RAW tiles must stay
  // format-only — exactly the pre-Task-B2 behavior — until something that
  // actually decodes the full RAW (Develop's open/decode path) supplies real
  // dimensions.
  it('does NOT record dimensions from a RAW preview thumbnail (img2 is .cr3)', async () => {
    const widthSpy = jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1400);
    const heightSpy = jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900);
    (window.electronAPI!.readImageAsDataURL as jest.Mock).mockResolvedValue('data:image/jpeg;base64,aaaa');
    try {
      render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);
      await waitFor(() => expect(getTile('img2').querySelector('img')).toBeInTheDocument());

      const img = getTile('img2').querySelector('img') as HTMLImageElement;
      // Simulate the browser reporting the RAW preview's actual (downscaled) size.
      Object.defineProperty(img, 'naturalWidth', { value: 300, configurable: true });
      Object.defineProperty(img, 'naturalHeight', { value: 200, configurable: true });
      fireEvent.load(img);

      // Give any (incorrect) async store write a chance to land, then assert it didn't.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(useAppStore.getState().imageDimensions['img2']).toBeUndefined();
      expect(getTile('img2')).not.toHaveTextContent('×');
      expect(getTile('img2')).toHaveTextContent('CR3');
    } finally {
      widthSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });
});

describe('GalleryView selection semantics (shared with the filmstrip dock)', () => {
  it('plain click loads to canvas and single-selects', () => {
    const onImageSelect = jest.fn();
    render(<GalleryView images={images} onImageSelect={onImageSelect} visible={true} />);
    clickTile('img2');
    expect(onImageSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'img2' }));
    expect(useAppStore.getState().selectedImageIds).toEqual(['img2']);
  });

  it('ctrl+click toggles membership without loading to canvas', () => {
    const onImageSelect = jest.fn();
    render(<GalleryView images={images} onImageSelect={onImageSelect} visible={true} />);
    clickTile('img1', { ctrlKey: true });
    expect(onImageSelect).not.toHaveBeenCalled();
    expect(useAppStore.getState().selectedImageIds).toEqual(['img1']);
    clickTile('img3', { ctrlKey: true });
    expect(useAppStore.getState().selectedImageIds).toEqual(['img1', 'img3']);
  });

  it('shift+click selects the contiguous range from the anchor (display order)', () => {
    useAppStore.setState({ selectedImageIds: ['img1'], selectionAnchorId: 'img1' });
    const onImageSelect = jest.fn();
    render(<GalleryView images={images} onImageSelect={onImageSelect} visible={true} />);
    clickTile('img3', { shiftKey: true });
    expect(useAppStore.getState().selectedImageIds).toEqual(['img1', 'img2', 'img3']);
    expect(onImageSelect).not.toHaveBeenCalled();
  });
});

describe('GalleryView double-click', () => {
  it('switches viewMode to develop and loads the image (reusing the plain-click path)', () => {
    useAppStore.setState({ viewMode: 'gallery' });
    const onImageSelect = jest.fn();
    render(<GalleryView images={images} onImageSelect={onImageSelect} visible={true} />);
    const tile = getTile('img1');
    fireEvent.click(tile);
    fireEvent.doubleClick(tile);
    expect(onImageSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'img1' }));
    expect(useAppStore.getState().viewMode).toBe('develop');
  });
});

describe('GalleryView rating filter (shared store field)', () => {
  it('hides tiles rated below the ratingFilter threshold', () => {
    useAppStore.setState({ imageRatings: { img1: 5, img2: 2, img3: 0 }, ratingFilter: 3 });
    render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);
    expect(document.querySelector('[data-image-id="img1"]')).toBeInTheDocument();
    expect(document.querySelector('[data-image-id="img2"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-image-id="img3"]')).not.toBeInTheDocument();
  });
});

describe('GalleryView lazy-load thumbnail fetch (first-open over-fetch regression)', () => {
  it('does not fetch any thumbnails on the first unmeasured render (viewportSize stays {0,0} in jsdom)', async () => {
    render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);
    // Let effects/microtasks settle without measuring the container — this is
    // the exact "first paint, unmeasured" state that used to fire a
    // readImageAsDataURL + readImageRating IPC for every image in the folder.
    await Promise.resolve();
    expect(window.electronAPI!.readImageAsDataURL).not.toHaveBeenCalled();
    expect(window.electronAPI!.readImageRating).not.toHaveBeenCalled();
  });

  it('fetches thumbnails once the container reports a real measured size', async () => {
    // jsdom's clientWidth/clientHeight are always 0 and ResizeObserver.observe()
    // never invokes its callback (see src/setupTests.ts), so there is no way to
    // trigger a REAL resize event here. Stubbing the getters on
    // HTMLElement.prototype simulates "already measured" for the mount-time
    // `update()` call inside GalleryView's measurement effect, which is enough
    // to drive the windowed lazy-load pass without needing a live ResizeObserver.
    const widthSpy = jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1400);
    const heightSpy = jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900);
    (window.electronAPI!.readImageAsDataURL as jest.Mock).mockResolvedValue('data:image/png;base64,aaaa');
    try {
      render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);
      await waitFor(() => expect(window.electronAPI!.readImageAsDataURL).toHaveBeenCalled());
      // Drain every image's resulting state update (storeThumbnail's
      // setThumbnails + the loading-flag finally block) inside an act-wrapped
      // waitFor so React doesn't warn about updates outside act.
      await waitFor(() => expect(document.querySelectorAll('img')).toHaveLength(images.length));
    } finally {
      widthSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });
});

describe('GalleryView numpad/number rating keys (dead-key-in-gallery regression)', () => {
  it("applies the rating to the whole selection on a bare '0'-'5' keydown (numpad digits emit the same e.key with NumLock on)", () => {
    useAppStore.setState({ selectedImageIds: ['img1', 'img3'] });
    render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);

    fireEvent.keyDown(document, { key: '3' });

    expect(useAppStore.getState().imageRatings.img1).toBe(3);
    expect(useAppStore.getState().imageRatings.img3).toBe(3);
    expect(window.electronAPI!.writeImageRating).toHaveBeenCalledWith('/p/1.jpg', 3);
    expect(window.electronAPI!.writeImageRating).toHaveBeenCalledWith('/p/3.jpg', 3);
  });

  it('ignores the 0-5 rating keydown when a modifier key is held (Ctrl/Cmd/Alt shortcuts must not be hijacked)', () => {
    useAppStore.setState({ selectedImageIds: ['img1', 'img3'] });
    render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);

    fireEvent.keyDown(document, { key: '3', ctrlKey: true });
    fireEvent.keyDown(document, { key: '3', metaKey: true });
    fireEvent.keyDown(document, { key: '3', altKey: true });

    expect(useAppStore.getState().imageRatings.img1).toBeUndefined();
    expect(useAppStore.getState().imageRatings.img3).toBeUndefined();
    expect(window.electronAPI!.writeImageRating).not.toHaveBeenCalled();
  });

  it('does NOT rate beneath an open modal (Del-remove dialog: selection is non-empty by construction; rating writes XMP to disk)', () => {
    useAppStore.setState({ selectedImageIds: ['img1', 'img3'] });
    render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);
    // Simulate any GlassModal being open (the Del-remove confirm, Export, …).
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    try {
      fireEvent.keyDown(document, { key: '3' });

      expect(useAppStore.getState().imageRatings.img1).toBeUndefined();
      expect(useAppStore.getState().imageRatings.img3).toBeUndefined();
      expect(window.electronAPI!.writeImageRating).not.toHaveBeenCalled();
    } finally {
      modal.remove();
    }
  });
});

/**
 * App.tsx's `onNumpadRating` closure is registered inside a `useEffect` and is
 * not itself exported — rendering the full `<App />` tree just to exercise the
 * capture-phase/bubble-phase interplay against GalleryView's own listener above
 * is impractical (same ~30 service/module dependency problem documented in
 * fileOpenSetsCurrentImage.test.ts). Per the fallback for this fix, this
 * statically asserts the source order of the guard instead: the gallery
 * early-return must appear BEFORE stopPropagation/preventDefault, which is
 * exactly what lets the keydown reach the real listener exercised above.
 */
describe('App onNumpadRating gallery guard (source-order regression)', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');

  function extractConstArrowBody(source: string, constName: string): string {
    const declMarker = `const ${constName} = `;
    const declIndex = source.indexOf(declMarker);
    if (declIndex === -1) {
      throw new Error(`Could not find "${declMarker}" in App.tsx - has it been renamed?`);
    }
    const braceStart = source.indexOf('{', declIndex);
    if (braceStart === -1) {
      throw new Error(`Could not find the opening brace for ${constName} in App.tsx`);
    }
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) return source.slice(braceStart, i + 1);
      }
    }
    throw new Error(`Could not find the matching closing brace for ${constName} in App.tsx`);
  }

  it('early-returns on gallery viewMode before stopPropagation/preventDefault', () => {
    const body = extractConstArrowBody(appSource, 'onNumpadRating');
    const guardIndex = body.search(/viewMode\s*===\s*['"]gallery['"]\s*\)\s*return/);
    const preventIndex = body.indexOf('e.preventDefault()');
    const stopIndex = body.indexOf('e.stopPropagation()');

    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(preventIndex);
    expect(guardIndex).toBeLessThan(stopIndex);
  });
});

describe('Toolbar — Develop|Gallery segmented (Gallery toolbar variant only)', () => {
  // Per the locked spec (§7's Gallery geometry table + the 4a-develop.png /
  // 5a-gallery.png reference screenshots), the segmented lives in the GALLERY
  // toolbar only — Develop's own toolbar geometry (§3) never lists one, and the
  // dock's Gallery chip already covers the Develop -> Gallery direction. See
  // task-7-report.md for why adding it to Develop too was tried and reverted
  // (it overlapped the filename chip for longer filenames).
  beforeEach(() => {
    jest.spyOn(electronService, 'isElectron').mockReturnValue(true);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not render the Develop|Gallery segmented in the Develop toolbar', () => {
    render(<Toolbar hasImage zoom={1} />);
    expect(screen.queryByRole('tab', { name: 'Gallery' })).not.toBeInTheDocument();
  });

  it('switches viewMode back to develop when the Develop tab is clicked from the Gallery toolbar', () => {
    useAppStore.setState({ viewMode: 'gallery' });
    render(<Toolbar hasImage zoom={1} onBatchProcess={jest.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Develop' }));
    expect(useAppStore.getState().viewMode).toBe('develop');
  });

  it('renders the Gallery toolbar variant (Open Folder / Sort / Batch Process) in gallery mode', () => {
    useAppStore.setState({ viewMode: 'gallery' });
    render(<Toolbar hasImage zoom={1} onBatchProcess={jest.fn()} />);
    expect(screen.getByRole('button', { name: /open folder/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sort: capture time/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /batch process/i })).toBeInTheDocument();
  });

  describe('Gallery Export… routing (Task B3)', () => {
    it('routes to onExportSelected when exactly one image is ctrl-selected, not onExport', () => {
      useAppStore.setState({ viewMode: 'gallery', selectedImageIds: ['img1'] });
      const onExport = jest.fn();
      const onExportSelected = jest.fn();
      render(
        <Toolbar hasImage zoom={1} onBatchProcess={jest.fn()} onExport={onExport} onExportSelected={onExportSelected} />
      );
      fireEvent.click(screen.getByRole('button', { name: /export/i }));
      expect(onExportSelected).toHaveBeenCalledTimes(1);
      expect(onExport).not.toHaveBeenCalled();
    });

    it('still routes to onExportSelected when ≥2 images are selected', () => {
      useAppStore.setState({ viewMode: 'gallery', selectedImageIds: ['img1', 'img2'] });
      const onExport = jest.fn();
      const onExportSelected = jest.fn();
      render(
        <Toolbar hasImage zoom={1} onBatchProcess={jest.fn()} onExport={onExport} onExportSelected={onExportSelected} />
      );
      fireEvent.click(screen.getByRole('button', { name: /export/i }));
      expect(onExportSelected).toHaveBeenCalledTimes(1);
      expect(onExport).not.toHaveBeenCalled();
    });

    it('falls back to onExport (current photo) when nothing is selected', () => {
      useAppStore.setState({ viewMode: 'gallery', selectedImageIds: [] });
      const onExport = jest.fn();
      const onExportSelected = jest.fn();
      render(
        <Toolbar hasImage zoom={1} onBatchProcess={jest.fn()} onExport={onExport} onExportSelected={onExportSelected} />
      );
      fireEvent.click(screen.getByRole('button', { name: /export/i }));
      expect(onExport).toHaveBeenCalledTimes(1);
      expect(onExportSelected).not.toHaveBeenCalled();
    });
  });
});

describe('GalleryView tile — clean format label for a raw MIME-ish `format` (round-6 P8)', () => {
  // Not every ImageFileInfo producer stores a display-friendly `format` (see
  // utils/imageFormat.ts's doc comment) — some store the raw MIME type. Both the tile's
  // title attribute and its no-thumbnail placeholder must route through getDisplayFormat,
  // same as the scrim meta (formatGalleryTileMeta) already does.
  const mimeImages = [
    { id: 'mime1', path: '/p/mime1.jpg', name: 'mime1.jpg', size: 100, format: 'image/jpeg', type: 'image/jpeg', lastModified: 0, dateModified: new Date(0) },
  ] as unknown as ImageFileInfo[];

  it('shows "JPG" (not "image/jpeg") in the tile title attribute', () => {
    render(<GalleryView images={mimeImages} onImageSelect={jest.fn()} visible={true} />);
    const tile = getTile('mime1');
    expect(tile).toHaveAttribute('title', 'mime1.jpg (JPG)');
    expect(tile.getAttribute('title')).not.toContain('image/jpeg');
  });

  it('shows "JPG" (not "image/jpeg") in the no-thumbnail placeholder once loading settles', async () => {
    render(<GalleryView images={mimeImages} onImageSelect={jest.fn()} visible={true} />);
    await waitFor(() => expect(getTile('mime1')).toHaveTextContent('JPG'));
    expect(getTile('mime1').textContent).not.toContain('image/jpeg');
  });
});
