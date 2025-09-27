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
  const sliderId = `slider-${label.toLowerCase().replace(/\s+/g, '-')}`;

  // ACCESSIBILITY FIX: Add keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const stepSize = step || 1;
    let newValue = value;

    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault();
        newValue = Math.max(min, value - stepSize);
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault();
        newValue = Math.min(max, value + stepSize);
        break;
      case 'Home':
        e.preventDefault();
        newValue = min;
        break;
      case 'End':
        e.preventDefault();
        newValue = max;
        break;
      case 'PageDown':
        e.preventDefault();
        newValue = Math.max(min, value - stepSize * 10);
        break;
      case 'PageUp':
        e.preventDefault();
        newValue = Math.min(max, value + stepSize * 10);
        break;
      default:
        return;
    }

    if (newValue !== value) {
      onChange(newValue);
    }
  };

  return (
    <div className={`flex flex-col space-y-1 ${className}`}>
      <div className="flex justify-between items-center">
        <label
          htmlFor={sliderId}
          className="text-sm font-medium text-gray-700"
        >
          {label}
        </label>
        <span className="text-sm text-gray-500">
          {displayValue}{displayUnit}
        </span>
      </div>
      <input
        id={sliderId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        // ACCESSIBILITY FIXES: Add ARIA attributes
        aria-label={label}
        aria-describedby={description ? `${sliderId}-desc` : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${displayValue}${displayUnit}`}
        tabIndex={disabled ? -1 : 0}
        role="slider"
      />
      {description && (
        <div
          id={`${sliderId}-desc`}
          className="text-xs text-gray-400"
        >
          {description}
        </div>
      )}
    </div>
  );
};

export default SliderControl;
