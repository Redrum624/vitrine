/**
 * Lens Corrections without enable checkboxes (v1.32.0, user request): a
 * section is active exactly when its values are non-neutral. Contract:
 *  - no checkboxes render in the panel
 *  - a non-zero value change propagates `enabled: true` for its section
 *  - returning the value to neutral propagates `enabled: false`
 *  - sliders are interactive without any prior "arming"
 */
import { render, fireEvent } from '@testing-library/react';
import { LensCorrectionsModuleComponent } from '../components/Modules/LensCorrectionsModuleComponent';
import type { LensCorrectionsParams } from '../modules/LensCorrectionsModule';

const neutralParams = (): LensCorrectionsParams => ({
  vignetting: { enabled: false, amount: 0, midpoint: 1, roundness: 0, feather: 50 },
  distortion: { enabled: false, barrel: 0, perspective: { horizontal: 0, vertical: 0 }, scale: 1 },
  chromaticAberration: {
    enabled: false, redCyan: 0, blueMagenta: 0,
    purple: { amount: 0, hue: 300, range: 10 },
    green: { amount: 0, hue: 60, range: 10 },
  },
  profile: { enabled: false, autoDetect: true, profileName: '', strength: 100 },
  blur: { enabled: false, radius: 0 },
  filmGrain: { enabled: false, amount: 0, size: 1 },
} as unknown as LensCorrectionsParams);

const sliderByLabel = (container: HTMLElement, label: string): HTMLInputElement => {
  const span = Array.from(container.querySelectorAll('*')).find(
    (el) => el.textContent === label && el.children.length === 0,
  );
  const row = span?.closest('div')?.parentElement ?? span?.closest('div');
  const input = row?.querySelector('input[type="range"]');
  if (!input) throw new Error(`no slider for ${label}`);
  return input as HTMLInputElement;
};

describe('LensCorrectionsModuleComponent — value-derived activation', () => {
  test('renders NO checkboxes', () => {
    const { container } = render(
      <LensCorrectionsModuleComponent parameters={neutralParams()} onParametersChange={jest.fn()} />,
    );
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(0);
  });

  test('non-zero vignetting amount propagates enabled=true; back to 0 disables', () => {
    const onChange = jest.fn();
    const { container } = render(
      <LensCorrectionsModuleComponent parameters={neutralParams()} onParametersChange={onChange} />,
    );
    const amount = sliderByLabel(container, 'Amount');
    fireEvent.change(amount, { target: { value: '40' } });
    const first = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(first.vignetting.amount).toBe(40);
    expect(first.vignetting.enabled).toBe(true);

    fireEvent.change(amount, { target: { value: '0' } });
    const second = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(second.vignetting.amount).toBe(0);
    expect(second.vignetting.enabled).toBe(false);
  });

  test('blur radius > 0 activates the blur section', () => {
    const onChange = jest.fn();
    const { container } = render(
      <LensCorrectionsModuleComponent parameters={neutralParams()} onParametersChange={onChange} />,
    );
    const radius = sliderByLabel(container, 'Radius');
    fireEvent.change(radius, { target: { value: '3' } });
    const call = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(call.blur.enabled).toBe(true);
  });

  test('sliders are interactive with everything neutral (no arming required)', () => {
    const onChange = jest.fn();
    const { container } = render(
      <LensCorrectionsModuleComponent parameters={neutralParams()} onParametersChange={onChange} />,
    );
    const barrel = sliderByLabel(container, 'Barrel / Pincushion');
    fireEvent.change(barrel, { target: { value: '-20' } });
    expect(onChange).toHaveBeenCalled();
    const call = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(call.distortion.barrel).toBe(-20);
    expect(call.distortion.enabled).toBe(true);
  });
});
