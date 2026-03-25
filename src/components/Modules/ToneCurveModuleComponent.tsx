import React, { useState, useRef, useCallback, useEffect } from 'react';
import { TrendingUp, RotateCcw, Settings, Zap } from 'lucide-react';
import { ToneCurveModule, ToneCurveParams } from '../../modules/ToneCurveModule';
import { logger } from '../../utils/Logger';
import { autoAdjustService } from '../../services/AutoAdjustService';
import { imageService } from '../../services/ImageService';

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
  const paramsRef = useRef<ToneCurveParams>(params);
  const [activeChannel, setActiveChannel] = useState<CurveChannel>('base');
  const [draggedPoint, setDraggedPoint] = useState<{ channel: CurveChannel; index: number } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasSize = 256;

  // Keep ref in sync
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const updateParams = useCallback((newParams: Partial<ToneCurveParams>) => {
    const updatedParams = { ...paramsRef.current, ...newParams };
    paramsRef.current = updatedParams;
    setParams(updatedParams);
    module.setParams(newParams);
    onParamsChange(updatedParams);
    logger.debug('ToneCurve params updated:', newParams);
  }, [module, onParamsChange]);

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
          ...paramsRef.current.rgbCurve,
          [activeChannel]: [{ x: 0, y: 0 }, { x: 1, y: 1 }]
        },
        rgbCurveNodes: {
          ...paramsRef.current.rgbCurveNodes,
          [activeChannel]: 2
        }
      });
    }
  }, [activeChannel, updateParams]);

  const loadPreset = useCallback((preset: 'linear' | 'contrast' | 'film' | 'vintage' | 'dramatic') => {
    module.loadPreset(preset);
    const updatedParams = module.getParams();
    setParams(updatedParams);
    onParamsChange(updatedParams);
  }, [module, onParamsChange]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between pb-2" style={{borderBottom: '1px solid var(--border)'}}>
        <div className="flex items-center gap-2">
          <div className="w-1 h-3 rounded-sm" style={{backgroundColor: 'var(--gray-600)'}} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{color: 'var(--gray-500)', letterSpacing: '0.5px'}}>Controls</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              const img = imageService.getCurrentImage();
              if (!img) return;
              const stats = autoAdjustService.analyse(img.data, img.width, img.height);
              const computed = autoAdjustService.autoToneCurve(stats);
              module.setParams(computed as ToneCurveParams);
              const newParams = module.getParams();
              setParams(newParams);
              onParamsChange(newParams);
            }}
            className="p-1.5 rounded border"
            style={{
              backgroundColor: 'transparent',
              borderColor: 'var(--border)',
              color: 'var(--gray-400)',
              transition: 'var(--transition-fast)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--gray-800)';
              e.currentTarget.style.borderColor = 'var(--border-light)';
              e.currentTarget.style.color = 'var(--white)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--gray-400)';
            }}
            title="Auto adjust tone curve"
          >
            <Zap className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={resetCurve}
            className="p-1.5 rounded border"
            style={{
              backgroundColor: 'transparent',
              borderColor: 'var(--border)',
              color: 'var(--gray-400)',
              transition: 'var(--transition-fast)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--gray-800)';
              e.currentTarget.style.borderColor = 'var(--border-light)';
              e.currentTarget.style.color = 'var(--white)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--gray-400)';
            }}
            title="Reset curve"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Channel Selection */}
      <div className="flex gap-1 rounded-lg p-1" style={{backgroundColor: 'var(--gray-700)'}}>
        {[
          { id: 'base', label: 'RGB', color: 'text-white' },
          { id: 'red', label: 'R', color: 'text-gray-300' },
          { id: 'green', label: 'G', color: 'text-gray-300' },
          { id: 'blue', label: 'B', color: 'text-gray-300' }
        ].map(channel => (
          <button
            key={channel.id}
            onClick={() => setActiveChannel(channel.id as CurveChannel)}
            className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-all ${
              activeChannel === channel.id
                ? 'text-white shadow-sm'
                : `bg-transparent ${channel.color}`
            }`}
            style={{
              backgroundColor: activeChannel === channel.id ? 'var(--gray-600)' : 'transparent'
            }}
            onMouseEnter={(e) => {
              if (activeChannel !== channel.id) {
                e.currentTarget.style.backgroundColor = 'var(--gray-600)';
              }
            }}
            onMouseLeave={(e) => {
              if (activeChannel !== channel.id) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          >
            {channel.label}
          </button>
        ))}
      </div>

      {/* Curve Editor Canvas */}
      <div className="rounded-lg p-4" style={{backgroundColor: 'var(--gray-800)'}}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4" style={{color: 'var(--primary-400)'}} />
            <span className="text-sm" style={{color: 'var(--white)'}}>
              {activeChannel === 'base' ? 'Tone Curve' : `${activeChannel.toUpperCase()} Channel`}
            </span>
          </div>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="p-1 rounded transition-colors"
            style={{
              backgroundColor: showAdvanced ? 'var(--gray-700)' : 'transparent',
              color: showAdvanced ? 'var(--white)' : 'var(--gray-400)'
            }}
            onMouseEnter={(e) => {
              if (!showAdvanced) {
                e.currentTarget.style.backgroundColor = 'var(--gray-700)';
                e.currentTarget.style.color = 'var(--white)';
              }
            }}
            onMouseLeave={(e) => {
              if (!showAdvanced) {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = 'var(--gray-400)';
              }
            }}
            title="Advanced options"
          >
            <Settings className="w-3 h-3" />
          </button>
        </div>

        <div className="relative">
          <canvas
            ref={canvasRef}
            width={canvasSize}
            height={canvasSize}
            className="w-full h-64 rounded border cursor-crosshair"
            style={{backgroundColor: '#1f2937', borderColor: 'var(--border)'}}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
            onDoubleClick={handleCanvasDoubleClick}
          />

          {/* Instructions */}
          <div className="absolute bottom-2 left-2 text-xs" style={{color: 'var(--gray-500)'}}>
            Click: Add point • Drag: Move point • Double-click: Remove point
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Quick Actions</label>
          <button
            onClick={() => {
              updateParams({
                autoLevels: true,
                autoContrast: true
              });
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-all shadow-sm"
            style={{
              background: 'linear-gradient(to right, #8b5cf6, #3b82f6)',
              color: 'var(--white)'
            }}
            title="Automatically adjust levels and contrast based on histogram"
          >
            <Zap className="w-3 h-3" />
            Auto Levels
          </button>
        </div>
      </div>

      {/* Curve Presets */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Presets</label>
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
              className="px-2 py-1.5 text-xs rounded transition-colors"
              style={{
                backgroundColor: 'var(--gray-700)',
                color: 'var(--gray-300)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--gray-600)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--gray-700)';
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Advanced Options */}
      {showAdvanced && (
        <div className="space-y-3 pt-3" style={{borderTop: '1px solid var(--border)'}}>
          {/* Curve Type */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Interpolation</label>
            <select
              value={params.baseCurveType}
              onChange={(e) => updateParams({ baseCurveType: parseInt(e.target.value) })}
              className="w-full text-sm rounded px-3 py-1.5 border"
              style={{
                backgroundColor: 'var(--gray-700)',
                color: 'var(--white)',
                borderColor: 'var(--border)'
              }}
            >
              <option value={0}>Linear</option>
              <option value={1}>Smooth</option>
              <option value={2}>Monotonic</option>
            </select>
          </div>

          {/* Color Preservation */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Color Preservation</label>
            <select
              value={params.preserveColors}
              onChange={(e) => updateParams({ preserveColors: parseInt(e.target.value) })}
              className="w-full text-sm rounded px-3 py-1.5 border"
              style={{
                backgroundColor: 'var(--gray-700)',
                color: 'var(--white)',
                borderColor: 'var(--border)'
              }}
            >
              <option value={0}>None</option>
              <option value={1}>Luminance</option>
              <option value={2}>Max RGB</option>
              <option value={3}>Average RGB</option>
            </select>
          </div>

          {/* Exposure Fusion */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>
                Exposure Fusion
              </label>
              <span className="text-xs font-mono" style={{color: 'var(--gray-400)'}}>{params.exposureFusion.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={params.exposureFusion}
              onChange={(e) => updateParams({ exposureFusion: parseFloat(e.target.value) })}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, #6b7280, #8b5cf6)',
              }}
            />
          </div>

          {/* Exposure Stops */}
          {params.exposureFusion > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>
                  Fusion Range
                </label>
                <span className="text-xs font-mono" style={{color: 'var(--gray-400)'}}>{params.exposureStops.toFixed(1)} stops</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="4"
                step="0.1"
                value={params.exposureStops}
                onChange={(e) => updateParams({ exposureStops: parseFloat(e.target.value) })}
                className="slider w-full"
                style={{
                  background: 'linear-gradient(to right, #6b7280, #f59e0b)',
                }}
              />
            </div>
          )}

          {/* Auto Adjustments */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Zap className="w-4 h-4" style={{color: 'var(--yellow-400)'}} />
              <span className="text-sm" style={{color: 'var(--white)'}}>Auto Adjustments</span>
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={params.autoLevels}
                onChange={(e) => updateParams({ autoLevels: e.target.checked })}
                className="rounded"
                style={{borderColor: 'var(--border)'}}
              />
              <span className="text-xs" style={{color: 'var(--gray-300)'}}>Auto Levels</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={params.autoContrast}
                onChange={(e) => updateParams({ autoContrast: e.target.checked })}
                className="rounded"
                style={{borderColor: 'var(--border)'}}
              />
              <span className="text-xs" style={{color: 'var(--gray-300)'}}>Auto Contrast</span>
            </label>
          </div>
        </div>
      )}

      {/* Channel Info */}
      <div className="text-xs space-y-1" style={{color: 'var(--gray-500)'}}>
        <div>Active Channel: <span style={{color: 'var(--white)'}}>{activeChannel.toUpperCase()}</span></div>
        <div>
          Control Points: <span style={{color: 'var(--white)'}}>
            {activeChannel === 'base' ? params.baseCurveNodes : params.rgbCurveNodes[activeChannel]}
          </span>
        </div>
        {params.exposureFusion > 0 && (
          <div>Fusion: <span style={{color: 'var(--yellow-400)'}}>Active</span></div>
        )}
      </div>
    </div>
  );
};
