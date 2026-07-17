/**
 * "Styled" chip — the toolbar indicator that a style grade (Auto All / preset /
 * pasted style) is layered on top of the decode. Without it, a heavy grade
 * reads as "the decoder is broken" (a camera-match toggle appeared dead because
 * the persisted Auto All grade dominated the render).
 */
import { render, screen } from '@testing-library/react';
import { Toolbar } from '../components/Layout/Toolbar';

// The Toolbar renders an empty shell outside Electron (jsdom) — pretend we are in it.
jest.mock('../services/ElectronService', () => ({
  electronService: { isElectron: () => true, openFile: jest.fn() },
}));

describe('Toolbar Styled chip', () => {
  it('is shown when a style grade is active on an open image', () => {
    render(<Toolbar hasImage styleGradeActive />);
    const chip = screen.getByText('Styled');
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveAttribute('title', expect.stringMatching(/style grade/i));
  });

  it('is hidden when no style grade is active', () => {
    render(<Toolbar hasImage />);
    expect(screen.queryByText('Styled')).toBeNull();
  });

  it('is hidden without an image even if the flag is set', () => {
    render(<Toolbar hasImage={false} styleGradeActive />);
    expect(screen.queryByText('Styled')).toBeNull();
  });
});
