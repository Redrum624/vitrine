import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Check, Download } from 'lucide-react';
import { StarRating } from '../common/StarRating';
import { ImageFileInfo } from '../../services/FileSystemService';
import { useAppStore } from '../../stores/appStore';
import { logger } from '../../utils/Logger';

interface ThumbnailPanelProps {
  images: ImageFileInfo[];
  selectedImage?: ImageFileInfo;
  onImageSelect: (image: ImageFileInfo) => void;
  onClose: () => void;
  visible: boolean;
  /** Open the multi-export flow for the currently selected images. */
  onExportSelected?: () => void;
}

const RAW_EXTENSIONS = ['cr2', 'cr3', 'nef', 'nrw', 'arw', 'sr2', 'srf', 'orf', 'dng', 'raf', 'rw2', 'pef', 'srw', 'x3f', 'raw'];
const isRawImage = (img: ImageFileInfo): boolean =>
  RAW_EXTENSIONS.includes((img.name.split('.').pop() || '').toLowerCase());

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
  const [ratingFilter, setRatingFilter] = useState<number>(0); // 0 = show all
  const [collapsed, setCollapsed] = useState(false); // filmstrip hidden/shown via the arrow toggle
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const selectedImageRef = useRef<HTMLDivElement>(null);
  const { imageRatings, setImageRating, selectedImageIds, selectionAnchorId, setSelection, toggleImageSelection } = useAppStore();
  const selectedSet = new Set(selectedImageIds ?? []);
  const selectedCount = selectedImageIds?.length ?? 0;

  const filteredImages = useMemo(() => {
    if (ratingFilter === 0) return images;
    return images.filter(img => (imageRatings[img.id] || 0) >= ratingFilter);
  }, [images, imageRatings, ratingFilter]);

  // Load thumbnail for an image
  const loadThumbnail = useCallback(async (image: ImageFileInfo) => {
    // Check current state using functional updates to avoid stale closures
    setLoadingThumbnails(prev => {
      if (prev.has(image.id)) {
        return prev; // Already loading
      }
      return new Set(prev).add(image.id);
    });

    // Check if already loaded
    setThumbnails(prev => {
      if (prev.has(image.id)) {
        // Already loaded, remove from loading set
        setLoadingThumbnails(loading => {
          const newSet = new Set(loading);
          newSet.delete(image.id);
          return newSet;
        });
        return prev;
      }
      return prev;
    });

    try {
      // Try to load thumbnail via Electron API
      if (window.electronAPI) {
        const dataUrl = await window.electronAPI.readImageAsDataURL(image.path);
        if (dataUrl) {
          setThumbnails(prev => new Map(prev).set(image.id, dataUrl));
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
            ctx.fillText(image.format || 'RAW', 75, 60);
          }
          setThumbnails(prev => new Map(prev).set(image.id, canvas.toDataURL()));
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
        setThumbnails(prev => new Map(prev).set(image.id, canvas.toDataURL()));
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
      setThumbnails(prev => new Map(prev).set(image.id, canvas.toDataURL()));
    } finally {
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
  }, [visible, images, selectedImage, onImageSelect, onClose, loadThumbnail]);

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

  const handleThumbnailClick = (image: ImageFileInfo, e: React.MouseEvent) => {
    if (e.shiftKey) {
      // Contiguous range from the anchor to the clicked thumbnail (display order).
      const anchorId = selectionAnchorId ?? selectedImage?.id ?? image.id;
      const aIdx = filteredImages.findIndex(i => i.id === anchorId);
      const bIdx = filteredImages.findIndex(i => i.id === image.id);
      if (aIdx === -1 || bIdx === -1) {
        setSelection([image.id], image.id);
        return;
      }
      const [lo, hi] = aIdx <= bIdx ? [aIdx, bIdx] : [bIdx, aIdx];
      const rangeIds = filteredImages.slice(lo, hi + 1).map(i => i.id);
      setSelection(rangeIds, anchorId);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      // Toggle membership without disturbing the canvas.
      toggleImageSelection(image.id);
      return;
    }
    // Plain click on the SOLE already-selected thumbnail clears its checkmark
    // (re-click toggles the selection off; the image stays on the canvas).
    if (selectedSet.size === 1 && selectedSet.has(image.id)) {
      setSelection([], null);
      return;
    }
    // Plain click: load to canvas and collapse the selection to just this image.
    onImageSelect(image);
    loadThumbnail(image); // no-op if already loaded/loading
    setSelection([image.id], image.id);
  };

  const handleScroll = () => loadVisibleThumbnails();

  if (!visible || images.length === 0) {
    return null;
  }

  const currentIndex = selectedImage ? filteredImages.findIndex(img => img.id === selectedImage.id) : -1;
  const canGoPrevious = currentIndex > 0;
  const canGoNext = currentIndex < filteredImages.length - 1;

  return (
    <div className="border-t flex flex-col" style={{backgroundColor: 'var(--gray-900)', borderTopColor: 'var(--border)', height: collapsed ? 'auto' : '140px'}}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-1 border-b" style={{borderBottomColor: 'var(--border)'}}>
        <div className="flex items-center gap-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{color: 'var(--gray-500)'}}>
            {filteredImages.length}{ratingFilter > 0 ? ` / ${images.length}` : ''} image{filteredImages.length !== 1 ? 's' : ''}
          </h3>
          {selectedImage && currentIndex >= 0 && (
            <span className="text-xs font-mono" style={{color: 'var(--gray-400)'}}>
              {currentIndex + 1} / {filteredImages.length}
            </span>
          )}
          {/* Rating filter */}
          <div className="flex items-center gap-0.5 ml-1">
            {[0, 1, 2, 3, 4, 5].map((min) => (
              <button
                key={min}
                onClick={() => setRatingFilter(min)}
                className="px-1.5 py-0.5 text-xs rounded transition-colors"
                style={{
                  backgroundColor: ratingFilter === min ? 'var(--gray-700)' : 'transparent',
                  color: ratingFilter === min ? 'var(--white)' : 'var(--gray-500)',
                }}
              >
                {min === 0 ? 'All' : `≥${min}★`}
              </button>
            ))}
          </div>
          {/* Multi-export action — shown only when 2+ images are selected */}
          {selectedCount >= 2 && (
            <button
              onClick={() => onExportSelected?.()}
              className="flex items-center gap-1 px-2 py-0.5 text-xs rounded font-medium transition-colors"
              style={{ backgroundColor: '#2563eb', color: 'white' }}
              title="Export the selected images with the same settings"
            >
              <Download className="w-3 h-3" />
              Export {selectedCount}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Navigation Controls */}
          <button
            onClick={handlePrevious}
            disabled={!canGoPrevious}
            className="p-1.5 rounded border transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'transparent',
              borderColor: 'var(--border)',
              color: 'var(--gray-400)',
              cursor: canGoPrevious ? 'pointer' : 'not-allowed'
            }}
            onMouseEnter={(e) => {
              if (canGoPrevious) {
                e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                e.currentTarget.style.color = 'var(--white)';
                e.currentTarget.style.cursor = 'pointer';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--gray-400)';
              e.currentTarget.style.cursor = canGoPrevious ? 'pointer' : 'not-allowed';
            }}
            title="Previous image (←)"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={handleNext}
            disabled={!canGoNext}
            className="p-1.5 rounded border transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'transparent',
              borderColor: 'var(--border)',
              color: 'var(--gray-400)',
              cursor: canGoNext ? 'pointer' : 'not-allowed'
            }}
            onMouseEnter={(e) => {
              if (canGoNext) {
                e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                e.currentTarget.style.color = 'var(--white)';
                e.currentTarget.style.cursor = 'pointer';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--gray-400)';
              e.currentTarget.style.cursor = canGoNext ? 'pointer' : 'not-allowed';
            }}
            title="Next image (→)"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          <div style={{width: '1px', height: '20px', backgroundColor: 'var(--border)', margin: '0 4px'}} />

          <button
            onClick={() => setCollapsed(c => !c)}
            className="p-1.5 rounded border transition-all"
            style={{
              backgroundColor: 'transparent',
              borderColor: 'var(--border)',
              color: 'var(--gray-400)',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--gray-800)';
              e.currentTarget.style.color = 'var(--white)';
              e.currentTarget.style.cursor = 'pointer';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--gray-400)';
              e.currentTarget.style.cursor = 'pointer';
            }}
            title={collapsed ? 'Show thumbnails' : 'Hide thumbnails'}
          >
            {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Thumbnail Strip */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-x-auto overflow-y-hidden px-4 py-2"
        onScroll={handleScroll}
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--gray-700) transparent',
          display: collapsed ? 'none' : undefined
        }}
      >
        <div className="flex gap-2 h-full">
          {filteredImages.map((image) => {
            const isSelected = selectedImage?.id === image.id;
            const inSelection = selectedSet.has(image.id);
            const thumbnail = thumbnails.get(image.id);
            const isLoading = loadingThumbnails.has(image.id);
            const rating = imageRatings[image.id] || 0;

            return (
              <div
                key={image.id}
                ref={isSelected ? selectedImageRef : undefined}
                data-image-id={image.id}
                className="relative flex-shrink-0 rounded border cursor-pointer transition-all h-full"
                style={{
                  width: 'auto',
                  borderWidth: '2px',
                  borderColor: isSelected ? 'var(--white)' : 'var(--border)',
                  backgroundColor: 'var(--gray-800)',
                  boxShadow: isSelected
                    ? '0 0 0 1px var(--white)'
                    : (inSelection ? '0 0 0 2px #3b82f6' : 'none')
                }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-photo-id', image.id);
                  e.dataTransfer.setData('application/x-photo-path', image.path);
                  e.dataTransfer.setData('application/x-photo-name', image.name);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={(e) => handleThumbnailClick(image, e)}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = 'var(--border-light)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = 'var(--border)';
                  }
                }}
                title={`${image.name} (${image.format})`}
              >
                {/* Multi-select check badge (top-left). Click it to toggle the
                    selection off without disturbing the canvas. */}
                {inSelection && (
                  <div
                    data-testid={`check-${image.id}`}
                    role="button"
                    title="Deselect"
                    className="absolute z-10 flex items-center justify-center rounded-full cursor-pointer"
                    style={{ top: '4px', left: '4px', width: '16px', height: '16px', backgroundColor: '#3b82f6' }}
                    onClick={(e) => { e.stopPropagation(); toggleImageSelection(image.id); }}
                  >
                    <Check className="w-2.5 h-2.5" style={{ color: 'white' }} strokeWidth={3} />
                  </div>
                )}

                {isLoading ? (
                  <div className="w-full h-full rounded flex items-center justify-center" style={{backgroundColor: 'var(--gray-800)'}}>
                    <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{borderColor: 'var(--gray-600)', borderTopColor: 'var(--white)'}} />
                  </div>
                ) : thumbnail ? (
                  <img
                    src={thumbnail}
                    alt={image.name}
                    className="h-full object-contain rounded"
                    style={{ width: 'auto', maxWidth: '200px' }}
                    draggable={false}
                  />
                ) : (
                  <div
                    className="w-full h-full rounded flex items-center justify-center"
                    style={{backgroundColor: 'var(--gray-800)'}}
                    onClick={() => loadThumbnail(image)}
                  >
                    <span className="text-xs text-center px-1" style={{color: 'var(--gray-500)'}}>
                      {image.format}
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

                {/* Star rating overlay */}
                <div
                  className="absolute bottom-0 left-0 right-0 flex justify-center py-0.5"
                  style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <StarRating
                    size={10}
                    rating={rating}
                    onRate={(newRating) => {
                      setImageRating(image.id, newRating);
                      // Persist to the file (xmp:Rating) so it shows in OS file details.
                      window.electronAPI?.writeImageRating?.(image.path, newRating);
                    }}
                  />
                </div>

                {/* Selected indicator */}
                {isSelected && (
                  <div className="absolute rounded-full" style={{top: '-4px', right: '-4px', width: '10px', height: '10px', backgroundColor: 'var(--white)', border: '2px solid var(--gray-900)'}} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}