/**
 * Filmstrip filter-scroll anchor (v1.31.0, user request): changing the star
 * filter must keep the CURRENT picture in view instead of snapping the strip
 * back to the beginning. When the filter hides the current picture, the strip
 * anchors on the nearest surviving tile (by folder order) instead.
 */
import { render, act } from '@testing-library/react';
import { useAppStore } from '../stores/appStore';
import { ThumbnailPanel } from '../components/Panels/ThumbnailPanel';
import type { ImageFileInfo } from '../services/FileSystemService';

const mkImg = (n: number) => ({
  id: `img${n}`, path: `/p/${n}.jpg`, name: `${n}.jpg`, size: 100,
  format: 'JPG', type: 'image/jpeg', lastModified: 0, dateModified: new Date(0),
}) as unknown as ImageFileInfo;
const images = [1, 2, 3, 4, 5].map(mkImg);

let scrolled: string[];

beforeEach(() => {
  scrolled = [];
  useAppStore.setState({
    ratingFilter: 0,
    imageRatings: { img2: 3, img3: 1, img5: 4 },
    selectedImageIds: [],
    selectionAnchorId: null,
    alignmentAxisX: null,
  });
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    readImageAsDataURL: jest.fn().mockResolvedValue(null),
    readImageRating: jest.fn().mockResolvedValue(null),
  };
  // jsdom has no scrollIntoView; record which tile the anchor effect targets.
  const proto = window.Element.prototype as { scrollIntoView?: unknown };
  proto.scrollIntoView = function scrollIntoView(this: HTMLElement) {
    let node: HTMLElement | null = this;
    while (node && !node.getAttribute('data-image-id')) node = node.parentElement;
    scrolled.push(node?.getAttribute('data-image-id') ?? '?');
  };
});

afterEach(() => {
  delete (window.Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

const flushRaf = async () => {
  await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
};

describe('dock keeps the current picture anchored across filter changes', () => {
  it('re-centers the selected tile when the filter still includes it', async () => {
    render(
      <ThumbnailPanel images={images} selectedImage={images[1]} onImageSelect={jest.fn()} onClose={jest.fn()} visible={true} />,
    );
    scrolled = [];
    act(() => { useAppStore.getState().setRatingFilter(3); }); // img2 (3★) survives
    await flushRaf();
    expect(scrolled).toContain('img2');
  });

  it('anchors on the nearest surviving neighbour when the filter hides the selection', async () => {
    render(
      <ThumbnailPanel images={images} selectedImage={images[2]} onImageSelect={jest.fn()} onClose={jest.fn()} visible={true} />,
    );
    scrolled = [];
    // ≥3★ keeps img2 (3★) and img5 (4★); selected img3 (1★) is hidden.
    // Nearest by folder order to index 2 is img2 (distance 1) over img5 (2).
    act(() => { useAppStore.getState().setRatingFilter(3); });
    await flushRaf();
    expect(scrolled).toContain('img2');
    expect(scrolled).not.toContain('img5');
  });

  it('does nothing without a selected image', async () => {
    render(
      <ThumbnailPanel images={images} onImageSelect={jest.fn()} onClose={jest.fn()} visible={true} />,
    );
    scrolled = [];
    act(() => { useAppStore.getState().setRatingFilter(1); });
    await flushRaf();
    expect(scrolled).toEqual([]);
  });
});
