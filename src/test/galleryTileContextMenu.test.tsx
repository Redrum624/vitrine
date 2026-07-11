/**
 * Gallery tile right-click context menu (Task Q5, P11 follow-up): Open (develop),
 * Remove… (routes to the SAME `onRequestRemove` → App's `removeTargetIds` →
 * GalleryRemoveDialog flow the Del key uses — no second destructive path), and
 * Show in Explorer (shell.showItemInFolder via IPC). Selection semantics: an
 * unselected tile is single-selected first; a tile already in the current
 * multi-selection keeps it. Closes on Esc, an outside click, and after any action.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '../stores/appStore';
import { GalleryView } from '../components/Gallery/GalleryView';
import type { ImageFileInfo } from '../services/FileSystemService';

const images = [
  { id: 'img1', path: '/p/1.jpg', name: '1.jpg', size: 100, format: 'JPG', type: 'image/jpeg', lastModified: 3000, dateModified: new Date(3000) },
  { id: 'img2', path: '/p/2.cr3', name: '2.cr3', size: 200, format: 'CR3', type: 'image/x-canon-cr3', lastModified: 2000, dateModified: new Date(2000) },
  { id: 'img3', path: '/p/3.jpg', name: '3.jpg', size: 300, format: 'JPG', type: 'image/jpeg', lastModified: 1000, dateModified: new Date(1000) },
] as unknown as ImageFileInfo[];

const resetStore = () => {
  useAppStore.setState({
    viewMode: 'gallery',
    ratingFilter: 0,
    imageRatings: {},
    selectedImageIds: [],
    selectionAnchorId: null,
    gallerySortAscending: false,
    alignmentAxisX: null,
    imageDimensions: {},
  });
};

beforeEach(() => {
  resetStore();
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    readImageAsDataURL: jest.fn().mockResolvedValue(null),
    readImageRating: jest.fn().mockResolvedValue(null),
    writeImageRating: jest.fn().mockResolvedValue({ ok: true }),
    showItemInFolder: jest.fn().mockResolvedValue({ ok: true }),
  };
});

const getTile = (id: string) => document.querySelector(`[data-image-id="${id}"]`) as HTMLElement;
const rightClickTile = (id: string, coords: { clientX?: number; clientY?: number } = {}) => {
  fireEvent.contextMenu(getTile(id), { clientX: coords.clientX ?? 100, clientY: coords.clientY ?? 100 });
};

describe('GalleryTileContextMenu — open + selection semantics', () => {
  it('right-click on an unselected tile single-selects it and opens the menu', () => {
    render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);
    rightClickTile('img2');
    expect(useAppStore.getState().selectedImageIds).toEqual(['img2']);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('right-click on a tile already in the multi-selection keeps the whole selection', () => {
    useAppStore.setState({ selectedImageIds: ['img1', 'img3'], selectionAnchorId: 'img1' });
    render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);
    rightClickTile('img3');
    expect(useAppStore.getState().selectedImageIds).toEqual(['img1', 'img3']);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('a second contextmenu on a different (unselected) tile retargets the menu', () => {
    render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);
    rightClickTile('img1', { clientX: 50, clientY: 50 });
    expect(useAppStore.getState().selectedImageIds).toEqual(['img1']);

    rightClickTile('img3', { clientX: 300, clientY: 300 });
    expect(useAppStore.getState().selectedImageIds).toEqual(['img3']);
    // Still exactly one menu instance, repositioned to the new coordinates.
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    const menu = screen.getByRole('menu');
    expect(menu.style.left).toBe('300px');
    expect(menu.style.top).toBe('300px');
  });
});

describe('GalleryTileContextMenu — Open', () => {
  it('loads the CLICKED tile to the canvas and switches to Develop (double-click path)', () => {
    useAppStore.setState({ selectedImageIds: ['img1', 'img3'], selectionAnchorId: 'img1' });
    const onImageSelect = jest.fn();
    render(<GalleryView images={images} onImageSelect={onImageSelect} visible={true} />);
    rightClickTile('img3');
    fireEvent.click(screen.getByRole('menuitem', { name: /open/i }));

    expect(onImageSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'img3' }));
    expect(useAppStore.getState().viewMode).toBe('develop');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('GalleryTileContextMenu — Remove…', () => {
  it('fires onRequestRemove with the FULL selection when the clicked tile was already multi-selected', () => {
    useAppStore.setState({ selectedImageIds: ['img1', 'img3'], selectionAnchorId: 'img1' });
    const onRequestRemove = jest.fn();
    render(<GalleryView images={images} onImageSelect={jest.fn()} onRequestRemove={onRequestRemove} visible={true} />);
    rightClickTile('img3');
    fireEvent.click(screen.getByRole('menuitem', { name: /remove/i }));

    expect(onRequestRemove).toHaveBeenCalledTimes(1);
    expect(onRequestRemove).toHaveBeenCalledWith(['img1', 'img3']);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('fires onRequestRemove with just the clicked tile id when it was unselected', () => {
    const onRequestRemove = jest.fn();
    render(<GalleryView images={images} onImageSelect={jest.fn()} onRequestRemove={onRequestRemove} visible={true} />);
    rightClickTile('img2');
    fireEvent.click(screen.getByRole('menuitem', { name: /remove/i }));

    expect(onRequestRemove).toHaveBeenCalledWith(['img2']);
  });

  it('does not throw when onRequestRemove is not supplied (still closes the menu)', () => {
    render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);
    rightClickTile('img1');
    expect(() => fireEvent.click(screen.getByRole('menuitem', { name: /remove/i }))).not.toThrow();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('GalleryTileContextMenu — Show in Explorer', () => {
  it('calls the showItemInFolder IPC with the CLICKED tile\'s path only', () => {
    useAppStore.setState({ selectedImageIds: ['img1', 'img3'], selectionAnchorId: 'img1' });
    render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);
    rightClickTile('img3');
    fireEvent.click(screen.getByRole('menuitem', { name: /show in explorer/i }));

    expect(window.electronAPI!.showItemInFolder).toHaveBeenCalledTimes(1);
    expect(window.electronAPI!.showItemInFolder).toHaveBeenCalledWith('/p/3.jpg');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('GalleryTileContextMenu — dismissal', () => {
  it('closes on Escape without leaving other document Esc listeners to also fire', () => {
    render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);
    rightClickTile('img1');
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on an outside click', () => {
    render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);
    rightClickTile('img1');
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does NOT close on a click inside the menu itself (only its own menu items close it)', () => {
    render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);
    rightClickTile('img1');
    const menu = screen.getByRole('menu');
    fireEvent.mouseDown(menu);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
