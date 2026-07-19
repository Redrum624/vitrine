import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Download, LayoutGrid } from 'lucide-react';
import { ImageFileInfo } from '../../services/FileSystemService';
import { useAppStore } from '../../stores/appStore';
import { logger } from '../../utils/Logger';
import { ChipButton } from '../Controls/ChipButton';
import { DOCK_BOTTOM } from '../../layout/photoRegion';
import { filterImagesByRating, handleImageClick, isRawImage } from '../../utils/gallerySelection';
import { getDisplayFormat } from '../../utils/imageFormat';
import { keyboardEventBlocked } from '../../utils/keyboardScope';
import { scheduleThumbnail, bumpThumbnail } from '../../utils/thumbnailScheduler';

interface ThumbnailPanelProps {
  images: ImageFileInfo[];
  selectedImage?: ImageFileInfo;
  onImageSelect: (image: ImageFileInfo) => void;
  onClose: () => void;
  visible: boolean;
  /** Open the multi-export flow for the currently selected images. */
  onExportSelected?: () => void;
}

/**
 * Cap for the thumbnail data-URL cache. Without a bound, browsing a folder with
 * thousands of images accumulates a multi-MB data URL per file and never frees
 * any of it. Oldest-inserted entries are evicted first — they belong to thumbnails
 * scrolled furthest away, and the lazy loader re-fetches them on demand.
 */
export const MAX_THUMBNAIL_CACHE = 400;

/** Evict oldest-inserted entries until the map is at or below `max`. Mutates in place. */
export function evictOldestThumbnails(map: Map<string, string>, max = MAX_THUMBNAIL_CACHE): Map<string, string> {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  return map;
}

/**
 * Selection frame for a dock thumbnail — ONE visual language (blue intensity
 * hierarchy). The current canvas image gets the strongest treatment (2px accent
 * outline + an 18px accent glow, per the Glass · Sectioned dock spec); other
 * multi-selected images a dimmed blue border; the rest a faint
 * rgba(255,255,255,.09) border — all the SAME width so thumbnails never shift
 * size (their width already differs by selection state; see ThumbnailPanel).
 */
export function getThumbFrameStyle(isCurrent: boolean, inSelection: boolean): React.CSSProperties {
  if (isCurrent) {
    return {
      borderWidth: '2px',
      borderColor: '#3b82f6',
      boxShadow: '0 0 18px rgba(59, 130, 246, 0.45)',
    };
  }
  if (inSelection) {
    return {
      borderWidth: '2px',
      borderColor: 'rgba(59, 130, 246, 0.45)',
      boxShadow: 'none',
    };
  }
  return {
    borderWidth: '2px',
    borderColor: 'rgba(255, 255, 255, 0.09)',
    boxShadow: 'none',
  };
}

/** Dock thumbnail height is constant; width follows each photo's aspect ratio
 * (clamped) so portraits and landscapes both display WHOLE — the previous fixed
 * 66/114×88 tiles + object-cover cropped portraits to a horizontal band and
 * landscapes (when current) to a sliver. Until a thumb loads and reports its
 * aspect, tiles use the neutral fallback width. */
const DOCK_THUMB_HEIGHT = 88;
const DOCK_THUMB_WIDTH_FALLBACK = 114;
const DOCK_THUMB_WIDTH_MIN = 56;
const DOCK_THUMB_WIDTH_MAX = 132;

/** Aspect-derived tile width, clamped so extreme panoramas/verticals stay usable. */
export function dockThumbWidth(aspect: number | undefined): number {
  if (!aspect || !Number.isFinite(aspect) || aspect <= 0) return DOCK_THUMB_WIDTH_FALLBACK;
  return Math.max(DOCK_THUMB_WIDTH_MIN, Math.min(DOCK_THUMB_WIDTH_MAX, Math.round(DOCK_THUMB_HEIGHT * aspect)));
}

// Base layout for the dock's chevron buttons — interactive :hover/:disabled states
// come from .glass-pill-btn in index.css (same idiom as Toolbar.tsx / IconSidebar.tsx).
const chevronBtn: CSSProperties = {
  width: '30px',
  height: '30px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '9px',
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--glass-text-chrome-idle)',
  cursor: 'pointer',
  flexShrink: 0,
};

export function ThumbnailPanel({
  images,
  selectedImage,
  onImageSelect,
  onClose,
  visible,
  onExportSelected
}: ThumbnailPanelProps) {
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const [loadingThumbnails, setLoadingThumbnails] = useState<Set<string>>(new Set());
  // Per-image display aspect (w/h), measured from the loaded thumbnail itself —
  // drives aspect-correct tile widths (no cropping). Uncapped growth is fine:
  // two numbers per browsed image.
  const [thumbAspects, setThumbAspects] = useState<Map<string, number>>(new Map());
  // Refs mirroring the maps above so loadThumbnail can bail out synchronously —
  // scroll events re-request every visible thumb, and without these guards each
  // request re-issued the IPC fetch (and raced the eviction cap) even when the
  // thumbnail was already loaded or in flight.
  const thumbnailsRef = useRef<Map<string, string>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  // Image ids whose on-disk rating we've already fetched, so we read each file's
  // xmp:Rating at most once even as scroll re-requests the same visible thumbnails.
  const ratingsFetchedRef = useRef<Set<string>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const selectedImageRef = useRef<HTMLDivElement>(null);
  // Per-field selectors (not a whole-store `useAppStore()` subscription) — the dock
  // only re-renders when one of ITS OWN fields actually changes, not on every store
  // update elsewhere (e.g. Develop-only fields like rawDecodeOptions/viewport).
  const imageRatings = useAppStore((s) => s.imageRatings);
  const selectedImageIds = useAppStore((s) => s.selectedImageIds);
  const selectionAnchorId = useAppStore((s) => s.selectionAnchorId);
  const setSelection = useAppStore((s) => s.setSelection);
  const toggleImageSelection = useAppStore((s) => s.toggleImageSelection);
  const ratingFilterRaw = useAppStore((s) => s.ratingFilter);
  const alignmentAxisX = useAppStore((s) => s.alignmentAxisX);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const setImageDimensions = useAppStore((s) => s.setImageDimensions);
  // The rating filter now lives in the store (shared with the footer's segmented
  // control and the gallery grid) — default to "All" if a mock/store snapshot
  // doesn't carry it yet.
  const ratingFilter = ratingFilterRaw ?? 0;
  const selectedSet = new Set(selectedImageIds ?? []);
  const selectedCount = selectedImageIds?.length ?? 0;

  const filteredImages = useMemo(
    () => filterImagesByRating(images, imageRatings, ratingFilter),
    [images, imageRatings, ratingFilter],
  );

  // Load thumbnail for an image
  const loadThumbnail = useCallback(async (image: ImageFileInfo) => {
    // Seed the star rating from the file's metadata (embedded xmp:Rating, or a sidecar
    // .xmp for RAW) the first time we touch this image. The store starts empty on load,
    // so without this read-back a rating written to a file never reappears (the write
    // path already persists it). Independent of the thumbnail re-entrancy guard below
    // and deduped via its own ref so scroll re-requests don't re-issue the IPC.
    if (!ratingsFetchedRef.current.has(image.id) && window.electronAPI?.readImageRating) {
      ratingsFetchedRef.current.add(image.id);
      window.electronAPI.readImageRating(image.path)
        .then((r) => {
          if (typeof r === 'number' && r > 0) useAppStore.getState().setImageRating(image.id, r);
        })
        .catch(() => { /* no rating / unreadable — leave unrated */ });
    }

    // Synchronous re-entrancy guard: skip if already loaded or in flight.
    if (thumbnailsRef.current.has(image.id)) {
      return;
    }
    if (loadingRef.current.has(image.id)) {
      // Already queued/in flight — promote it so a thumb the user can SEE now
      // (filter change, scroll-back) beats stale queued work.
      bumpThumbnail(image.id);
      return;
    }
    loadingRef.current.add(image.id);
    setLoadingThumbnails(prev => new Set(prev).add(image.id));

    // Write-through helper keeping the ref in sync with the evicted state map.
    const storeThumbnail = (dataUrl: string) => {
      setThumbnails(prev => {
        const next = evictOldestThumbnails(new Map(prev).set(image.id, dataUrl));
        thumbnailsRef.current = next;
        return next;
      });
    };

    try {
      // Try to load thumbnail via Electron API — routed through the shared
      // priority queue (newest visible batch first, capped concurrency; see
      // utils/thumbnailScheduler.ts). Keyed by image.id, so if the gallery has
      // the same fetch queued the two views share one IPC.
      if (window.electronAPI) {
        const dataUrl = await scheduleThumbnail(
          image.id,
          () => window.electronAPI!.readImageAsDataURL(image.path),
        );
        if (dataUrl) {
          storeThumbnail(dataUrl);
        } else {
          // RAW file that couldn't be processed - create placeholder with filename
          const canvas = document.createElement('canvas');
          canvas.width = 150;
          canvas.height = 100;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#1f2937';
            ctx.fillRect(0, 0, 150, 100);
            ctx.fillStyle = '#9CA3AF';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(image.name.substring(0, 20), 75, 45);
            ctx.font = '9px sans-serif';
            ctx.fillText(getDisplayFormat(image.format) || 'RAW', 75, 60);
          }
          storeThumbnail(canvas.toDataURL());
        }
      } else {
        // Browser fallback - create placeholder
        const canvas = document.createElement('canvas');
        canvas.width = 150;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#374151';
          ctx.fillRect(0, 0, 150, 100);
          ctx.fillStyle = '#9CA3AF';
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(image.name, 75, 50);
        }
        storeThumbnail(canvas.toDataURL());
      }
    } catch (error) {
      logger.warn(`Failed to load thumbnail for ${image.name}:`, error);
      // Create error placeholder
      const canvas = document.createElement('canvas');
      canvas.width = 150;
      canvas.height = 100;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#DC2626';
        ctx.fillRect(0, 0, 150, 100);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Error', 75, 50);
      }
      storeThumbnail(canvas.toDataURL());
    } finally {
      loadingRef.current.delete(image.id);
      setLoadingThumbnails(prev => {
        const newSet = new Set(prev);
        newSet.delete(image.id);
        return newSet;
      });
    }
  }, []); // Empty dependencies - function is stable

  // Load only the thumbnails currently visible (+ a one-viewport-width margin so a
  // bit is preloaded ahead). The rest load as they scroll into view. Loading every
  // thumbnail at once floods the main process (RAW decode is slow) and many never
  // render — which is exactly the "plenty not loading" symptom.
  const loadVisibleThumbnails = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const margin = cRect.width;
    container.querySelectorAll('[data-image-id]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.left < cRect.right + margin && r.right > cRect.left - margin) {
        const id = el.getAttribute('data-image-id');
        const image = images.find(img => img.id === id);
        if (image) loadThumbnail(image);
      }
    });
  }, [images, loadThumbnail]);

  // Lazy-load the visible thumbnails on mount / when the image list changes.
  useEffect(() => {
    if (!visible || images.length === 0) return;
    const raf = requestAnimationFrame(() => loadVisibleThumbnails());
    return () => cancelAnimationFrame(raf);
  }, [images, visible, loadVisibleThumbnails]);

  // Scroll to selected image
  useEffect(() => {
    if (selectedImage && selectedImageRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const element = selectedImageRef.current;

      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();

      if (elementRect.left < containerRect.left || elementRect.right > containerRect.right) {
        element.scrollIntoView({ behavior: 'smooth', inline: 'center' });
      }
    }
  }, [selectedImage]);

  // Translate vertical mouse-wheel into horizontal filmstrip scrolling.
  // Uses a native non-passive listener so preventDefault actually works
  // (React attaches wheel handlers passively).
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Honour real horizontal intent (trackpads) but convert vertical to scrollLeft.
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      e.preventDefault();
      el.scrollLeft += delta;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [visible]);

  // Navigate with arrow keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!visible || filteredImages.length === 0) return;
      // Shared guard (keyboardScope.ts): never switch the loaded photo or close the
      // filmstrip while the user is typing in a field OR a modal dialog is open —
      // the dialog owns its own arrows/Esc. This listener historically had NO input
      // check at all, so arrow keys inside a dialog's text field switched the photo
      // and Esc closed the filmstrip out from under the dialog.
      if (keyboardEventBlocked(e)) return;

      const currentIndex = selectedImage ? filteredImages.findIndex(img => img.id === selectedImage.id) : -1;

      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        const prevImage = filteredImages[currentIndex - 1];
        onImageSelect(prevImage);
        loadThumbnail(prevImage);
        e.preventDefault();
      } else if (e.key === 'ArrowRight' && currentIndex < filteredImages.length - 1) {
        const nextImage = filteredImages[currentIndex + 1];
        onImageSelect(nextImage);
        loadThumbnail(nextImage);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        onClose();
        e.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, images, filteredImages, selectedImage, onImageSelect, onClose, loadThumbnail]);

  const handlePrevious = () => {
    if (!selectedImage || filteredImages.length === 0) return;
    const currentIndex = filteredImages.findIndex(img => img.id === selectedImage.id);
    if (currentIndex > 0) {
      const prevImage = filteredImages[currentIndex - 1];
      onImageSelect(prevImage);
      // Trigger thumbnail load (will be a no-op if already loaded/loading)
      loadThumbnail(prevImage);
    }
  };

  const handleNext = () => {
    if (!selectedImage || filteredImages.length === 0) return;
    const currentIndex = filteredImages.findIndex(img => img.id === selectedImage.id);
    if (currentIndex < filteredImages.length - 1) {
      const nextImage = filteredImages[currentIndex + 1];
      onImageSelect(nextImage);
      // Trigger thumbnail load (will be a no-op if already loaded/loading)
      loadThumbnail(nextImage);
    }
  };

  // Shared with the Gallery grid (Task 7) — see gallerySelection.ts's doc comment
  // for the full shift/ctrl/plain semantics this delegates to.
  const handleThumbnailClick = (image: ImageFileInfo, e: React.MouseEvent) => {
    handleImageClick(
      image,
      { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey },
      filteredImages,
      selectedImage?.id,
      { selectedImageIds: selectedImageIds ?? [], selectionAnchorId },
      { setSelection, toggleImageSelection, onImageSelect, loadThumbnail },
    );
  };

  const handleScroll = () => loadVisibleThumbnails();

  if (!visible || images.length === 0) {
    return null;
  }

  const currentIndex = selectedImage ? filteredImages.findIndex(img => img.id === selectedImage.id) : -1;
  const canGoPrevious = currentIndex > 0;
  const canGoNext = currentIndex < filteredImages.length - 1;

  return (
    <div
      className="absolute no-select"
      style={{
        bottom: DOCK_BOTTOM,
        left: alignmentAxisX ?? '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        maxWidth: 'calc(100% - 48px)',
      }}
    >
    {/* Inner surface carries the entrance rise (§5: dock +120ms). It is a SEPARATE
        node from the axis-centering wrapper above because dcRise animates
        `transform` (translateY 10→0) and, filling both, would otherwise clobber and
        freeze the outer translateX(-50%) centering. */}
    <div
      className="glass-chrome dc-rise flex items-center no-select"
      style={{
        borderRadius: 'var(--radius-dock)',
        padding: '10px 14px',
        gap: '10px',
        animationDelay: '120ms',
      }}
    >
      {/* Chevron: previous image */}
      <button
        onClick={handlePrevious}
        disabled={!canGoPrevious}
        className="glass-pill-btn"
        style={chevronBtn}
        title="Previous image (←)"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      {/* Thumbnail strip — horizontal scroll, thumbs centered on the axis via the
          dock's own centering (this inner strip just hugs its content). */}
      <div
        ref={scrollContainerRef}
        className="flex overflow-x-auto overflow-y-hidden"
        onScroll={handleScroll}
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--gray-700) transparent',
          maxWidth: '640px',
        }}
      >
        <div className="flex" style={{ gap: '8px' }}>
          {filteredImages.map((image) => {
            const isSelected = selectedImage?.id === image.id;
            const inSelection = selectedSet.has(image.id);
            const thumbnail = thumbnails.get(image.id);
            const isLoading = loadingThumbnails.has(image.id);
            const frameClass = [
              'glass-dock-thumb',
              isSelected ? 'is-current' : '',
              !isSelected && inSelection ? 'is-in-selection' : '',
            ].filter(Boolean).join(' ');

            return (
              <div
                key={image.id}
                ref={isSelected ? selectedImageRef : undefined}
                data-image-id={image.id}
                className={`relative flex-shrink-0 rounded cursor-pointer ${frameClass}`}
                style={{
                  width: dockThumbWidth(thumbAspects.get(image.id)),
                  height: DOCK_THUMB_HEIGHT,
                  borderRadius: '10px',
                  backgroundColor: 'var(--gray-800)',
                  borderStyle: 'solid',
                  ...getThumbFrameStyle(isSelected, inSelection)
                }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-photo-id', image.id);
                  e.dataTransfer.setData('application/x-photo-path', image.path);
                  e.dataTransfer.setData('application/x-photo-name', image.name);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={(e) => handleThumbnailClick(image, e)}
                title={`${image.name} (${getDisplayFormat(image.format)})`}
              >
                {isLoading ? (
                  <div className="w-full h-full rounded flex items-center justify-center" style={{backgroundColor: 'var(--gray-800)'}}>
                    <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{borderColor: 'var(--gray-600)', borderTopColor: 'var(--white)'}} />
                  </div>
                ) : thumbnail ? (
                  <img
                    src={thumbnail}
                    alt={image.name}
                    className="w-full h-full object-cover rounded"
                    style={{ borderRadius: '9px' }}
                    draggable={false}
                    onLoad={(e) => {
                      // Free byproduct of the decode the browser already performs to
                      // paint this thumbnail — no extra IPC/decode (Task B2). Feeds the
                      // shared `imageDimensions` store map so the Gallery grid's tile
                      // meta can show real dimensions even before its own lazy loader
                      // reaches this image. RAW formats are excluded: `read-image-as-data-url`
                      // (electron/main.cjs) returns a preview downscaled to fit 512×512 for
                      // RAW files, never the sensor's true dimensions — recording that would
                      // be confidently wrong (fix round 1, Critical review finding).
                      const { naturalWidth, naturalHeight } = e.currentTarget;
                      if (naturalWidth && naturalHeight && !isRawImage(image)) {
                        setImageDimensions(image.id, { width: naturalWidth, height: naturalHeight });
                      }
                      // Display ASPECT is orientation-corrected in the thumb bytes for
                      // every format, so it is safe for all (unlike absolute dims above).
                      if (naturalWidth && naturalHeight) {
                        setThumbAspects((prev) => {
                          const aspect = naturalWidth / naturalHeight;
                          if (prev.get(image.id) === aspect) return prev;
                          return new Map(prev).set(image.id, aspect);
                        });
                      }
                    }}
                  />
                ) : (
                  <div
                    className="w-full h-full rounded flex items-center justify-center"
                    style={{backgroundColor: 'var(--gray-800)'}}
                    onClick={() => loadThumbnail(image)}
                  >
                    <span className="text-xs text-center px-1" style={{color: 'var(--gray-500)'}}>
                      {getDisplayFormat(image.format)}
                    </span>
                  </div>
                )}

                {/* RAW badge (top-right) */}
                {isRawImage(image) && (
                  <div
                    className="absolute"
                    style={{
                      top: '3px', right: '3px', padding: '0 4px', borderRadius: '3px',
                      backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '8px',
                      fontWeight: 700, letterSpacing: '0.5px', lineHeight: '14px', pointerEvents: 'none',
                    }}
                  >
                    RAW
                  </div>
                )}

                {/* Star rating (bottom-left) — the culled/kept signal at a glance,
                    without opening the Gallery. Only rendered when rated. */}
                {(imageRatings[image.id] ?? 0) > 0 && (
                  <div
                    data-testid="dock-thumb-rating"
                    className="absolute"
                    style={{
                      bottom: '2px', left: '4px', pointerEvents: 'none',
                      fontSize: '9px', letterSpacing: '1px', color: '#f5c518',
                      textShadow: '0 1px 2px rgba(0,0,0,0.9)', lineHeight: '12px',
                    }}
                  >
                    {'★'.repeat(imageRatings[image.id])}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Chevron: next image */}
      <button
        onClick={handleNext}
        disabled={!canGoNext}
        className="glass-pill-btn"
        style={chevronBtn}
        title="Next image (→)"
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      {/* Multi-export action — shown only when 2+ images are selected */}
      {selectedCount >= 2 && (
        <button
          onClick={() => onExportSelected?.()}
          className="flex items-center gap-1 whitespace-nowrap"
          style={{
            padding: '7px 11px',
            borderRadius: 9,
            fontSize: 11.5,
            fontWeight: 600,
            background: 'var(--accent)',
            color: '#0b0b0c',
            border: '1px solid transparent',
            cursor: 'pointer',
            flexShrink: 0,
          }}
          title="Export the selected images with the same settings"
        >
          <Download className="w-3 h-3" />
          Export {selectedCount}
        </button>
      )}

      <div style={{ width: '1px', height: `${DOCK_THUMB_HEIGHT - 12}px`, background: 'var(--glass-border)', flexShrink: 0 }} />

      {/* Gallery button — switches to the library grid (Task 7) — stacked above the "i / N" count. */}
      <div className="flex flex-col items-stretch" style={{ gap: '6px' }}>
        <ChipButton dashed radius={10} onClick={() => setViewMode('gallery')} title="Open the gallery grid">
          <LayoutGrid className="w-3.5 h-3.5" style={{ marginRight: 6 }} />
          Gallery
        </ChipButton>
        {selectedImage && currentIndex >= 0 && (
          <div
            className="text-center"
            style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: 11,
              padding: '5px 10px',
              borderRadius: 6,
              background: 'rgba(255,255,255,.04)',
              border: '1px solid rgba(255,255,255,.1)',
              color: 'var(--glass-text-secondary)',
            }}
          >
            {currentIndex + 1} / {filteredImages.length}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}