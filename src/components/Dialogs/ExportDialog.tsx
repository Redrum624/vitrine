import React, { useState, useCallback, useEffect } from 'react';
import {
  Download,
  Image,
  Palette,
  File,
  X,
  AlertTriangle,
  FolderOpen
} from 'lucide-react';
import SliderControl from '../Controls/SliderControl';
import { ExportOptions, ExportPreset, exportService } from '../../services/ExportService';
import { imageService } from '../../services/ImageService';
import { multiExportService } from '../../services/MultiExportService';
import { useAppStore } from '../../stores/appStore';
import { notificationService } from '../../services/NotificationService';
import { logger } from '../../utils/Logger';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  imageData: Float32Array;
  imageWidth: number;
  imageHeight: number;
  originalFilePath?: string;
  onExportComplete: (success: boolean, outputPath?: string) => void;
  /** When set (≥1 path), the dialog exports all of these images with the
   *  chosen settings instead of the single current image. */
  multiPaths?: string[];
}

type TabType = 'format' | 'dimensions' | 'color';

/** Highest bit depth a given output format can store. PNG/TIFF carry 16-bit;
 *  JPEG/WebP are 8-bit only. Used to default Bit Depth to the format maximum. */
const maxBitDepthForFormat = (format: ExportOptions['format']): 8 | 16 =>
  format === 'png' || format === 'tiff' ? 16 : 8;

export const ExportDialog: React.FC<ExportDialogProps> = ({
  isOpen,
  onClose,
  imageData,
  imageWidth,
  imageHeight,
  originalFilePath,
  onExportComplete,
  multiPaths
}) => {
  const isMulti = (multiPaths?.length ?? 0) > 0;
  const [activeTab, setActiveTab] = useState<TabType>('format');
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [exportOptions, setExportOptions] = useState<ExportOptions>(exportService.getDefaultOptions());
  const [isExporting, setIsExporting] = useState(false);
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [estimatedFileSize, setEstimatedFileSize] = useState<string>('');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [outputDirectory, setOutputDirectory] = useState<string>('');

  const handleChooseFolder = useCallback(async () => {
    try {
      const result = await (window as unknown as { electronAPI?: { showOpenDialog: (opts: Record<string, unknown>) => Promise<{ canceled: boolean; filePaths: string[] }> } }).electronAPI?.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Choose Export Folder'
      });
      if (result && !result.canceled && result.filePaths?.length > 0) {
        setOutputDirectory(result.filePaths[0]);
        setExportOptions(prev => ({ ...prev, outputDirectory: result.filePaths[0] }));
      }
    } catch (error) {
      logger.error('Failed to open folder dialog:', error);
    }
  }, []);

  useEffect(() => {
    setPresets(exportService.getPresets());
  }, []);

  useEffect(() => {
    const calculateEstimate = () => {
      const outputWidth = exportOptions.width || imageWidth;
      const outputHeight = exportOptions.height || imageHeight;
      const pixels = outputWidth * outputHeight;

      let bytesPerPixel: number;
      switch (exportOptions.format) {
        case 'jpeg':
          bytesPerPixel = 3 * (exportOptions.quality / 100) * 0.5;
          break;
        case 'png':
          bytesPerPixel = exportOptions.bitDepth === 16 ? 8 : 4;
          break;
        case 'tiff':
          bytesPerPixel = exportOptions.bitDepth === 16 ? 8 : 4;
          if (exportOptions.compression === 'lzw' || exportOptions.compression === 'zip') {
            bytesPerPixel *= 0.6;
          }
          break;
        case 'webp':
          bytesPerPixel = 3 * (exportOptions.quality / 100) * 0.4;
          break;
        default:
          bytesPerPixel = 4;
      }

      const estimatedBytes = pixels * bytesPerPixel;
      setEstimatedFileSize(formatFileSize(estimatedBytes));
    };

    calculateEstimate();
  }, [exportOptions, imageWidth, imageHeight]);

  useEffect(() => {
    const validation = exportService.validateOptions(exportOptions);
    setValidationErrors(validation.errors);
  }, [exportOptions]);

  const handlePresetChange = useCallback((presetId: string) => {
    setSelectedPreset(presetId);

    if (presetId) {
      const preset = exportService.getPreset(presetId);
      if (preset) {
        setExportOptions(prev => ({ ...prev, ...preset.options }));
      }
    }
  }, []);

  const handleOptionChange = useCallback((key: keyof ExportOptions, value: string | number | boolean | object | undefined) => {
    setExportOptions(prev => ({ ...prev, [key]: value }));

    if (selectedPreset) {
      setSelectedPreset('');
    }
  }, [selectedPreset]);

  // Switching format re-defaults Bit Depth to the highest the new format supports
  // (PNG/TIFF → 16-bit, JPEG/WebP → 8-bit), so an export never silently keeps an
  // unsupported depth from the previous format.
  const handleFormatChange = useCallback((format: ExportOptions['format']) => {
    setExportOptions(prev => ({ ...prev, format, bitDepth: maxBitDepthForFormat(format) }));
    if (selectedPreset) {
      setSelectedPreset('');
    }
  }, [selectedPreset]);

  const handleExport = useCallback(async () => {
    if (validationErrors.length > 0) {
      return;
    }

    // --- Multi-export: apply the same settings to every selected image ---
    if (multiPaths && multiPaths.length > 0) {
      // Ensure a destination folder is chosen.
      let dir = outputDirectory;
      if (!dir) {
        const result = await (window as unknown as { electronAPI?: { showOpenDialog: (opts: Record<string, unknown>) => Promise<{ canceled: boolean; filePaths: string[] }> } }).electronAPI?.showOpenDialog({
          properties: ['openDirectory'],
          title: 'Choose Export Folder'
        });
        if (!result || result.canceled || !result.filePaths?.length) return;
        dir = result.filePaths[0];
        setOutputDirectory(dir);
      }

      setIsExporting(true);
      useAppStore.getState().startExportProgress(multiPaths.length);
      try {
        const summary = await multiExportService.exportMany(multiPaths, exportOptions, {
          outputDirectory: dir,
          onProgress: (current, name) => useAppStore.getState().updateExportProgress(current, name),
          isCancelled: () => !!useAppStore.getState().exportProgress?.cancelRequested,
        });
        // The service reset the editor to each image's edits in turn, then restored
        // the snapshot — reprocess so the canvas reflects the current image again.
        useAppStore.getState().triggerReprocessing();

        const cancelled = !!useAppStore.getState().exportProgress?.cancelRequested;
        const ok = summary.exported.length;
        const failed = summary.failed.length;
        const tail = cancelled ? ' (cancelled early)' : '';
        if (ok > 0 && failed === 0) {
          notificationService.success('Export complete', `Exported ${ok} image${ok !== 1 ? 's' : ''}${tail} to ${dir}`);
        } else if (ok > 0) {
          notificationService.warning('Export finished with errors', `${ok} exported, ${failed} failed${tail}`);
        } else {
          notificationService.error('Export failed', failed > 0 ? `All ${failed} image${failed !== 1 ? 's' : ''} failed` : 'No images were exported');
        }
        onExportComplete(ok > 0);
      } catch (error) {
        logger.error('Multi-export failed:', error);
        notificationService.error('Export failed', String(error));
        onExportComplete(false);
      } finally {
        useAppStore.getState().endExportProgress();
        setIsExporting(false);
        onClose();
      }
      return;
    }

    // --- Single image export ---
    // Close the modal immediately and report progress in the top-left bar (same
    // UX as multi-export) instead of blocking on a modal spinner. The full-res
    // pipeline still runs on the main thread, but it now yields between modules
    // (via the onProgress hook) so the window stays responsive and the bar moves.
    const exportName = (originalFilePath ? originalFilePath.split(/[/\\]/).pop() : undefined) || 'image';
    onClose();
    useAppStore.getState().startExportProgress(1);
    const setProgress = (frac: number) =>
      useAppStore.getState().updateExportProgress(Math.max(0, Math.min(1, frac)), exportName);
    const isCancelled = () => !!useAppStore.getState().exportProgress?.cancelRequested;
    setProgress(0);
    // Let React paint the closed modal + the progress bar before the heavy,
    // main-thread work begins (otherwise it all runs in one frame and the modal
    // appears frozen until the export finishes).
    await new Promise<void>((resolve) => setTimeout(resolve));

    try {
      let exportImageData: Float32Array;
      let exportWidth: number;
      let exportHeight: number;

      if (originalFilePath) {
        const fullResImageData = await imageService.loadImageForExport(originalFilePath);
        setProgress(0.1);

        const pipeline = imageService.getProcessingPipeline();
        if (pipeline) {
          const context = { width: fullResImageData.width, height: fullResImageData.height, channels: 4 };
          // Force main-thread processing for exports (web workers may produce
          // different results). The onProgress hook yields between modules.
          // cacheResults=false: never park full-resolution module results in the
          // pipeline cache (hundreds of MB per module at 24MP+).
          const processedData = await pipeline.processImage(
            fullResImageData.data,
            context,
            false,
            (done, total) => setProgress(0.1 + 0.75 * (total > 0 ? done / total : 1)),
            false,
          );

          if (processedData && typeof processedData === 'object' && 'data' in processedData) {
            const previewData = processedData as unknown as { data: Float32Array; width: number; height: number; isPreview: boolean };
            exportImageData = previewData.data;
            exportWidth = previewData.width;
            exportHeight = previewData.height;
          } else if (processedData && processedData instanceof Float32Array) {
            exportImageData = processedData;
            exportWidth = fullResImageData.width;
            exportHeight = fullResImageData.height;
          } else {
            exportImageData = fullResImageData.data;
            exportWidth = fullResImageData.width;
            exportHeight = fullResImageData.height;
          }
        } else {
          exportImageData = fullResImageData.data;
          exportWidth = fullResImageData.width;
          exportHeight = fullResImageData.height;
        }
      } else {
        exportImageData = imageData;
        exportWidth = imageWidth;
        exportHeight = imageHeight;
      }

      if (isCancelled()) {
        notificationService.warning('Export cancelled', `${exportName} was not saved`);
        onExportComplete(false);
        return;
      }

      setProgress(0.9);
      const result = await exportService.exportImage(
        exportImageData,
        exportWidth,
        exportHeight,
        exportOptions,
        originalFilePath
      );
      setProgress(1);

      if (result.success) {
        notificationService.success('Export complete', `Saved ${exportName}`);
        onExportComplete(true, result.outputPath);
      } else {
        notificationService.error('Export failed', result.error || 'Unknown error');
        onExportComplete(false);
      }
    } catch (error) {
      logger.error('Export failed:', error);
      notificationService.error('Export failed', String(error));
      onExportComplete(false);
    } finally {
      useAppStore.getState().endExportProgress();
    }
  }, [imageData, imageWidth, imageHeight, exportOptions, originalFilePath, validationErrors, onExportComplete, onClose, multiPaths, outputDirectory]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderFormatTab = () => (
    <div className="space-y-6">
      {/* Presets */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Export Presets</h3>
        <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
          {presets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handlePresetChange(preset.id)}
              className="w-full text-left p-3 rounded border transition-colors"
              style={{
                backgroundColor: selectedPreset === preset.id ? 'var(--gray-700)' : 'var(--gray-800)',
                borderColor: selectedPreset === preset.id ? 'var(--gray-500)' : 'var(--border)'
              }}
            >
              <div className="text-sm font-semibold" style={{ color: 'var(--gray-200)' }}>{preset.name}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--gray-400)' }}>{preset.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Format Selection */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Output Format</h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            { format: 'jpeg', label: 'JPEG', desc: 'Best for photos' },
            { format: 'png', label: 'PNG', desc: 'Lossless, transparency' },
            { format: 'tiff', label: 'TIFF', desc: 'Professional printing' },
            { format: 'webp', label: 'WebP', desc: 'Modern web format' }
          ].map(({ format, label, desc }) => (
            <button
              key={format}
              onClick={() => handleFormatChange(format as ExportOptions['format'])}
              className="p-3 rounded border text-left transition-colors"
              style={{
                backgroundColor: exportOptions.format === format ? 'var(--gray-700)' : 'var(--gray-800)',
                borderColor: exportOptions.format === format ? 'var(--gray-500)' : 'var(--border)'
              }}
            >
              <div className="text-sm font-semibold" style={{ color: 'var(--gray-200)' }}>{label}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--gray-400)' }}>{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Quality Settings */}
      {(exportOptions.format === 'jpeg' || exportOptions.format === 'webp') && (
        <div className="space-y-2">
          <SliderControl
            label="Quality"
            value={exportOptions.quality}
            min={1}
            max={100}
            step={1}
            onChange={(value: number) => handleOptionChange('quality', value)}
            className="text-sm"
            showPercentage
          />
        </div>
      )}

      {/* TIFF Compression */}
      {exportOptions.format === 'tiff' && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>TIFF Compression</h3>
          <select
            value={exportOptions.compression}
            onChange={(e) => handleOptionChange('compression', e.target.value)}
            className="w-full px-2 py-1.5 text-sm rounded border focus:outline-none"
            style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-200)' }}
          >
            <option value="none">None (Uncompressed)</option>
            <option value="lzw">LZW (Lossless)</option>
            <option value="zip">ZIP (Lossless)</option>
            <option value="jpeg">JPEG (Lossy)</option>
          </select>
        </div>
      )}
    </div>
  );

  const renderDimensionsTab = () => {
    const outputWidth = exportOptions.width || imageWidth;
    const outputHeight = exportOptions.height || imageHeight;

    return (
      <div className="space-y-6">
        {/* Current Dimensions */}
        <div className="p-3 rounded border" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--gray-500)' }}>Original Size</div>
          <div className="text-sm" style={{ color: 'var(--gray-300)' }}>{imageWidth} × {imageHeight} pixels</div>
        </div>

        {/* Resize Toggle */}
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!(exportOptions.width || exportOptions.height)}
            onChange={(e) => {
              if (e.target.checked) {
                handleOptionChange('width', imageWidth);
                handleOptionChange('height', imageHeight);
              } else {
                handleOptionChange('width', undefined);
                handleOptionChange('height', undefined);
              }
            }}
            className="rounded"
          />
          <span className="text-sm" style={{ color: 'var(--gray-300)' }}>Resize image</span>
        </label>

        {(exportOptions.width || exportOptions.height) && (
          <div className="space-y-4">
            {/* Dimensions */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Width (px)</label>
                <input
                  type="number"
                  value={exportOptions.width || ''}
                  onChange={(e) => handleOptionChange('width', parseInt(e.target.value) || undefined)}
                  className="w-full px-2 py-1.5 text-sm rounded border focus:outline-none"
                  style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-200)' }}
                  placeholder={imageWidth.toString()}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Height (px)</label>
                <input
                  type="number"
                  value={exportOptions.height || ''}
                  onChange={(e) => handleOptionChange('height', parseInt(e.target.value) || undefined)}
                  className="w-full px-2 py-1.5 text-sm rounded border focus:outline-none"
                  style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-200)' }}
                  placeholder={imageHeight.toString()}
                />
              </div>
            </div>

            {/* Resize Mode */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Resize Mode</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { mode: 'fit', label: 'Fit', desc: 'Fit within bounds' },
                  { mode: 'fill', label: 'Fill', desc: 'Fill bounds' },
                  { mode: 'crop', label: 'Crop', desc: 'Crop to fit' },
                  { mode: 'stretch', label: 'Stretch', desc: 'Ignore aspect ratio' }
                ].map(({ mode, label, desc }) => (
                  <button
                    key={mode}
                    onClick={() => handleOptionChange('resizeMode', mode)}
                    className="p-2 rounded border text-left transition-colors"
                    style={{
                      backgroundColor: exportOptions.resizeMode === mode ? 'var(--gray-700)' : 'var(--gray-800)',
                      borderColor: exportOptions.resizeMode === mode ? 'var(--gray-500)' : 'var(--border)'
                    }}
                  >
                    <div className="text-sm font-semibold" style={{ color: 'var(--gray-200)' }}>{label}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--gray-400)' }}>{desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Maintain Aspect Ratio */}
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={exportOptions.maintainAspectRatio}
                onChange={(e) => handleOptionChange('maintainAspectRatio', e.target.checked)}
                className="rounded"
              />
              <span className="text-sm" style={{ color: 'var(--gray-300)' }}>Maintain aspect ratio</span>
            </label>

            {/* Output Size Preview */}
            <div className="p-3 rounded border" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}>
              <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--gray-500)' }}>Output Size</div>
              <div className="text-sm" style={{ color: 'var(--gray-300)' }}>{outputWidth} × {outputHeight} pixels</div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderColorTab = () => (
    <div className="space-y-6">
      {/* Color Space */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Color Space</h3>
        <select
          value={exportOptions.colorSpace}
          onChange={(e) => handleOptionChange('colorSpace', e.target.value)}
          className="w-full px-2 py-1.5 text-sm rounded border focus:outline-none"
          style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-200)' }}
        >
          <option value="srgb">sRGB (Standard)</option>
          <option value="adobergb">Adobe RGB (Photography)</option>
          <option value="prophoto">ProPhoto RGB (Wide Gamut)</option>
          <option value="rec2020">Rec. 2020 (HDR/Video)</option>
        </select>
      </div>

      {/* Bit Depth */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Bit Depth</h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            { bits: 8, label: '8-bit', desc: 'Standard (256 colors/channel)' },
            { bits: 16, label: '16-bit', desc: 'High precision (65536 colors/channel)' }
          ].map(({ bits, label, desc }) => (
            <button
              key={bits}
              onClick={() => handleOptionChange('bitDepth', bits)}
              className="p-3 rounded border text-left transition-colors"
              style={{
                backgroundColor: exportOptions.bitDepth === bits ? 'var(--gray-700)' : 'var(--gray-800)',
                borderColor: exportOptions.bitDepth === bits ? 'var(--gray-500)' : 'var(--border)',
                opacity: exportOptions.format === 'jpeg' && bits === 16 ? 0.5 : 1
              }}
              disabled={exportOptions.format === 'jpeg' && bits === 16}
            >
              <div className="text-sm font-semibold" style={{ color: 'var(--gray-200)' }}>{label}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--gray-400)' }}>{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Metadata */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Metadata</h3>

        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={exportOptions.preserveMetadata}
            onChange={(e) => handleOptionChange('preserveMetadata', e.target.checked)}
            className="rounded"
          />
          <span className="text-sm" style={{ color: 'var(--gray-300)' }}>Preserve original metadata</span>
        </label>

        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={exportOptions.includeProcessingHistory}
            onChange={(e) => handleOptionChange('includeProcessingHistory', e.target.checked)}
            className="rounded"
          />
          <span className="text-sm" style={{ color: 'var(--gray-300)' }}>Include processing history</span>
        </label>
      </div>
    </div>
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
      <div className="rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl" style={{ backgroundColor: 'var(--gray-900)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderBottomColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Download size={18} style={{ color: 'var(--gray-300)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--white)' }}>
              {isMulti ? `Export ${multiPaths!.length} Images` : 'Export Image'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded transition-colors"
            style={{ color: 'var(--gray-400)' }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Tab Navigation */}
          <div className="w-48 border-r" style={{ borderRightColor: 'var(--border)' }}>
            <div className="p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--gray-500)' }}>Export Settings</h3>
              <nav className="space-y-1">
                {[
                  { key: 'format', label: 'Format & Quality', icon: File },
                  { key: 'dimensions', label: 'Dimensions', icon: Image },
                  { key: 'color', label: 'Color & Metadata', icon: Palette }
                ].map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key as TabType)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded text-left text-sm transition-colors"
                    style={{
                      backgroundColor: activeTab === key ? 'var(--gray-800)' : 'transparent',
                      color: activeTab === key ? 'var(--white)' : 'var(--gray-400)'
                    }}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              </nav>
            </div>
          </div>

          {/* Tab Content */}
          <div className="flex-1 px-6 py-5 overflow-y-auto">
            {activeTab === 'format' && renderFormatTab()}
            {activeTab === 'dimensions' && renderDimensionsTab()}
            {activeTab === 'color' && renderColorTab()}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t" style={{ borderTopColor: 'var(--border)' }}>
          {/* Output folder row */}
          <div className="flex items-center gap-2 mb-3 text-sm">
            <span style={{ color: 'var(--gray-500)' }}>Output:</span>
            <span className="flex-1 truncate text-xs font-mono" style={{ color: 'var(--gray-300)' }}>
              {outputDirectory || 'Same folder as original'}
            </span>
            {outputDirectory && (
              <button
                onClick={() => { setOutputDirectory(''); setExportOptions(prev => ({ ...prev, outputDirectory: undefined })); }}
                className="p-1 rounded"
                style={{ color: 'var(--gray-500)' }}
                title="Reset to original folder"
              >
                <X size={12} />
              </button>
            )}
            <button
              onClick={handleChooseFolder}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors"
              style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}
              title="Choose output folder"
            >
              <FolderOpen size={12} />
              Browse
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <div style={{ color: 'var(--gray-400)' }}>
                Estimated size: <span className="font-semibold" style={{ color: 'var(--gray-200)' }}>{estimatedFileSize}</span>
              </div>
              {validationErrors.length > 0 && (
                <div className="flex items-center gap-1" style={{ color: 'var(--gray-300)' }}>
                  <AlertTriangle size={14} />
                  <span>{validationErrors.length} error(s)</span>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm transition-colors rounded"
                style={{ color: 'var(--gray-400)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={isExporting || validationErrors.length > 0}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded border transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}
              >
                {isExporting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--gray-300)' }} />
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    {isMulti ? `Export ${multiPaths!.length}` : 'Export'}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Validation Errors */}
          {validationErrors.length > 0 && (
            <div className="mt-4 p-3 rounded border" style={{ backgroundColor: 'var(--gray-900)', borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2 font-semibold mb-1 text-sm" style={{ color: 'var(--gray-300)' }}>
                <AlertTriangle size={16} />
                Validation Errors
              </div>
              <ul className="text-sm list-disc list-inside space-y-1" style={{ color: 'var(--gray-400)' }}>
                {validationErrors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExportDialog;