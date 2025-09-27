import React from 'react';

interface ColoredSliderControlProps {
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
  color: string;
  description?: string;
}

const ColoredSliderControl: React.FC<ColoredSliderControlProps> = ({
  label,
  value,
  min = -100,
  max = 100,
  step = 1,
  onChange,
  disabled = false,
  unit = '%',
  precision = 0,
  className = '',
  color,
  description = '',
}) => {
  const displayValue = precision > 0 ? value.toFixed(precision) : Math.round(value);
  const sliderId = React.useId();
  const labelId = `${sliderId}-label`;
  const descriptionId = description ? `${sliderId}-description` : undefined;

  // Calculate position percentage for centering at 0
  const range = max - min;
  const centerPosition = (-min / range) * 100;

  // Create gradient for the slider track
  const getGradientStyle = () => {
    if (unit === '%') {
      // For saturation/luminance: gray to color to gray
      return {
        background: `linear-gradient(to right, #6b7280 0%, ${color} 50%, #6b7280 100%)`
      };
    } else if (unit === '°') {
      // For hue: full color spectrum around this hue
      const hexValue = parseInt(color.replace('#', ''), 16);
      const baseHue = ((hexValue >> 16) * 0.3 + ((hexValue >> 8) & 0xFF) * 0.59 + (hexValue & 0xFF) * 0.11) / 255 * 360;
      return {
        background: `linear-gradient(to right,
          hsl(${(baseHue - 180 + 360) % 360}, 80%, 50%) 0%,
          hsl(${baseHue}, 80%, 50%) 50%,
          hsl(${(baseHue + 180) % 360}, 80%, 50%) 100%)`
      };
    }
    return { background: `linear-gradient(to right, #6b7280 0%, ${color} 50%, #6b7280 100%)` };
  };

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
        <span className="text-xs text-dark-400">{displayValue}{unit}</span>
      </div>
      <div className="relative">
        {/* Gradient background track */}
        <div
          className="w-full h-2 rounded-lg relative overflow-hidden"
          style={getGradientStyle()}
        >
          {/* Center line indicator */}
          <div
            className="absolute top-0 h-full w-0.5 bg-white opacity-50"
            style={{ left: `${centerPosition}%` }}
          />
        </div>

        {/* Slider input */}
        <input
          id={sliderId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          disabled={disabled}
          className="absolute top-0 w-full h-2 appearance-none bg-transparent cursor-pointer slider-thumb disabled:opacity-50"
          style={{
            background: 'transparent',
          }}
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={`${displayValue}${unit}`}
          role="slider"
        />
      </div>
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

export default ColoredSliderControl;