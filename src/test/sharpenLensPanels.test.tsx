/**
 * Mount-smoke + wiring tests for the two UI surfaces added/changed in this work:
 *  - the new Sharpen develop panel (sidebar, under Noise Reduction)
 *  - the Blur + Film Grain sections added to the Lens Corrections panel
 *
 * These exercise the real React render path (which tsc/build cannot) and confirm
 * the slider/checkbox callbacks reach the module + the onChange props.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { SharpenModule } from '../modules/SharpenModule';
import { SharpenModuleComponent } from '../components/Modules/SharpenModuleComponent';
import { LensCorrectionsModule } from '../modules/LensCorrectionsModule';
import { LensCorrectionsModuleComponent } from '../components/Modules/LensCorrectionsModuleComponent';

describe('SharpenModuleComponent', () => {
  it('mounts and live-updates the module + reports changes when a slider moves', () => {
    const module = new SharpenModule();
    const onParamsChange = jest.fn();
    render(<SharpenModuleComponent module={module} onParamsChange={onParamsChange} />);

    expect(screen.getByText('Sharpen')).toBeInTheDocument();

    const sliders = screen.getAllByRole('slider'); // [amount, radius, detail]
    expect(sliders).toHaveLength(3);

    fireEvent.input(sliders[0], { target: { value: '100' } });

    expect(onParamsChange).toHaveBeenCalled();
    const p = module.getParams();
    expect(p.amount).toBe(100);
    expect(p.enabled).toBe(true);
    expect(module.isIdentity()).toBe(false);
  });
});

describe('LensCorrectionsModuleComponent — Blur + Film Grain', () => {
  it('renders the Blur and Film Grain sections and toggling Blur reports it', () => {
    const defaults = new LensCorrectionsModule().getParams();
    const onParametersChange = jest.fn();
    render(
      <LensCorrectionsModuleComponent
        parameters={defaults}
        onParametersChange={onParametersChange}
        onResetSection={() => {}}
      />
    );

    expect(screen.getByText('Blur')).toBeInTheDocument();
    expect(screen.getByText('Film Grain')).toBeInTheDocument();

    // One enable checkbox per section, in order:
    // Distortion, Vignetting, Chromatic Aberration, Blur, Film Grain.
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(5);

    fireEvent.click(checkboxes[3]); // Blur

    expect(onParametersChange).toHaveBeenCalled();
    const calls = onParametersChange.mock.calls;
    const partial = calls[calls.length - 1][0] as { blur?: { enabled?: boolean } };
    expect(partial.blur?.enabled).toBe(true);
  });
});
