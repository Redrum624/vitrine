/**
 * TDD spec for the "Glass · Sectioned" shared Controls library (Task 1 of the
 * glass-ui redesign). These are the four foundation primitives every module
 * card will consume later: SectionLabel, ChipButton, Segmented, SliderRow.
 *
 * Values asserted here come straight from the Glass UI design spec
 * ("Module card system" + "Design Tokens") and 4a Dev Handoff.dc.html (§2, §4).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { SectionLabel } from '../components/Controls/SectionLabel';
import { ChipButton } from '../components/Controls/ChipButton';
import { Segmented } from '../components/Controls/Segmented';
import { SliderRow } from '../components/Controls/SliderRow';
import { AccentButton } from '../components/Controls/AccentButton';

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

  it('gives only the active segment a tab stop (roving tabindex)', () => {
    const onChange = jest.fn();
    render(<Segmented value="luminance" onChange={onChange} options={options} />);

    expect(screen.getByRole('tab', { name: 'Saturation' })).toHaveAttribute('tabIndex', '-1');
    expect(screen.getByRole('tab', { name: 'Luminance' })).toHaveAttribute('tabIndex', '0');
    expect(screen.getByRole('tab', { name: 'Hue' })).toHaveAttribute('tabIndex', '-1');
  });

  it('ArrowRight moves focus to and activates the next segment', () => {
    const onChange = jest.fn();
    render(<Segmented value="saturation" onChange={onChange} options={options} />);

    screen.getByRole('tab', { name: 'Saturation' }).focus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Saturation' }), { key: 'ArrowRight' });

    expect(onChange).toHaveBeenCalledWith('luminance');
    expect(screen.getByRole('tab', { name: 'Luminance' })).toHaveFocus();
  });

  it('ArrowLeft moves focus to and activates the previous segment', () => {
    const onChange = jest.fn();
    render(<Segmented value="luminance" onChange={onChange} options={options} />);

    screen.getByRole('tab', { name: 'Luminance' }).focus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Luminance' }), { key: 'ArrowLeft' });

    expect(onChange).toHaveBeenCalledWith('saturation');
    expect(screen.getByRole('tab', { name: 'Saturation' })).toHaveFocus();
  });

  it('ArrowRight wraps from the last segment to the first', () => {
    const onChange = jest.fn();
    render(<Segmented value="hue" onChange={onChange} options={options} />);

    screen.getByRole('tab', { name: 'Hue' }).focus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Hue' }), { key: 'ArrowRight' });

    expect(onChange).toHaveBeenCalledWith('saturation');
    expect(screen.getByRole('tab', { name: 'Saturation' })).toHaveFocus();
  });

  it('ArrowLeft wraps from the first segment to the last', () => {
    const onChange = jest.fn();
    render(<Segmented value="saturation" onChange={onChange} options={options} />);

    screen.getByRole('tab', { name: 'Saturation' }).focus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Saturation' }), { key: 'ArrowLeft' });

    expect(onChange).toHaveBeenCalledWith('hue');
    expect(screen.getByRole('tab', { name: 'Hue' })).toHaveFocus();
  });

  it('End jumps to and activates the last segment', () => {
    const onChange = jest.fn();
    render(<Segmented value="saturation" onChange={onChange} options={options} />);

    screen.getByRole('tab', { name: 'Saturation' }).focus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Saturation' }), { key: 'End' });

    expect(onChange).toHaveBeenCalledWith('hue');
    expect(screen.getByRole('tab', { name: 'Hue' })).toHaveFocus();
  });

  it('Home jumps to and activates the first segment', () => {
    const onChange = jest.fn();
    render(<Segmented value="hue" onChange={onChange} options={options} />);

    screen.getByRole('tab', { name: 'Hue' }).focus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Hue' }), { key: 'Home' });

    expect(onChange).toHaveBeenCalledWith('saturation');
    expect(screen.getByRole('tab', { name: 'Saturation' })).toHaveFocus();
  });

  it('leaves mouse click activation unchanged (no focus trap, no keydown needed)', () => {
    const onChange = jest.fn();
    render(<Segmented value="saturation" onChange={onChange} options={options} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Hue' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('hue');
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

  it('positions the detent line at the default\'s fractional offset (not centred for an asymmetric default)', () => {
    // Temperature default 6500 in [2000, 10000] → (6500-2000)/(10000-2000) = 56.25%.
    const { container } = render(
      <SliderRow label="Temperature" value={5900} defaultValue={6500} min={2000} max={10000} onChange={() => {}} />
    );
    const detent = container.querySelector('[data-detent="true"]');
    expect(detent).toBeInTheDocument();
    expect(detent).toHaveStyle({ left: '56.25%' });
    // Sanity: an asymmetric default is NOT at the 50% centre.
    expect(detent).not.toHaveStyle({ left: '50%' });
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

  it('omits the legend row entirely when no legend prop is supplied', () => {
    const { container } = render(
      <SliderRow label="Exposure" value={0} defaultValue={0} min={-2} max={2} step={0.05} onChange={() => {}} />
    );
    // The row has exactly two children (label/chip row + track); the optional legend
    // row is absent, so no third row is rendered.
    expect((container.firstChild as HTMLElement).childElementCount).toBe(2);
    // And none of the legend labels leak in from another slider.
    expect(screen.queryByText('Cool')).toBeNull();
    expect(screen.queryByText('Warm')).toBeNull();
  });

  describe('drag lifecycle hooks (onDragStart / onDragEnd)', () => {
    it('fires onDragStart on mouse-down/touch-start and onDragEnd on mouse-up/leave/touch-end', () => {
      const onDragStart = jest.fn();
      const onDragEnd = jest.fn();
      render(
        <SliderRow
          label="Rotation"
          value={0}
          defaultValue={0}
          min={-5}
          max={5}
          step={0.1}
          onChange={() => {}}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      );
      const input = screen.getByLabelText('Rotation');
      fireEvent.mouseDown(input);
      expect(onDragStart).toHaveBeenCalledTimes(1);
      fireEvent.mouseUp(input);
      expect(onDragEnd).toHaveBeenCalledTimes(1);
      fireEvent.touchStart(input);
      expect(onDragStart).toHaveBeenCalledTimes(2);
      fireEvent.touchEnd(input);
      expect(onDragEnd).toHaveBeenCalledTimes(2);
    });

    it('omitting the drag hooks is harmless (most sliders do not need them)', () => {
      render(
        <SliderRow label="Exposure" value={0} defaultValue={0} min={-2} max={2} step={0.05} onChange={() => {}} />
      );
      const input = screen.getByLabelText('Exposure');
      expect(() => {
        fireEvent.mouseDown(input);
        fireEvent.mouseUp(input);
      }).not.toThrow();
    });
  });

  describe('click-to-edit value chip', () => {
    it('turns the value chip into a numeric input on click, seeded with the raw value', () => {
      render(
        <SliderRow label="Exposure" value={0.35} defaultValue={0} min={-2} max={2} step={0.01} onChange={() => {}} />
      );
      fireEvent.click(screen.getByText('0.35'));
      expect(screen.getByRole('spinbutton')).toHaveValue(0.35);
    });

    it('commits the typed value via onChange on Enter and exits edit mode', () => {
      const onChange = jest.fn();
      render(
        <SliderRow label="Exposure" value={0} defaultValue={0} min={-2} max={2} step={0.01} onChange={onChange} />
      );
      fireEvent.click(screen.getByText('0'));
      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '1.2' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledWith(1.2);
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    });

    it('commits the typed value via onChange on blur', () => {
      const onChange = jest.fn();
      render(<SliderRow label="Tint" value={0} defaultValue={0} min={-100} max={100} onChange={onChange} />);
      fireEvent.click(screen.getByText('0'));
      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '42' } });
      fireEvent.blur(input);
      expect(onChange).toHaveBeenCalledWith(42);
    });

    it('cancels the edit on Escape without calling onChange, reverting to the chip', () => {
      const onChange = jest.fn();
      render(
        <SliderRow label="Exposure" value={0.5} defaultValue={0} min={-2} max={2} step={0.01} onChange={onChange} />
      );
      fireEvent.click(screen.getByText('0.5'));
      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '99' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
      expect(screen.getByText('0.5')).toBeInTheDocument();
    });

    it('clamps the committed value to the min/max range', () => {
      const onChange = jest.fn();
      render(
        <SliderRow label="Exposure" value={0} defaultValue={0} min={-2} max={2} step={0.01} onChange={onChange} />
      );
      fireEvent.click(screen.getByText('0'));
      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '50' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledWith(2);
    });

    it('typingStep gives typed entry finer precision than the drag step (Saturation/Vibrance/Dehaze)', () => {
      const onChange = jest.fn();
      render(
        <SliderRow
          label="Saturation"
          value={0}
          defaultValue={0}
          min={-1}
          max={1}
          step={0.05}
          typingStep={0.01}
          onChange={onChange}
        />
      );
      fireEvent.click(screen.getByText('0'));
      const input = screen.getByRole('spinbutton');
      // Typed entry snaps to the finer typingStep (0.01), not the coarser drag step (0.05).
      expect(input).toHaveAttribute('step', '0.01');
      fireEvent.change(input, { target: { value: '0.33' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledWith(0.33);
    });

    it('defaults typingStep to step when omitted (no behavior change for existing consumers)', () => {
      const onChange = jest.fn();
      render(
        <SliderRow label="Exposure" value={0} defaultValue={0} min={-2} max={2} step={0.01} onChange={onChange} />
      );
      const input = screen.queryByRole('spinbutton');
      expect(input).not.toBeInTheDocument();
      fireEvent.click(screen.getByText('0'));
      expect(screen.getByRole('spinbutton')).toHaveAttribute('step', '0.01');
    });
  });
});

// Glass Modals (Task 2): the shared solid-accent modal-footer primary,
// extracted from 3 inlined copies in ExportDialog/BatchProcessingDialog/
// ImageSizeDialog (see src/components/Controls/AccentButton.tsx).
describe('AccentButton', () => {
  it('renders its children and fires onClick when enabled', () => {
    const onClick = jest.fn();
    render(<AccentButton onClick={onClick}>Export</AccentButton>);
    const btn = screen.getByRole('button', { name: 'Export' });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('carries the shared solid-accent primary look', () => {
    render(<AccentButton onClick={() => {}}>Apply</AccentButton>);
    const btn = screen.getByRole('button', { name: 'Apply' });
    expect(btn).toHaveClass('glass-modal-btn-primary');
    expect(btn).toHaveStyle({ borderRadius: '11px', fontSize: '12.5px', fontWeight: '700' });
  });

  it('is disabled and does not fire onClick when disabled is set', () => {
    const onClick = jest.fn();
    render(
      <AccentButton onClick={onClick} disabled>
        Export
      </AccentButton>
    );
    const btn = screen.getByRole('button', { name: 'Export' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('stretches full-width when fullWidth is set', () => {
    render(
      <AccentButton onClick={() => {}} fullWidth>
        Create and Start Batch Job
      </AccentButton>
    );
    expect(screen.getByRole('button', { name: 'Create and Start Batch Job' })).toHaveClass('w-full');
  });
});
