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
  defaultValue?: number;
  sliderType?: 'saturation' | 'luminance' | 'hue';
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
  defaultValue = 0,
  sliderType,
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
    // Use sliderType if provided, otherwise infer from unit
    const type = sliderType || (unit === '°' ? 'hue' : 'saturation');

    if (type === 'saturation') {
      // For saturation: gray to color to gray
      return {
        background: `linear-gradient(to right, #6b7280 0%, ${color} 50%, #6b7280 100%)`
      };
    } else if (type === 'luminance') {
      // For luminance: black to color to white
      return {
        background: `linear-gradient(to right, #000000 0%, ${color} 50%, #ffffff 100%)`
      };
    } else if (type === 'hue') {
      // For hue: show hue shift spectrum
      // Extract RGB from hex color
      const hexValue = parseInt(color.replace('#', ''), 16);
      const r = ((hexValue >> 16) & 0xFF) / 255;
      const g = ((hexValue >> 8) & 0xFF) / 255;
      const b = (hexValue & 0xFF) / 255;

      // Convert RGB to HSL to get base hue and saturation
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      let baseHue = 0;
      let baseSat = 0;

      if (max !== min) {
        const delta = max - min;
        baseSat = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

        if (max === r) {
          baseHue = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
        } else if (max === g) {
          baseHue = ((b - r) / delta + 2) / 6;
        } else {
          baseHue = ((r - g) / delta + 4) / 6;
        }
      }
      baseHue *= 360;
      baseSat *= 100;

      // Use higher saturation and fixed lightness for more vibrant gradient
      const saturation = Math.max(70, baseSat);
      const lightness = 50;

      // Create gradient showing hue shift with more steps for smoother transition
      return {
        background: `linear-gradient(to right,
          hsl(${(baseHue - 180 + 360) % 360}, ${saturation}%, ${lightness}%) 0%,
          hsl(${(baseHue - 90 + 360) % 360}, ${saturation}%, ${lightness}%) 25%,
          hsl(${baseHue}, ${saturation}%, ${lightness}%) 50%,
          hsl(${(baseHue + 90) % 360}, ${saturation}%, ${lightness}%) 75%,
          hsl(${(baseHue + 180) % 360}, ${saturation}%, ${lightness}%) 100%)`
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
          onDoubleClick={() => onChange(defaultValue)}
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
          title="Double-click to reset to default"
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