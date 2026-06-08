import { useEffect, useState, useCallback, useRef } from 'react';
import { MenuBar } from './components/Layout/MenuBar';
import { Toolbar } from './components/Layout/Toolbar';
import { IconSidebar } from './components/Layout/IconSidebar';
import { FileBrowser } from './components/Layout/FileBrowser';
import { Canvas } from './components/Layout/Canvas';
import { AdjustmentPanel } from './components/Panels/AdjustmentPanel';
import { HistogramPanel } from './components/Panels/HistogramPanel';
import { ThumbnailPanel } from './components/Panels/ThumbnailPanel';
import { SettingsPanel } from './components/Panels/SettingsPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ExportDialog } from './components/Dialogs/ExportDialog';
import { BatchProcessingDialog } from './components/Dialogs/BatchProcessingDialog';
import { PresetDialog } from './components/Dialogs/PresetDialog';
import { FilterDialog, FilterType } from './components/Dialogs/FilterDialog';
import { ImageSizeDialog } from './components/Dialogs/ImageSizeDialog';
import { NotificationSystem } from './components/UI/NotificationSystem';
import { useNotifications } from './hooks/useNotifications';
import { ShortcutsHelpDialog } from './components/Dialogs/ShortcutsHelpDialog';
import { StatusBar } from './components/Layout/StatusBar';
import { PluginManagerDialog } from './components/Dialogs/PluginManagerDialog';
import { WelcomeScreen } from './components/Welcome/WelcomeScreen';
import { PerformanceMonitor } from './components/Debug/PerformanceMonitor';
import { keyboardShortcutsService, createDefaultShortcuts, createRatingShortcuts } from './services/KeyboardShortcutsService';
import { webGLImageProcessor } from './services/WebGLImageProcessor';
import { electronService } from './services/ElectronService';
import { imageService } from './services/ImageService';
import { ImageFileInfo, fileSystemService } from './services/FileSystemService';
import { useAppStore } from './stores/appStore';
import { editPersistenceService } from './services/EditPersistenceService';
import { checkpointService } from './services/CheckpointService';
import { logger } from './utils/Logger';
import { historyService } from './services/HistoryService';
import { AdjustmentPreset } from './services/PresetService';
import { errorHandlingService } from './services/ErrorHandlingService';
import { appLifecycleService } from './services/AppLifecycleService';
import {
  rotateImage90CW, rotateImage90CCW, flipHorizontal, flipVertical,
  applySharpen, applyGaussianBlur, applyVignette, applyFilmGrain,
  resizeImage, FilterContext
} from './utils/ImageFilters';
import { styleAnalysisService } from './services/StyleAnalysisService';
import { autoAdjustService } from './services/AutoAdjustService';
import { imageProcessingPipeline } from './services/ImageProcessingPipeline';
import { PrintDialog } from './components/Dialogs/PrintDialog';

// Import pipeline tests for development
if (process.env.NODE_ENV === 'development') {
  import('./test/PipelineTest').then(({ testCompletePipeline, testWebWorkerProcessing }) => {
    // Make tests available in console for development
    (window as typeof window & { testPipeline: typeof testCompletePipeline }).testPipeline = testCompletePipeline;
    (window as typeof window & { testWebWorkers: typeof testWebWorkerProcessing }).testWebWorkers = testWebWorkerProcessing;
    logger.info('Development pipeline tests available: testPipeline(), testWebWorkers()');
  });
}

const MODULE_IDS = new Set(['crop', 'basicadj', 'whitebalance', 'tonecurve', 'noisereduction', 'shadowshighlights', 'colorbalance', 'localadjustments', 'lenscorrections']);
const isModuleTool = (tool: string) => MODULE_IDS.has(tool);

/** Renders the cached original image for the Before/After split view. */
function OriginalPane() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const original = imageService.getOriginalImage();
    const canvas = canvasRef.current;
    if (!original || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = original.width;
    canvas.height = original.height;
    const imgData = ctx.createImageData(original.width, original.height);

    const sampleMax = Math.max(...original.data.slice(0, Math.min(4000, original.data.length)));
    const norm = sampleMax <= 1.0;

    for (let i = 0; i < original.data.length && i < imgData.data.length; i++) {
      imgData.data[i] = norm
        ? Math.round(Math.max(0, Math.min(1, original.data[i])) * 255)
        : Math.round(Math.max(0, Math.min(255, original.data[i])));
    }
    ctx.putImageData(imgData, 0, 0);
  }, []);

  return (
    <div className="w-full h-full flex items-center justify-center p-5 relative">
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full object-contain"
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

function App() {
  const { setViewport, resetZoom, viewport, processedImageData, setSelectedTool: storeSetSelectedTool, showGrid, showRulers, showOriginal, toggleGrid, toggleRulers, toggleOriginal, referenceMode, referenceImageUrl, referenceImageName, toggleReferenceMode, setReferenceImage, lastProcessingTimeMs, modulesActive, modulesTotal } = useAppStore();
  const [selectedTool, setSelectedToolLocal] = useState<string | null>('file-explorer'); // Default to file explorer

  // Wrapper to update both local state and store
  const setSelectedTool = useCallback((tool: string | null) => {
    setSelectedToolLocal(tool);
    storeSetSelectedTool(tool);
  }, [storeSetSelectedTool]);

  // Initialize store with default selectedTool on mount
  useEffect(() => {
    storeSetSelectedTool('file-explorer');
  }, [storeSetSelectedTool]);

  // Histogram state - independent from tool selection
  const [histogramVisible, setHistogramVisible] = useState(false);
  const lastActiveModuleRef = useRef<string | null>('basicadj');

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
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false);
  const [isPresetDialogOpen, setIsPresetDialogOpen] = useState(false);
  const [isShortcutsDialogOpen, setIsShortcutsDialogOpen] = useState(false);
  const [isPluginManagerOpen, setIsPluginManagerOpen] = useState(false);
  const [isWelcomeVisible, setIsWelcomeVisible] = useState(false);
  const [availableImages, setAvailableImages] = useState<ImageFileInfo[]>([]);
  const [batchSelectedImages, setBatchSelectedImages] = useState<ImageFileInfo[]>([]);
  const [showThumbnailPanel, setShowThumbnailPanel] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [filterDialogType, setFilterDialogType] = useState<FilterType | null>(null);
  const [imageSizeMode, setImageSizeMode] = useState<'imageSize' | 'canvasSize' | null>(null);
  const [hasStyleClipboard, setHasStyleClipboard] = useState(false);
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [refDragOver, setRefDragOver] = useState(false);
  const { notifications, remove: removeNotification, success: showSuccess, error: showError } = useNotifications();

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
  const getImageContext = useCallback((): { data: Float32Array; ctx: FilterContext } | null => {
    const img = imageService.getCurrentImage();
    if (!img) return null;
    return {
      data: img.data,
      ctx: { width: img.width, height: img.height, channels: 4 }
    };
  }, []);

  const handleRotateCW = useCallback(() => {
    const img = getImageContext();
    if (!img) return;
    const result = rotateImage90CW(img.data, img.ctx);
    imageService.updateCurrentImageData(result.data, result.width, result.height);
    useAppStore.getState().triggerReprocessing();
    showSuccess('Rotated', '90\u00B0 clockwise');
  }, [getImageContext, showSuccess]);

  const handleRotateCCW = useCallback(() => {
    const img = getImageContext();
    if (!img) return;
    const result = rotateImage90CCW(img.data, img.ctx);
    imageService.updateCurrentImageData(result.data, result.width, result.height);
    useAppStore.getState().triggerReprocessing();
    showSuccess('Rotated', '90\u00B0 counter-clockwise');
  }, [getImageContext, showSuccess]);

  const handleFlipHorizontal = useCallback(() => {
    const img = getImageContext();
    if (!img) return;
    const result = flipHorizontal(img.data, img.ctx);
    imageService.updateCurrentImageData(result, img.ctx.width, img.ctx.height);
    useAppStore.getState().triggerReprocessing();
    showSuccess('Flipped', 'Horizontal');
  }, [getImageContext, showSuccess]);

  const handleFlipVertical = useCallback(() => {
    const img = getImageContext();
    if (!img) return;
    const result = flipVertical(img.data, img.ctx);
    imageService.updateCurrentImageData(result, img.ctx.width, img.ctx.height);
    useAppStore.getState().triggerReprocessing();
    showSuccess('Flipped', 'Vertical');
  }, [getImageContext, showSuccess]);

  // ─── Auto adjustments ─────────────────────────────────────────────────
  const handleAutoLevels = useCallback(() => {
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
  }, [showSuccess]);

  const handleAutoContrast = useCallback(() => {
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
  }, [showSuccess]);

  const handleAutoColor = useCallback(() => {
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
  }, [showSuccess]);

  // ─── Filter application ───────────────────────────────────────────────
  const handleApplyFilter = useCallback((filterType: FilterType, params: Record<string, number>) => {
    const img = getImageContext();
    if (!img) return;

    let result: Float32Array;
    switch (filterType) {
      case 'sharpen':
        result = applySharpen(img.data, img.ctx, params.amount, params.radius);
        break;
      case 'blur':
        result = applyGaussianBlur(img.data, img.ctx, params.radius);
        break;
      case 'vignette':
        result = applyVignette(img.data, img.ctx, params.amount, params.roundness);
        break;
      case 'filmGrain':
        result = applyFilmGrain(img.data, img.ctx, params.amount, params.size);
        break;
      default:
        return;
    }

    imageService.updateCurrentImageData(result, img.ctx.width, img.ctx.height);
    useAppStore.getState().triggerReprocessing();
    showSuccess('Filter Applied', filterType.replace(/([A-Z])/g, ' $1').trim());
  }, [getImageContext, showSuccess]);

  // ─── Image resize ─────────────────────────────────────────────────────
  const handleImageResize = useCallback((newWidth: number, newHeight: number) => {
    const img = getImageContext();
    if (!img) return;
    const result = resizeImage(img.data, img.ctx, newWidth, newHeight);
    imageService.updateCurrentImageData(result.data, result.width, result.height);
    useAppStore.getState().triggerReprocessing();
    showSuccess('Resized', `${result.width} x ${result.height}`);
  }, [getImageContext, showSuccess]);

  // ─── Auto All ──────────────────────────────────────────────────────────
  const handleAutoAll = useCallback(() => {
    const img = imageService.getCurrentImage();
    if (!img) { showError('Auto All', 'No image loaded'); return; }

    useAppStore.getState().setIsProcessing(true); // canvas spinner while applying

    // Single coordinator call: analyses once, picks the user-style bucket, and
    // returns the bundled params for every module.
    const result = autoAdjustService.autoAll(img.data, img.width, img.height);
    logger.info(`Auto All: bucket=${result.bucket} (${result.stats.meanLum.toFixed(3)} lum)`);

    // Exposure
    const exposureMod = imageProcessingPipeline.getModule('exposure');
    if (exposureMod) {
      (exposureMod as unknown as { setCurrentParams: (p: Record<string, unknown>) => void }).setCurrentParams(result.exposure);
      imageProcessingPipeline.invalidateModuleCache('exposure');
    }

    // White Balance — from the user style profile (style_profile_report.json), same as
    // every other Auto here. The per-module WB "Auto" button uses this same function.
    const wbMod = imageProcessingPipeline.getModule('temperature');
    if (wbMod) {
      (wbMod as unknown as { setParams: (p: Record<string, unknown>) => void }).setParams(result.whiteBalance);
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
    showSuccess('Auto All', `Applied "${result.bucket}" style profile`);
    logger.info(`Auto All: all modules adjusted from user style profile (bucket=${result.bucket})`);
  }, [showSuccess, showError]);

  // ─── Print ─────────────────────────────────────────────────────────────
  const handlePrint = useCallback(() => {
    if (!imageService.getCurrentImage()) { showError('Print', 'No image loaded'); return; }
    setIsPrintDialogOpen(true);
  }, [showError]);

  // ─── Style copy / paste ────────────────────────────────────────────────
  const handleCopyStyle = useCallback(() => {
    const fp = styleAnalysisService.copyStyle();
    if (fp) {
      setHasStyleClipboard(true);
      showSuccess('Style Copied', `Luminance ${(fp.meanLuminance * 100).toFixed(0)}%, Sat ${(fp.meanSaturation * 100).toFixed(0)}%, ~${fp.estimatedTemp.toFixed(0)}K`);
    } else {
      showError('Copy Style', 'No image loaded to analyse');
    }
  }, [showSuccess, showError]);

  const handlePasteStyle = useCallback(() => {
    if (!styleAnalysisService.hasStyle()) {
      showError('Paste Style', 'No style copied yet');
      return;
    }
    useAppStore.getState().setIsProcessing(true); // canvas spinner while applying
    const ok = styleAnalysisService.pasteStyle();
    if (ok) {
      showSuccess('Style Pasted', 'Adaptive adjustments applied');
    } else {
      useAppStore.getState().setIsProcessing(false);
      showError('Paste Style', 'No target image loaded');
    }
  }, [showSuccess, showError]);

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
    setAvailableImages(images);
    setShowThumbnailPanel(images.length > 0);
    if (images.length > 0 && !currentImage) {
      setCurrentImage(images[0]);
    }
  }, [currentImage]);

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
    const handleFileOpen = async (event: CustomEvent) => {
      try {
        const filePath = event.detail;
        logger.info('Loading image:', filePath);
        const imageData = await imageService.loadImage(filePath);
        logger.info(`Image loaded: ${imageData.width}x${imageData.height} - ${imageData.fileName}`);
        showSuccess('Image Loaded', `${imageData.fileName} (${imageData.width}x${imageData.height})`);
      } catch (error) {
        logger.error('Failed to load image:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        showError('Failed to Load Image', errorMessage);
      }
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

    const handleUndo = () => {
      try {
        logger.info('Undo requested');
        if (historyService.undo()) {
          logger.info('Undo operation completed');
          // Update undo/redo state
          updateHistoryState();
        } else {
          logger.info('No previous state to undo to');
        }
      } catch (error) {
        logger.error('Failed to undo:', error);
      }
    };

    const handleRedo = () => {
      try {
        logger.info('Redo requested');
        if (historyService.redo()) {
          logger.info('Redo operation completed');
          // Update undo/redo state
          updateHistoryState();
        } else {
          logger.info('No next state to redo to');
        }
      } catch (error) {
        logger.error('Failed to redo:', error);
      }
    };

    const updateHistoryState = () => {
      setCanUndo(historyService.canUndo());
      setCanRedo(historyService.canRedo());
    };

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
      onUndo: () => historyService.undo(),
      onRedo: () => historyService.redo(),
      onResetAll: () => historyService.resetAll(),
      onZoomIn: handleZoomIn,
      onZoomOut: handleZoomOut,
      onZoomFit: handleFitWindow,
      onZoomActual: handleActualSize,
      onTogglePresets: () => setIsPresetDialogOpen(true),
      onToggleBatch: () => setIsBatchDialogOpen(true),
      onTogglePlugins: () => setIsPluginManagerOpen(true),
      onSelectTool: (tool) => setSelectedTool(selectedTool === tool ? null : tool),
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

    // Star rating: 1-5 set the rating on the current image, 0 clears it.
    createRatingShortcuts((rating) => {
      const img = useAppStore.getState().currentImage;
      if (!img) return;
      useAppStore.getState().setImageRating(img.id, rating);
      // Persist to the file (xmp:Rating) so it shows in OS file details.
      window.electronAPI?.writeImageRating?.(img.path, rating);
    }).forEach((shortcut) => keyboardShortcutsService.register(shortcut));

    logger.info(`Initialized ${shortcuts.length + 3} keyboard shortcuts`);

    // Initialize undo/redo state
    setCanUndo(historyService.canUndo());
    setCanRedo(historyService.canRedo());

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
      keyboardShortcutsService.destroy();
    };
  }, [selectedTool, setSelectedTool, currentImage]);

  // Show the welcome screen once for first-time users — on mount only. The effect
  // above re-runs whenever selectedTool changes, which previously re-armed this
  // timer on every right-sidebar icon click, making the modal pop up repeatedly.
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
      tonecurve: 'Tone Curve', noisereduction: 'Noise Reduction', colorbalance: 'Color Balance',
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

  return (
    <ErrorBoundary>
      <div className="h-screen flex flex-col bg-dark-900 text-dark-300">
      {/* Menu Bar */}
      <MenuBar
        onFileOpen={() => electronService.isElectron() && electronService.openFile()}
        onFileImport={handleFileImport}
        onFileExport={() => setIsExportDialogOpen(true)}
        onEditUndo={() => historyService.undo() && setCanUndo(historyService.canUndo()) && setCanRedo(historyService.canRedo())}
        onEditRedo={() => historyService.redo() && setCanUndo(historyService.canUndo()) && setCanRedo(historyService.canRedo())}
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
        onWindowPlugins={() => setIsPluginManagerOpen(true)}
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
        // Filter menu
        onSharpen={() => setFilterDialogType('sharpen')}
        onBlur={() => setFilterDialogType('blur')}
        onNoiseReduction={() => handleToolSelect('noisereduction')}
        onVignette={() => setFilterDialogType('vignette')}
        onFilmGrain={() => setFilterDialogType('filmGrain')}
        // State
        canUndo={canUndo}
        canRedo={canRedo}
        showGrid={showGrid}
        showRulers={showRulers}
        showOriginal={showOriginal}
        hasImage={!!imageService.getCurrentImage()}
      />

      {/* Top Toolbar */}
      <div className="toolbar">
        <Toolbar
          onExport={() => setIsExportDialogOpen(true)}
          onPrint={handlePrint}
          onBatchProcess={() => setIsBatchDialogOpen(true)}
          onOpenPresets={() => setIsPresetDialogOpen(true)}
          onOpenPlugins={() => setIsPluginManagerOpen(true)}
          onShowHelp={() => setIsShortcutsDialogOpen(true)}
          onUndo={() => historyService.undo() && setCanUndo(historyService.canUndo()) && setCanRedo(historyService.canRedo())}
          onRedo={() => historyService.redo() && setCanUndo(historyService.canUndo()) && setCanRedo(historyService.canRedo())}
          canUndo={canUndo}
          canRedo={canRedo}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onFitWindow={handleFitWindow}
          onActualSize={handleActualSize}
          zoom={viewport.zoom}
          onAutoAll={handleAutoAll}
          onCopyStyle={handleCopyStyle}
          onPasteStyle={handlePasteStyle}
          hasStyleClipboard={hasStyleClipboard}
          hasImage={!!imageService.getCurrentImage()}
          onToggleOriginal={toggleOriginal}
          showOriginal={showOriginal}
          onToggleReference={toggleReferenceMode}
          referenceMode={referenceMode}
        />
      </div>

      {/* Main Content - 4-Column Layout */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Main workspace */}
        <div className="flex flex-1 overflow-hidden relative">
          {/* Column 2: Right Panel - File Explorer, Settings, or Modules (360px) - Overlay panel */}
          <div
            className="absolute border-l flex-shrink-0 overflow-hidden flex flex-col"
            style={{
              right: '64px',
              top: 0,
              bottom: 0,
              width: '360px',
              transform: (selectedTool || histogramVisible) ? 'translateX(0)' : 'translateX(100%)',
              borderLeftColor: 'var(--border)',
              backgroundColor: 'var(--gray-900)',
              transition: 'transform 300ms cubic-bezier(0.4, 0.0, 0.2, 1), box-shadow 300ms cubic-bezier(0.4, 0.0, 0.2, 1)',
              boxShadow: (selectedTool || histogramVisible) ? '-2px 0 8px rgba(0,0,0,0.3)' : 'none',
              zIndex: (selectedTool || histogramVisible) ? 10 : -1,
              pointerEvents: (selectedTool || histogramVisible) ? 'auto' : 'none'
            }}
          >
            {/* Panel content (Controls / File / Settings) — fills the space ABOVE the histogram */}
            <div style={{ flex: selectedTool ? '1 1 0%' : '0 0 0%', minHeight: 0, overflow: 'hidden' }}>
              <div style={{display: selectedTool === 'file-explorer' ? 'block' : 'none', height: '100%'}}>
                <FileBrowser
                  onImageSelected={handleImageSelected}
                  onFolderSelected={handleFolderSelected}
                />
              </div>
              <div style={{display: selectedTool === 'settings' ? 'block' : 'none', height: '100%'}}>
                <SettingsPanel />
              </div>
              {/* Module panels */}
              <div style={{display: selectedTool && !['file-explorer', 'settings'].includes(selectedTool) ? 'block' : 'none', height: '100%'}}>
                <AdjustmentPanel selectedModule={selectedTool} />
              </div>
            </div>

            {/* Histogram — stacked BELOW the Controls (its top = the Controls' bottom), never overlapping. */}
            {histogramVisible && (
              <div
                style={{
                  flex: selectedTool ? '0 0 auto' : '1 1 auto',
                  minHeight: 0,
                  overflowY: 'auto',
                  borderTop: '1px solid var(--border)',
                  backgroundColor: 'var(--gray-900)',
                }}
              >
                <HistogramPanel />
              </div>
            )}
          </div>

          {/* Column 1: Canvas (flex) — splits when referenceMode is active */}
          <div
            className="flex-1 canvas-container flex transition-all"
            style={{
              background: '#0a0a0a',
              marginRight: (selectedTool || histogramVisible) ? '360px' : '0px',
              transitionDuration: '300ms',
              transitionTimingFunction: 'cubic-bezier(0.4, 0.0, 0.2, 1)'
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

            {/* Main canvas pane */}
            <div
              className="flex-1 flex items-center justify-center"
              style={{ height: '100%' }}
            >
              <div
                style={{
                  width: 'calc(100% - 40px)',
                  height: 'calc(100% - 40px)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  transition: 'all 300ms cubic-bezier(0.4, 0.0, 0.2, 1)'
                }}
              >
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
          </div>

          {/* Column 3: Icon Sidebar (64px) - Right side */}
          <IconSidebar
            selectedTool={selectedTool}
            histogramVisible={histogramVisible}
            onToolSelect={handleToolSelect}
          />
        </div>

        {/* Bottom Panel - Thumbnail Gallery */}
        <ThumbnailPanel
          images={availableImages}
          selectedImage={currentImage || undefined}
          onImageSelect={setCurrentImage}
          onClose={() => setShowThumbnailPanel(false)}
          visible={showThumbnailPanel}
        />
      </div>

      {/* Bottom Status Bar */}
      <StatusBar
        currentImage={currentImage ? {
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
      />

      {/* Export Dialog */}
      {isExportDialogOpen && (
        <ExportDialog
          isOpen={isExportDialogOpen}
          onClose={() => setIsExportDialogOpen(false)}
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

      {/* Plugin Manager Dialog */}
      {isPluginManagerOpen && (
        <PluginManagerDialog
          isOpen={isPluginManagerOpen}
          onClose={() => setIsPluginManagerOpen(false)}
        />
      )}

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

      {/* Filter Dialog */}
      {filterDialogType && (
        <FilterDialog
          isOpen={!!filterDialogType}
          filterType={filterDialogType}
          onClose={() => setFilterDialogType(null)}
          onApply={handleApplyFilter}
          hasImage={!!imageService.getCurrentImage()}
        />
      )}

      {/* Image Size / Canvas Size Dialog */}
      {imageSizeMode && (
        <ImageSizeDialog
          isOpen={!!imageSizeMode}
          onClose={() => setImageSizeMode(null)}
          onApply={handleImageResize}
          currentWidth={imageService.getCurrentImage()?.width || 0}
          currentHeight={imageService.getCurrentImage()?.height || 0}
          mode={imageSizeMode}
        />
      )}

      {/* Welcome Screen */}
      <WelcomeScreen
        isVisible={isWelcomeVisible}
        onClose={() => setIsWelcomeVisible(false)}
        onOpenFile={() => electronService.isElectron() && electronService.openFile()}
        onOpenFolder={() => {
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
        }}
        onOpenPresets={() => setIsPresetDialogOpen(true)}
        onOpenPlugins={() => setIsPluginManagerOpen(true)}
        onShowTour={() => {
          setIsWelcomeVisible(false);
          showSuccess('Welcome!', 'Ready to start editing photos!');
        }}
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