/**
 * Mouse-wheel over a range slider: last value wins (v1.40.0 Task 12b).
 *
 * Each notch moves the slider's DISPLAYED value at once (native setter, no events),
 * but the input/change pair that drives the pipeline is dispatched ONCE, on a
 * trailing timer that restarts per notch. A burst of N notches is therefore a
 * single param change carrying the final value (and a single History checkpoint).
 */
export const WHEEL_COMMIT_MS = 120;

export function createSliderWheelHandler(commitMs: number = WHEEL_COMMIT_MS) {
  let pending: HTMLInputElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    const input = pending;
    pending = null;
    if (!input || !input.isConnected) return;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const onWheel = (e: WheelEvent) => {
    const input = e.target as HTMLInputElement | null;
    if (!input || input.tagName !== 'INPUT' || input.type !== 'range' || input.disabled) return;
    e.preventDefault();
    if (pending && pending !== input) flush();
    const step = parseFloat(input.step) || 1;
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const decimals = (input.step.split('.')[1] || '').length;
    // Accumulates: input.value already holds the previous notch's target.
    let val = (parseFloat(input.value) || 0) + (e.deltaY < 0 ? step : -step);
    if (!Number.isNaN(min)) val = Math.max(min, val);
    if (!Number.isNaN(max)) val = Math.min(max, val);
    const next = decimals ? val.toFixed(decimals) : String(val);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, next);
    pending = input;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, commitMs);
  };

  return { onWheel, flush };
}
