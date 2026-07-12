import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Settings, Zap } from 'lucide-react';
import { ToneCurveModule, ToneCurveParams } from '../../modules/ToneCurveModule';
import { logger } from '../../utils/Logger';
import { autoAdjustService } from '../../services/AutoAdjustService';
import { imageService } from '../../services/ImageService';
import { notificationService } from '../../services/NotificationService';
import { guardDeveloping } from '../../utils/developingGuard';
import { SliderRow } from '../Controls/SliderRow';
import { Segmented } from '../Controls/Segmented';
import { ChipButton } from '../Controls/ChipButton';
import { useRegisterModuleCardActions, type RegisterModuleCardActions } from '../Controls/moduleCardActions';

interface ToneCurveModuleComponentProps {
  module: ToneCurveModule;
  onParamsChange: (params: ToneCurveParams) => void;
  /** Surfaces this module's Auto/Reset to the unified card header (Task 2). */
  onRegisterActions?: RegisterModuleCardActions;
}

type CurveChannel = 'base' | 'red' | 'green' | 'blue';

const CHANNEL_OPTIONS = [
  { value: 'base' as CurveChannel, label: 'RGB' },
  { value: 'red' as CurveChannel, label: 'R' },
  { value: 'green' as CurveChannel, label: 'G' },
  { value: 'blue' as CurveChannel, label: 'B' },
];

const CURVE_PRESETS = [
  { id: 'linear', label: 'Linear' },
  { id: 'contrast', label: 'Contrast' },
  { id: 'film', label: 'Film' },
  { id: 'vintage', label: 'Vintage' },
  { id: 'dramatic', label: 'Dramatic' },
] as const;

export const ToneCurveModuleComponent: React.FC<ToneCurveModuleComponentProps> = ({
  module,
  onParamsChange,
  onRegisterActions
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
    ctx.fillStyle = '#0a0a0b';
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    // Draw grid
    ctx.strokeStyle = '#1d1d20';
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
    ctx.strokeStyle = '#2c2c30';
    ctx.beginPath();
    ctx.moveTo(0, canvasSize);
    ctx.lineTo(canvasSize, 0);
    ctx.stroke();
    ctx.setLineDash([]);

    // Function to get channel color
    const getChannelColor = (channel: CurveChannel): string => {
      switch (channel) {
        case 'base': return '#f0f0f2';
        case 'red': return '#ef4444';
        case 'green': return '#22c55e';
        case 'blue': return '#3b82f6';
        default: return '#f0f0f2';
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
          ctx.strokeStyle = '#0a0a0b';
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

  // Image-aware auto tone curve — lifted verbatim from the old inner-header ⚡
  // button so the card header's Auto keeps identical semantics (Task 2).
  const handleAuto = useCallback(() => {
    // Reads currentImage pixels directly — during the progressive-open developing window
    // that's the graded preview, not the neutral full-res base (L3 review round 2).
    if (guardDeveloping(notificationService.info.bind(notificationService), 'Auto Tone Curve')) return;
    const img = imageService.getCurrentImage();
    if (!img) return;
    const stats = autoAdjustService.analyse(img.data, img.width, img.height);
    const computed = autoAdjustService.autoToneCurve(stats);
    module.setParams(computed as ToneCurveParams);
    const newParams = module.getParams();
    setParams(newParams);
    onParamsChange(newParams);
  }, [module, onParamsChange]);

  // Reset ↺ keeps its original per-active-channel semantics (resetCurve).
  useRegisterModuleCardActions(onRegisterActions, { auto: handleAuto, reset: resetCurve });

  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      {/* Channel Selection */}
      <Segmented options={CHANNEL_OPTIONS} value={activeChannel} onChange={setActiveChannel} className="w-full" />

      {/* Curve Editor, framed to the card idiom */}
      <div
        style={{
          borderRadius: 10,
          border: '1px solid var(--glass-border)',
          background: 'rgba(0,0,0,.25)',
          padding: 10,
        }}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--glass-text-secondary)' }}>
            {activeChannel === 'base'
              ? `RGB · ${params.baseCurveNodes} point${params.baseCurveNodes === 1 ? '' : 's'}`
              : `${activeChannel.toUpperCase()} Channel`}
          </span>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="inline-flex items-center justify-center"
            style={{
              padding: 4,
              borderRadius: 6,
              background: showAdvanced ? 'var(--accent-soft)' : 'transparent',
              color: showAdvanced ? 'var(--accent)' : 'var(--glass-text-muted)',
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
            className="w-full h-64 rounded cursor-crosshair"
            style={{ backgroundColor: '#0a0a0b', border: '1px solid var(--glass-border)' }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
            onDoubleClick={handleCanvasDoubleClick}
          />

          {/* Instructions */}
          <div className="absolute bottom-2 left-2" style={{ fontSize: 10, color: 'var(--glass-text-muted)' }}>
            Click: Add point • Drag: Move point • Double-click: Remove point
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 11.5, color: 'var(--glass-text-label)' }}>Quick Actions</span>
        <ChipButton
          onClick={() => updateParams({ autoLevels: true, autoContrast: true })}
          title="Automatically adjust levels and contrast based on histogram"
        >
          <Zap className="w-3 h-3" style={{ marginRight: 6 }} /> Auto Levels
        </ChipButton>
      </div>

      {/* Curve Presets */}
      <div className="grid grid-cols-5" style={{ gap: 5 }}>
        {CURVE_PRESETS.map(preset => (
          <ChipButton
            key={preset.id}
            onClick={() => loadPreset(preset.id)}
            className="w-full"
          >
            {preset.label}
          </ChipButton>
        ))}
      </div>

      {/* Advanced Options */}
      {showAdvanced && (
        <div className="flex flex-col" style={{ gap: 12, paddingTop: 12, borderTop: '1px solid var(--glass-border)' }}>
          {/* Curve Type */}
          <div className="flex flex-col" style={{ gap: 6 }}>
            <label style={{ fontSize: 11.5, color: 'var(--glass-text-label)' }}>Interpolation</label>
            <select
              value={params.baseCurveType}
              onChange={(e) => updateParams({ baseCurveType: parseInt(e.target.value) })}
              className="w-full rounded"
              style={{
                fontSize: 12,
                padding: '6px 10px',
                background: 'rgba(255,255,255,.04)',
                color: 'var(--glass-text-title)',
                border: '1px solid var(--glass-border)',
              }}
            >
              <option value={0}>Linear</option>
              <option value={1}>Smooth</option>
              <option value={2}>Monotonic</option>
            </select>
          </div>

          {/* Color Preservation */}
          <div className="flex flex-col" style={{ gap: 6 }}>
            <label style={{ fontSize: 11.5, color: 'var(--glass-text-label)' }}>Color Preservation</label>
            <select
              value={params.preserveColors}
              onChange={(e) => updateParams({ preserveColors: parseInt(e.target.value) })}
              className="w-full rounded"
              style={{
                fontSize: 12,
                padding: '6px 10px',
                background: 'rgba(255,255,255,.04)',
                color: 'var(--glass-text-title)',
                border: '1px solid var(--glass-border)',
              }}
            >
              <option value={0}>None</option>
              <option value={1}>Luminance</option>
              <option value={2}>Max RGB</option>
              <option value={3}>Average RGB</option>
            </select>
          </div>

          <SliderRow
            label="Exposure Fusion"
            value={params.exposureFusion}
            defaultValue={0}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => updateParams({ exposureFusion: v })}
            formatValue={(v) => v.toFixed(2)}
            trackBackground="linear-gradient(to right, #6b7280, #8b5cf6)"
          />

          {params.exposureFusion > 0 && (
            <SliderRow
              label="Fusion Range"
              value={params.exposureStops}
              defaultValue={1.0}
              min={0.1}
              max={4}
              step={0.1}
              onChange={(v) => updateParams({ exposureStops: v })}
              formatValue={(v) => `${v.toFixed(1)} stops`}
              trackBackground="linear-gradient(to right, #6b7280, #f59e0b)"
            />
          )}

          {/* Auto Adjustments */}
          <div className="flex flex-col" style={{ gap: 8 }}>
            <div className="flex items-center" style={{ gap: 6 }}>
              <Zap className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 12, color: 'var(--glass-text-title)' }}>Auto Adjustments</span>
            </div>

            <label className="flex items-center" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={params.autoLevels}
                onChange={(e) => updateParams({ autoLevels: e.target.checked })}
              />
              <span style={{ fontSize: 11.5, color: 'var(--glass-text-label)' }}>Auto Levels</span>
            </label>

            <label className="flex items-center" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={params.autoContrast}
                onChange={(e) => updateParams({ autoContrast: e.target.checked })}
              />
              <span style={{ fontSize: 11.5, color: 'var(--glass-text-label)' }}>Auto Contrast</span>
            </label>
          </div>
        </div>
      )}

      {/* Channel Info */}
      <div className="flex flex-col" style={{ gap: 4, fontSize: 10.5, color: 'var(--glass-text-muted)' }}>
        <div>Active Channel: <span style={{ color: 'var(--glass-text-title)' }}>{activeChannel.toUpperCase()}</span></div>
        <div>
          Control Points: <span style={{ color: 'var(--glass-text-title)' }}>
            {activeChannel === 'base' ? params.baseCurveNodes : params.rgbCurveNodes[activeChannel]}
          </span>
        </div>
        {params.exposureFusion > 0 && (
          <div>Fusion: <span style={{ color: 'var(--accent)' }}>Active</span></div>
        )}
      </div>
    </div>
  );
};
