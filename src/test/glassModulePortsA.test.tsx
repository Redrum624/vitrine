/**
 * Task 3 (batch A — tone & color modules) port checks: each module renders its
 * §4 section groupings through the shared Glass · Sectioned controls
 * (SliderRow / SectionLabel / ChipButton / Segmented) instead of the old
 * bespoke markup, and keeps the same params/onParamsChange behavior.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { WhiteBalanceModule } from '../modules/WhiteBalanceModule';
import { ColorBalanceModule } from '../modules/ColorBalanceModule';
import { ToneCurveModule } from '../modules/ToneCurveModule';
import { BasicAdjustmentsModuleComponent } from '../components/Modules/BasicAdjustmentsModuleComponent';
import { WhiteBalanceModuleComponent } from '../components/Modules/WhiteBalanceModuleComponent';
import { ColorBalanceModuleComponent } from '../components/Modules/ColorBalanceModuleComponent';
import { ToneCurveModuleComponent } from '../components/Modules/ToneCurveModuleComponent';

describe('BasicAdjustmentsModuleComponent — glass port', () => {
  it('renders the TONE / PRESENCE / COLOR sections in spec order with SliderRow sliders', () => {
    const module = new BasicAdjustmentsModule();
    module.setParams({ exposure: 0.35 });
    render(<BasicAdjustmentsModuleComponent module={module} onParamsChange={() => {}} />);

    const sections = screen.getAllByText(/^(Masks|Tone|Presence|Color)$/);
    expect(sections.map((el) => el.textContent)).toEqual(['Masks', 'Tone', 'Presence', 'Color']);

    // Exposure (TONE) is edited — its SliderRow value chip carries data-edited.
    const exposureInput = screen.getByLabelText('Exposure');
    expect(exposureInput).toHaveAttribute('aria-valuenow', '0.35');
    expect(screen.getByText('+0.35')).toHaveAttribute('data-edited', 'true');

    // The other TONE sliders sit at their neutral default — idle chips only.
    const idleChips = screen.getAllByText('0.00');
    expect(idleChips.length).toBeGreaterThan(0);
    idleChips.forEach((chip) => expect(chip).not.toHaveAttribute('data-edited'));
  });

  it('routes a slider change through onParamsChange with the same param key', () => {
    jest.useFakeTimers();
    const module = new BasicAdjustmentsModule();
    const onParamsChange = jest.fn();
    render(<BasicAdjustmentsModuleComponent module={module} onParamsChange={onParamsChange} />);
    fireEvent.change(screen.getByLabelText('Dehaze'), { target: { value: '0.4' } });
    // BasicAdjustments throttles the module/onParamsChange update by ~16ms.
    jest.advanceTimersByTime(20);
    expect(module.getParams().dehaze).toBeCloseTo(0.4);
    expect(onParamsChange).toHaveBeenCalledWith(expect.objectContaining({ dehaze: 0.4 }));
    jest.useRealTimers();
  });
});

describe('WhiteBalanceModuleComponent — glass port', () => {
  it('renders PRESET chips and CAST sliders, and activates a preset on click', () => {
    const module = new WhiteBalanceModule();
    const onParamsChange = jest.fn();
    render(<WhiteBalanceModuleComponent module={module} onParamsChange={onParamsChange} />);

    expect(screen.getByText('Preset')).toBeInTheDocument();
    expect(screen.getByText('Cast')).toBeInTheDocument();
    expect(screen.getByLabelText('Temperature')).toBeInTheDocument();
    expect(screen.getByLabelText('Tint')).toBeInTheDocument();

    const cloudyChip = screen.getByRole('button', { name: 'Cloudy' });
    expect(cloudyChip).not.toHaveAttribute('data-active');
    fireEvent.click(cloudyChip);
    expect(cloudyChip).toHaveAttribute('data-active', 'true');
    expect(module.getParams().preset).toBe('cloudy');
  });
});

describe('ColorBalanceModuleComponent — glass port', () => {
  it('switches the global sub-tab segmented control and keeps the mode segmented reachable', () => {
    const module = new ColorBalanceModule();
    const onParamsChange = jest.fn();
    render(<ColorBalanceModuleComponent module={module} onParamsChange={onParamsChange} />);

    expect(screen.getByText('Mixer')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Saturation' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: 'Luminance' }));
    expect(screen.getByRole('tab', { name: 'Luminance' })).toHaveAttribute('aria-selected', 'true');

    // Mode segmented (Global/Traditional) stays reachable and swaps to the wheel section.
    fireEvent.click(screen.getByRole('tab', { name: 'Traditional' }));
    expect(screen.getByText('Wheel')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Midtones' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('ToneCurveModuleComponent — glass port', () => {
  it('renders the channel segmented control and preset chips', () => {
    const module = new ToneCurveModule();
    const onParamsChange = jest.fn();
    render(<ToneCurveModuleComponent module={module} onParamsChange={onParamsChange} />);

    expect(screen.getByRole('tab', { name: 'RGB' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'R' })).toBeInTheDocument();

    const filmChip = screen.getByRole('button', { name: 'Film' });
    fireEvent.click(filmChip);
    expect(onParamsChange).toHaveBeenCalled();
  });
});
