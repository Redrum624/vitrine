import { render, screen } from '@testing-library/react';
import { IconSidebar } from '../components/Layout/IconSidebar';

describe('IconSidebar rail order', () => {
  it('lists Lens Corrections directly above Enhance', () => {
    render(<IconSidebar selectedTool="basicadj" />);
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    const lens = labels.indexOf('Lens Corrections');
    const enh = labels.indexOf('Enhance');
    expect(lens).toBeGreaterThan(-1);
    expect(enh).toBe(lens + 1);
    expect(labels.indexOf('Tone Curve')).toBe(lens - 1);
  });
});
