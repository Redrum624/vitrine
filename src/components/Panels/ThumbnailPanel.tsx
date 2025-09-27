import { useState, useEffect, useRef } from 'react';
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
  const loadThumbnail = async (image: ImageFileInfo) => {
    if (thumbnails.has(image.id) || loadingThumbnails.has(image.id)) {
      return;
    }

    setLoadingThumbnails(prev => new Set(prev).add(image.id));

    try {
      // Try to load thumbnail via Electron API
      if (window.electronAPI) {
        const dataUrl = await window.electronAPI.readImageAsDataURL(image.path);
        setThumbnails(prev => new Map(prev).set(image.id, dataUrl));
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
  };

  // Load visible thumbnails
  useEffect(() => {
    if (!visible || images.length === 0) return;

    // Load first few thumbnails immediately
    const initialLoad = images.slice(0, 10);
    initialLoad.forEach(loadThumbnail);
  }, [images, visible]);

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
        onImageSelect(images[currentIndex - 1]);
        e.preventDefault();
      } else if (e.key === 'ArrowRight' && currentIndex < images.length - 1) {
        onImageSelect(images[currentIndex + 1]);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        onClose();
        e.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, images, selectedImage, onImageSelect, onClose]);

  const handlePrevious = () => {
    if (!selectedImage || images.length === 0) return;
    const currentIndex = images.findIndex(img => img.id === selectedImage.id);
    if (currentIndex > 0) {
      onImageSelect(images[currentIndex - 1]);
    }
  };

  const handleNext = () => {
    if (!selectedImage || images.length === 0) return;
    const currentIndex = images.findIndex(img => img.id === selectedImage.id);
    if (currentIndex < images.length - 1) {
      onImageSelect(images[currentIndex + 1]);
    }
  };

  const handleThumbnailClick = (image: ImageFileInfo) => {
    onImageSelect(image);
    // Load thumbnail if not already loaded
    if (!thumbnails.has(image.id)) {
      loadThumbnail(image);
    }
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
        if (image && !thumbnails.has(image.id) && !loadingThumbnails.has(image.id)) {
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
    <div className="bg-dark-900 border-t border-dark-700 h-32 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-dark-700">
        <div className="flex items-center space-x-4">
          <h3 className="text-sm font-medium text-dark-300">
            {images.length} image{images.length !== 1 ? 's' : ''}
          </h3>
          {selectedImage && (
            <span className="text-xs text-dark-400">
              {currentIndex + 1} of {images.length}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {/* Navigation Controls */}
          <button
            onClick={handlePrevious}
            disabled={!canGoPrevious}
            className="p-1 rounded hover:bg-dark-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Previous image (←)"
          >
            <ChevronLeft className="w-4 h-4 text-dark-300" />
          </button>

          <button
            onClick={handleNext}
            disabled={!canGoNext}
            className="p-1 rounded hover:bg-dark-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Next image (→)"
          >
            <ChevronRight className="w-4 h-4 text-dark-300" />
          </button>

          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-dark-700 text-dark-400 hover:text-dark-300"
            title="Close thumbnail panel (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Thumbnail Strip */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-x-auto overflow-y-hidden p-2"
        onScroll={handleScroll}
      >
        <div className="flex space-x-2 h-full">
          {images.map((image) => {
            const isSelected = selectedImage?.id === image.id;
            const thumbnail = thumbnails.get(image.id);
            const isLoading = loadingThumbnails.has(image.id);

            return (
              <div
                key={image.id}
                ref={isSelected ? selectedImageRef : undefined}
                data-image-id={image.id}
                className={`
                  relative flex-shrink-0 w-24 h-16 rounded border-2 cursor-pointer transition-all
                  ${isSelected
                    ? 'border-primary-500 shadow-lg ring-2 ring-primary-500/30'
                    : 'border-dark-600 hover:border-dark-500'
                  }
                `}
                onClick={() => handleThumbnailClick(image)}
                title={`${image.name} (${image.format})`}
              >
                {isLoading ? (
                  <div className="w-full h-full bg-dark-800 rounded flex items-center justify-center">
                    <div className="w-4 h-4 border-2 border-dark-400 border-t-primary-500 rounded-full animate-spin" />
                  </div>
                ) : thumbnail ? (
                  <img
                    src={thumbnail}
                    alt={image.name}
                    className="w-full h-full object-cover rounded"
                    draggable={false}
                  />
                ) : (
                  <div
                    className="w-full h-full bg-dark-800 rounded flex items-center justify-center"
                    onClick={() => loadThumbnail(image)}
                  >
                    <span className="text-xs text-dark-400 text-center px-1">
                      {image.format}
                    </span>
                  </div>
                )}

                {/* Selected indicator */}
                {isSelected && (
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-primary-500 rounded-full border-2 border-dark-900" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}