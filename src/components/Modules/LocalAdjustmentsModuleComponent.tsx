import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Brush, Move, Circle, Layers, Trash2, Eye, EyeOff, Plus, Settings } from 'lucide-react';
import {
  LocalAdjustmentLayer,
  LocalAdjustmentParams,
  BrushParameters,
  MaskGeometry
} from '../../modules/LocalAdjustmentsModule';
import { logger } from '../../utils/Logger';
import { useRegisterModuleCardActions, type RegisterModuleCardActions } from '../Controls/moduleCardActions';
import { SectionLabel } from '../Controls/SectionLabel';
import { ChipButton } from '../Controls/ChipButton';
import { SliderRow } from '../Controls/SliderRow';
import { Segmented } from '../Controls/Segmented';

interface LocalAdjustmentsModuleComponentProps {
  parameters: LocalAdjustmentParams;
  brushParams: BrushParameters;
  layers: LocalAdjustmentLayer[];
  activeLayerId: string | null;
  onParametersChange: (params: Partial<LocalAdjustmentParams>) => void;
  onBrushParamsChange: (params: Partial<BrushParameters>) => void;
  onCreateLayer: (type: LocalAdjustmentLayer['type'], name: string) => void;
  onRemoveLayer: (layerId: string) => void;
  onToggleLayer: (layerId: string, enabled: boolean) => void;
  onSetActiveLayer: (layerId: string) => void;
  onUpdateLayerOpacity: (layerId: string, opacity: number) => void;
  geometry?: MaskGeometry;
  onUpdateGeometry?: (geom: MaskGeometry) => void;
  className?: string;
  /** Surfaces this module's Reset to the unified card header (Task 2). */
  onRegisterActions?: RegisterModuleCardActions;
}

const DEFAULT_GEOMETRY: MaskGeometry = {
  type: 'radial', centerX: 0.5, centerY: 0.5, radiusX: 0.3, radiusY: 0.3,
  startX: 0.5, startY: 0.15, endX: 0.5, endY: 0.85, feather: 0.5, invert: false,
};

type ToolType = 'brush' | 'eraser' | 'linear_gradient' | 'radial_gradient' | 'parametric';
type TabType = 'tools' | 'layers' | 'adjustments' | 'masking';

const TAB_OPTIONS: { value: TabType; label: React.ReactNode }[] = [
  { value: 'tools', label: <span className="flex items-center" style={{ gap: 4 }}><Brush size={12} />Tools</span> },
  { value: 'layers', label: <span className="flex items-center" style={{ gap: 4 }}><Layers size={12} />Layers</span> },
  { value: 'adjustments', label: <span className="flex items-center" style={{ gap: 4 }}><Settings size={12} />Adjust</span> },
  { value: 'masking', label: <span className="flex items-center" style={{ gap: 4 }}><Circle size={12} />Mask</span> },
];

const TOOL_OPTIONS: { key: ToolType; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { key: 'brush', label: 'Brush', icon: Brush },
  { key: 'eraser', label: 'Eraser', icon: Circle },
  { key: 'linear_gradient', label: 'Linear', icon: Move },
  { key: 'radial_gradient', label: 'Radial', icon: Circle },
];

const NEW_LAYER_OPTIONS: { key: LocalAdjustmentLayer['type']; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { key: 'brush', label: 'Brush', icon: Brush },
  { key: 'linear_gradient', label: 'Linear', icon: Move },
  { key: 'radial_gradient', label: 'Radial', icon: Circle },
  { key: 'parametric', label: 'Parametric', icon: Settings },
];

export const LocalAdjustmentsModuleComponent: React.FC<LocalAdjustmentsModuleComponentProps> = ({
  parameters,
  brushParams,
  layers,
  activeLayerId,
  onParametersChange,
  onBrushParamsChange,
  onCreateLayer,
  onRemoveLayer,
  onToggleLayer,
  onSetActiveLayer,
  onUpdateLayerOpacity,
  geometry,
  onUpdateGeometry,
  className = '',
  onRegisterActions
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('tools');
  const [localGeom, setLocalGeom] = useState<MaskGeometry>(geometry ?? DEFAULT_GEOMETRY);
  useEffect(() => { if (geometry) setLocalGeom(geometry); }, [geometry]);
  const updateGeom = useCallback((patch: Partial<MaskGeometry>) => {
    setLocalGeom(prev => {
      const next = { ...prev, ...patch };
      onUpdateGeometry?.(next);
      return next;
    });
  }, [onUpdateGeometry]);

  // Card header (Task 2): Reset ↺ zeroes the active layer's adjustments — lifted
  // verbatim from the old inner-header button (no auto function).
  const handleResetAll = useCallback(() => {
    onParametersChange({
      exposure: 0, shadows: 0, highlights: 0, temperature: 0, tint: 0,
      saturation: 0, vibrance: 0, contrast: 0, brightness: 0, clarity: 0,
      hueShift: 0, colorBalance: [0, 0, 0],
    });
  }, [onParametersChange]);
  useRegisterModuleCardActions(onRegisterActions, { reset: handleResetAll });
  const [activeTool, setActiveTool] = useState<ToolType>('brush');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showNewLayerDialog, setShowNewLayerDialog] = useState(false);
  const [localParams, setLocalParams] = useState<LocalAdjustmentParams>(parameters);
  const [localBrushParams, setLocalBrushParams] = useState<BrushParameters>(brushParams);

  const paramsRef = useRef<LocalAdjustmentParams>(parameters);
  const brushParamsRef = useRef<BrushParameters>(brushParams);

  const activeLayer = layers.find(layer => layer.id === activeLayerId);

  // Keep refs in sync
  useEffect(() => {
    paramsRef.current = localParams;
  }, [localParams]);

  useEffect(() => {
    brushParamsRef.current = localBrushParams;
  }, [localBrushParams]);

  // Sync external changes
  useEffect(() => {
    setLocalParams(parameters);
  }, [parameters]);

  useEffect(() => {
    setLocalBrushParams(brushParams);
  }, [brushParams]);

  // Real-time parameter update for smooth slider dragging
  const handleParameterChangeRealTime = useCallback((key: keyof LocalAdjustmentParams, value: number | number[]) => {
    const newParams = { ...paramsRef.current, [key]: value };
    paramsRef.current = newParams;
    setLocalParams(newParams);
    onParametersChange({ [key]: value });
  }, [onParametersChange]);

  const handleParameterChange = useCallback((key: keyof LocalAdjustmentParams, value: number | number[]) => {
    handleParameterChangeRealTime(key, value);
    logger.debug(`LocalAdjustments ${key} updated:`, value);
  }, [handleParameterChangeRealTime]);

  // Real-time brush parameter update for smooth slider dragging
  const handleBrushParamChangeRealTime = useCallback((key: keyof BrushParameters, value: number) => {
    const newParams = { ...brushParamsRef.current, [key]: value };
    brushParamsRef.current = newParams;
    setLocalBrushParams(newParams);
    onBrushParamsChange({ [key]: value });
  }, [onBrushParamsChange]);

  const handleBrushParamChange = useCallback((key: keyof BrushParameters, value: number) => {
    handleBrushParamChangeRealTime(key, value);
    logger.debug(`Brush ${key} updated:`, value);
  }, [handleBrushParamChangeRealTime]);

  const createNewLayer = useCallback((type: LocalAdjustmentLayer['type']) => {
    const defaultNames = {
      brush: 'Brush Adjustment',
      linear_gradient: 'Linear Gradient',
      radial_gradient: 'Radial Gradient',
      parametric: 'Parametric Mask'
    };

    const baseName = defaultNames[type];
    const existingCount = layers.filter(l => l.name.startsWith(baseName)).length;
    const name = existingCount > 0 ? `${baseName} ${existingCount + 1}` : baseName;

    onCreateLayer(type, name);
    setShowNewLayerDialog(false);
  }, [layers, onCreateLayer]);

  // Thin wrapper around SliderRow for the mask-geometry rows (Center/Radius/Start/End/Feather):
  // 2-decimal display, double-click resets to the given DEFAULT_GEOMETRY field.
  const geomRow = (label: string, val: number, min: number, max: number, step: number, defaultVal: number, onCh: (v: number) => void) => (
    <SliderRow
      key={label}
      label={label}
      value={val}
      defaultValue={defaultVal}
      min={min}
      max={max}
      step={step}
      formatValue={(v) => v.toFixed(2)}
      onChange={onCh}
    />
  );

  const renderGeometry = () => {
    if (!activeLayer || (activeLayer.type !== 'radial_gradient' && activeLayer.type !== 'linear_gradient')) {
      return (
        <div className="text-xs" style={{ color: 'var(--glass-text-muted)' }}>
          Add a Radial or Linear layer in the <strong>Layers</strong> tab to place a region, then shape it here and adjust its look in the <strong>Adjust</strong> tab.
        </div>
      );
    }
    const isRadial = activeLayer.type === 'radial_gradient';
    return (
      <div className="flex flex-col" style={{ gap: 12 }}>
        <SectionLabel>{isRadial ? 'Radial Shape (circle / oval)' : 'Linear Gradient'}</SectionLabel>
        {isRadial ? (
          <>
            {geomRow('Center X', localGeom.centerX, 0, 1, 0.01, DEFAULT_GEOMETRY.centerX, (v) => updateGeom({ centerX: v }))}
            {geomRow('Center Y', localGeom.centerY, 0, 1, 0.01, DEFAULT_GEOMETRY.centerY, (v) => updateGeom({ centerY: v }))}
            {geomRow('Radius X', localGeom.radiusX, 0.02, 1, 0.01, DEFAULT_GEOMETRY.radiusX, (v) => updateGeom({ radiusX: v }))}
            {geomRow('Radius Y', localGeom.radiusY, 0.02, 1, 0.01, DEFAULT_GEOMETRY.radiusY, (v) => updateGeom({ radiusY: v }))}
            {geomRow('Feather', localGeom.feather, 0.01, 1, 0.01, DEFAULT_GEOMETRY.feather, (v) => updateGeom({ feather: v }))}
          </>
        ) : (
          <>
            {geomRow('Start X', localGeom.startX, 0, 1, 0.01, DEFAULT_GEOMETRY.startX, (v) => updateGeom({ startX: v }))}
            {geomRow('Start Y', localGeom.startY, 0, 1, 0.01, DEFAULT_GEOMETRY.startY, (v) => updateGeom({ startY: v }))}
            {geomRow('End X', localGeom.endX, 0, 1, 0.01, DEFAULT_GEOMETRY.endX, (v) => updateGeom({ endX: v }))}
            {geomRow('End Y', localGeom.endY, 0, 1, 0.01, DEFAULT_GEOMETRY.endY, (v) => updateGeom({ endY: v }))}
            {geomRow('Feather', localGeom.feather, 0.01, 1, 0.01, DEFAULT_GEOMETRY.feather, (v) => updateGeom({ feather: v }))}
          </>
        )}
        <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--glass-text-label)' }}>
          <input
            type="checkbox"
            checked={localGeom.invert}
            onChange={(e) => updateGeom({ invert: e.target.checked })}
            style={{ accentColor: 'var(--accent)' }}
          />
          Invert mask
        </label>
      </div>
    );
  };

  const renderToolsTab = () => (
    <div className="flex flex-col" style={{ gap: 16 }}>
      <div className="flex flex-col" style={{ gap: 10 }}>
        <SectionLabel>Tools</SectionLabel>
        <div className="grid grid-cols-2" style={{ gap: 6 }}>
          {TOOL_OPTIONS.map(({ key, label, icon: Icon }) => (
            <ChipButton key={key} className="flex items-center gap-1.5" active={activeTool === key} onClick={() => setActiveTool(key)}>
              <Icon size={13} />
              {label}
            </ChipButton>
          ))}
        </div>
      </div>

      {(activeTool === 'brush' || activeTool === 'eraser') && (
        <div className="flex flex-col" style={{ gap: 12 }}>
          <SectionLabel>Brush Settings</SectionLabel>

          <SliderRow
            label="Size" value={localBrushParams.size} defaultValue={50} min={1} max={500} step={1}
            formatValue={(v) => `${Math.round(v)} px`}
            trackBackground="linear-gradient(to right, #6b7280, #3b82f6, #8b5cf6)"
            onChange={(v) => handleBrushParamChange('size', v)}
          />
          <SliderRow
            label="Hardness" value={localBrushParams.hardness} defaultValue={0.8} min={0} max={1} step={0.01}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            trackBackground="linear-gradient(to right, #9ca3af, #1f2937)"
            onChange={(v) => handleBrushParamChange('hardness', v)}
          />
          <SliderRow
            label="Opacity" value={localBrushParams.opacity} defaultValue={1.0} min={0} max={1} step={0.01}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            trackBackground="linear-gradient(to right, rgba(107, 114, 128, 0.3), rgba(107, 114, 128, 1))"
            onChange={(v) => handleBrushParamChange('opacity', v)}
          />
          <SliderRow
            label="Flow" value={localBrushParams.flow} defaultValue={1.0} min={0} max={1} step={0.01}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            trackBackground="linear-gradient(to right, #6b7280, #10b981)"
            onChange={(v) => handleBrushParamChange('flow', v)}
          />
        </div>
      )}

      <div className="flex flex-col" style={{ gap: 12, paddingTop: 4, borderTop: '1px solid var(--glass-border)' }}>
        <SectionLabel>Shape &amp; Position</SectionLabel>
        {renderGeometry()}
      </div>
    </div>
  );

  const renderLayersTab = () => (
    <div className="flex flex-col" style={{ gap: 12 }}>
      <div className="flex items-center justify-between">
        <SectionLabel className="flex-1">Layers</SectionLabel>
        <ChipButton className="flex items-center gap-1.5 flex-shrink-0" onClick={() => setShowNewLayerDialog(true)}>
          <Plus size={12} />
          New
        </ChipButton>
      </div>

      <div className="flex flex-col max-h-60 overflow-y-auto" style={{ gap: 6 }}>
        {layers.map((layer) => (
          <div
            key={layer.id}
            className="p-2 rounded"
            style={{
              background: layer.id === activeLayerId ? 'var(--accent-soft)' : 'rgba(255,255,255,.04)',
              border: `1px solid ${layer.id === activeLayerId ? 'var(--accent-ring)' : 'rgba(255,255,255,.1)'}`,
              borderRadius: 9,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => onSetActiveLayer(layer.id)}
                className="text-xs font-medium flex-1 text-left"
                style={{ color: 'var(--glass-text-label)' }}
              >
                {layer.name}
              </button>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => onToggleLayer(layer.id, !layer.enabled)}
                  className="p-1 rounded"
                  style={{ color: layer.enabled ? 'var(--glass-text-title)' : 'var(--glass-text-muted)' }}
                >
                  {layer.enabled ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => onRemoveLayer(layer.id)}
                  className="p-1"
                  style={{ color: '#f87171' }}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="text-xs mb-2" style={{ color: 'var(--glass-text-muted)' }}>
              {layer.type.replace('_', ' ')} • {layer.blendMode}
            </div>

            <SliderRow
              label="Opacity" value={layer.opacity} defaultValue={1.0} min={0} max={1} step={0.01}
              formatValue={(v) => `${Math.round(v * 100)}%`}
              trackBackground="linear-gradient(to right, rgba(107, 114, 128, 0.3), rgba(107, 114, 128, 1))"
              onChange={(v) => onUpdateLayerOpacity(layer.id, v)}
            />
          </div>
        ))}

        {layers.length === 0 && (
          <div className="text-xs text-center py-4" style={{ color: 'var(--glass-text-muted)' }}>
            No layers yet. Click "New" to create your first adjustment layer.
          </div>
        )}
      </div>

      {showNewLayerDialog && (
        <div className="flex flex-col" style={{ gap: 10, padding: 12, borderRadius: 10, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.1)' }}>
          <SectionLabel>Create New Layer</SectionLabel>

          <div className="grid grid-cols-2" style={{ gap: 6 }}>
            {NEW_LAYER_OPTIONS.map(({ key, label, icon: Icon }) => (
              <ChipButton key={key} className="flex items-center gap-1.5" onClick={() => createNewLayer(key)}>
                <Icon size={13} />
                {label}
              </ChipButton>
            ))}
          </div>

          <ChipButton dashed onClick={() => setShowNewLayerDialog(false)}>
            Cancel
          </ChipButton>
        </div>
      )}
    </div>
  );

  const renderAdjustmentsTab = () => (
    <div className="flex flex-col" style={{ gap: 12 }}>
      <div className="flex items-center justify-between">
        <SectionLabel className="flex-1">Adjustments</SectionLabel>
        {activeLayer && (
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--glass-text-muted)' }}>{activeLayer.name}</span>
        )}
      </div>

      {!activeLayer ? (
        <div className="text-xs text-center py-4" style={{ color: 'var(--glass-text-muted)' }}>
          Select or create a layer to adjust its parameters.
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: 16 }}>
          {/* Mask feather (also editable in the Tools > Shape section) */}
          {(activeLayer.type === 'radial_gradient' || activeLayer.type === 'linear_gradient') && (
            <div className="flex flex-col" style={{ gap: 8, paddingBottom: 8, borderBottom: '1px solid var(--glass-border)' }}>
              <SectionLabel>Mask Feather</SectionLabel>
              {geomRow('Feather', localGeom.feather, 0.01, 1, 0.01, DEFAULT_GEOMETRY.feather, (v) => updateGeom({ feather: v }))}
            </div>
          )}

          {/* Exposure */}
          <div className="flex flex-col" style={{ gap: 12 }}>
            <SectionLabel>Exposure</SectionLabel>
            <SliderRow
              label="Exposure" value={localParams.exposure} defaultValue={0} min={-4} max={4} step={0.01}
              formatValue={(v) => `${v.toFixed(2)} EV`}
              trackBackground="linear-gradient(to right, #000000, #6b7280, #ffffff)"
              onChange={(v) => handleParameterChange('exposure', v)}
            />
            <SliderRow
              label="Shadows" value={localParams.shadows} defaultValue={0} min={-100} max={100} step={1}
              trackBackground="linear-gradient(to right, #000000, #6b7280)"
              onChange={(v) => handleParameterChange('shadows', v)}
            />
            <SliderRow
              label="Highlights" value={localParams.highlights} defaultValue={0} min={-100} max={100} step={1}
              trackBackground="linear-gradient(to right, #6b7280, #ffffff)"
              onChange={(v) => handleParameterChange('highlights', v)}
            />
          </div>

          {/* Color */}
          <div className="flex flex-col" style={{ gap: 12 }}>
            <SectionLabel>Color</SectionLabel>
            <SliderRow
              label="Temperature" value={localParams.temperature} defaultValue={0} min={-100} max={100} step={1}
              trackBackground="linear-gradient(to right, #60a5fa, #e5e7eb, #fb923c)"
              onChange={(v) => handleParameterChange('temperature', v)}
            />
            <SliderRow
              label="Tint" value={localParams.tint} defaultValue={0} min={-100} max={100} step={1}
              trackBackground="linear-gradient(to right, #f472b6, #9ca3af, #4ade80)"
              onChange={(v) => handleParameterChange('tint', v)}
            />
            <SliderRow
              label="Saturation" value={localParams.saturation} defaultValue={0} min={-100} max={100} step={1}
              trackBackground="linear-gradient(to right, #6b7280, #3b82f6, #10b981, #eab308, #f97316, #ef4444)"
              onChange={(v) => handleParameterChange('saturation', v)}
            />
            <SliderRow
              label="Vibrance" value={localParams.vibrance} defaultValue={0} min={-100} max={100} step={1}
              trackBackground="linear-gradient(to right, #6b7280, #ef4444, #f97316, #eab308, #10b981, #3b82f6, #8b5cf6)"
              onChange={(v) => handleParameterChange('vibrance', v)}
            />
          </div>

          {/* Tone */}
          <div className="flex flex-col" style={{ gap: 12 }}>
            <SectionLabel>Tone</SectionLabel>
            <SliderRow
              label="Contrast" value={localParams.contrast} defaultValue={0} min={-100} max={100} step={1}
              trackBackground="linear-gradient(to right, #6b7280, #ffffff)"
              onChange={(v) => handleParameterChange('contrast', v)}
            />
            <SliderRow
              label="Brightness" value={localParams.brightness} defaultValue={0} min={-100} max={100} step={1}
              trackBackground="linear-gradient(to right, #000000, #6b7280, #ffffff)"
              onChange={(v) => handleParameterChange('brightness', v)}
            />
            <SliderRow
              label="Clarity" value={localParams.clarity} defaultValue={0} min={-100} max={100} step={1}
              trackBackground="linear-gradient(to right, #6b7280, #10b981)"
              onChange={(v) => handleParameterChange('clarity', v)}
            />
          </div>

          {/* Advanced */}
          <div className="flex flex-col" style={{ gap: 12, paddingTop: 4, borderTop: '1px solid var(--glass-border)' }}>
            <ChipButton dashed onClick={() => setShowAdvanced(!showAdvanced)}>
              {showAdvanced ? 'Hide' : 'Show'} advanced settings
            </ChipButton>

            {showAdvanced && (
              <div className="flex flex-col" style={{ gap: 12, paddingLeft: 8, borderLeft: '2px solid rgba(255,255,255,.1)' }}>
                <SliderRow
                  label="Hue Shift" value={localParams.hueShift} defaultValue={0} min={-180} max={180} step={1}
                  formatValue={(v) => `${v}°`}
                  trackBackground="linear-gradient(to right, #ef4444, #f97316, #eab308, #10b981, #3b82f6, #8b5cf6, #ef4444)"
                  onChange={(v) => handleParameterChange('hueShift', v)}
                />

                <SectionLabel>Color Balance</SectionLabel>
                <SliderRow
                  label="Red" value={localParams.colorBalance[0]} defaultValue={0} min={-1} max={1} step={0.01}
                  formatValue={(v) => v.toFixed(2)}
                  trackBackground="linear-gradient(to right, #00ffff, #6b7280, #ef4444)"
                  onChange={(v) => {
                    const newBalance = [...localParams.colorBalance];
                    newBalance[0] = v;
                    handleParameterChange('colorBalance', newBalance);
                  }}
                />
                <SliderRow
                  label="Green" value={localParams.colorBalance[1]} defaultValue={0} min={-1} max={1} step={0.01}
                  formatValue={(v) => v.toFixed(2)}
                  trackBackground="linear-gradient(to right, #f472b6, #6b7280, #10b981)"
                  onChange={(v) => {
                    const newBalance = [...localParams.colorBalance];
                    newBalance[1] = v;
                    handleParameterChange('colorBalance', newBalance);
                  }}
                />
                <SliderRow
                  label="Blue" value={localParams.colorBalance[2]} defaultValue={0} min={-1} max={1} step={0.01}
                  formatValue={(v) => v.toFixed(2)}
                  trackBackground="linear-gradient(to right, #eab308, #6b7280, #3b82f6)"
                  onChange={(v) => {
                    const newBalance = [...localParams.colorBalance];
                    newBalance[2] = v;
                    handleParameterChange('colorBalance', newBalance);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const renderMaskingTab = () => (
    <div className="flex flex-col" style={{ gap: 12 }}>
      <SectionLabel>Parametric Masking</SectionLabel>

      {!activeLayer || activeLayer.type !== 'parametric' ? (
        <div className="text-xs text-center py-4" style={{ color: 'var(--glass-text-muted)' }}>
          Create or select a parametric layer to adjust masking parameters.
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: 8 }}>
          <span className="text-xs font-medium" style={{ color: 'var(--glass-text-label)' }}>Luminance Range</span>
          <div className="text-xs" style={{ color: 'var(--glass-text-muted)' }}>
            Parametric masking controls will be available when a parametric layer is selected.
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={`flex flex-col ${className}`} style={{ gap: 16 }}>
      {/* Tab Navigation */}
      <Segmented options={TAB_OPTIONS} value={activeTab} onChange={setActiveTab} className="w-full" />

      {/* Tab Content */}
      <div>
        {activeTab === 'tools' && renderToolsTab()}
        {activeTab === 'layers' && renderLayersTab()}
        {activeTab === 'adjustments' && renderAdjustmentsTab()}
        {activeTab === 'masking' && renderMaskingTab()}
      </div>

      {/* Active Tool Indicator */}
      <div className="flex items-center" style={{ gap: 6, fontSize: 11, paddingTop: 12, borderTop: '1px solid var(--glass-border)', color: 'var(--glass-text-muted)' }}>
        <span>Active Tool:</span>
        <span style={{ color: 'var(--accent)', fontWeight: 500 }}>
          {activeTool.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
        </span>
      </div>
    </div>
  );
};

export default LocalAdjustmentsModuleComponent;
