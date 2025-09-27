import React, { useState, useRef, useCallback, useEffect } from 'react';
import { TrendingUp, RotateCcw, Settings, Zap } from 'lucide-react';
import { ToneCurveModule, ToneCurveParams } from '../../modules/ToneCurveModule';
import { logger } from '../../utils/Logger';

interface ToneCurveModuleComponentProps {
  module: ToneCurveModule;
  onParamsChange: (params: ToneCurveParams) => void;
}

type CurveChannel = 'base' | 'red' | 'green' | 'blue';

export const ToneCurveModuleComponent: React.FC<ToneCurveModuleComponentProps> = ({
  module,
  onParamsChange
}) => {
  const [params, setParams] = useState<ToneCurveParams>(module.getParams());
  const [activeChannel, setActiveChannel] = useState<CurveChannel>('base');
  const [draggedPoint, setDraggedPoint] = useState<{ channel: CurveChannel; index: number } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasSize = 256;

  const updateParams = useCallback((newParams: Partial<ToneCurveParams>) => {
    const updatedParams = { ...params, ...newParams };
    setParams(updatedParams);
    module.setParams(newParams);
    onParamsChange(updatedParams);
    logger.debug('ToneCurve params updated:', newParams);
  }, [module, onParamsChange, params]);

  // Draw the curve editor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    // Draw grid
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);

    // Grid lines
    for (let i = 0; i <= 4; i++) {
      const pos = (i * canvasSize) / 4;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, canvasSize);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(canvasSize, pos);
      ctx.stroke();
    }

    // Draw diagonal reference line
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#4b5563';
    ctx.beginPath();
    ctx.moveTo(0, canvasSize);
    ctx.lineTo(canvasSize, 0);
    ctx.stroke();
    ctx.setLineDash([]);

    // Function to get channel color
    const getChannelColor = (channel: CurveChannel): string => {
      switch (channel) {
        case 'base': return '#ffffff';
        case 'red': return '#ef4444';
        case 'green': return '#22c55e';
        case 'blue': return '#3b82f6';
        default: return '#ffffff';
      }
    };

    // Draw all curves with reduced opacity for inactive ones
    const channels: CurveChannel[] = ['base', 'red', 'green', 'blue'];

    channels.forEach(channel => {
      const curve = channel === 'base' ? params.baseCurve : params.rgbCurve[channel];
      const isActive = channel === activeChannel;

      ctx.strokeStyle = getChannelColor(channel);
      ctx.globalAlpha = isActive ? 1.0 : 0.3;
      ctx.lineWidth = isActive ? 2 : 1;

      // Draw curve
      ctx.beginPath();
      for (let x = 0; x <= canvasSize; x++) {
        const input = x / canvasSize;
        let output = input;

        // Interpolate between curve points
        for (let i = 1; i < curve.length; i++) {
          if (input <= curve[i].x) {
            const p1 = curve[i - 1];
            const p2 = curve[i];
            const t = (input - p1.x) / (p2.x - p1.x);

            // Smooth interpolation
            if (params.baseCurveType === 1) {
              const smoothT = t * t * (3 - 2 * t);
              output = p1.y + smoothT * (p2.y - p1.y);
            } else {
              output = p1.y + t * (p2.y - p1.y);
            }
            break;
          }
        }

        const canvasY = canvasSize - (output * canvasSize);

        if (x === 0) {
          ctx.moveTo(x, canvasY);
        } else {
          ctx.lineTo(x, canvasY);
        }
      }
      ctx.stroke();

      // Draw control points for active channel
      if (isActive) {
        curve.forEach((point, index) => {
          const canvasX = point.x * canvasSize;
          const canvasY = canvasSize - (point.y * canvasSize);

          ctx.globalAlpha = 1.0;
          ctx.fillStyle = getChannelColor(channel);
          ctx.strokeStyle = '#1f2937';
          ctx.lineWidth = 2;

          ctx.beginPath();
          ctx.arc(canvasX, canvasY, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Highlight dragged point
          if (draggedPoint?.channel === channel && draggedPoint?.index === index) {
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(canvasX, canvasY, 8, 0, Math.PI * 2);
            ctx.stroke();
          }
        });
      }
    });

    ctx.globalAlpha = 1.0;
  }, [params, activeChannel, draggedPoint]);

  // Handle mouse events for curve editing
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / canvasSize;
    const y = 1 - (e.clientY - rect.top) / canvasSize;

    const currentCurve = activeChannel === 'base' ? params.baseCurve : params.rgbCurve[activeChannel];

    // Check if clicking near existing point
    let nearestPoint = -1;
    let nearestDistance = Infinity;

    currentCurve.forEach((point, index) => {
      const distance = Math.sqrt(
        Math.pow((point.x - x) * canvasSize, 2) +
        Math.pow((point.y - y) * canvasSize, 2)
      );

      if (distance < 15 && distance < nearestDistance) {
        nearestDistance = distance;
        nearestPoint = index;
      }
    });

    if (nearestPoint >= 0) {
      // Start dragging existing point
      setDraggedPoint({ channel: activeChannel, index: nearestPoint });
    } else {
      // Add new control point
      module.addControlPoint(Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)), activeChannel);
      const updatedParams = module.getParams();
      setParams(updatedParams);
      onParamsChange(updatedParams);
    }
  }, [activeChannel, params, module, onParamsChange]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!draggedPoint) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / canvasSize));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / canvasSize));

    module.updateControlPoint(draggedPoint.index, x, y, draggedPoint.channel);
    const updatedParams = module.getParams();
    setParams(updatedParams);
    onParamsChange(updatedParams);
  }, [draggedPoint, module, onParamsChange]);

  const handleCanvasMouseUp = useCallback(() => {
    setDraggedPoint(null);
  }, []);

  const handleCanvasDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / canvasSize;
    const y = 1 - (e.clientY - rect.top) / canvasSize;

    const currentCurve = activeChannel === 'base' ? params.baseCurve : params.rgbCurve[activeChannel];

    // Check if double-clicking near existing point to remove it
    currentCurve.forEach((point, index) => {
      const distance = Math.sqrt(
        Math.pow((point.x - x) * canvasSize, 2) +
        Math.pow((point.y - y) * canvasSize, 2)
      );

      if (distance < 15) {
        module.removeControlPoint(index, activeChannel);
        const updatedParams = module.getParams();
        setParams(updatedParams);
        onParamsChange(updatedParams);
      }
    });
  }, [activeChannel, params, module, onParamsChange]);

  const resetCurve = useCallback(() => {
    if (activeChannel === 'base') {
      updateParams({
        baseCurve: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        baseCurveNodes: 2
      });
    } else {
      updateParams({
        rgbCurve: {
          ...params.rgbCurve,
          [activeChannel]: [{ x: 0, y: 0 }, { x: 1, y: 1 }]
        },
        rgbCurveNodes: {
          ...params.rgbCurveNodes,
          [activeChannel]: 2
        }
      });
    }
  }, [activeChannel, params, updateParams]);

  const loadPreset = useCallback((preset: 'linear' | 'contrast' | 'film' | 'vintage' | 'dramatic') => {
    module.loadPreset(preset);
    const updatedParams = module.getParams();
    setParams(updatedParams);
    onParamsChange(updatedParams);
  }, [module, onParamsChange]);

  return (
    <div className="space-y-4">
      {/* Channel Selection */}
      <div className="flex space-x-1 bg-gray-700 rounded-lg p-1">
        {[
          { id: 'base', label: 'RGB', color: 'text-white' },
          { id: 'red', label: 'R', color: 'text-red-400' },
          { id: 'green', label: 'G', color: 'text-green-400' },
          { id: 'blue', label: 'B', color: 'text-blue-400' }
        ].map(channel => (
          <button
            key={channel.id}
            onClick={() => setActiveChannel(channel.id as CurveChannel)}
            className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-all ${
              activeChannel === channel.id
                ? 'bg-gray-600 text-white shadow-sm'
                : `bg-transparent ${channel.color} hover:bg-gray-600`
            }`}
          >
            {channel.label}
          </button>
        ))}
      </div>

      {/* Curve Editor Canvas */}
      <div className="relative bg-gray-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-purple-400" />
            <span className="text-sm text-white">
              {activeChannel === 'base' ? 'Tone Curve' : `${activeChannel.toUpperCase()} Channel`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                // Auto adjust tone curve
                const autoParams = module.autoToneCurve();
                setParams(autoParams);
                onParamsChange(autoParams);
              }}
              className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
              title="Auto adjust tone curve"
            >
              <Zap className="w-3 h-3" />
            </button>
            <button
              onClick={resetCurve}
              className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
              title="Reset curve"
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

        <div className="relative">
          <canvas
            ref={canvasRef}
            width={canvasSize}
            height={canvasSize}
            className="w-full h-64 bg-gray-900 rounded border border-gray-600 cursor-crosshair"
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
            onDoubleClick={handleCanvasDoubleClick}
          />

          {/* Instructions */}
          <div className="absolute bottom-2 left-2 text-xs text-gray-500">
            Click: Add point • Drag: Move point • Double-click: Remove point
          </div>
        </div>
      </div>

      {/* Curve Presets */}
      <div className="space-y-2">
        <label className="block text-xs text-gray-400 mb-2">Presets</label>
        <div className="grid grid-cols-5 gap-1">
          {[
            { id: 'linear', label: 'Linear' },
            { id: 'contrast', label: 'Contrast' },
            { id: 'film', label: 'Film' },
            { id: 'vintage', label: 'Vintage' },
            { id: 'dramatic', label: 'Dramatic' }
          ].map(preset => (
            <button
              key={preset.id}
              onClick={() => loadPreset(preset.id as 'linear' | 'contrast' | 'film' | 'vintage' | 'dramatic')}
              className="px-2 py-1.5 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Advanced Options */}
      {showAdvanced && (
        <div className="space-y-4 border-t border-gray-700 pt-4">

          {/* Curve Type */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Interpolation</label>
            <select
              value={params.baseCurveType}
              onChange={(e) => updateParams({ baseCurveType: parseInt(e.target.value) })}
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-purple-400 focus:outline-none"
            >
              <option value={0}>Linear</option>
              <option value={1}>Smooth</option>
              <option value={2}>Monotonic</option>
            </select>
          </div>

          {/* Color Preservation */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Color Preservation</label>
            <select
              value={params.preserveColors}
              onChange={(e) => updateParams({ preserveColors: parseInt(e.target.value) })}
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-purple-400 focus:outline-none"
            >
              <option value={0}>None</option>
              <option value={1}>Luminance</option>
              <option value={2}>Max RGB</option>
              <option value={3}>Average RGB</option>
            </select>
          </div>

          {/* Exposure Fusion */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Exposure Fusion: {params.exposureFusion.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={params.exposureFusion}
              onChange={(e) => updateParams({ exposureFusion: parseFloat(e.target.value) })}
              className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer visible-track"
            />
          </div>

          {/* Exposure Stops */}
          {params.exposureFusion > 0 && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Fusion Range: {params.exposureStops.toFixed(1)} stops
              </label>
              <input
                type="range"
                min="0.1"
                max="4"
                step="0.1"
                value={params.exposureStops}
                onChange={(e) => updateParams({ exposureStops: parseFloat(e.target.value) })}
                className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer visible-track"
              />
            </div>
          )}

          {/* Auto Adjustments */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" />
              <span className="text-sm text-white">Auto Adjustments</span>
            </div>

            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={params.autoLevels}
                  onChange={(e) => updateParams({ autoLevels: e.target.checked })}
                  className="rounded border-gray-600 text-purple-400 focus:ring-purple-400 focus:ring-2"
                />
                <span className="ml-2 text-xs text-gray-300">Auto Levels</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={params.autoContrast}
                  onChange={(e) => updateParams({ autoContrast: e.target.checked })}
                  className="rounded border-gray-600 text-purple-400 focus:ring-purple-400 focus:ring-2"
                />
                <span className="ml-2 text-xs text-gray-300">Auto Contrast</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Channel Info */}
      <div className="text-xs text-gray-500 space-y-1">
        <div>Active Channel: <span className="text-white">{activeChannel.toUpperCase()}</span></div>
        <div>
          Control Points: <span className="text-white">
            {activeChannel === 'base' ? params.baseCurveNodes : params.rgbCurveNodes[activeChannel]}
          </span>
        </div>
        {params.exposureFusion > 0 && (
          <div>Fusion: <span className="text-yellow-400">Active</span></div>
        )}
      </div>
    </div>
  );
};