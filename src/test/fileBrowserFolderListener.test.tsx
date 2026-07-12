/**
 * FileBrowser folder-changed listener does not leak (round-10 H2 finding #2).
 *
 * The bug: the folder-changed effect was keyed on [expandedFolders], so it re-ran on
 * every expand/collapse and called window.electronAPI.onFolderChanged (ipcRenderer.on,
 * no dedup) EACH time without ever removing the prior listener — listeners accumulated,
 * every one firing an independent reload (N-fold redundant loads) until Node's
 * MaxListenersExceeded warning. The fix registers the listener in a mount-once ([])
 * effect that reads current state via refs, so the count never grows and unmount tears
 * the single listener down via removeAllListeners('folder-changed').
 */
import { render, fireEvent, waitFor } from '@testing-library/react';
import { FileBrowser } from '../components/Layout/FileBrowser';
import { fileSystemService } from '../services/FileSystemService';

jest.mock('../services/FileSystemService', () => ({
  fileSystemService: {
    getSystemDrives: jest.fn(),
    getFolderContents: jest.fn(),
    setCurrentImages: jest.fn(),
    formatFileSize: jest.fn(() => '1 KB'),
  },
}));

const mockFss = fileSystemService as unknown as {
  getSystemDrives: jest.Mock;
  getFolderContents: jest.Mock;
};

function installElectronAPI() {
  const api = {
    onFolderChanged: jest.fn(),
    removeAllListeners: jest.fn(),
    watchFolder: jest.fn().mockResolvedValue({ success: true }),
    unwatchFolder: jest.fn().mockResolvedValue({ success: true }),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  return api;
}

describe('FileBrowser — folder-changed listener registered exactly once', () => {
  beforeEach(() => {
    mockFss.getSystemDrives.mockResolvedValue([
      { id: 'driveC', name: 'C:', path: 'C:\\', type: 'drive' },
    ]);
    mockFss.getFolderContents.mockResolvedValue({
      folders: [{ id: 'sub1', name: 'Sub', path: 'C:\\Sub', type: 'folder' }],
      images: [],
    });
  });

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    jest.clearAllMocks();
  });

  it('does not add a new listener on each expand/collapse, and removes it on unmount', async () => {
    const api = installElectronAPI();
    const { findByText, unmount } = render(<FileBrowser />);

    // Registered once at mount.
    await waitFor(() => expect(api.onFolderChanged).toHaveBeenCalledTimes(1));

    // Expand the drive → expandedFolders changes (would have re-run the old effect).
    const drive = await findByText('C:');
    fireEvent.click(drive);

    // The subfolder renders once contents load; expand it → another expandedFolders change.
    const sub = await findByText('Sub');
    fireEvent.click(sub);

    await waitFor(() => expect(api.watchFolder).toHaveBeenCalled());

    // Still exactly one listener despite multiple expandedFolders transitions.
    expect(api.onFolderChanged).toHaveBeenCalledTimes(1);

    unmount();
    expect(api.removeAllListeners).toHaveBeenCalledWith('folder-changed');
  });
});
