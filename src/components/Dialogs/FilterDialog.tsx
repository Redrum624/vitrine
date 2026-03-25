import { useState, useCallback } from 'react';
import { X } from 'lucide-react';

export type FilterType = 'sharpen' | 'blur' | 'vignette' | 'filmGrain';

interface FilterConfig {
  label: string;
  params: {
    key: string;
    label: string;
    min: number;
    max: number;
    step: number;
    default: number;
  }[];
}

const FILTER_CONFIGS: Record<FilterType, FilterConfig> = {
  sharpen: {
    label: 'Sharpen',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 2, step: 0.05, default: 0.5 },
      { key: 'radius', label: 'Radius', min: 0.5, max: 5, step: 0.5, default: 1 },
    ],
  },
  blur: {
    label: 'Gaussian Blur',
    params: [
      { key: 'radius', label: 'Radius', min: 0.5, max: 20, step: 0.5, default: 3 },
    ],
  },
  vignette: {
    label: 'Vignette',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.05, default: 0.5 },
      { key: 'roundness', label: 'Roundness', min: 0, max: 1, step: 0.05, default: 0.5 },
    ],
  },
  filmGrain: {
    label: 'Film Grain',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.05, default: 0.4 },
      { key: 'size', label: 'Grain Size', min: 1, max: 4, step: 1, default: 1 },
    ],
  },
};

interface FilterDialogProps {
  isOpen: boolean;
  filterType: FilterType;
  onClose: () => void;
  onApply: (filterType: FilterType, params: Record<string, number>) => void;
  hasImage: boolean;
}

export function FilterDialog({ isOpen, filterType, onClose, onApply, hasImage }: FilterDialogProps) {
  const config = FILTER_CONFIGS[filterType];
  const [values, setValues] = useState<Record<string, number>>(() => {
    const defaults: Record<string, number> = {};
    config.params.forEach(p => { defaults[p.key] = p.default; });
    return defaults;
  });

  const handleChange = useCallback((key: string, value: number) => {
    setValues(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleApply = useCallback(() => {
    onApply(filterType, values);
    onClose();
  }, [filterType, values, onApply, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div
        className="border shadow-xl"
        style={{
          backgroundColor: 'var(--gray-900)',
          borderColor: 'var(--border)',
          width: '360px',
          borderRadius: '4px',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderBottomColor: 'var(--border)' }}
        >
          <h3 className="text-sm font-medium text-white">{config.label}</h3>
          <button
            className="text-dark-400 hover:text-white bg-transparent border-0 cursor-pointer p-1"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-4">
          {!hasImage && (
            <p className="text-xs text-dark-400">No image loaded. Load an image first to apply filters.</p>
          )}

          {config.params.map(param => (
            <div key={param.key}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-dark-300">{param.label}</label>
                <span className="text-xs text-dark-400 tabular-nums">{values[param.key].toFixed(param.step < 1 ? 2 : 0)}</span>
              </div>
              <input
                type="range"
                min={param.min}
                max={param.max}
                step={param.step}
                value={values[param.key]}
                onChange={e => handleChange(param.key, parseFloat(e.target.value))}
                className="w-full h-1 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, var(--accent-blue) 0%, var(--accent-blue) ${((values[param.key] - param.min) / (param.max - param.min)) * 100}%, var(--gray-700) ${((values[param.key] - param.min) / (param.max - param.min)) * 100}%, var(--gray-700) 100%)`,
                }}
                disabled={!hasImage}
              />
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 px-4 py-3 border-t"
          style={{ borderTopColor: 'var(--border)' }}
        >
          <button
            className="px-4 py-1.5 text-xs text-dark-300 hover:text-white bg-transparent border cursor-pointer"
            style={{ borderColor: 'var(--border)', borderRadius: '2px' }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-4 py-1.5 text-xs text-white cursor-pointer border-0"
            style={{
              backgroundColor: hasImage ? 'var(--accent-blue)' : 'var(--gray-700)',
              borderRadius: '2px',
              opacity: hasImage ? 1 : 0.5,
            }}
            onClick={handleApply}
            disabled={!hasImage}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
