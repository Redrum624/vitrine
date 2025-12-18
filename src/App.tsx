import { useEffect, useState, useCallback } from 'react';
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

// Import pipeline tests for development
if (process.env.NODE_ENV === 'development') {
  import('./test/PipelineTest').then(({ testCompletePipeline, testWebWorkerProcessing }) => {
    // Make tests available in console for development
    (window as typeof window & { testPipeline: typeof testCompletePipeline }).testPipeline = testCompletePipeline;
    (window as typeof window & { testWebWorkers: typeof testWebWorkerProcessing }).testWebWorkers = testWebWorkerProcessing;
    logger.info('Development pipeline tests available: testPipeline(), testWebWorkers()');
  });
}

function App() {
  const { setViewport, resetZoom, viewport, processedImageData, selectedTool: _selectedTool, setSelectedTool: _setSelectedTool } = useAppStore();
  const [selectedTool, setSelectedTool] = useState<string | null>('file-explorer'); // Default to file explorer
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

    logger.info(`Initialized ${shortcuts.length + 2} keyboard shortcuts`);

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
        onFileImport={() => window.dispatchEvent(new CustomEvent('electron-file-import'))}
        onFileExport={() => setIsExportDialogOpen(true)}
        onEditUndo={() => historyService.undo() && setCanUndo(historyService.canUndo()) && setCanRedo(historyService.canRedo())}
        onEditRedo={() => historyService.redo() && setCanUndo(historyService.canUndo()) && setCanRedo(historyService.canRedo())}
        onEditReset={() => historyService.resetAll()}
        onViewZoomIn={handleZoomIn}
        onViewZoomOut={handleZoomOut}
        onViewFitWindow={handleFitWindow}
        onViewActualSize={handleActualSize}
        onWindowPresets={() => setIsPresetDialogOpen(true)}
        onWindowBatch={() => setIsBatchDialogOpen(true)}
        onWindowPlugins={() => setIsPluginManagerOpen(true)}
        onWindowHelp={() => setIsShortcutsDialogOpen(true)}
        canUndo={canUndo}
        canRedo={canRedo}
      />

      {/* Top Toolbar */}
      <div className="toolbar">
        <Toolbar
          onExport={() => setIsExportDialogOpen(true)}
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
        />
      </div>

      {/* Main Content - 4-Column Layout */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Main workspace */}
        <div className="flex flex-1 overflow-hidden relative">
          {/* Column 2: Right Panel - File Explorer, Settings, Modules, or Histogram (360px) - Overlay panel */}
          <div
            className="absolute border-l flex-shrink-0 overflow-hidden"
            style={{
              right: '64px',
              top: 0,
              bottom: 0,
              width: '360px',
              transform: selectedTool && selectedTool !== null ? 'translateX(0)' : 'translateX(100%)',
              borderLeftColor: 'var(--border)',
              backgroundColor: 'var(--gray-900)',
              transition: 'transform 300ms cubic-bezier(0.4, 0.0, 0.2, 1), box-shadow 300ms cubic-bezier(0.4, 0.0, 0.2, 1)',
              boxShadow: selectedTool && selectedTool !== null ? '-2px 0 8px rgba(0,0,0,0.3)' : 'none',
              zIndex: selectedTool && selectedTool !== null ? 10 : -1,
              pointerEvents: selectedTool && selectedTool !== null ? 'auto' : 'none'
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
            <div style={{display: selectedTool === 'histogram' ? 'block' : 'none', height: '100%'}}>
              <div className="flex flex-col h-full">
                <div className="px-5 py-4 border-b" style={{borderBottomColor: 'var(--border)'}}>
                  <h2 className="text-sm font-semibold" style={{color: 'var(--white)'}}>Histogram</h2>
                </div>
                <div className="flex-1 p-4">
                  <HistogramPanel />
                </div>
              </div>
            </div>
            {/* Module panels will be added next */}
            <div style={{display: selectedTool && !['file-explorer', 'settings', 'histogram'].includes(selectedTool) ? 'block' : 'none', height: '100%'}}>
              <AdjustmentPanel selectedModule={selectedTool} />
            </div>
          </div>

          {/* Column 1: Canvas (flex) */}
          <div
            className="flex-1 canvas-container flex items-center justify-center transition-all"
            style={{
              background: '#0a0a0a',
              marginRight: selectedTool && selectedTool !== null ? '360px' : '0px',
              transitionDuration: '300ms',
              transitionTimingFunction: 'cubic-bezier(0.4, 0.0, 0.2, 1)'
            }}
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

          {/* Column 3: Icon Sidebar (64px) - Right side */}
          <IconSidebar
            selectedTool={selectedTool}
            onToolSelect={(tool) => setSelectedTool(selectedTool === tool ? null : tool)}
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