import { useRef, useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { fileSystemService, ImageFileInfo } from '../../services/FileSystemService';
import { imageService } from '../../services/ImageService';

interface CanvasProps {
  onFitWindow: () => void;
  onActualSize: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  zoom: number;
  currentImage?: ImageFileInfo | null;
}

export function Canvas({ onFitWindow, onActualSize, onZoomIn, onZoomOut, zoom, currentImage }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { viewport, setViewport, processedImageData } = useAppStore();
  const [isDragging, setIsDragging] = useState(false);
  const [lastPan, setLastPan] = useState({ x: 0, y: 0 });
  const [displayImage, setDisplayImage] = useState<ImageFileInfo | null>(null);
  const [imageLoading, setImageLoading] = useState(false);

  const drawLoadedImage = useCallback((ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, imageMetadata: { width: number; height: number }, imageData: Float32Array) => {
    const { width: imageWidth, height: imageHeight } = imageMetadata;

    // Create ImageData from Float32Array
    const imgData = ctx.createImageData(imageWidth, imageHeight);
    const data = imgData.data;

    // Convert float data (0-1) back to uint8 (0-255) for canvas display
    for (let i = 0; i < imageData.length; i++) {
      data[i] = Math.round(Math.max(0, Math.min(1, imageData[i])) * 255);
    }

    // Calculate display dimensions and position
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Calculate fit-to-window size
    const imageAspectRatio = imageWidth / imageHeight;
    const canvasAspectRatio = canvas.width / canvas.height;

    let displayWidth, displayHeight;
    if (imageAspectRatio > canvasAspectRatio) {
      // Image is wider - fit to width with margin
      displayWidth = canvas.width * 0.9; // 90% of canvas width for margin
      displayHeight = displayWidth / imageAspectRatio;
    } else {
      // Image is taller - fit to height with margin
      displayHeight = canvas.height * 0.9; // 90% of canvas height for margin
      displayWidth = displayHeight * imageAspectRatio;
    }

    // Apply zoom
    displayWidth *= viewport.zoom;
    displayHeight *= viewport.zoom;

    // Create temporary canvas for the image
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;

    tempCanvas.width = imageWidth;
    tempCanvas.height = imageHeight;
    tempCtx.putImageData(imgData, 0, 0);

    // Draw the scaled image on the main canvas
    ctx.save();
    ctx.translate(centerX + viewport.panX, centerY + viewport.panY);

    ctx.drawImage(
      tempCanvas,
      -displayWidth / 2,
      -displayHeight / 2,
      displayWidth,
      displayHeight
    );

    ctx.restore();

    // Draw image border
    ctx.strokeStyle = '#525252';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      centerX + viewport.panX - displayWidth / 2,
      centerY + viewport.panY - displayHeight / 2,
      displayWidth,
      displayHeight
    );
  }, [viewport]);

  const drawPlaceholder = useCallback((ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    // Draw grid pattern
    ctx.strokeStyle = '#262626';
    ctx.lineWidth = 1;
    const gridSize = 20;

    for (let x = 0; x < canvas.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }

    for (let y = 0; y < canvas.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Draw placeholder text
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    ctx.fillStyle = '#525252';
    ctx.font = 'bold 24px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('No Image Loaded', centerX, centerY - 20);

    ctx.fillStyle = '#404040';
    ctx.font = '16px system-ui';
    ctx.fillText('Select an image from the file browser', centerX, centerY + 10);
    ctx.fillText('or drag and drop a file here', centerX, centerY + 30);
  }, []);

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const container = containerRef.current;
    if (!container) return;

    // Set canvas size to match container
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Clear canvas
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const currentImageData = imageService.getCurrentImage();
    if (currentImageData && displayImage) {
      // Use processed image data if available, otherwise use original
      if (processedImageData && typeof processedImageData === 'object' && 'data' in processedImageData) {
        // Handle new preview data structure
        const previewData = processedImageData as { data: Float32Array; width: number; height: number; isPreview: boolean };
        drawLoadedImage(ctx, canvas, { width: previewData.width, height: previewData.height }, previewData.data);
      } else if (processedImageData && processedImageData instanceof Float32Array) {
        // Handle legacy data structure
        drawLoadedImage(ctx, canvas, currentImageData, processedImageData);
      } else {
        // Use original image data
        drawLoadedImage(ctx, canvas, currentImageData, currentImageData.data);
      }
    } else {
      // Draw placeholder content
      drawPlaceholder(ctx, canvas);
    }
  }, [processedImageData, displayImage, drawLoadedImage, drawPlaceholder]);

  const loadImage = useCallback(async (image: ImageFileInfo) => {
    try {
      setImageLoading(true);
      setDisplayImage(image);

      // Load image using ImageService
      await imageService.loadImage(image.path);

      // Update canvas with loaded image
      redrawCanvas();

      // Trigger initial processing with the loaded image
      // This will be handled by the AdjustmentPanel's useEffect
    } catch (error) {
      console.error('Failed to load image:', error);
    } finally {
      setImageLoading(false);
    }
  }, [redrawCanvas]);

  // Handle image loading from file system
  useEffect(() => {
    if (currentImage && currentImage !== displayImage) {
      loadImage(currentImage);
    }
  }, [currentImage, displayImage, loadImage]);

  // Redraw canvas when processed image data changes
  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);


  const navigateImage = async (direction: 'next' | 'prev') => {
    const newImage = direction === 'next'
      ? fileSystemService.nextImage()
      : fileSystemService.previousImage();

    if (newImage) {
      await loadImage(newImage);
    }
  };


  // Redraw canvas when viewport changes
  useEffect(() => {
    redrawCanvas();
  }, [viewport, redrawCanvas]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setLastPan({ x: e.clientX - viewport.panX, y: e.clientY - viewport.panY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;

    const newPanX = e.clientX - lastPan.x;
    const newPanY = e.clientY - lastPan.y;
    setViewport({ panX: newPanX, panY: newPanY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.max(0.1, Math.min(5, viewport.zoom + delta));
    setViewport({ zoom: newZoom });
  };

  return (
    <div className="h-full bg-dark-900">
      {/* Main Canvas Area */}
      <div
        ref={containerRef}
        className="h-full relative overflow-hidden"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <canvas
          ref={canvasRef}
          className={`w-full h-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        />

        {/* Optional debug info - can be removed */}
        {process.env.NODE_ENV === 'development' && (
          <div className="absolute top-4 left-4 bg-dark-850/90 backdrop-blur-sm rounded-professional px-3 py-2 text-xs text-dark-300">
            <div>Zoom: {Math.round(viewport.zoom * 100)}%</div>
            <div>Pan: {Math.round(viewport.panX)}, {Math.round(viewport.panY)}</div>
          </div>
        )}

        {/* Image Navigation Arrows */}
        {displayImage && (
          <>
            <button
              onClick={() => navigateImage('prev')}
              className="absolute left-4 top-1/2 transform -translate-y-1/2 p-2 bg-dark-800/80 hover:bg-dark-700/90 rounded-full text-dark-300 transition-professional backdrop-blur-sm"
              disabled={imageLoading}
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={() => navigateImage('next')}
              className="absolute right-4 top-1/2 transform -translate-y-1/2 p-2 bg-dark-800/80 hover:bg-dark-700/90 rounded-full text-dark-300 transition-professional backdrop-blur-sm"
              disabled={imageLoading}
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}

        {/* Image Info Overlay */}
        {displayImage && (
          <div className="absolute top-4 right-4 bg-dark-850/90 backdrop-blur-sm rounded-professional px-3 py-2 text-xs text-dark-300">
            <div className="text-right">
              <div className="font-medium">{displayImage.name}</div>
              <div className="text-dark-400">
                {fileSystemService.getCurrentImageInfo().current} of {fileSystemService.getCurrentImageInfo().total}
              </div>
            </div>
          </div>
        )}

        {/* Loading Indicator */}
        {imageLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-dark-900/50 backdrop-blur-sm">
            <div className="animate-spin rounded-full h-8 w-8 border border-dark-300 border-t-transparent" />
          </div>
        )}

        {/* Crosshair in center when no image */}
        {!displayImage && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-px h-8 bg-dark-600"></div>
            <div className="absolute w-8 h-px bg-dark-600"></div>
          </div>
        )}
      </div>

    </div>
  );
}