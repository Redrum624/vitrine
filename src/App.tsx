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
import { keyboardShortcutsService, createDefaultShortcuts } from './services/KeyboardShortcutsService';
import { electronService } from './services/ElectronService';
import { imageService } from './services/ImageService';
import { ImageFileInfo } from './services/FileSystemService';
import { useAppStore } from './stores/appStore';
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

function App() {
  const { setViewport, resetZoom, viewport, processedImageData, setSelectedTool: storeSetSelectedTool, showGrid, showRulers, showOriginal, toggleGrid, toggleRulers, toggleOriginal, referenceMode, referenceImageUrl, referenceImageName, toggleReferenceMode, setReferenceImage } = useAppStore();
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

    // White Balance
    const wbMod = imageProcessingPipeline.getModule('temperature');
    if (wbMod) {
      (wbMod as unknown as { setParams: (p: Record<string, unknown>) => void }).setParams(result.whiteBalance);
      imageProcessingPipeline.invalidateModuleCache('temperature');
    }

    // Basic Adjustments (autoBasicAdj already returns exposure: 0)
    const baMod = imageProcessingPipeline.getModule('basicadj');
    if (baMod) {
      (baMod as unknown as { setParams: (p: Record<string, unknown>) => void }).setParams(result.basicAdj);
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

    // Shadows / Highlights
    const shPipeMod = imageProcessingPipeline.getModule('shadowshighlights');
    if (shPipeMod) {
      const inner = (shPipeMod as unknown as { getShadowsHighlightsModule?: () => { setParams: (p: Record<string, unknown>) => void } }).getShadowsHighlightsModule?.();
      if (inner) inner.setParams(result.shadowsHighlights);
      imageProcessingPipeline.invalidateModuleCache('shadowshighlights');
    }

    // Trigger reprocessing
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
    const ok = styleAnalysisService.pasteStyle();
    if (ok) {
      showSuccess('Style Pasted', 'Adaptive adjustments applied');
    } else {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // Show welcome screen for first-time users
    const welcomeDismissed = localStorage.getItem('photo-editor-welcome-dismissed');
    if (!welcomeDismissed && !currentImage) {
      setTimeout(() => setIsWelcomeVisible(true), 1000); // Slight delay for better UX
    }

    // Cleanup on unmount
    return () => {
      keyboardShortcutsService.destroy();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTool, setSelectedTool, currentImage]);

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
            className="absolute border-l flex-shrink-0 overflow-hidden"
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

            {/* Histogram overlay - sits at bottom of panel, on top of module content */}
            {histogramVisible && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  zIndex: 20,
                  borderTop: '1px solid var(--border)',
                  backgroundColor: 'var(--gray-900)',
                  boxShadow: '0 -4px 12px rgba(0,0,0,0.4)',
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
          processingTime: 145, // Would be updated from processing pipeline
          modulesActive: 8,  // Would be calculated from enabled modules
          totalModules: 8
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
          onClose={() => setIsBatchDialogOpen(false)}
          availableImages={availableImages}
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
                showSuccess('Images Selected', `${result.filePaths.length} images selected for batch processing`);
                // TODO: Add selected images to batch processing queue
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
          // Would open folder browser dialog
          logger.info('Open folder requested from welcome screen');
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