import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Type, Image, Eye, Upload, RotateCw, Palette, Settings } from 'lucide-react';
import { logger } from '../../utils/Logger';
import { useAppStore } from '../../stores/appStore';
import {
  watermarkService,
  WatermarkSettings,
  WatermarkPreset
} from '../../services/WatermarkService';

interface WatermarkModuleProps {
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export const WatermarkModule: React.FC<WatermarkModuleProps> = ({
  isEnabled,
  onToggle
}) => {
  const currentImage = useAppStore((state) => state.currentImage);
  const processedImageData = useAppStore((state) => state.processedImageData);

  const [presets, setPresets] = useState<WatermarkPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [previewCanvas, setPreviewCanvas] = useState<HTMLCanvasElement | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [watermarkSettings, setWatermarkSettings] = useState<WatermarkSettings>({
    enabled: false,
    type: 'text',
    text: '© Your Name',
    font: 'Arial',
    fontSize: 24,
    fontWeight: 'normal',
    color: '#FFFFFF',
    position: 'bottom-right',
    opacity: 0.7,
    scale: 1,
    offsetX: -20,
    offsetY: -20,
    blendMode: 'source-over',
    rotation: 0,
    padding: 10
  });

  // Load presets on mount
  useEffect(() => {
    const availablePresets = watermarkService.getPresets();
    setPresets(availablePresets);

    // Auto-select first preset
    if (availablePresets.length > 0) {
      setSelectedPreset(availablePresets[0].id);
      setWatermarkSettings(availablePresets[0].settings);
    }
  }, []);

  // Generate preview when settings change
  useEffect(() => {
    if (isEnabled && processedImageData && watermarkSettings.enabled) {
      generatePreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEnabled, processedImageData, currentImage, watermarkSettings]);

  // Generate watermark preview
  const generatePreview = useCallback(async () => {
    if (!processedImageData || !currentImage || !watermarkSettings.enabled) {
      setPreviewCanvas(null);
      return;
    }

    try {
      setIsGeneratingPreview(true);

      // Convert Float32Array to ImageData
      const canvas = document.createElement('canvas');
      canvas.width = currentImage.metadata.width;
      canvas.height = currentImage.metadata.height;
      const ctx = canvas.getContext('2d')!;

      const imageDataCanvas = ctx.createImageData(currentImage.metadata.width, currentImage.metadata.height);

      // Extract Float32Array data
      const imageData = processedImageData instanceof Float32Array
        ? processedImageData
        : processedImageData.data;

      // Convert Float32Array to Uint8ClampedArray
      for (let i = 0; i < imageData.length; i += 4) {
        imageDataCanvas.data[i] = Math.round(imageData[i] * 255);     // R
        imageDataCanvas.data[i + 1] = Math.round(imageData[i + 1] * 255); // G
        imageDataCanvas.data[i + 2] = Math.round(imageData[i + 2] * 255); // B
        imageDataCanvas.data[i + 3] = 255; // A
      }

      // Generate preview at smaller size for performance
      const previewSize = {
        width: Math.min(400, currentImage.metadata.width),
        height: Math.min(300, currentImage.metadata.height)
      };

      const preview = await watermarkService.previewWatermark(
        imageDataCanvas,
        watermarkSettings,
        previewSize
      );

      setPreviewCanvas(preview);

    } catch (error) {
      logger.error('Failed to generate watermark preview:', error);
      setPreviewCanvas(null);
    } finally {
      setIsGeneratingPreview(false);
    }
  }, [processedImageData, currentImage, watermarkSettings]);

  // Apply preset
  const applyPreset = useCallback((presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (preset) {
      setWatermarkSettings(preset.settings);
      setSelectedPreset(presetId);
      logger.info('Applied watermark preset:', preset.name);
    }
  }, [presets]);

  // Update watermark setting
  const updateWatermarkSetting = <K extends keyof WatermarkSettings>(
    key: K,
    value: WatermarkSettings[K]
  ) => {
    setWatermarkSettings(prev => ({ ...prev, [key]: value }));
  };

  // Handle image upload for watermark
  const handleImageUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (result) {
        updateWatermarkSetting('imageData', result);
        updateWatermarkSetting('type', 'image');
        logger.info('Watermark image uploaded');
      }
    };
    reader.readAsDataURL(file);
  }, []);

  // Export watermark settings
  const exportSettings = useCallback(() => {
    try {
      const json = watermarkService.exportSettings(watermarkSettings);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = 'watermark-settings.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      logger.info('Watermark settings exported');
    } catch (error) {
      logger.error('Failed to export watermark settings:', error);
    }
  }, [watermarkSettings]);

  const positions = [
    { value: 'top-left', label: 'Top Left' },
    { value: 'top-center', label: 'Top Center' },
    { value: 'top-right', label: 'Top Right' },
    { value: 'center-left', label: 'Center Left' },
    { value: 'center', label: 'Center' },
    { value: 'center-right', label: 'Center Right' },
    { value: 'bottom-left', label: 'Bottom Left' },
    { value: 'bottom-center', label: 'Bottom Center' },
    { value: 'bottom-right', label: 'Bottom Right' },
    { value: 'tiled', label: 'Tiled' }
  ];

  const blendModes = [
    { value: 'source-over', label: 'Normal' },
    { value: 'multiply', label: 'Multiply' },
    { value: 'screen', label: 'Screen' },
    { value: 'overlay', label: 'Overlay' },
    { value: 'soft-light', label: 'Soft Light' },
    { value: 'hard-light', label: 'Hard Light' },
    { value: 'difference', label: 'Difference' },
    { value: 'exclusion', label: 'Exclusion' }
  ];

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      {/* Module Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <Type className="w-5 h-5 text-purple-400" />
          <span className="text-white font-medium">Watermark</span>
          {isGeneratingPreview && (
            <RotateCw className="w-4 h-4 text-purple-400 animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportSettings}
            disabled={!watermarkSettings.enabled}
            className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white rounded transition-colors"
            title="Export settings"
          >
            Export
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

          {/* Presets */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-white">Presets</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {presets.map(preset => (
                <button
                  key={preset.id}
                  onClick={() => applyPreset(preset.id)}
                  className={`text-left p-2 rounded text-sm transition-colors ${
                    selectedPreset === preset.id
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  <div className="font-medium">{preset.name}</div>
                  <div className="text-xs opacity-75">{preset.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Watermark Type */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-white">Type & Content</span>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => updateWatermarkSetting('type', 'text')}
                className={`flex-1 py-2 px-3 rounded text-sm transition-colors flex items-center justify-center gap-2 ${
                  watermarkSettings.type === 'text'
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <Type className="w-4 h-4" />
                Text
              </button>
              <button
                onClick={() => updateWatermarkSetting('type', 'image')}
                className={`flex-1 py-2 px-3 rounded text-sm transition-colors flex items-center justify-center gap-2 ${
                  watermarkSettings.type === 'image'
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <Image className="w-4 h-4" />
                Image
              </button>
            </div>

            {/* Text Settings */}
            {watermarkSettings.type === 'text' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Text</label>
                  <input
                    type="text"
                    value={watermarkSettings.text || ''}
                    onChange={(e) => updateWatermarkSetting('text', e.target.value)}
                    className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-purple-400 focus:outline-none"
                    placeholder="© Your Name"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Font</label>
                    <select
                      value={watermarkSettings.font || 'Arial'}
                      onChange={(e) => updateWatermarkSetting('font', e.target.value)}
                      className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-purple-400 focus:outline-none"
                    >
                      <option value="Arial">Arial</option>
                      <option value="Georgia">Georgia</option>
                      <option value="Times New Roman">Times New Roman</option>
                      <option value="Helvetica">Helvetica</option>
                      <option value="Verdana">Verdana</option>
                      <option value="Impact">Impact</option>
                      <option value="Courier New">Courier New</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Size: {watermarkSettings.fontSize}px
                    </label>
                    <input
                      type="range"
                      min="8"
                      max="120"
                      value={watermarkSettings.fontSize || 24}
                      onChange={(e) => updateWatermarkSetting('fontSize', parseInt(e.target.value))}
                      className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Weight</label>
                    <select
                      value={watermarkSettings.fontWeight || 'normal'}
                      onChange={(e) => updateWatermarkSetting('fontWeight', e.target.value as 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900')}
                      className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-purple-400 focus:outline-none"
                    >
                      <option value="normal">Normal</option>
                      <option value="bold">Bold</option>
                      <option value="100">Thin</option>
                      <option value="300">Light</option>
                      <option value="500">Medium</option>
                      <option value="700">Bold</option>
                      <option value="900">Black</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Color</label>
                    <input
                      type="color"
                      value={watermarkSettings.color || '#FFFFFF'}
                      onChange={(e) => updateWatermarkSetting('color', e.target.value)}
                      className="w-full h-9 bg-gray-700 rounded border border-gray-600 cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Image Settings */}
            {watermarkSettings.type === 'image' && (
              <div className="space-y-3">
                <div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full bg-gray-700 hover:bg-gray-600 text-white text-sm rounded px-3 py-2 border border-gray-600 transition-colors flex items-center justify-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    {watermarkSettings.imageData ? 'Change Image' : 'Upload Image'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </div>

                {watermarkSettings.imageData && (
                  <div className="bg-gray-700/50 rounded p-2">
                    <img
                      src={watermarkSettings.imageData}
                      alt="Watermark"
                      className="max-w-full h-16 object-contain mx-auto"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Position & Transform */}
          <div className="space-y-3">
            <div className="text-sm font-medium text-white">Position & Transform</div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Position</label>
                <select
                  value={watermarkSettings.position}
                  onChange={(e) => updateWatermarkSetting('position', e.target.value as 'top-left' | 'top-center' | 'top-right' | 'center-left' | 'center' | 'center-right' | 'bottom-left' | 'bottom-center' | 'bottom-right')}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-purple-400 focus:outline-none"
                >
                  {positions.map(pos => (
                    <option key={pos.value} value={pos.value}>
                      {pos.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Blend Mode</label>
                <select
                  value={watermarkSettings.blendMode || 'normal'}
                  onChange={(e) => updateWatermarkSetting('blendMode', e.target.value as 'source-over' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'hard-light' | 'difference' | 'exclusion')}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-purple-400 focus:outline-none"
                >
                  {blendModes.map(mode => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Opacity: {Math.round(watermarkSettings.opacity * 100)}%
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={watermarkSettings.opacity}
                  onChange={(e) => updateWatermarkSetting('opacity', parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Scale: {Math.round(watermarkSettings.scale * 100)}%
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="2"
                  step="0.05"
                  value={watermarkSettings.scale}
                  onChange={(e) => updateWatermarkSetting('scale', parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Rotation: {watermarkSettings.rotation}°
                </label>
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="5"
                  value={watermarkSettings.rotation}
                  onChange={(e) => updateWatermarkSetting('rotation', parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Padding: {watermarkSettings.padding}px
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={watermarkSettings.padding}
                  onChange={(e) => updateWatermarkSetting('padding', parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Offset X: {watermarkSettings.offsetX}px</label>
                <input
                  type="range"
                  min="-200"
                  max="200"
                  step="5"
                  value={watermarkSettings.offsetX}
                  onChange={(e) => updateWatermarkSetting('offsetX', parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Offset Y: {watermarkSettings.offsetY}px</label>
                <input
                  type="range"
                  min="-200"
                  max="200"
                  step="5"
                  value={watermarkSettings.offsetY}
                  onChange={(e) => updateWatermarkSetting('offsetY', parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                />
              </div>
            </div>

            {/* Tiled Settings */}
            {watermarkSettings.position === 'tiled' && (
              <div className="bg-gray-700/30 rounded p-3 space-y-2">
                <div className="text-xs font-medium text-white">Tiled Options</div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Spacing: {watermarkSettings.spacing || 200}px
                    </label>
                    <input
                      type="range"
                      min="50"
                      max="500"
                      step="25"
                      value={watermarkSettings.spacing || 200}
                      onChange={(e) => updateWatermarkSetting('spacing', parseInt(e.target.value))}
                      className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Tile Opacity: {Math.round((watermarkSettings.tiledOpacity || watermarkSettings.opacity) * 100)}%
                    </label>
                    <input
                      type="range"
                      min="0.05"
                      max="0.5"
                      step="0.05"
                      value={watermarkSettings.tiledOpacity || watermarkSettings.opacity}
                      onChange={(e) => updateWatermarkSetting('tiledOpacity', parseFloat(e.target.value))}
                      className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Enable Watermark */}
          <div className="flex items-center gap-3 p-3 bg-purple-900/20 border border-purple-500/20 rounded-lg">
            <label className="flex items-center cursor-pointer flex-1">
              <input
                type="checkbox"
                checked={watermarkSettings.enabled}
                onChange={(e) => updateWatermarkSetting('enabled', e.target.checked)}
                className="mr-3 rounded"
              />
              <span className="text-white text-sm font-medium">Apply Watermark to Exports</span>
            </label>
          </div>

          {/* Preview */}
          {watermarkSettings.enabled && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-white">Preview</div>
                <button
                  onClick={generatePreview}
                  disabled={isGeneratingPreview || !processedImageData}
                  className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white rounded transition-colors flex items-center gap-2"
                >
                  <Eye className="w-3 h-3" />
                  {isGeneratingPreview ? 'Generating...' : 'Refresh Preview'}
                </button>
              </div>

              {previewCanvas ? (
                <div className="bg-gray-700/50 rounded p-3 text-center">
                  <canvas
                    ref={(ref) => {
                      if (ref && previewCanvas) {
                        ref.width = previewCanvas.width;
                        ref.height = previewCanvas.height;
                        const ctx = ref.getContext('2d')!;
                        ctx.drawImage(previewCanvas, 0, 0);
                      }
                    }}
                    className="max-w-full h-auto border border-gray-600 rounded"
                  />
                </div>
              ) : (
                <div className="bg-gray-700/50 rounded p-8 text-center">
                  <div className="text-gray-400 text-sm">
                    {processedImageData ? 'No preview available' : 'Load an image to see preview'}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};