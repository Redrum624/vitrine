import type { PipelineModule, ProcessingContext } from '../services/ImageProcessingPipeline';
import type { ModuleParams } from '../types/darktable';
import { logger } from '../utils/Logger';

/**
 * M1 highlight reconstruction — recover blown highlight colour/detail BEYOND what LibRaw's
 * `-H` decode modes bake into the 16-bit buffer.
 *
 * Evidence (Phase-1 probe on a real blown-highlight sunset ORF, see task-s5-report.md):
 * the delivered buffer is hard-clipped at the white point (integer PPM, no over-range data),
 * and the clipping is overwhelmingly SINGLE-CHANNEL — the red channel saturates first while
 * green/blue still carry the luminance gradient (100% of clipped px are R-only under the
 * default `-H 2` blend). So the recoverable signal is a clipped channel that can be
 * reconstructed from its surviving neighbours, NOT over-range luma to tone-map.
 *
 * The pass is POINTWISE: every output pixel depends only on that pixel's own r,g,b. The
 * decoded buffer is already white-balanced (`dcraw -w`), so a neutral highlight has R≈G≈B —
 * the pixel's own surviving channels ARE the ratio guide and no spatial window is needed.
 * Because it is pointwise it needs NO tiled-pipeline apron (it is intentionally absent from
 * `tiledPipeline.ts moduleApron` → falls through to `default → 0`).
 */

/** Highlight zone starts here (on the pixel's max channel). Below → identity. */
export const HR_KNEE = 0.75;
/** Per-channel reliability band: a channel is "clipped/unreliable" as it rises CLIP_LO→CLIP_HI. */
export const HR_CLIP_LO = 0.9;
export const HR_CLIP_HI = 1.0;

export interface HighlightRecoveryParams extends ModuleParams {
  enabled: boolean;
  /** 0..100. 0 = off = byte-identical passthrough. Higher = stronger reconstruction. */
  strength: number;
}

export const DEFAULT_HIGHLIGHT_RECOVERY_PARAMS: HighlightRecoveryParams = {
  enabled: true,
  strength: 0,
};

/** GLSL-`smoothstep` twin (Hermite). Kept identical to FRAG_HIGHLIGHTRECOVERY for CPU/GPU parity. */
export function hrSmoothstep(edge0: number, edge1: number, x: number): number {
  const denom = edge1 - edge0;
  if (denom === 0) return x < edge0 ? 0 : 1;
  let t = (x - edge0) / denom;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/**
 * Reconstruct blown highlights IN PLACE. Pure & pointwise — the single source of truth that
 * both the CPU pipeline module and the GPU self-test compare against.
 *
 * KNOWN LIMITATION (documented, not fixed — round-8 review LOW): the `gate` below distinguishes a
 * blown NEUTRAL highlight (all 3 channels bright, 1 clipped) from a genuinely saturated PRIMARY
 * (only 1 channel bright) via a "2nd bright channel" requirement — but it cannot distinguish that
 * neutral case from a genuinely saturated highlight with exactly TWO bright channels (e.g. a
 * strong yellow/cyan/magenta). A two-primary highlight also passes the 2nd-bright-channel gate
 * and gets pulled toward the survivor-weighted guide at high strength, trimming some of its real
 * saturation. Accepted as-is: two-bright-channel blown highlights are rare relative to the
 * neutral-white-blowout case this module targets, and the effect is bounded by `strength`.
 *
 * @param data     packed float pixels in [0,1], stride = `channels`
 * @param width    px
 * @param height   px
 * @param channels 3 or 4 (alpha, if present, is untouched)
 * @param strength 0..100 (0 = no-op; caller should skip entirely for a byte-identical buffer)
 */
export function recoverHighlights(
  data: Float32Array,
  width: number,
  height: number,
  channels: number,
  strength: number,
): void {
  const s01 = strength / 100;
  if (s01 <= 0) return;

  const n = width * height;
  for (let p = 0; p < n; p++) {
    const i = p * channels;
    const r = data[i], g = data[i + 1], b = data[i + 2];

    const hi = r > g ? (r > b ? r : b) : (g > b ? g : b);
    if (hi <= HR_KNEE) continue; // outside the highlight zone → identity

    const lo = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const mid = r + g + b - hi - lo; // the median channel

    const t = hrSmoothstep(HR_KNEE, 1.0, hi);     // depth into highlights
    const gate = hrSmoothstep(HR_KNEE, 1.0, mid); // require a 2nd bright channel (protect saturated colours)
    const a = t * gate * s01;
    if (a <= 0) continue;

    // Per-channel reliability: a clipped channel (→1.0) weighs ~0, a survivor weighs ~1.
    const wr = 1 - hrSmoothstep(HR_CLIP_LO, HR_CLIP_HI, r);
    const wg = 1 - hrSmoothstep(HR_CLIP_LO, HR_CLIP_HI, g);
    const wb = 1 - hrSmoothstep(HR_CLIP_LO, HR_CLIP_HI, b);
    const wsum = wr + wg + wb;
    // Survivor-weighted neutral guide. All channels clipped (wsum→0) → guide = hi (=white shoulder).
    const guide = wsum > 1e-4 ? (wr * r + wg * g + wb * b) / wsum : hi;

    // Pull only the OVER-guide (colour-cast) part of each channel toward the survivor
    // guide. Channels at/below the guide (the survivors carrying the real gradient) are
    // left untouched via max(c-guide,0); the clipped/over-bright channel is reconstructed
    // down toward the neutral survivor level. Branchless & identical to the GLSL.
    let or = r - Math.max(r - guide, 0) * a;
    let og = g - Math.max(g - guide, 0) * a;
    let ob = b - Math.max(b - guide, 0) * a;
    or = or < 0 ? 0 : or > 1 ? 1 : or;
    og = og < 0 ? 0 : og > 1 ? 1 : og;
    ob = ob < 0 ? 0 : ob > 1 ? 1 : ob;
    data[i] = or; data[i + 1] = og; data[i + 2] = ob;
  }
}

/**
 * Pipeline adapter. Registered early (after exposure, before tone/shadows-highlights) so the
 * reconstruction happens on the near-decode buffer before tone curves compress the highlights.
 */
export class HighlightRecoveryPipelineModule implements PipelineModule {
  public isEnabled = true;
  private params: HighlightRecoveryParams = { ...DEFAULT_HIGHLIGHT_RECOVERY_PARAMS };

  getId(): string {
    return 'highlightrecovery';
  }

  getName(): string {
    return 'Highlight Recovery';
  }

  getParams(): HighlightRecoveryParams {
    return { ...this.params };
  }

  setParams(newParams: Partial<HighlightRecoveryParams>): void {
    this.params = { ...this.params, ...newParams };
  }

  resetParams(): void {
    this.params = { ...DEFAULT_HIGHLIGHT_RECOVERY_PARAMS };
  }

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.params.enabled = enabled;
  }

  getEnabled(): boolean {
    return this.isEnabled;
  }

  /** Neutral when disabled or strength 0 — process() then returns the input buffer unchanged. */
  isNoOp(): boolean {
    return !this.params.enabled || this.params.strength <= 0;
  }

  process(input: Float32Array, context: ProcessingContext): Float32Array {
    if (!this.isEnabled || this.isNoOp()) {
      return input;
    }
    try {
      const out = new Float32Array(input);
      recoverHighlights(out, context.width, context.height, context.channels, this.params.strength);
      return out;
    } catch (error) {
      logger.error('Error in HighlightRecoveryPipelineModule processing:', error);
      return input;
    }
  }
}

export default HighlightRecoveryPipelineModule;
