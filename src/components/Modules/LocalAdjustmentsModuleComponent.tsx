import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Brush, Move, Circle, Layers, Trash2, Eye, EyeOff, Plus, Settings, RotateCcw } from 'lucide-react';
import {
  LocalAdjustmentLayer,
  LocalAdjustmentParams,
  BrushParameters,
  MaskGeometry
} from '../../modules/LocalAdjustmentsModule';
import { DelayedInputControl } from '../Controls/DelayedInputControl';
import { logger } from '../../utils/Logger';

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
}

const DEFAULT_GEOMETRY: MaskGeometry = {
  type: 'radial', centerX: 0.5, centerY: 0.5, radiusX: 0.3, radiusY: 0.3,
  startX: 0.5, startY: 0.15, endX: 0.5, endY: 0.85, feather: 0.5, invert: false,
};

type ToolType = 'brush' | 'eraser' | 'linear_gradient' | 'radial_gradient' | 'parametric';
type TabType = 'tools' | 'layers' | 'adjustments' | 'masking';

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
  className = ''
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

  const resetParameter = useCallback((key: keyof LocalAdjustmentParams, defaultValue: number | number[]) => {
    handleParameterChange(key, defaultValue);
  }, [handleParameterChange]);

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

  const resetBrushParam = useCallback((key: keyof BrushParameters, defaultValue: number) => {
    handleBrushParamChange(key, defaultValue);
  }, [handleBrushParamChange]);

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

  const geomRow = (label: string, val: number, min: number, max: number, step: number, onCh: (v: number) => void) => (
    <div className="space-y-1" key={label}>
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: 'var(--gray-300)' }}>{label}</span>
        <span className="text-xs font-mono" style={{ color: 'var(--gray-500)' }}>{val.toFixed(2)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={val}
        className="slider w-full"
        onInput={(e) => onCh(parseFloat((e.target as HTMLInputElement).value))}
        onChange={(e) => onCh(parseFloat(e.target.value))}
      />
    </div>
  );

  const renderGeometry = () => {
    if (!activeLayer || (activeLayer.type !== 'radial_gradient' && activeLayer.type !== 'linear_gradient')) {
      return (
        <div className="text-xs" style={{ color: 'var(--gray-400)' }}>
          Add a Radial or Linear layer in the <strong>Layers</strong> tab to place a region, then shape it here and adjust its look in the <strong>Adjust</strong> tab.
        </div>
      );
    }
    const isRadial = activeLayer.type === 'radial_gradient';
    return (
      <div className="space-y-2">
        <label className="text-xs font-medium" style={{ color: 'var(--gray-300)' }}>
          {isRadial ? 'Radial Shape (circle / oval)' : 'Linear Gradient'}
        </label>
        {isRadial ? (
          <>
            {geomRow('Center X', localGeom.centerX, 0, 1, 0.01, (v) => updateGeom({ centerX: v }))}
            {geomRow('Center Y', localGeom.centerY, 0, 1, 0.01, (v) => updateGeom({ centerY: v }))}
            {geomRow('Radius X', localGeom.radiusX, 0.02, 1, 0.01, (v) => updateGeom({ radiusX: v }))}
            {geomRow('Radius Y', localGeom.radiusY, 0.02, 1, 0.01, (v) => updateGeom({ radiusY: v }))}
            {geomRow('Feather', localGeom.feather, 0.01, 1, 0.01, (v) => updateGeom({ feather: v }))}
          </>
        ) : (
          <>
            {geomRow('Start X', localGeom.startX, 0, 1, 0.01, (v) => updateGeom({ startX: v }))}
            {geomRow('Start Y', localGeom.startY, 0, 1, 0.01, (v) => updateGeom({ startY: v }))}
            {geomRow('End X', localGeom.endX, 0, 1, 0.01, (v) => updateGeom({ endX: v }))}
            {geomRow('End Y', localGeom.endY, 0, 1, 0.01, (v) => updateGeom({ endY: v }))}
            {geomRow('Feather', localGeom.feather, 0.01, 1, 0.01, (v) => updateGeom({ feather: v }))}
          </>
        )}
        <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--gray-300)' }}>
          <input type="checkbox" checked={localGeom.invert} onChange={(e) => updateGeom({ invert: e.target.checked })} />
          Invert mask
        </label>
      </div>
    );
  };

  const renderToolsTab = () => (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Tools</label>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { key: 'brush', label: 'Brush', icon: Brush },
            { key: 'eraser', label: 'Eraser', icon: Circle },
            { key: 'linear_gradient', label: 'Linear', icon: Move },
            { key: 'radial_gradient', label: 'Radial', icon: Circle }
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTool(key as ToolType)}
              className="flex items-center gap-1.5 px-3 py-2 rounded text-xs transition-colors"
              style={{
                backgroundColor: activeTool === key ? 'var(--primary-600)' : 'var(--gray-700)',
                color: 'var(--white)'
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {(activeTool === 'brush' || activeTool === 'eraser') && (
        <div className="space-y-3">
          <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Brush Settings</label>

          {/* Size */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Size</label>
              <div className="flex items-center gap-1.5">
                <DelayedInputControl
                  value={localBrushParams.size}
                  onChange={(value) => handleBrushParamChange('size', value)}
                  min={1}
                  max={500}
                  step={1}
                  precision={0}
                />
                <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>px</span>
                <button
                  onClick={() => resetBrushParam('size', 50)}
                  className="p-1 rounded"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--gray-500)',
                    transition: 'var(--transition-fast)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                    e.currentTarget.style.color = 'var(--white)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--gray-500)';
                  }}
                  title="Reset"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
            <input
              type="range"
              min={1}
              max={500}
              step={1}
              value={localBrushParams.size}
              onInput={(e) => handleBrushParamChangeRealTime('size', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => handleBrushParamChange('size', parseFloat(e.target.value))}
              onDoubleClick={() => handleBrushParamChange('size', 50)}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, #6b7280, #3b82f6, #8b5cf6)',
              }}
              title="Double-click to reset to 50"
            />
          </div>

          {/* Hardness */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Hardness</label>
              <div className="flex items-center gap-1.5">
                <DelayedInputControl
                  value={localBrushParams.hardness * 100}
                  onChange={(value) => handleBrushParamChange('hardness', value / 100)}
                  min={0}
                  max={100}
                  step={1}
                  precision={0}
                />
                <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>%</span>
                <button
                  onClick={() => resetBrushParam('hardness', 0.8)}
                  className="p-1 rounded"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--gray-500)',
                    transition: 'var(--transition-fast)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                    e.currentTarget.style.color = 'var(--white)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--gray-500)';
                  }}
                  title="Reset"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={localBrushParams.hardness}
              onInput={(e) => handleBrushParamChangeRealTime('hardness', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => handleBrushParamChange('hardness', parseFloat(e.target.value))}
              onDoubleClick={() => handleBrushParamChange('hardness', 0.8)}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, #9ca3af, #1f2937)',
              }}
              title="Double-click to reset to 80%"
            />
          </div>

          {/* Opacity */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Opacity</label>
              <div className="flex items-center gap-1.5">
                <DelayedInputControl
                  value={localBrushParams.opacity * 100}
                  onChange={(value) => handleBrushParamChange('opacity', value / 100)}
                  min={0}
                  max={100}
                  step={1}
                  precision={0}
                />
                <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>%</span>
                <button
                  onClick={() => resetBrushParam('opacity', 1.0)}
                  className="p-1 rounded"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--gray-500)',
                    transition: 'var(--transition-fast)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                    e.currentTarget.style.color = 'var(--white)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--gray-500)';
                  }}
                  title="Reset"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={localBrushParams.opacity}
              onInput={(e) => handleBrushParamChangeRealTime('opacity', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => handleBrushParamChange('opacity', parseFloat(e.target.value))}
              onDoubleClick={() => handleBrushParamChange('opacity', 1.0)}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, rgba(107, 114, 128, 0.3), rgba(107, 114, 128, 1))',
              }}
              title="Double-click to reset to 100%"
            />
          </div>

          {/* Flow */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Flow</label>
              <div className="flex items-center gap-1.5">
                <DelayedInputControl
                  value={localBrushParams.flow * 100}
                  onChange={(value) => handleBrushParamChange('flow', value / 100)}
                  min={0}
                  max={100}
                  step={1}
                  precision={0}
                />
                <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>%</span>
                <button
                  onClick={() => resetBrushParam('flow', 1.0)}
                  className="p-1 rounded"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--gray-500)',
                    transition: 'var(--transition-fast)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                    e.currentTarget.style.color = 'var(--white)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--gray-500)';
                  }}
                  title="Reset"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={localBrushParams.flow}
              onInput={(e) => handleBrushParamChangeRealTime('flow', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => handleBrushParamChange('flow', parseFloat(e.target.value))}
              onDoubleClick={() => handleBrushParamChange('flow', 1.0)}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, #6b7280, #10b981)',
              }}
              title="Double-click to reset to 100%"
            />
          </div>
        </div>
      )}

      <div className="space-y-1.5 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
        <label className="text-xs font-medium" style={{ color: 'var(--gray-300)' }}>Shape &amp; Position</label>
        {renderGeometry()}
      </div>
    </div>
  );

  const renderLayersTab = () => (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Layers</label>
        <button
          onClick={() => setShowNewLayerDialog(true)}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors"
          style={{
            backgroundColor: 'var(--gray-700)',
            color: 'var(--white)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--gray-600)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--gray-700)';
          }}
        >
          <Plus className="w-3 h-3" />
          New
        </button>
      </div>

      <div className="space-y-1.5 max-h-60 overflow-y-auto">
        {layers.map((layer) => (
          <div
            key={layer.id}
            className="p-2 rounded"
            style={{
              backgroundColor: 'var(--gray-700)',
              border: `1px solid ${layer.id === activeLayerId ? 'var(--primary-500)' : 'transparent'}`
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => onSetActiveLayer(layer.id)}
                className="text-xs font-medium flex-1 text-left"
                style={{color: 'var(--gray-200)'}}
              >
                {layer.name}
              </button>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => onToggleLayer(layer.id, !layer.enabled)}
                  className="p-1 rounded"
                  style={{color: layer.enabled ? 'var(--white)' : 'var(--gray-500)'}}
                >
                  {layer.enabled ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => onRemoveLayer(layer.id)}
                  className="p-1"
                  style={{color: 'var(--red-400)'}}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--red-300)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--red-400)';
                  }}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="text-xs mb-2" style={{color: 'var(--gray-400)'}}>
              {layer.type.replace('_', ' ')} • {layer.blendMode}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Opacity</span>
                <span className="text-xs font-mono" style={{color: 'var(--gray-400)'}}>
                  {(layer.opacity * 100).toFixed(0)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={layer.opacity}
                onChange={(e) => onUpdateLayerOpacity(layer.id, parseFloat(e.target.value))}
                className="slider w-full"
                style={{
                  background: 'linear-gradient(to right, rgba(107, 114, 128, 0.3), rgba(107, 114, 128, 1))',
                }}
              />
            </div>
          </div>
        ))}

        {layers.length === 0 && (
          <div className="text-xs text-center py-4" style={{color: 'var(--gray-400)'}}>
            No layers yet. Click "New" to create your first adjustment layer.
          </div>
        )}
      </div>

      {showNewLayerDialog && (
        <div className="space-y-2 p-3 rounded" style={{backgroundColor: 'var(--gray-800)', border: '1px solid var(--border)'}}>
          <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Create New Layer</label>

          <div className="grid grid-cols-2 gap-1.5">
            {[
              { key: 'brush', label: 'Brush', icon: Brush },
              { key: 'linear_gradient', label: 'Linear', icon: Move },
              { key: 'radial_gradient', label: 'Radial', icon: Circle },
              { key: 'parametric', label: 'Parametric', icon: Settings }
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => createNewLayer(key as LocalAdjustmentLayer['type'])}
                className="flex items-center gap-1.5 px-3 py-2 text-xs rounded transition-colors"
                style={{
                  backgroundColor: 'var(--gray-700)',
                  color: 'var(--white)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--gray-600)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--gray-700)';
                }}
              >
                <Icon className="w-3 h-3" />
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowNewLayerDialog(false)}
            className="w-full px-3 py-2 text-xs rounded transition-colors"
            style={{
              backgroundColor: 'var(--gray-700)',
              color: 'var(--white)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--gray-600)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--gray-700)';
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );

  const renderAdjustmentsTab = () => (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Adjustments</label>
        {activeLayer && (
          <span className="text-xs" style={{color: 'var(--gray-400)'}}>{activeLayer.name}</span>
        )}
      </div>

      {!activeLayer ? (
        <div className="text-xs text-center py-4" style={{color: 'var(--gray-400)'}}>
          Select or create a layer to adjust its parameters.
        </div>
      ) : (
        <div className="space-y-3">
          {/* Mask feather (also editable in the Tools > Shape section) */}
          {(activeLayer.type === 'radial_gradient' || activeLayer.type === 'linear_gradient') && (
            <div className="space-y-1.5 pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
              <label className="text-xs font-medium" style={{ color: 'var(--gray-300)' }}>Mask Feather</label>
              {geomRow('Feather', localGeom.feather, 0.01, 1, 0.01, (v) => updateGeom({ feather: v }))}
            </div>
          )}

          {/* Exposure Section */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Exposure</label>

            {/* Exposure */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Exposure</label>
                <div className="flex items-center gap-1.5">
                  <DelayedInputControl
                    value={localParams.exposure}
                    onChange={(value) => handleParameterChange('exposure', value)}
                    min={-4}
                    max={4}
                    step={0.1}
                    precision={2}
                  />
                  <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>EV</span>
                  <button
                    onClick={() => resetParameter('exposure', 0)}
                    className="p-1 rounded"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--gray-500)',
                      transition: 'var(--transition-fast)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                      e.currentTarget.style.color = 'var(--white)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--gray-500)';
                    }}
                    title="Reset"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={-4}
                max={4}
                step={0.01}
                value={localParams.exposure}
                onInput={(e) => handleParameterChangeRealTime('exposure', parseFloat((e.target as HTMLInputElement).value))}
                onChange={(e) => handleParameterChange('exposure', parseFloat(e.target.value))}
                onDoubleClick={() => handleParameterChange('exposure', 0)}
                className="slider w-full"
                style={{
                  background: 'linear-gradient(to right, #000000, #6b7280, #ffffff)',
                }}
                title="Double-click to reset to 0"
              />
            </div>

            {/* Shadows */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Shadows</label>
                <div className="flex items-center gap-1.5">
                  <DelayedInputControl
                    value={localParams.shadows}
                    onChange={(value) => handleParameterChange('shadows', value)}
                    min={-100}
                    max={100}
                    step={1}
                    precision={0}
                  />
                  <button
                    onClick={() => resetParameter('shadows', 0)}
                    className="p-1 rounded"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--gray-500)',
                      transition: 'var(--transition-fast)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                      e.currentTarget.style.color = 'var(--white)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--gray-500)';
                    }}
                    title="Reset"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={localParams.shadows}
                onInput={(e) => handleParameterChangeRealTime('shadows', parseFloat((e.target as HTMLInputElement).value))}
                onChange={(e) => handleParameterChange('shadows', parseFloat(e.target.value))}
                onDoubleClick={() => handleParameterChange('shadows', 0)}
                className="slider w-full"
                style={{
                  background: 'linear-gradient(to right, #000000, #6b7280)',
                }}
                title="Double-click to reset to 0"
              />
            </div>

            {/* Highlights */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Highlights</label>
                <div className="flex items-center gap-1.5">
                  <DelayedInputControl
                    value={localParams.highlights}
                    onChange={(value) => handleParameterChange('highlights', value)}
                    min={-100}
                    max={100}
                    step={1}
                    precision={0}
                  />
                  <button
                    onClick={() => resetParameter('highlights', 0)}
                    className="p-1 rounded"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--gray-500)',
                      transition: 'var(--transition-fast)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                      e.currentTarget.style.color = 'var(--white)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--gray-500)';
                    }}
                    title="Reset"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={localParams.highlights}
                onInput={(e) => handleParameterChangeRealTime('highlights', parseFloat((e.target as HTMLInputElement).value))}
                onChange={(e) => handleParameterChange('highlights', parseFloat(e.target.value))}
                onDoubleClick={() => handleParameterChange('highlights', 0)}
                className="slider w-full"
                style={{
                  background: 'linear-gradient(to right, #6b7280, #ffffff)',
                }}
                title="Double-click to reset to 0"
              />
            </div>
          </div>

          {/* Color Section */}
          <div className="space-y-1.5 pt-3" style={{borderTop: '1px solid var(--border)'}}>
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Color</label>

            {/* Temperature */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Temperature</label>
                <div className="flex items-center gap-1.5">
                  <DelayedInputControl
                    value={localParams.temperature}
                    onChange={(value) => handleParameterChange('temperature', value)}
                    min={-100}
                    max={100}
                    step={1}
                    precision={0}
                  />
                  <button
                    onClick={() => resetParameter('temperature', 0)}
                    className="p-1 rounded"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--gray-500)',
                      transition: 'var(--transition-fast)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                      e.currentTarget.style.color = 'var(--white)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--gray-500)';
                    }}
                    title="Reset"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={localParams.temperature}
                onInput={(e) => handleParameterChangeRealTime('temperature', parseFloat((e.target as HTMLInputElement).value))}
                onChange={(e) => handleParameterChange('temperature', parseFloat(e.target.value))}
                onDoubleClick={() => handleParameterChange('temperature', 0)}
                className="slider w-full"
                style={{
                  background: 'linear-gradient(to right, #60a5fa, #e5e7eb, #fb923c)',
                }}
                title="Double-click to reset to 0"
              />
            </div>

            {/* Tint */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Tint</label>
                <div className="flex items-center gap-1.5">
                  <DelayedInputControl
                    value={localParams.tint}
                    onChange={(value) => handleParameterChange('tint', value)}
                    min={-100}
                    max={100}
                    step={1}
                    precision={0}
                  />
                  <button
                    onClick={() => resetParameter('tint', 0)}
                    className="p-1 rounded"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--gray-500)',
                      transition: 'var(--transition-fast)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                      e.currentTarget.style.color = 'var(--white)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--gray-500)';
                    }}
                    title="Reset"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={localParams.tint}
                onInput={(e) => handleParameterChangeRealTime('tint', parseFloat((e.target as HTMLInputElement).value))}
                onChange={(e) => handleParameterChange('tint', parseFloat(e.target.value))}
                onDoubleClick={() => handleParameterChange('tint', 0)}
                className="slider w-full"
                style={{
                  background: 'linear-gradient(to right, #f472b6, #9ca3af, #4ade80)',
                }}
                title="Double-click to reset to 0"
              />
            </div>

            {/* Saturation */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Saturation</label>
                <div className="flex items-center gap-1.5">
                  <DelayedInputControl
                    value={localParams.saturation}
                    onChange={(value) => handleParameterChange('saturation', value)}
                    min={-100}
                    max={100}
                    step={1}
                    precision={0}
                  />
                  <button
                    onClick={() => resetParameter('saturation', 0)}
                    className="p-1 rounded"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--gray-500)',
                      transition: 'var(--transition-fast)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                      e.currentTarget.style.color = 'var(--white)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--gray-500)';
                    }}
                    title="Reset"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={localParams.saturation}
                onInput={(e) => handleParameterChangeRealTime('saturation', parseFloat((e.target as HTMLInputElement).value))}
                onChange={(e) => handleParameterChange('saturation', parseFloat(e.target.value))}
                onDoubleClick={() => handleParameterChange('saturation', 0)}
                className="slider w-full"
                style={{
                  background: 'linear-gradient(to right, #6b7280, #3b82f6, #10b981, #eab308, #f97316, #ef4444)',
                }}
                title="Double-click to reset to 0"
              />
            </div>

            {/* Vibrance */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Vibrance</label>
                <div className="flex items-center gap-1.5">
                  <DelayedInputControl
                    value={localParams.vibrance}
                    onChange={(value) => handleParameterChange('vibrance', value)}
                    min={-100}
                    max={100}
                    step={1}
                    precision={0}
                  />
                  <button
                    onClick={() => resetParameter('vibrance', 0)}
                    className="p-1 rounded"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--gray-500)',
                      transition: 'var(--transition-fast)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                      e.currentTarget.style.color = 'var(--white)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--gray-500)';
                    }}
                    title="Reset"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={localParams.vibrance}
                onInput={(e) => handleParameterChangeRealTime('vibrance', parseFloat((e.target as HTMLInputElement).value))}
                onChange={(e) => handleParameterChange('vibrance', parseFloat(e.target.value))}
                onDoubleClick={() => handleParameterChange('vibrance', 0)}
                className="slider w-full"
                style={{
                  background: 'linear-gradient(to right, #6b7280, #ef4444, #f97316, #eab308, #10b981, #3b82f6, #8b5cf6)',
                }}
                title="Double-click to reset to 0"
              />
            </div>
          </div>

          {/* Tone Section */}
          <div className="space-y-1.5 pt-3" style={{borderTop: '1px solid var(--border)'}}>
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Tone</label>

            {/* Contrast */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Contrast</label>
                <div className="flex items-center gap-1.5">
                  <DelayedInputControl
                    value={localParams.contrast}
                    onChange={(value) => handleParameterChange('contrast', value)}
                    min={-100}
                    max={100}
                    step={1}
                    precision={0}
                  />
                  <button
                    onClick={() => resetParameter('contrast', 0)}
                    className="p-1 rounded"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--gray-500)',
                      transition: 'var(--transition-fast)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                      e.currentTarget.style.color = 'var(--white)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--gray-500)';
                    }}
                    title="Reset"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={localParams.contrast}
                onInput={(e) => handleParameterChangeRealTime('contrast', parseFloat((e.target as HTMLInputElement).value))}
                onChange={(e) => handleParameterChange('contrast', parseFloat(e.target.value))}
                onDoubleClick={() => handleParameterChange('contrast', 0)}
                className="slider w-full"
                style={{
                  background: 'linear-gradient(to right, #6b7280, #ffffff)',
                }}
                title="Double-click to reset to 0"
              />
            </div>

            {/* Brightness */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Brightness</label>
                <div className="flex items-center gap-1.5">
                  <DelayedInputControl
                    value={localParams.brightness}
                    onChange={(value) => handleParameterChange('brightness', value)}
                    min={-100}
                    max={100}
                    step={1}
                    precision={0}
                  />
                  <button
                    onClick={() => resetParameter('brightness', 0)}
                    className="p-1 rounded"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--gray-500)',
                      transition: 'var(--transition-fast)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                      e.currentTarget.style.color = 'var(--white)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--gray-500)';
                    }}
                    title="Reset"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={localParams.brightness}
                onInput={(e) => handleParameterChangeRealTime('brightness', parseFloat((e.target as HTMLInputElement).value))}
                onChange={(e) => handleParameterChange('brightness', parseFloat(e.target.value))}
                onDoubleClick={() => handleParameterChange('brightness', 0)}
                className="slider w-full"
                style={{
                  background: 'linear-gradient(to right, #000000, #6b7280, #ffffff)',
                }}
                title="Double-click to reset to 0"
              />
            </div>

            {/* Clarity */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Clarity</label>
                <div className="flex items-center gap-1.5">
                  <DelayedInputControl
                    value={localParams.clarity}
                    onChange={(value) => handleParameterChange('clarity', value)}
                    min={-100}
                    max={100}
                    step={1}
                    precision={0}
                  />
                  <button
                    onClick={() => resetParameter('clarity', 0)}
                    className="p-1 rounded"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--gray-500)',
                      transition: 'var(--transition-fast)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                      e.currentTarget.style.color = 'var(--white)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--gray-500)';
                    }}
                    title="Reset"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={localParams.clarity}
                onInput={(e) => handleParameterChangeRealTime('clarity', parseFloat((e.target as HTMLInputElement).value))}
                onChange={(e) => handleParameterChange('clarity', parseFloat(e.target.value))}
                onDoubleClick={() => handleParameterChange('clarity', 0)}
                className="slider w-full"
                style={{
                  background: 'linear-gradient(to right, #6b7280, #10b981)',
                }}
                title="Double-click to reset to 0"
              />
            </div>
          </div>

          {/* Advanced Section */}
          <div className="space-y-1.5 pt-3" style={{borderTop: '1px solid var(--border)'}}>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center justify-between w-full text-xs font-medium"
              style={{color: 'var(--gray-300)'}}
            >
              Advanced Settings
              <span style={{ transform: showAdvanced ? 'rotate(90deg)' : '', transition: 'var(--transition-fast)' }}>
                ▶
              </span>
            </button>

            {showAdvanced && (
              <div className="space-y-3 pl-2" style={{borderLeft: '2px solid var(--border)'}}>
                {/* Hue Shift */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Hue Shift</label>
                    <div className="flex items-center gap-1.5">
                      <DelayedInputControl
                        value={localParams.hueShift}
                        onChange={(value) => handleParameterChange('hueShift', value)}
                        min={-180}
                        max={180}
                        step={1}
                        precision={0}
                      />
                      <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '12px'}}>°</span>
                      <button
                        onClick={() => resetParameter('hueShift', 0)}
                        className="p-1 rounded"
                        style={{
                          backgroundColor: 'transparent',
                          color: 'var(--gray-500)',
                          transition: 'var(--transition-fast)'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                          e.currentTarget.style.color = 'var(--white)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                          e.currentTarget.style.color = 'var(--gray-500)';
                        }}
                        title="Reset"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={1}
                    value={localParams.hueShift}
                    onInput={(e) => handleParameterChangeRealTime('hueShift', parseFloat((e.target as HTMLInputElement).value))}
                    onChange={(e) => handleParameterChange('hueShift', parseFloat(e.target.value))}
                    onDoubleClick={() => handleParameterChange('hueShift', 0)}
                    className="slider w-full"
                    style={{
                      background: 'linear-gradient(to right, #ef4444, #f97316, #eab308, #10b981, #3b82f6, #8b5cf6, #ef4444)',
                    }}
                    title="Double-click to reset to 0"
                  />
                </div>

                {/* Color Balance */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Color Balance</label>

                  {/* Red */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Red</label>
                      <div className="flex items-center gap-1.5">
                        <DelayedInputControl
                          value={localParams.colorBalance[0]}
                          onChange={(value) => {
                            const newBalance = [...localParams.colorBalance];
                            newBalance[0] = value;
                            handleParameterChange('colorBalance', newBalance);
                          }}
                          min={-1}
                          max={1}
                          step={0.01}
                          precision={2}
                        />
                        <button
                          onClick={() => {
                            const newBalance = [...localParams.colorBalance];
                            newBalance[0] = 0;
                            handleParameterChange('colorBalance', newBalance);
                          }}
                          className="p-1 rounded"
                          style={{
                            backgroundColor: 'transparent',
                            color: 'var(--gray-500)',
                            transition: 'var(--transition-fast)'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                            e.currentTarget.style.color = 'var(--white)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.color = 'var(--gray-500)';
                          }}
                          title="Reset"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.01}
                      value={localParams.colorBalance[0]}
                      onInput={(e) => {
                        const newBalance = [...localParams.colorBalance];
                        newBalance[0] = parseFloat((e.target as HTMLInputElement).value);
                        handleParameterChangeRealTime('colorBalance', newBalance);
                      }}
                      onChange={(e) => {
                        const newBalance = [...localParams.colorBalance];
                        newBalance[0] = parseFloat(e.target.value);
                        handleParameterChange('colorBalance', newBalance);
                      }}
                      onDoubleClick={() => {
                        const newBalance = [...localParams.colorBalance];
                        newBalance[0] = 0;
                        handleParameterChange('colorBalance', newBalance);
                      }}
                      className="slider w-full"
                      style={{
                        background: 'linear-gradient(to right, #00ffff, #6b7280, #ef4444)',
                      }}
                      title="Double-click to reset to 0"
                    />
                  </div>

                  {/* Green */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Green</label>
                      <div className="flex items-center gap-1.5">
                        <DelayedInputControl
                          value={localParams.colorBalance[1]}
                          onChange={(value) => {
                            const newBalance = [...localParams.colorBalance];
                            newBalance[1] = value;
                            handleParameterChange('colorBalance', newBalance);
                          }}
                          min={-1}
                          max={1}
                          step={0.01}
                          precision={2}
                        />
                        <button
                          onClick={() => {
                            const newBalance = [...localParams.colorBalance];
                            newBalance[1] = 0;
                            handleParameterChange('colorBalance', newBalance);
                          }}
                          className="p-1 rounded"
                          style={{
                            backgroundColor: 'transparent',
                            color: 'var(--gray-500)',
                            transition: 'var(--transition-fast)'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                            e.currentTarget.style.color = 'var(--white)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.color = 'var(--gray-500)';
                          }}
                          title="Reset"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.01}
                      value={localParams.colorBalance[1]}
                      onInput={(e) => {
                        const newBalance = [...localParams.colorBalance];
                        newBalance[1] = parseFloat((e.target as HTMLInputElement).value);
                        handleParameterChangeRealTime('colorBalance', newBalance);
                      }}
                      onChange={(e) => {
                        const newBalance = [...localParams.colorBalance];
                        newBalance[1] = parseFloat(e.target.value);
                        handleParameterChange('colorBalance', newBalance);
                      }}
                      onDoubleClick={() => {
                        const newBalance = [...localParams.colorBalance];
                        newBalance[1] = 0;
                        handleParameterChange('colorBalance', newBalance);
                      }}
                      className="slider w-full"
                      style={{
                        background: 'linear-gradient(to right, #f472b6, #6b7280, #10b981)',
                      }}
                      title="Double-click to reset to 0"
                    />
                  </div>

                  {/* Blue */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Blue</label>
                      <div className="flex items-center gap-1.5">
                        <DelayedInputControl
                          value={localParams.colorBalance[2]}
                          onChange={(value) => {
                            const newBalance = [...localParams.colorBalance];
                            newBalance[2] = value;
                            handleParameterChange('colorBalance', newBalance);
                          }}
                          min={-1}
                          max={1}
                          step={0.01}
                          precision={2}
                        />
                        <button
                          onClick={() => {
                            const newBalance = [...localParams.colorBalance];
                            newBalance[2] = 0;
                            handleParameterChange('colorBalance', newBalance);
                          }}
                          className="p-1 rounded"
                          style={{
                            backgroundColor: 'transparent',
                            color: 'var(--gray-500)',
                            transition: 'var(--transition-fast)'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                            e.currentTarget.style.color = 'var(--white)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.color = 'var(--gray-500)';
                          }}
                          title="Reset"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.01}
                      value={localParams.colorBalance[2]}
                      onInput={(e) => {
                        const newBalance = [...localParams.colorBalance];
                        newBalance[2] = parseFloat((e.target as HTMLInputElement).value);
                        handleParameterChangeRealTime('colorBalance', newBalance);
                      }}
                      onChange={(e) => {
                        const newBalance = [...localParams.colorBalance];
                        newBalance[2] = parseFloat(e.target.value);
                        handleParameterChange('colorBalance', newBalance);
                      }}
                      onDoubleClick={() => {
                        const newBalance = [...localParams.colorBalance];
                        newBalance[2] = 0;
                        handleParameterChange('colorBalance', newBalance);
                      }}
                      className="slider w-full"
                      style={{
                        background: 'linear-gradient(to right, #eab308, #6b7280, #3b82f6)',
                      }}
                      title="Double-click to reset to 0"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const renderMaskingTab = () => (
    <div className="space-y-3">
      <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Parametric Masking</label>

      {!activeLayer || activeLayer.type !== 'parametric' ? (
        <div className="text-xs text-center py-4" style={{color: 'var(--gray-400)'}}>
          Create or select a parametric layer to adjust masking parameters.
        </div>
      ) : (
        <div className="space-y-1.5">
          <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Luminance Range</label>
          <div className="text-xs" style={{color: 'var(--gray-400)'}}>
            Parametric masking controls will be available when a parametric layer is selected.
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between pb-2" style={{borderBottom: '1px solid var(--border)'}}>
        <div className="flex items-center gap-2">
          <div className="w-1 h-3 rounded-sm" style={{backgroundColor: 'var(--gray-600)'}} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{color: 'var(--gray-500)', letterSpacing: '0.5px'}}>Controls</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              // Reset all adjustments
              onParametersChange({
                exposure: 0,
                shadows: 0,
                highlights: 0,
                temperature: 0,
                tint: 0,
                saturation: 0,
                vibrance: 0,
                contrast: 0,
                brightness: 0,
                clarity: 0,
                hueShift: 0,
                colorBalance: [0, 0, 0]
              });
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
            title="Reset all adjustments"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-lg p-1" style={{backgroundColor: 'var(--gray-700)'}}>
        {[
          { key: 'tools', label: 'Tools', icon: Brush },
          { key: 'layers', label: 'Layers', icon: Layers },
          { key: 'adjustments', label: 'Adjust', icon: Settings },
          { key: 'masking', label: 'Mask', icon: Circle }
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as TabType)}
            className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs font-medium rounded-md transition-all ${
              activeTab === key ? 'shadow-sm' : 'bg-transparent'
            }`}
            style={{
              backgroundColor: activeTab === key ? 'var(--gray-600)' : 'transparent',
              color: activeTab === key ? 'var(--white)' : 'var(--gray-300)'
            }}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-3">
        {activeTab === 'tools' && renderToolsTab()}
        {activeTab === 'layers' && renderLayersTab()}
        {activeTab === 'adjustments' && renderAdjustmentsTab()}
        {activeTab === 'masking' && renderMaskingTab()}
      </div>

      {/* Active Tool Indicator */}
      <div className="pt-3" style={{borderTop: '1px solid var(--border)'}}>
        <div className="flex items-center gap-1.5 text-xs" style={{color: 'var(--gray-400)'}}>
          <span>Active Tool:</span>
          <span style={{color: 'var(--primary-400)'}} className="font-medium">
            {activeTool.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
          </span>
        </div>
      </div>
    </div>
  );
};

export default LocalAdjustmentsModuleComponent;
