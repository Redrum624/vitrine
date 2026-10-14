/** v1.40.0 Task 12b: a wheel burst is ONE param change with the final value. */
import { createSliderWheelHandler } from '../utils/sliderWheel';

function makeSlider() {
  const input = document.createElement('input');
  input.type = 'range'; input.min = '-100'; input.max = '100'; input.step = '1'; input.value = '0';
  document.body.appendChild(input);
  return input;
}
const notch = (input: HTMLInputElement, h: ReturnType<typeof createSliderWheelHandler>, deltaY = -100) => {
  const e = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
  Object.defineProperty(e, 'target', { value: input });
  h.onWheel(e);
};

describe('slider wheel coalescing', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.useRealTimers(); document.body.innerHTML = ''; });

  test('8 notches 40ms apart => one input+change dispatch with the final value; display updates per notch', () => {
    const h = createSliderWheelHandler();
    const input = makeSlider();
    const inputs: string[] = [];
    const changes: string[] = [];
    input.addEventListener('input', () => inputs.push(input.value));
    input.addEventListener('change', () => changes.push(input.value));
    for (let i = 1; i <= 8; i++) {
      notch(input, h);
      expect(input.value).toBe(String(i)); // displayed value follows each notch
      jest.advanceTimersByTime(40);
    }
    expect(inputs).toEqual([]); // still inside the trailing window
    jest.advanceTimersByTime(200);
    expect(inputs).toEqual(['8']);
    expect(changes).toEqual(['8']);
  });

  test('flush (blur/unmount) commits a pending value immediately, once', () => {
    const h = createSliderWheelHandler();
    const input = makeSlider();
    const inputs: string[] = [];
    input.addEventListener('input', () => inputs.push(input.value));
    notch(input, h); notch(input, h, 100);notch(input, h, 100);
    h.flush();
    h.flush();
    jest.advanceTimersByTime(500);
    expect(inputs).toEqual(['-1']);
  });

  test('switching sliders flushes the previous one', () => {
    const h = createSliderWheelHandler();
    const a = makeSlider(); const b = makeSlider();
    const seen: string[] = [];
    a.addEventListener('input', () => seen.push('a'));
    b.addEventListener('input', () => seen.push('b'));
    notch(a, h); notch(b, h);
    jest.advanceTimersByTime(500);
    expect(seen).toEqual(['a', 'b']);
  });
});
