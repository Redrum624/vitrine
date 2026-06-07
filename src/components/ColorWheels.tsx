/**
 * ColorWheels Component - Lift/Gamma/Gain Color Wheels
 *
 * Professional color grading UI with three circular color pickers:
 * - Lift (shadows): Adjusts dark tones
 * - Gamma (midtones): Adjusts middle tones
 * - Gain (highlights): Adjusts bright tones
 *
 * Each wheel includes a luminance slider and reset button.
 */

// Intentionally exports both component and processing functions for API convenience

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';

/**
 * Color wheel value representing offset in color space
 */
export interface ColorWheelValue {
  // Offset from center (-1 to 1)
  x: number;
  y: number;
  // Luminance offset (-1 to 1)
  luminance: number;
}

/**
 * All three wheels combined
 */
export interface ColorWheelsValues {
  lift: ColorWheelValue;
  gamma: ColorWheelValue;
  gain: ColorWheelValue;
  masterLuminance: number;
}

/**
 * Props for ColorWheels component
 */
interface ColorWheelsProps {
  values: ColorWheelsValues;
  onChange: (values: ColorWheelsValues) => void;
  size?: number;
  disabled?: boolean;
  className?: string;
}

/**
 * Default neutral values
 */
export const defaultColorWheelsValues: ColorWheelsValues = {
  lift: { x: 0, y: 0, luminance: 0 },
  gamma: { x: 0, y: 0, luminance: 0 },
  gain: { x: 0, y: 0, luminance: 0 },
  masterLuminance: 0,
};

/**
 * Individual color wheel component
 */
interface SingleWheelProps {
  label: string;
  value: ColorWheelValue;
  onChange: (value: ColorWheelValue) => void;
  onReset: () => void;
  size: number;
  disabled?: boolean;
}

const SingleWheel: React.FC<SingleWheelProps> = ({
  label,
  value,
  onChange,
  onReset,
  size,
  disabled = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const wheelRadius = size / 2 - 10;
  const centerX = size / 2;
  const centerY = size / 2;

  // Draw the color wheel
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = size;
    canvas.height = size;

    // Clear
    ctx.clearRect(0, 0, size, size);

    // Draw color wheel using conic gradient simulation
    const steps = 360;
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2 - Math.PI / 2;
      const nextAngle = ((i + 1) / steps) * Math.PI * 2 - Math.PI / 2;

      // Calculate color for this segment
      const hue = i;

      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, wheelRadius, angle, nextAngle);
      ctx.closePath();

      // Create radial gradient for each segment (saturation)
      const gradient = ctx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        wheelRadius
      );
      gradient.addColorStop(0, 'hsl(0, 0%, 50%)'); // Gray center
      gradient.addColorStop(0.7, `hsl(${hue}, 50%, 50%)`);
      gradient.addColorStop(1, `hsl(${hue}, 100%, 50%)`);

      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // Draw center indicator
    ctx.beginPath();
    ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw current position indicator
    const posX = centerX + value.x * wheelRadius * 0.9;
    const posY = centerY - value.y * wheelRadius * 0.9; // Invert Y for screen coords

    // Line from center to position
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(posX, posY);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Position indicator circle
    ctx.beginPath();
    ctx.arc(posX, posY, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner white fill
    ctx.beginPath();
    ctx.arc(posX, posY, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();

    // Draw wheel border
    ctx.beginPath();
    ctx.arc(centerX, centerY, wheelRadius, 0, Math.PI * 2);
    ctx.strokeStyle = disabled ? 'rgba(100, 100, 100, 0.5)' : 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Disabled overlay
    if (disabled) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.arc(centerX, centerY, wheelRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [value, size, wheelRadius, centerX, centerY, disabled]);

  // Handle position updates - defined first to be used by other handlers
  const updatePosition = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left - centerX;
      const y = -(e.clientY - rect.top - centerY); // Invert Y

      // Calculate distance from center
      const distance = Math.sqrt(x * x + y * y);
      const maxDistance = wheelRadius * 0.9;

      // Clamp to wheel radius
      let normalizedX = x / maxDistance;
      let normalizedY = y / maxDistance;

      if (distance > maxDistance) {
        const scale = maxDistance / distance;
        normalizedX = (x * scale) / maxDistance;
        normalizedY = (y * scale) / maxDistance;
      }

      // Clamp to -1 to 1
      normalizedX = Math.max(-1, Math.min(1, normalizedX));
      normalizedY = Math.max(-1, Math.min(1, normalizedY));

      onChange({
        ...value,
        x: normalizedX,
        y: normalizedY,
      });
    },
    [centerX, centerY, wheelRadius, value, onChange]
  );

  // Handle mouse/touch events
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) return;

      setIsDragging(true);
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      updatePosition(e);
    },
    [disabled, updatePosition]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDragging || disabled) return;
      updatePosition(e);
    },
    [isDragging, disabled, updatePosition]
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleLuminanceChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({
        ...value,
        luminance: parseFloat(e.target.value),
      });
    },
    [value, onChange]
  );

  const isNeutral = value.x === 0 && value.y === 0 && value.luminance === 0;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Label and reset button */}
      <div className="flex items-center justify-between w-full px-2">
        <span className="text-sm font-medium text-gray-300">{label}</span>
        <button
          onClick={onReset}
          disabled={disabled || isNeutral}
          className={`p-1 rounded hover:bg-gray-700 transition-colors ${
            isNeutral || disabled ? 'opacity-30 cursor-not-allowed' : 'opacity-70 hover:opacity-100'
          }`}
          title="Reset"
        >
          <RotateCcw size={14} />
        </button>
      </div>

      {/* Color wheel canvas */}
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className={`cursor-crosshair ${disabled ? 'cursor-not-allowed' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />

      {/* Luminance slider */}
      <div className="w-full px-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-8">Lum</span>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={value.luminance}
            onChange={handleLuminanceChange}
            disabled={disabled}
            className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <span className="text-xs text-gray-400 w-10 text-right">
            {(value.luminance * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Value display */}
      <div className="text-xs text-gray-500 font-mono">
        {value.x.toFixed(2)}, {value.y.toFixed(2)}
      </div>
    </div>
  );
};

/**
 * Main ColorWheels component
 */
export const ColorWheels: React.FC<ColorWheelsProps> = ({
  values,
  onChange,
  size = 120,
  disabled = false,
  className = '',
}) => {
  const handleWheelChange = useCallback(
    (wheel: 'lift' | 'gamma' | 'gain', value: ColorWheelValue) => {
      onChange({
        ...values,
        [wheel]: value,
      });
    },
    [values, onChange]
  );

  const handleReset = useCallback(
    (wheel: 'lift' | 'gamma' | 'gain') => {
      onChange({
        ...values,
        [wheel]: { x: 0, y: 0, luminance: 0 },
      });
    },
    [values, onChange]
  );

  const handleMasterLuminanceChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({
        ...values,
        masterLuminance: parseFloat(e.target.value),
      });
    },
    [values, onChange]
  );

  const handleResetAll = useCallback(() => {
    onChange(defaultColorWheelsValues);
  }, [onChange]);

  const hasChanges =
    JSON.stringify(values) !== JSON.stringify(defaultColorWheelsValues);

  return (
    <div className={`bg-gray-800 rounded-lg p-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-200">Color Wheels</h3>
        <button
          onClick={handleResetAll}
          disabled={disabled || !hasChanges}
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-gray-700 transition-colors ${
            !hasChanges || disabled ? 'opacity-30 cursor-not-allowed' : 'opacity-70 hover:opacity-100'
          }`}
        >
          <RotateCcw size={12} />
          Reset All
        </button>
      </div>

      {/* Three wheels */}
      <div className="flex justify-between gap-2">
        <SingleWheel
          label="Lift"
          value={values.lift}
          onChange={(v) => handleWheelChange('lift', v)}
          onReset={() => handleReset('lift')}
          size={size}
          disabled={disabled}
        />
        <SingleWheel
          label="Gamma"
          value={values.gamma}
          onChange={(v) => handleWheelChange('gamma', v)}
          onReset={() => handleReset('gamma')}
          size={size}
          disabled={disabled}
        />
        <SingleWheel
          label="Gain"
          value={values.gain}
          onChange={(v) => handleWheelChange('gain', v)}
          onReset={() => handleReset('gain')}
          size={size}
          disabled={disabled}
        />
      </div>

      {/* Master luminance */}
      <div className="mt-4 px-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-20">Master Lum</span>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={values.masterLuminance}
            onChange={handleMasterLuminanceChange}
            disabled={disabled}
            className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <span className="text-xs text-gray-400 w-12 text-right">
            {(values.masterLuminance * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * Convert color wheel values to RGB offsets for image processing
 * Returns RGB offsets in range -1 to 1
 */
export function colorWheelToRGB(wheel: ColorWheelValue): { r: number; g: number; b: number } {
  const { x, y, luminance } = wheel;

  // Convert XY position to angle and magnitude
  const angle = Math.atan2(y, x);
  const magnitude = Math.sqrt(x * x + y * y);

  // Convert angle to hue (0-360)
  let hue = (angle * 180) / Math.PI;
  if (hue < 0) hue += 360;

  // Convert hue to RGB offset
  const h = hue / 60;
  const sector = Math.floor(h);
  const f = h - sector;

  // Calculate RGB based on hue sector
  let r = 0, g = 0, b = 0;

  switch (sector % 6) {
    case 0: r = 1; g = f; b = 0; break;
    case 1: r = 1 - f; g = 1; b = 0; break;
    case 2: r = 0; g = 1; b = f; break;
    case 3: r = 0; g = 1 - f; b = 1; break;
    case 4: r = f; g = 0; b = 1; break;
    case 5: r = 1; g = 0; b = 1 - f; break;
  }

  // Scale by magnitude (0 at center, 1 at edge)
  r = (r - 0.5) * 2 * magnitude;
  g = (g - 0.5) * 2 * magnitude;
  b = (b - 0.5) * 2 * magnitude;

  // Add luminance offset equally to all channels
  r += luminance;
  g += luminance;
  b += luminance;

  return { r, g, b };
}

/**
 * Apply color wheels to image data
 * Uses lift/gamma/gain methodology similar to DaVinci Resolve
 */
export function applyColorWheels(
  input: Float32Array,
  values: ColorWheelsValues
): Float32Array {
  const output = new Float32Array(input.length);

  const lift = colorWheelToRGB(values.lift);
  const gamma = colorWheelToRGB(values.gamma);
  const gain = colorWheelToRGB(values.gain);
  const masterLum = values.masterLuminance;

  for (let i = 0; i < input.length; i += 4) {
    let r = input[i];
    let g = input[i + 1];
    let b = input[i + 2];

    // Apply lift (shadows) - adds to dark areas
    // Lift formula: out = in + lift * (1 - in)
    r = r + lift.r * (1 - r);
    g = g + lift.g * (1 - g);
    b = b + lift.b * (1 - b);

    // Apply gamma (midtones) - power function
    // Gamma formula: out = in ^ (1 / (1 + gamma))
    const gammaR = 1 / Math.max(0.01, 1 + gamma.r);
    const gammaG = 1 / Math.max(0.01, 1 + gamma.g);
    const gammaB = 1 / Math.max(0.01, 1 + gamma.b);

    r = Math.pow(Math.max(0, r), gammaR);
    g = Math.pow(Math.max(0, g), gammaG);
    b = Math.pow(Math.max(0, b), gammaB);

    // Apply gain (highlights) - multiplies bright areas
    // Gain formula: out = in * (1 + gain)
    r = r * (1 + gain.r);
    g = g * (1 + gain.g);
    b = b * (1 + gain.b);

    // Apply master luminance
    const lumScale = 1 + masterLum;
    r *= lumScale;
    g *= lumScale;
    b *= lumScale;

    // Clamp output
    output[i] = Math.max(0, Math.min(1, r));
    output[i + 1] = Math.max(0, Math.min(1, g));
    output[i + 2] = Math.max(0, Math.min(1, b));
    output[i + 3] = input[i + 3]; // Preserve alpha
  }

  return output;
}

export default ColorWheels;
