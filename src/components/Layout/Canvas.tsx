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

export function Canvas({ onFitWindow: _onFitWindow, onActualSize: _onActualSize, onZoomIn: _onZoomIn, onZoomOut: _onZoomOut, zoom: _zoom, currentImage }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { viewport, setViewport, processedImageData } = useAppStore();
  const [isDragging, setIsDragging] = useState(false);
  const [lastPan, setLastPan] = useState({ x: 0, y: 0 });
  const [displayImage, setDisplayImage] = useState<ImageFileInfo | null>(null);
  const [imageLoading, setImageLoading] = useState(false);

  const drawLoadedImage = useCallback((ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, imageMetadata: { width: number; height: number }, imageData: Float32Array) => {
    const { width: imageWidth, height: imageHeight } = imageMetadata;

    // Validate image dimensions
    if (imageWidth <= 0 || imageHeight <= 0) {
      console.error('Canvas: Invalid image dimensions:', imageWidth, 'x', imageHeight);
      return;
    }

    // Validate and convert image data if needed
    const expectedDataLength = imageWidth * imageHeight * 4; // RGBA
    if (imageData.length !== expectedDataLength) {
      // Try to handle common cases like RGB to RGBA conversion
      if (imageData.length === imageWidth * imageHeight * 3) {
        const rgbaData = new Float32Array(expectedDataLength);
        for (let i = 0; i < imageWidth * imageHeight; i++) {
          rgbaData[i * 4] = imageData[i * 3];     // R
          rgbaData[i * 4 + 1] = imageData[i * 3 + 1]; // G
          rgbaData[i * 4 + 2] = imageData[i * 3 + 2]; // B
          rgbaData[i * 4 + 3] = 1.0;  // A (opaque) - use 1.0 for normalized data
        }
        imageData = rgbaData;
      } else {
        console.warn('Canvas: Unexpected image data format, length:', imageData.length, 'expected:', expectedDataLength);
      }
    }

    // Create ImageData from Float32Array
    const imgData = ctx.createImageData(imageWidth, imageHeight);
    const data = imgData.data;

    // Convert float data to uint8 for canvas display
    // Check if data is already in 0-255 range or needs scaling from 0-1
    const sampleSize = Math.min(1000, imageData.length);
    const maxValue = Math.max(...imageData.slice(0, sampleSize));
    const minValue = Math.min(...imageData.slice(0, sampleSize));
    const isNormalized = maxValue <= 1.0 && minValue >= 0;

    console.log('Canvas: Data analysis - min:', minValue, 'max:', maxValue, 'isNormalized:', isNormalized, 'sampleSize:', sampleSize);

    // Validate data range
    if (maxValue > 255 || minValue < 0) {
      console.warn('Canvas: Unusual data range detected:', minValue, 'to', maxValue);
    }

    for (let i = 0; i < Math.min(imageData.length, data.length); i++) {
      if (isNormalized) {
        // Data is in 0-1 range, scale to 0-255
        data[i] = Math.round(Math.max(0, Math.min(1, imageData[i])) * 255);
      } else {
        // Data is already in 0-255 range, just clamp
        data[i] = Math.round(Math.max(0, Math.min(255, imageData[i])));
      }
    }

    // Validate converted data
    if (data.length !== expectedDataLength) {
      console.error('Canvas: Failed to create proper ImageData');
      return;
    }

    // Calculate display dimensions and position
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Since canvas is already sized to match image aspect ratio,
    // we can draw the image to fill the entire canvas
    let displayWidth = canvas.width;
    let displayHeight = canvas.height;

    // Apply zoom
    displayWidth *= viewport.zoom;
    displayHeight *= viewport.zoom;

    // Ensure display dimensions are valid
    if (displayWidth <= 0 || displayHeight <= 0) {
      console.error('Canvas: Invalid display dimensions:', displayWidth, 'x', displayHeight);
      return;
    }

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

    // Ensure the image is drawn with correct aspect ratio
    ctx.drawImage(
      tempCanvas,
      0, 0, imageWidth, imageHeight,  // Source rectangle (full image)
      -displayWidth / 2,              // Destination x
      -displayHeight / 2,             // Destination y
      displayWidth,                   // Destination width
      displayHeight                   // Destination height
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

    const currentImageData = imageService.getCurrentImage();

    // Calculate proper canvas dimensions based on image aspect ratio
    const rect = container.getBoundingClientRect();
    const containerWidth = rect.width;
    const containerHeight = rect.height;

    let canvasWidth, canvasHeight;

    if (currentImageData && displayImage) {
      // Use image dimensions to determine proper aspect ratio
      const imageAspectRatio = currentImageData.width / currentImageData.height;
      const containerAspectRatio = containerWidth / containerHeight;

      if (imageAspectRatio > containerAspectRatio) {
        // Image is wider - fit to width
        canvasWidth = containerWidth * 0.95; // Leave small margin
        canvasHeight = canvasWidth / imageAspectRatio;
      } else {
        // Image is taller - fit to height
        canvasHeight = containerHeight * 0.95; // Leave small margin
        canvasWidth = canvasHeight * imageAspectRatio;
      }
    } else {
      // No image loaded - use container size for placeholder
      canvasWidth = containerWidth;
      canvasHeight = containerHeight;
    }

    // Set canvas size to calculated dimensions
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Update canvas CSS size to match calculated dimensions
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;

    // Clear canvas
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (currentImageData && displayImage) {
      // Use processed image data if available, otherwise use original
      if (processedImageData && typeof processedImageData === 'object' && 'data' in processedImageData) {
        // Handle new preview data structure
        const previewData = processedImageData as { data: Float32Array; width: number; height: number; isPreview: boolean };
        console.log('Canvas: Using processed preview data', previewData.width, 'x', previewData.height);
        drawLoadedImage(ctx, canvas, { width: previewData.width, height: previewData.height }, previewData.data);
      } else if (processedImageData && processedImageData instanceof Float32Array) {
        // Handle legacy data structure
        console.log('Canvas: Using legacy processed data', currentImageData.width, 'x', currentImageData.height);
        drawLoadedImage(ctx, canvas, currentImageData, processedImageData);
      } else {
        // Use original image data
        console.log('Canvas: Using original image data', currentImageData.width, 'x', currentImageData.height, 'channels detected');
        drawLoadedImage(ctx, canvas, currentImageData, currentImageData.data);
      }
    } else {
      // Draw placeholder content
      drawPlaceholder(ctx, canvas);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedImageData, displayImage]);

  const loadImage = useCallback(async (image: ImageFileInfo) => {
    try {
      setImageLoading(true);
      setDisplayImage(image);

      // Load image using ImageService
      await imageService.loadImage(image.path);

      // Canvas will be redrawn by the useEffect that watches for processedImageData changes
      // No need to manually call redrawCanvas here

      // Trigger initial processing with the loaded image
      // This will be handled by the AdjustmentPanel's useEffect
    } catch (error) {
      console.error('Failed to load image:', error);
    } finally {
      setImageLoading(false);
    }
  }, []);

  // Handle image loading from file system
  useEffect(() => {
    if (currentImage && currentImage !== displayImage) {
      loadImage(currentImage);
    }
  }, [currentImage, displayImage, loadImage]);

  // Redraw canvas when processed image data changes
  useEffect(() => {
    redrawCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedImageData, displayImage]);


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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport]);

  // Handle window/container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new window.ResizeObserver(() => {
      redrawCanvas();
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [redrawCanvas]);

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
        {/* Aspect ratio preserving canvas container */}
        <div className="flex items-center justify-center w-full h-full">
          <canvas
            ref={canvasRef}
            className={`max-w-full max-h-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            style={{
              // Maintain aspect ratio while fitting in container
              objectFit: 'contain',
              width: 'auto',
              height: 'auto'
            }}
          />
        </div>

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