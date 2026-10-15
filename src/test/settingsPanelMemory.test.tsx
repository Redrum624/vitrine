import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsPanel } from '../components/Panels/SettingsPanel';
import { imageCacheService } from '../services/ImageCacheService';
import { applyMemoryPreset } from '../services/memoryPresetRuntime';

const GB = 1024 ** 3;

describe('SettingsPanel — memory preset', () => {
  let store: Record<string, unknown>;
  let api: Record<string, jest.Mock>;
  beforeEach(() => {
    store = {};
    api = {
      getAppVersion: jest.fn().mockResolvedValue('1.0.0'),
      getMemoryInfo: jest.fn(async () => ({ totalRamBytes: 16 * GB, measuredHeapLimitMB: 3586 })),
      setDiskCacheBudget: jest.fn(async () => true),
      storeGet: jest.fn(async (k: string) => store[k] ?? null),
      storeSet: jest.fn(async (k: string, v: unknown) => { store[k] = v; return true; }),
    };
    (window as unknown as { electronAPI: unknown }).electronAPI = api;
  });
  afterEach(async () => {
    await applyMemoryPreset('balanced');
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  test('renders Balanced / High / Maximum with the computed numbers beneath', async () => {
    render(<SettingsPanel />);
    expect(screen.getByRole('tab', { name: 'Balanced' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'High' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Maximum' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Memory budgets' })).toHaveTextContent('700 MB in memory, 2 GB on disk');
    await screen.findByText('16 GB installed');
  });

  test('choosing a preset persists via the durable store and updates the numbers; no restart prompt', async () => {
    render(<SettingsPanel />);
    await screen.findByText('16 GB installed');
    fireEvent.click(screen.getByRole('tab', { name: 'High' }));
    await waitFor(() => expect(store.memoryPreset).toBe('high'));
    expect(screen.getByRole('list', { name: 'Memory budgets' })).toHaveTextContent('2.3 GB in memory, 4 GB on disk');
    await waitFor(() => expect(api.setDiskCacheBudget).toHaveBeenCalledWith('high'));
    expect(screen.queryByText(/restart/i)).not.toBeInTheDocument();
  });

  test('restores the stored preset on mount', async () => {
    store.memoryPreset = 'max';
    render(<SettingsPanel />);
    await waitFor(() => expect(screen.getByRole('list', { name: 'Memory budgets' })).toHaveTextContent('3.7 GB in memory, 8 GB on disk'));
  });

  test('a pick made before the mount-time load resolves wins over the stale stored value', async () => {
    store.memoryPreset = 'max';
    let release: (v: unknown) => void = () => {};
    api.storeGet.mockImplementation(() => new Promise((r) => { release = r; }));
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole('tab', { name: 'High' }));
    release('max'); // the stale load now resolves
    await waitFor(() => expect(store.memoryPreset).toBe('high'));
    await screen.findByText('16 GB installed');
    expect(screen.getByRole('tab', { name: 'High' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('list', { name: 'Memory budgets' })).toHaveTextContent('2.3 GB in memory, 4 GB on disk');
  });

  test('rapid clicks apply in order: the last pick wins', async () => {
    render(<SettingsPanel />);
    await screen.findByText('16 GB installed');
    fireEvent.click(screen.getByRole('tab', { name: 'Maximum' }));
    fireEvent.click(screen.getByRole('tab', { name: 'High' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Balanced' }));
    await waitFor(() => expect(api.setDiskCacheBudget).toHaveBeenCalledTimes(3));
    expect(api.setDiskCacheBudget.mock.calls.map((c) => c[0])).toEqual(['max', 'high', 'balanced']);
    expect(store.memoryPreset).toBe('balanced');
    expect(imageCacheService.getBaseBudget()).toBe(700 * 1024 * 1024);
  });
});
