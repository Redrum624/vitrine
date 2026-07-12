/**
 * Image filter utilities - pure functions operating on Float32Array RGBA data (0-1 normalized)
 */

export interface FilterContext {
  width: number;
  height: number;
  channels: number; // typically 4 (RGBA)
}

// ─── Gaussian Blur ───────────────────────────────────────────────────────────

function createGaussianKernel(radius: number): { kernel: number[]; size: number } {
  const size = Math.max(1, Math.round(radius)) * 2 + 1;
  const sigma = radius / 3;
  const kernel: number[] = [];
  let sum = 0;

  for (let i = 0; i < size; i++) {
    const x = i - Math.floor(size / 2);
    const val = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel.push(val);
    sum += val;
  }

  // Normalize
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }

  return { kernel, size };
}

export function applyGaussianBlur(
  input: Float32Array,
  ctx: FilterContext,
  radius: number
): Float32Array {
  if (radius <= 0) return new Float32Array(input);

  const { width, height, channels } = ctx;
  const { kernel, size } = createGaussianKernel(radius);
  const half = Math.floor(size / 2);

  // Separable blur: horizontal pass then vertical pass
  const temp = new Float32Array(input.length);
  const output = new Float32Array(input.length);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < size; k++) {
        const sx = Math.min(width - 1, Math.max(0, x + k - half));
        const idx = (y * width + sx) * channels;
        r += input[idx] * kernel[k];
        g += input[idx + 1] * kernel[k];
        b += input[idx + 2] * kernel[k];
      }
      const oidx = (y * width + x) * channels;
      temp[oidx] = r;
      temp[oidx + 1] = g;
      temp[oidx + 2] = b;
      temp[oidx + 3] = input[oidx + 3]; // preserve alpha
    }
  }

  // Vertical pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < size; k++) {
        const sy = Math.min(height - 1, Math.max(0, y + k - half));
        const idx = (sy * width + x) * channels;
        r += temp[idx] * kernel[k];
        g += temp[idx + 1] * kernel[k];
        b += temp[idx + 2] * kernel[k];
      }
      const oidx = (y * width + x) * channels;
      output[oidx] = r;
      output[oidx + 1] = g;
      output[oidx + 2] = b;
      output[oidx + 3] = temp[oidx + 3];
    }
  }

  return output;
}

// ─── Vignette ────────────────────────────────────────────────────────────────

export function applyVignette(
  input: Float32Array,
  ctx: FilterContext,
  amount: number, // 0-1, how strong the darkening is
  roundness: number = 0.5 // 0-1, how round vs oval
): Float32Array {
  if (amount <= 0) return new Float32Array(input);

  const { width, height, channels } = ctx;
  const output = new Float32Array(input.length);
  const cx = width / 2;
  const cy = height / 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / cx;
      const dy = (y - cy) / cy;
      // Elliptical distance based on roundness
      const dist = Math.sqrt(dx * dx + dy * dy * (1 + (1 - roundness)));
      // Smooth falloff using cosine curve
      const falloff = Math.max(0, Math.min(1, dist));
      const factor = 1 - amount * falloff * falloff;

      const idx = (y * width + x) * channels;
      output[idx] = input[idx] * factor;
      output[idx + 1] = input[idx + 1] * factor;
      output[idx + 2] = input[idx + 2] * factor;
      output[idx + 3] = input[idx + 3];
    }
  }

  return output;
}

// ─── Film Grain ──────────────────────────────────────────────────────────────

// Simple seeded PRNG for deterministic grain
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export function applyFilmGrain(
  input: Float32Array,
  ctx: FilterContext,
  amount: number, // 0-1 intensity
  size: number = 1, // grain size (1 = fine, 2+ = coarser)
  seed: number = 42
): Float32Array {
  if (amount <= 0) return new Float32Array(input);

  const { width, height, channels } = ctx;
  const output = new Float32Array(input.length);
  const rand = seededRandom(seed);

  // For coarser grain, generate at lower resolution and upscale
  const grainW = Math.max(1, Math.ceil(width / size));
  const grainH = Math.max(1, Math.ceil(height / size));
  const grainMap = new Float32Array(grainW * grainH);

  for (let i = 0; i < grainMap.length; i++) {
    // Generate grain with gaussian-like distribution using Box-Muller
    const u1 = rand();
    const u2 = rand();
    grainMap[i] = Math.sqrt(-2 * Math.log(Math.max(0.0001, u1))) * Math.cos(2 * Math.PI * u2);
  }

  const intensity = amount * 0.15; // Scale to reasonable range

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = Math.min(grainW - 1, Math.floor(x / size));
      const gy = Math.min(grainH - 1, Math.floor(y / size));
      const grain = grainMap[gy * grainW + gx] * intensity;

      const idx = (y * width + x) * channels;
      // Luminance-dependent grain (more visible in midtones)
      const lum = input[idx] * 0.2126 + input[idx + 1] * 0.7152 + input[idx + 2] * 0.0722;
      const lumFactor = 4 * lum * (1 - lum); // Peaks at lum=0.5

      output[idx] = Math.max(0, Math.min(1, input[idx] + grain * lumFactor));
      output[idx + 1] = Math.max(0, Math.min(1, input[idx + 1] + grain * lumFactor));
      output[idx + 2] = Math.max(0, Math.min(1, input[idx + 2] + grain * lumFactor));
      output[idx + 3] = input[idx + 3];
    }
  }

  return output;
}

// ─── Auto Levels ─────────────────────────────────────────────────────────────

function computeHistogram(data: Float32Array, channels: number): { r: number[]; g: number[]; b: number[] } {
  const bins = 256;
  const r = new Array(bins).fill(0);
  const g = new Array(bins).fill(0);
  const b = new Array(bins).fill(0);

  for (let i = 0; i < data.length; i += channels) {
    r[Math.min(255, Math.max(0, Math.round(data[i] * 255)))]++;
    g[Math.min(255, Math.max(0, Math.round(data[i + 1] * 255)))]++;
    b[Math.min(255, Math.max(0, Math.round(data[i + 2] * 255)))]++;
  }

  return { r, g, b };
}

function findClipPoints(histogram: number[], totalPixels: number, clipPercent: number = 0.1): { low: number; high: number } {
  const clipCount = totalPixels * clipPercent / 100;
  let low = 0, high = 255;
  let cumLow = 0, cumHigh = 0;

  for (let i = 0; i < 256; i++) {
    cumLow += histogram[i];
    if (cumLow > clipCount) { low = i; break; }
  }

  for (let i = 255; i >= 0; i--) {
    cumHigh += histogram[i];
    if (cumHigh > clipCount) { high = i; break; }
  }

  return { low, high };
}

export function applyAutoLevels(
  input: Float32Array,
  ctx: FilterContext
): Float32Array {
  const { channels } = ctx;
  const totalPixels = input.length / channels;
  const hist = computeHistogram(input, channels);
  const output = new Float32Array(input.length);

  const rClip = findClipPoints(hist.r, totalPixels);
  const gClip = findClipPoints(hist.g, totalPixels);
  const bClip = findClipPoints(hist.b, totalPixels);

  for (let i = 0; i < input.length; i += channels) {
    output[i] = Math.max(0, Math.min(1, (input[i] * 255 - rClip.low) / Math.max(1, rClip.high - rClip.low)));
    output[i + 1] = Math.max(0, Math.min(1, (input[i + 1] * 255 - gClip.low) / Math.max(1, gClip.high - gClip.low)));
    output[i + 2] = Math.max(0, Math.min(1, (input[i + 2] * 255 - bClip.low) / Math.max(1, bClip.high - bClip.low)));
    output[i + 3] = input[i + 3];
  }

  return output;
}

// ─── Auto Contrast ───────────────────────────────────────────────────────────

export function applyAutoContrast(
  input: Float32Array,
  ctx: FilterContext
): Float32Array {
  const { channels } = ctx;
  const totalPixels = input.length / channels;

  // Compute luminance histogram
  const lumHist = new Array(256).fill(0);
  for (let i = 0; i < input.length; i += channels) {
    const lum = input[i] * 0.2126 + input[i + 1] * 0.7152 + input[i + 2] * 0.0722;
    lumHist[Math.min(255, Math.max(0, Math.round(lum * 255)))]++;
  }

  const clip = findClipPoints(lumHist, totalPixels, 0.5);
  const range = Math.max(1, clip.high - clip.low);
  const output = new Float32Array(input.length);

  for (let i = 0; i < input.length; i += channels) {
    output[i] = Math.max(0, Math.min(1, (input[i] * 255 - clip.low) / range));
    output[i + 1] = Math.max(0, Math.min(1, (input[i + 1] * 255 - clip.low) / range));
    output[i + 2] = Math.max(0, Math.min(1, (input[i + 2] * 255 - clip.low) / range));
    output[i + 3] = input[i + 3];
  }

  return output;
}

// ─── Auto Color ──────────────────────────────────────────────────────────────

export function applyAutoColor(
  input: Float32Array,
  ctx: FilterContext
): Float32Array {
  const { channels } = ctx;
  const pixelCount = input.length / channels;
  const output = new Float32Array(input.length);

  // Calculate average color
  let avgR = 0, avgG = 0, avgB = 0;
  for (let i = 0; i < input.length; i += channels) {
    avgR += input[i];
    avgG += input[i + 1];
    avgB += input[i + 2];
  }
  avgR /= pixelCount;
  avgG /= pixelCount;
  avgB /= pixelCount;

  // Target: neutral gray at the average luminance
  const avgLum = avgR * 0.2126 + avgG * 0.7152 + avgB * 0.0722;

  // Compute correction factors to neutralize color cast
  const corrR = avgR > 0.001 ? avgLum / avgR : 1;
  const corrG = avgG > 0.001 ? avgLum / avgG : 1;
  const corrB = avgB > 0.001 ? avgLum / avgB : 1;

  for (let i = 0; i < input.length; i += channels) {
    output[i] = Math.max(0, Math.min(1, input[i] * corrR));
    output[i + 1] = Math.max(0, Math.min(1, input[i + 1] * corrG));
    output[i + 2] = Math.max(0, Math.min(1, input[i + 2] * corrB));
    output[i + 3] = input[i + 3];
  }

  return output;
}

// ─── Image Rotation (90° increments) ─────────────────────────────────────────

export function rotateImage90CW(
  input: Float32Array,
  ctx: FilterContext
): { data: Float32Array; width: number; height: number } {
  const { width, height, channels } = ctx;
  const newWidth = height;
  const newHeight = width;
  const output = new Float32Array(newWidth * newHeight * channels);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * channels;
      const dstX = height - 1 - y;
      const dstY = x;
      const dstIdx = (dstY * newWidth + dstX) * channels;
      for (let c = 0; c < channels; c++) {
        output[dstIdx + c] = input[srcIdx + c];
      }
    }
  }

  return { data: output, width: newWidth, height: newHeight };
}

export function rotateImage90CCW(
  input: Float32Array,
  ctx: FilterContext
): { data: Float32Array; width: number; height: number } {
  const { width, height, channels } = ctx;
  const newWidth = height;
  const newHeight = width;
  const output = new Float32Array(newWidth * newHeight * channels);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * channels;
      const dstX = y;
      const dstY = width - 1 - x;
      const dstIdx = (dstY * newWidth + dstX) * channels;
      for (let c = 0; c < channels; c++) {
        output[dstIdx + c] = input[srcIdx + c];
      }
    }
  }

  return { data: output, width: newWidth, height: newHeight };
}

// ─── Flip operations ─────────────────────────────────────────────────────────

export function flipHorizontal(
  input: Float32Array,
  ctx: FilterContext
): Float32Array {
  const { width, height, channels } = ctx;
  const output = new Float32Array(input.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * channels;
      const dstIdx = (y * width + (width - 1 - x)) * channels;
      for (let c = 0; c < channels; c++) {
        output[dstIdx + c] = input[srcIdx + c];
      }
    }
  }

  return output;
}

export function flipVertical(
  input: Float32Array,
  ctx: FilterContext
): Float32Array {
  const { width, height, channels } = ctx;
  const output = new Float32Array(input.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * channels;
      const dstIdx = ((height - 1 - y) * width + x) * channels;
      for (let c = 0; c < channels; c++) {
        output[dstIdx + c] = input[srcIdx + c];
      }
    }
  }

  return output;
}

// ─── Image Resize (Bilinear) ─────────────────────────────────────────────────

export function resizeImage(
  input: Float32Array,
  ctx: FilterContext,
  newWidth: number,
  newHeight: number
): { data: Float32Array; width: number; height: number } {
  const { width, height, channels } = ctx;
  const output = new Float32Array(newWidth * newHeight * channels);

  const xRatio = width / newWidth;
  const yRatio = height / newHeight;

  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const srcX = x * xRatio;
      const srcY = y * yRatio;
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const xFrac = srcX - x0;
      const yFrac = srcY - y0;

      const dstIdx = (y * newWidth + x) * channels;

      for (let c = 0; c < channels; c++) {
        const tl = input[(y0 * width + x0) * channels + c];
        const tr = input[(y0 * width + x1) * channels + c];
        const bl = input[(y1 * width + x0) * channels + c];
        const br = input[(y1 * width + x1) * channels + c];

        // Bilinear interpolation
        const top = tl + (tr - tl) * xFrac;
        const bottom = bl + (br - bl) * xFrac;
        output[dstIdx + c] = top + (bottom - top) * yFrac;
      }
    }
  }

  return { data: output, width: newWidth, height: newHeight };
}
