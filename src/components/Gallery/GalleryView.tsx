import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { Check } from 'lucide-react';
import { ImageFileInfo } from '../../services/FileSystemService';
import { useAppStore } from '../../stores/appStore';
import { logger } from '../../utils/Logger';
import { StarRating } from '../common/StarRating';
import { GALLERY_GRID_INSET, GALLERY_GRID_INSET_TOP } from '../../layout/photoRegion';
import {
  filterImagesByRating,
  sortImagesByDate,
  handleImageClick,
  isRawImage,
  formatGalleryTileMeta,
} from '../../utils/gallerySelection';
import { evictOldestThumbnails, MAX_THUMBNAIL_CACHE } from '../Panels/ThumbnailPanel';
import { getDisplayFormat } from '../../utils/imageFormat';
import { keyboardEventBlocked } from '../../utils/keyboardScope';
import { scheduleThumbnail, bumpThumbnail } from '../../utils/thumbnailScheduler';
import { GalleryTileContextMenu } from './GalleryTileContextMenu';

interface GalleryViewProps {
  images: ImageFileInfo[];
  /** Loads the image to the canvas (same "current image" concept as Develop). */
  onImageSelect: (image: ImageFileInfo) => void;
  /** Stays mounted (like ThumbnailPanel) so its thumbnail cache survives Develop
   * ↔ Gallery toggles; renders null while hidden. */
  visible: boolean;
  /** Tile context menu's "Remove…" (Task Q5): forwards the target ids to the caller
   *  instead of removing anything itself — App wires this to the SAME
   *  `removeTargetIds` state the gallery Del key sets, so the confirm dialog stays
   *  the single destructive-path gate. No-ops (menu item still closes the menu) if
   *  the caller doesn't supply it. */
  onRequestRemove?: (ids: string[]) => void;
}

const GRID_GAP = 16;
const TILE_MIN_WIDTH = 420;
/** Extra rows rendered above/below the viewport so scrolling never flashes blanks. */
const OVERSCAN_ROWS = 2;

/**
 * Gallery view (Glass · Sectioned 5a, Task 7): a virtualized library grid replacing
 * the Develop photo region when `viewMode === 'gallery'`. Reuses the SAME store
 * fields as the filmstrip dock (imageRatings/ratingFilter/selectedImageIds) so
 * switching views never loses selection, and the shared `handleImageClick` from
 * gallerySelection.ts for identical shift/ctrl/plain click semantics.
 */
export function GalleryView({ images, onImageSelect, visible, onRequestRemove }: GalleryViewProps) {
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const [loadingThumbnails, setLoadingThumbnails] = useState<Set<string>>(new Set());
  const thumbnailsRef = useRef<Map<string, string>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  const ratingsFetchedRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  // Entrance stagger (§5: gallery tiles rise +20ms each). GATED to the gallery
  // ENTRY (visible false→true) — NOT to virtualized scroll-remounts — so scrolling
  // never re-triggers the rise, and the tile's hover translateY isn't frozen by the
  // filling dcRise (it animates `transform`). Cap the stagger at 400ms so huge
  // folders don't stall the first screen. useLayoutEffect arms the flag before paint
  // so tiles never flash un-animated first.
  const [entranceAnimating, setEntranceAnimating] = useState(false);
  const wasVisibleRef = useRef(false);
  useLayoutEffect(() => {
    if (visible && !wasVisibleRef.current) {
      wasVisibleRef.current = true;
      setEntranceAnimating(true);
      const t = setTimeout(() => setEntranceAnimating(false), 900); // 400ms max stagger + 380ms rise + slack
      return () => clearTimeout(t);
    }
    if (!visible) wasVisibleRef.current = false;
  }, [visible]);

  // Per-field selectors (not a whole-store `useAppStore()` subscription) — GalleryView
  // only re-renders when one of ITS OWN fields actually changes, not on every store
  // update elsewhere (e.g. Develop-only fields like rawDecodeOptions/viewport).
  const imageRatings = useAppStore((s) => s.imageRatings);
  const setImageRating = useAppStore((s) => s.setImageRating);
  const ratingFilter = useAppStore((s) => s.ratingFilter);
  const selectedImageIds = useAppStore((s) => s.selectedImageIds);
  const selectionAnchorId = useAppStore((s) => s.selectionAnchorId);
  const setSelection = useAppStore((s) => s.setSelection);
  const toggleImageSelection = useAppStore((s) => s.toggleImageSelection);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const gallerySortAscending = useAppStore((s) => s.gallerySortAscending);
  const imageDimensions = useAppStore((s) => s.imageDimensions);
  const setImageDimensions = useAppStore((s) => s.setImageDimensions);

  const sortedFilteredImages = useMemo(() => {
    const filtered = filterImagesByRating(images, imageRatings, ratingFilter ?? 0);
    return sortImagesByDate(filtered, gallerySortAscending ?? false);
  }, [images, imageRatings, ratingFilter, gallerySortAscending]);

  // Measure the scroll container to window rows. Unmeasured (width/height stay 0 —
  // e.g. jsdom, where ResizeObserver.observe() never invokes its callback) falls
  // back to rendering every tile in one unwindowed grid and letting the browser's
  // native `auto-fill` flow lay it out — correct for both the very first paint and
  // test environments.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible]);

  const columns = viewportSize.width > 0
    ? Math.max(1, Math.floor((viewportSize.width + GRID_GAP) / (TILE_MIN_WIDTH + GRID_GAP)))
    : 0;

  const rows = useMemo(() => {
    if (columns === 0) return sortedFilteredImages.length ? [sortedFilteredImages] : [];
    const out: ImageFileInfo[][] = [];
    for (let i = 0; i < sortedFilteredImages.length; i += columns) {
      out.push(sortedFilteredImages.slice(i, i + columns));
    }
    return out;
  }, [sortedFilteredImages, columns]);

  // Tiles are treated as ~square for the row-height estimate used ONLY to decide
  // which rows to mount — an approximation of the browser's actual `auto-fill`
  // column width, generous OVERSCAN absorbs the slop.
  const columnWidthEstimate = columns > 0 ? (viewportSize.width - GRID_GAP * (columns - 1)) / columns : 0;
  const rowHeightEstimate = columnWidthEstimate > 0 ? columnWidthEstimate + GRID_GAP : 0;
  const canVirtualize = columns > 0 && rowHeightEstimate > 0 && viewportSize.height > 0;

  const startRow = canVirtualize ? Math.max(0, Math.floor(scrollTop / rowHeightEstimate) - OVERSCAN_ROWS) : 0;
  const endRow = canVirtualize
    ? Math.min(rows.length - 1, Math.ceil((scrollTop + viewportSize.height) / rowHeightEstimate) + OVERSCAN_ROWS)
    : rows.length - 1;

  const topSpacerHeight = canVirtualize ? startRow * rowHeightEstimate : 0;
  const bottomSpacerHeight = canVirtualize ? Math.max(0, rows.length - 1 - endRow) * rowHeightEstimate : 0;

  const visibleImages = useMemo(() => rows.slice(startRow, endRow + 1).flat(), [rows, startRow, endRow]);

  // Thumbnail loader — same algorithm as ThumbnailPanel's loadThumbnail (fetch via
  // electronAPI, evict via the shared cap), kept as GalleryView's own component-
  // local cache (switching views re-fetches — an accepted trade-off; see report).
  const loadThumbnail = useCallback(async (image: ImageFileInfo) => {
    if (!ratingsFetchedRef.current.has(image.id) && window.electronAPI?.readImageRating) {
      ratingsFetchedRef.current.add(image.id);
      window.electronAPI.readImageRating(image.path)
        .then((r) => {
          if (typeof r === 'number' && r > 0) useAppStore.getState().setImageRating(image.id, r);
        })
        .catch(() => { /* no rating / unreadable — leave unrated */ });
    }

    if (thumbnailsRef.current.has(image.id)) return;
    if (loadingRef.current.has(image.id)) {
      // Already queued/in flight — promote it so the tile the user can SEE now
      // (filter change, scroll-back) beats stale queued work.
      bumpThumbnail(image.id);
      return;
    }
    loadingRef.current.add(image.id);
    setLoadingThumbnails((prev) => new Set(prev).add(image.id));

    const storeThumbnail = (dataUrl: string) => {
      setThumbnails((prev) => {
        const next = evictOldestThumbnails(new Map(prev).set(image.id, dataUrl), MAX_THUMBNAIL_CACHE);
        thumbnailsRef.current = next;
        return next;
      });
    };

    try {
      if (window.electronAPI) {
        // Routed through the shared priority queue: newest visible batch first,
        // capped concurrency — see utils/thumbnailScheduler.ts.
        const dataUrl = await scheduleThumbnail(
          image.id,
          () => window.electronAPI!.readImageAsDataURL(image.path),
        );
        if (dataUrl) storeThumbnail(dataUrl);
      }
    } catch (error) {
      logger.warn(`Failed to load gallery thumbnail for ${image.name}:`, error);
    } finally {
      loadingRef.current.delete(image.id);
      setLoadingThumbnails((prev) => {
        const next = new Set(prev);
        next.delete(image.id);
        return next;
      });
    }
  }, []);

  // Lazy-load: the row-window ITSELF is the viewport-cull (any image whose row is
  // currently mounted — visible + overscan — gets its thumbnail fetched). No
  // separate getBoundingClientRect scan is needed here, unlike the dock's
  // horizontal filmstrip which has no row concept to key off.
  //
  // Skips the fetch pass entirely while unmeasured (viewportSize still {0,0} on
  // the very first commit) — otherwise `visibleImages` falls back to the WHOLE
  // folder (see canVirtualize above) and every image gets a full-size
  // readImageAsDataURL + readImageRating IPC in one commit, an unbounded burst
  // at large folder sizes. The windowed pass fires one frame later once
  // ResizeObserver reports real dimensions and this effect re-runs.
  useEffect(() => {
    if (!visible) return;
    // Unmeasured first commit: viewportSize is {0,0}, so width===0 already implies
    // !canVirtualize (which requires height>0) — the width check alone gates the burst.
    if (viewportSize.width === 0) return;
    visibleImages.forEach((img) => { void loadThumbnail(img); });
  }, [visible, visibleImages, loadThumbnail, viewportSize.width]);

  const handleScroll = () => setScrollTop(scrollRef.current?.scrollTop ?? 0);

  // Shared with ThumbnailPanel's dock (gallerySelection.ts) — identical shift
  // range / ctrl toggle / plain select+load semantics.
  const handleTileClick = (image: ImageFileInfo, e: React.MouseEvent) => {
    handleImageClick(
      image,
      { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey },
      sortedFilteredImages,
      null,
      { selectedImageIds: selectedImageIds ?? [], selectionAnchorId },
      { setSelection, toggleImageSelection, onImageSelect, loadThumbnail },
    );
  };

  // The preceding click (of the double-click pair) already ran the plain-click
  // branch above — which loads the image to the canvas — so double-click only
  // needs to add the view switch.
  const handleTileDoubleClick = () => setViewMode('develop');

  // Right-click context menu (Task Q5, P11 follow-up). Selection semantics: an
  // UNSELECTED tile is single-selected first (the menu then acts on just it); a
  // tile already part of the current multi-selection keeps that selection (the
  // menu acts on all of it) — computed synchronously here (not read back from the
  // store after setSelection) so "Remove…" gets the right id list even though
  // React hasn't re-rendered yet. A second contextmenu (same tile or a different
  // one) simply overwrites this state, repositioning/retargeting the menu.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; image: ImageFileInfo; ids: string[] } | null>(null);

  const handleTileContextMenu = (image: ImageFileInfo, e: React.MouseEvent) => {
    e.preventDefault();
    const currentSelection = selectedImageIds ?? [];
    const alreadySelected = currentSelection.includes(image.id);
    const ids = alreadySelected ? currentSelection : [image.id];
    if (!alreadySelected) setSelection([image.id], image.id);
    setContextMenu({ x: e.clientX, y: e.clientY, image, ids });
  };

  // 1-5/0 rate the WHOLE selection while the gallery is open. Develop's own rating
  // shortcut (App.tsx's `applyRating`) is guarded to no-op when viewMode is
  // 'gallery', so the two never double-fire on the same keypress.
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!/^[0-5]$/.test(e.key)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Shared guard (keyboardScope.ts): don't rate while typing in a field OR
      // beneath an open modal (e.g. the Del-remove confirm dialog, where the
      // selection is non-empty by construction) — a rating here writes XMP to
      // every selected file on disk.
      if (keyboardEventBlocked(e)) return;
      const ids = useAppStore.getState().selectedImageIds;
      if (!ids || ids.length === 0) return;
      const rating = Number(e.key);
      const store = useAppStore.getState();
      ids.forEach((id) => {
        store.setImageRating(id, rating);
        const img = images.find((i) => i.id === id);
        if (img) window.electronAPI?.writeImageRating?.(img.path, rating);
      });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [visible, images]);

  if (!visible) return null;

  return (
    <>
    <div
      ref={scrollRef}
      className="absolute overflow-y-auto no-select"
      onScroll={handleScroll}
      style={{
        left: GALLERY_GRID_INSET,
        right: GALLERY_GRID_INSET,
        top: GALLERY_GRID_INSET_TOP,
        bottom: GALLERY_GRID_INSET,
      }}
    >
      {sortedFilteredImages.length === 0 ? (
        <div className="w-full h-full flex items-center justify-center" style={{ color: 'var(--glass-text-muted)' }}>
          No images match the current filter
        </div>
      ) : (
        <>
          <div style={{ height: topSpacerHeight }} aria-hidden="true" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: GRID_GAP }}>
            {visibleImages.map((image, localIndex) => {
              const isSelected = selectedImageIds?.includes(image.id) ?? false;
              const thumbnail = thumbnails.get(image.id);
              const isLoading = loadingThumbnails.has(image.id);
              return (
                <div
                  key={image.id}
                  data-image-id={image.id}
                  data-selected={isSelected || undefined}
                  className={`glass-gallery-tile relative cursor-pointer ${isSelected ? 'is-selected' : ''}${entranceAnimating ? ' dc-rise' : ''}`}
                  style={{
                    borderRadius: 14,
                    background: '#141418',
                    borderWidth: isSelected ? 2 : 1,
                    borderStyle: 'solid',
                    borderColor: isSelected ? 'var(--accent)' : 'rgba(255, 255, 255, 0.09)',
                    boxShadow: isSelected ? '0 0 18px rgba(59, 130, 246, 0.45)' : '0 4px 14px rgba(0, 0, 0, 0.35)',
                    overflow: 'hidden',
                    aspectRatio: '1 / 1',
                    animationDelay: entranceAnimating ? `${Math.min(localIndex * 20, 400)}ms` : undefined,
                  }}
                  onClick={(e) => handleTileClick(image, e)}
                  onDoubleClick={handleTileDoubleClick}
                  onContextMenu={(e) => handleTileContextMenu(image, e)}
                  title={`${image.name} (${getDisplayFormat(image.format)})`}
                >
                  {isLoading ? (
                    <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: 'var(--gray-800)' }}>
                      <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--gray-600)', borderTopColor: 'var(--white)' }} />
                    </div>
                  ) : thumbnail ? (
                    <img
                      src={thumbnail}
                      alt={image.name}
                      className="w-full h-full object-cover"
                      draggable={false}
                      onLoad={(e) => {
                        // Free byproduct of the decode the browser already performs to
                        // paint this thumbnail — no extra IPC/decode (Task B2). RAW
                        // formats are excluded: `read-image-as-data-url` (electron/main.cjs)
                        // returns a preview downscaled to fit 512×512 for RAW files, never
                        // the sensor's true dimensions — recording that would be confidently
                        // wrong (fix round 1, Critical review finding).
                        const { naturalWidth, naturalHeight } = e.currentTarget;
                        if (naturalWidth && naturalHeight && !isRawImage(image)) {
                          setImageDimensions(image.id, { width: naturalWidth, height: naturalHeight });
                        }
                      }}
                    />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center"
                      style={{ backgroundColor: 'var(--gray-800)' }}
                      onClick={() => loadThumbnail(image)}
                    >
                      <span className="text-xs text-center px-2" style={{ color: 'var(--gray-500)' }}>{getDisplayFormat(image.format)}</span>
                    </div>
                  )}

                  {/* Selected check badge (top-left) */}
                  {isSelected && (
                    <div
                      data-testid="gallery-check-badge"
                      className="absolute flex items-center justify-center"
                      style={{ top: 8, left: 8, width: 22, height: 22, borderRadius: '50%', background: 'var(--accent)', color: '#0b0b0c' }}
                    >
                      <Check className="w-3.5 h-3.5" strokeWidth={3} />
                    </div>
                  )}

                  {/* RAW badge (top-right) — same style as the dock's thumbnails */}
                  {isRawImage(image) && (
                    <div
                      className="absolute"
                      style={{
                        top: 8, right: 8, padding: '0 4px', borderRadius: '3px',
                        backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '9px',
                        fontWeight: 700, letterSpacing: '0.5px', lineHeight: '16px', pointerEvents: 'none',
                      }}
                    >
                      RAW
                    </div>
                  )}

                  {/* Bottom scrim: filename, W×H·FMT meta, star strip */}
                  <div
                    className="absolute inset-x-0 bottom-0"
                    style={{ padding: '20px 10px 8px', background: 'linear-gradient(to top, rgba(5,5,8,.85), transparent)' }}
                  >
                    <div className="flex items-end justify-between" style={{ gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 11.5, fontWeight: 500, color: 'var(--glass-text-title)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}
                        >
                          {image.name}
                        </div>
                        <div style={{ fontSize: 9.5, fontFamily: 'ui-monospace, monospace', color: 'var(--glass-text-secondary)' }}>
                          {formatGalleryTileMeta(image, imageDimensions[image.id])}
                        </div>
                      </div>
                      <StarRating
                        size={12}
                        rating={imageRatings[image.id] ?? 0}
                        onRate={(r) => {
                          setImageRating(image.id, r);
                          window.electronAPI?.writeImageRating?.(image.path, r);
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ height: bottomSpacerHeight }} aria-hidden="true" />
        </>
      )}
    </div>
    {contextMenu && (
      <GalleryTileContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={() => setContextMenu(null)}
        onOpen={() => {
          onImageSelect(contextMenu.image);
          setViewMode('develop');
        }}
        onRemove={() => onRequestRemove?.(contextMenu.ids)}
        onShowInExplorer={() => window.electronAPI?.showItemInFolder?.(contextMenu.image.path)}
      />
    )}
    </>
  );
}

export default GalleryView;
