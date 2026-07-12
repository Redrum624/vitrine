/**
 * Unit tests for ThumbnailPanel multi-select interactions.
 *
 * Plain click → load to canvas + single-select. Ctrl/Cmd+click → toggle membership
 * (no canvas change). Shift+click → contiguous range from the anchor (no canvas
 * change). The "Export N" button appears only when ≥2 are selected.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import type { ImageFileInfo } from '../services/FileSystemService';

const mockStore: Record<string, unknown> = {};
jest.mock('../stores/appStore', () => ({
  useAppStore: (sel?: (s: unknown) => unknown) => (sel ? sel(mockStore) : mockStore),
}));

import { ThumbnailPanel } from '../components/Panels/ThumbnailPanel';

const setSelection = jest.fn();
const toggleImageSelection = jest.fn();
const setImageRating = jest.fn();
const setViewMode = jest.fn();

const images = [
  { id: 'img1', path: '/p/1.jpg', name: '1.jpg' },
  { id: 'img2', path: '/p/2.jpg', name: '2.jpg' },
  { id: 'img3', path: '/p/3.jpg', name: '3.jpg' },
  { id: 'img4', path: '/p/4.jpg', name: '4.jpg' },
] as unknown as ImageFileInfo[];

function setup(over: Partial<Record<string, unknown>> = {}) {
  Object.assign(mockStore, {
    imageRatings: {},
    setImageRating,
    selectedImageIds: [],
    selectionAnchorId: null,
    setSelection,
    toggleImageSelection,
    ratingFilter: 0,
    alignmentAxisX: null,
    setViewMode,
    ...over,
  });
  const onImageSelect = jest.fn();
  const onExportSelected = jest.fn();
  render(
    <ThumbnailPanel
      images={images}
      selectedImage={images[0]}
      onImageSelect={onImageSelect}
      onClose={() => {}}
      visible={true}
      onExportSelected={onExportSelected}
    />,
  );
  return { onImageSelect, onExportSelected };
}

const clickThumb = (id: string, init?: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean }) => {
  const el = document.querySelector(`[data-image-id="${id}"]`)!;
  fireEvent.click(el, init);
};

beforeEach(() => jest.clearAllMocks());

it('plain click loads to canvas and single-selects', () => {
  const { onImageSelect } = setup();
  clickThumb('img2');
  expect(onImageSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'img2' }));
  expect(setSelection).toHaveBeenCalledWith(['img2'], 'img2');
  expect(toggleImageSelection).not.toHaveBeenCalled();
});

it('plain re-click on the sole selected thumbnail clears its checkmark', () => {
  const { onImageSelect } = setup({ selectedImageIds: ['img2'] });
  clickThumb('img2');
  expect(setSelection).toHaveBeenCalledWith([], null);
  expect(onImageSelect).not.toHaveBeenCalled();
});

it('ctrl+click toggles membership without changing the canvas', () => {
  const { onImageSelect } = setup();
  clickThumb('img3', { ctrlKey: true });
  expect(toggleImageSelection).toHaveBeenCalledWith('img3');
  expect(onImageSelect).not.toHaveBeenCalled();
});

it('shift+click selects the contiguous range from the anchor', () => {
  const { onImageSelect } = setup({ selectionAnchorId: 'img1', selectedImageIds: ['img1'] });
  clickThumb('img3', { shiftKey: true });
  expect(setSelection).toHaveBeenCalledWith(['img1', 'img2', 'img3'], 'img1');
  expect(onImageSelect).not.toHaveBeenCalled();
});

it('shows the Export button only when ≥2 images are selected', () => {
  setup({ selectedImageIds: ['img1', 'img2'] });
  expect(screen.getByRole('button', { name: /export 2/i })).toBeInTheDocument();
});

it('hides the Export button when fewer than 2 are selected', () => {
  setup({ selectedImageIds: ['img1'] });
  expect(screen.queryByRole('button', { name: /export \d/i })).not.toBeInTheDocument();
});

it('the Export button triggers onExportSelected', () => {
  const { onExportSelected } = setup({ selectedImageIds: ['img1', 'img2', 'img3'] });
  fireEvent.click(screen.getByRole('button', { name: /export 3/i }));
  expect(onExportSelected).toHaveBeenCalled();
});
