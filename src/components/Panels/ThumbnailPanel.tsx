import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { ImageFileInfo } from '../../services/FileSystemService';
import { logger } from '../../utils/Logger';

interface ThumbnailPanelProps {
  images: ImageFileInfo[];
  selectedImage?: ImageFileInfo;
  onImageSelect: (image: ImageFileInfo) => void;
  onClose: () => void;
  visible: boolean;
}

export function ThumbnailPanel({
  images,
  selectedImage,
  onImageSelect,
  onClose,
  visible
}: ThumbnailPanelProps) {
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const [loadingThumbnails, setLoadingThumbnails] = useState<Set<string>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const selectedImageRef = useRef<HTMLDivElement>(null);

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

  // Load visible thumbnails
  useEffect(() => {
    if (!visible || images.length === 0) return;

    // Load first few thumbnails immediately
    const initialLoad = images.slice(0, 10);
    initialLoad.forEach(loadThumbnail);
  }, [images, visible, loadThumbnail]);

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

  // Navigate with arrow keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!visible || images.length === 0) return;

      const currentIndex = selectedImage ? images.findIndex(img => img.id === selectedImage.id) : -1;

      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        const prevImage = images[currentIndex - 1];
        onImageSelect(prevImage);
        // Trigger thumbnail load (will be a no-op if already loaded/loading)
        loadThumbnail(prevImage);
        e.preventDefault();
      } else if (e.key === 'ArrowRight' && currentIndex < images.length - 1) {
        const nextImage = images[currentIndex + 1];
        onImageSelect(nextImage);
        // Trigger thumbnail load (will be a no-op if already loaded/loading)
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
    if (!selectedImage || images.length === 0) return;
    const currentIndex = images.findIndex(img => img.id === selectedImage.id);
    if (currentIndex > 0) {
      const prevImage = images[currentIndex - 1];
      onImageSelect(prevImage);
      // Trigger thumbnail load (will be a no-op if already loaded/loading)
      loadThumbnail(prevImage);
    }
  };

  const handleNext = () => {
    if (!selectedImage || images.length === 0) return;
    const currentIndex = images.findIndex(img => img.id === selectedImage.id);
    if (currentIndex < images.length - 1) {
      const nextImage = images[currentIndex + 1];
      onImageSelect(nextImage);
      // Trigger thumbnail load (will be a no-op if already loaded/loading)
      loadThumbnail(nextImage);
    }
  };

  const handleThumbnailClick = (image: ImageFileInfo) => {
    onImageSelect(image);
    // Trigger thumbnail load (will be a no-op if already loaded/loading)
    loadThumbnail(image);
  };

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;

    // Load thumbnails for visible images
    const container = scrollContainerRef.current;
    const thumbnailElements = container.querySelectorAll('[data-image-id]');

    thumbnailElements.forEach((element) => {
      const rect = element.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      // Check if thumbnail is visible
      if (rect.left < containerRect.right && rect.right > containerRect.left) {
        const imageId = element.getAttribute('data-image-id');
        const image = images.find(img => img.id === imageId);
        if (image) {
          // Trigger thumbnail load (will be a no-op if already loaded/loading)
          loadThumbnail(image);
        }
      }
    });
  };

  if (!visible || images.length === 0) {
    return null;
  }

  const currentIndex = selectedImage ? images.findIndex(img => img.id === selectedImage.id) : -1;
  const canGoPrevious = currentIndex > 0;
  const canGoNext = currentIndex < images.length - 1;

  return (
    <div className="border-t flex flex-col" style={{backgroundColor: 'var(--gray-900)', borderTopColor: 'var(--border)', height: '140px'}}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-1 border-b" style={{borderBottomColor: 'var(--border)'}}>
        <div className="flex items-center gap-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{color: 'var(--gray-500)'}}>
            {images.length} image{images.length !== 1 ? 's' : ''}
          </h3>
          {selectedImage && (
            <span className="text-xs font-mono" style={{color: 'var(--gray-400)'}}>
              {currentIndex + 1} / {images.length}
            </span>
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
            onClick={onClose}
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
            title="Close thumbnail panel (Esc)"
          >
            <X className="w-3.5 h-3.5" />
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
          scrollbarColor: 'var(--gray-700) transparent'
        }}
      >
        <div className="flex gap-2 h-full">
          {images.map((image) => {
            const isSelected = selectedImage?.id === image.id;
            const thumbnail = thumbnails.get(image.id);
            const isLoading = loadingThumbnails.has(image.id);

            // Determine aspect ratio from image metadata or default
            // Most images will have metadata available from the ImageFileInfo
            // For now, we'll use a default and let the actual image determine the aspect ratio
            // when it loads, but we can optimize this later with metadata

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
                  boxShadow: isSelected ? '0 0 0 1px var(--white)' : 'none'
                }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-photo-id', image.id);
                  e.dataTransfer.setData('application/x-photo-path', image.path);
                  e.dataTransfer.setData('application/x-photo-name', image.name);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => handleThumbnailClick(image)}
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