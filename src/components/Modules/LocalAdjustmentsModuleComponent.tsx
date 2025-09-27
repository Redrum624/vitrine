import React, { useState, useCallback } from 'react';
import { Brush, Move, Circle, Layers, Trash2, Eye, EyeOff, Plus, Settings } from 'lucide-react';
import SliderControl from '../Controls/SliderControl';
import {
  LocalAdjustmentLayer,
  LocalAdjustmentParams,
  BrushParameters
} from '../../modules/LocalAdjustmentsModule';

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
  className?: string;
}

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
  className = ''
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('tools');
  const [activeTool, setActiveTool] = useState<ToolType>('brush');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showNewLayerDialog, setShowNewLayerDialog] = useState(false);

  // Get active layer
  const activeLayer = layers.find(layer => layer.id === activeLayerId);

  const handleParameterChange = useCallback((key: keyof LocalAdjustmentParams, value: number | number[]) => {
    onParametersChange({ [key]: value });
  }, [onParametersChange]);

  const handleBrushParamChange = useCallback((key: keyof BrushParameters, value: number) => {
    onBrushParamsChange({ [key]: value });
  }, [onBrushParamsChange]);

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

  const renderToolsTab = () => (
    <div className="space-y-4">
      {/* Tool Selection */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-gray-300">Tools</h4>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setActiveTool('brush')}
            className={`flex items-center gap-2 px-3 py-2 rounded text-xs transition-colors ${
              activeTool === 'brush'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <Brush size={14} />
            Brush
          </button>
          <button
            onClick={() => setActiveTool('eraser')}
            className={`flex items-center gap-2 px-3 py-2 rounded text-xs transition-colors ${
              activeTool === 'eraser'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <Circle size={14} />
            Eraser
          </button>
          <button
            onClick={() => setActiveTool('linear_gradient')}
            className={`flex items-center gap-2 px-3 py-2 rounded text-xs transition-colors ${
              activeTool === 'linear_gradient'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <Move size={14} />
            Linear
          </button>
          <button
            onClick={() => setActiveTool('radial_gradient')}
            className={`flex items-center gap-2 px-3 py-2 rounded text-xs transition-colors ${
              activeTool === 'radial_gradient'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <Circle size={14} />
            Radial
          </button>
        </div>
      </div>

      {/* Brush Settings */}
      {(activeTool === 'brush' || activeTool === 'eraser') && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-gray-300">Brush Settings</h4>

          <SliderControl
            label="Size"
            value={brushParams.size}
            min={1}
            max={500}
            step={1}
            onChange={(value: number) => handleBrushParamChange('size', value)}
            className="text-xs"
          />

          <SliderControl
            label="Hardness"
            value={brushParams.hardness}
            min={0}
            max={1}
            step={0.01}
            onChange={(value: number) => handleBrushParamChange('hardness', value)}
            className="text-xs"
            showPercentage
          />

          <SliderControl
            label="Opacity"
            value={brushParams.opacity}
            min={0}
            max={1}
            step={0.01}
            onChange={(value: number) => handleBrushParamChange('opacity', value)}
            className="text-xs"
            showPercentage
          />

          <SliderControl
            label="Flow"
            value={brushParams.flow}
            min={0}
            max={1}
            step={0.01}
            onChange={(value: number) => handleBrushParamChange('flow', value)}
            className="text-xs"
            showPercentage
          />
        </div>
      )}

      {/* Gradient Settings */}
      {(activeTool === 'linear_gradient' || activeTool === 'radial_gradient') && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-gray-300">Gradient Settings</h4>
          <div className="text-xs text-gray-400">
            Click and drag on the image to create a {activeTool.replace('_', ' ')} gradient.
          </div>
        </div>
      )}
    </div>
  );

  const renderLayersTab = () => (
    <div className="space-y-4">
      {/* New Layer Button */}
      <div className="flex justify-between items-center">
        <h4 className="text-xs font-semibold text-gray-300">Layers</h4>
        <button
          onClick={() => setShowNewLayerDialog(true)}
          className="flex items-center gap-1 px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded transition-colors"
        >
          <Plus size={12} />
          New
        </button>
      </div>

      {/* Layer List */}
      <div className="space-y-2 max-h-60 overflow-y-auto">
        {layers.map((layer) => (
          <div
            key={layer.id}
            className={`p-2 bg-gray-700 rounded border ${
              layer.id === activeLayerId ? 'border-blue-500' : 'border-transparent'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => onSetActiveLayer(layer.id)}
                className="text-xs font-medium text-gray-200 hover:text-white flex-1 text-left"
              >
                {layer.name}
              </button>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => onToggleLayer(layer.id, !layer.enabled)}
                  className={`p-1 rounded ${layer.enabled ? 'text-white' : 'text-gray-500'}`}
                >
                  {layer.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
                <button
                  onClick={() => onRemoveLayer(layer.id)}
                  className="p-1 text-red-400 hover:text-red-300"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            <div className="text-xs text-gray-400 mb-2">
              {layer.type.replace('_', ' ')} • {layer.blendMode}
            </div>

            <SliderControl
              label="Opacity"
              value={layer.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(value: number) => onUpdateLayerOpacity(layer.id, value)}
              className="text-xs"
              showPercentage
            />
          </div>
        ))}

        {layers.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-4">
            No layers yet. Click "New" to create your first adjustment layer.
          </div>
        )}
      </div>

      {/* New Layer Dialog */}
      {showNewLayerDialog && (
        <div className="space-y-3 p-3 bg-gray-800 rounded border">
          <h5 className="text-xs font-semibold text-gray-300">Create New Layer</h5>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => createNewLayer('brush')}
              className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded"
            >
              <Brush size={12} />
              Brush
            </button>
            <button
              onClick={() => createNewLayer('linear_gradient')}
              className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded"
            >
              <Move size={12} />
              Linear
            </button>
            <button
              onClick={() => createNewLayer('radial_gradient')}
              className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded"
            >
              <Circle size={12} />
              Radial
            </button>
            <button
              onClick={() => createNewLayer('parametric')}
              className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded"
            >
              <Settings size={12} />
              Parametric
            </button>
          </div>

          <button
            onClick={() => setShowNewLayerDialog(false)}
            className="w-full px-3 py-2 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );

  const renderAdjustmentsTab = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="text-xs font-semibold text-gray-300">Adjustments</h4>
        {activeLayer && (
          <span className="text-xs text-gray-400">{activeLayer.name}</span>
        )}
      </div>

      {!activeLayer ? (
        <div className="text-xs text-gray-400 text-center py-4">
          Select or create a layer to adjust its parameters.
        </div>
      ) : (
        <div className="space-y-3">
          {/* Exposure Section */}
          <div className="space-y-2">
            <h5 className="text-xs font-medium text-gray-300">Exposure</h5>

            <SliderControl
              label="Exposure"
              value={parameters.exposure}
              min={-4}
              max={4}
              step={0.01}
              onChange={(value: number) => handleParameterChange('exposure', value)}
              className="text-xs"
            />

            <SliderControl
              label="Shadows"
              value={parameters.shadows}
              min={-100}
              max={100}
              step={1}
              onChange={(value: number) => handleParameterChange('shadows', value)}
              className="text-xs"
            />

            <SliderControl
              label="Highlights"
              value={parameters.highlights}
              min={-100}
              max={100}
              step={1}
              onChange={(value: number) => handleParameterChange('highlights', value)}
              className="text-xs"
            />
          </div>

          {/* Color Section */}
          <div className="space-y-2">
            <h5 className="text-xs font-medium text-gray-300">Color</h5>

            <SliderControl
              label="Temperature"
              value={parameters.temperature}
              min={-100}
              max={100}
              step={1}
              onChange={(value: number) => handleParameterChange('temperature', value)}
              className="text-xs"
            />

            <SliderControl
              label="Tint"
              value={parameters.tint}
              min={-100}
              max={100}
              step={1}
              onChange={(value: number) => handleParameterChange('tint', value)}
              className="text-xs"
            />

            <SliderControl
              label="Saturation"
              value={parameters.saturation}
              min={-100}
              max={100}
              step={1}
              onChange={(value: number) => handleParameterChange('saturation', value)}
              className="text-xs"
            />

            <SliderControl
              label="Vibrance"
              value={parameters.vibrance}
              min={-100}
              max={100}
              step={1}
              onChange={(value: number) => handleParameterChange('vibrance', value)}
              className="text-xs"
            />
          </div>

          {/* Tone Section */}
          <div className="space-y-2">
            <h5 className="text-xs font-medium text-gray-300">Tone</h5>

            <SliderControl
              label="Contrast"
              value={parameters.contrast}
              min={-100}
              max={100}
              step={1}
              onChange={(value: number) => handleParameterChange('contrast', value)}
              className="text-xs"
            />

            <SliderControl
              label="Brightness"
              value={parameters.brightness}
              min={-100}
              max={100}
              step={1}
              onChange={(value: number) => handleParameterChange('brightness', value)}
              className="text-xs"
            />

            <SliderControl
              label="Clarity"
              value={parameters.clarity}
              min={-100}
              max={100}
              step={1}
              onChange={(value: number) => handleParameterChange('clarity', value)}
              className="text-xs"
            />
          </div>

          {/* Advanced Section */}
          <div className="space-y-2">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center justify-between w-full text-xs font-medium text-gray-300 hover:text-white"
            >
              Advanced Settings
              <span className={`transform transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>
                ▶
              </span>
            </button>

            {showAdvanced && (
              <div className="space-y-2 pl-2 border-l border-gray-600">
                <SliderControl
                  label="Hue Shift"
                  value={parameters.hueShift}
                  min={-180}
                  max={180}
                  step={1}
                  onChange={(value: number) => handleParameterChange('hueShift', value)}
                  className="text-xs"
                />

                <div className="space-y-2">
                  <span className="text-xs text-gray-300">Color Balance</span>
                  <SliderControl
                    label="Red"
                    value={parameters.colorBalance[0]}
                    min={-1}
                    max={1}
                    step={0.01}
                    onChange={(value: number) => handleParameterChange('colorBalance', [value, parameters.colorBalance[1], parameters.colorBalance[2]])}
                    className="text-xs"
                  />
                  <SliderControl
                    label="Green"
                    value={parameters.colorBalance[1]}
                    min={-1}
                    max={1}
                    step={0.01}
                    onChange={(value: number) => handleParameterChange('colorBalance', [parameters.colorBalance[0], value, parameters.colorBalance[2]])}
                    className="text-xs"
                  />
                  <SliderControl
                    label="Blue"
                    value={parameters.colorBalance[2]}
                    min={-1}
                    max={1}
                    step={0.01}
                    onChange={(value: number) => handleParameterChange('colorBalance', [parameters.colorBalance[0], parameters.colorBalance[1], value])}
                    className="text-xs"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const renderMaskingTab = () => (
    <div className="space-y-4">
      <h4 className="text-xs font-semibold text-gray-300">Parametric Masking</h4>

      {!activeLayer || activeLayer.type !== 'parametric' ? (
        <div className="text-xs text-gray-400 text-center py-4">
          Create or select a parametric layer to adjust masking parameters.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <h5 className="text-xs font-medium text-gray-300">Luminance Range</h5>
            {/* Parametric masking controls would go here */}
            <div className="text-xs text-gray-400">
              Parametric masking controls will be available when a parametric layer is selected.
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={`bg-gray-800 rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-200">Local Adjustments</h3>
        <div className="flex items-center gap-1">
          <Layers size={16} className="text-gray-400" />
          <span className="text-xs text-gray-400">{layers.length}</span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-gray-600 mb-4">
        {[
          { key: 'tools', label: 'Tools', icon: Brush },
          { key: 'layers', label: 'Layers', icon: Layers },
          { key: 'adjustments', label: 'Adjust', icon: Settings },
          { key: 'masking', label: 'Mask', icon: Circle }
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as TabType)}
            className={`flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === key
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {activeTab === 'tools' && renderToolsTab()}
        {activeTab === 'layers' && renderLayersTab()}
        {activeTab === 'adjustments' && renderAdjustmentsTab()}
        {activeTab === 'masking' && renderMaskingTab()}
      </div>

      {/* Active Tool Indicator */}
      <div className="mt-4 pt-3 border-t border-gray-600">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>Active Tool:</span>
          <span className="text-blue-400 font-medium">
            {activeTool.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
          </span>
        </div>
      </div>
    </div>
  );
};

export default LocalAdjustmentsModuleComponent;