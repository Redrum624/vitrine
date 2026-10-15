/** v1.40.0 Task 12b fix round 1: SliderRow owns its wheel (local preview, one onChange per burst). */
import { render, screen, act, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { SliderRow } from '../components/Controls/SliderRow';
import { cancelAllSliderWheels, flushAllSliderWheels } from '../utils/sliderWheel';

const wheelOn = (el: HTMLElement, deltaY = -100) =>
  el.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));

function Harness({ onChange }: { onChange: (v: number) => void }) {
  const [v, setV] = useState(0);
  return <SliderRow label="Exposure" value={v} defaultValue={0} min={-100} max={100} step={1}
    onChange={(n) => { onChange(n); setV(n); }} />;
}

describe('SliderRow wheel', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { cleanup(); jest.useRealTimers(); });

  test('label, aria and input follow every notch; one onChange per burst with the final value', () => {
    const onChange = jest.fn();
    const { container, rerender } = render(<Harness onChange={onChange} />);
    const input = container.querySelector('input[type=range]') as HTMLInputElement;
    for (let i = 1; i <= 8; i++) {
      act(() => { wheelOn(input); });
      expect(screen.getByTitle('Click to type a value').textContent).toBe(String(i));
      expect(input.getAttribute('aria-valuenow')).toBe(String(i));
      expect(input.value).toBe(String(i));
      // A parent re-render mid-burst must not reset the accumulated value.
      rerender(<Harness onChange={onChange} />);
      expect(screen.getByTitle('Click to type a value').textContent).toBe(String(i));
      act(() => { jest.advanceTimersByTime(40); });
    }
    expect(onChange).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(200); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(8);
    expect(screen.getByTitle('Click to type a value').textContent).toBe('8');
  });

  test('flushAll (pointerdown/keydown) commits the pending value once', () => {
    const onChange = jest.fn();
    const { container } = render(<Harness onChange={onChange} />);
    const input = container.querySelector('input[type=range]') as HTMLInputElement;
    act(() => { wheelOn(input); wheelOn(input); });
    act(() => { flushAllSliderWheels(); });
    act(() => { jest.advanceTimersByTime(500); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(2);
  });

  test('panel switch (unmount) commits the final value', () => {
    const onChange = jest.fn();
    const { container, unmount } = render(<Harness onChange={onChange} />);
    const input = container.querySelector('input[type=range]') as HTMLInputElement;
    act(() => { wheelOn(input); wheelOn(input); wheelOn(input); });
    unmount();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(3);
  });

  test('image switch cancels the pending preview: never applied to the new image', () => {
    const onChange = jest.fn();
    const { container } = render(<Harness onChange={onChange} />);
    const input = container.querySelector('input[type=range]') as HTMLInputElement;
    act(() => { wheelOn(input); });
    act(() => { cancelAllSliderWheels(); });
    act(() => { jest.advanceTimersByTime(500); });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTitle('Click to type a value').textContent).toBe('0');
  });
});
