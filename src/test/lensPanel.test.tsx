/**
 * Mount-smoke + wiring tests for the Blur + Film Grain sections added to the
 * Lens Corrections panel.
 *
 * These exercise the real React render path (which tsc/build cannot) and confirm
 * the checkbox callbacks reach the module + the onChange props.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { LensCorrectionsModule } from '../modules/LensCorrectionsModule';
import { LensCorrectionsModuleComponent } from '../components/Modules/LensCorrectionsModuleComponent';

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
