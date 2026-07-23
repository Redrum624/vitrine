/**
 * SidewaysHintService — orchestration for the "photo may be sideways?"
 * suggestion badge (v1.37.0 R2 Part C).
 *
 * Compute: on image open, after the first preview pixels are available, App
 * schedules computeSidewaysHintForImage(imageId) asynchronously (never on
 * reprocess — badge state is per-image). The heuristic (utils/
 * sidewaysDetection) runs on the preview-res buffer the user is looking at,
 * so a photo whose persisted orientation was already restored renders upright
 * and simply produces no hint.
 *
 * Accept: ONE click applies the lossless quarter-turn in the computed
 * direction via the v1.34.0 orientation mechanism — the same programmatic
 * crop-write recipe as every other headless crop write (inner setParams
 * enabled + adapter setEnabled + invalidateModuleCache('crop') +
 * notifyExternalParamsChange + triggerReprocessing). Orientation ONLY: no
 * rect, no angle.
 *
 * Dismiss: hides the badge for that photo for the session (store-tracked),
 * so a reopen recompute stays hidden. NEVER auto-rotates.
 */
import { logger } from '../utils/Logger';
import { detectSideways } from '../utils/sidewaysDetection';
import { imageProcessingPipeline } from './ImageProcessingPipeline';
import { useAppStore } from '../stores/appStore';
import type { CropPipelineModule } from '../modules/CropPipelineModule';

/**
 * Run the sideways heuristic on the CURRENT preview pixels and publish the
 * per-image hint (or clear it). Reads a UI-preview buffer to produce a
 * non-persisted suggestion — no params are baked, so this sits outside the
 * developing-guard perimeter.
 */
export function computeSidewaysHintForImage(imageId: string): void {
  const store = useAppStore.getState();
  if (store.sidewaysDismissed[imageId]) {
    store.setSidewaysHint(null);
    return;
  }
  const pd = store.processedImageData;
  const preview = pd && typeof pd === 'object' && 'data' in pd
    ? (pd as { data: Float32Array; width: number; height: number })
    : null;
  if (!preview || !preview.data || preview.width <= 0 || preview.height <= 0) {
    store.setSidewaysHint(null);
    return;
  }
  const channels = Math.round(preview.data.length / (preview.width * preview.height));
  if (channels !== 3 && channels !== 4) {
    store.setSidewaysHint(null);
    return;
  }
  const hit = detectSideways(preview.data, preview.width, preview.height, channels);
  store.setSidewaysHint(hit ? { imageId, rotate: hit.rotate } : null);
  if (hit) logger.info(`Sideways hint: image ${imageId} may need a ${hit.rotate}° turn (badge only, no auto-rotate)`);
}

/**
 * Apply the suggested lossless quarter-turn (badge click) and clear the hint.
 * Composes with any existing orientation as a delta — the hint was computed
 * from the pixels as currently rendered.
 */
export function acceptSidewaysHint(): void {
  const hint = useAppStore.getState().sidewaysHint;
  if (!hint) return;
  const adapter = imageProcessingPipeline.getModule<CropPipelineModule>('crop');
  if (!adapter) return;
  const inner = adapter.getCropModule();
  const next = (inner.normalizedOrientation() + hint.rotate) % 360;
  // v1.34.0 programmatic crop-write recipe — orientation only.
  inner.setParams({ orientation: next, enabled: true });
  adapter.setEnabled(true);
  imageProcessingPipeline.invalidateModuleCache('crop');
  const store = useAppStore.getState();
  store.setSidewaysHint(null);
  store.notifyExternalParamsChange();
  store.triggerReprocessing();
  logger.info(`Sideways hint accepted: orientation → ${next}°`);
}

/** Dismiss the badge for the current photo for the rest of the session. */
export function dismissCurrentSidewaysHint(): void {
  const hint = useAppStore.getState().sidewaysHint;
  if (hint) useAppStore.getState().dismissSidewaysHint(hint.imageId);
}
