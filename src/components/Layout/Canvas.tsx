import { useRef, useEffect, useState, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { ImageFileInfo } from '../../services/FileSystemService';
import { imageService } from '../../services/ImageService';
import { logger } from '../../utils/Logger';
import { computeViewportGeometry, overlayContentRect } from '../../utils/viewportGeometry';
import { computeRenderCacheHash } from '../../utils/renderCacheHash';
import { clampPan } from '../../utils/panBounds';
import { computeRequiredPreviewCap, BASE_PREVIEW_CAP } from '../../utils/previewQuality';
import { CropTransformOverlay } from '../Canvas/CropTransformOverlay';
import { InteractiveCropHandles } from '../Canvas/InteractiveCropHandles';
import { imageProcessingPipeline } from '../../services/ImageProcessingPipeline';
import { editPersistenceService } from '../../services/EditPersistenceService';
import { checkpointService } from '../../services/CheckpointService';
import { CropPipelineModule } from '../../modules/CropPipelineModule';
import { LocalAdjustmentsPipelineModule } from '../../modules/LocalAdjustmentsPipelineModule';
import { LocalAdjustmentMaskOverlay } from '../Canvas/LocalAdjustmentMaskOverlay';
import { notificationService } from '../../services/NotificationService';
import { gpuPreviewPipeline } from '../../shaders/GpuPreviewPipeline';
import { loadRawDecodeDefaults } from '../../utils/rawDecodeDefaultsStorage';
import { PHOTO_SHADOW } from '../../layout/photoRegion';

// Debug mode for canvas rendering - set to false for production
const DEBUG_CANVAS = process.env.NODE_ENV === 'development';

/**
 * True when the base pixels ImageService currently holds belong to a DIFFERENT
 * image than the one Canvas is displaying — i.e. an image switch is mid-flight and
 * the incoming image has not finished decoding yet. In that window imageService
 * still returns the PREVIOUS image's full-res buffer while `displayImage` is already
 * the incoming file, and `processedImageData` has been cleared to null by loadImage.
 * Without this guard redrawCanvas would blit that stale base at full resolution
 * (~0.65-0.9s for a 20MP frame) — wasted work on the OLD photo that also delays the
 * new decode dispatch. The render cache hash already embeds the file path (see
 * drawLoadedImageOptimized); this is that same source-identity comparison hoisted so
 * the stale draw is skipped and the cleared canvas is shown until the new data lands.
 */
export function isBaseImageStale(
  loadedFilePath: string | undefined | null,
  displayPath: string | undefined | null,
): boolean {
  return !!(loadedFilePath && displayPath && loadedFilePath !== displayPath);
}

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
  // Monotonic token identifying the LATEST `loadImage` call instance, bumped
  // synchronously at the TOP of loadImage (before any await). Each call captures its
  // own token and, after every await, bails unless it is still the latest — so an
  // EARLIER call resuming after its own await detects that a LATER call has since
  // started. Discriminates by CALL INSTANCE, not path (which this replaced): a newer
  // call for ANY path — including the SAME path, as in A→B→A rapid clicks — must
  // invalidate older in-flight instances, otherwise a resumed stale call re-dispatches
  // a duplicate decode of the image the newest call already loaded (final whole-branch
  // review, important #2). See the setRawDecodeOptions race guard below.
  const loadTokenRef = useRef(0);
  // Per-field selectors (not a whole-store `useAppStore()` subscription) — Canvas only
  // re-renders when one of ITS OWN fields actually changes, not on every store update
  // elsewhere (e.g. Gallery-only fields like ratingFilter/selectedImageIds). Same pattern as
  // the GalleryView/ThumbnailPanel conversion (Task R1).
  const viewport = useAppStore((s) => s.viewport);
  const setViewport = useAppStore((s) => s.setViewport);
  const processedImageData = useAppStore((s) => s.processedImageData);
  const isAdjustingRotation = useAppStore((s) => s.isAdjustingRotation);
  const selectedTool = useAppStore((s) => s.selectedTool);
  const triggerReprocessing = useAppStore((s) => s.triggerReprocessing);
  const showGrid = useAppStore((s) => s.showGrid);
  const showRulers = useAppStore((s) => s.showRulers);
  const showOriginal = useAppStore((s) => s.showOriginal);
  const isProcessing = useAppStore((s) => s.isProcessing);
  const renderMode = useAppStore((s) => s.renderMode);
  const gpuResultVersion = useAppStore((s) => s.gpuResultVersion);
  const setRenderMode = useAppStore((s) => s.setRenderMode);
  // Whether attach() succeeded on this canvas (WebGL2 present available). When false the
  // app behaves exactly as before: GL canvas stays hidden and renderMode is forced 'cpu'.
  // Kept as React state (not just a ref) so JSX visibility re-renders when it changes.
  const [glAvailable, setGlAvailable] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [lastPan, setLastPan] = useState({ x: 0, y: 0 });
  const [displayImage, setDisplayImage] = useState<ImageFileInfo | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [cropModule, setCropModule] = useState<CropPipelineModule | null>(null);
  // Crop overlay lifecycle (v1.29): the overlay is visible the WHOLE time the
  // crop module is open — no click-on-image to arm it, no outside-click
  // dismissal. The crop applies to the preview on handle mouse-release (see
  // applyCropToPreview below); leaving the module applies pending state as a
  // safety net (transition effect below).
  const showCropOverlay = selectedTool === 'crop' && !!displayImage;
  // Viewport-canvas model (Task R5). `canvasDimensions` is the VIEWPORT box (the canvas
  // element, which grows from the fit-rect up to the photo region when zoomed in) — it
  // drives the wrapper size, box-shadow, thirds-grid/rulers and the overlay boxes.
  // `contentDimensions` is the fit-rect (content at zoom 1) — the base the overlays scale
  // the image by (content = contentDimensions × zoom).
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 0, height: 0 });
  const [contentDimensions, setContentDimensions] = useState({ width: 0, height: 0 });
  // Last computed fit-rect + container (CSS px), read by the pan-clamp mouse/wheel handlers
  // without re-running the whole redraw. Set by redrawCanvas.
  const fitRef = useRef<{ fitW: number; fitH: number; containerW: number; containerH: number } | null>(null);
  // Dest rect (buffer px) for the current draw — where drawImage blits the source data
  // inside the (viewport-sized) 2D buffer. Threaded from redrawCanvas to the draw fns.
  const drawGeomRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  // Fit + viewport (CSS px) for the GPU present buffer sizing, read by BOTH present sites.
  const presentGeomRef = useRef<{ fitW: number; fitH: number; viewportW: number; viewportH: number } | null>(null);
  const [isCropHandleDragging, setIsCropHandleDragging] = useState(false);
  const [hasPendingCropChanges, setHasPendingCropChanges] = useState(false);
  const prevShowCropOverlay = useRef(showCropOverlay);
  // Refs to let the wheel handler read current state without stale closure
  const viewportRef = useRef(viewport);
  const isCropHandleDraggingRef = useRef(isCropHandleDragging);
  // Keep refs in sync with state so wheel handler never reads stale values
  viewportRef.current = viewport;
  isCropHandleDraggingRef.current = isCropHandleDragging;

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

    // Viewport-model dest rect (buffer px) from redrawCanvas; legacy centered-scale
    // fallback if geometry isn't set yet (this is the corrupt-data fallback path).
    const dg = drawGeomRef.current;
    const destX = dg ? dg.x : (canvas.width - canvas.width * viewport.zoom) / 2 + viewport.panX;
    const destY = dg ? dg.y : (canvas.height - canvas.height * viewport.zoom) / 2 + viewport.panY;
    const displayWidth = dg ? dg.w : canvas.width * viewport.zoom;
    const displayHeight = dg ? dg.h : canvas.height * viewport.zoom;

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

    // Draw the scaled image on the main canvas (top-left dest form)
    ctx.save();
    ctx.drawImage(
      tempCanvas,
      0, 0, imageWidth, imageHeight,  // Source rectangle (full image)
      destX, destY, displayWidth, displayHeight,
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
    ctx.fillText('Vitrine', centerX, centerY - 30);

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

    // Sizing only needs currentImageData (the loaded pixels). displayImage is NOT required
    // here — when a file is opened via IPC (electron-file-open) imageService has the data
    // before Canvas.loadImage() runs and sets displayImage. Using displayImage as a guard
    // caused the fit-rect to fall back to container size, stretching landscape images.
    if (currentImageData) {
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

    // The GL canvas mirrors the 2D canvas's buffer (CPU mode only — in GPU mode present()
    // OWNS the GL drawing buffer) and CSS size, so overlays align with whichever is shown.
    const glCanvas = glCanvasRef.current;

    if (currentImageData && displayImage) {
      // ── Viewport-canvas geometry (Task R5) ─────────────────────────────────────────
      // dataW/dataH: preview/source resolution (1:1 at zoom 1). fitW/fitH: the aspect-fit
      // of the source into the photo region (fit-rect = content at zoom 1). The canvas
      // element GROWS from the fit-rect up to the region as you zoom in, and the image
      // pans within it (was: pinned at the fit-rect, so zoom-in clipped there).
      const dataW = Math.max(1, Math.floor(canvasWidth));
      const dataH = Math.max(1, Math.floor(canvasHeight));
      const imageAspectRatio = dataW / dataH;
      const containerAspectRatio = containerWidth / containerHeight;
      let fitW: number, fitH: number;
      if (imageAspectRatio > containerAspectRatio) {
        fitW = containerWidth;
        fitH = containerWidth / imageAspectRatio;
      } else {
        fitH = containerHeight;
        fitW = containerHeight * imageAspectRatio;
      }

      const geom = computeViewportGeometry(
        fitW, fitH, containerWidth, containerHeight,
        viewport.zoom, viewport.panX, viewport.panY,
      );
      fitRef.current = { fitW, fitH, containerW: containerWidth, containerH: containerHeight };

      // Keep the STORED pan within the live bounds (after a zoom step or a region resize
      // while zoomed) so the overlays — which read the store pan — track the clamped render.
      // Converges in one extra frame; the mouse handler already clamps identically mid-drag.
      if (Math.abs(geom.panX - viewport.panX) > 0.5 || Math.abs(geom.panY - viewport.panY) > 0.5) {
        setViewport({ panX: geom.panX, panY: geom.panY });
      }

      // 2D buffer stays at data resolution (s = data px per fit CSS px) so zoom ≤ 1 stays
      // pixel-identical (bufW = dataW there); it grows with the viewport when zoomed in.
      const s = dataW / fitW;
      const bufW = Math.max(1, Math.round(geom.viewportW * s));
      const bufH = Math.max(1, Math.round(geom.viewportH * s));
      canvas.width = bufW;
      canvas.height = bufH;
      if (glCanvas && !(renderMode === 'gpu' && glAvailable)) {
        glCanvas.width = bufW;
        glCanvas.height = bufH;
      }

      // Dest rect (buffer px): source data drawn at zoom, offset to the viewport-relative
      // content top-left. Threaded to the draw fns via drawGeomRef.
      drawGeomRef.current = {
        x: geom.offsetX * s,
        y: geom.offsetY * s,
        w: dataW * viewport.zoom,
        h: dataH * viewport.zoom,
      };
      presentGeomRef.current = { fitW, fitH, viewportW: geom.viewportW, viewportH: geom.viewportH };

      const cssW = Math.round(geom.viewportW);
      const cssH = Math.round(geom.viewportH);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      if (glCanvas) {
        glCanvas.style.width = `${cssW}px`;
        glCanvas.style.height = `${cssH}px`;
      }
      // canvasDimensions = viewport box (wrapper/grid/rulers/overlay box);
      // contentDimensions = fit-rect (overlay content-scale base).
      setCanvasDimensions({ width: cssW, height: cssH });
      setContentDimensions({ width: Math.round(fitW), height: Math.round(fitH) });
      useAppStore.getState().setMainCanvasFit({ width: fitW, height: fitH });

      if (DEBUG_CANVAS) {
        console.log(`Canvas R5: fit=${fitW.toFixed(0)}x${fitH.toFixed(0)} viewport=${cssW}x${cssH} buffer=${bufW}x${bufH} zoom=${viewport.zoom.toFixed(2)} pan=(${geom.panX.toFixed(0)},${geom.panY.toFixed(0)})`);
      }
    } else {
      // No image / placeholder — buffer = container, CSS = buffer (legacy path).
      canvas.width = Math.max(1, Math.floor(canvasWidth));
      canvas.height = Math.max(1, Math.floor(canvasHeight));
      if (glCanvas && !(renderMode === 'gpu' && glAvailable)) {
        glCanvas.width = canvas.width;
        glCanvas.height = canvas.height;
      }
      canvas.style.width = `${canvas.width}px`;
      canvas.style.height = `${canvas.height}px`;
      if (glCanvas) {
        glCanvas.style.width = `${canvas.width}px`;
        glCanvas.style.height = `${canvas.height}px`;
      }
      drawGeomRef.current = null;
      presentGeomRef.current = null;
      fitRef.current = null;
      setCanvasDimensions({ width: canvas.width, height: canvas.height });
      setContentDimensions({ width: canvas.width, height: canvas.height });
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
      // Source-identity guard: during an image switch imageService still holds the
      // PREVIOUS image's pixels (the new decode is in flight) while displayImage is
      // already the incoming file and processedImageData was cleared to null. Skip the
      // stale full-res base draw in that window — the canvas was just cleared above, so
      // it stays blank until the new image's data lands (see isBaseImageStale).
      const baseStale = isBaseImageStale(currentImageData.filePath, displayImage.path);

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
      } else if (!baseStale) {
        // Use original image data (only when it belongs to the image being displayed)
        if (DEBUG_CANVAS) console.log('Canvas: Using original image data', currentImageData.width, 'x', currentImageData.height, 'channels detected');
        drawLoadedImageOptimized(ctx, canvas, currentImageData, currentImageData.data);
      } else if (DEBUG_CANVAS) {
        // Stale base + no processed data yet: skip the full-res redraw of the previous
        // image, leave the cleared canvas until the incoming image's data arrives.
        console.log(`Canvas: skipped stale base draw (${currentImageData.filePath}) while displaying ${displayImage.path}`);
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
      // Hash embeds path + dims + a sparse pixel sampling for cache invalidation. Extracted
      // to a pure helper (renderCacheHash) that clamps the center-area sampling step >= 1 —
      // sub-40px images previously produced a 0 step and looped forever (see helper docs).
      const dataHash = computeRenderCacheHash(currentImagePath, imageInfo.width, imageInfo.height, data);

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

        // Viewport-model dest rect (buffer px) from redrawCanvas; legacy centered-scale
        // fallback if geometry isn't set yet.
        const dg = drawGeomRef.current;
        const scaledWidth = dg ? dg.w : canvas.width * viewport.zoom;
        const scaledHeight = dg ? dg.h : canvas.height * viewport.zoom;
        const x = dg ? dg.x : (canvas.width - scaledWidth) / 2 + viewport.panX;
        const y = dg ? dg.y : (canvas.height - scaledHeight) / 2 + viewport.panY;

        if (DEBUG_CANVAS) {
          console.log(`🖼️ DRAWING (cached):
  Canvas: ${canvas.width}x${canvas.height}
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

      // Viewport-model dest rect (buffer px) from redrawCanvas; legacy centered-scale
      // fallback if geometry isn't set yet.
      const dg = drawGeomRef.current;
      const scaledWidth = dg ? dg.w : canvas.width * viewport.zoom;
      const scaledHeight = dg ? dg.h : canvas.height * viewport.zoom;
      const x = dg ? dg.x : (canvas.width - scaledWidth) / 2 + viewport.panX;
      const y = dg ? dg.y : (canvas.height - scaledHeight) / 2 + viewport.panY;

      if (DEBUG_CANVAS) {
        console.log(`🖼️ DRAWING (new):
  Canvas: ${canvas.width}x${canvas.height}
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
    // This call instance's token: any later loadImage call bumps the ref, marking
    // this instance stale at its next post-await check.
    const loadToken = ++loadTokenRef.current;
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
      // New image: the preview quality ratchet starts over at the base cap
      // (utils/previewQuality.ts) — a previous image's deep-zoom cap must not
      // tax every slider drag on this one.
      useAppStore.getState().setPreviewQualityCap(BASE_PREVIEW_CAP);


      setImageLoading(true);
      setDisplayImage(image);

      // Fetch this image's FULL saved edit state (decode options + module edits) in ONE IPC
      // read, up front — BEFORE decoding. Decode options AND the per-image edits live in the
      // same durable store entry, so one round-trip yields both. The decode options seed the
      // store below so ImageService decodes the base with the user's last-chosen
      // demosaic/highlights; the module edits are applied (in the beforeNotify hook below)
      // BEFORE the first pipeline pass. This replaces the old two-read flow (this read for
      // options + a second restoreForPath AFTER the load), where edits restored ~350ms after
      // the first pass — a visible unedited-image flash and a redundant second pass on every
      // edited photo.
      // The user-defaults read rides the same suspension point (Promise.all) so
      // the load-token check below still guards EVERY await before options land.
      const [savedState, decodeDefaults] = await Promise.all([
        editPersistenceService.getSavedEditState(image.path),
        loadRawDecodeDefaults(),
      ]);

      // The user may have switched images while the above await was in flight (rapid
      // filmstrip/gallery clicks) — bail before writing decode options for a superseded
      // call. Without this, image A's (stale) options could land in the store AFTER
      // image B's own loadImage call already set B's options, and then
      // ImageService.loadImage(image.path) below would decode A with the WRONG (B's or
      // neither's) options. The token also covers the A→B→A case the old path-equality
      // check missed: even if OUR path is current again via a newer call, this stale
      // instance must not proceed to dispatch a duplicate decode of it.
      if (loadTokenRef.current !== loadToken) {
        logger.info(`Image load of ${image.path} discarded: superseded before decode options resolved`);
        return;
      }
      // Shape-validate the persisted options through EditPersistenceService's validator (the same
      // guard getSavedRawDecodeOptions applies) BEFORE they reach the store/decoder — a corrupt
      // out-of-enum value from an old/buggy build must not seed the decode. Uses the validator's
      // sync variant so this reuses the single getSavedEditState read above (no second IPC).
      const validatedOptions = editPersistenceService.validateSavedRawDecodeOptions(savedState?.rawDecodeOptions);
      // No saved per-image options → the USER'S last-chosen defaults (memory
      // across pictures and sessions, v1.31.0; factory defaults when unset).
      useAppStore.getState().setRawDecodeOptions(validatedOptions ?? decodeDefaults);

      // Load the image. The beforeNotify hook fires synchronously once the base is decoded
      // (real dimensions known) but BEFORE ImageService notifies its load listeners — the
      // point that triggers the first pipeline pass. Seeding the restored module params there
      // makes that first pass render the EDITED image directly: one pass, no unedited flash.
      // The identity guard mirrors ImageService's own generation guard (belt-and-suspenders: a
      // superseded decode never reaches its notify, so this hook won't run for a stale image),
      // and local-adjustment geometry restores against the REAL decoded dimensions.
      // Passing onFullDecode opts into PROGRESSIVE open (interactive editor): loadImage paints the
      // fast embedded-JPEG preview first (beforeNotify below seeds edits at the preview dims — the
      // restored geometry is normalized so it re-bakes when the full decode swaps in), returns, and
      // runs the full 16-bit decode in the background. onFullDecode fires with the TRUE dims once
      // that swap lands, so the tile dims below (recorded at preview dims) upgrade to full res.
      await imageService.loadImage(
        image.path,
        (decoded) => {
          if (loadTokenRef.current !== loadToken) return;
          // Seed the durable upscale intent (Q7) from THIS image's saved state BEFORE restoreState —
          // so the baseline restoreState captures (serialize()) already includes the bakedUpscale
          // marker and a later edit's flush can't destroy it. onImageSwitched cleared it at loadImage
          // start; this reinstates the persisted intent so the Enhance panel offers a one-click
          // re-apply and Export warns instead of silently exporting at native res. NOT auto-applied.
          // Routed through the sync shape validator (mirrors the rawDecodeOptions guard just above):
          // an out-of-enum scale/mode from an old/buggy build or a tampered store must not reach the
          // store/Enhance panel as a fabricated intent.
          useAppStore.getState().setUpscaleIntent(editPersistenceService.validateBakedUpscaleIntent(savedState?.bakedUpscale));
          // Seed the durable DEBLUR intent + stacked bake order (Z1) from the same saved read. The
          // order defaults from whichever markers exist when no explicit bakeOrder was persisted
          // (single bake), so the reopen re-apply replays correctly for single AND stacked bakes.
          useAppStore.getState().setDeblurIntent(!!savedState?.bakedDeblur);
          useAppStore.getState().setBakeOrder(
            editPersistenceService.validateBakeOrder(savedState?.bakeOrder) ?? [
              ...(savedState?.bakedUpscale ? (['upscale'] as const) : []),
              ...(savedState?.bakedDeblur ? (['deblur'] as const) : []),
            ],
          );
          editPersistenceService.restoreState(savedState, decoded.width, decoded.height, image.path);
          // Panels that MIRROR module params into local state (RawDecodePanel's Highlight
          // recovery slider, LA layer lists, …) may have already read their module before
          // this restore landed — their image-change effects fire on currentImage, which
          // updates before the async decode resolves. Bump the shared re-read signal so
          // every mirror re-syncs to the restored params (same signal preset-apply and
          // undo use; without it a reopened image renders with its saved edits while the
          // panel displays defaults — v1.20.0 smoke H2 caught exactly this).
          useAppStore.getState().notifyExternalParamsChange();
        },
        (fullWidth, fullHeight) => {
          if (loadTokenRef.current !== loadToken) return;
          useAppStore.getState().setImageDimensions(image.id, { width: fullWidth, height: fullHeight });
        },
      );

      // The decode above is async — the user may have switched to a different image
      // while it was in flight (rapid filmstrip/gallery clicks). Re-check identity
      // before touching any per-image state below: setImageDimensions and checkpoint
      // history all target THIS image and would corrupt whatever is now actually on
      // screen if a newer loadImage call for a different image completed in the meantime
      // (mirrors RawImageService.reDecode's stillCurrent guard).
      const decoded = imageService.getCurrentImage();
      if (!decoded || decoded.filePath !== image.path) {
        logger.info(`Image load of ${image.path} discarded: current image changed during decode`);
        return;
      }

      // Now that the full image (including RAW) is actually decoded, its true
      // dimensions are known — upgrade the shared map so the gallery/dock tile
      // stops showing format-only meta (fix round 1, Critical review finding).
      // Skip while a progressive RAW open's background full decode is still running:
      // `decoded` here is the fast embedded PREVIEW (e.g. 2048px), not the true dims — writing
      // it would let the wrong size stick if the swap never lands. Leave the tile at
      // format-only meta (the pre-L3 semantic) until the real dims are known: either the
      // onFullDecode callback above fires them when the swap lands, or RawImageService.reDecode
      // writes them itself if it supersedes the swap (L3 review round 1, minor #5).
      if (!useAppStore.getState().developing) {
        useAppStore.getState().setImageDimensions(image.id, { width: decoded.width, height: decoded.height });
      }
      // NOTE: saved edits were already restored in the beforeNotify hook above — BEFORE the
      // first pipeline pass — so there is no restoreForPath / triggerReprocessing here. That
      // post-load restore + reprocess was the redundant SECOND pass that flashed the unedited image.
      // Load this image's checkpoint history; seed an "Opened" baseline if empty.
      await checkpointService.loadForPath(image.path);
      if (checkpointService.getCheckpoints().length === 0) checkpointService.record('Opened');
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


  // Redraw the 2D canvas when viewport (pan/zoom) changes. In GPU mode the present()
  // effect above already handles viewport changes, so the 2D blit is a no-op; skip it
  // explicitly to avoid a spurious drawLoadedImageOptimized call on every pan event.
  //
  // LOAD-BEARING (GPU zoom-in sizing): even though this effect skips redrawCanvas in
  // GPU mode, `viewport` being in redrawCanvas's OWN useCallback deps means each
  // zoom/pan changes redrawCanvas's identity, which re-runs the ResizeObserver effect
  // below ([redrawCanvas] deps), whose observe() initial delivery re-runs the sizing
  // block that grows the canvas box at zoom>fit (viewport-canvas model). Removing
  // `viewport` from redrawCanvas's deps, or narrowing the RO effect's deps to [],
  // silently reverts GPU zoom-in to fit-rect clipping — only the packaged smoke
  // would catch it.
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
    const pg = presentGeomRef.current;
    gpuPreviewPipeline.present({
      zoom: viewport.zoom,
      panX: viewport.panX,
      panY: viewport.panY,
      // Viewport-canvas geometry (Task R5): grow the GL buffer to the region when zoomed in.
      fitCssW: pg?.fitW,
      fitCssH: pg?.fitH,
      viewportCssW: pg?.viewportW,
      viewportCssH: pg?.viewportH,
      // Before/After is rendered by the dedicated <OriginalPane/> (App.tsx) — a separate
      // 50% pane that draws the PRISTINE imageService.getOriginalImage() snapshot — in
      // BOTH cpu and gpu modes. The GPU present split sampled srcTexture, which is the
      // editing BASE (= currentImage.data, mutated in place by rotate/flip/Auto-All via
      // updateCurrentImageData), so it could show an EDITED "before". Disable the GPU
      // split (always -1) and let the pristine OriginalPane be the single source of truth.
      splitX: -1,
    });
  }, [renderMode, gpuResultVersion, viewport, showOriginal, canvasDimensions]);

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
      const pg = presentGeomRef.current;
      gpuPreviewPipeline.present({
        zoom: st.viewport.zoom,
        panX: st.viewport.panX,
        panY: st.viewport.panY,
        splitX: -1,
        fitCssW: pg?.fitW,
        fitCssH: pg?.fitH,
        viewportCssW: pg?.viewportW,
        viewportCssH: pg?.viewportH,
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

  // Apply the current crop rect to the PREVIEW. Enables the crop through the
  // ADAPTER (setCropRegion) — the interactive path used to enable only the
  // inner CropModule while CropPipelineModule.process() gates on BOTH flags
  // (adapter isEnabled is cleared by resetAllModules on image open), so a
  // dragged crop never actually ran until a restart restored it via setParams.
  const applyCropToPreview = useCallback(() => {
    if (!cropModule) return;
    const p = cropModule.getCropModule().getParams();
    cropModule.setCropRegion(p.x, p.y, p.width, p.height);
    // A crop raises effective magnification (fewer source pixels rendered into
    // the same screen area) — bump the quality cap so the cropped preview
    // re-renders at restored pixel density. Same single reprocess covers both.
    const native = imageService.getCurrentImage();
    const need = computeRequiredPreviewCap({
      zoom: viewportRef.current.zoom,
      cropFraction: Math.min(p.width, p.height),
      nativeLongEdge: native ? Math.max(native.width, native.height) : 0,
    });
    const st = useAppStore.getState();
    if (need > st.previewQualityCap) st.setPreviewQualityCap(need);
    imageProcessingPipeline.invalidateModuleCache('crop');
    triggerReprocessing();
    setHasPendingCropChanges(false);
    setLiveCropParams(null);
  }, [cropModule, triggerReprocessing]);

  // Quality ratchet (v1.29): whenever zoom exceeds this image's previous
  // farthest zoom, refresh the preview at a higher cap so zoomed-in pixels
  // regain fit-view density. Debounced — continuous wheel-zoom triggers ONE
  // reprocess at rest; the cap only ratchets up (reset on image open).
  useEffect(() => {
    if (!displayImage) return;
    const t = setTimeout(() => {
      const native = imageService.getCurrentImage();
      const cropP = cropModule?.getCropModule().getParams();
      const cropApplied = !!cropModule?.getEnabled() && !!cropP?.enabled;
      const need = computeRequiredPreviewCap({
        zoom: viewport.zoom,
        cropFraction: cropApplied && cropP ? Math.min(cropP.width, cropP.height) : 1,
        nativeLongEdge: native ? Math.max(native.width, native.height) : 0,
      });
      const st = useAppStore.getState();
      if (need > st.previewQualityCap) {
        st.setPreviewQualityCap(need);
        st.triggerReprocessing();
      }
    }, 350);
    return () => clearTimeout(t);
  }, [viewport.zoom, displayImage, cropModule]);

  // Safety net: leaving the crop module with un-applied changes (apply normally
  // happens on handle mouse-release) still applies them.
  useEffect(() => {
    if (prevShowCropOverlay.current && !showCropOverlay && hasPendingCropChanges) {
      applyCropToPreview();
    }
    prevShowCropOverlay.current = showCropOverlay;
  }, [showCropOverlay, hasPendingCropChanges, applyCropToPreview]);

  // Check if a point is inside the image bounds
  // Handle window/container resize.
  // LOAD-BEARING: [redrawCanvas] deps are intentional — redrawCanvas's identity
  // changes with `viewport`, so this effect re-subscribes per zoom/pan and the
  // observe() initial delivery re-runs the sizing block. That is what grows the
  // canvas box in GPU mode at zoom>fit (see the viewport effect above). Do NOT
  // narrow these deps to [].
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
    // Don't start canvas dragging if crop handles are being used
    if (isCropHandleDragging) {
      return;
    }

    setIsDragging(true);
    setLastPan({ x: e.clientX - viewport.panX, y: e.clientY - viewport.panY });
  };

  // Symmetric pan bounds in CSS px for the given zoom, from the live fit-rect +
  // container (viewport-canvas model, Task R5). Content = fit × zoom pans within the
  // viewport = clamp(content, fit, container); the bound is half the overhang.
  const cssPanBounds = useCallback((zoom: number) => {
    const f = fitRef.current;
    if (!f) return { maxPanX: 0, maxPanY: 0 };
    const g = computeViewportGeometry(f.fitW, f.fitH, f.containerW, f.containerH, zoom, 0, 0);
    return { maxPanX: g.maxPanX, maxPanY: g.maxPanY };
  }, []);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;

    // Only allow panning when zoomed in (> 100%)
    if (viewport.zoom <= 1.0) {
      return; // No panning at fit or 100% zoom
    }

    // Pan is in CSS px (matches the screen-space mouse delta). Clamp to the content's
    // overhang beyond the viewport box (both are the same model as the draw + overlays,
    // so panning and the rendered image stay in lock-step in both axes).
    const { maxPanX, maxPanY } = cssPanBounds(viewport.zoom);

    const newPanX = clampPan(e.clientX - lastPan.x, maxPanX);
    const newPanY = clampPan(e.clientY - lastPan.y, maxPanY);

    setViewport({ panX: newPanX, panY: newPanY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Attach wheel as a non-passive native listener so e.preventDefault() is honoured.
  // React's onWheel is passive in modern browsers, which silently ignores preventDefault
  // and produces "Unable to preventDefault inside passive event listener" warnings.
  // Reads viewport and isCropHandleDragging via refs to avoid stale closures without
  // re-binding the listener on every state change.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      // Don't zoom when crop handles are being used
      if (isCropHandleDraggingRef.current) {
        return;
      }

      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const newZoom = Math.max(0.1, Math.min(5, viewportRef.current.zoom + delta));

      // Reset pan to center when zooming out to fit or less
      if (newZoom <= 1.0) {
        setViewport({ zoom: newZoom, panX: 0, panY: 0 });
      } else {
        // Re-clamp the existing pan to the NEW (smaller-at-lower-zoom) bounds so the
        // content never detaches from a viewport edge after a zoom step.
        const { maxPanX, maxPanY } = cssPanBounds(newZoom);
        setViewport({
          zoom: newZoom,
          panX: clampPan(viewportRef.current.panX, maxPanX),
          panY: clampPan(viewportRef.current.panY, maxPanY),
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setViewport, cssPanBounds]);

  return (
    <div className="h-full">
      {/* Main Canvas Area — transparent so the full-bleed workspace `--canvas-bg`
          shows through the letterbox margins (Glass · Sectioned, Task 5). */}
      <div
        ref={containerRef}
        data-pane-container="after"
        className="h-full relative overflow-hidden"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Aspect ratio preserving canvas container */}
        <div className="flex items-center justify-center w-full h-full">
          {/* Canvas wrapper - sized to match canvas for proper overlay positioning */}
          <div
            ref={canvasWrapperRef}
            className="relative"
            style={{
              width: canvasDimensions.width > 0 ? canvasDimensions.width : 'auto',
              height: canvasDimensions.height > 0 ? canvasDimensions.height : 'auto',
              // The letterboxed photo floats over the full-bleed workspace with a
              // soft drop shadow (Glass · Sectioned §3). This wrapper is sized to
              // the photo exactly, so the shadow hugs it (box-shadow, no filter).
              boxShadow: canvasDimensions.width > 0 ? PHOTO_SHADOW : 'none',
            }}
          >
            <canvas
              ref={canvasRef}
              data-pane="after"
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
              data-pane="after"
              className={isDragging ? 'cursor-grabbing' : 'cursor-grab'}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                // Declarative CSS size mirrors canvasDimensions (the aspect-correct fit-rect)
                // so the GL canvas is always the right shape even before the imperative
                // glCanvas.style.width/height in redrawCanvas() runs. This eliminates the
                // timing gap on first GPU frame (landscape-from-start stretch, symptom A).
                width: canvasDimensions.width > 0 ? `${canvasDimensions.width}px` : undefined,
                height: canvasDimensions.height > 0 ? `${canvasDimensions.height}px` : undefined,
                display: renderMode === 'gpu' && glAvailable ? 'block' : 'none'
              }}
            />

            {/* Grid Overlay — tracks the IMAGE, not the viewport box. The rule-of-thirds
                lines and crosshair ride the content rect from the shared viewport-canvas
                model (overlayContentRect), so at zoom > 1 (content larger than the box, panned)
                they stay locked to the image instead of the screen (Task P4). The SVG box
                clips whatever content falls outside the viewport. */}
            {showGrid && displayImage && canvasDimensions.width > 0 && (() => {
              const rect = overlayContentRect(
                contentDimensions.width, contentDimensions.height,
                canvasDimensions.width, canvasDimensions.height,
                viewport.zoom, viewport.panX, viewport.panY,
              );
              const cx = rect.x + rect.w / 2;
              const cy = rect.y + rect.h / 2;
              return (
                <svg
                  className="absolute inset-0 pointer-events-none"
                  width={canvasDimensions.width}
                  height={canvasDimensions.height}
                  style={{ opacity: 0.3 }}
                >
                  {/* Thirds grid over the image content rect */}
                  {[1, 2].map(i => (
                    <g key={`grid-${i}`}>
                      <line x1={rect.x + rect.w * i / 3} y1={rect.y} x2={rect.x + rect.w * i / 3} y2={rect.y + rect.h} stroke="#fff" strokeWidth="0.5" />
                      <line x1={rect.x} y1={rect.y + rect.h * i / 3} x2={rect.x + rect.w} y2={rect.y + rect.h * i / 3} stroke="#fff" strokeWidth="0.5" />
                    </g>
                  ))}
                  {/* Center crosshair at the image center */}
                  <line x1={cx - 10} y1={cy} x2={cx + 10} y2={cy} stroke="#fff" strokeWidth="0.5" />
                  <line x1={cx} y1={cy - 10} x2={cx} y2={cy + 10} stroke="#fff" strokeWidth="0.5" />
                </svg>
              );
            })()}

            {/* Rulers Overlay — ticks are anchored to the image's top-left corner via the
                shared content rect, so tick 0 sits on the image edge and every tick tracks
                the image under pan/zoom (label = CSS px from the image origin). Ticks that
                fall outside the viewport strip are dropped (Task P4). */}
            {showRulers && displayImage && canvasDimensions.width > 0 && (() => {
              const rect = overlayContentRect(
                contentDimensions.width, contentDimensions.height,
                canvasDimensions.width, canvasDimensions.height,
                viewport.zoom, viewport.panX, viewport.panY,
              );
              const topTicks = Array.from({ length: Math.ceil(rect.w / 50) + 1 }, (_, k) => k * 50)
                .map(off => ({ off, x: rect.x + off }))
                .filter(t => t.x >= 0 && t.x <= canvasDimensions.width);
              const leftTicks = Array.from({ length: Math.ceil(rect.h / 50) + 1 }, (_, k) => k * 50)
                .map(off => ({ off, y: rect.y + off }))
                .filter(t => t.y >= 0 && t.y <= canvasDimensions.height);
              return (
                <>
                  {/* Top ruler */}
                  <div
                    className="absolute top-0 left-0 pointer-events-none"
                    style={{ width: canvasDimensions.width, height: 20, backgroundColor: 'rgba(30,30,30,0.85)' }}
                  >
                    <svg width={canvasDimensions.width} height={20}>
                      {topTicks.map(({ off, x }) => (
                        <g key={`rtick-${off}`}>
                          <line x1={x} y1={14} x2={x} y2={20} stroke="#888" strokeWidth="0.5" />
                          <text x={x + 2} y={12} fill="#888" fontSize="8" fontFamily="monospace">{off}</text>
                        </g>
                      ))}
                    </svg>
                  </div>
                  {/* Left ruler */}
                  <div
                    className="absolute top-0 left-0 pointer-events-none"
                    style={{ width: 20, height: canvasDimensions.height, backgroundColor: 'rgba(30,30,30,0.85)' }}
                  >
                    <svg width={20} height={canvasDimensions.height}>
                      {leftTicks.map(({ off, y }) => (
                        <g key={`ltick-${off}`}>
                          <line x1={14} y1={y} x2={20} y2={y} stroke="#888" strokeWidth="0.5" />
                          <text x={2} y={y + 10} fill="#888" fontSize="8" fontFamily="monospace">{off}</text>
                        </g>
                      ))}
                    </svg>
                  </div>
                </>
              );
            })()}

            {/* Crop/Transform Overlay - 3x3 grid and darkened areas */}
            {cropModule && displayImage && canvasDimensions.width > 0 && (() => {
              // Get base params from module, override with live params during drag for real-time feedback
              const baseParams = cropModule.getCropModule().getParams();
              // While a crop is APPLIED (adapter enabled, no drag in progress) the
              // displayed content IS the cropped image — the rect (normalized to the
              // FULL image) would mis-map onto it. Render a full-frame rect instead:
              // handles sit on the cropped image's edges; grabbing one suspends the
              // crop (onDragStart below), the full picture returns and the rect
              // snaps back to its true position (the drag anchors on the REAL
              // params via anchorCropParams).
              const cropIsApplied =
                cropModule.getEnabled() && baseParams.enabled && !isCropHandleDragging;
              const displayParams = cropIsApplied
                ? { ...baseParams, x: 0, y: 0, width: 1, height: 1 }
                : (liveCropParams ? { ...baseParams, ...liveCropParams } : baseParams);

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
                  contentWidth={contentDimensions.width}
                  contentHeight={contentDimensions.height}
                  showOverlay={showCropOverlay}
                  showRotationGrid={isAdjustingRotation}
                />

                {/* Interactive Crop Handles - drag to resize crop */}
                <InteractiveCropHandles
                  imageWidth={imageService.getCurrentImage()?.width || 0}
                  imageHeight={imageService.getCurrentImage()?.height || 0}
                  cropParams={displayParams}
                  anchorCropParams={baseParams}
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

                    // Mark pending changes (applied on release; module-exit safety net)
                    setHasPendingCropChanges(true);
                  }}
                  onDragStart={() => {
                    setIsCropHandleDragging(true);
                    // Re-crop: a currently-applied crop is SUSPENDED for the drag so
                    // the full picture becomes visible again; the rect stays at its
                    // last position (drag anchor = real params, full-image space).
                    if (cropModule.getEnabled() && cropModule.getCropModule().getParams().enabled) {
                      cropModule.setEnabled(false);
                      imageProcessingPipeline.invalidateModuleCache('crop');
                      triggerReprocessing();
                    }
                  }}
                  onDragEnd={() => {
                    setIsCropHandleDragging(false);
                    // Apply on mouse release — the preview shows the crop immediately.
                    applyCropToPreview();
                  }}
                  viewport={viewport}
                  canvasDisplayWidth={canvasDimensions.width}
                  canvasDisplayHeight={canvasDimensions.height}
                  contentWidth={contentDimensions.width}
                  contentHeight={contentDimensions.height}
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
                  viewport={viewport}
                  contentWidth={contentDimensions.width}
                  contentHeight={contentDimensions.height}
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

        {/* Image Navigation Arrows re-homed to the floating filmstrip dock's chevrons
            (Glass · Sectioned, Task 6) — ThumbnailPanel's handlePrevious/handleNext. */}

        {/* Image Info Overlay re-homed to the floating filename chip in App.tsx
            (Glass · Sectioned, Task 5): `name · i of N · zoom%` top-left. */}

        {/* Star Rating Overlay re-homed to the footer's rating cluster (Glass ·
            Sectioned, Task 6) — StatusBar.tsx shows the current photo's rating. */}

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