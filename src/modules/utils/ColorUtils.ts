/**
 * Shared color utility functions for image processing modules.
 * Consolidates duplicate RGB/HSL conversions and common math functions.
 */

// ============================================================================
// Constants
// ============================================================================

/** Standard sRGB luminance weights (Rec. 709) */
export const LUMINANCE_WEIGHTS = {
  R: 0.2126,
  G: 0.7152,
  B: 0.0722
} as const;

/** Perceived luminance weights (traditional) */
export const PERCEIVED_LUMINANCE_WEIGHTS = {
  R: 0.299,
  G: 0.587,
  B: 0.114
} as const;

// ============================================================================
// Input Validation
// ============================================================================

/**
 * Validates that input array dimensions match expected size.
 * @throws Error if dimensions don't match
 */
export function validateInputDimensions(
  input: Float32Array,
  width: number,
  height: number,
  channels: number,
  moduleName: string
): void {
  const expectedLength = width * height * channels;
  if (input.length !== expectedLength) {
    throw new Error(
      `${moduleName}: Input array length (${input.length}) doesn't match ` +
      `dimensions ${width}x${height}x${channels} (expected ${expectedLength})`
    );
  }
  if (width <= 0 || height <= 0) {
    throw new Error(`${moduleName}: Invalid dimensions ${width}x${height}`);
  }
  if (channels < 3 || channels > 4) {
    throw new Error(`${moduleName}: Invalid channel count ${channels} (expected 3 or 4)`);
  }
}

/**
 * Validates numeric parameter is within range.
 * @returns Clamped value within range
 */
export function validateNumericParam(
  value: unknown,
  min: number,
  max: number,
  defaultValue: number,
  _paramName?: string
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.max(min, Math.min(max, value));
}

// ============================================================================
// Color Space Conversions
// ============================================================================

/**
 * Convert RGB to HSL color space.
 * @param r Red component (0-1)
 * @param g Green component (0-1)
 * @param b Blue component (0-1)
 * @returns [hue (0-360), saturation (0-100), lightness (0-100)]
 */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;
  const sum = max + min;

  let h = 0;
  const l = sum / 2;
  let s = 0;

  if (diff !== 0) {
    s = l > 0.5 ? diff / (2 - sum) : diff / sum;

    switch (max) {
      case r:
        h = (g - b) / diff + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / diff + 2;
        break;
      case b:
        h = (r - g) / diff + 4;
        break;
    }
    h /= 6;
  }

  return [h * 360, s * 100, l * 100];
}

/**
 * Convert HSL to RGB color space.
 * @param h Hue (0-360)
 * @param s Saturation (0-100)
 * @param l Lightness (0-100)
 * @returns [red, green, blue] each in range 0-1
 */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360; // Normalize hue
  s = Math.max(0, Math.min(100, s)) / 100; // Clamp and normalize saturation
  l = Math.max(0, Math.min(100, l)) / 100; // Clamp and normalize lightness

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;

  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  return [r + m, g + m, b + m];
}

/**
 * Convert RGB to HSV color space.
 * @param r Red component (0-1)
 * @param g Green component (0-1)
 * @param b Blue component (0-1)
 * @returns [hue (0-360), saturation (0-1), value (0-1)]
 */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  const s = max === 0 ? 0 : delta / max;
  const v = max;

  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  return [h, s, v];
}

/**
 * Convert HSV to RGB color space.
 * @param h Hue (0-360)
 * @param s Saturation (0-1)
 * @param v Value (0-1)
 * @returns [red, green, blue] each in range 0-1
 */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  v = Math.max(0, Math.min(1, v));

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0, g = 0, b = 0;

  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  return [r + m, g + m, b + m];
}

/**
 * Extract hue and saturation from RGB (without full HSL conversion).
 * Useful for color range operations.
 * @param r Red component (0-1)
 * @param g Green component (0-1)
 * @param b Blue component (0-1)
 * @returns [hue (0-360), saturation (0-1)]
 */
export function rgbToHS(r: number, g: number, b: number): [number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  const s = max === 0 ? 0 : delta / max;

  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  return [h, s];
}

// ============================================================================
// Luminance Calculations
// ============================================================================

/**
 * Calculate perceived luminance using standard weights.
 * @param r Red component (0-1)
 * @param g Green component (0-1)
 * @param b Blue component (0-1)
 * @returns Luminance value (0-1)
 */
export function calculateLuminance(r: number, g: number, b: number): number {
  return PERCEIVED_LUMINANCE_WEIGHTS.R * r +
         PERCEIVED_LUMINANCE_WEIGHTS.G * g +
         PERCEIVED_LUMINANCE_WEIGHTS.B * b;
}

/**
 * Calculate sRGB luminance using Rec. 709 weights.
 * @param r Red component (0-1)
 * @param g Green component (0-1)
 * @param b Blue component (0-1)
 * @returns Luminance value (0-1)
 */
export function calculateSrgbLuminance(r: number, g: number, b: number): number {
  return LUMINANCE_WEIGHTS.R * r +
         LUMINANCE_WEIGHTS.G * g +
         LUMINANCE_WEIGHTS.B * b;
}

// ============================================================================
// Interpolation Functions
// ============================================================================

/**
 * Perform smooth Hermite interpolation between two edge values.
 * @param edge0 Lower edge
 * @param edge1 Upper edge
 * @param x Input value
 * @returns Smooth interpolation (0-1)
 */
export function smoothStep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Linear interpolation between two values.
 * @param a Start value
 * @param b End value
 * @param t Interpolation factor (0-1)
 * @returns Interpolated value
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Clamp value to range [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Clamp RGB values to valid 0-1 range.
 */
export function clampRgb(r: number, g: number, b: number): [number, number, number] {
  return [
    Math.max(0, Math.min(1, r)),
    Math.max(0, Math.min(1, g)),
    Math.max(0, Math.min(1, b))
  ];
}

// ============================================================================
// Color Temperature
// ============================================================================

/**
 * Convert color temperature to RGB multipliers.
 * Based on Tanner Helland's algorithm.
 * @param temperature Color temperature in Kelvin (1000-40000)
 * @returns RGB multipliers normalized to 0-1
 */
export function temperatureToRgb(temperature: number): { r: number; g: number; b: number } {
  temperature = Math.max(1000, Math.min(40000, temperature)) / 100;

  let r: number, g: number, b: number;

  // Calculate red
  if (temperature <= 66) {
    r = 255;
  } else {
    r = temperature - 60;
    r = 329.698727446 * Math.pow(r, -0.1332047592);
    r = Math.max(0, Math.min(255, r));
  }

  // Calculate green
  if (temperature <= 66) {
    g = temperature;
    g = 99.4708025861 * Math.log(g) - 161.1195681661;
    g = Math.max(0, Math.min(255, g));
  } else {
    g = temperature - 60;
    g = 288.1221695283 * Math.pow(g, -0.0755148492);
    g = Math.max(0, Math.min(255, g));
  }

  // Calculate blue
  if (temperature >= 66) {
    b = 255;
  } else {
    if (temperature <= 19) {
      b = 0;
    } else {
      b = temperature - 10;
      b = 138.5177312231 * Math.log(b) - 305.0447927307;
      b = Math.max(0, Math.min(255, b));
    }
  }

  // Normalize to 0-1 range
  return {
    r: r / 255,
    g: g / 255,
    b: b / 255
  };
}

// ============================================================================
// Safe Math Operations
// ============================================================================

/**
 * Safe division that prevents divide-by-zero errors.
 * @param numerator The numerator
 * @param denominator The denominator
 * @param fallback Value to return if denominator is zero (default: 0)
 * @returns Result of division or fallback
 */
export function safeDivide(numerator: number, denominator: number, fallback: number = 0): number {
  if (denominator === 0 || !Number.isFinite(denominator)) {
    return fallback;
  }
  return numerator / denominator;
}
