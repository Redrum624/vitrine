/**
 * The filmstrip's folder stays watched while the File Explorer is hidden (X2, 2026-11-18).
 *
 * Diagnosis C5/R11: FileBrowser lived inside the inspector's module slot, which unmounts when
 * the inspector hides (Gallery view, no tool and no histogram) and when no tool is selected.
 * Its cleanup released every watcher and its tree state, while the filmstrip kept showing the
 * folder: nothing refreshed it any more. FileBrowser is now mounted once and only hidden.
 *
 * Renders App's real inspector block (InspectorColumn, the JSX App renders in its main row)
 * with the real FileBrowser; the three other panels are stubs that log their mounts.
 */
import { render, fireEvent, act, screen } from '@testing-library/react';
import { InspectorColumn, type InspectorColumnProps } from '../App';
import { fileSystemService } from '../services/FileSystemService';
import type { FolderInfo, ImageFileInfo } from '../services/FileSystemService';

const mockPanelLog: string[] = [];

jest.mock('../components/Panels/HistogramPanel', () => {
  const React = jest.requireActual('react');
  return {
    HistogramPanel: () => {
      React.useEffect(() => {
        mockPanelLog.push('mount:histogram');
        return () => { mockPanelLog.push('unmount:histogram'); };
      }, []);
      return React.createElement('div', { 'data-testid': 'histogram-panel' });
    },
  };
});
jest.mock('../components/Panels/SettingsPanel', () => {
  const React = jest.requireActual('react');
  return {
    SettingsPanel: () => {
      React.useEffect(() => {
        mockPanelLog.push('mount:settings');
        return () => { mockPanelLog.push('unmount:settings'); };
      }, []);
      return React.createElement('div', { 'data-testid': 'settings-panel' });
    },
  };
});
jest.mock('../components/Panels/AdjustmentPanel', () => {
  const React = jest.requireActual('react');
  return {
    AdjustmentPanel: () => {
      React.useEffect(() => {
        mockPanelLog.push('mount:adjustment');
        return () => { mockPanelLog.push('unmount:adjustment'); };
      }, []);
      return React.createElement('div', { 'data-testid': 'adjustment-panel' });
    },
  };
});
jest.mock('../services/FileSystemService', () => ({
  fileSystemService: {
    getSystemDrives: jest.fn(),
    getFolderContents: jest.fn(),
    setCurrentImages: jest.fn(),
    formatFileSize: jest.fn(() => '1 KB'),
  },
}));

type Listing = { folders: FolderInfo[]; images: ImageFileInfo[] };
const mockFss = fileSystemService as unknown as { getSystemDrives: jest.Mock; getFolderContents: jest.Mock };

const b64 = (p: string) => Buffer.from(p).toString('base64');
const baseName = (p: string) => p.split('\\').filter(Boolean).pop() as string;
const folder = (p: string): FolderInfo => ({ id: b64(p), name: baseName(p), path: p, type: 'folder' });
const image = (p: string): ImageFileInfo => ({
  id: b64(p), name: baseName(p), path: p, size: 1000, format: 'JPG', type: 'image/jpeg',
  lastModified: 1, dateModified: new Date(1),
});

const ROOT = 'C:\\';
const A = 'C:\\A';
const listings = new Map<string, Listing>();
const setListing = (p: string, folders: string[], images: string[]) =>
  listings.set(p, { folders: folders.map(folder), images: images.map(image) });

function installElectronAPI() {
  const api = {
    onFolderChanged: jest.fn(),
    removeAllListeners: jest.fn(),
    watchFolder: jest.fn().mockResolvedValue({ success: true }),
    unwatchFolder: jest.fn().mockResolvedValue({ success: true }),
    splashProgress: jest.fn().mockResolvedValue(undefined),
    appReady: jest.fn().mockResolvedValue(undefined),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  return api;
}
type Api = ReturnType<typeof installElectronAPI>;

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}
const waitMs = (ms: number) => act(() => new Promise<void>((r) => { setTimeout(r, ms); }));

const folderLabel = (name: string) => screen.getByText(name, { selector: 'span' });
const arrowOf = (name: string) => folderLabel(name).parentElement!.parentElement!.firstElementChild as HTMLElement;

const onImageSelected = jest.fn();
const onFolderSelected = jest.fn();
const BASE_PROPS: InspectorColumnProps = {
  viewMode: 'develop', selectedTool: 'file-explorer', histogramVisible: false,
  currentImage: null, onImageSelected, onFolderSelected,
};

function mountColumn(props: Partial<InspectorColumnProps> = {}) {
  const utils = render(<InspectorColumn {...BASE_PROPS} {...props} />);
  const show = (next: Partial<InspectorColumnProps>) => {
    utils.rerender(<InspectorColumn {...BASE_PROPS} {...next} />);
  };
  return { ...utils, show };
}

// The FileBrowser root is the element right under its wrapper; the heading sits in its header row.
function fileBrowserWrapper(container: HTMLElement): HTMLElement | null {
  const heading = Array.from(container.querySelectorAll('h2')).find((h) => h.textContent?.trim() === 'File Explorer');
  return heading ? heading.parentElement!.parentElement!.parentElement : null;
}
function displayed(el: HTMLElement, root: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n && n !== root; n = n.parentElement) {
    if (n.style.display === 'none') return false;
  }
  return true;
}
// The inspector's visible layout: the aside's style and, level by level, the style of each
// child that is displayed (a display:none child takes no space and is not visible).
function visibleLayout(container: HTMLElement) {
  const aside = container.querySelector('aside[aria-label="Inspector"]') as HTMLElement | null;
  if (!aside || !displayed(aside, container)) return null;
  const kids = (el: HTMLElement) => Array.from(el.children).filter((c) => (c as HTMLElement).style.display !== 'none') as HTMLElement[];
  return {
    aside: aside.getAttribute('style'),
    children: kids(aside).map((c) => ({
      style: c.getAttribute('style'),
      children: kids(c).map((g) => ({ style: g.getAttribute('style'), content: g.firstElementChild?.getAttribute('data-testid') ?? g.firstElementChild?.tagName })),
    })),
  };
}

describe('InspectorColumn — the File Explorer is mounted once and only hidden', () => {
  let api: Api;

  beforeEach(() => {
    mockPanelLog.length = 0;
    listings.clear();
    mockFss.getSystemDrives.mockResolvedValue([{ id: 'driveC', name: 'C:', path: ROOT, type: 'drive' }]);
    setListing(ROOT, [A], []);
    setListing(A, [], ['C:\\A\\a1.jpg']);
    mockFss.getFolderContents.mockImplementation((p: string) =>
      Promise.resolve(listings.get(p) ?? { folders: [], images: [] }));
    api = installElectronAPI();
  });

  afterEach(async () => {
    // Let this test's 200 ms appReady timer fire on its own api, not the next test's.
    await waitMs(300);
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    jest.clearAllMocks();
  });

  test('1. tool off/on, another tool, Gallery and back: one drive load, one appReady, no watcher released', async () => {
    const { show } = mountColumn();
    await screen.findByText('C:', { selector: 'span' });
    fireEvent.click(arrowOf('C:')); // expand C: (watched)
    await screen.findByText('A', { selector: 'span' });
    await flush();
    expect(api.watchFolder).toHaveBeenCalledWith(ROOT);

    for (const step of [
      { selectedTool: null },
      { selectedTool: 'file-explorer' },
      { selectedTool: 'settings' },
      { selectedTool: 'file-explorer' },
      { viewMode: 'gallery' as const },
      { viewMode: 'develop' as const },
    ]) {
      show(step);
      await flush();
    }
    await waitMs(400); // loadSystemDrives signals appReady after a 200 ms timer

    expect(mockFss.getSystemDrives).toHaveBeenCalledTimes(1);
    expect(api.appReady).toHaveBeenCalledTimes(1);
    expect(api.unwatchFolder).not.toHaveBeenCalled();
    expect(api.removeAllListeners).not.toHaveBeenCalledWith('folder-changed');
    // The tree kept its state: C: is still expanded.
    expect(screen.getByText('A', { selector: 'span' })).toBeTruthy();
  });

  test.each([
    ['the tool toggled off', { selectedTool: null }],
    ['Gallery view', { viewMode: 'gallery' as const }],
  ])('2. hidden by %s, a change in the gallery folder still reaches the filmstrip', async (_label, hidden) => {
    const { show } = mountColumn();
    await screen.findByText('C:', { selector: 'span' });
    fireEvent.click(arrowOf('C:'));
    await screen.findByText('A', { selector: 'span' });
    fireEvent.click(folderLabel('A')); // name click: A becomes the gallery folder
    await flush();
    expect(onFolderSelected).toHaveBeenLastCalledWith([image('C:\\A\\a1.jpg')]);
    onFolderSelected.mockClear();
    onImageSelected.mockClear();

    show(hidden);
    await flush();
    setListing(A, [], ['C:\\A\\a1.jpg', 'C:\\A\\a2.jpg']);
    const cb = api.onFolderChanged.mock.calls[0][0] as (d: { folderPath: string; eventType: string; filename: string | null }) => void;
    await act(async () => { cb({ folderPath: A, eventType: 'rename', filename: 'a2.jpg' }); });
    await flush();

    expect(onFolderSelected).toHaveBeenCalledTimes(1);
    expect(onFolderSelected).toHaveBeenCalledWith([image('C:\\A\\a1.jpg'), image('C:\\A\\a2.jpg')]);
    expect(onImageSelected).not.toHaveBeenCalled();
  });

  test('3a. while the File Explorer is not the visible panel its wrapper is display:none', async () => {
    const { container, show } = mountColumn();
    await screen.findByText('C:', { selector: 'span' });
    for (const state of [
      { selectedTool: null },
      { selectedTool: 'settings' },
      { selectedTool: 'basicadj' },
      { selectedTool: null, histogramVisible: true },
      { viewMode: 'gallery' as const },
      { viewMode: 'gallery' as const, selectedTool: null },
    ]) {
      show(state);
      await flush();
      const wrapper = fileBrowserWrapper(container);
      expect(wrapper).not.toBeNull();
      expect(wrapper!.style.display).toBe('none');
      expect(displayed(wrapper!, container)).toBe(false);
    }
    show({});
    await flush();
    expect(displayed(fileBrowserWrapper(container)!, container)).toBe(true);
  });

  // Expected layouts recorded from BASE 74041ea's inspector block.
  const ASIDE = 'width: 340px; flex: 0 0 auto; min-height: 0; background: var(--vt-panel); border-left: 1px solid var(--vt-line-soft);';
  const HIST = { style: 'flex: 0 0 auto;', children: [{ style: null, content: undefined }] };
  const SLOT = 'flex: 1 1 auto; min-height: 0; position: relative;';
  const FB = { style: 'display: block; height: 100%; overflow: hidden;', content: 'DIV' };
  const SETTINGS = { style: 'display: block; height: 100%; overflow-y: auto;', content: 'settings-panel' };
  const MODULE = { style: 'display: block; height: 100%;', content: 'adjustment-panel' };

  test.each([
    ['File Explorer', {}, [{ style: SLOT, children: [FB] }]],
    ['File Explorer + histogram', { histogramVisible: true }, [HIST, { style: SLOT, children: [FB] }]],
    ['Settings', { selectedTool: 'settings' }, [{ style: SLOT, children: [SETTINGS] }]],
    ['a module', { selectedTool: 'basicadj' }, [{ style: SLOT, children: [MODULE] }]],
    ['a module + histogram', { selectedTool: 'basicadj', histogramVisible: true }, [HIST, { style: SLOT, children: [MODULE] }]],
    ['histogram only', { selectedTool: null, histogramVisible: true }, [HIST]],
  ])('3b. the visible layout of "%s" equals BASE', async (_label, state, children) => {
    const { container, show } = mountColumn();
    await screen.findByText('C:', { selector: 'span' });
    show(state);
    await flush();
    expect(visibleLayout(container)).toEqual({ aside: ASIDE, children });
  });

  test('3c. the inspector is not visible in Gallery view or with nothing selected', async () => {
    const { container, show } = mountColumn();
    await screen.findByText('C:', { selector: 'span' });
    for (const state of [{ viewMode: 'gallery' as const }, { selectedTool: null }]) {
      show(state);
      await flush();
      expect(visibleLayout(container)).toBeNull();
      expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();
    }
  });

  test('3d. Settings, the module panel and the histogram mount and unmount exactly as on BASE', async () => {
    const { show } = mountColumn();
    await screen.findByText('C:', { selector: 'span' });
    const log: string[][] = [];
    const take = () => { log.push(mockPanelLog.splice(0)); };
    take();
    for (const state of [
      { selectedTool: null },
      { selectedTool: 'settings' },
      { selectedTool: 'settings', histogramVisible: true },
      { viewMode: 'gallery' as const, selectedTool: 'settings', histogramVisible: true },
      { selectedTool: 'settings', histogramVisible: true },
      { selectedTool: null, histogramVisible: true },
      { selectedTool: 'basicadj' },
    ]) {
      show(state);
      await flush();
      take();
    }
    // Recorded from BASE 74041ea.
    expect(log).toEqual([
      ['mount:settings', 'mount:adjustment'],
      ['unmount:settings', 'unmount:adjustment'],
      ['mount:settings', 'mount:adjustment'],
      ['mount:histogram'],
      ['unmount:histogram', 'unmount:settings', 'unmount:adjustment'],
      ['mount:histogram', 'mount:settings', 'mount:adjustment'],
      ['unmount:settings', 'unmount:adjustment'],
      ['unmount:histogram', 'mount:settings', 'mount:adjustment'],
    ]);
  });

  test('9. unmount (window teardown) unwatches every watched folder and drops the listener', async () => {
    const { unmount } = mountColumn();
    await screen.findByText('C:', { selector: 'span' });
    fireEvent.click(arrowOf('C:'));
    await screen.findByText('A', { selector: 'span' });
    await flush();
    const removeListener = jest.spyOn(window, 'removeEventListener');
    unmount();
    expect(api.unwatchFolder).toHaveBeenCalledWith(ROOT);
    expect(api.removeAllListeners).toHaveBeenCalledWith('folder-changed');
    expect(removeListener.mock.calls.some((c) => String(c[0]) === 'focus')).toBe(true);
    removeListener.mockRestore();
  });
});
