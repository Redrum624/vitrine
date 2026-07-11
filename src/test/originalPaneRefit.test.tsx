/**
 * Task P4, item 4: the Before pane (OriginalPane) had no ResizeObserver of its own. A pure
 * pane resize — dragging the before/after split divider without changing zoom/pan (so neither
 * `viewport` nor `mainCanvasFit` updates) — left the pane at its stale fit until the next
 * viewport change. OriginalPane now observes its own element and re-fits on resize.
 *
 * This test installs a capturing ResizeObserver mock (the global setupTests mock never fires
 * its callback) plus a fake 2D canvas context, renders OriginalPane, then fires the observed
 * callback and asserts the pane redraws again (drawImage called a second time).
 */
import { render, act } from '@testing-library/react';
import { OriginalPane } from '../App';
import { imageService } from '../services/ImageService';

type ROCallback = (entries: unknown[], observer: unknown) => void;

interface CapturedRO {
  callback: ROCallback;
  observed: HTMLElement[];
  disconnected: boolean;
}

describe('OriginalPane — re-fits on a pure pane resize (own ResizeObserver)', () => {
  const realRO = global.ResizeObserver;
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  let observers: CapturedRO[] = [];
  let drawImageCalls = 0;

  beforeEach(() => {
    observers = [];
    drawImageCalls = 0;

    // Capturing ResizeObserver: record instances so the test can fire their callbacks.
    global.ResizeObserver = class {
      private rec: CapturedRO;
      constructor(cb: ROCallback) {
        this.rec = { callback: cb, observed: [], disconnected: false };
        observers.push(this.rec);
      }
      observe(el: HTMLElement) { this.rec.observed.push(el); }
      unobserve() { /* no-op */ }
      disconnect() { this.rec.disconnected = true; }
    } as unknown as typeof ResizeObserver;

    // Fake 2D context so both the offscreen build and the pane draw run (jsdom returns null).
    const fakeCtx = {
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
      setTransform: () => {},
      fillRect: () => {},
      drawImage: () => { drawImageCalls++; },
      fillStyle: '',
    };
    HTMLCanvasElement.prototype.getContext = jest.fn(() => fakeCtx) as unknown as typeof realGetContext;

    // Non-zero pane rect so the fit math produces a real content rect.
    HTMLElement.prototype.getBoundingClientRect = jest.fn(() => ({
      width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => {},
    })) as unknown as typeof realRect;

    jest.spyOn(imageService, 'getOriginalImage').mockReturnValue({
      data: new Float32Array([0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1]),
      width: 2,
      height: 2,
    });
  });

  afterEach(() => {
    global.ResizeObserver = realRO;
    HTMLCanvasElement.prototype.getContext = realGetContext;
    HTMLElement.prototype.getBoundingClientRect = realRect;
    jest.restoreAllMocks();
  });

  it('observes its own pane element and re-draws when that element resizes', () => {
    act(() => {
      render(<OriginalPane />);
    });

    // The pane created a ResizeObserver watching its container element.
    expect(observers.length).toBeGreaterThanOrEqual(1);
    const paneRO = observers[observers.length - 1];
    expect(paneRO.observed.length).toBe(1);
    expect(paneRO.observed[0].getAttribute('data-pane-container')).toBe('before');

    const before = drawImageCalls;
    expect(before).toBeGreaterThanOrEqual(1); // initial fit drew once

    // Simulate a divider drag resizing ONLY this pane (no viewport / mainCanvasFit change).
    act(() => {
      paneRO.callback([], paneRO);
    });

    // The pane re-fit and re-drew off its own ResizeObserver.
    expect(drawImageCalls).toBeGreaterThan(before);
  });
});
