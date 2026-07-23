/**
 * Filmstrip selection centering (v1.37.0, user request: "the thumbnail strip
 * needs to put the active photo in the middle except when using the mouse's
 * wheel to navigate"):
 *
 *  - EVERY selection change centers the active tile in the strip (the old
 *    effect only scrolled when the tile was fully OUTSIDE the container, so
 *    arrow/chevron/click navigation left the active thumb riding the edge).
 *  - Centering uses manual scrollTo math (scrollIntoView's vertical `block`
 *    default can scroll ancestors; the strip is horizontal) and must handle
 *    the variable aspect-based tile widths (dockThumbWidth 56-132).
 *  - Hybrid scroll behavior: isolated selection changes glide ('smooth');
 *    changes arriving < RAPID_NAV_MS apart (held arrow key) jump ('auto') so
 *    the strip never trails a perpetually re-targeted animation.
 *  - Wheel-panning NEVER centers: the wheel handler only pans scrollLeft, and
 *    a selection change landing while the wheel is active (trailing
 *    WHEEL_IDLE_MS window) is suppressed entirely.
 */
import { render, act } from '@testing-library/react';
import { useAppStore } from '../stores/appStore';
import { ThumbnailPanel, RAPID_NAV_MS, WHEEL_IDLE_MS } from '../components/Panels/ThumbnailPanel';
import type { ImageFileInfo } from '../services/FileSystemService';

const mkImg = (n: number) => ({
  id: `img${n}`, path: `/p/${n}.jpg`, name: `${n}.jpg`, size: 100,
  format: 'JPG', type: 'image/jpeg', lastModified: 0, dateModified: new Date(0),
}) as unknown as ImageFileInfo;
const images = [1, 2, 3, 4, 5].map(mkImg);

/** Mocked strip geometry — variable tile widths, offsets container-relative
 * (the component makes the scroll container the tiles' offsetParent). */
const CONTAINER_WIDTH = 640;
const TILE: Record<string, { left: number; width: number }> = {
  img1: { left: 0, width: 100 },
  img2: { left: 108, width: 60 },   // portrait — narrow tile
  img3: { left: 500, width: 132 },  // wide landscape tile
  img4: { left: 900, width: 100 },
  img5: { left: 1200, width: 114 },
};
const centerLeftFor = (id: string) =>
  TILE[id].left - (CONTAINER_WIDTH - TILE[id].width) / 2;

interface ScrollCall { left?: number; behavior?: string; onStrip: boolean }
let scrollCalls: ScrollCall[];

const strip = (): HTMLElement => {
  const el = document.querySelector('.overflow-x-auto');
  if (!el) throw new Error('strip container not rendered');
  return el as HTMLElement;
};

let origOffsetLeft: PropertyDescriptor | undefined;
let origOffsetWidth: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeEach(() => {
  scrollCalls = [];
  useAppStore.setState({
    ratingFilter: 0,
    imageRatings: {},
    selectedImageIds: [],
    selectionAnchorId: null,
    alignmentAxisX: null,
  });
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    readImageAsDataURL: jest.fn().mockResolvedValue(null),
    readImageRating: jest.fn().mockResolvedValue(null),
  };
  // jsdom has no layout: serve tile offsets/widths from the TILE map and give
  // the scroll container (the only clientWidth reader) a fixed width.
  origOffsetLeft = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft');
  origOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  origClientWidth = Object.getOwnPropertyDescriptor(window.Element.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
    configurable: true,
    get(this: HTMLElement) {
      const id = this.getAttribute?.('data-image-id');
      return id && TILE[id] ? TILE[id].left : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      const id = this.getAttribute?.('data-image-id');
      return id && TILE[id] ? TILE[id].width : 0;
    },
  });
  Object.defineProperty(window.Element.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains('overflow-x-auto') ? CONTAINER_WIDTH : 0;
    },
  });
  // jsdom has no Element.scrollTo; record what the centering effect requests.
  (window.Element.prototype as unknown as { scrollTo: unknown }).scrollTo =
    function scrollTo(this: HTMLElement, opts?: { left?: number; behavior?: string }) {
      scrollCalls.push({
        left: opts?.left,
        behavior: opts?.behavior,
        onStrip: this.classList?.contains('overflow-x-auto') ?? false,
      });
    };
});

afterEach(() => {
  if (origOffsetLeft) Object.defineProperty(HTMLElement.prototype, 'offsetLeft', origOffsetLeft);
  if (origOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origOffsetWidth);
  if (origClientWidth) Object.defineProperty(window.Element.prototype, 'clientWidth', origClientWidth);
  delete (window.Element.prototype as unknown as { scrollTo?: unknown }).scrollTo;
  jest.restoreAllMocks();
});

const renderPanel = (selected: ImageFileInfo) =>
  render(
    <ThumbnailPanel
      images={images}
      selectedImage={selected}
      onImageSelect={jest.fn()}
      onClose={jest.fn()}
      visible={true}
    />,
  );

const rerenderPanel = (
  rerender: (ui: React.ReactElement) => void,
  selected: ImageFileInfo,
) =>
  rerender(
    <ThumbnailPanel
      images={images}
      selectedImage={selected}
      onImageSelect={jest.fn()}
      onClose={jest.fn()}
      visible={true}
    />,
  );

const wheel = (deltaY: number) => {
  act(() => {
    strip().dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));
  });
};

describe('dock centers the active photo on selection change', () => {
  it('centers the selected tile even when it is already visible (variable tile widths)', () => {
    const { rerender } = renderPanel(images[0]);
    // Mount centers the initial selection too.
    expect(scrollCalls.length).toBeGreaterThan(0);
    expect(scrollCalls[scrollCalls.length - 1]).toMatchObject({
      left: centerLeftFor('img1'), onStrip: true,
    });

    scrollCalls = [];
    rerenderPanel(rerender, images[2]); // wide tile (132px)
    expect(scrollCalls.length).toBe(1);
    expect(scrollCalls[0]).toMatchObject({ left: centerLeftFor('img3'), onStrip: true });

    scrollCalls = [];
    rerenderPanel(rerender, images[1]); // narrow portrait tile (60px)
    expect(scrollCalls[0]).toMatchObject({ left: centerLeftFor('img2'), onStrip: true });
  });

  it('smooth-scrolls isolated changes but jumps (auto) for rapid successive ones', () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000_000);
    const { rerender } = renderPanel(images[0]);
    expect(scrollCalls[scrollCalls.length - 1]?.behavior).toBe('smooth');

    // Second change lands < RAPID_NAV_MS after the first → instant jump.
    scrollCalls = [];
    nowSpy.mockReturnValue(1_000_000 + RAPID_NAV_MS - 50);
    rerenderPanel(rerender, images[1]);
    expect(scrollCalls[0]?.behavior).toBe('auto');

    // A later isolated change glides again.
    scrollCalls = [];
    nowSpy.mockReturnValue(1_000_000 + RAPID_NAV_MS - 50 + RAPID_NAV_MS + 200);
    rerenderPanel(rerender, images[3]);
    expect(scrollCalls[0]?.behavior).toBe('smooth');
  });
});

describe('dock never centers because of the wheel', () => {
  it('wheel alone only pans scrollLeft — no scrollTo centering', () => {
    renderPanel(images[0]);
    scrollCalls = [];
    wheel(120);
    wheel(120);
    expect(strip().scrollLeft).toBe(240);
    expect(scrollCalls).toEqual([]);
  });

  it('suppresses a selection change landing while wheel-panning, resumes after the idle window', async () => {
    const { rerender } = renderPanel(images[0]);
    scrollCalls = [];

    wheel(120);
    rerenderPanel(rerender, images[3]); // selection change arrives mid-wheel
    expect(scrollCalls).toEqual([]);

    // After the trailing idle window the wheel no longer owns the strip.
    await act(async () => { await new Promise((r) => setTimeout(r, WHEEL_IDLE_MS + 120)); });
    rerenderPanel(rerender, images[2]);
    expect(scrollCalls.length).toBe(1);
    expect(scrollCalls[0]).toMatchObject({ left: centerLeftFor('img3'), onStrip: true });
  });
});
