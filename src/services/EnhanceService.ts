import { imageService } from './ImageService';
import { imageProcessingPipeline } from './ImageProcessingPipeline';
import { enhanceWorkerClient } from './EnhanceWorkerClient';
import { checkpointService } from './CheckpointService';
import { editPersistenceService } from './EditPersistenceService';
import { useAppStore } from '../stores/appStore';
import { EnhanceParams } from '../utils/enhanceChain';

const MAX_OUTPUT_PIXELS = 40_000_000;

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

  canRevert(): boolean {
    return this.restoreStack.length > 0;
  }

  getRestoreDepth(): number {
    return this.restoreStack.length;
  }

  async applyUpscale(params: EnhanceParams): Promise<void> {
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
    const outPixels = outW * outH;
    if (outPixels > MAX_OUTPUT_PIXELS) {
      throw new Error(`Upscaled size too large (${outPixels} px). Try a smaller scale.`);
    }

    const store = useAppStore.getState();
    this.inFlight = true;
    store.setIsProcessing(true);
    try {
      const edited = await imageProcessingPipeline.processImage(
        new Float32Array(original.data),
        { width, height, channels: 4 },
        true,
      );

      // Capture snapshot before the worker call (cheap), but do not commit it yet.
      // The restore point stores the NATIVE (pre-crop) buffer and dims so that revert
      // can fully restore both the pixels and the edit state (including crop params).
      const restoreData = new Float32Array(original.data);
      const editState = editPersistenceService.serialize();
      const r = await enhanceWorkerClient.run(
        new Float32Array(edited),
        procW,
        procH,
        { ...params, sharpen: true, upscale: true },
      );
      // Worker succeeded — now safe to push the restore point and mutate.
      this.restoreStack.push({ data: restoreData, width, height, scale: params.scale, editState });

      imageProcessingPipeline.resetAllModules();
      imageService.updateCurrentImageData(r.enhanced, r.width, r.height);
      imageService.setOriginalImage(r.base, r.width, r.height);
      imageService.setBakedUpscale({ scale: params.scale, nativeWidth: procW, nativeHeight: procH });
      checkpointService.record(`Enhanced ×${params.scale}`);
      store.notifyExternalParamsChange();
      store.triggerReprocessing();
    } finally {
      this.inFlight = false;
      store.setIsProcessing(false);
    }
  }

  /** Pop the top restore point and apply it. Returns false if the stack was empty. */
  private _popAndRestore(): boolean {
    const rp = this.restoreStack.pop();
    if (!rp) return false;

    imageProcessingPipeline.resetAllModules();
    imageService.updateCurrentImageData(new Float32Array(rp.data), rp.width, rp.height);
    imageService.setOriginalImage(new Float32Array(rp.data), rp.width, rp.height);
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
    if (!this._popAndRestore()) return;

    const store = useAppStore.getState();
    store.notifyExternalParamsChange();
    store.triggerReprocessing();
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
