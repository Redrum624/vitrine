import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsPanel } from '../components/Panels/SettingsPanel';

describe('SettingsPanel — About block', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('shows the real app version from electronAPI, not the hardcoded 1.0.0', async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getAppVersion: jest.fn().mockResolvedValue('9.9.9'),
    };
    render(<SettingsPanel />);
    expect(await screen.findByText('Version 9.9.9')).toBeInTheDocument();
    expect(screen.queryByText(/1\.0\.0/)).not.toBeInTheDocument();
  });

  it('derives the copyright year dynamically (current year, not a frozen 2025)', async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getAppVersion: jest.fn().mockResolvedValue('9.9.9'),
    };
    render(<SettingsPanel />);
    const year = new Date().getFullYear();
    expect(screen.getByText(`© ${year} Redrum624 · Free for non-commercial use`)).toBeInTheDocument();
    await screen.findByText('Version 9.9.9'); // flush the async version fetch (avoids act() noise)
  });

  it('falls back gracefully when electronAPI is unavailable (browser/test env)', () => {
    render(<SettingsPanel />);
    // No crash; the version line renders a placeholder instead of a stale number.
    expect(screen.getByText('Version —')).toBeInTheDocument();
    expect(screen.queryByText(/1\.0\.0/)).not.toBeInTheDocument();
  });

  it('only offers settings that are wired: no read-only checkboxes left', () => {
    render(<SettingsPanel />);
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).not.toHaveAttribute('readonly');
    }
    expect(screen.queryByText('Dark Mode')).not.toBeInTheDocument();
  });

  it('persists the welcome-screen toggle under the key App reads at startup', () => {
    localStorage.removeItem('photo-editor-welcome-dismissed');
    render(<SettingsPanel />);
    const box = screen.getByRole('checkbox', { name: 'Show welcome screen' });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(localStorage.getItem('photo-editor-welcome-dismissed')).toBe('true');
    fireEvent.click(box);
    expect(localStorage.getItem('photo-editor-welcome-dismissed')).toBeNull();
  });
});
