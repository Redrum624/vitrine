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
  suffix?: string;
  defaultValue?: number;
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
  suffix = '',
  defaultValue = 0,
}) => {
  const displayValue = precision > 0 ? value.toFixed(precision) : Math.round(value);
  const displayUnit = suffix || (showPercentage ? '%' : unit);
  const sliderId = React.useId();
  const labelId = `${sliderId}-label`;
  const descriptionId = description ? `${sliderId}-description` : undefined;

  return (
    <div className={`flex flex-col space-y-1 ${className}`}>
      <div className="flex justify-between items-center">
        <label
          id={labelId}
          htmlFor={sliderId}
          className="text-xs text-dark-300"
        >
          {label}
        </label>
        <span className="text-xs text-dark-400">{displayValue}{displayUnit}</span>
      </div>
      <input
        id={sliderId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onDoubleClick={() => onChange(defaultValue)}
        disabled={disabled}
        className="w-full h-2 border border-dark-700 rounded-lg appearance-none cursor-pointer slider-thumb visible-track disabled:opacity-50"
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${displayValue}${displayUnit}`}
        role="slider"
        title="Double-click to reset to default"
      />
      {description && (
        <div
          id={descriptionId}
          className="text-xs text-gray-400"
        >
          {description}
        </div>
      )}
    </div>
  );
};

export default SliderControl;