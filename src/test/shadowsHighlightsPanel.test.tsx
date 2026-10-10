/**
 * Shadows & Highlights was the last module panel still on the pre-Safelight hand-built
 * sliders. It now uses the shared controls; these tests pin that the controls are the shared
 * ones, the sections switch, edits reach the module, and the boolean toggles stay booleans.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { ShadowsHighlightsModuleComponent } from '../components/Modules/ShadowsHighlightsModuleComponent';
import { ShadowsHighlightsModule } from '../modules/ShadowsHighlightsModule';

jest.mock('../services/ImageService', () => ({ imageService: { getCurrentImage: jest.fn(() => null) } }));
jest.mock('../services/NotificationService', () => ({ notificationService: { info: jest.fn() } }));

describe('ShadowsHighlightsModuleComponent', () => {
  it('renders shared SliderRows and a Segmented section switch', () => {
    render(<ShadowsHighlightsModuleComponent module={new ShadowsHighlightsModule()} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Shadows' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('slider', { name: 'Amount' })).toHaveValue('50');
    expect(screen.getByRole('slider', { name: 'Color transfer' })).toBeInTheDocument();
  });

  it('sends slider edits straight to the module', () => {
    const module = new ShadowsHighlightsModule();
    const onParamsChange = jest.fn();
    render(<ShadowsHighlightsModuleComponent module={module} onParamsChange={onParamsChange} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Amount' }), { target: { value: '72' } });
    expect(module.getParams().shadows).toBe(72);
    expect(onParamsChange).toHaveBeenLastCalledWith(expect.objectContaining({ shadows: 72 }));
  });

  it('shows the advanced controls and keeps toggles boolean', () => {
    const module = new ShadowsHighlightsModule();
    render(<ShadowsHighlightsModuleComponent module={module} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }));
    expect(screen.getByRole('slider', { name: 'White point' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bilateral filter' }));
    expect(module.getParams().bilateralFilter).toBe(true);
  });
});
