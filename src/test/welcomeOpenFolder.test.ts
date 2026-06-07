/**
 * Unit tests for the Welcome screen "Open Folder" action logic
 * (openFolderFromDialog in App.tsx).
 *
 * The Welcome "Open Folder" button must: open an openDirectory dialog, enumerate
 * the chosen folder via fileSystemService.getFolderContents, push the resulting
 * images into the workspace (filmstrip + open-first via the existing
 * handleFolderSelected path) and dismiss the Welcome overlay. Cancellation and
 * empty folders must leave the Welcome overlay open.
 *
 * The dialog, the folder enumeration service and all UI side-effect callbacks
 * are injected as dependencies, so the pure handler is tested in isolation
 * without rendering the full App component graph.
 */
import { openFolderFromDialog, OpenFolderDeps } from '../App';
import type { ImageFileInfo } from '../services/FileSystemService';

function makeImage(name: string): ImageFileInfo {
  return {
    id: name,
    name,
    path: `C:/pics/${name}`,
    size: 1234,
    format: 'jpg',
    type: 'image',
    lastModified: 0,
    dateModified: new Date(0)
  };
}

function makeDeps(overrides: Partial<OpenFolderDeps> = {}): {
  deps: OpenFolderDeps;
  spies: {
    showOpenDialog: jest.Mock;
    getFolderContents: jest.Mock;
    onFolderSelected: jest.Mock;
    setWelcomeVisible: jest.Mock;
    showSuccess: jest.Mock;
    showError: jest.Mock;
  };
} {
  const spies = {
    showOpenDialog: jest.fn(),
    getFolderContents: jest.fn(),
    onFolderSelected: jest.fn(),
    setWelcomeVisible: jest.fn(),
    showSuccess: jest.fn(),
    showError: jest.fn()
  };
  const deps: OpenFolderDeps = {
    isElectron: () => true,
    showOpenDialog: spies.showOpenDialog,
    getFolderContents: spies.getFolderContents,
    onFolderSelected: spies.onFolderSelected,
    setWelcomeVisible: spies.setWelcomeVisible,
    showSuccess: spies.showSuccess,
    showError: spies.showError,
    ...overrides
  };
  return { deps, spies };
}

describe('openFolderFromDialog', () => {
  test('loads images, opens the workspace and dismisses Welcome', async () => {
    const images = [makeImage('a.jpg'), makeImage('b.jpg'), makeImage('c.orf')];
    const { deps, spies } = makeDeps();
    spies.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:/pics'] });
    spies.getFolderContents.mockResolvedValue({ folders: [], images });

    await openFolderFromDialog(deps);

    // (a) openDirectory dialog requested
    expect(spies.showOpenDialog).toHaveBeenCalledTimes(1);
    expect(spies.showOpenDialog.mock.calls[0][0].properties).toContain('openDirectory');

    // folder enumerated for the chosen path
    expect(spies.getFolderContents).toHaveBeenCalledWith('C:/pics');

    // (b) images pushed through the working folder-load path (filmstrip + open-first)
    expect(spies.onFolderSelected).toHaveBeenCalledWith(images);

    // (c) Welcome overlay hidden + success toast
    expect(spies.setWelcomeVisible).toHaveBeenCalledWith(false);
    expect(spies.showSuccess).toHaveBeenCalled();
    expect(spies.showError).not.toHaveBeenCalled();
  });

  test('canceled dialog leaves Welcome open and does nothing', async () => {
    const { deps, spies } = makeDeps();
    spies.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    await openFolderFromDialog(deps);

    expect(spies.getFolderContents).not.toHaveBeenCalled();
    expect(spies.onFolderSelected).not.toHaveBeenCalled();
    expect(spies.setWelcomeVisible).not.toHaveBeenCalled();
    expect(spies.showError).not.toHaveBeenCalled();
  });

  test('empty folder keeps Welcome open and shows an error toast', async () => {
    const { deps, spies } = makeDeps();
    spies.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:/empty'] });
    spies.getFolderContents.mockResolvedValue({ folders: [], images: [] });

    await openFolderFromDialog(deps);

    expect(spies.onFolderSelected).not.toHaveBeenCalled();
    expect(spies.setWelcomeVisible).not.toHaveBeenCalled();
    expect(spies.showError).toHaveBeenCalledTimes(1);
  });

  test('non-Electron environment shows an error and never opens a dialog', async () => {
    const { deps, spies } = makeDeps({ isElectron: () => false });

    await openFolderFromDialog(deps);

    expect(spies.showOpenDialog).not.toHaveBeenCalled();
    expect(spies.onFolderSelected).not.toHaveBeenCalled();
    expect(spies.showError).toHaveBeenCalledTimes(1);
  });

  test('enumeration failure is caught and surfaced as an error toast', async () => {
    const { deps, spies } = makeDeps();
    spies.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:/pics'] });
    spies.getFolderContents.mockRejectedValue(new Error('readdir failed'));

    await openFolderFromDialog(deps);

    expect(spies.onFolderSelected).not.toHaveBeenCalled();
    expect(spies.setWelcomeVisible).not.toHaveBeenCalled();
    expect(spies.showError).toHaveBeenCalledTimes(1);
  });
});
