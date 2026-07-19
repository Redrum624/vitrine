/**
 * Mount-smoke + wiring tests for the Blur + Film Grain sections added to the
 * Lens Corrections panel.
 *
 * These exercise the real React render path (which tsc/build cannot) and confirm
 * value changes reach the module + the onChange props. v1.32.0 removed the
 * per-section enable checkboxes — activation now derives from values (see
 * lensCorrectionsNoCheckboxes.test.tsx), so Blur is activated via its slider.
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

    // No enable checkboxes anymore (v1.32.0) — a non-zero Radius activates Blur.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    const radius = screen.getByLabelText('Radius') as HTMLInputElement;
    fireEvent.change(radius, { target: { value: '2' } });

    expect(onParametersChange).toHaveBeenCalled();
    const calls = onParametersChange.mock.calls;
    const partial = calls[calls.length - 1][0] as { blur?: { enabled?: boolean; radius?: number } };
    expect(partial.blur?.enabled).toBe(true);
    expect(partial.blur?.radius).toBe(2);
  });
});
