import React from 'react';

interface SliderControlProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  unit?: string;
  precision?: number;
  className?: string;
  showPercentage?: boolean;
  description?: string;
}

const SliderControl: React.FC<SliderControlProps> = ({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  disabled = false,
  unit = '',
  precision = 0,
  className = '',
  showPercentage = false,
  description = '',
}) => {
  const displayValue = precision > 0 ? value.toFixed(precision) : Math.round(value);
  const displayUnit = showPercentage ? '%' : unit;

  return (
    <div className={`flex flex-col space-y-1 ${className}`}>
      <div className="flex justify-between items-center">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        <span className="text-sm text-gray-500">
          {displayValue}{displayUnit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
      />
      {description && (
        <div className="text-xs text-gray-400">{description}</div>
      )}
    </div>
  );
};

export default SliderControl;