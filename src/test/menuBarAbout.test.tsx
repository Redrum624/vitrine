import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MenuBar } from '../components/Layout/MenuBar';

const APP_INFO = {
  name: 'Vitrine', version: '1.11.0', description: 'Professional photo editor',
  author: 'Redrum624', license: 'PolyForm-Noncommercial-1.0.0', repository: 'https://github.com/Redrum624/Vitrine',
  electron: '39.8.10', chrome: '142.0', node: '22.22.1', v8: '13.0', platform: 'win32', arch: 'x64',
};

beforeEach(() => {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    windowIsMaximized: jest.fn().mockResolvedValue(false),
    getAppInfo: jest.fn().mockResolvedValue(APP_INFO),
    openExternalUrl: jest.fn(),
  };
});

describe('MenuBar — Help ("?") menu / About', () => {
  it('opens an About dialog showing the version and runtime info', async () => {
    render(<MenuBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.click(screen.getByText('About Vitrine'));
    const dlg = await screen.findByRole('dialog', { name: 'About Vitrine' });
    await waitFor(() => expect(dlg).toHaveTextContent('Version 1.11.0'));
    expect(dlg).toHaveTextContent('Electron 39.8.10');
    expect(dlg).toHaveTextContent('PolyForm-Noncommercial-1.0.0');
  });

  it('opens the repository link via openExternalUrl', async () => {
    render(<MenuBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.click(screen.getByText('About Vitrine'));
    await screen.findByRole('dialog', { name: 'About Vitrine' });
    fireEvent.click(await screen.findByText('github.com/Redrum624/Vitrine'));
    expect(window.electronAPI!.openExternalUrl).toHaveBeenCalledWith('https://github.com/Redrum624/Vitrine');
  });
});
