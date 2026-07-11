import { imageService } from './ImageService';
import { imageProcessingPipeline } from './ImageProcessingPipeline';
import { enhanceWorkerClient } from './EnhanceWorkerClient';
import { aiUpscaleClient } from './AiUpscaleClient';
import { checkpointService } from './CheckpointService';
import { editPersistenceService } from './EditPersistenceService';
import { notificationService } from './NotificationService';
import { useAppStore } from '../stores/appStore';
import { EnhanceParams, enhanceAiUpscaled } from '../utils/enhanceChain';
import { guardDeveloping } from '../utils/developingGuard';

/** Float32 RGBA 0..1 (pipeline domain) → Uint8 RGBA 0..255 (AI IPC domain). */
function float32ToUint8Rgba(f: Float32Array): Uint8Array {
  const out = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const v = Math.round(f[i] * 255);
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

/** Uint8 RGBA 0..255 (AI IPC domain) → Float32 RGBA 0..1 (pipeline domain). */
function uint8ToFloat32Rgba(u: Uint8Array): Float32Array {
  const out = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) out[i] = u[i] / 255;
  return out;
}

// Upscale produces two full Float32 RGBA buffers (enhanced + base) at the output
// resolution plus working temporaries — peak memory ≈ 56 bytes/output-pixel. 160 MP
// (~9 GB peak) comfortably covers 2× of cameras up to ~40 MP while still blocking the
// genuinely dangerous cases (e.g. 4× of a 20 MP image = 320 MP ≈ 22 GB). The worker
// also fails gracefully (the working image is left untouched) if memory runs out.
const MAX_OUTPUT_PIXELS = 160_000_000;

/** Scale factors the Enhance UI offers. */
const SUPPORTED_UPSCALE_SCALES = [2, 4] as const;

export interface UpscaleFeasibility {
  feasible: boolean;
  outputPixels: number;
  maxPixels: number;
  /** Largest supported scale whose output fits under the cap, or null if none does. */
  maxFeasibleScale: number | null;
}

/**
 * Pure feasibility check for upscaling a width×height image by `scale` against the
 * MAX_OUTPUT_PIXELS memory cap. Used by the UI to disable impossible scale choices
 * up front, and by applyUpscale's guard (defense in depth).
 */
export function getUpscaleFeasibility(width: number, height: number, scale: number): UpscaleFeasibility {
  const pixelsAt = (s: number) => Math.round(width * s) * Math.round(height * s);
  const outputPixels = pixelsAt(scale);
  let maxFeasibleScale: number | null = null;
  for (const s of SUPPORTED_UPSCALE_SCALES) {
    if (pixelsAt(s) <= MAX_OUTPUT_PIXELS && (maxFeasibleScale === null || s > maxFeasibleScale)) {
      maxFeasibleScale = s;
    }
  }
  return {
    feasible: outputPixels <= MAX_OUTPUT_PIXELS,
    outputPixels,
    maxPixels: MAX_OUTPUT_PIXELS,
    maxFeasibleScale,
  };
}

interface RestorePoint {
  data: Float32Array;
  width: number;
  height: number;
  scale: number;
  editState: ReturnType<typeof editPersistenceService.serialize>;
}

class EnhanceService {
  private restoreStack: RestorePoint[] = [];
  private inFlight = false;
  // Staleness snapshot: the hash of all UPSTREAM (non-enhance) pipeline params captured at the
  // moment Apply Enhance last ran for the CURRENT image. null = no apply yet (or image switched).
  // Lives on the service (not the panel's React state) so it survives the Enhance panel
  // unmounting when the user navigates to another module and back — scoped per image exactly like
  // `restoreStack`, and reset at the same choke point (onImageSwitched).
  private appliedUpstreamHash: string | null = null;

  canRevert(): boolean {
    return this.restoreStack.length > 0;
  }

  /**
   * Fingerprint of every pipeline module's params EXCEPT enhance's own — the upstream state that
   * feeds the enhance input (crop → noise-reduction run before enhance; see the pipeline order).
   * Deliberately excludes `enhance` so tweaking Enhance's OWN sliders never flags itself stale.
   * getModules() iterates in registration (processing) order, so the string is stable.
   */
  private upstreamParamsHash(): string {
    const modules = imageProcessingPipeline.getModules?.() ?? new Map();
    const parts: string[] = [];
    for (const [id, mod] of modules) {
      if (id === 'enhance') continue;
      const getParams = (mod as { getParams?: () => unknown }).getParams;
      parts.push(`${id}:${JSON.stringify(typeof getParams === 'function' ? getParams.call(mod) : null)}`);
    }
    return parts.join('|');
  }

  /** Snapshot the current upstream param state as the baseline an Apply Enhance result reflects. */
  markEnhanceApplied(): void {
    this.appliedUpstreamHash = this.upstreamParamsHash();
  }

  /**
   * True when an Apply Enhance has run for this image AND an upstream (non-enhance) param has
   * since changed — i.e. the applied result no longer reflects the current pipeline input, so the
   * panel should surface a "Re-apply to update" hint. False before any apply and right after one.
   */
  isEnhanceStale(): boolean {
    return this.appliedUpstreamHash !== null && this.appliedUpstreamHash !== this.upstreamParamsHash();
  }

  getRestoreDepth(): number {
    return this.restoreStack.length;
  }

  async applyUpscale(params: EnhanceParams): Promise<void> {
    // Base-MUTATING: bakes a whole new original/current base (setOriginalImage +
    // updateCurrentImageData) and sets the `bakedUpscale` marker. During the
    // progressive-open developing window the working image is the ~2048px embedded
    // preview: feasibility would compute on preview dims, and the background
    // full-decode swap would clobber the upscaled base while `bakedUpscale` stays
    // set — permanently early-returning EditPersistenceService.flush(), so every
    // subsequent edit on the image silently stops persisting (final whole-branch
    // review, critical #1). Gated HERE (the single choke point for all callers)
    // rather than in the UI trigger; batch flows use BatchProcessingService and
    // never run inside the interactive `developing` window.
    if (guardDeveloping(notificationService.info.bind(notificationService), 'Enhance Upscale')) return;
    if (this.inFlight) return;

    const original = imageService.getOriginalImage();
    if (!original) throw new Error('No image loaded');

    const { width, height } = original;

    // Derive the true processed dimensions. When Crop (or any geometric module) is
    // active the pipeline output buffer is smaller than the native image, so we must
    // pass the PROCESSED dims — not the native ones — to the enhance worker.
    // CropPipelineModule.getOutputDimensions() returns the crop-adjusted size, or the
    // native size when crop is disabled/identity. We use optional chaining so the mock
    // (which omits getModule) degrades gracefully to native dims.
    const cropMod = imageProcessingPipeline.getModule?.('crop') as
      | { getOutputDimensions(w: number, h: number): { width: number; height: number } }
      | undefined;
    const procDims = cropMod ? cropMod.getOutputDimensions(width, height) : { width, height };
    const procW = procDims.width;
    const procH = procDims.height;

    const outW = Math.round(procW * params.scale);
    const outH = Math.round(procH * params.scale);
    const feasibility = getUpscaleFeasibility(procW, procH, params.scale);
    if (!feasibility.feasible) {
      const outMP = (feasibility.outputPixels / 1e6).toFixed(0);
      const maxMP = (feasibility.maxPixels / 1e6).toFixed(0);
      const hint = feasibility.maxFeasibleScale !== null
        ? `Max feasible scale for this image: ×${feasibility.maxFeasibleScale}.`
        : 'This image is too large to upscale at any supported scale.';
      throw new Error(`Upscale ×${params.scale} would produce ${outMP} MP (${outW}×${outH}), above the ${maxMP} MP memory limit. ${hint}`);
    }

    const store = useAppStore.getState();
    this.inFlight = true;
    store.setIsProcessing(true);
    store.setUpscaleProgress(null);
    try {
      const edited = await imageProcessingPipeline.processImage(
        new Float32Array(original.data),
        { width, height, channels: 4 },
        { useWebWorkers: true },
      );

      // Capture snapshot before the (AI or worker) call (cheap), but do not commit it yet.
      // The restore point stores the NATIVE (pre-crop) buffer and dims so that revert
      // can fully restore both the pixels and the edit state (including crop params).
      const restoreData = new Float32Array(original.data);
      const editState = editPersistenceService.serialize();

      // Route: AI super-resolution when a GPU+model are available, else the deterministic
      // Lanczos worker. If the AI run fails mid-way, fall back to deterministic so the user
      // still gets a result. `enhanced` is the displayed image; `base` is the new editable canvas.
      let enhanced!: Float32Array;
      let base!: Float32Array;
      let outWidth!: number;
      let outHeight!: number;
      let mode: 'ai' | 'standard' = 'standard';

      let usedAi = false;
      if (await aiUpscaleClient.isAvailable()) {
        try {
          store.setUpscaleProgress(0);
          const ai = await aiUpscaleClient.run(
            float32ToUint8Rgba(edited),
            procW,
            procH,
            params.scale as 2 | 4,
            // Reserve the top 10% of the bar for the renderer-side finishing pass below, which
            // is synchronous and can take a second on a large output — so the bar advances into
            // the finish instead of sitting frozen at 100% while it runs.
            (p) => { if (p.total > 0) store.setUpscaleProgress((p.done / p.total) * 0.9); },
          );
          const aiRgba = uint8ToFloat32Rgba(ai.data); // clean model output (new editable base)
          store.setUpscaleProgress(0.92); // entering the finishing pass (chroma/detail/sharpen)
          // Apply the user's Chroma-noise / Detail / Sharpen sliders to the AI OUTPUT so they are
          // not silent no-ops on this route (parity with the deterministic Lanczos route). RL
          // deblur is intentionally skipped on AI output — see enhanceAiUpscaled's doc.
          enhanced = enhanceAiUpscaled(aiRgba, ai.width, ai.height, params);
          base = new Float32Array(aiRgba); // Before/After 'After' ref + editable canvas; distinct
          outWidth = ai.width;             // buffer from `enhanced` (which may alias aiRgba on the
          outHeight = ai.height;           // neutral-sliders pass-through path).
          mode = 'ai';
          usedAi = true;
        } catch {
          usedAi = false; // fall through to the deterministic path below
        }
      }
      if (!usedAi) {
        store.setUpscaleProgress(null);
        const r = await enhanceWorkerClient.run(
          new Float32Array(edited),
          procW,
          procH,
          { ...params, sharpen: true, upscale: true },
        );
        enhanced = r.enhanced;
        base = r.base;
        outWidth = r.width;
        outHeight = r.height;
        mode = 'standard';
      }

      // Result obtained — now safe to push the restore point and mutate.
      store.setUpscaleMode(mode);
      this.restoreStack.push({ data: restoreData, width, height, scale: params.scale, editState });

      imageProcessingPipeline.resetAllModules();
      // setOriginalImage BEFORE updateCurrentImageData: the base cache is a fully-materialized
      // snapshot already, so setting it first means updateCurrentImageData's copy-on-write check
      // (originalImageData already set) is a no-op — no wasted defensive copy of the pre-upscale
      // pixels that would just be discarded a line later.
      imageService.setOriginalImage(base, outWidth, outHeight);
      imageService.updateCurrentImageData(enhanced, outWidth, outHeight);
      imageService.setBakedUpscale({ scale: params.scale, nativeWidth: procW, nativeHeight: procH });
      checkpointService.recordLabeled(`Enhanced ×${params.scale} (${mode === 'ai' ? 'AI' : 'Standard'})`, this.getRestoreDepth());
      store.notifyExternalParamsChange();
      store.triggerReprocessing();
    } finally {
      this.inFlight = false;
      store.setIsProcessing(false);
      store.setUpscaleProgress(null);
    }
  }

  /** Pop the top restore point and apply it. Returns false if the stack was empty. */
  private _popAndRestore(): boolean {
    const rp = this.restoreStack.pop();
    if (!rp) return false;

    imageProcessingPipeline.resetAllModules();
    // setOriginalImage BEFORE updateCurrentImageData — see applyUpscale's comment above.
    imageService.setOriginalImage(new Float32Array(rp.data), rp.width, rp.height);
    imageService.updateCurrentImageData(new Float32Array(rp.data), rp.width, rp.height);
    editPersistenceService.restore(rp.editState, rp.width, rp.height);

    if (this.restoreStack.length === 0) {
      imageService.clearBakedUpscale();
    } else {
      // Update the baked marker to reflect the now-current (remaining) top level.
      // Each RestorePoint stores the pre-bake dims and scale for the upscale it captured,
      // so the remaining top describes the active baked level after this pop.
      const top = this.restoreStack[this.restoreStack.length - 1];
      imageService.setBakedUpscale({ scale: top.scale, nativeWidth: top.width, nativeHeight: top.height });
    }
    return true;
  }

  revert(): void {
    // Base-MUTATING via _popAndRestore → imageService.updateCurrentImageData. Gated during the
    // progressive-open developing window exactly like applyUpscale (single choke point, toast via
    // notificationService.info): reverting while the background full decode is still pending would
    // restore the pre-upscale base into a working image the swap is about to clobber. The stack is
    // left intact so the revert is retryable the moment the full decode settles.
    if (guardDeveloping(notificationService.info.bind(notificationService), 'Enhance Revert')) return;
    if (!this._popAndRestore()) return;

    const store = useAppStore.getState();
    store.notifyExternalParamsChange();
    store.triggerReprocessing();
  }

  /**
   * Drop the per-image revert stack when the working image is SWITCHED (a fresh open or a clear).
   * Registered on ImageService's image-switch hook at module load — the restore points hold the
   * PREVIOUS image's pre-upscale pixels + edit state, so keeping them across a switch would let a
   * subsequent revert() restore another image's base as the current working image (round-4
   * re-review finding). Scoped exactly like ImageService's `bakedUpscale` marker, which is cleared
   * at the same two choke points.
   */
  onImageSwitched(): void {
    this.restoreStack = [];
    // The staleness snapshot is per-image too: a fresh image has no applied-enhance baseline, so
    // the "Re-apply to update" hint must not carry over from the previous image.
    this.appliedUpstreamHash = null;
  }

  /**
   * Unwind the restore stack to the given depth, restoring image + edit state at each level.
   * Consumed by CheckpointService (Task 6) when a history restore crosses an upscale boundary.
   */
  unwindToDepth(depth: number): void {
    const target = Math.max(0, Math.min(depth, this.restoreStack.length));
    let changed = false;
    while (this.restoreStack.length > target) {
      this._popAndRestore();
      changed = true;
    }
    if (changed) {
      const store = useAppStore.getState();
      store.notifyExternalParamsChange();
      store.triggerReprocessing();
    }
  }
}

export const enhanceService = new EnhanceService();

// Wire the bake bridge so CheckpointService can query/unwind the restore stack without
// creating a direct import cycle (EnhanceService already imports CheckpointService, so
// a reverse import would be circular). The bridge is set once at module-load time via
// arrow functions that capture the already-constructed singleton by reference.
checkpointService.setBakeBridge({
  getDepth: () => enhanceService.getRestoreDepth(),
  unwindToDepth: (d) => enhanceService.unwindToDepth(d),
});

// Scope the revert stack per image: drop it whenever the working image is switched (a fresh
// loadImage or clearImage), mirroring how ImageService clears its bakedUpscale marker at the same
// choke points. Optional-chained so unit tests that mock ImageService without this method degrade
// gracefully (the same pattern as imageProcessingPipeline.getModule?. above).
imageService.setImageSwitchHook?.(() => enhanceService.onImageSwitched());
