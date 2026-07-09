/**
 * TDD spec for the "Glass · Sectioned" shared Controls library (Task 1 of the
 * glass-ui redesign). These are the four foundation primitives every module
 * card will consume later: SectionLabel, ChipButton, Segmented, SliderRow.
 *
 * Values asserted here come straight from design_handoff_glass_ui/README.md
 * ("Module card system" + "Design Tokens") and 4a Dev Handoff.dc.html (§2, §4).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { SectionLabel } from '../components/Controls/SectionLabel';
import { ChipButton } from '../components/Controls/ChipButton';
import { Segmented } from '../components/Controls/Segmented';
import { SliderRow } from '../components/Controls/SliderRow';

describe('SectionLabel', () => {
  it('renders the label text in accent color with the fading hairline', () => {
    render(<SectionLabel>Preset</SectionLabel>);
    const el = screen.getByText('Preset');
    expect(el).toBeInTheDocument();
    expect(el).toHaveStyle({ color: 'var(--accent)' });
  });
});

describe('ChipButton', () => {
  it('renders idle by default and fires onClick', () => {
    const onClick = jest.fn();
    render(<ChipButton onClick={onClick}>Custom</ChipButton>);
    const btn = screen.getByRole('button', { name: 'Custom' });
    expect(btn).not.toHaveAttribute('data-active');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows the accent-soft/ring/text look when active', () => {
    render(<ChipButton active>Cloudy</ChipButton>);
    const btn = screen.getByRole('button', { name: 'Cloudy' });
    expect(btn).toHaveAttribute('data-active', 'true');
    expect(btn).toHaveStyle({
      background: 'var(--accent-soft)',
      borderColor: 'var(--accent-ring)',
      color: 'var(--accent)',
    });
  });

  it('supports a dashed variant whose border turns solid on hover', () => {
    render(<ChipButton dashed>Gallery</ChipButton>);
    const btn = screen.getByRole('button', { name: 'Gallery' });
    expect(btn.style.borderStyle).toBe('dashed');
    fireEvent.mouseEnter(btn);
    expect(btn.style.borderStyle).toBe('solid');
    fireEvent.mouseLeave(btn);
    expect(btn.style.borderStyle).toBe('dashed');
  });
});

describe('Segmented', () => {
  const options = [
    { value: 'saturation', label: 'Saturation' },
    { value: 'luminance', label: 'Luminance' },
    { value: 'hue', label: 'Hue' },
  ];

  it('marks the active option and calls onChange when another is clicked', () => {
    const onChange = jest.fn();
    render(<Segmented value="saturation" onChange={onChange} options={options} />);

    expect(screen.getByRole('tab', { name: 'Saturation' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Luminance' })).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(screen.getByRole('tab', { name: 'Luminance' }));
    expect(onChange).toHaveBeenCalledWith('luminance');
  });
});

describe('SliderRow', () => {
  it('associates the label with the range input', () => {
    render(
      <SliderRow label="Exposure" value={0} defaultValue={0} min={-2} max={2} step={0.05} onChange={() => {}} />
    );
    expect(screen.getByLabelText('Exposure')).toBeInTheDocument();
  });

  it('shows the idle value chip when value equals default', () => {
    render(<SliderRow label="Tint" value={0} defaultValue={0} min={-100} max={100} onChange={() => {}} />);
    const chip = screen.getByText('0');
    expect(chip).not.toHaveAttribute('data-edited');
    expect(chip).toHaveStyle({ background: 'rgba(255,255,255,.04)' });
  });

  it('shows the edited accent chip when the value diverges from default', () => {
    render(
      <SliderRow
        label="Exposure"
        value={0.35}
        defaultValue={0}
        min={-2}
        max={2}
        step={0.05}
        onChange={() => {}}
        formatValue={(v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2))}
      />
    );
    const chip = screen.getByText('+0.35');
    expect(chip).toHaveAttribute('data-edited', 'true');
    expect(chip).toHaveStyle({ background: 'var(--accent-soft)' });
  });

  it('fires onChange with a parsed number when the slider input changes', () => {
    const onChange = jest.fn();
    render(
      <SliderRow label="Exposure" value={0} defaultValue={0} min={-2} max={2} step={0.05} onChange={onChange} />
    );
    fireEvent.change(screen.getByLabelText('Exposure'), { target: { value: '1.2' } });
    expect(onChange).toHaveBeenCalledWith(1.2);
  });

  it('resets to the default value on double-click', () => {
    const onChange = jest.fn();
    render(
      <SliderRow label="Exposure" value={0.8} defaultValue={0} min={-2} max={2} step={0.05} onChange={onChange} />
    );
    fireEvent.doubleClick(screen.getByLabelText('Exposure'));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('renders a center detent line when the default sits inside the range', () => {
    const { container } = render(
      <SliderRow label="Temperature" value={5900} defaultValue={6500} min={2000} max={10000} onChange={() => {}} />
    );
    expect(container.querySelector('[data-detent="true"]')).toBeInTheDocument();
  });

  it('omits the detent line when the default is at the range boundary', () => {
    const { container } = render(
      <SliderRow label="Dehaze" value={20} defaultValue={0} min={0} max={100} onChange={() => {}} />
    );
    expect(container.querySelector('[data-detent="true"]')).not.toBeInTheDocument();
  });

  it('renders an optional legend row', () => {
    render(
      <SliderRow
        label="Temperature"
        value={5900}
        defaultValue={6500}
        min={2000}
        max={10000}
        onChange={() => {}}
        legend={{ left: 'Cool', center: 'Neutral', right: 'Warm' }}
      />
    );
    expect(screen.getByText('Cool')).toBeInTheDocument();
    expect(screen.getByText('Neutral')).toBeInTheDocument();
    expect(screen.getByText('Warm')).toBeInTheDocument();
  });
});
