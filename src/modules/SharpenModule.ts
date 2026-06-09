import { logger } from '../utils/Logger';
import { applyGaussianBlur } from '../utils/ImageFilters';

/**
 * SharpenModule - Non-destructive capture/creative sharpening for the processing
 * pipeline. This is the develop-time replacement for the old export-only "Output
 * Sharpening" (which lived in the Export dialog). Because it runs inside the
 * pipeline it is WYSIWYG: the canvas preview and the full-resolution export apply
 * the exact same unsharp mask.
 *
 * Algorithm: unsharp mask. A separable Gaussian blur produces a low-pass copy;
 * the high-pass detail (original - blur) is scaled by `amount` and added back.
 * `detail` is a noise-protection threshold — local contrast below it is left
 * untouched so smooth areas / sensor noise aren't amplified.
 */

export interface SharpenParams {
  enabled: boolean;   // master toggle (kept for persistence/consistency)
  amount: number;     // 0-150 (%), sharpening strength. 0 = off (identity)
  radius: number;     // 0.5-3.0 px, unsharp-mask blur radius
  detail: number;     // 0-100, edge threshold — protects low-contrast areas
  [key: string]: unknown; // Index signature for Record compatibility
}

export interface SharpenContext {
  width: number;
  height: number;
  channels: number;
}

const DEFAULTS: SharpenParams = {
  enabled: true,
  amount: 0,
  radius: 1.0,
  detail: 25,
};

export class SharpenModule {
  private params: SharpenParams = { ...DEFAULTS };

  getId(): string {
    return 'sharpen';
  }

  getName(): string {
    return 'Sharpen';
  }

  getParams(): SharpenParams {
    return { ...this.params };
  }

  setParams(params: Partial<SharpenParams>): void {
    this.params = { ...this.params, ...this.validateParams(params) };
    logger.debug('Sharpen params updated:', this.params);
  }

  resetParams(): void {
    this.params = { ...DEFAULTS };
    logger.debug('Sharpen params reset to defaults');
  }

  private validateParams(params: Partial<SharpenParams>): Partial<SharpenParams> {
    const v: Partial<SharpenParams> = {};
    if (params.enabled !== undefined) v.enabled = Boolean(params.enabled);
    if (params.amount !== undefined) v.amount = clamp(params.amount as number, 0, 150);
    if (params.radius !== undefined) v.radius = clamp(params.radius as number, 0.1, 5);
    if (params.detail !== undefined) v.detail = clamp(params.detail as number, 0, 100);
    return v;
  }

  /** True when the module would leave the image unchanged (used for pipeline skip). */
  isIdentity(): boolean {
    return !this.params.enabled || this.params.amount <= 0;
  }

  /**
   * Apply the unsharp mask. Returns a fresh buffer; the input is never mutated.
   */
  process(input: Float32Array, context: SharpenContext): Float32Array {
    if (this.isIdentity()) {
      return new Float32Array(input);
    }

    const { width, height } = context;
    const startTime = performance.now();

    // Reuse the shared separable Gaussian blur (RGBA, alpha-preserving).
    const blurred = applyGaussianBlur(input, { width, height, channels: 4 }, this.params.radius);

    const strength = this.params.amount / 100;          // 0..1.5
    const threshold = (this.params.detail / 100) * 0.1; // 0..0.1 normalized luminance contrast
    const output = new Float32Array(input);             // copies alpha through

    for (let i = 0; i < input.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const original = input[i + c];
        let detail = original - blurred[i + c];
        // Suppress low-contrast detail (noise protection).
        if (Math.abs(detail) < threshold) detail = 0;
        output[i + c] = Math.min(1, Math.max(0, original + detail * strength));
      }
    }

    logger.debug(`Sharpen processed in ${(performance.now() - startTime).toFixed(2)}ms ` +
      `(amount=${this.params.amount}, radius=${this.params.radius}, detail=${this.params.detail})`);
    return output;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Singleton instance (mirrors the other module singletons).
export const sharpenModule = new SharpenModule();
