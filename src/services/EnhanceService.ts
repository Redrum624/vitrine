import { imageService } from './ImageService';
import { imageProcessingPipeline } from './ImageProcessingPipeline';
import { enhanceWorkerClient } from './EnhanceWorkerClient';
import { checkpointService } from './CheckpointService';
import { editPersistenceService } from './EditPersistenceService';
import { useAppStore } from '../stores/appStore';
import { EnhanceParams } from '../utils/enhanceChain';

const MAX_OUTPUT_PIXELS = 80_000_000;

interface RestorePoint {
  data: Float32Array;
  width: number;
  height: number;
  editState: ReturnType<typeof editPersistenceService.serialize>;
}

class EnhanceService {
  private restorePoint: RestorePoint | null = null;

  canRevert(): boolean {
    return this.restorePoint !== null;
  }

  async applyUpscale(params: EnhanceParams): Promise<void> {
    const original = imageService.getOriginalImage();
    if (!original) throw new Error('No image loaded');

    const { width, height } = original;
    const outW = Math.round(width * params.scale);
    const outH = Math.round(height * params.scale);
    const outPixels = outW * outH;
    if (outPixels > MAX_OUTPUT_PIXELS) {
      throw new Error(`Upscaled size too large (${outPixels} px). Try a smaller scale.`);
    }

    const store = useAppStore.getState();
    store.setIsProcessing(true);
    try {
      const edited = await imageProcessingPipeline.processImage(
        new Float32Array(original.data),
        { width, height, channels: 4 },
        true,
      );

      this.restorePoint = {
        data: new Float32Array(original.data),
        width,
        height,
        editState: editPersistenceService.serialize(),
      };

      const r = await enhanceWorkerClient.run(
        new Float32Array(edited),
        width,
        height,
        { ...params, sharpen: true, upscale: true },
      );

      imageProcessingPipeline.resetAllModules();
      imageService.updateCurrentImageData(r.enhanced, r.width, r.height);
      imageService.setOriginalImage(r.base, r.width, r.height);
      checkpointService.record(`Enhanced ×${params.scale}`);
      store.notifyExternalParamsChange();
      store.triggerReprocessing();
    } finally {
      store.setIsProcessing(false);
    }
  }

  revert(): void {
    const rp = this.restorePoint;
    if (!rp) return;

    imageProcessingPipeline.resetAllModules();
    imageService.updateCurrentImageData(new Float32Array(rp.data), rp.width, rp.height);
    imageService.setOriginalImage(new Float32Array(rp.data), rp.width, rp.height);
    editPersistenceService.restore(rp.editState, rp.width, rp.height);
    this.restorePoint = null;

    const store = useAppStore.getState();
    store.notifyExternalParamsChange();
    store.triggerReprocessing();
  }
}

export const enhanceService = new EnhanceService();
