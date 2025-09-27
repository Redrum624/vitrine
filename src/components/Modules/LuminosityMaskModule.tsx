import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Layers, Sun, Moon, Circle, Plus, Eye, EyeOff, Trash2, Download, Upload, RotateCcw } from 'lucide-react';
import { logger } from '../../utils/Logger';
import { useAppStore } from '../../stores/appStore';
import {
  luminosityMaskService,
  LuminosityMask
} from '../../services/LuminosityMaskService';

interface LuminosityMaskModuleProps {
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export const LuminosityMaskModule: React.FC<LuminosityMaskModuleProps> = ({
  isEnabled,
  onToggle
}) => {
  const currentImage = useAppStore((state) => state.currentImage);
  const processedImageData = useAppStore((state) => state.processedImageData);

  const [masks, setMasks] = useState<LuminosityMask[]>([]);
  const [selectedMasks, setSelectedMasks] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewMask, setPreviewMask] = useState<string>('');
  const [previewCanvas, setPreviewCanvas] = useState<HTMLCanvasElement | null>(null);
  const [maskStats, setMaskStats] = useState<{ coverage: number; averageValue: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [maskSettings, setMaskSettings] = useState({
    type: 'lights' as 'lights' | 'darks' | 'midtones' | 'custom',
    level: 1,
    customRange: {
      min: 0.2,
      max: 0.8,
      feather: 0.1
    },
    previewColor: '#ff0000',
    previewOpacity: 0.5,
    smoothing: 1.0
  });

  // Load existing masks
  useEffect(() => {
    const existingMasks = luminosityMaskService.getMasks();
    setMasks(existingMasks);
  }, []);

  // Generate preview when mask is selected
  useEffect(() => {
    if (previewMask && currentImage) {
      generateMaskPreview(previewMask);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewMask, currentImage, maskSettings.previewColor, maskSettings.previewOpacity]);

  // Generate single luminosity mask
  const generateMask = useCallback(async () => {
    if (!processedImageData || !currentImage) {
      logger.warn('No image data available for mask generation');
      return;
    }

    try {
      setIsGenerating(true);

      const imageData = processedImageData instanceof Float32Array
        ? processedImageData
        : processedImageData.data;

      let mask;
      if (maskSettings.type === 'custom') {
        mask = luminosityMaskService.generateLuminosityMask(
          imageData,
          currentImage.metadata.width,
          currentImage.metadata.height,
          'lights', // Use 'lights' as base for custom range
          maskSettings.level,
          maskSettings.customRange
        );
      } else {
        mask = luminosityMaskService.generateLuminosityMask(
          imageData,
          currentImage.metadata.width,
          currentImage.metadata.height,
          maskSettings.type,
          maskSettings.level
        );
      }

      const updatedMasks = luminosityMaskService.getMasks();
      setMasks(updatedMasks);
      setPreviewMask(mask.id);

      logger.info(`Generated ${mask.name} mask`);

    } catch (error) {
      logger.error('Failed to generate mask:', error);
    } finally {
      setIsGenerating(false);
    }
  }, [processedImageData, currentImage, maskSettings]);

  // Generate complete mask set
  const generateCompleteMaskSet = useCallback(async () => {
    if (!processedImageData || !currentImage) {
      logger.warn('No image data available for mask set generation');
      return;
    }

    try {
      setIsGenerating(true);

      const imageData = processedImageData instanceof Float32Array
        ? processedImageData
        : processedImageData.data;

      const maskSet = luminosityMaskService.generateCompleteMaskSet(
        imageData,
        currentImage.metadata.width,
        currentImage.metadata.height
      );

      const updatedMasks = luminosityMaskService.getMasks();
      setMasks(updatedMasks);

      // Select the first lights mask for preview
      if (maskSet.lights.length > 0) {
        setPreviewMask(maskSet.lights[0].id);
      }

      logger.info(`Generated complete mask set: ${maskSet.lights.length} lights, ${maskSet.darks.length} darks, ${maskSet.midtones.length} midtones`);

    } catch (error) {
      logger.error('Failed to generate mask set:', error);
    } finally {
      setIsGenerating(false);
    }
  }, [processedImageData, currentImage]);

  // Generate mask preview
  const generateMaskPreview = useCallback((maskId: string) => {
    if (!maskId) {
      setPreviewCanvas(null);
      setMaskStats(null);
      return;
    }

    try {
      const preview = luminosityMaskService.createMaskPreview(
        maskId,
        300,
        200,
        maskSettings.previewColor,
        maskSettings.previewOpacity
      );

      const stats = luminosityMaskService.calculateMaskStatistics(maskId);

      setPreviewCanvas(preview);
      setMaskStats(stats ? {
        coverage: stats.coverage,
        averageValue: stats.averageValue
      } : null);

    } catch (error) {
      logger.error('Failed to generate mask preview:', error);
      setPreviewCanvas(null);
      setMaskStats(null);
    }
  }, [maskSettings.previewColor, maskSettings.previewOpacity]);

  // Toggle mask selection
  const toggleMaskSelection = useCallback((maskId: string) => {
    setSelectedMasks(prev =>
      prev.includes(maskId)
        ? prev.filter(id => id !== maskId)
        : [...prev, maskId]
    );
  }, []);

  // Delete selected masks
  const deleteSelectedMasks = useCallback(() => {
    if (selectedMasks.length === 0) return;

    const confirmed = window.confirm(`Delete ${selectedMasks.length} selected mask(s)?`);
    if (!confirmed) return;

    selectedMasks.forEach(maskId => {
      luminosityMaskService.deleteMask(maskId);
    });

    const updatedMasks = luminosityMaskService.getMasks();
    setMasks(updatedMasks);
    setSelectedMasks([]);

    if (selectedMasks.includes(previewMask)) {
      setPreviewMask('');
      setPreviewCanvas(null);
      setMaskStats(null);
    }

    logger.info(`Deleted ${selectedMasks.length} masks`);
  }, [selectedMasks, previewMask]);

  // Invert mask
  const invertMask = useCallback((maskId: string) => {
    const success = luminosityMaskService.invertMask(maskId);
    if (success) {
      const updatedMasks = luminosityMaskService.getMasks();
      setMasks(updatedMasks);

      if (previewMask === maskId) {
        generateMaskPreview(maskId);
      }

      logger.info('Mask inverted');
    }
  }, [previewMask, generateMaskPreview]);

  // Combine selected masks
  const combineSelectedMasks = useCallback((mode: 'intersect' | 'union' | 'subtract' | 'exclude') => {
    if (selectedMasks.length < 2) return;

    const combinedMask = luminosityMaskService.combineMasks(
      selectedMasks,
      mode,
      `Combined (${mode})`
    );

    if (combinedMask) {
      const updatedMasks = luminosityMaskService.getMasks();
      setMasks(updatedMasks);
      setPreviewMask(combinedMask.id);
      setSelectedMasks([]);

      logger.info(`Combined ${selectedMasks.length} masks using ${mode} mode`);
    }
  }, [selectedMasks]);

  // Export mask
  const exportMask = useCallback((maskId: string) => {
    const exportData = luminosityMaskService.exportMask(maskId);
    if (!exportData) return;

    const mask = masks.find(m => m.id === maskId);
    const filename = `${mask?.name.replace(/\s+/g, '_') || 'mask'}.json`;

    const blob = new Blob([exportData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    logger.info(`Exported mask: ${mask?.name}`);
  }, [masks]);

  // Import mask
  const importMask = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const jsonData = e.target?.result as string;
      const maskId = luminosityMaskService.importMask(jsonData);

      if (maskId) {
        const updatedMasks = luminosityMaskService.getMasks();
        setMasks(updatedMasks);
        setPreviewMask(maskId);
        logger.info('Mask imported successfully');
      }
    };
    reader.readAsText(file);
  }, []);

  // Group masks by type
  const groupedMasks = masks.reduce((groups, mask) => {
    const key = mask.type;
    if (!groups[key]) groups[key] = [];
    groups[key].push(mask);
    return groups;
  }, {} as Record<string, LuminosityMask[]>);

  const maskTypes = [
    { value: 'lights', label: 'Lights', icon: Sun, color: 'text-yellow-400' },
    { value: 'darks', label: 'Darks', icon: Moon, color: 'text-blue-400' },
    { value: 'midtones', label: 'Midtones', icon: Circle, color: 'text-gray-400' },
    { value: 'custom', label: 'Custom', icon: Layers, color: 'text-purple-400' }
  ];

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      {/* Module Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <Layers className="w-5 h-5 text-purple-400" />
          <span className="text-white font-medium">Luminosity Masks</span>
          {isGenerating && (
            <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={generateCompleteMaskSet}
            disabled={isGenerating || !processedImageData}
            className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white rounded transition-colors"
            title="Generate complete set"
          >
            Full Set
          </button>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => onToggle(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
          </label>
        </div>
      </div>

      {/* Module Content */}
      {isEnabled && (
        <div className="p-4 space-y-4">

          {/* Mask Generation */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-white">Generate Masks</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Type</label>
                <select
                  value={maskSettings.type}
                  onChange={(e) => setMaskSettings(prev => ({ ...prev, type: e.target.value as 'lights' | 'darks' | 'midtones' }))}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-purple-400 focus:outline-none"
                  disabled={isGenerating}
                >
                  {maskTypes.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Level: {maskSettings.level}
                </label>
                <input
                  type="range"
                  min="1"
                  max={maskSettings.type === 'midtones' ? '3' : '6'}
                  value={maskSettings.level}
                  onChange={(e) => setMaskSettings(prev => ({ ...prev, level: parseInt(e.target.value) }))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                  disabled={isGenerating || maskSettings.type === 'custom'}
                />
              </div>
            </div>

            {/* Custom Range Settings */}
            {maskSettings.type === 'custom' && (
              <div className="bg-gray-700/30 rounded p-3 space-y-2">
                <div className="text-xs font-medium text-white">Custom Range</div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Min: {maskSettings.customRange.min.toFixed(2)}
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={maskSettings.customRange.min}
                      onChange={(e) => setMaskSettings(prev => ({
                        ...prev,
                        customRange: { ...prev.customRange, min: parseFloat(e.target.value) }
                      }))}
                      className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Max: {maskSettings.customRange.max.toFixed(2)}
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={maskSettings.customRange.max}
                      onChange={(e) => setMaskSettings(prev => ({
                        ...prev,
                        customRange: { ...prev.customRange, max: parseFloat(e.target.value) }
                      }))}
                      className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Feather: {maskSettings.customRange.feather.toFixed(2)}
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="0.5"
                      step="0.01"
                      value={maskSettings.customRange.feather}
                      onChange={(e) => setMaskSettings(prev => ({
                        ...prev,
                        customRange: { ...prev.customRange, feather: parseFloat(e.target.value) }
                      }))}
                      className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                    />
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={generateMask}
              disabled={isGenerating || !processedImageData}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {isGenerating ? 'Generating...' : 'Generate Mask'}
            </button>
          </div>

          {/* Existing Masks */}
          {masks.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium text-white">Masks ({masks.length})</span>
                </div>

                <div className="flex items-center gap-1">
                  {selectedMasks.length >= 2 && (
                    <>
                      <button
                        onClick={() => combineSelectedMasks('intersect')}
                        className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                        title="Intersect selected"
                      >
                        ∩
                      </button>
                      <button
                        onClick={() => combineSelectedMasks('union')}
                        className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
                        title="Union selected"
                      >
                        ∪
                      </button>
                    </>
                  )}
                  {selectedMasks.length > 0 && (
                    <button
                      onClick={deleteSelectedMasks}
                      className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                      title="Delete selected"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2 max-h-40 overflow-y-auto">
                {maskTypes.map(type => {
                  const typeMasks = groupedMasks[type.value] || [];
                  if (typeMasks.length === 0) return null;

                  const TypeIcon = type.icon;

                  return (
                    <div key={type.value}>
                      <div className={`text-xs font-medium ${type.color} mb-1`}>
                        <TypeIcon className="w-3 h-3 inline mr-1" />
                        {type.label} ({typeMasks.length})
                      </div>
                      <div className="space-y-1 pl-4">
                        {typeMasks.map(mask => (
                          <div
                            key={mask.id}
                            className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
                              previewMask === mask.id
                                ? 'bg-purple-900/30 border border-purple-500/50'
                                : selectedMasks.includes(mask.id)
                                ? 'bg-blue-900/30 border border-blue-500/50'
                                : 'bg-gray-700/50 hover:bg-gray-700'
                            }`}
                            onClick={() => setPreviewMask(mask.id)}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={selectedMasks.includes(mask.id)}
                                onChange={() => toggleMaskSelection(mask.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="rounded"
                              />
                              <div>
                                <div className="text-sm text-white">{mask.name}</div>
                                <div className="text-xs text-gray-400">
                                  {mask.createdAt.toLocaleTimeString()}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  invertMask(mask.id);
                                }}
                                className="p-1 text-gray-400 hover:text-white"
                                title="Invert mask"
                              >
                                <RotateCcw className="w-3 h-3" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  exportMask(mask.id);
                                }}
                                className="p-1 text-gray-400 hover:text-white"
                                title="Export mask"
                              >
                                <Download className="w-3 h-3" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewMask(mask.id === previewMask ? '' : mask.id);
                                }}
                                className="p-1 text-gray-400 hover:text-white"
                                title="Toggle preview"
                              >
                                {previewMask === mask.id ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Import/Export */}
              <div className="flex gap-2">
                <label className="flex-1 bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium py-2 px-4 rounded transition-colors cursor-pointer flex items-center justify-center gap-2">
                  <Upload className="w-4 h-4" />
                  Import Mask
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={importMask}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Preview */}
          {previewCanvas && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-white">Preview</div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={maskSettings.previewColor}
                    onChange={(e) => setMaskSettings(prev => ({ ...prev, previewColor: e.target.value }))}
                    className="w-6 h-6 rounded border border-gray-600 cursor-pointer"
                    title="Preview color"
                  />
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.1"
                    value={maskSettings.previewOpacity}
                    onChange={(e) => setMaskSettings(prev => ({ ...prev, previewOpacity: parseFloat(e.target.value) }))}
                    className="w-16 h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                    title="Preview opacity"
                  />
                </div>
              </div>

              <div className="bg-gray-700/50 rounded p-3">
                <canvas
                  ref={(ref) => {
                    if (ref && previewCanvas) {
                      ref.width = previewCanvas.width;
                      ref.height = previewCanvas.height;
                      const ctx = ref.getContext('2d')!;
                      ctx.drawImage(previewCanvas, 0, 0);
                    }
                  }}
                  className="w-full h-auto border border-gray-600 rounded"
                />
              </div>

              {maskStats && (
                <div className="bg-purple-900/20 border border-purple-500/20 rounded p-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-gray-400">Coverage:</span>{' '}
                      <span className="text-white">{(maskStats.coverage * 100).toFixed(1)}%</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Average:</span>{' '}
                      <span className="text-white">{(maskStats.averageValue * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* No Image Warning */}
          {!processedImageData && (
            <div className="bg-yellow-900/20 border border-yellow-500/20 rounded-lg p-3 text-center">
              <div className="text-yellow-200 text-sm">
                Load an image to generate luminosity masks
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};