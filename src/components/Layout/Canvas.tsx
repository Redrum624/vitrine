import { useRef, useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { fileSystemService, ImageFileInfo } from '../../services/FileSystemService';
import { imageService } from '../../services/ImageService';
import { logger } from '../../utils/Logger';
import { CropTransformOverlay } from '../Canvas/CropTransformOverlay';
import { InteractiveCropHandles } from '../Canvas/InteractiveCropHandles';
import { imageProcessingPipeline } from '../../services/ImageProcessingPipeline';
import { editPersistenceService } from '../../services/EditPersistenceService';
import { checkpointService } from '../../services/CheckpointService';
import { CropPipelineModule } from '../../modules/CropPipelineModule';
import { LocalAdjustmentsPipelineModule } from '../../modules/LocalAdjustmentsPipelineModule';
import { LocalAdjustmentMaskOverlay } from '../Canvas/LocalAdjustmentMaskOverlay';
import { notificationService } from '../../services/NotificationService';
import { StarRating } from '../common/StarRating';
import { gpuPreviewPipeline } from '../../shaders/GpuPreviewPipeline';

// Debug mode for canvas rendering - set to false for production
const DEBUG_CANVAS = process.env.NODE_ENV === 'development';

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
  // Second canvas dedicated to the WebGL2 GPU present path. A <canvas> can only ever
  // hold ONE context type for its lifetime, so we keep the proven 2D canvas above for
  // the CPU path and present the resident GPU result onto this one. Exactly one is
  // visible at a time (toggled by renderMode); both are sized pixel-identically so the
  // overlays (grid/rulers/crop/mask) align with whichever is showing.
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const { viewport, setViewport, processedImageData, isAdjustingRotation, selectedTool, triggerReprocessing, showGrid, showRulers, showOriginal, referenceMode, isProcessing, imageRatings, setImageRating, renderMode, gpuResultVersion, setRenderMode } = useAppStore();
  // Whether attach() succeeded on this canvas (WebGL2 present available). When false the
  // app behaves exactly as before: GL canvas stays hidden and renderMode is forced 'cpu'.
  // Kept as React state (not just a ref) so JSX visibility re-renders when it changes.
  const [glAvailable, setGlAvailable] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [lastPan, setLastPan] = useState({ x: 0, y: 0 });
  const [displayImage, setDisplayImage] = useState<ImageFileInfo | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [cropModule, setCropModule] = useState<CropPipelineModule | null>(null);
  const [showCropOverlay, setShowCropOverlay] = useState(false);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 0, height: 0 });
  const [isCropHandleDragging, setIsCropHandleDragging] = useState(false);
  const [hasPendingCropChanges, setHasPendingCropChanges] = useState(false);
  const prevShowCropOverlay = useRef(showCropOverlay);
  // Local state for crop params during dragging (for real-time visual feedback)
  const [liveCropParams, setLiveCropParams] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

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

    if (DEBUG_CANVAS) console.log('Canvas: Data analysis - min:', minValue, 'max:', maxValue, 'isNormalized:', isNormalized, 'sampleSize:', sampleSize);

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
    // No image border — the picture should sit seamlessly on the dark canvas.
  }, [viewport]);

  const drawPlaceholder = useCallback((ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    // Fill background
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw dot pattern
    ctx.fillStyle = '#1a1a1a';
    const dotSize = 1.5;
    const spacing = 32;
    for (let x = 0; x < canvas.width; x += spacing) {
      for (let y = 0; y < canvas.height; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, dotSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw placeholder text
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#555555';
    ctx.font = '600 32px Inter, system-ui';
    ctx.fillText('Photo Editor Pro', centerX, centerY - 30);

    ctx.fillStyle = '#3a3a3a';
    ctx.font = '400 15px Inter, system-ui';
    ctx.fillText('Select an image from the browser to begin your editing session', centerX, centerY + 15);
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

        // CRITICAL: Validate that previewData dimensions match actual data length
        const expectedLength = previewData.width * previewData.height * 4;
        if (previewData.data.length === expectedLength) {
          dataWidth = previewData.width;
          dataHeight = previewData.height;
        } else {
          // Data length doesn't match reported dimensions - infer correct dimensions
          const actualPixels = previewData.data.length / 4;
          const aspectRatio = currentImageData.width / currentImageData.height;
          const inferredHeight = Math.round(Math.sqrt(actualPixels / aspectRatio));
          const inferredWidth = Math.round(inferredHeight * aspectRatio);

          console.warn(`Canvas: Preview dimension mismatch! Reported: ${previewData.width}x${previewData.height}, data suggests: ${inferredWidth}x${inferredHeight}`);

          if (Math.abs(inferredWidth * inferredHeight - actualPixels) <= inferredWidth) {
            dataWidth = inferredWidth;
            dataHeight = inferredHeight;
          } else {
            // Fall back to original image dimensions
            console.warn('Canvas: Cannot infer preview dimensions, using original image size');
          }
        }
      }

      // Set canvas to exact data dimensions (1:1 pixel mapping, no upscaling)
      canvasWidth = dataWidth;
      canvasHeight = dataHeight;

      // Canvas sizing: 1:1 pixel mapping for accurate rendering
      if (process.env.NODE_ENV === 'development') {
        logger.debug(`Canvas sizing: ${canvasWidth}x${canvasHeight}, Container: ${containerWidth}x${containerHeight}, Data: ${dataWidth}x${dataHeight}`);
      }
    } else {
      // No image loaded - use container size for placeholder
      canvasWidth = containerWidth;
      canvasHeight = containerHeight;
    }

    // Set canvas internal resolution to exact data size
    canvas.width = Math.floor(canvasWidth);
    canvas.height = Math.floor(canvasHeight);

    // GL drawing-buffer size: in GPU mode, present() OWNS it (it sizes the buffer to the
    // resident result resolution, which is the downsampled preview size — NOT this 2D
    // canvas's full-res size). If we also wrote glCanvas.width here it would (a) fight
    // present() over the size and (b) clear the buffer on the ~150ms histogram readback
    // with no re-present → a black frame. So only mirror the buffer size in CPU mode.
    // The CSS display size is mirrored unconditionally below so overlays always align.
    const glCanvas = glCanvasRef.current;
    if (glCanvas && !(renderMode === 'gpu' && glAvailable)) {
      glCanvas.width = canvas.width;
      glCanvas.height = canvas.height;
    }

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

    // Mirror the GL canvas's CSS display size so it overlaps the 2D canvas exactly.
    if (glCanvas) {
      glCanvas.style.width = `${Math.floor(displayWidth)}px`;
      glCanvas.style.height = `${Math.floor(displayHeight)}px`;
    }

    // Update canvas dimensions state for overlay positioning
    setCanvasDimensions({ width: Math.floor(displayWidth), height: Math.floor(displayHeight) });

    if (DEBUG_CANVAS) {
      console.log(`  Canvas element set to:
    Internal: ${canvas.width}x${canvas.height}
    CSS Display: ${canvas.style.width} x ${canvas.style.height}
    Computed: ${window.getComputedStyle(canvas).width} x ${window.getComputedStyle(canvas).height}
    Scale factor: ${(displayWidth / canvas.width).toFixed(2)}x`);
    }

    // In GPU mode the visible result is presented onto the GL canvas (a separate
    // effect calls gpuPreviewPipeline.present on gpuResultVersion/viewport/showOriginal
    // changes). The 2D canvas is hidden, so we skip its (now redundant) blit entirely —
    // sizing above still runs so the GL canvas stays pixel-synced and overlays align.
    // Use committed closure values (renderMode state + glAvailable state) rather than
    // getState() so this guard always reflects the same render that scheduled this call.
    if (renderMode === 'gpu' && glAvailable) {
      return;
    }

    // Clear canvas. Use the SAME colour as the surrounding container (bg-dark-900
    // = #0d0d0d) so that when the image is zoomed out (drawn smaller than the
    // canvas) the margin around it is seamless instead of a lighter-grey rectangle.
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (currentImageData && displayImage) {
      // Use processed image data if available, otherwise use original
      if (processedImageData && typeof processedImageData === 'object' && 'data' in processedImageData) {
        // Handle new preview data structure
        const previewData = processedImageData as { data: Float32Array; width: number; height: number; isPreview: boolean };
        if (DEBUG_CANVAS) console.log('Canvas: Using processed preview data', previewData.width, 'x', previewData.height);

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
        if (DEBUG_CANVAS) console.log('Canvas: Processed data check - hasData:', hasData, 'sample:', sampleData.slice(0, 8));

        if (!hasData) {
          console.warn('Canvas: Processed data appears to be all zeros, falling back to original data');
          drawLoadedImageOptimized(ctx, canvas, currentImageData, currentImageData.data);
        } else {
          // Check if processed data is mostly zeros despite having some data
          const processedSample = previewData.data.slice(0, 1000);
          const nonZeroCount = processedSample.filter(val => val > 0).length;
          const blackPixelRatio = 1 - (nonZeroCount / processedSample.length);

          if (DEBUG_CANVAS) console.log(`Canvas: Processed data quality check - nonZero: ${nonZeroCount}/1000 (${(100-blackPixelRatio*100).toFixed(1)}% visible)`);

          if (blackPixelRatio > 0.95) { // If more than 95% black pixels
            console.warn('Canvas: Processed data is mostly black, using original image data instead');
            drawLoadedImageOptimized(ctx, canvas, currentImageData, currentImageData.data);
          } else {
            if (DEBUG_CANVAS) console.log('Canvas: Using processed preview data for module effects');
            drawLoadedImageOptimized(ctx, canvas, { width: previewData.width, height: previewData.height }, previewData.data);
          }
        }
      } else if (processedImageData && processedImageData instanceof Float32Array) {
        // Handle legacy data structure
        if (DEBUG_CANVAS) console.log('Canvas: Using legacy processed data', currentImageData.width, 'x', currentImageData.height);
        drawLoadedImageOptimized(ctx, canvas, currentImageData, processedImageData);
      } else {
        // Use original image data
        if (DEBUG_CANVAS) console.log('Canvas: Using original image data', currentImageData.width, 'x', currentImageData.height, 'channels detected');
        drawLoadedImageOptimized(ctx, canvas, currentImageData, currentImageData.data);
      }
    } else {
      // Draw placeholder content
      drawPlaceholder(ctx, canvas);
    }
  }, [processedImageData, displayImage, viewport, renderMode, glAvailable]);

  // Optimized image drawing with caching and requestAnimationFrame
  const drawLoadedImageOptimized = useCallback((ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, imageInfo: { width: number; height: number }, data: Float32Array) => {
    try {
      const startTime = performance.now();

      // CRITICAL: Validate data length matches dimensions
      const expectedLength = imageInfo.width * imageInfo.height * 4;
      if (data.length !== expectedLength) {
        // Calculate actual dimensions from data length
        const actualPixels = data.length / 4;
        console.warn(`Canvas: Data/dimension mismatch! Expected ${expectedLength} (${imageInfo.width}x${imageInfo.height}), got ${data.length} (${actualPixels} pixels)`);

        // Try to infer correct dimensions from data length
        // Assume same aspect ratio as reported
        const aspectRatio = imageInfo.width / imageInfo.height;
        const actualHeight = Math.round(Math.sqrt(actualPixels / aspectRatio));
        const actualWidth = Math.round(actualHeight * aspectRatio);

        if (Math.abs(actualWidth * actualHeight - actualPixels) <= actualWidth) {
          console.log(`Canvas: Correcting dimensions to ${actualWidth}x${actualHeight}`);
          imageInfo = { width: actualWidth, height: actualHeight };
        }
      }

      // Generate hash for cache comparison — include the current image path
      // to ensure different images with the same dimensions never match cache
      const currentImagePath = imageService.getCurrentImage()?.filePath || '';
      let dataHash = `${currentImagePath}_${imageInfo.width}x${imageInfo.height}_${data.length}`;

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
        if (DEBUG_CANVAS) console.log(`Canvas: Data sampling - ${pixelsSampled} pixels, ${nonZeroSamples} non-zero, range: ${minSample.toFixed(6)}-${maxSample.toFixed(6)}`);
      }

      // Check if we can reuse cached ImageData
      const cache = canvasCache.current;

      // Debug cache comparison
      if (DEBUG_CANVAS) {
        console.log(`Canvas: Cache check - current hash: ${dataHash}, cached hash: ${cache.lastDataHash || 'none'}`);
        console.log(`Canvas: Dimensions match: ${cache.lastWidth === imageInfo.width && cache.lastHeight === imageInfo.height}`);
      }

      if (cache.imageData &&
          cache.lastWidth === imageInfo.width &&
          cache.lastHeight === imageInfo.height &&
          cache.lastDataHash === dataHash) {

        // Reuse cached ImageData - just redraw with current viewport
        if (DEBUG_CANVAS) console.log('Canvas: ✅ Using cached render (data unchanged)');

        // Canvas is already sized correctly - just use its dimensions
        // No need to calculate aspect ratio fitting again
        const baseWidth = canvas.width;
        const baseHeight = canvas.height;

        const scaledWidth = baseWidth * viewport.zoom;
        const scaledHeight = baseHeight * viewport.zoom;
        const x = (canvas.width - scaledWidth) / 2 + viewport.panX;
        const y = (canvas.height - scaledHeight) / 2 + viewport.panY;

        if (DEBUG_CANVAS) {
          console.log(`🖼️ DRAWING (cached):
  Canvas: ${canvas.width}x${canvas.height}
  BaseSize: ${baseWidth}x${baseHeight}
  Scaled: ${scaledWidth}x${scaledHeight}
  Position: (${x}, ${y})
  Source: ${imageInfo.width}x${imageInfo.height}`);
        }

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
        if (DEBUG_CANVAS) console.log(`Canvas: Cached render completed in ${renderTime.toFixed(2)}ms`);
        return;
      }

      // Cache miss - need to create new render
      if (DEBUG_CANVAS) console.log('Canvas: 🔄 Creating new render (data changed or no cache)');

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
      if (DEBUG_CANVAS && (dataMax < 0.01 || nonZeroCount < sampleSize * 0.1)) {
        console.log(`Canvas: Converting data - min: ${dataMin}, max: ${dataMax}, nonZero: ${nonZeroCount}/${sampleSize}`);
      }

      // Convert Float32Array to Uint8ClampedArray efficiently
      let convertedCount = 0;

      // Simple data conversion without complex adjustments
      // Trust that the pipeline has provided properly processed data
      if (DEBUG_CANVAS) console.log(`Canvas: Converting processed data - range: ${dataMin.toFixed(4)}-${dataMax.toFixed(4)}`);

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
      if (DEBUG_CANVAS && convertedCount < Math.floor(data.length / 4) * 0.1) {
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
      if (DEBUG_CANVAS) console.log(`Canvas: 💾 Cached new render with hash: ${dataHash}`);

      // Calculate display dimensions with zoom and pan
      // Canvas is already sized correctly - just use its dimensions
      // No need to calculate aspect ratio fitting again
      const baseWidth = canvas.width;
      const baseHeight = canvas.height;

      const scaledWidth = baseWidth * viewport.zoom;
      const scaledHeight = baseHeight * viewport.zoom;
      const x = (canvas.width - scaledWidth) / 2 + viewport.panX;
      const y = (canvas.height - scaledHeight) / 2 + viewport.panY;

      if (DEBUG_CANVAS) {
        console.log(`🖼️ DRAWING (new):
  Canvas: ${canvas.width}x${canvas.height}
  BaseSize: ${baseWidth}x${baseHeight}
  Scaled: ${scaledWidth}x${scaledHeight}
  Position: (${x}, ${y})
  Source: ${imageInfo.width}x${imageInfo.height}`);
      }

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
      if (DEBUG_CANVAS) console.log(`Canvas: New render completed in ${renderTime.toFixed(2)}ms`);

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
      // Persist the OUTGOING image's edits + history before we reset the pipeline.
      editPersistenceService.flush();
      checkpointService.flush();

      // Always reset modules and caches when switching images so
      // styles/edits don't bleed between photos.
      canvasCache.current = {};
      useAppStore.getState().setProcessedImageData(null);
      // Reset renderMode so the GL canvas doesn't flash the previous image's texture
      // while the new image loads. AdjustmentPanel will flip back to 'gpu' on the
      // first render if the new image is eligible.
      useAppStore.getState().setRenderMode('cpu');
      imageProcessingPipeline.resetAllModules();


      setImageLoading(true);
      setDisplayImage(image);

      // Load image using ImageService (will use cache if available)
      await imageService.loadImage(image.path);

      // Restore previously-saved edits for this image, then reprocess so they show.
      const decoded = imageService.getCurrentImage();
      if (decoded) {
        const restored = await editPersistenceService.restoreForPath(image.path, decoded.width, decoded.height);
        if (restored) useAppStore.getState().triggerReprocessing();
        // Load this image's checkpoint history; seed an "Opened" baseline if empty.
        await checkpointService.loadForPath(image.path);
        if (checkpointService.getCheckpoints().length === 0) checkpointService.record('Opened');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error loading image';
      logger.error('Failed to load image:', error);
      notificationService.error('Image Load Failed', message);
    } finally {
      setImageLoading(false);
    }
  }, [redrawCanvas]);

  // Handle image loading from file system
  useEffect(() => {
    if (currentImage && currentImage.path !== displayImage?.path) {
      loadImage(currentImage);
    }
  }, [currentImage, displayImage, loadImage]);

  // Redraw canvas when processed image data changes. Also re-run when renderMode or
  // gpuResultVersion changes so the (shared) sizing logic keeps the GL canvas's
  // drawing-buffer + CSS size synced with the 2D canvas before present() runs — this
  // covers the first GPU render after an image load and param-only GPU edits.
  useEffect(() => {
    redrawCanvas();
  }, [processedImageData, displayImage, renderMode, gpuResultVersion]);


  const navigateImage = async (direction: 'next' | 'prev') => {
    const newImage = direction === 'next'
      ? fileSystemService.nextImage()
      : fileSystemService.previousImage();

    if (newImage) {
      await loadImage(newImage);
    }
  };


  // Redraw the 2D canvas when viewport (pan/zoom) changes. In GPU mode the present()
  // effect above already handles viewport changes, so the 2D blit is a no-op; skip it
  // explicitly to avoid a spurious drawLoadedImageOptimized call on every pan event.
  useEffect(() => {
    if (renderMode !== 'gpu') {
      redrawCanvas();
    }
  }, [viewport, renderMode, redrawCanvas]);

  // Attach the WebGL2 GPU present pipeline to the GL canvas on mount. If WebGL2 / float
  // render targets are unavailable, attach() returns false: we force renderMode to 'cpu'
  // and never show the GL canvas, so the app behaves exactly as before. (AdjustmentPanel
  // also gates on gpuPreviewPipeline.isAvailable(), so the two stay consistent.)
  useEffect(() => {
    const glCanvas = glCanvasRef.current;
    if (!glCanvas) return;
    const ok = gpuPreviewPipeline.attach(glCanvas);
    setGlAvailable(ok);
    if (!ok) {
      setRenderMode('cpu');
    }
    // Free GL resources on unmount so a remount (HMR, route change) gets a clean context.
    // destroy() resets `attached` so a subsequent attach() (StrictMode remount) fully reinits.
    return () => {
      gpuPreviewPipeline.destroy();
      setGlAvailable(false);
    };
  }, [setRenderMode]);

  // Present the resident GPU result to the GL canvas. Runs in gpu mode on every:
  //   - gpuResultVersion change (a new GPU render completed)
  //   - viewport change (zoom / pan)
  //   - showOriginal change (the layout resizes the GL canvas, so re-present at new size)
  // No GPU→CPU readback — present() blits the resident result texture directly.
  useEffect(() => {
    if (renderMode !== 'gpu' || !glAvailable) return;
    const glCanvas = glCanvasRef.current;
    if (!glCanvas) return;
    gpuPreviewPipeline.present({
      zoom: viewport.zoom,
      panX: viewport.panX,
      panY: viewport.panY,
      // Before/After is rendered by the dedicated <OriginalPane/> (App.tsx) — a separate
      // 50% pane that draws the PRISTINE imageService.getOriginalImage() snapshot — in
      // BOTH cpu and gpu modes. The GPU present split sampled srcTexture, which is the
      // editing BASE (= currentImage.data, mutated in place by rotate/flip/Auto-All via
      // updateCurrentImageData), so it could show an EDITED "before". Disable the GPU
      // split (always -1) and let the pristine OriginalPane be the single source of truth.
      splitX: -1,
    });
  }, [renderMode, gpuResultVersion, viewport, showOriginal]);

  // Re-present after the window regains visibility/focus. Even with preserveDrawingBuffer
  // the compositor can drop the GL canvas's contents on some minimize/restore paths; the
  // present() deps above don't change on restore, so without this the canvas would stay
  // blank. Reads live store state to avoid stale-closure viewport values.
  useEffect(() => {
    if (!glAvailable) return;
    const repaint = () => {
      const st = useAppStore.getState();
      if (st.renderMode !== 'gpu' || document.hidden) return;
      const glCanvas = glCanvasRef.current;
      if (!glCanvas) return;
      gpuPreviewPipeline.present({
        zoom: st.viewport.zoom,
        panX: st.viewport.panX,
        panY: st.viewport.panY,
        splitX: -1,
      });
    };
    window.addEventListener('focus', repaint);
    document.addEventListener('visibilitychange', repaint);
    return () => {
      window.removeEventListener('focus', repaint);
      document.removeEventListener('visibilitychange', repaint);
    };
  }, [glAvailable]);

  // Get crop module from pipeline
  useEffect(() => {
    const module = imageProcessingPipeline.getModule<CropPipelineModule>('crop');
    if (module) {
      setCropModule(module);
    }
  }, []);

  // Hide crop overlay when leaving crop mode or clicking outside canvas
  useEffect(() => {
    if (selectedTool !== 'crop') {
      setShowCropOverlay(false);
      return;
    }

    // Hide crop overlay when clicking outside the canvas container
    const handleDocumentClick = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;

      // Check if click is outside the canvas container
      if (!container.contains(e.target as unknown as HTMLElement)) {
        setShowCropOverlay(false);
      }
    };

    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, [selectedTool]);

  // Apply crop when crop overlay is closed (only if there are pending changes)
  useEffect(() => {
    // Detect transition from showing to hidden
    if (prevShowCropOverlay.current && !showCropOverlay && hasPendingCropChanges) {
      // Crop overlay was just closed and we have pending changes - apply the crop
      imageProcessingPipeline.invalidateModuleCache('crop');
      triggerReprocessing();
      setHasPendingCropChanges(false);
      setLiveCropParams(null); // Clear live params after applying
    }
    prevShowCropOverlay.current = showCropOverlay;
  }, [showCropOverlay, hasPendingCropChanges, triggerReprocessing]);

  // Check if a point is inside the image bounds
  const isPointOnImage = useCallback((clientX: number, clientY: number): boolean => {
    const canvas = canvasRef.current;
    if (!canvas) return false;

    const canvasRect = canvas.getBoundingClientRect();

    // Get click position relative to canvas
    const x = clientX - canvasRect.left;
    const y = clientY - canvasRect.top;

    // Calculate image bounds on canvas
    const scaledImageWidth = canvas.offsetWidth * viewport.zoom;
    const scaledImageHeight = canvas.offsetHeight * viewport.zoom;
    const imageX = (canvas.offsetWidth - scaledImageWidth) / 2 + viewport.panX;
    const imageY = (canvas.offsetHeight - scaledImageHeight) / 2 + viewport.panY;

    // Check if click is within image bounds
    return x >= imageX && x <= imageX + scaledImageWidth &&
           y >= imageY && y <= imageY + scaledImageHeight;
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
    // Handle crop overlay visibility when in crop mode
    if (selectedTool === 'crop') {
      const clickedOnImage = isPointOnImage(e.clientX, e.clientY);
      if (clickedOnImage) {
        setShowCropOverlay(true);
      } else {
        setShowCropOverlay(false);
      }
    }

    // Don't start canvas dragging if crop handles are being used
    if (isCropHandleDragging) {
      return;
    }

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

    // Don't zoom when crop handles are being used
    if (isCropHandleDragging) {
      return;
    }

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
        <div className="flex items-center justify-center w-full h-full">
          {/* Canvas wrapper - sized to match canvas for proper overlay positioning */}
          <div
            ref={canvasWrapperRef}
            className="relative"
            style={{
              width: canvasDimensions.width > 0 ? canvasDimensions.width : 'auto',
              height: canvasDimensions.height > 0 ? canvasDimensions.height : 'auto'
            }}
          >
            <canvas
              ref={canvasRef}
              className={isDragging ? 'cursor-grabbing' : 'cursor-grab'}
              style={{
                // Manual aspect ratio handling - no object-fit needed
                // Hidden in GPU mode (the GL canvas presents instead); shown otherwise.
                display: renderMode === 'gpu' && glAvailable ? 'none' : 'block'
              }}
            />

            {/* WebGL2 GPU present canvas — overlaps the 2D canvas pixel-for-pixel.
                Visible only in GPU mode; absolutely positioned so it doesn't affect
                the wrapper's layout (the 2D canvas defines the wrapper box). Overlays
                below sit above BOTH canvases. */}
            <canvas
              ref={glCanvasRef}
              className={isDragging ? 'cursor-grabbing' : 'cursor-grab'}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                display: renderMode === 'gpu' && glAvailable ? 'block' : 'none'
              }}
            />

            {/* Grid Overlay */}
            {showGrid && displayImage && canvasDimensions.width > 0 && (
              <svg
                className="absolute inset-0 pointer-events-none"
                width={canvasDimensions.width}
                height={canvasDimensions.height}
                style={{ opacity: 0.3 }}
              >
                {/* Thirds grid */}
                {[1, 2].map(i => (
                  <g key={`grid-${i}`}>
                    <line x1={canvasDimensions.width * i / 3} y1={0} x2={canvasDimensions.width * i / 3} y2={canvasDimensions.height} stroke="#fff" strokeWidth="0.5" />
                    <line x1={0} y1={canvasDimensions.height * i / 3} x2={canvasDimensions.width} y2={canvasDimensions.height * i / 3} stroke="#fff" strokeWidth="0.5" />
                  </g>
                ))}
                {/* Center crosshair */}
                <line x1={canvasDimensions.width / 2 - 10} y1={canvasDimensions.height / 2} x2={canvasDimensions.width / 2 + 10} y2={canvasDimensions.height / 2} stroke="#fff" strokeWidth="0.5" />
                <line x1={canvasDimensions.width / 2} y1={canvasDimensions.height / 2 - 10} x2={canvasDimensions.width / 2} y2={canvasDimensions.height / 2 + 10} stroke="#fff" strokeWidth="0.5" />
              </svg>
            )}

            {/* Rulers Overlay */}
            {showRulers && displayImage && canvasDimensions.width > 0 && (
              <>
                {/* Top ruler */}
                <div
                  className="absolute top-0 left-0 pointer-events-none"
                  style={{ width: canvasDimensions.width, height: 20, backgroundColor: 'rgba(30,30,30,0.85)' }}
                >
                  <svg width={canvasDimensions.width} height={20}>
                    {Array.from({ length: Math.ceil(canvasDimensions.width / 50) + 1 }, (_, i) => {
                      const x = i * 50;
                      return (
                        <g key={`rtick-${i}`}>
                          <line x1={x} y1={14} x2={x} y2={20} stroke="#888" strokeWidth="0.5" />
                          <text x={x + 2} y={12} fill="#888" fontSize="8" fontFamily="monospace">{Math.round(x)}</text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
                {/* Left ruler */}
                <div
                  className="absolute top-0 left-0 pointer-events-none"
                  style={{ width: 20, height: canvasDimensions.height, backgroundColor: 'rgba(30,30,30,0.85)' }}
                >
                  <svg width={20} height={canvasDimensions.height}>
                    {Array.from({ length: Math.ceil(canvasDimensions.height / 50) + 1 }, (_, i) => {
                      const y = i * 50;
                      return (
                        <g key={`ltick-${i}`}>
                          <line x1={14} y1={y} x2={20} y2={y} stroke="#888" strokeWidth="0.5" />
                          <text x={2} y={y + 10} fill="#888" fontSize="8" fontFamily="monospace">{Math.round(y)}</text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </>
            )}

            {/* Crop/Transform Overlay - 3x3 grid and darkened areas */}
            {cropModule && displayImage && canvasDimensions.width > 0 && (() => {
              // Get base params from module, override with live params during drag for real-time feedback
              const baseParams = cropModule.getCropModule().getParams();
              const displayParams = liveCropParams ? { ...baseParams, ...liveCropParams } : baseParams;

              return (
              <>
                <CropTransformOverlay
                  imageWidth={(processedImageData && typeof processedImageData === 'object' && 'width' in processedImageData) ? processedImageData.width : (imageService.getCurrentImage()?.width || 0)}
                  imageHeight={(processedImageData && typeof processedImageData === 'object' && 'height' in processedImageData) ? processedImageData.height : (imageService.getCurrentImage()?.height || 0)}
                  originalWidth={imageService.getCurrentImage()?.width || 0}
                  originalHeight={imageService.getCurrentImage()?.height || 0}
                  cropParams={displayParams}
                  viewport={viewport}
                  canvasDisplayWidth={canvasDimensions.width}
                  canvasDisplayHeight={canvasDimensions.height}
                  showOverlay={showCropOverlay}
                  showRotationGrid={isAdjustingRotation}
                />

                {/* Interactive Crop Handles - drag to resize crop */}
                <InteractiveCropHandles
                  imageWidth={imageService.getCurrentImage()?.width || 0}
                  imageHeight={imageService.getCurrentImage()?.height || 0}
                  cropParams={displayParams}
                  onCropChange={(crop) => {
                    // Update crop module params (don't trigger reprocessing yet)
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

                    // Update live crop params for real-time visual feedback
                    setLiveCropParams(crop);

                    // Mark that we have pending crop changes to apply when overlay closes
                    setHasPendingCropChanges(true);
                  }}
                  onDragStart={() => setIsCropHandleDragging(true)}
                  onDragEnd={() => {
                    setIsCropHandleDragging(false);
                    // Keep liveCropParams so the grid stays at the new position
                    // It will be cleared when overlay closes
                  }}
                  viewport={viewport}
                  canvasDisplayWidth={canvasDimensions.width}
                  canvasDisplayHeight={canvasDimensions.height}
                  showHandles={showCropOverlay}
                  aspectRatio={cropModule.getCropModule().getAspectRatioValue()}
                  canvasRef={canvasRef}
                />
              </>
              );
            })()}

            {/* Local Adjustments: drag-to-place mask overlay (masks live in Basic Adjustments) */}
            {(selectedTool === 'basicadj' || selectedTool === 'localadjustments') && (() => {
              const la = imageProcessingPipeline.getModule<LocalAdjustmentsPipelineModule>('localadjustments');
              if (!la) return null;
              const p = la.getParameters();
              const layer = p.layers.find(l => l.id === p.activeLayerId);
              if (!layer || (layer.type !== 'radial_gradient' && layer.type !== 'linear_gradient') || !layer.geometry) {
                return null;
              }
              return (
                <LocalAdjustmentMaskOverlay
                  canvasRef={canvasRef}
                  viewport={viewport}
                  layerType={layer.type}
                  geometry={layer.geometry}
                  onGeometryChange={(geom) => {
                    const img = imageService.getCurrentImage();
                    if (img) {
                      // Bake the mask at PREVIEW resolution (capped long-edge), not the
                      // full 20MP — the full-res bake stalls the drag for ~1s. The
                      // pipeline rebuilds the mask at its actual processing size when it
                      // differs (incl. full-res export), so correctness is preserved.
                      const cap = 1024;
                      const s = Math.min(1, cap / Math.max(img.width, img.height));
                      const bw = Math.max(1, Math.round(img.width * s));
                      const bh = Math.max(1, Math.round(img.height * s));
                      la.setLayerGeometry(layer.id, geom, bw, bh);
                    }
                    imageProcessingPipeline.invalidateModuleCache('localadjustments');
                    triggerReprocessing();
                  }}
                  onDeselect={() => {
                    // Clicking off the mask hides it: clear the active layer + signal the
                    // panel (externalParamsVersion) to drop its selection. Both this
                    // overlay and the panel re-read on that signal.
                    la.clearActiveLayer();
                    useAppStore.getState().notifyExternalParamsChange();
                  }}
                />
              );
            })()}
          </div>
        </div>

        {/* Optional debug info - can be removed */}
        {process.env.NODE_ENV === 'development' && (
          <div className="absolute top-4 left-4 bg-dark-850/90 backdrop-blur-sm rounded-professional px-3 py-2 text-xs text-dark-300">
            <div>Zoom: {Math.round(viewport.zoom * 100)}%</div>
            <div>Pan: {Math.round(viewport.panX)}, {Math.round(viewport.panY)}</div>
          </div>
        )}

        {/* Image Navigation Arrows (hidden in Before/After + Reference comparison) */}
        {displayImage && !showOriginal && !referenceMode && (
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

        {/* Star Rating Overlay (bottom-right) */}
        {displayImage && (
          <div
            className="absolute bottom-4 right-4 flex items-center bg-dark-850/90 backdrop-blur-sm rounded-professional px-3 py-2"
            title="Rate this photo — press 1-5 (0 to clear)"
          >
            <StarRating
              size={24}
              gap={6}
              rating={imageRatings[displayImage.id] ?? 0}
              onRate={(r) => {
                setImageRating(displayImage.id, r);
                // Persist to the file (xmp:Rating) so it shows in OS file details.
                window.electronAPI?.writeImageRating?.(displayImage.path, r);
              }}
            />
          </div>
        )}

        {/* Loading / Applying Indicator */}
        {(imageLoading || isProcessing) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-dark-900/80 backdrop-blur-sm">
            <div className="animate-spin rounded-full h-12 w-12 border-2 border-gray-600 border-t-white mb-4" />
            <div className="text-white text-sm font-medium">
              {isProcessing && !imageLoading ? (
                'Applying…'
              ) : currentImage?.format.toLowerCase() === 'orf' ||
               currentImage?.format.toLowerCase() === 'cr2' ||
               currentImage?.format.toLowerCase() === 'cr3' ||
               currentImage?.format.toLowerCase() === 'nef' ||
               currentImage?.format.toLowerCase() === 'arw' ||
               currentImage?.format.toLowerCase() === 'dng' ? (
                <>
                  <div className="mb-1">Processing RAW file...</div>
                  <div className="text-xs text-gray-400">This may take a few moments</div>
                </>
              ) : (
                'Loading image...'
              )}
            </div>
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