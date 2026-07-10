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
import { GlassModal } from './GlassModal';
import { ChipButton } from '../Controls/ChipButton';
import { AccentButton } from '../Controls/AccentButton';
import { SectionLabel } from '../Controls/SectionLabel';
import SliderControl from '../Controls/SliderControl';
import { inputStyle, selectStyle, infoBoxStyle } from './glassFormStyles';
import { ExportOptions, ExportPreset, exportService } from '../../services/ExportService';
import { imageService } from '../../services/ImageService';
import { resolveExportSource } from './resolveExportSource';
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
        // resolveExportSource returns the baked upscale buffer when active,
        // otherwise falls through to loadImageForExport — the non-baked path
        // is byte-for-byte identical to the previous behaviour.
        const source = await resolveExportSource(originalFilePath);
        setProgress(0.1);

        const pipeline = imageService.getProcessingPipeline();
        if (pipeline) {
          // Diagnostic: surface WHICH modules will actually run for this export. processImage
          // skips modules that are disabled OR at identity params, so a "no edits in the
          // export" report shows up here as "0/N modules active" — distinguishing a module
          // STATE problem (e.g. edits not restored/enabled) from the export wiring (proven
          // correct by src/test/exportAppliesEdits.test.ts).
          try {
            const order = pipeline.getOrderedModules();
            const active = order.filter((m) => pipeline.isModuleActive(m.getId()));
            logger.info(`[Export] ${exportName}: pipeline connected, ${active.length}/${order.length} modules active: [${active.map((m) => m.getId()).join(', ')}]`);
          } catch { /* diagnostic only — never block an export */ }
          const context = { width: source.width, height: source.height, channels: 4 };
          // Force main-thread processing for exports (web workers may produce
          // different results). The onProgress hook yields between modules.
          // cacheResults=false: never park full-resolution module results in the
          // pipeline cache (hundreds of MB per module at 24MP+).
          const processedData = await pipeline.processImage(
            source.data,
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
            exportWidth = source.width;
            exportHeight = source.height;
          } else {
            logger.warn('[Export] processImage returned an unusable buffer — exporting the ORIGINAL pixels (edits will be missing)');
            exportImageData = source.data;
            exportWidth = source.width;
            exportHeight = source.height;
          }
        } else {
          logger.warn('[Export] no processing pipeline connected — exporting the ORIGINAL pixels (edits will be missing)');
          exportImageData = source.data;
          exportWidth = source.width;
          exportHeight = source.height;
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
        <SectionLabel>Export Presets</SectionLabel>
        <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handlePresetChange(preset.id)}
              data-active={selectedPreset === preset.id || undefined}
              className="glass-modal-card-btn w-full text-left"
              style={{ padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)' }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--glass-text-title)' }}>{preset.name}</div>
              <div style={{ fontSize: 11, marginTop: 2, color: 'var(--glass-text-muted)' }}>{preset.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Format Selection */}
      <div className="space-y-2">
        <SectionLabel>Output Format</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {[
            { format: 'jpeg', label: 'JPEG', desc: 'Best for photos' },
            { format: 'png', label: 'PNG', desc: 'Lossless, transparency' },
            { format: 'tiff', label: 'TIFF', desc: 'Professional printing' },
            { format: 'webp', label: 'WebP', desc: 'Modern web format' }
          ].map(({ format, label, desc }) => (
            <button
              key={format}
              type="button"
              onClick={() => handleFormatChange(format as ExportOptions['format'])}
              data-active={exportOptions.format === format || undefined}
              className="glass-modal-card-btn text-left"
              style={{ padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)' }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--glass-text-title)' }}>{label}</div>
              <div style={{ fontSize: 11, marginTop: 2, color: 'var(--glass-text-muted)' }}>{desc}</div>
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
          <SectionLabel>TIFF Compression</SectionLabel>
          <select
            value={exportOptions.compression}
            onChange={(e) => handleOptionChange('compression', e.target.value)}
            style={selectStyle}
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
        <div style={infoBoxStyle}>
          <SectionLabel className="mb-1">Original Size</SectionLabel>
          <div style={{ fontSize: 12.5, color: 'var(--glass-text-label)', marginTop: 6 }}>{imageWidth} × {imageHeight} pixels</div>
        </div>

        {/* Resize Toggle */}
        <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: 12.5, color: 'var(--glass-text-label)' }}>
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
            style={{ accentColor: 'var(--accent)' }}
          />
          Resize image
        </label>

        {(exportOptions.width || exportOptions.height) && (
          <div className="space-y-4">
            {/* Dimensions */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--glass-text-label)' }}>Width (px)</label>
                <input
                  type="number"
                  value={exportOptions.width || ''}
                  onChange={(e) => handleOptionChange('width', parseInt(e.target.value) || undefined)}
                  style={inputStyle}
                  placeholder={imageWidth.toString()}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--glass-text-label)' }}>Height (px)</label>
                <input
                  type="number"
                  value={exportOptions.height || ''}
                  onChange={(e) => handleOptionChange('height', parseInt(e.target.value) || undefined)}
                  style={inputStyle}
                  placeholder={imageHeight.toString()}
                />
              </div>
            </div>

            {/* Resize Mode */}
            <div className="space-y-2">
              <SectionLabel>Resize Mode</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { mode: 'fit', label: 'Fit', desc: 'Fit within bounds' },
                  { mode: 'fill', label: 'Fill', desc: 'Fill bounds' },
                  { mode: 'crop', label: 'Crop', desc: 'Crop to fit' },
                  { mode: 'stretch', label: 'Stretch', desc: 'Ignore aspect ratio' }
                ].map(({ mode, label, desc }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => handleOptionChange('resizeMode', mode)}
                    data-active={exportOptions.resizeMode === mode || undefined}
                    className="glass-modal-card-btn text-left"
                    style={{ padding: 8, borderRadius: 9, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)' }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--glass-text-title)' }}>{label}</div>
                    <div style={{ fontSize: 10.5, marginTop: 2, color: 'var(--glass-text-muted)' }}>{desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Maintain Aspect Ratio */}
            <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: 12.5, color: 'var(--glass-text-label)' }}>
              <input
                type="checkbox"
                checked={exportOptions.maintainAspectRatio}
                onChange={(e) => handleOptionChange('maintainAspectRatio', e.target.checked)}
                style={{ accentColor: 'var(--accent)' }}
              />
              Maintain aspect ratio
            </label>

            {/* Output Size Preview */}
            <div style={infoBoxStyle}>
              <SectionLabel className="mb-1">Output Size</SectionLabel>
              <div style={{ fontSize: 12.5, color: 'var(--glass-text-label)', marginTop: 6 }}>{outputWidth} × {outputHeight} pixels</div>
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
        <SectionLabel>Color Space</SectionLabel>
        <select
          value={exportOptions.colorSpace}
          onChange={(e) => handleOptionChange('colorSpace', e.target.value)}
          style={selectStyle}
        >
          <option value="srgb">sRGB (Standard)</option>
          <option value="adobergb">Adobe RGB (Photography)</option>
          <option value="prophoto">ProPhoto RGB (Wide Gamut)</option>
          <option value="rec2020">Rec. 2020 (HDR/Video)</option>
        </select>
      </div>

      {/* Bit Depth */}
      <div className="space-y-2">
        <SectionLabel>Bit Depth</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {[
            { bits: 8, label: '8-bit', desc: 'Standard (256 colors/channel)' },
            { bits: 16, label: '16-bit', desc: 'High precision (65536 colors/channel)' }
          ].map(({ bits, label, desc }) => {
            const disabled = exportOptions.format === 'jpeg' && bits === 16;
            return (
              <button
                key={bits}
                type="button"
                onClick={() => handleOptionChange('bitDepth', bits)}
                data-active={exportOptions.bitDepth === bits || undefined}
                disabled={disabled}
                className="glass-modal-card-btn text-left"
                style={{
                  padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)',
                  opacity: disabled ? 0.5 : 1,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--glass-text-title)' }}>{label}</div>
                <div style={{ fontSize: 11, marginTop: 2, color: 'var(--glass-text-muted)' }}>{desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Metadata */}
      <div className="space-y-3">
        <SectionLabel>Metadata</SectionLabel>

        <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: 12.5, color: 'var(--glass-text-label)' }}>
          <input
            type="checkbox"
            checked={exportOptions.preserveMetadata}
            onChange={(e) => handleOptionChange('preserveMetadata', e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          Preserve original metadata
        </label>

        <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: 12.5, color: 'var(--glass-text-label)' }}>
          <input
            type="checkbox"
            checked={exportOptions.includeProcessingHistory}
            onChange={(e) => handleOptionChange('includeProcessingHistory', e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          Include processing history
        </label>
      </div>
    </div>
  );

  const footer = (
    <div className="flex flex-col" style={{ gap: 12 }}>
      {/* Output folder row */}
      <div className="flex items-center gap-2">
        <span style={{ fontSize: 11.5, color: 'var(--glass-text-muted)' }}>Output:</span>
        <span
          className="flex-1 truncate"
          style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: 'var(--glass-text-label)' }}
        >
          {outputDirectory || 'Same folder as original'}
        </span>
        {outputDirectory && (
          <button
            type="button"
            onClick={() => { setOutputDirectory(''); setExportOptions(prev => ({ ...prev, outputDirectory: undefined })); }}
            className="glass-pill-btn inline-flex items-center justify-center"
            style={{ padding: 4, borderRadius: 6, color: 'var(--glass-text-muted)' }}
            title="Reset to original folder"
          >
            <X size={12} />
          </button>
        )}
        <ChipButton onClick={handleChooseFolder} title="Choose output folder">
          <FolderOpen size={12} style={{ marginRight: 6 }} />
          Browse
        </ChipButton>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div style={{ fontSize: 11.5, color: 'var(--glass-text-muted)' }}>
            Estimated size: <span style={{ fontWeight: 600, color: 'var(--glass-text-label)' }}>{estimatedFileSize}</span>
          </div>
          {validationErrors.length > 0 && (
            <div className="flex items-center gap-1" style={{ fontSize: 11.5, color: '#f87171' }}>
              <AlertTriangle size={13} />
              <span>{validationErrors.length} error(s)</span>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="glass-modal-btn-secondary"
            style={{
              padding: '9px 16px', borderRadius: 10, fontSize: 12, fontWeight: 500,
              border: '1px solid rgba(255,255,255,.1)', background: 'transparent', color: 'var(--glass-text-secondary)',
            }}
          >
            Cancel
          </button>
          <AccentButton
            onClick={handleExport}
            disabled={isExporting || validationErrors.length > 0}
          >
            {isExporting ? (
              <>
                <span
                  className="animate-spin"
                  style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid rgba(11,11,12,0.35)', borderTopColor: '#0b0b0c' }}
                />
                Exporting...
              </>
            ) : (
              <>
                <Download size={14} />
                {isMulti ? `Export ${multiPaths!.length}` : 'Export'}
              </>
            )}
          </AccentButton>
        </div>
      </div>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <div style={{ padding: 12, borderRadius: 10, background: 'rgba(0,0,0,.3)', border: '1px solid var(--glass-border)' }}>
          <div className="flex items-center gap-2" style={{ fontSize: 11.5, fontWeight: 600, color: '#f87171', marginBottom: 4 }}>
            <AlertTriangle size={14} />
            Validation Errors
          </div>
          <ul style={{ fontSize: 11.5, color: 'var(--glass-text-muted)', paddingLeft: 16, listStyle: 'disc' }}>
            {validationErrors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      icon={<Download size={15} />}
      title={isMulti ? `Export ${multiPaths!.length} Image${multiPaths!.length !== 1 ? 's' : ''}` : 'Export Image'}
      cardClassName="w-full max-w-4xl"
      cardStyle={{ maxHeight: '90vh' }}
      scrollBody={false}
      footer={footer}
    >
      <div className="flex flex-1 overflow-hidden">
        {/* Tab Navigation */}
        <div className="flex-shrink-0" style={{ width: 192, borderRight: '1px solid var(--glass-border)', padding: 14 }}>
          <SectionLabel className="mb-3">Export Settings</SectionLabel>
          <nav className="flex flex-col" style={{ gap: 4, marginTop: 10 }}>
            {[
              { key: 'format', label: 'Format & Quality', icon: File },
              { key: 'dimensions', label: 'Dimensions', icon: Image },
              { key: 'color', label: 'Color & Metadata', icon: Palette }
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key as TabType)}
                data-active={activeTab === key || undefined}
                className="glass-modal-tab w-full flex items-center gap-2"
                style={{
                  padding: '8px 10px', borderRadius: 9, fontSize: 12, textAlign: 'left',
                  border: '1px solid transparent', color: 'var(--glass-text-secondary)',
                }}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '20px 24px' }}>
          {activeTab === 'format' && renderFormatTab()}
          {activeTab === 'dimensions' && renderDimensionsTab()}
          {activeTab === 'color' && renderColorTab()}
        </div>
      </div>
    </GlassModal>
  );
};

export default ExportDialog;
