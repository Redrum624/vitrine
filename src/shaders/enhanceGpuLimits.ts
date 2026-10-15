/**
 * Shared limits of the GPU deterministic enhance chain. One copy, imported by both
 * GpuPreviewPipeline.runEnhanceChain and the pre-render eligibility check in
 * passDescriptors (enhanceResidentEligible) so the two can never drift.
 */

/**
 * Cap (output pixels) on the GPU deterministic enhance chain. Above this the CPU worker
 * path — which tiles >48MP with the apron — handles it: the GPU chain holds several
 * RGBA32F buffers at output resolution, so an unbounded output would exhaust VRAM.
 */
export const MAX_GPU_ENHANCE_OUTPUT_PIXELS = 96_000_000;
/** Max Gaussian radius the enh_gauss shader's constant loop (MAXR) supports. */
export const ENH_GAUSS_MAXR = 16;
/** Max joint-bilateral chroma-denoise radius the enh_denoise_chroma shader supports. */
export const ENH_DENOISE_MAXR = 5;
