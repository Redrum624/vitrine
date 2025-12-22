/**
 * Test Utilities for Image Processing Module Tests
 *
 * Provides helper functions for creating test images and comparing results.
 */

/**
 * Create a test image with uniform color
 * @param width Image width in pixels
 * @param height Image height in pixels
 * @param r Red value (0-1)
 * @param g Green value (0-1)
 * @param b Blue value (0-1)
 * @param a Alpha value (0-1), defaults to 1.0
 * @returns Float32Array with RGBA pixel data
 */
export function createTestImage(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a: number = 1.0
): Float32Array {
  const channels = 4;
  const data = new Float32Array(width * height * channels);

  for (let i = 0; i < data.length; i += channels) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }

  return data;
}

/**
 * Create a gradient test image (R increases left-to-right, G increases top-to-bottom)
 * @param width Image width in pixels
 * @param height Image height in pixels
 * @returns Float32Array with RGBA pixel data
 */
export function createGradientImage(width: number, height: number): Float32Array {
  const channels = 4;
  const data = new Float32Array(width * height * channels);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      data[idx] = x / (width - 1);     // R: 0 to 1 left-to-right
      data[idx + 1] = y / (height - 1); // G: 0 to 1 top-to-bottom
      data[idx + 2] = 0.5;              // B: constant
      data[idx + 3] = 1.0;              // A: opaque
    }
  }

  return data;
}

/**
 * Create a test image with noise pattern
 * @param width Image width in pixels
 * @param height Image height in pixels
 * @param seed Optional seed for reproducible noise (not truly random)
 * @returns Float32Array with RGBA pixel data
 */
export function createNoiseImage(width: number, height: number, seed: number = 42): Float32Array {
  const channels = 4;
  const data = new Float32Array(width * height * channels);

  // Simple pseudo-random number generator for reproducibility
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };

  for (let i = 0; i < data.length; i += channels) {
    data[i] = random();
    data[i + 1] = random();
    data[i + 2] = random();
    data[i + 3] = 1.0;
  }

  return data;
}

/**
 * Compare two images within a tolerance
 * @param a First image data
 * @param b Second image data
 * @param tolerance Maximum allowed difference per channel (default 0.001)
 * @returns true if images are equal within tolerance
 */
export function imagesEqual(
  a: Float32Array,
  b: Float32Array,
  tolerance: number = 0.001
): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > tolerance) {
      return false;
    }
  }

  return true;
}

/**
 * Get pixel value at specified coordinates
 * @param data Image data array
 * @param width Image width
 * @param x X coordinate
 * @param y Y coordinate
 * @param channels Number of channels (default 4)
 * @returns Array of channel values [r, g, b, a?]
 */
export function getPixel(
  data: Float32Array,
  width: number,
  x: number,
  y: number,
  channels: number = 4
): number[] {
  const idx = (y * width + x) * channels;
  const pixel: number[] = [];

  for (let c = 0; c < channels; c++) {
    pixel.push(data[idx + c]);
  }

  return pixel;
}

/**
 * Set pixel value at specified coordinates
 * @param data Image data array
 * @param width Image width
 * @param x X coordinate
 * @param y Y coordinate
 * @param values Array of channel values [r, g, b, a?]
 * @param channels Number of channels (default 4)
 */
export function setPixel(
  data: Float32Array,
  width: number,
  x: number,
  y: number,
  values: number[],
  channels: number = 4
): void {
  const idx = (y * width + x) * channels;

  for (let c = 0; c < Math.min(channels, values.length); c++) {
    data[idx + c] = values[c];
  }
}

/**
 * Calculate average pixel value across all pixels
 * @param data Image data array
 * @param channels Number of channels (default 4)
 * @returns Array of average values per channel
 */
export function calculateAveragePixel(
  data: Float32Array,
  channels: number = 4
): number[] {
  const sums = new Array(channels).fill(0);
  const pixelCount = data.length / channels;

  for (let i = 0; i < data.length; i += channels) {
    for (let c = 0; c < channels; c++) {
      sums[c] += data[i + c];
    }
  }

  return sums.map(sum => sum / pixelCount);
}

/**
 * Check if all pixel values are within valid range [0, 1]
 * @param data Image data array
 * @returns true if all values are in valid range
 */
export function isValidImageData(data: Float32Array): boolean {
  for (let i = 0; i < data.length; i++) {
    if (data[i] < 0 || data[i] > 1 || !Number.isFinite(data[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Create processing context for module tests
 * @param width Image width
 * @param height Image height
 * @param channels Number of channels (default 4)
 */
export function createProcessingContext(width: number, height: number, channels: number = 4) {
  return { width, height, channels };
}

/**
 * Calculate maximum difference between two images
 * @param a First image data
 * @param b Second image data
 * @returns Maximum absolute difference found
 */
export function maxImageDifference(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error('Images must have same length');
  }

  let maxDiff = 0;
  for (let i = 0; i < a.length; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
  }

  return maxDiff;
}
