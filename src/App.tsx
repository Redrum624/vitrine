import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { MenuBar } from './components/Layout/MenuBar';
import { Toolbar } from './components/Layout/Toolbar';
import { IconSidebar } from './components/Layout/IconSidebar';
import { FileBrowser } from './components/Layout/FileBrowser';
import { Canvas } from './components/Layout/Canvas';
import { AdjustmentPanel } from './components/Panels/AdjustmentPanel';
import { HistogramPanel } from './components/Panels/HistogramPanel';
import { ThumbnailPanel } from './components/Panels/ThumbnailPanel';
import { GalleryView } from './components/Gallery/GalleryView';
import { SettingsPanel } from './components/Panels/SettingsPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ExportDialog } from './components/Dialogs/ExportDialog';
import { ExportProgressBar } from './components/ExportProgressBar';
import { BatchProcessingDialog } from './components/Dialogs/BatchProcessingDialog';
import { PresetDialog } from './components/Dialogs/PresetDialog';
import { ImageSizeDialog } from './components/Dialogs/ImageSizeDialog';
import { GalleryRemoveDialog } from './components/Dialogs/GalleryRemoveDialog';
import { computeRemoval, trashImages, shouldHandleGalleryDelete } from './utils/galleryRemove';
import { keyboardEventBlocked } from './utils/keyboardScope';
import { NotificationSystem } from './components/UI/NotificationSystem';
import { useNotifications } from './hooks/useNotifications';
import { ShortcutsHelpDialog } from './components/Dialogs/ShortcutsHelpDialog';
import { StatusBar } from './components/Layout/StatusBar';
import { WelcomeScreen } from './components/Welcome/WelcomeScreen';
import { PerformanceMonitor } from './components/Debug/PerformanceMonitor';
import { keyboardShortcutsService, createDefaultShortcuts, createRatingShortcuts } from './services/KeyboardShortcutsService';
import { webGLImageProcessor } from './services/WebGLImageProcessor';
import { GpuPreviewPipeline } from './shaders/GpuPreviewPipeline';
import { setGpuUnsafeModuleIds } from './shaders/passDescriptors';
import { electronService } from './services/ElectronService';
import { imageService } from './services/ImageService';
import { ImageFileInfo, fileSystemService } from './services/FileSystemService';
import { useAppStore } from './stores/appStore';
import {
  CHROME_TOP, CHIP_LEFT, RIGHT_COLUMN_OFFSET, RIGHT_COLUMN_WIDTH, RIGHT_COLUMN_GAP, RIGHT_COLUMN_BOTTOM,
  PHOTO_INSET_LEFT, PHOTO_INSET_TOP, PHOTO_INSET_BOTTOM, formatFilenameChip, getPhotoInsetRight,
} from './layout/photoRegion';
import { formatGalleryFolderChip } from './utils/gallerySelection';
import { computeViewportGeometry } from './utils/viewportGeometry';
import { editPersistenceService } from './services/EditPersistenceService';
import { checkpointService } from './services/CheckpointService';
import { logger } from './utils/Logger';
import { sameImageList } from './utils/imageList';
import { seedImageRatings } from './utils/ratingSeeder';
import { historyService } from './services/HistoryService';
import { AdjustmentPreset } from './services/PresetService';
import { errorHandlingService } from './services/ErrorHandlingService';
import { appLifecycleService } from './services/AppLifecycleService';
import {
  rotateImage90CW, rotateImage90CCW, flipHorizontal, flipVertical,
  resizeImage, FilterContext
} from './utils/ImageFilters';
import { styleAnalysisService } from './services/StyleAnalysisService';
import { autoAdjustService, CAMERA_MATCHED_AUTO_STRENGTH } from './services/AutoAdjustService';
import { imageProcessingPipeline } from './services/ImageProcessingPipeline';
import { PrintDialog } from './components/Dialogs/PrintDialog';
import { InfoPopover } from './components/InfoPopover';
import { guardDeveloping } from './utils/developingGuard';

// Import pipeline tests for development
if (process.env.NODE_ENV === 'development') {
  import('./test/PipelineTest').then(({ testCompletePipeline, testWebWorkerProcessing }) => {
    // Make tests available in console for development
    (window as typeof window & { testPipeline: typeof testCompletePipeline }).testPipeline = testCompletePipeline;
    (window as typeof window & { testWebWorkers: typeof testWebWorkerProcessing }).testWebWorkers = testWebWorkerProcessing;
    logger.info('Development pipeline tests available: testPipeline(), testWebWorkers()');
  });
}

const MODULE_IDS = new Set(['crop', 'basicadj', 'whitebalance', 'tonecurve', 'enhance', 'shadowshighlights', 'colorbalance', 'localadjustments', 'lenscorrections']);
const isModuleTool = (tool: string) => MODULE_IDS.has(tool);

/**
 * Re-exported from utils/developingGuard.ts (round 2 of the L3 review — moved out of App.tsx so
 * module components can use the same gate without importing the top-level App component). See
 * that module for the full rationale. Re-exported here too so the gate stays unit-testable
 * without rendering the full App component graph (mirrors openFolderFromDialog below), and so
 * existing imports of `guardDeveloping` from './App' keep working unchanged.
 */
export { guardDeveloping };

/**
 * Renders the cached original (pre-edit) image for the Before/After split view.
 *
 * The pane mirrors Canvas.tsx's viewport-canvas geometry (Task R5) so both sides
 * track the same region when the user zooms or pans: it fits the original into its
 * own pane, then runs computeViewportGeometry with its OWN fit/container and a pan
 * converted from the shared main-canvas-space pan by (fitOrig / mainCanvasFit). At
 * zoom > fit the pane grows up to its box and pans the original within it; at
 * zoom ≤ fit it is pixel-identical to before.
 *
 * NOTE: this is deliberately NOT applied to the Reference-mode <img> block —
 * the reference image must remain viewport-independent (no transform).
 */
export function OriginalPane() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cache the uint8 offscreen canvas built from the float32 original so we
  // only do the expensive conversion once per image (not on every pan/zoom).
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  const { viewport, mainCanvasFit, baseImageVersion, originalSnapshotVersion } = useAppStore();

  // Build the offscreen canvas when this component mounts AND whenever the base image is
  // swapped in place (baseImageVersion bumps on every ImageService.updateCurrentImageData call —
  // a progressive RAW open's background full-decode swap, or a RAW Decode re-decode). The parent
  // re-keys us (key={currentImage?.id ?? 'none'}) on image SWITCH, so mount alone would cover a
  // fresh open, but not a swap on the image that's already showing: without baseImageVersion in
  // the deps, Before kept showing the graded embedded PREVIEW forever if the split stayed open
  // across the swap (L3 review round 1, minor #6) — getOriginalImage() only returns the fresh
  // (neutral, full-res) snapshot once we re-run this effect.
  useEffect(() => {
    const original = imageService.getOriginalImage();
    if (!original) return;

    const offscreen = document.createElement('canvas');
    offscreen.width = original.width;
    offscreen.height = original.height;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    const imgData = offCtx.createImageData(original.width, original.height);
    const sampleMax = Math.max(...original.data.slice(0, Math.min(4000, original.data.length)));
    const norm = sampleMax <= 1.0;
    for (let i = 0; i < original.data.length && i < imgData.data.length; i++) {
      imgData.data[i] = norm
        ? Math.round(Math.max(0, Math.min(1, original.data[i])) * 255)
        : Math.round(Math.max(0, Math.min(255, original.data[i])));
    }
    offCtx.putImageData(imgData, 0, 0);
    offscreenRef.current = offscreen;
    // baseImageVersion: in-place base swap (RAW full-decode / re-decode / bake).
    // originalSnapshotVersion: a fresh open recorded a new original (ordinary image
    // switch) — without it the Before pane kept the previous photo's original.
  }, [baseImageVersion, originalSnapshotVersion]);

  // Re-fit + redraw the Before pane from its cached offscreen snapshot. Extracted into a
  // stable callback so BOTH the viewport/fit effect and a dedicated ResizeObserver (below)
  // can trigger it — the pane's own size is not part of the shared viewport/mainCanvasFit
  // state, so a pure pane resize (dragging the before/after divider without changing zoom
  // or pan) has to re-fit off its element's ResizeObserver.
  const redrawOriginal = useCallback(() => {
    const offscreen = offscreenRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!offscreen || !canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageWidth = offscreen.width;
    const imageHeight = offscreen.height;

    // Fit the original into the FULL pane rect — no padding. This must match the
    // After canvas's box model (Canvas.tsx's redrawCanvas uses the full container
    // rect, no inset) so both panes letterbox edge-to-edge identically and grow
    // together at zoom > 1 (Task R5 review: this pane was previously inset by 40px,
    // which under-filled its half of the split relative to After and read as "Before
    // is cropped"). This is the fit-rect (content at zoom 1) for THIS pane.
    const rect = container.getBoundingClientRect();
    const availW = Math.max(1, rect.width);
    const availH = Math.max(1, rect.height);
    const imageAspect = imageWidth / imageHeight;
    const containerAspect = availW / availH;
    let fitW: number, fitH: number;
    if (imageAspect > containerAspect) {
      fitW = availW; fitH = availW / imageAspect;
    } else {
      fitH = availH; fitW = availH * imageAspect;
    }

    // Convert the shared (main-canvas-space, CSS px) pan into THIS pane's CSS px so the
    // same image fraction is centered in both panes, then run the SAME viewport-canvas
    // geometry as the main Canvas (Task R5): the pane grows from its fit-rect up to its
    // own available box when zoomed in and pans the original within it.
    const convX = mainCanvasFit.width > 0 ? fitW / mainCanvasFit.width : 1;
    const convY = mainCanvasFit.height > 0 ? fitH / mainCanvasFit.height : 1;
    const geom = computeViewportGeometry(
      fitW, fitH, availW, availH,
      viewport.zoom, viewport.panX * convX, viewport.panY * convY,
    );

    // Buffer stays at original resolution (sOrig = original px per fit CSS px) so zoom ≤ 1
    // is crisp and pixel-identical to before; it grows with the viewport when zoomed in.
    const sOrig = imageWidth / fitW;
    const bufW = Math.max(1, Math.round(geom.viewportW * sOrig));
    const bufH = Math.max(1, Math.round(geom.viewportH * sOrig));
    if (canvas.width !== bufW) canvas.width = bufW;
    if (canvas.height !== bufH) canvas.height = bufH;
    canvas.style.width = `${Math.round(geom.viewportW)}px`;
    canvas.style.height = `${Math.round(geom.viewportH)}px`;

    // Background (matches Canvas.tsx). Reset transform so fillRect covers the whole buffer.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw the original at the viewport-relative content rect (buffer px), matching the
    // main Canvas's drawGeomRef math.
    ctx.drawImage(
      offscreen,
      0, 0, imageWidth, imageHeight,
      geom.offsetX * sOrig, geom.offsetY * sOrig, geom.contentW * sOrig, geom.contentH * sOrig,
    );
  }, [viewport, mainCanvasFit]);

  // Redraw whenever the viewport (zoom/pan) or mainCanvasFit changes. mainCanvasFit is
  // enough of a trigger by itself: Canvas.redrawCanvas() republishes it as a FRESH object
  // (new reference) on every run, including runs caused by processedImageData changing (see
  // Canvas.tsx's `[processedImageData, ...]` redraw effect) — so this already re-fires
  // whenever the main canvas reprocesses.
  useEffect(() => {
    redrawOriginal();
  }, [redrawOriginal]);

  // Re-fit on a PURE pane resize. The before/after split divider can resize just this pane
  // without any viewport/mainCanvasFit change; without its own ResizeObserver the Before
  // pane kept the stale fit until the next zoom/pan. A ref holds the latest draw so this
  // effect subscribes exactly once (no churn as viewport changes). Falls back to a no-op
  // where ResizeObserver isn't available.
  const redrawRef = useRef(redrawOriginal);
  redrawRef.current = redrawOriginal;
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => redrawRef.current());
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} data-pane-container="before" className="w-full h-full flex items-center justify-center relative">
      <canvas
        ref={canvasRef}
        data-pane="before"
        style={{ display: 'block' }}
      />
      <div
        className="absolute top-3 left-3 px-3 py-1.5 rounded text-xs font-semibold tracking-wider uppercase pointer-events-none"
        style={{ backgroundColor: 'rgba(0,0,0,0.7)', color: '#ccc', backdropFilter: 'blur(4px)', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        Original
      </div>
    </div>
  );
}

/**
 * Dependencies for {@link openFolderFromDialog}. Injected so the folder-open
 * flow can be unit-tested without rendering the whole App component graph.
 */
export interface OpenFolderDeps {
  /** Whether we are running inside the Electron desktop app. */
  isElectron: () => boolean;
  /** Opens the native directory picker. */
  showOpenDialog: (
    options: { properties: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'> }
  ) => Promise<{ canceled: boolean; filePaths: string[] }>;
  /** Enumerates a folder's images via the existing FileSystemService mapping. */
  getFolderContents: (folderPath: string) => Promise<{ images: ImageFileInfo[] }>;
  /** The working folder-load path (filmstrip + open-first). */
  onFolderSelected: (images: ImageFileInfo[]) => void;
  /** Shows/hides the Welcome overlay. */
  setWelcomeVisible: (visible: boolean) => void;
  showSuccess: (title: string, message: string) => void;
  showError: (title: string, message: string) => void;
}

/**
 * Welcome screen "Open Folder" action: pick a directory, enumerate its images
 * and load them into the workspace via the existing folder-load path. Leaves the
 * Welcome overlay open on cancel, empty folder, or error.
 */
export async function openFolderFromDialog(deps: OpenFolderDeps): Promise<void> {
  if (!deps.isElectron()) {
    deps.showError('Open Folder', 'Folder browsing requires the desktop app');
    return;
  }

  try {
    const result = await deps.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return;
    }

    const folderPath = result.filePaths[0];
    const { images } = await deps.getFolderContents(folderPath);

    if (images.length === 0) {
      deps.showError('No Images', 'No supported images found in this folder');
      return;
    }

    deps.onFolderSelected(images);
    deps.setWelcomeVisible(false);
    deps.showSuccess('Folder Opened', `${images.length} image(s)`);
  } catch (error) {
    logger.error('Failed to open folder from welcome screen:', error);
    deps.showError('Open Folder', 'Could not read folder');
  }
}

/**
 * Builds the ImageFileInfo for a single file opened via File > Open / Ctrl+O /
 * the 'electron-file-open' relay. Mirrors the per-file shape handleFileImport
 * builds inline for its own entries (id/name/path/size/format/type/lastModified/
 * dateModified) so the workspace's currentImage state stays consistent across
 * both load paths. Exported (pure, no side effects) so the shape that feeds
 * setCurrentImage can be unit-tested without rendering the full App component
 * graph.
 */
export function imageFileInfoFromOpenedPath(filePath: string): ImageFileInfo {
  const ext = filePath.split('.').pop()?.toLowerCase() || 'unknown';
  return {
    id: `image-${Date.now()}`,
    name: filePath.split(/[/\\]/).pop() || filePath,
    path: filePath,
    size: 0, // Size will be determined when file is loaded
    format: ext,
    type: ext,
    lastModified: Date.now(),
    dateModified: new Date()
  };
}

// ─── Base-mutating transform actions (rotate / flip / resize) ────────────────
// Each of these bakes new pixels into the working base via
// `imageService.updateCurrentImageData`, so each is gated on the progressive-open
// `developing` window (final whole-branch review, critical #1): during that window
// the working image is the camera's ~2048px embedded preview, and the background
// full-decode swap (same generation/path/options — all three ImageService guards
// pass) would silently replace the freshly transformed base seconds later, undoing
// the edit. Module-level and dependency-injected (like `openFolderFromDialog`
// above) so the REAL handlers stay unit-testable without rendering the full App
// component graph; the App component binds its toast callbacks in thin
// useCallback wrappers below.

export interface TransformToasts {
  showInfo: (title: string, message: string) => void;
  showSuccess: (title: string, message: string) => void;
}

function getBaseImageContext(): { data: Float32Array; ctx: FilterContext } | null {
  const img = imageService.getCurrentImage();
  if (!img) return null;
  return {
    data: img.data,
    ctx: { width: img.width, height: img.height, channels: 4 }
  };
}

export function rotateCurrentImageCW(toasts: TransformToasts): void {
  if (guardDeveloping(toasts.showInfo, 'Rotate')) return;
  const img = getBaseImageContext();
  if (!img) return;
  const result = rotateImage90CW(img.data, img.ctx);
  imageService.updateCurrentImageData(result.data, result.width, result.height);
  useAppStore.getState().triggerReprocessing();
  toasts.showSuccess('Rotated', '90° clockwise');
}

export function rotateCurrentImageCCW(toasts: TransformToasts): void {
  if (guardDeveloping(toasts.showInfo, 'Rotate')) return;
  const img = getBaseImageContext();
  if (!img) return;
  const result = rotateImage90CCW(img.data, img.ctx);
  imageService.updateCurrentImageData(result.data, result.width, result.height);
  useAppStore.getState().triggerReprocessing();
  toasts.showSuccess('Rotated', '90° counter-clockwise');
}

export function flipCurrentImageHorizontal(toasts: TransformToasts): void {
  if (guardDeveloping(toasts.showInfo, 'Flip')) return;
  const img = getBaseImageContext();
  if (!img) return;
  const result = flipHorizontal(img.data, img.ctx);
  imageService.updateCurrentImageData(result, img.ctx.width, img.ctx.height);
  useAppStore.getState().triggerReprocessing();
  toasts.showSuccess('Flipped', 'Horizontal');
}

export function flipCurrentImageVertical(toasts: TransformToasts): void {
  if (guardDeveloping(toasts.showInfo, 'Flip')) return;
  const img = getBaseImageContext();
  if (!img) return;
  const result = flipVertical(img.data, img.ctx);
  imageService.updateCurrentImageData(result, img.ctx.width, img.ctx.height);
  useAppStore.getState().triggerReprocessing();
  toasts.showSuccess('Flipped', 'Vertical');
}

export function resizeCurrentImage(toasts: TransformToasts, newWidth: number, newHeight: number): void {
  if (guardDeveloping(toasts.showInfo, 'Image Size')) return;
  const img = getBaseImageContext();
  if (!img) return;
  const result = resizeImage(img.data, img.ctx, newWidth, newHeight);
  imageService.updateCurrentImageData(result.data, result.width, result.height);
  useAppStore.getState().triggerReprocessing();
  toasts.showSuccess('Resized', `${result.width} x ${result.height}`);
}

function App() {
  const { setViewport, resetZoom, viewport, processedImageData, setSelectedTool: storeSetSelectedTool, showGrid, showRulers, showOriginal, toggleGrid, toggleRulers, toggleOriginal, referenceMode, referenceImageUrl, referenceImageName, toggleReferenceMode, setReferenceImage, lastProcessingTimeMs, modulesActive, modulesTotal, alignmentAxisX, setAlignmentAxisX, viewMode, selectedImageIds, developing } = useAppStore();
  const [selectedTool, setSelectedToolLocal] = useState<string | null>('file-explorer'); // Default to file explorer

  // Wrapper to update both local state and store
  const setSelectedTool = useCallback((tool: string | null) => {
    setSelectedToolLocal(tool);
    storeSetSelectedTool(tool);
  }, [storeSetSelectedTool]);

  // Always-current ref to selectedTool, read by the once-registered keyboard-init
  // effect's onSelectTool closure. This keeps selectedTool OUT of that effect's dep
  // array so it registers shortcuts exactly once for the app's life instead of
  // tearing down + re-initialising on every tool switch / image open (the wasteful
  // destroy→register churn the profiler logged as a per-open "remount" block).
  const selectedToolRef = useRef<string | null>(selectedTool);
  useEffect(() => { selectedToolRef.current = selectedTool; }, [selectedTool]);

  // Initialize store with default selectedTool on mount
  useEffect(() => {
    storeSetSelectedTool('file-explorer');
  }, [storeSetSelectedTool]);

  // Histogram state - independent from tool selection
  const [histogramVisible, setHistogramVisible] = useState(false);
  const lastActiveModuleRef = useRef<string | null>('basicadj');

  // Filename-chip Info popover (Task Q6): camera EXIF + file facts, opened by
  // clicking the top-left filename chip. Anchored to the chip via this ref.
  const [infoOpen, setInfoOpen] = useState(false);
  const filenameChipRef = useRef<HTMLDivElement>(null);

  // Full-bleed workspace + live photo region (Glass · Sectioned, Task 5). The
  // alignment axis = horizontal center of the live photo-region rect; the
  // floating toolbar pill centers on it (and the dock/footer in Task 6).
  const workspaceRef = useRef<HTMLDivElement>(null);
  const photoRegionRef = useRef<HTMLDivElement>(null);

  // Unified tool selection handler with histogram logic
  const handleToolSelect = useCallback((tool: string) => {
    if (tool === 'histogram') {
      if (histogramVisible) {
        // Rule 2: histogram active → close only histogram
        setHistogramVisible(false);
      } else {
        // Open histogram
        setHistogramVisible(true);
        // Rule 1: no module active → also open last active module
        if (!selectedTool || !isModuleTool(selectedTool)) {
          if (lastActiveModuleRef.current) {
            setSelectedTool(lastActiveModuleRef.current);
          }
        }
      }
    } else {
      if (selectedTool === tool) {
        // Toggling off the current tool
        if (histogramVisible && isModuleTool(tool)) {
          // Rule 3: module+histogram active, module clicked → close both
          setSelectedTool(null);
          setHistogramVisible(false);
        } else {
          // Normal toggle off
          setSelectedTool(null);
        }
      } else {
        // Selecting a different tool
        setSelectedTool(tool);
        if (isModuleTool(tool)) {
          lastActiveModuleRef.current = tool;
        }
      }
    }
  }, [selectedTool, histogramVisible, setSelectedTool]);

  const [currentImage, setCurrentImage] = useState<ImageFileInfo | null>(null);
  // Always-current ref to the selected image, read by the once-registered keyboard
  // shortcuts (the Zustand store's currentImage isn't used by this app).
  const currentImageRef = useRef<ImageFileInfo | null>(null);
  useEffect(() => { currentImageRef.current = currentImage; }, [currentImage]);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  // Paths for a multi-export run (≥1 selected image); empty = single-image export.
  const [multiExportPaths, setMultiExportPaths] = useState<string[]>([]);
  const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false);
  const [isPresetDialogOpen, setIsPresetDialogOpen] = useState(false);
  const [isShortcutsDialogOpen, setIsShortcutsDialogOpen] = useState(false);
  // Gallery Del-remove (Task P11): the ids the confirm dialog is acting on (a
  // snapshot of the selection taken when Del is pressed). null = dialog closed.
  const [removeTargetIds, setRemoveTargetIds] = useState<string[] | null>(null);
  const [isWelcomeVisible, setIsWelcomeVisible] = useState(false);
  const [availableImages, setAvailableImages] = useState<ImageFileInfo[]>([]);
  // Mirrors availableImages OUTSIDE React state so handleFolderSelected can detect a
  // genuine list change synchronously (see its use below) without adding
  // `availableImages` to its own dependency array (which would recreate the callback
  // — and, per setAvailableImages's own functional-update comment, defeat the point
  // of comparing against the true previous list — on every folder reload).
  const prevAvailableImagesRef = useRef<ImageFileInfo[]>([]);
  const [batchSelectedImages, setBatchSelectedImages] = useState<ImageFileInfo[]>([]);
  const [showThumbnailPanel, setShowThumbnailPanel] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [imageSizeMode, setImageSizeMode] = useState<'imageSize' | 'canvasSize' | null>(null);
  const [hasStyleClipboard, setHasStyleClipboard] = useState(false);
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [refDragOver, setRefDragOver] = useState(false);
  const { notifications, remove: removeNotification, success: showSuccess, error: showError, info: showInfo } = useNotifications();

  // Keep the Undo/Redo enabled-state in sync with the checkpoint timeline. The History panel
  // (CheckpointService) IS the undo/redo history: every edit appends a checkpoint and every
  // record/restore/load/clear emits, so subscribing keeps canUndo/canRedo correct at all times.
  useEffect(() => {
    const sync = () => {
      setCanUndo(checkpointService.canUndo());
      setCanRedo(checkpointService.canRedo());
    };
    sync();
    return checkpointService.subscribe(sync);
  }, []);

  // Step the checkpoint timeline (Undo/Redo). After moving the active position, re-key the
  // panels and reprocess the canvas — the same follow-up the History panel does on a click —
  // so the menu, toolbar, keyboard and window-event paths all update the view identically.
  const doUndo = () => {
    try {
      if (checkpointService.undo()) {
        imageProcessingPipeline.invalidateModuleCache('localadjustments');
        const store = useAppStore.getState();
        store.notifyExternalParamsChange();
        store.triggerReprocessing();
      }
    } catch (error) {
      logger.error('Failed to undo:', error);
    }
  };
  const doRedo = () => {
    try {
      if (checkpointService.redo()) {
        imageProcessingPipeline.invalidateModuleCache('localadjustments');
        const store = useAppStore.getState();
        store.notifyExternalParamsChange();
        store.triggerReprocessing();
      }
    } catch (error) {
      logger.error('Failed to redo:', error);
    }
  };

  // Viewing control functions (available in JSX)
  const handleZoomIn = () => {
    setViewport({ zoom: Math.min(5, useAppStore.getState().viewport.zoom + 0.1) });
  };

  const handleZoomOut = () => {
    setViewport({ zoom: Math.max(0.1, useAppStore.getState().viewport.zoom - 0.1) });
  };

  const handleFitWindow = () => {
    resetZoom();
  };

  const handleActualSize = () => {
    setViewport({ zoom: 1, panX: 0, panY: 0 });
  };

  // ─── File > Import (opens multi-file dialog) ─────────────────────────
  const handleFileImport = useCallback(async () => {
    try {
      if (electronService.isElectron()) {
        const result = await window.electronAPI?.showOpenDialog({
          properties: ['openFile', 'multiSelections'],
          filters: [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'webp'] },
            { name: 'RAW Files', extensions: ['cr2', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });
        if (result && !result.canceled && result.filePaths?.length > 0) {
          window.dispatchEvent(new CustomEvent('electron-file-import', { detail: result.filePaths }));
        }
      } else {
        // Web fallback: use file input for multiple files
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'image/*';
        input.onchange = (e) => {
          const files = (e.target as HTMLInputElement).files;
          if (files && files.length > 0) {
            const urls = Array.from(files).map(f => URL.createObjectURL(f));
            window.dispatchEvent(new CustomEvent('electron-file-import', { detail: urls }));
          }
        };
        input.click();
      }
    } catch (error) {
      logger.error('Import dialog failed:', error);
      showError('Import Failed', 'Could not open file dialog');
    }
  }, [showError]);

  // ─── Image transforms ─────────────────────────────────────────────────
  // Base-mutating logic lives in the module-level transform actions above
  // (exported for tests); these wrappers just bind the App's toast callbacks.
  const handleRotateCW = useCallback(() => rotateCurrentImageCW({ showInfo, showSuccess }), [showInfo, showSuccess]);
  const handleRotateCCW = useCallback(() => rotateCurrentImageCCW({ showInfo, showSuccess }), [showInfo, showSuccess]);

  const handleFlipHorizontal = useCallback(() => flipCurrentImageHorizontal({ showInfo, showSuccess }), [showInfo, showSuccess]);

  const handleFlipVertical = useCallback(() => flipCurrentImageVertical({ showInfo, showSuccess }), [showInfo, showSuccess]);

  // ─── Auto adjustments ─────────────────────────────────────────────────
  const handleAutoLevels = useCallback(() => {
    if (guardDeveloping(showInfo, 'Auto Levels')) return;
    const img = imageService.getCurrentImage();
    if (!img) return;
    const stats = autoAdjustService.analyse(img.data, img.width, img.height);
    // Apply via tone curve (stretches histogram range per-channel)
    const tcPipe = imageProcessingPipeline.getModule('tonecurve');
    if (tcPipe) {
      const p = autoAdjustService.autoToneCurve(stats);
      const inner = (tcPipe as unknown as { getToneCurveModule?: () => { setParams: (p: Record<string, unknown>) => void } }).getToneCurveModule?.();
      if (inner) inner.setParams(p);
      imageProcessingPipeline.invalidateModuleCache('tonecurve');
    }
    useAppStore.getState().notifyExternalParamsChange();
    useAppStore.getState().triggerReprocessing();
    showSuccess('Auto Levels', 'Applied via tone curve');
  }, [showSuccess, showInfo]);

  const handleAutoContrast = useCallback(() => {
    if (guardDeveloping(showInfo, 'Auto Contrast')) return;
    const img = imageService.getCurrentImage();
    if (!img) return;
    const stats = autoAdjustService.analyse(img.data, img.width, img.height);
    // Apply via basic adjustments (contrast + exposure)
    const baMod = imageProcessingPipeline.getModule('basicadj');
    if (baMod) {
      const p = autoAdjustService.autoBasicAdj(stats);
      (baMod as unknown as { setParams: (p: Record<string, unknown>) => void }).setParams(p);
      imageProcessingPipeline.invalidateModuleCache('basicadj');
    }
    useAppStore.getState().notifyExternalParamsChange();
    useAppStore.getState().triggerReprocessing();
    showSuccess('Auto Contrast', 'Applied via basic adjustments');
  }, [showSuccess, showInfo]);

  const handleAutoColor = useCallback(() => {
    if (guardDeveloping(showInfo, 'Auto Color')) return;
    const img = imageService.getCurrentImage();
    if (!img) return;
    const stats = autoAdjustService.analyse(img.data, img.width, img.height);
    // Apply via white balance + color balance
    const wbMod = imageProcessingPipeline.getModule('temperature');
    if (wbMod) {
      const p = autoAdjustService.autoWhiteBalance(stats);
      (wbMod as unknown as { setParams: (p: Record<string, unknown>) => void }).setParams(p);
      imageProcessingPipeline.invalidateModuleCache('temperature');
    }
    const cbPipe = imageProcessingPipeline.getModule('colorbalance');
    if (cbPipe) {
      const p = autoAdjustService.autoColorBalance(stats);
      const inner = (cbPipe as unknown as { getColorBalanceModule?: () => { setParams: (p: Record<string, unknown>) => void } }).getColorBalanceModule?.();
      if (inner) inner.setParams(p);
      imageProcessingPipeline.invalidateModuleCache('colorbalance');
    }
    useAppStore.getState().notifyExternalParamsChange();
    useAppStore.getState().triggerReprocessing();
    showSuccess('Auto Color', 'Applied via white balance + color balance');
  }, [showSuccess, showInfo]);

  // ─── Image resize ─────────────────────────────────────────────────────
  const handleImageResize = useCallback(
    (newWidth: number, newHeight: number) => resizeCurrentImage({ showInfo, showSuccess }, newWidth, newHeight),
    [showInfo, showSuccess]
  );

  // ─── Style-grade indicator ─────────────────────────────────────────────
  // "Styled" chip state: true when a style grade (Auto All / preset / pasted
  // style) is sitting on top of the decode — detected live from the two
  // signature params a grade always writes: a non-identity tone-curve base
  // curve or non-zero Color Balance offsets. Live detection (not a persisted
  // flag) so manually resetting those modules clears the chip automatically.
  // externalParamsVersion bumps on every bulk apply, per-image restore, and
  // reprocess trigger, which covers all the ways these params change.
  const externalParamsVersion = useAppStore((s) => s.externalParamsVersion);
  const styleGradeActive = useMemo(() => {
    void externalParamsVersion; // dependency: recompute on any params change
    const tcPipe = imageProcessingPipeline.getModule('tonecurve') as unknown as {
      getToneCurveModule?: () => { getParams?: () => { baseCurve?: Array<{ x: number; y: number }> } };
    } | undefined;
    const baseCurve = tcPipe?.getToneCurveModule?.()?.getParams?.()?.baseCurve;
    if (Array.isArray(baseCurve) && baseCurve.some((pt) => Math.abs(pt.y - pt.x) > 0.001)) return true;
    const cbPipe = imageProcessingPipeline.getModule('colorbalance') as unknown as {
      getColorBalanceModule?: () => { getParams?: () => Record<string, Record<string, number>> };
    } | undefined;
    const cb = cbPipe?.getColorBalanceModule?.()?.getParams?.();
    if (cb) {
      for (const zone of ['shadows', 'midtones', 'highlights']) {
        const z = cb[zone];
        if (z && Object.values(z).some((v) => typeof v === 'number' && Math.abs(v) > 0.0005)) return true;
      }
    }
    return false;
  }, [externalParamsVersion]);

  // ─── Auto All ──────────────────────────────────────────────────────────
  const handleAutoAll = useCallback(() => {
    if (guardDeveloping(showInfo, 'Auto All')) return;
    const img = imageService.getCurrentImage();
    if (!img) { showError('Auto All', 'No image loaded'); return; }

    useAppStore.getState().setIsProcessing(true); // canvas spinner while applying

    // Camera-matched base → soften the style grade (half strength) and keep the
    // camera's WB. The profile targets are absolute and were tuned for the
    // neutral decode; at full strength on a matched base they double-grade
    // (camera tone mapping + full portfolio pull = crushed bright scenes).
    const cameraMatched = !!img.isRaw && !!useAppStore.getState().rawDecodeOptions.cameraMatch;

    // Single coordinator call: analyses once, picks the user-style bucket, and
    // returns the bundled params for every module.
    const result = autoAdjustService.autoAll(img.data, img.width, img.height, {
      strength: cameraMatched ? CAMERA_MATCHED_AUTO_STRENGTH : 1,
    });
    logger.info(`Auto All: bucket=${result.bucket} (${result.stats.meanLum.toFixed(3)} lum, cameraMatched=${cameraMatched})`);

    // Exposure
    const exposureMod = imageProcessingPipeline.getModule('exposure');
    if (exposureMod) {
      (exposureMod as unknown as { setCurrentParams: (p: Record<string, unknown>) => void }).setCurrentParams(result.exposure);
      imageProcessingPipeline.invalidateModuleCache('exposure');
    }

    // White Balance — gray-candidate estimation + damped correction, the SAME engine
    // as the WB "Auto" button: estimate the illuminant from near-neutral samples
    // (median cast, inverting the module's own gain model), then apply a partial
    // correction that cleans the cast while retaining some of the scene's warmth.
    // Skipped on a camera-matched base: the match already reproduces the camera's
    // WB decision, and a gray-world pull on top of it fights that intent.
    const wbMod = cameraMatched ? null : imageProcessingPipeline.getModule('temperature');
    if (wbMod) {
      const wbChannels = Math.max(3, Math.round(img.data.length / (img.width * img.height)));
      (wbMod as unknown as { autoDetectWhiteBalance: (d: Float32Array, ctx: { width: number; height: number; channels: number }) => void })
        .autoDetectWhiteBalance(img.data, { width: img.width, height: img.height, channels: wbChannels });
      imageProcessingPipeline.invalidateModuleCache('temperature');
    }

    // Basic Adjustments (autoBasicAdj already returns exposure: 0). Fold the auto
    // shadows/highlights into the new Basic Adjustments sliders, since the
    // standalone Shadows & Highlights module was replaced by them.
    const baMod = imageProcessingPipeline.getModule('basicadj');
    if (baMod) {
      const sh = result.shadowsHighlights as { shadows?: number; highlights?: number } | undefined;
      const baParams: Record<string, unknown> = { ...result.basicAdj };
      if (sh) {
        baParams.shadows = (((sh.shadows ?? 50) - 50) / 50) * 0.6;        // +lift shadows
        baParams.highlights = -(((sh.highlights ?? 50) - 50) / 50) * 0.6; // -recover highlights
      }
      (baMod as unknown as { setParams: (p: Record<string, unknown>) => void }).setParams(baParams);
      imageProcessingPipeline.invalidateModuleCache('basicadj');
    }

    // Tone Curve
    const tcPipeMod = imageProcessingPipeline.getModule('tonecurve');
    if (tcPipeMod) {
      const inner = (tcPipeMod as unknown as { getToneCurveModule?: () => { setParams: (p: Record<string, unknown>) => void } }).getToneCurveModule?.();
      if (inner) inner.setParams(result.toneCurve);
      imageProcessingPipeline.invalidateModuleCache('tonecurve');
    }

    // Color Balance
    const cbPipeMod = imageProcessingPipeline.getModule('colorbalance');
    if (cbPipeMod) {
      const inner = (cbPipeMod as unknown as { getColorBalanceModule?: () => { setParams: (p: Record<string, unknown>) => void } }).getColorBalanceModule?.();
      if (inner) inner.setParams(result.colorBalance);
      imageProcessingPipeline.invalidateModuleCache('colorbalance');
    }

    // (Shadows / Highlights are now applied via Basic Adjustments above.)

    // Refresh the open module panel's sliders, then reprocess.
    useAppStore.getState().notifyExternalParamsChange();
    useAppStore.getState().triggerReprocessing();
    showSuccess(
      'Auto All',
      `Applied "${result.bucket}" style profile${cameraMatched ? ' (softened — camera-matched base)' : ''}`,
    );
    logger.info(`Auto All: all modules adjusted from user style profile (bucket=${result.bucket})`);
  }, [showSuccess, showError, showInfo]);

  // ─── Print ─────────────────────────────────────────────────────────────
  const handlePrint = useCallback(() => {
    if (!imageService.getCurrentImage()) { showError('Print', 'No image loaded'); return; }
    // A low-res print (rendered from the embedded preview) is a wrong artifact — block until
    // the background full decode lands (L3 review round 1, important #2).
    if (guardDeveloping(showInfo, 'Print')) return;
    setIsPrintDialogOpen(true);
  }, [showError, showInfo]);

  // ─── Style copy / paste ────────────────────────────────────────────────
  const handleCopyStyle = useCallback(() => {
    if (guardDeveloping(showInfo, 'Copy Style')) return;
    const fp = styleAnalysisService.copyStyle();
    if (fp) {
      setHasStyleClipboard(true);
      showSuccess('Style Copied', `Luminance ${(fp.meanLuminance * 100).toFixed(0)}%, Sat ${(fp.meanSaturation * 100).toFixed(0)}%, ~${fp.estimatedTemp.toFixed(0)}K`);
    } else {
      showError('Copy Style', 'No image loaded to analyse');
    }
  }, [showSuccess, showError, showInfo]);

  const handlePasteStyle = useCallback(() => {
    if (!styleAnalysisService.hasStyle()) {
      showError('Paste Style', 'No style copied yet');
      return;
    }
    // pasteStyle() analyses the CURRENT (target) image's pixels — during the developing window
    // that's the graded preview, and the resulting histogram-match params would wrongly target
    // it (L3 review round 1, important #1).
    if (guardDeveloping(showInfo, 'Paste Style')) return;
    useAppStore.getState().setIsProcessing(true); // canvas spinner while applying
    const ok = styleAnalysisService.pasteStyle();
    if (ok) {
      showSuccess('Style Pasted', 'Adaptive adjustments applied');
    } else {
      useAppStore.getState().setIsProcessing(false);
      showError('Paste Style', 'No target image loaded');
    }
  }, [showSuccess, showError, showInfo]);

  // ─── Reference drop handler ────────────────────────────────────────────
  const handleReferenceDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setRefDragOver(false);

    const path = e.dataTransfer.getData('application/x-photo-path');
    const name = e.dataTransfer.getData('application/x-photo-name');
    if (!path) return;

    try {
      let dataUrl: string | null = null;
      if (window.electronAPI?.readImageAsDataURL) {
        dataUrl = await window.electronAPI.readImageAsDataURL(path);
      }
      if (!dataUrl) {
        // If the path is already a blob URL or data URL (web mode)
        dataUrl = path;
      }
      setReferenceImage(dataUrl, name || 'Reference');
      logger.info(`Reference image set: ${name}`);
    } catch (error) {
      logger.error('Failed to load reference image:', error);
      showError('Reference', 'Failed to load the reference image');
    }
  }, [setReferenceImage, showError]);

  // Handle image selection from FileBrowser
  const handleImageSelected = useCallback((image: ImageFileInfo) => {
    setCurrentImage(image);
    logger.info(`Image selected: ${image.name}`);
  }, []);

  const handleFolderSelected = useCallback((images: ImageFileInfo[]) => {
    logger.info(`Folder selected with ${images.length} images`);
    // A genuinely different image LIST (folder switch) — as opposed to a
    // watcher-triggered reload of the SAME folder — invalidates every previously
    // learned `imageDimensions` entry: those are keyed by image id, and ids get
    // reused across folders (both FileSystemService's id scheme and the
    // fixture/test data can produce id collisions across folders), so a stale
    // dimension could otherwise resurface under the new folder's same-id image.
    if (!sameImageList(prevAvailableImagesRef.current, images)) {
      useAppStore.getState().clearImageDimensions();
    }
    prevAvailableImagesRef.current = images;
    // Keep the existing array reference when the file list is unchanged (e.g.
    // a watcher-triggered reload after our own rating write, cloud sync or
    // antivirus touching a file) so effects keyed on `images` don't re-run
    // and reset the filmstrip scroll position.
    setAvailableImages(prev => (sameImageList(prev, images) ? prev : images));
    setShowThumbnailPanel(images.length > 0);
    if (images.length > 0 && !currentImage) {
      setCurrentImage(images[0]);
    }
  }, [currentImage]);

  // Eagerly seed every file's persisted xmp:Rating into the store on folder
  // load, so the rating filter matches the WHOLE folder — the per-tile lazy
  // seeds only cover thumbnails that actually mounted, which left rated-but-
  // never-scrolled-to photos invisible to filters after a restart. Keyed on
  // `availableImages` (reference-stable across watcher reloads) and deduped
  // by path inside the seeder, so this runs one cheap metadata read per file.
  useEffect(() => {
    const readRating = window.electronAPI?.readImageRating;
    if (!readRating || availableImages.length === 0) return;
    void seedImageRatings(
      availableImages,
      (p) => readRating(p),
      (id, r) => useAppStore.getState().setImageRating(id, r),
    );
  }, [availableImages]);

  // Opens the multi-export flow for the current selection (≥1 image) — shared by
  // the filmstrip dock's "Export N" button (which only appears at ≥2 selected)
  // and the Gallery toolbar's Export… button (which routes here at ≥1 selected).
  const handleExportSelected = useCallback(() => {
    const ids = useAppStore.getState().selectedImageIds;
    const paths = ids
      .map((id) => availableImages.find((img) => img.id === id)?.path)
      .filter((p): p is string => !!p);
    if (paths.length >= 1) {
      setMultiExportPaths(paths);
      setIsExportDialogOpen(true);
    }
  }, [availableImages]);

  // Gallery Del-remove (Task P11) — the single source that mutates the folder
  // listing everywhere (gallery grid, filmstrip dock, thumbnail panel all read
  // `availableImages`). Drops `idsToRemove` from the list, advances the open
  // photo when it was itself removed (next → prev → clear canvas), and prunes the
  // removed ids from the selection. Non-destructive on disk: persisted per-image
  // edits are intentionally left untouched (a session removal is not a "forget
  // edits"; a Recycle-Bin'd file's edits simply become orphaned — acceptable).
  const applyRemoval = useCallback((idsToRemove: string[]) => {
    if (idsToRemove.length === 0) return;
    const currentId = currentImageRef.current?.id ?? null;
    const result = computeRemoval(availableImages, idsToRemove, currentId);
    prevAvailableImagesRef.current = result.images;
    setAvailableImages(result.images);
    setShowThumbnailPanel(result.images.length > 0);
    if (result.currentChanged) setCurrentImage(result.currentImage);
    const removeSet = new Set(idsToRemove);
    const store = useAppStore.getState();
    store.setSelection(store.selectedImageIds.filter((id) => !removeSet.has(id)), null);
  }, [availableImages]);

  const handleRemoveFromSession = useCallback(() => {
    applyRemoval(removeTargetIds ?? []);
    setRemoveTargetIds(null);
  }, [removeTargetIds, applyRemoval]);

  const handleMoveToTrash = useCallback(async () => {
    const ids = removeTargetIds ?? [];
    setRemoveTargetIds(null);
    if (ids.length === 0) return;
    if (!window.electronAPI?.trashItems) {
      showError('Move to Recycle Bin', 'Trash is not available in this environment');
      return;
    }
    try {
      const { trashedIds, failedNames } = await trashImages(availableImages, ids, window.electronAPI);
      if (trashedIds.length > 0) applyRemoval(trashedIds);
      if (failedNames.length > 0) {
        showError(
          'Some files could not be moved',
          `${failedNames.length} file(s) stayed in the list: ${failedNames.join(', ')}`,
        );
      } else {
        showSuccess('Moved to Recycle Bin', `${trashedIds.length} photo(s) moved to the Recycle Bin`);
      }
    } catch {
      showError('Move to Recycle Bin', 'Failed to move the selected photos to the Recycle Bin');
    }
  }, [removeTargetIds, availableImages, applyRemoval, showError, showSuccess]);

  // Gallery-scoped Del: opens the confirm dialog for the current selection. Never
  // fires in Develop view (the mask-delete Del handler owns Del there), while an
  // input/dialog has focus, or with an empty selection — all gated by the pure
  // `shouldHandleGalleryDelete` predicate. Capture-phase so it settles the intent
  // before any bubble-phase listener; re-subscribes when the dialog open-state
  // flips so the "already open" guard reads a fresh value.
  useEffect(() => {
    const onGalleryDelete = (e: KeyboardEvent) => {
      // Shared DOM guard (keyboardScope.ts) covers the input/contentEditable target
      // AND any open aria-modal dialog (our own confirm, or Export/etc. reachable
      // from the gallery toolbar). The removeTargetIds !== null check below
      // additionally covers our own confirm dialog in the frame before its
      // aria-modal node commits to the DOM.
      if (keyboardEventBlocked(e)) return;
      const ids = useAppStore.getState().selectedImageIds;
      if (!shouldHandleGalleryDelete({
        key: e.key,
        viewMode: useAppStore.getState().viewMode,
        dialogOpen: removeTargetIds !== null,
        selectionCount: ids?.length ?? 0,
      })) return;
      e.preventDefault();
      e.stopPropagation();
      setRemoveTargetIds(ids);
    };
    document.addEventListener('keydown', onGalleryDelete, true);
    return () => document.removeEventListener('keydown', onGalleryDelete, true);
  }, [removeTargetIds]);

  // Opens the native folder picker and loads the result via the existing
  // folder-load path — shared by the Welcome screen's "Open Folder" and the
  // Gallery toolbar's "Open Folder" button.
  const handleOpenFolder = useCallback(() => {
    void openFolderFromDialog({
      isElectron: () => electronService.isElectron(),
      showOpenDialog: (options) => {
        if (!window.electronAPI?.showOpenDialog) {
          return Promise.resolve({ canceled: true, filePaths: [] });
        }
        return window.electronAPI.showOpenDialog(options);
      },
      getFolderContents: (folderPath) => fileSystemService.getFolderContents(folderPath),
      onFolderSelected: handleFolderSelected,
      setWelcomeVisible: setIsWelcomeVisible,
      showSuccess,
      showError,
    });
  }, [handleFolderSelected, showSuccess, showError]);

  // Convert raw file paths (from showOpenDialog) into ImageFileInfo[] by
  // statting each file. Mirrors the shape handleFolderSelected receives so the
  // batch queue can consume them. getFileStats fans out per file via Promise.all.
  const filePathsToImageFileInfo = useCallback(async (paths: string[]): Promise<ImageFileInfo[]> => {
    return Promise.all(
      paths.map(async (path): Promise<ImageFileInfo> => {
        const name = path.split(/[\\/]/).pop() || path;
        const ext = (name.split('.').pop() || '').toLowerCase();
        let size = 0;
        let modified = Date.now();
        try {
          const stats = await window.electronAPI?.getFileStats(path);
          if (stats) {
            size = stats.size;
            modified = stats.modified;
          }
        } catch (error) {
          logger.error(`Failed to stat file for batch queue: ${path}`, error);
        }
        return {
          id: path,
          name,
          path,
          size,
          // Match the casing produced by the main-process get-folder-contents
          // handler (uppercase extension) so ImageFileInfo.format is consistent
          // regardless of which producer created the entry.
          format: ext.toUpperCase(),
          type: ext,
          lastModified: modified,
          dateModified: new Date(modified)
        };
      })
    );
  }, []);

  // Dedupe ImageFileInfo lists by file path.
  const mergeUniqueImages = useCallback((existing: ImageFileInfo[], incoming: ImageFileInfo[]): ImageFileInfo[] => {
    const seen = new Set(existing.map((img) => img.path));
    const merged = [...existing];
    for (const img of incoming) {
      if (!seen.has(img.path)) {
        seen.add(img.path);
        merged.push(img);
      }
    }
    return merged;
  }, []);

  useEffect(() => {
    // Set up Electron event listeners
    const handleFileOpen = (event: CustomEvent) => {
      const filePath = event.detail;
      logger.info('Loading image:', filePath);
      // Set currentImage only - Canvas's reactive effect (currentImage.path !==
      // displayImage?.path) performs the single real decode, same as the sibling
      // paths (handleImageSelected, handleFolderSelected, handleFileImport). A
      // direct call to ImageService's loader here would decode twice: once here,
      // once more via Canvas's effect, since the image cache never matches on the
      // second call (see Canvas.tsx's loadImage callback for the equivalent call).
      // Canvas's loadImage already surfaces decode failures via notificationService
      // (the same singleton backing showError here), so no separate error toast
      // is needed for decode errors.
      setCurrentImage(imageFileInfoFromOpenedPath(filePath));
    };

    const handleFileImport = async (event: CustomEvent) => {
      try {
        const filePaths = event.detail;
        logger.info('Importing files:', filePaths);

        if (!filePaths || !Array.isArray(filePaths)) {
          logger.error('Invalid file paths for import');
          return;
        }

        // Convert file paths to ImageFileInfo objects
        const imageFiles: ImageFileInfo[] = filePaths.map((filePath: string, index: number) => ({
          id: `image-${Date.now()}-${index}`,
          name: filePath.split(/[/\\]/).pop() || `File ${index}`,
          path: filePath,
          size: 0, // Size will be determined when file is loaded
          format: filePath.split('.').pop()?.toLowerCase() || 'unknown',
          type: filePath.split('.').pop()?.toLowerCase() || 'unknown',
          lastModified: Date.now(),
          dateModified: new Date()
        }));

        // Add to available images
        setAvailableImages(prev => [...prev, ...imageFiles]);

        // Auto-select first image if none selected
        if (!currentImage && imageFiles.length > 0) {
          setCurrentImage(imageFiles[0]);
        }

        logger.info(`Files imported: ${filePaths.length} files`);
        showSuccess('Import Complete', `Imported ${filePaths.length} files`);
      } catch (error) {
        logger.error('Failed to import files:', error);
        showError('Import Failed', 'Unable to import files. Please try again.');
      }
    };

    const handleFileExport = async () => {
      try {
        logger.info('Export requested');

        // Check if we have an image loaded
        const currentImageData = imageService.getCurrentImage();
        if (!currentImageData) {
          logger.warn('No image loaded for export');
          showError('No Image Loaded', 'Please load an image before exporting');
          return;
        }

        // Open export dialog
        setIsExportDialogOpen(true);
        logger.info('Export dialog opened');
      } catch (error) {
        logger.error('Failed to open export dialog:', error);
      }
    };

    const handleUndo = () => doUndo();
    const handleRedo = () => doRedo();

    const handleResetAll = () => {
      try {
        logger.info('Reset all requested');
        historyService.resetAll();
        logger.info('All adjustments reset');
      } catch (error) {
        logger.error('Failed to reset adjustments:', error);
      }
    };

    // Add event listeners
    window.addEventListener('electron-file-open', handleFileOpen as unknown as () => void);
    window.addEventListener('electron-file-import', handleFileImport as unknown as () => void);
    window.addEventListener('electron-file-export', handleFileExport);
    window.addEventListener('electron-view-zoom-in', handleZoomIn);
    window.addEventListener('electron-view-zoom-out', handleZoomOut);
    window.addEventListener('electron-view-fit-window', handleFitWindow);
    window.addEventListener('electron-view-actual-size', handleActualSize);
    window.addEventListener('electron-edit-undo', handleUndo);
    window.addEventListener('electron-edit-redo', handleRedo);
    window.addEventListener('electron-edit-reset-all', handleResetAll);

    return () => {
      // Cleanup
      window.removeEventListener('electron-file-open', handleFileOpen as unknown as () => void);
      window.removeEventListener('electron-file-import', handleFileImport as unknown as () => void);
      window.removeEventListener('electron-file-export', handleFileExport);
      window.removeEventListener('electron-view-zoom-in', handleZoomIn);
      window.removeEventListener('electron-view-zoom-out', handleZoomOut);
      window.removeEventListener('electron-view-fit-window', handleFitWindow);
      window.removeEventListener('electron-view-actual-size', handleActualSize);
      window.removeEventListener('electron-edit-undo', handleUndo);
      window.removeEventListener('electron-edit-redo', handleRedo);
      window.removeEventListener('electron-edit-reset-all', handleResetAll);
      electronService.cleanup();
    };
  }, []);

  // Handle export completion
  const handleExportComplete = useCallback((success: boolean, outputPath?: string) => {
    if (success && outputPath) {
      logger.info(`Image exported successfully: ${outputPath}`);
      showSuccess('Export Complete', `Image saved to ${outputPath}`);
    } else {
      logger.error('Image export failed');
      showError('Export Failed', 'Unable to export image. Please check the logs for details.');
    }
  }, [showSuccess, showError]);

  // Handle preset application
  const handleApplyPreset = useCallback((preset: AdjustmentPreset) => {
    try {
      // The PresetService.applyPreset() method already handles applying
      // the preset settings to all modules in the pipeline
      logger.info(`Applied preset: ${preset.name}`);
    } catch (error) {
      logger.error('Failed to apply preset:', error);
    }
  }, []);

  // Initialize logging and keyboard shortcuts
  useEffect(() => {
    logger.info('App component mounted');
    logger.debug('Current viewport state:', useAppStore.getState().viewport);

    // Initialize global error handling
    errorHandlingService.setupGlobalErrorHandling();
    logger.info('Global error handling initialized');

    if (electronService.isElectron()) {
      logger.info('Running in Electron desktop mode');
    } else {
      logger.info('Running in web browser mode');
    }

    // Initialize keyboard shortcuts
    const shortcuts = createDefaultShortcuts({
      onOpen: () => electronService.isElectron() && electronService.openFile(),
      onExport: () => setIsExportDialogOpen(true),
      onUndo: () => doUndo(),
      onRedo: () => doRedo(),
      onResetAll: () => historyService.resetAll(),
      onZoomIn: handleZoomIn,
      onZoomOut: handleZoomOut,
      onZoomFit: handleFitWindow,
      onZoomActual: handleActualSize,
      onTogglePresets: () => setIsPresetDialogOpen(true),
      onToggleBatch: () => setIsBatchDialogOpen(true),
      onSelectTool: (tool) => setSelectedTool(selectedToolRef.current === tool ? null : tool),
    });

    // Register all shortcuts
    shortcuts.forEach(shortcut => keyboardShortcutsService.register(shortcut));

    // Help shortcut
    keyboardShortcutsService.register({
      id: 'help-shortcuts',
      key: 'F1',
      description: 'Show keyboard shortcuts',
      category: 'help' as const,
      action: () => setIsShortcutsDialogOpen(true)
    });

    keyboardShortcutsService.register({
      id: 'help-shortcuts-alt',
      key: '?',
      shiftKey: true,
      description: 'Show keyboard shortcuts',
      category: 'help' as const,
      action: () => setIsShortcutsDialogOpen(true)
    });

    // Before/after comparison
    keyboardShortcutsService.register({
      id: 'view-before-after',
      key: 'b',
      description: 'Toggle before/after comparison',
      category: 'view' as const,
      action: () => useAppStore.getState().toggleOriginal()
    });

    // Star rating: 1-5 set the rating on the current image, 0 clears it. Disabled
    // in Gallery mode — GalleryView owns 1-5/0 there (rates the whole selection
    // instead of just the single current image); this guard prevents the two
    // handlers double-firing on the same keypress.
    const applyRating = (rating: number) => {
      if (useAppStore.getState().viewMode === 'gallery') return;
      const img = currentImageRef.current;
      if (!img) return;
      useAppStore.getState().setImageRating(img.id, rating);
      // Persist to the file (xmp:Rating) so it shows in OS file details.
      window.electronAPI?.writeImageRating?.(img.path, rating);
    };
    // The `when` gate (NOT just the applyRating guard above) is what keeps
    // Gallery rating alive: the shortcuts service swallows matched keys at
    // capture phase, so without it the digits never reached GalleryView's own
    // bubble-phase 1-5/0 selection-rating listener (live-verified dead).
    createRatingShortcuts(
      applyRating,
      () => useAppStore.getState().viewMode !== 'gallery',
    ).forEach((shortcut) => keyboardShortcutsService.register(shortcut));

    // Numpad rating: match by physical key code (Numpad0-5) so it rates regardless
    // of NumLock. With NumLock off the numpad emits arrow/nav keys (Numpad4=ArrowLeft
    // etc.) — capture-phase + stopPropagation rates the photo and blocks the
    // bubble-phase filmstrip arrow navigation, so the numpad is "just numbers".
    const onNumpadRating = (e: KeyboardEvent) => {
      const m = /^Numpad([0-5])$/.exec(e.code);
      if (!m) return;
      // Shared guard (keyboardScope.ts): don't rate while typing in a field OR
      // while a modal dialog is open. Returns BEFORE stopPropagation/preventDefault
      // so a blocked keypress still reaches the input/dialog's own handlers.
      if (keyboardEventBlocked(e)) return;
      // Gallery mode: bail BEFORE stopPropagation/preventDefault so the keydown
      // bubbles through to GalleryView's own bubble-phase listener (which rates
      // the whole selection there). Swallowing it here first — as this used to
      // do — made numpad rating silently dead in Gallery, since applyRating()
      // itself already no-ops for viewMode === 'gallery'.
      if (useAppStore.getState().viewMode === 'gallery') return;
      if (!currentImageRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      applyRating(parseInt(m[1], 10));
    };
    document.addEventListener('keydown', onNumpadRating, true);

    logger.info(`Initialized ${shortcuts.length + 3} keyboard shortcuts`);

    // Undo/redo enabled-state is kept in sync by the checkpointService subscription effect.

    // Setup app lifecycle service for proper closing
    appLifecycleService.registerUnsavedChangesChecker({
      hasUnsavedChanges: () => historyService.hasUnsavedChanges(),
      getDescription: () => 'You have unsaved edits to the current image'
    });

    appLifecycleService.registerCleanupTask(async () => {
      logger.info('Cleaning up keyboard shortcuts service...');
      keyboardShortcutsService.destroy();
    });

    appLifecycleService.registerCleanupTask(async () => {
      logger.info('Cleaning up image service...');
      // Additional cleanup for image service if needed
    });

    // Cleanup on unmount
    return () => {
      document.removeEventListener('keydown', onNumpadRating, true);
      keyboardShortcutsService.destroy();
    };
    // Mount-only ([] deps): shortcuts register ONCE for the app's life. The two
    // pieces of live state this effect reads (selectedTool via onSelectTool,
    // currentImage via the rating handlers) are read through refs
    // (selectedToolRef / currentImageRef), so an image switch or tool change is a
    // pure state update — never a destroy→re-register cycle. setSelectedTool and
    // the handler closures are all stable, so capturing them once is correct.
    // (react-hooks/exhaustive-deps is disabled project-wide — see eslint.config.js.)
  }, []);

  // Show the welcome screen once for first-time users — on mount only ([] deps).
  // Kept as its own mount-only effect (separate from the keyboard-init effect
  // above, which is now also mount-only) so this one-shot timer can never be
  // re-armed by a selectedTool/currentImage change and pop the modal up repeatedly.
  useEffect(() => {
    const welcomeDismissed = localStorage.getItem('photo-editor-welcome-dismissed');
    if (!welcomeDismissed && !imageService.getCurrentImage()) {
      const t = setTimeout(() => setIsWelcomeVisible(true), 1000);
      return () => clearTimeout(t);
    }
  }, []);

  // [GPU POC] On startup, report WebGL2 availability + an exposure GPU-vs-CPU
  // benchmark so the GPU-acceleration path can be validated in the real app.
  useEffect(() => {
    const r = webGLImageProcessor.benchmark(2048, 2048, 1);
    logger.info(
      `[GPU POC] WebGL2 ${r.available ? 'AVAILABLE' : 'unavailable'} — exposure ${r.width}x${r.height}: ` +
      `GPU=${r.gpuMs != null ? r.gpuMs.toFixed(1) + 'ms' : 'n/a'} CPU=${r.cpuMs.toFixed(1)}ms maxDiff=${r.maxDiff.toExponential(1)}`
    );

    // [GPU-PIPELINE] Resident-texture ping-pong self-test: render each module pass through
    // a THROWAWAY GpuPreviewPipeline instance and compare the readback to the CPU reference.
    // A fresh instance (not the singleton) keeps the singleton from holding stale test data
    // / a throwaway canvas. Runs in BOTH dev AND production: its result GATES the GPU path —
    // any module whose shader fails the self-test is routed to the CPU bridge by
    // buildPassList (setGpuUnsafeModuleIds), so a broken GPU shader (e.g. the tonecurve LUT
    // pass rendering an image red) falls back to the proven CPU pipeline instead of shipping
    // a corrupted preview to the user.
    {
      const probe = new GpuPreviewPipeline();
      try {
        if (probe.attach()) {
          const st = probe.selfTest();
          setGpuUnsafeModuleIds(st.unsafe);
          logger.info(
            `[GPU-PIPELINE] self-test maxDiff=${st.maxDiff.toExponential(2)} ${st.ok ? 'PASS' : 'FAIL'}` +
            (st.unsafe.length ? ` — CPU fallback for: ${st.unsafe.join(', ')}` : ''),
          );
          if (process.env.NODE_ENV === 'development') {
            // present() smoke check (dev only): no GL errors on the data left by selfTest().
            probe.present({ zoom: 1, panX: 0, panY: 0 });
            const presentErr = probe.glError();
            logger.info(`[GPU-PIPELINE] present glError=${presentErr}${presentErr === 0 ? ' (OK)' : ' (UNEXPECTED ERROR)'}`);
          }
        } else {
          logger.info('[GPU-PIPELINE] self-test skipped — WebGL2/float unavailable');
        }
      } finally {
        probe.destroy();
      }
    }
  }, []);

  // Persist the current image's edits (debounced) whenever the processed result
  // changes, so edits survive sessions. Restore happens in Canvas on image load;
  // the service only writes when the state actually differs from the loaded baseline.
  const processingVersion = useAppStore((s) => s.processingVersion);
  useEffect(() => {
    editPersistenceService.scheduleSave();
    // Record a History checkpoint after the user stops editing, labelled by the active
    // module. De-duped + debounced inside the service, so a slider drag = one checkpoint
    // and the load-triggered reprocess records nothing new.
    const TOOL_LABELS: Record<string, string> = {
      crop: 'Crop & Transform', basicadj: 'Basic Adjustments', whitebalance: 'White Balance',
      tonecurve: 'Tone Curve', colorbalance: 'Color Balance',
      lenscorrections: 'Lens Corrections', localadjustments: 'Local Adjustments',
    };
    const tool = useAppStore.getState().selectedTool;
    checkpointService.recordDebounced((tool && TOOL_LABELS[tool]) || 'Edit');
  }, [processingVersion]);

  // Global: mouse-wheel over any range slider adjusts it one step per tick. Sets the
  // value via the native setter + dispatches input/change so React's onChange fires.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const input = e.target as HTMLInputElement | null;
      if (!input || input.tagName !== 'INPUT' || input.type !== 'range' || input.disabled) return;
      e.preventDefault();
      const step = parseFloat(input.step) || 1;
      const min = parseFloat(input.min);
      const max = parseFloat(input.max);
      const decimals = (input.step.split('.')[1] || '').length;
      let val = (parseFloat(input.value) || 0) + (e.deltaY < 0 ? step : -step);
      if (!Number.isNaN(min)) val = Math.max(min, val);
      if (!Number.isNaN(max)) val = Math.min(max, val);
      const next = decimals ? val.toFixed(decimals) : String(val);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);

  // Alignment axis: horizontal center (workspace-relative px) of the LIVE photo
  // region. Recomputed on any workspace/region resize (ResizeObserver + window
  // resize) and when the right column presence changes (deps below).
  useEffect(() => {
    const region = photoRegionRef.current;
    const workspace = workspaceRef.current;
    if (!region || !workspace) return;
    const compute = () => {
      const r = region.getBoundingClientRect();
      const w = workspace.getBoundingClientRect();
      if (r.width > 0) setAlignmentAxisX(r.left - w.left + r.width / 2);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(region);
    ro.observe(workspace);
    window.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [setAlignmentAxisX, selectedTool, histogramVisible]);

  // Same gate the floating right column (histogram/module card) renders under —
  // when neither is visible, the photo region's right inset shrinks to just
  // clear the icon rail instead of reserving the full column width (Task 4/R4).
  const rightColumnVisible = !!(selectedTool || histogramVisible);

  return (
    <ErrorBoundary>
      <div className="h-screen flex flex-col bg-dark-900 text-dark-300">
      {/* Menu Bar */}
      <MenuBar
        onFileOpen={() => electronService.isElectron() && electronService.openFile()}
        onFileImport={handleFileImport}
        onFileExport={() => setIsExportDialogOpen(true)}
        onEditUndo={doUndo}
        onEditRedo={doRedo}
        onEditReset={() => historyService.resetAll()}
        onViewZoomIn={handleZoomIn}
        onViewZoomOut={handleZoomOut}
        onViewFitWindow={handleFitWindow}
        onViewActualSize={handleActualSize}
        onViewToggleGrid={toggleGrid}
        onViewToggleRulers={toggleRulers}
        onViewToggleOriginal={toggleOriginal}
        onWindowPresets={() => setIsPresetDialogOpen(true)}
        onWindowBatch={() => setIsBatchDialogOpen(true)}
        onWindowHelp={() => setIsShortcutsDialogOpen(true)}
        onWindowWelcome={() => setIsWelcomeVisible(true)}
        // Image menu
        onImageSize={() => setImageSizeMode('imageSize')}
        onCanvasSize={() => setImageSizeMode('canvasSize')}
        onRotateCW={handleRotateCW}
        onRotateCCW={handleRotateCCW}
        onFlipHorizontal={handleFlipHorizontal}
        onFlipVertical={handleFlipVertical}
        // Adjust menu
        onAutoLevels={handleAutoLevels}
        onAutoContrast={handleAutoContrast}
        onAutoColor={handleAutoColor}
        onBrightnessContrast={() => handleToolSelect('basicadj')}
        onLevels={() => handleToolSelect('basicadj')}
        onCurves={() => handleToolSelect('tonecurve')}
        // State
        canUndo={canUndo}
        canRedo={canRedo}
        showGrid={showGrid}
        showRulers={showRulers}
        showOriginal={showOriginal}
        hasImage={!!imageService.getCurrentImage()}
      />

      {/* Main Content — full-bleed workspace with floating glass chrome (Task 5) */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Full-bleed workspace: `--canvas-bg` between the menu bar and footer.
            The photo region + all chrome float above it (absolute). */}
        <div
          ref={workspaceRef}
          className="flex-1 relative overflow-hidden"
          style={{ background: 'var(--canvas-bg)' }}
        >
          {/* Multi-export progress (top-left overlay) */}
          <ExportProgressBar />

          {/* Photo region — the box the Canvas letterboxes inside. Insets derived
              from the floating chrome so nothing overlaps the photo. Splits 50/50
              internally for Before/After and Reference modes. Stays mounted (not
              conditionally unmounted) when viewMode is 'gallery' — display:none only
              — so the Canvas/decode state survives the round-trip AND the alignment-
              axis ResizeObserver keeps observing the SAME node (a detach/reattach on
              unmount would otherwise stop tracking window resizes while hidden). */}
          <div
            ref={photoRegionRef}
            className="absolute flex"
            style={{
              left: PHOTO_INSET_LEFT,
              right: getPhotoInsetRight(rightColumnVisible),
              top: PHOTO_INSET_TOP,
              bottom: PHOTO_INSET_BOTTOM,
              display: viewMode === 'develop' ? 'flex' : 'none',
            }}
          >
            {/* Before/After pane — left half shows original (only when showOriginal) */}
            {showOriginal && (
              <div
                className="flex items-center justify-center"
                style={{ width: '50%', height: '100%', borderRight: '2px solid var(--border)', position: 'relative' }}
              >
                <OriginalPane key={currentImage?.id ?? 'none'} />
              </div>
            )}

            {/* Reference pane — left half (only when referenceMode) */}
            {referenceMode && (
              <div
                className="flex items-center justify-center"
                style={{
                  width: '50%',
                  height: '100%',
                  borderRight: '2px solid var(--border)',
                  position: 'relative',
                }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setRefDragOver(true); }}
                onDragLeave={() => setRefDragOver(false)}
                onDrop={handleReferenceDrop}
              >
                {referenceImageUrl ? (
                  <div className="w-full h-full flex items-center justify-center p-5 relative">
                    <img
                      src={referenceImageUrl}
                      alt={referenceImageName || 'Reference'}
                      className="max-w-full max-h-full object-contain"
                      draggable={false}
                    />
                    {/* Label */}
                    <div
                      className="absolute top-3 left-3 px-3 py-1.5 rounded text-xs font-semibold tracking-wider uppercase pointer-events-none"
                      style={{ backgroundColor: 'rgba(0,0,0,0.7)', color: '#ccc', backdropFilter: 'blur(4px)', border: '1px solid rgba(255,255,255,0.1)' }}
                    >
                      Reference — {referenceImageName}
                    </div>
                    {/* Drop overlay */}
                    {refDragOver && (
                      <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: 'rgba(59,130,246,0.15)', border: '2px dashed rgba(59,130,246,0.5)' }}>
                        <span className="text-sm font-medium" style={{ color: 'rgba(147,197,253,0.9)' }}>Replace reference</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center relative" style={{ color: 'var(--gray-600)' }}>
                    <span className="text-lg font-semibold tracking-wider uppercase mb-2">Reference</span>
                    <span className="text-xs" style={{ color: 'var(--gray-700)' }}>Drag a photo from the filmstrip</span>
                    {/* Drop overlay */}
                    {refDragOver && (
                      <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: 'rgba(59,130,246,0.15)', border: '2px dashed rgba(59,130,246,0.5)' }}>
                        <span className="text-sm font-medium" style={{ color: 'rgba(147,197,253,0.9)' }}>Drop here to set reference</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Main canvas pane — the photo (drop shadow applied inside Canvas on
                the letterbox wrapper so it hugs the image, not the region).
                `min-w-0`/`min-h-0` are load-bearing: without them a flex child
                keeps its intrinsic (canvas) size and refuses to shrink when the
                region narrows, overflowing into the column and clipping the photo. */}
            <div className="flex-1 min-w-0 min-h-0" style={{ height: '100%' }}>
              <Canvas
                onFitWindow={handleFitWindow}
                onActualSize={handleActualSize}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                zoom={viewport.zoom}
                currentImage={currentImage}
              />
            </div>
          </div>

          {/* Gallery grid (Task 7) — replaces the photo region when viewMode is
              'gallery'. Stays mounted (visible toggle) so its own thumbnail cache
              survives Develop ↔ Gallery round-trips, mirroring the dock. */}
          <GalleryView
            images={availableImages}
            onImageSelect={setCurrentImage}
            visible={viewMode === 'gallery'}
            onRequestRemove={setRemoveTargetIds}
          />

          {/* Floating filename chip (Develop) — top-left: `name · i of N · zoom%`.
              A single image loaded outside a folder listing (list total 0) clamps to
              "1 of 1" rather than showing a stale/zero count. Gallery shows the
              folder chip instead (mirrors the same top-left idiom). */}
          {viewMode === 'gallery' ? (
            <div
              className="glass-chrome no-select"
              style={{
                position: 'absolute',
                left: CHIP_LEFT,
                top: CHROME_TOP,
                borderRadius: '12px',
                padding: '7px 13px',
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--glass-text-chrome-primary)',
                zIndex: 30,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {formatGalleryFolderChip(availableImages, selectedImageIds?.length ?? 0)}
            </div>
          ) : currentImage && (() => {
            const { current, total } = fileSystemService.getCurrentImageInfo();
            return (
              <div
                ref={filenameChipRef}
                data-testid="filename-chip"
                role="button"
                tabIndex={0}
                aria-label="Image info"
                aria-expanded={infoOpen}
                className="glass-chrome no-select"
                onClick={() => setInfoOpen((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setInfoOpen((v) => !v);
                  }
                }}
                style={{
                  position: 'absolute',
                  left: CHIP_LEFT,
                  top: CHROME_TOP,
                  borderRadius: '12px',
                  padding: '7px 13px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: 'var(--glass-text-chrome-primary)',
                  zIndex: 30,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatFilenameChip({
                  name: currentImage.name,
                  current: total === 0 ? 1 : current,
                  total: total === 0 ? 1 : total,
                  zoom: viewport.zoom,
                })}
              </div>
            );
          })()}

          {/* Info popover (Task Q6) — camera EXIF + file facts, anchored under the
              filename chip. Develop view only (Gallery shows the folder chip). */}
          {infoOpen && currentImage && viewMode !== 'gallery' && (
            <InfoPopover image={currentImage} anchorRef={filenameChipRef} onClose={() => setInfoOpen(false)} />
          )}

          {/* Floating toolbar pill — top, centered on the alignment axis in Develop;
              window-centered in Gallery (no photo region / axis in that view). */}
          <div
            className="absolute"
            style={{
              top: CHROME_TOP,
              left: viewMode === 'gallery' ? '50%' : (alignmentAxisX ?? '50%'),
              transform: 'translateX(-50%)',
              zIndex: 30,
            }}
          >
            <Toolbar
              onExport={() => setIsExportDialogOpen(true)}
              onPrint={handlePrint}
              onBatchProcess={() => setIsBatchDialogOpen(true)}
              onOpenPresets={() => setIsPresetDialogOpen(true)}
              onShowHelp={() => setIsShortcutsDialogOpen(true)}
              onUndo={doUndo}
              onRedo={doRedo}
              canUndo={canUndo}
              canRedo={canRedo}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onFitWindow={handleFitWindow}
              onActualSize={handleActualSize}
              zoom={viewport.zoom}
              onAutoAll={handleAutoAll}
              styleGradeActive={styleGradeActive}
              developing={developing}
              onCopyStyle={handleCopyStyle}
              onPasteStyle={handlePasteStyle}
              hasStyleClipboard={hasStyleClipboard}
              hasImage={!!imageService.getCurrentImage()}
              onToggleOriginal={toggleOriginal}
              showOriginal={showOriginal}
              onToggleReference={toggleReferenceMode}
              referenceMode={referenceMode}
              onOpenFolder={handleOpenFolder}
              onExportSelected={handleExportSelected}
            />
          </div>

          {/* Floating right column — histogram card (fixed) + module card (grows,
              scrolls inside, never clipped). Replaces the old 360px slide-in;
              the canvas no longer moves. Develop-only chrome — hidden in Gallery. */}
          {viewMode === 'develop' && (selectedTool || histogramVisible) && (
            <div
              className="absolute flex flex-col"
              style={{
                right: RIGHT_COLUMN_OFFSET,
                top: CHROME_TOP,
                bottom: RIGHT_COLUMN_BOTTOM,
                width: RIGHT_COLUMN_WIDTH,
                gap: RIGHT_COLUMN_GAP,
                zIndex: 20,
              }}
            >
              {/* Histogram card — content-driven height, above the module card. */}
              {histogramVisible && (
                <div style={{ flex: '0 0 auto' }}>
                  <HistogramPanel />
                </div>
              )}

              {/* Module slot — grows to fill; each panel scrolls internally.
                  Panels stay mounted (display toggle) so their state persists. */}
              {selectedTool && (
                <div style={{ flex: '1 1 auto', minHeight: 0, position: 'relative' }}>
                  <div style={{ display: selectedTool === 'file-explorer' ? 'block' : 'none', height: '100%' }}>
                    <div className="glass-card" style={{ height: '100%', overflow: 'hidden' }}>
                      <FileBrowser
                        onImageSelected={handleImageSelected}
                        onFolderSelected={handleFolderSelected}
                      />
                    </div>
                  </div>
                  <div style={{ display: selectedTool === 'settings' ? 'block' : 'none', height: '100%' }}>
                    <div className="glass-card" style={{ height: '100%', overflowY: 'auto' }}>
                      <SettingsPanel />
                    </div>
                  </div>
                  {/* Module panels (AdjustmentPanel brings its own glass card). */}
                  <div style={{ display: selectedTool && !['file-explorer', 'settings'].includes(selectedTool) ? 'block' : 'none', height: '100%' }}>
                    <AdjustmentPanel selectedModule={selectedTool} currentImage={currentImage} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Floating icon rail (positions itself: right 20, vertically centered).
              Develop-only chrome — hidden in Gallery. */}
          {viewMode === 'develop' && (
            <IconSidebar
              selectedTool={selectedTool}
              histogramVisible={histogramVisible}
              onToolSelect={handleToolSelect}
            />
          )}

          {/* Floating filmstrip dock (positions itself: bottom 24, centered on the
              alignment axis, hugs content — Glass · Sectioned, Task 6). Develop-only
              chrome — hidden in Gallery (stays mounted so its thumbnail cache
              survives the round-trip, same as GalleryView's own cache). */}
          <ThumbnailPanel
            images={availableImages}
            selectedImage={currentImage || undefined}
            onImageSelect={setCurrentImage}
            onClose={() => setShowThumbnailPanel(false)}
            visible={showThumbnailPanel && viewMode === 'develop'}
            onExportSelected={handleExportSelected}
          />
        </div>
      </div>

      {/* Bottom Status Bar */}
      <StatusBar
        currentImage={currentImage ? {
          id: currentImage.id,
          path: currentImage.path,
          name: currentImage.name,
          width: imageService.getCurrentImage()?.width,
          height: imageService.getCurrentImage()?.height,
          size: currentImage.size,
          type: currentImage.type
        } : null}
        processingStats={{
          processingTime: lastProcessingTimeMs,
          modulesActive: modulesActive,
          totalModules: modulesTotal
        }}
        images={availableImages}
      />

      {/* Export Dialog */}
      {isExportDialogOpen && (
        <ExportDialog
          isOpen={isExportDialogOpen}
          onClose={() => { setIsExportDialogOpen(false); setMultiExportPaths([]); }}
          imageData={
            processedImageData
              ? (processedImageData instanceof Float32Array
                 ? processedImageData
                 : processedImageData.data)
              : imageService.getCurrentImage()?.data || new Float32Array()
          }
          imageWidth={imageService.getCurrentImage()?.width || 0}
          imageHeight={imageService.getCurrentImage()?.height || 0}
          originalFilePath={imageService.getCurrentImage()?.filePath}
          onExportComplete={handleExportComplete}
          multiPaths={multiExportPaths.length ? multiExportPaths : undefined}
        />
      )}

      {/* Batch Processing Dialog */}
      {isBatchDialogOpen && (
        <BatchProcessingDialog
          isOpen={isBatchDialogOpen}
          onClose={() => {
            setBatchSelectedImages([]);
            setIsBatchDialogOpen(false);
          }}
          availableImages={availableImages}
          selectedImages={batchSelectedImages}
          onSelectedImagesChange={setBatchSelectedImages}
          onSelectImages={async () => {
            try {
              const result = await window.electronAPI?.showOpenDialog({
                properties: ['openFile', 'multiSelections'],
                filters: [
                  { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'webp'] },
                  { name: 'RAW Files', extensions: ['cr2', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef'] },
                  { name: 'All Files', extensions: ['*'] }
                ]
              });

              if (result && !result.canceled && result.filePaths?.length > 0) {
                logger.info(`Selected ${result.filePaths.length} images for batch processing`);
                const imgs = await filePathsToImageFileInfo(result.filePaths);
                setBatchSelectedImages((prev) => mergeUniqueImages(prev, imgs));
                showSuccess('Images Selected', `${result.filePaths.length} images selected for batch processing`);
              }
            } catch (error) {
              logger.error('Failed to select images:', error);
              showError('Selection Failed', 'Failed to open file selection dialog');
            }
          }}
        />
      )}

      {/* Preset Dialog */}
      {isPresetDialogOpen && (
        <PresetDialog
          isOpen={isPresetDialogOpen}
          onClose={() => setIsPresetDialogOpen(false)}
          onApplyPreset={handleApplyPreset}
        />
      )}

      {/* Shortcuts Help Dialog */}
      {isShortcutsDialogOpen && (
        <ShortcutsHelpDialog
          isOpen={isShortcutsDialogOpen}
          onClose={() => setIsShortcutsDialogOpen(false)}
          shortcuts={keyboardShortcutsService.getAllShortcuts()}
        />
      )}

      {/* Gallery Del-remove confirm dialog (Task P11) */}
      <GalleryRemoveDialog
        isOpen={removeTargetIds !== null}
        count={removeTargetIds?.length ?? 0}
        onCancel={() => setRemoveTargetIds(null)}
        onRemoveFromSession={handleRemoveFromSession}
        onMoveToTrash={handleMoveToTrash}
      />

      {/* Print Dialog */}
      {isPrintDialogOpen && (() => {
        const store = useAppStore.getState();
        const current = imageService.getCurrentImage();
        const processed = store.processedImageData;
        let pData = current?.data || new Float32Array();
        let pW = current?.width || 0;
        let pH = current?.height || 0;
        if (processed && typeof processed === 'object' && 'data' in processed) {
          const pd = processed as { data: Float32Array; width: number; height: number };
          pData = pd.data; pW = pd.width; pH = pd.height;
        } else if (processed instanceof Float32Array && current) {
          pData = processed;
        }
        return (
          <PrintDialog
            isOpen={isPrintDialogOpen}
            onClose={() => setIsPrintDialogOpen(false)}
            imageData={pData}
            imageWidth={pW}
            imageHeight={pH}
            fileName={current?.fileName}
          />
        );
      })()}

      {/* Image Size / Canvas Size Dialog */}
      {imageSizeMode && (
        <ImageSizeDialog
          isOpen={!!imageSizeMode}
          onClose={() => setImageSizeMode(null)}
          onApply={handleImageResize}
          currentWidth={imageService.getCurrentImage()?.width || 0}
          currentHeight={imageService.getCurrentImage()?.height || 0}
          mode={imageSizeMode}
          developing={developing}
        />
      )}

      {/* Welcome Screen */}
      <WelcomeScreen
        isVisible={isWelcomeVisible}
        onClose={() => setIsWelcomeVisible(false)}
        onOpenFile={() => electronService.isElectron() && electronService.openFile()}
        onOpenFolder={handleOpenFolder}
        onOpenPresets={() => setIsPresetDialogOpen(true)}
      />

      {/* Notification System */}
      <NotificationSystem
        notifications={notifications}
        onDismiss={removeNotification}
      />

      {/* Development Performance Monitor */}
      {process.env.NODE_ENV === 'development' && <PerformanceMonitor />}
    </div>
    </ErrorBoundary>
  );
}

export default App;