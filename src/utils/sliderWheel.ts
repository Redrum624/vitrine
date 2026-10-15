/**
 * Mouse-wheel over a range slider: last value wins (v1.40.0 Task 12b).
 *
 * Each notch moves the slider's DISPLAYED value at once (native setter, no events),
 * but the input/change pair that drives the pipeline is dispatched ONCE, on a
 * trailing timer that restarts per notch. A burst of N notches is therefore a
 * single param change carrying the final value (and a single History checkpoint).
 */
export const WHEEL_COMMIT_MS = 120;

/**
 * Pending-wheel registry. Every wheel participant (SliderRow instances and the global
 * fallback handler) registers a flush (commit now) and a cancel (drop). The App flushes
 * all on any pointerdown/keydown (capture) so the final value is never lost to a click or
 * keystroke, and cancels all when the CURRENT IMAGE changes: a wheel preview belongs to
 * the image it happened on and is never silently applied to the next one. (A user-driven
 * switch always starts with a pointerdown/keydown, which already flushed to the right
 * image; cancel only guards programmatic switches.)
 */
interface WheelParticipant { flush(): void; cancel(): void }
const participants = new Set<WheelParticipant>();
export function registerWheelParticipant(p: WheelParticipant): () => void {
  participants.add(p);
  return () => { participants.delete(p); };
}
export function flushAllSliderWheels(): void { [...participants].forEach((p) => p.flush()); }
export function cancelAllSliderWheels(): void { [...participants].forEach((p) => p.cancel()); }

/** One wheel notch applied to `current`, clamped to [min, max] and rounded to `step`'s precision. */
export function nextWheelValue(current: number, deltaY: number, min: number, max: number, step: number): number {
  const st = step || 1;
  const decimals = (String(st).split('.')[1] || '').length;
  let val = current + (deltaY < 0 ? st : -st);
  if (!Number.isNaN(min)) val = Math.max(min, val);
  if (!Number.isNaN(max)) val = Math.min(max, val);
  return decimals ? parseFloat(val.toFixed(decimals)) : val;
}

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

  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    pending = null;
  };
  const onWheel = (e: WheelEvent) => {
    const input = e.target as HTMLInputElement | null;
    if (!input || input.tagName !== 'INPUT' || input.type !== 'range' || input.disabled) return;
    // SliderRow handles its own wheel (local preview state); leave those to it.
    if (input.dataset.sliderRowWheel === 'true') return;
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

  const dispose = registerWheelParticipant({ flush, cancel });
  return { onWheel, flush, dispose };
}
