import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Palette, RotateCcw, Zap, Settings, Sun, Moon } from 'lucide-react';
import { ColorBalanceModule, ColorBalanceParams } from '../../modules/ColorBalanceModule';
import { logger } from '../../utils/Logger';

interface ColorBalanceModuleComponentProps {
  module: ColorBalanceModule;
  onParamsChange: (params: ColorBalanceParams) => void;
}

type TonalRange = 'shadows' | 'midtones' | 'highlights';

interface ColorWheelProps {
  range: TonalRange;
  position: { x: number; y: number; strength: number };
  onChange: (x: number, y: number) => void;
  size: number;
}

const ColorWheel: React.FC<ColorWheelProps> = ({ range, position, onChange, size }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const getRangeColor = (range: TonalRange): string => {
    switch (range) {
      case 'shadows': return '#4b5563';
      case 'midtones': return '#9ca3af';
      case 'highlights': return '#f3f4f6';
    }
  };

  // Draw color wheel
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size / 2 - 10;

    // Clear canvas
    ctx.clearRect(0, 0, size, size);

    // Draw color wheel
    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;

    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= radius) {
          const angle = Math.atan2(dy, dx);
          const normalizedDistance = distance / radius;

          // Convert angle to hue (0-360)
          let hue = (angle * 180 / Math.PI + 360) % 360;

          // Map hue to color balance coordinates
          // 0° = Red (+cyan_red), 180° = Cyan (-cyan_red)
          // 90° = Yellow (+yellow_blue), 270° = Blue (-yellow_blue)
          const saturation = normalizedDistance;
          const lightness = 0.6;

          // Convert HSL to RGB
          const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
          const x_color = c * (1 - Math.abs(((hue / 60) % 2) - 1));
          const m = lightness - c / 2;

          let r = 0, g = 0, b = 0;

          if (hue >= 0 && hue < 60) {
            r = c; g = x_color; b = 0;
          } else if (hue >= 60 && hue < 120) {
            r = x_color; g = c; b = 0;
          } else if (hue >= 120 && hue < 180) {
            r = 0; g = c; b = x_color;
          } else if (hue >= 180 && hue < 240) {
            r = 0; g = x_color; b = c;
          } else if (hue >= 240 && hue < 300) {
            r = x_color; g = 0; b = c;
          } else if (hue >= 300 && hue < 360) {
            r = c; g = 0; b = x_color;
          }

          const pixelIndex = (y * size + x) * 4;
          data[pixelIndex] = Math.round((r + m) * 255);
          data[pixelIndex + 1] = Math.round((g + m) * 255);
          data[pixelIndex + 2] = Math.round((b + m) * 255);
          data[pixelIndex + 3] = 255;
        } else {
          // Outside circle - transparent
          const pixelIndex = (y * size + x) * 4;
          data[pixelIndex + 3] = 0;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Draw center point
    ctx.fillStyle = '#374151';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
    ctx.fill();

    // Draw current position indicator
    const indicatorX = centerX + position.x * radius;
    const indicatorY = centerY + position.y * radius;

    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = getRangeColor(range);
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(indicatorX, indicatorY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner circle for better visibility
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(indicatorX, indicatorY, 6, 0, Math.PI * 2);
    ctx.stroke();

  }, [position, range, size]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    handleMouseMove(e);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging && e.type === 'mousemove') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size / 2 - 10;

    const x = e.clientX - rect.left - centerX;
    const y = e.clientY - rect.top - centerY;
    const distance = Math.sqrt(x * x + y * y);

    // Clamp to circle
    let normalizedX = x / radius;
    let normalizedY = y / radius;

    if (distance > radius) {
      normalizedX = (x / distance) * (radius / radius);
      normalizedY = (y / distance) * (radius / radius);
    }

    onChange(normalizedX, normalizedY);
  }, [isDragging, onChange, size]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div className="flex flex-col items-center">
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="cursor-pointer border border-gray-600 rounded-full"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      <div className="mt-2 text-xs text-center">
        <div className="text-gray-300 capitalize font-medium">{range}</div>
        <div className="text-gray-500 text-xs">
          Strength: {(position.strength * 100).toFixed(0)}%
        </div>
      </div>
    </div>
  );
};

export const ColorBalanceModuleComponent: React.FC<ColorBalanceModuleComponentProps> = ({
  module,
  onParamsChange
}) => {
  const [params, setParams] = useState<ColorBalanceParams>(module.getParams());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeRange, setActiveRange] = useState<TonalRange>('midtones');

  const updateParams = useCallback((newParams: Partial<ColorBalanceParams>) => {
    const updatedParams = { ...params, ...newParams };
    setParams(updatedParams);
    module.setParams(newParams);
    onParamsChange(updatedParams);
    logger.debug('ColorBalance params updated:', Object.keys(newParams));
  }, [module, onParamsChange, params]);

  const handleColorWheelChange = useCallback((range: TonalRange, x: number, y: number) => {
    module.setColorWheelPosition(range, x, y);
    const updatedParams = module.getParams();
    setParams(updatedParams);
    onParamsChange(updatedParams);
  }, [module, onParamsChange]);

  const resetRange = useCallback((range: TonalRange) => {
    const resetBalance = { cyan_red: 0, magenta_green: 0, yellow_blue: 0 };
    updateParams({ [range]: resetBalance });
  }, [updateParams]);

  const resetAll = useCallback(() => {
    const defaultParams = module.getDefaultParams();
    setParams(defaultParams);
    module.setParams(defaultParams);
    onParamsChange(defaultParams);
  }, [module, onParamsChange]);

  const applyColorLook = useCallback((look: 'neutral' | 'warm' | 'cool' | 'vintage' | 'cinematic' | 'vibrant') => {
    module.applyColorLook(look);
    const updatedParams = module.getParams();
    setParams(updatedParams);
    onParamsChange(updatedParams);
  }, [module, onParamsChange]);

  const autoBalance = useCallback(() => {
    module.autoBalanceGrays();
    const updatedParams = module.getParams();
    setParams(updatedParams);
    onParamsChange(updatedParams);
  }, [module, onParamsChange]);

  return (
    <div className="space-y-6">

      {/* Color Look Presets */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-white">Color Looks</span>
          <button
            onClick={autoBalance}
            className="ml-auto px-2 py-1 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            title="Auto balance grays"
          >
            <Zap className="w-3 h-3" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1">
          {[
            { id: 'neutral', label: 'Neutral', icon: null },
            { id: 'warm', label: 'Warm', icon: <Sun className="w-3 h-3" /> },
            { id: 'cool', label: 'Cool', icon: <Moon className="w-3 h-3" /> },
            { id: 'vintage', label: 'Vintage', icon: null },
            { id: 'cinematic', label: 'Cinema', icon: null },
            { id: 'vibrant', label: 'Vibrant', icon: null }
          ].map(look => (
            <button
              key={look.id}
              onClick={() => applyColorLook(look.id as any)}
              className="flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            >
              {look.icon}
              {look.label}
            </button>
          ))}
        </div>
      </div>

      {/* Color Wheels */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-white">Tonal Balance</span>
          <div className="flex items-center gap-1">
            <button
              onClick={resetAll}
              className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
              title="Reset all ranges"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className={`p-1 rounded transition-colors ${
                showAdvanced
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
              title="Advanced options"
            >
              <Settings className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Range Selection */}
        <div className="flex space-x-1 bg-gray-700 rounded-lg p-1">
          {[
            { id: 'shadows', label: 'Shadows' },
            { id: 'midtones', label: 'Midtones' },
            { id: 'highlights', label: 'Highlights' }
          ].map(range => (
            <button
              key={range.id}
              onClick={() => setActiveRange(range.id as TonalRange)}
              className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-all ${
                activeRange === range.id
                  ? 'bg-gray-600 text-white shadow-sm'
                  : 'bg-transparent text-gray-300 hover:bg-gray-600'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>

        {/* Active Range Color Wheel */}
        <div className="flex justify-center">
          <div className="relative">
            <ColorWheel
              range={activeRange}
              position={module.getColorWheelPosition(activeRange)}
              onChange={(x, y) => handleColorWheelChange(activeRange, x, y)}
              size={180}
            />
            <button
              onClick={() => resetRange(activeRange)}
              className="absolute -top-2 -right-2 p-1 bg-gray-700 hover:bg-gray-600 rounded-full text-gray-400 hover:text-white transition-colors"
              title="Reset this range"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Fine-tune sliders for active range */}
        <div className="space-y-3 bg-gray-800 rounded-lg p-4">
          <div className="text-xs text-gray-400 text-center capitalize">
            {activeRange} Fine Tuning
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Cyan ← → Red: {params[activeRange].cyan_red.toFixed(2)}
              </label>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={params[activeRange].cyan_red}
                onChange={(e) => updateParams({
                  [activeRange]: {
                    ...params[activeRange],
                    cyan_red: parseFloat(e.target.value)
                  }
                })}
                className="w-full h-2 bg-gradient-to-r from-cyan-400 via-gray-300 to-red-400 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Magenta ← → Green: {params[activeRange].magenta_green.toFixed(2)}
              </label>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={params[activeRange].magenta_green}
                onChange={(e) => updateParams({
                  [activeRange]: {
                    ...params[activeRange],
                    magenta_green: parseFloat(e.target.value)
                  }
                })}
                className="w-full h-2 bg-gradient-to-r from-magenta-400 via-gray-300 to-green-400 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Yellow ← → Blue: {params[activeRange].yellow_blue.toFixed(2)}
              </label>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={params[activeRange].yellow_blue}
                onChange={(e) => updateParams({
                  [activeRange]: {
                    ...params[activeRange],
                    yellow_blue: parseFloat(e.target.value)
                  }
                })}
                className="w-full h-2 bg-gradient-to-r from-yellow-400 via-gray-300 to-blue-400 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Global Adjustments */}
      <div className="space-y-3">
        <div className="text-sm font-medium text-white">Global Adjustments</div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Saturation: {params.globalSaturation.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              value={params.globalSaturation}
              onChange={(e) => updateParams({ globalSaturation: parseFloat(e.target.value) })}
              className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Vibrance: {params.globalVibrance.toFixed(2)}
            </label>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={params.globalVibrance}
              onChange={(e) => updateParams({ globalVibrance: parseFloat(e.target.value) })}
              className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Temperature: {params.temperatureShift.toFixed(0)}
            </label>
            <input
              type="range"
              min="-100"
              max="100"
              step="1"
              value={params.temperatureShift}
              onChange={(e) => updateParams({ temperatureShift: parseFloat(e.target.value) })}
              className="w-full h-2 bg-gradient-to-r from-blue-400 via-white to-orange-400 rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Advanced Options */}
      {showAdvanced && (
        <div className="space-y-4 border-t border-gray-700 pt-4">

          {/* Tonal Range Settings */}
          <div className="space-y-3">
            <div className="text-sm font-medium text-white">Tonal Ranges</div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Shadows Range: {params.shadowsRange.start.toFixed(2)}
              </label>
              <input
                type="range"
                min="0"
                max="0.5"
                step="0.01"
                value={params.shadowsRange.start}
                onChange={(e) => updateParams({
                  shadowsRange: { ...params.shadowsRange, start: parseFloat(e.target.value) }
                })}
                className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Highlights Range: {params.highlightsRange.start.toFixed(2)}
              </label>
              <input
                type="range"
                min="0.5"
                max="1"
                step="0.01"
                value={params.highlightsRange.start}
                onChange={(e) => updateParams({
                  highlightsRange: { ...params.highlightsRange, start: parseFloat(e.target.value) }
                })}
                className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Mask Blur: {params.maskBlur.toFixed(1)}
              </label>
              <input
                type="range"
                min="0"
                max="5"
                step="0.1"
                value={params.maskBlur}
                onChange={(e) => updateParams({ maskBlur: parseFloat(e.target.value) })}
                className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>

          {/* Enhancement Options */}
          <div className="space-y-3">
            <div className="text-sm font-medium text-white">Enhancement</div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Contrast Boost: {params.contrastBoost.toFixed(2)}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={params.contrastBoost}
                onChange={(e) => updateParams({ contrastBoost: parseFloat(e.target.value) })}
                className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={params.preserveLuminosity}
                  onChange={(e) => updateParams({ preserveLuminosity: e.target.checked })}
                  className="rounded border-gray-600 text-blue-400 focus:ring-blue-400 focus:ring-2"
                />
                <span className="ml-2 text-xs text-gray-300">Preserve Luminosity</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Info Display */}
      <div className="text-xs text-gray-500 space-y-1 border-t border-gray-700 pt-3">
        <div>Active Range: <span className="text-white capitalize">{activeRange}</span></div>
        <div>
          Balance Strength: <span className="text-white">
            {(module.getColorWheelPosition(activeRange).strength * 100).toFixed(0)}%
          </span>
        </div>
        {params.preserveLuminosity && (
          <div>Mode: <span className="text-green-400">Luminosity Preserved</span></div>
        )}
      </div>
    </div>
  );
};