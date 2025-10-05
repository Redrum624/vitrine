import { useRef, useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { fileSystemService, ImageFileInfo } from '../../services/FileSystemService';
import { imageService } from '../../services/ImageService';
import { logger } from '../../utils/Logger';
import { CropTransformOverlay } from '../Canvas/CropTransformOverlay';
import { InteractiveCropHandles } from '../Canvas/InteractiveCropHandles';
import { imageProcessingPipeline } from '../../services/ImageProcessingPipeline';
import { CropPipelineModule } from '../../modules/CropPipelineModule';


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
  const [cropModule, setCropModule] = useState<CropPipelineModule | null>(null);
  const [showCropOverlay, setShowCropOverlay] = useState(false);

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

  // Performance optimization: cache canvas context and ImageData
  const canvasCache = useRef<{
    lastWidth?: number;
    lastHeight?: number;
    imageData?: ImageData;
    lastDataHash?: string;
  }>({});

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
      // CRITICAL FIX: Set canvas internal resolution to match the data we're actually drawing
      // This prevents browser from stretching the image
      let dataWidth = currentImageData.width;
      let dataHeight = currentImageData.height;

      // Check if we have processed preview data - use its dimensions directly as canvas size
      if (processedImageData && typeof processedImageData === 'object' && 'data' in processedImageData) {
        const previewData = processedImageData as { data: Float32Array; width: number; height: number; isPreview: boolean };
        dataWidth = previewData.width;
        dataHeight = previewData.height;
      }

      // Set canvas to exact data dimensions (1:1 pixel mapping, no upscaling)
      canvasWidth = dataWidth;
      canvasHeight = dataHeight;

      const imageAspectRatio = dataWidth / dataHeight;
      const containerAspectRatio = containerWidth / containerHeight;

      console.log(`🎨 CANVAS SIZING DEBUG:
  Container: ${containerWidth}x${containerHeight} (aspect: ${containerAspectRatio.toFixed(3)})
  Data: ${dataWidth}x${dataHeight} (aspect: ${imageAspectRatio.toFixed(3)})
  Canvas will be set to EXACT data size: ${canvasWidth}x${canvasHeight} (1:1 pixel mapping)
  Original Image: ${currentImageData.width}x${currentImageData.height}`);

      console.log(`  Canvas internal resolution: ${canvasWidth}x${canvasHeight}`);
    } else {
      // No image loaded - use container size for placeholder
      canvasWidth = containerWidth;
      canvasHeight = containerHeight;
    }

    // Set canvas internal resolution to exact data size
    canvas.width = Math.floor(canvasWidth);
    canvas.height = Math.floor(canvasHeight);

    // Calculate CSS display size to fit container while maintaining aspect ratio
    let displayWidth, displayHeight;
    if (currentImageData && displayImage) {
      const imageAspectRatio = canvas.width / canvas.height;
      const containerAspectRatio = containerWidth / containerHeight;

      if (imageAspectRatio > containerAspectRatio) {
        // Image is wider - fit to width
        displayWidth = containerWidth;
        displayHeight = containerWidth / imageAspectRatio;
      } else {
        // Image is taller - fit to height
        displayHeight = containerHeight;
        displayWidth = containerHeight * imageAspectRatio;
      }
    } else {
      displayWidth = canvas.width;
      displayHeight = canvas.height;
    }

    // Set CSS size to fit container (browser will scale smoothly)
    canvas.style.width = `${Math.floor(displayWidth)}px`;
    canvas.style.height = `${Math.floor(displayHeight)}px`;

    console.log(`  Canvas element set to:
    Internal: ${canvas.width}x${canvas.height}
    CSS Display: ${canvas.style.width} x ${canvas.style.height}
    Computed: ${window.getComputedStyle(canvas).width} x ${window.getComputedStyle(canvas).height}
    Scale factor: ${(displayWidth / canvas.width).toFixed(2)}x`);

    // Clear canvas
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (currentImageData && displayImage) {
      // Use processed image data if available, otherwise use original
      if (processedImageData && typeof processedImageData === 'object' && 'data' in processedImageData) {
        // Handle new preview data structure
        const previewData = processedImageData as { data: Float32Array; width: number; height: number; isPreview: boolean };
        console.log('Canvas: Using processed preview data', previewData.width, 'x', previewData.height);

        // CRITICAL: Debug data integrity immediately upon receiving
        const stats = { min: Infinity, max: -Infinity, nonZero: 0 };
        for (let i = 0; i < previewData.data.length; i += 4) {
          const r = previewData.data[i], g = previewData.data[i + 1], b = previewData.data[i + 2];
          stats.min = Math.min(stats.min, r, g, b);
          stats.max = Math.max(stats.max, r, g, b);
          if (r > 0.001 || g > 0.001 || b > 0.001) stats.nonZero++;
        }
        logger.info(`Canvas: RECEIVED DATA integrity - range=${stats.min.toFixed(4)}-${stats.max.toFixed(4)}, nonZero=${stats.nonZero}/${previewData.data.length/4}`);

        // Debug processed data before drawing
        const sampleData = previewData.data.slice(0, 100);
        const hasData = sampleData.some(val => val > 0);
        console.log('Canvas: Processed data check - hasData:', hasData, 'sample:', sampleData.slice(0, 8));

        if (!hasData) {
          console.warn('Canvas: Processed data appears to be all zeros, falling back to original data');
          drawLoadedImageOptimized(ctx, canvas, currentImageData, currentImageData.data);
        } else {
          // Check if processed data is mostly zeros despite having some data
          const processedSample = previewData.data.slice(0, 1000);
          const nonZeroCount = processedSample.filter(val => val > 0).length;
          const blackPixelRatio = 1 - (nonZeroCount / processedSample.length);

          console.log(`Canvas: Processed data quality check - nonZero: ${nonZeroCount}/1000 (${(100-blackPixelRatio*100).toFixed(1)}% visible)`);

          if (blackPixelRatio > 0.95) { // If more than 95% black pixels
            console.warn('Canvas: Processed data is mostly black, using original image data instead');
            drawLoadedImageOptimized(ctx, canvas, currentImageData, currentImageData.data);
          } else {
            console.log('Canvas: Using processed preview data for module effects');
            drawLoadedImageOptimized(ctx, canvas, { width: previewData.width, height: previewData.height }, previewData.data);
          }
        }
      } else if (processedImageData && processedImageData instanceof Float32Array) {
        // Handle legacy data structure
        console.log('Canvas: Using legacy processed data', currentImageData.width, 'x', currentImageData.height);
        drawLoadedImageOptimized(ctx, canvas, currentImageData, processedImageData);
      } else {
        // Use original image data
        console.log('Canvas: Using original image data', currentImageData.width, 'x', currentImageData.height, 'channels detected');
        drawLoadedImageOptimized(ctx, canvas, currentImageData, currentImageData.data);
      }
    } else {
      // Draw placeholder content
      drawPlaceholder(ctx, canvas);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedImageData, displayImage, viewport]);

  // Optimized image drawing with caching and requestAnimationFrame
  const drawLoadedImageOptimized = useCallback((ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, imageInfo: { width: number; height: number }, data: Float32Array) => {
    try {
      const startTime = performance.now();

      // Generate hash for cache comparison (includes actual data sampling for processed images)
      // For processed images, we need to sample actual pixel values to detect changes
      let dataHash = `${imageInfo.width}x${imageInfo.height}_${data.length}`;

      // Add sampling of actual pixel values for better cache invalidation
      if (data.length > 0) {
        // Sample pixels more densely to ensure we catch non-zero values
        const sampleIndices = [];
        const totalPixels = data.length / 4;
        const sampleCount = Math.min(100, Math.max(50, Math.floor(totalPixels / 100))); // Sample 50-100 pixels

        // CRITICAL FIX: Use multiple sampling strategies to ensure we find non-zero values
        // Strategy 1: Systematic sampling across the entire image
        for (let i = 0; i < sampleCount; i++) {
          const pixelIndex = Math.floor((i * totalPixels) / sampleCount);
          const pixelStart = pixelIndex * 4;
          if (pixelStart + 2 < data.length) {
            sampleIndices.push(pixelStart);     // R
            sampleIndices.push(pixelStart + 1); // G
            sampleIndices.push(pixelStart + 2); // B
          }
        }

        // Strategy 2: Sample from center area where image content is most likely
        const centerY = Math.floor(imageInfo.height / 2);
        const centerX = Math.floor(imageInfo.width / 2);
        const centerRange = Math.min(imageInfo.width, imageInfo.height) / 4;
        for (let dy = -centerRange; dy <= centerRange; dy += Math.floor(centerRange / 10)) {
          for (let dx = -centerRange; dx <= centerRange; dx += Math.floor(centerRange / 10)) {
            const y = centerY + dy;
            const x = centerX + dx;
            if (y >= 0 && y < imageInfo.height && x >= 0 && x < imageInfo.width) {
              const pixelStart = (y * imageInfo.width + x) * 4;
              if (pixelStart + 2 < data.length) {
                sampleIndices.push(pixelStart);     // R
                sampleIndices.push(pixelStart + 1); // G
                sampleIndices.push(pixelStart + 2); // B
              }
            }
          }
        }

        // Create hash from sampled values
        const samples = sampleIndices.map(i => data[i] ? data[i].toFixed(4) : '0').join(',');
        dataHash += `_${samples}`;

        // Debug the sampling with better statistics
        const pixelsSampled = sampleIndices.length / 3;
        const nonZeroSamples = sampleIndices.filter(i => data[i] > 0.0001).length; // Lower threshold
        const minSample = Math.min(...sampleIndices.map(i => data[i]));
        const maxSample = Math.max(...sampleIndices.map(i => data[i]));
        console.log(`Canvas: Data sampling - ${pixelsSampled} pixels, ${nonZeroSamples} non-zero, range: ${minSample.toFixed(6)}-${maxSample.toFixed(6)}`);
      }

      // Check if we can reuse cached ImageData
      const cache = canvasCache.current;

      // Debug cache comparison
      console.log(`Canvas: Cache check - current hash: ${dataHash}, cached hash: ${cache.lastDataHash || 'none'}`);
      console.log(`Canvas: Dimensions match: ${cache.lastWidth === imageInfo.width && cache.lastHeight === imageInfo.height}`);

      if (cache.imageData &&
          cache.lastWidth === imageInfo.width &&
          cache.lastHeight === imageInfo.height &&
          cache.lastDataHash === dataHash) {

        // Reuse cached ImageData - just redraw with current viewport
        console.log('Canvas: ✅ Using cached render (data unchanged)');

        // Canvas is already sized correctly - just use its dimensions
        // No need to calculate aspect ratio fitting again
        const baseWidth = canvas.width;
        const baseHeight = canvas.height;

        const scaledWidth = baseWidth * viewport.zoom;
        const scaledHeight = baseHeight * viewport.zoom;
        const x = (canvas.width - scaledWidth) / 2 + viewport.panX;
        const y = (canvas.height - scaledHeight) / 2 + viewport.panY;

        console.log(`🖼️ DRAWING (cached):
  Canvas: ${canvas.width}x${canvas.height}
  BaseSize: ${baseWidth}x${baseHeight}
  Scaled: ${scaledWidth}x${scaledHeight}
  Position: (${x}, ${y})
  Source: ${imageInfo.width}x${imageInfo.height}`);

        // Optimize rendering based on zoom level
        ctx.imageSmoothingEnabled = viewport.zoom < 1;
        ctx.imageSmoothingQuality = viewport.zoom < 0.5 ? 'low' : 'high';

        // Create temporary canvas for cached ImageData
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imageInfo.width;
        tempCanvas.height = imageInfo.height;
        const tempCtx = tempCanvas.getContext('2d')!;
        tempCtx.putImageData(cache.imageData, 0, 0);

        ctx.drawImage(
          tempCanvas,
          0, 0, imageInfo.width, imageInfo.height,  // Source: full image
          x, y, scaledWidth, scaledHeight            // Dest: scaled display
        );

        const renderTime = performance.now() - startTime;
        console.log(`Canvas: Cached render completed in ${renderTime.toFixed(2)}ms`);
        return;
      }

      // Cache miss - need to create new render
      console.log('Canvas: 🔄 Creating new render (data changed or no cache)');

      // Create new ImageData (this is the expensive operation)
      const imageData = ctx.createImageData(imageInfo.width, imageInfo.height);
      const imageDataArray = imageData.data;

      // Debug data range before conversion
      const sampleSize = Math.min(1000, data.length);
      const dataSample = data.slice(0, sampleSize);
      const dataMin = Math.min(...dataSample);
      const dataMax = Math.max(...dataSample);
      const nonZeroCount = dataSample.filter(val => val > 0).length;

      // Check for specific patterns that might indicate issues
      // const normalCount = dataSample.filter(val => val >= 0.01).length;

      // Reduced logging - only log significant data issues
      if (dataMax < 0.01 || nonZeroCount < sampleSize * 0.1) {
        console.log(`Canvas: Converting data - min: ${dataMin}, max: ${dataMax}, nonZero: ${nonZeroCount}/${sampleSize}`);
      }

      // Convert Float32Array to Uint8ClampedArray efficiently
      let convertedCount = 0;

      // Simple data conversion without complex adjustments
      // Trust that the pipeline has provided properly processed data
      console.log(`Canvas: Converting processed data - range: ${dataMin.toFixed(4)}-${dataMax.toFixed(4)}`);

      for (let i = 0; i < Math.min(data.length, imageDataArray.length); i += 4) {
        const baseIdx = i;

        // Simple linear conversion from 0.0-1.0 to 0-255 range
        const r = Math.max(0.0, Math.min(1.0, data[baseIdx]));
        const g = Math.max(0.0, Math.min(1.0, data[baseIdx + 1]));
        const b = Math.max(0.0, Math.min(1.0, data[baseIdx + 2]));
        const a = data[baseIdx + 3] || 1.0;

        const rInt = Math.max(0, Math.min(255, Math.round(r * 255)));
        const gInt = Math.max(0, Math.min(255, Math.round(g * 255)));
        const bInt = Math.max(0, Math.min(255, Math.round(b * 255)));
        const aInt = Math.max(0, Math.min(255, Math.round(a * 255)));

        imageDataArray[baseIdx] = rInt;
        imageDataArray[baseIdx + 1] = gInt;
        imageDataArray[baseIdx + 2] = bInt;
        imageDataArray[baseIdx + 3] = aInt;

        if (rInt > 0 || gInt > 0 || bInt > 0) convertedCount++;
      }

      // Only log if there are issues with the conversion
      if (convertedCount < Math.floor(data.length / 4) * 0.1) {
        console.log(`Canvas: Low conversion rate - ${convertedCount} non-black pixels out of ${Math.floor(data.length / 4)} total`);
      }

      // If conversion results in all black pixels despite having data, the processed data is corrupt
      if (convertedCount === 0 && nonZeroCount > 0) {
        console.error('Canvas: CRITICAL - All pixels converted to black despite having data! Data corruption detected.');
        throw new Error('Processed data conversion failed - all pixels black');
      }

      // Cache the ImageData for future use
      cache.imageData = imageData;
      cache.lastWidth = imageInfo.width;
      cache.lastHeight = imageInfo.height;
      cache.lastDataHash = dataHash;
      console.log(`Canvas: 💾 Cached new render with hash: ${dataHash}`);

      // Calculate display dimensions with zoom and pan
      // Canvas is already sized correctly - just use its dimensions
      // No need to calculate aspect ratio fitting again
      const baseWidth = canvas.width;
      const baseHeight = canvas.height;

      const scaledWidth = baseWidth * viewport.zoom;
      const scaledHeight = baseHeight * viewport.zoom;
      const x = (canvas.width - scaledWidth) / 2 + viewport.panX;
      const y = (canvas.height - scaledHeight) / 2 + viewport.panY;

      console.log(`🖼️ DRAWING (new):
  Canvas: ${canvas.width}x${canvas.height}
  BaseSize: ${baseWidth}x${baseHeight}
  Scaled: ${scaledWidth}x${scaledHeight}
  Position: (${x}, ${y})
  Source: ${imageInfo.width}x${imageInfo.height}`);

      // Optimize image smoothing based on zoom level
      ctx.imageSmoothingEnabled = viewport.zoom < 1;
      ctx.imageSmoothingQuality = viewport.zoom < 0.5 ? 'low' : 'high';

      // Create temporary canvas for the ImageData
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = imageInfo.width;
      tempCanvas.height = imageInfo.height;
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCtx.putImageData(imageData, 0, 0);

      // Draw the image
      ctx.drawImage(
        tempCanvas,
        0, 0, imageInfo.width, imageInfo.height,  // Source: full image
        x, y, scaledWidth, scaledHeight            // Dest: scaled display
      );

      const renderTime = performance.now() - startTime;
      console.log(`Canvas: New render completed in ${renderTime.toFixed(2)}ms`);

    } catch (error) {
      console.error('Canvas: Error drawing optimized image:', error);

      // Check if we have access to original image data for fallback
      const currentImageData = imageService.getCurrentImage();
      if (currentImageData && error instanceof Error && error.message.includes('conversion failed')) {
        console.warn('Canvas: Using original image data due to processed data corruption');
        try {
          // Use original image data instead
          drawLoadedImage(ctx, canvas, currentImageData, currentImageData.data);
          return;
        } catch (fallbackError) {
          console.error('Canvas: Fallback to original data also failed:', fallbackError);
        }
      }

      // Final fallback to original method
      drawLoadedImage(ctx, canvas, imageInfo, data);
    }
  }, [viewport, drawLoadedImage]);

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

  // Get crop module from pipeline
  useEffect(() => {
    const module = imageProcessingPipeline.getModule<CropPipelineModule>('crop');
    if (module) {
      setCropModule(module);
    }
  }, []);

  // Watch for crop preview mode changes
  useEffect(() => {
    if (!cropModule) return;

    const checkPreviewMode = () => {
      const isInPreview = cropModule.getCropModule().isInPreviewMode();
      setShowCropOverlay(isInPreview);
    };

    // Check immediately
    checkPreviewMode();

    // Set up interval to check for changes
    const interval = setInterval(checkPreviewMode, 100);

    return () => clearInterval(interval);
  }, [cropModule]);

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

    // Only allow panning when zoomed in (> 100%)
    if (viewport.zoom <= 1.0) {
      return; // No panning at fit or 100% zoom
    }

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Calculate how much the image extends beyond the visible area
    const containerRect = container.getBoundingClientRect();
    const displayWidth = canvas.offsetWidth * viewport.zoom;
    const displayHeight = canvas.offsetHeight * viewport.zoom;

    // Calculate maximum pan boundaries
    // The image can only be panned until its edges meet the canvas edges
    const maxPanX = Math.max(0, (displayWidth - containerRect.width) / 2);
    const maxPanY = Math.max(0, (displayHeight - containerRect.height) / 2);

    let newPanX = e.clientX - lastPan.x;
    let newPanY = e.clientY - lastPan.y;

    // Clamp pan values to keep image edges at canvas edges
    newPanX = Math.max(-maxPanX, Math.min(maxPanX, newPanX));
    newPanY = Math.max(-maxPanY, Math.min(maxPanY, newPanY));

    setViewport({ panX: newPanX, panY: newPanY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.max(0.1, Math.min(5, viewport.zoom + delta));

    // Reset pan to center when zooming out to fit or less
    if (newZoom <= 1.0) {
      setViewport({ zoom: newZoom, panX: 0, panY: 0 });
    } else {
      setViewport({ zoom: newZoom });
    }
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
        <div className="flex items-center justify-center w-full h-full relative">
          <canvas
            ref={canvasRef}
            className={isDragging ? 'cursor-grabbing' : 'cursor-grab'}
            style={{
              // Manual aspect ratio handling - no object-fit needed
              display: 'block'
            }}
          />

          {/* Crop/Transform Overlay - 3x3 grid and darkened areas */}
          {cropModule && displayImage && canvasRef.current && (
            <>
              <CropTransformOverlay
                imageWidth={imageService.getCurrentImage()?.width || 0}
                imageHeight={imageService.getCurrentImage()?.height || 0}
                cropParams={cropModule.getCropModule().getParams()}
                viewport={viewport}
                canvasDisplayWidth={canvasRef.current.offsetWidth}
                canvasDisplayHeight={canvasRef.current.offsetHeight}
                showOverlay={showCropOverlay}
              />

              {/* Interactive Crop Handles - drag to resize crop */}
              <InteractiveCropHandles
                imageWidth={imageService.getCurrentImage()?.width || 0}
                imageHeight={imageService.getCurrentImage()?.height || 0}
                cropParams={cropModule.getCropModule().getParams()}
                onCropChange={(crop) => {
                  // Update crop module params
                  const module = cropModule.getCropModule();
                  const currentParams = module.getParams();
                  module.setParams({
                    ...currentParams,
                    x: crop.x,
                    y: crop.y,
                    width: crop.width,
                    height: crop.height,
                    enabled: true
                  });

                  // Trigger processing (debounced in the pipeline)
                  imageProcessingPipeline.invalidateModuleCache('crop');

                  // Note: Real-time processing will be triggered by the AdjustmentPanel's
                  // effect that watches for module changes. For immediate feedback during drag,
                  // we could add a debounced processing call here, but it's not critical
                  // since the grid overlay updates immediately.
                }}
                viewport={viewport}
                canvasDisplayWidth={canvasRef.current.offsetWidth}
                canvasDisplayHeight={canvasRef.current.offsetHeight}
                showHandles={showCropOverlay}
                containerRef={containerRef}
              />
            </>
          )}
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