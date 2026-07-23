/**
 * SidewaysHintService — orchestration for the "photo may be sideways?"
 * suggestion badge (v1.37.0 R2 Part C).
 *
 * Compute: on image open, App schedules computeSidewaysHintForImage(id, path)
 * off the store's originalSnapshotVersion bump — ImageService bumps it exactly
 * once per fresh open, AFTER its currentImage is the new base, and never on
 * reprocess (badge state is per-image, recomputed on open only). The heuristic
 * (utils/sidewaysDetection) runs on the BASE pixels via a strided ≤64px grid,
 * NOT on the pipeline preview: the processed preview is cleared/re-published
 * asynchronously around every open (the v1 wiring raced it and starved — see
 * the R2 report) and its sharpening contaminates the edge-orientation ratio.
 * The base is EXIF-oriented at decode, so a correctly-tagged photo simply
 * produces no hint. A photo the user already quarter-turned in the app is
 * skipped via the crop module's orientation (the base pixels predate it).
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
import { detectSideways, measureSidewaysSignals } from '../utils/sidewaysDetection';
import { imageProcessingPipeline } from './ImageProcessingPipeline';
import { imageService } from './ImageService';
import { useAppStore } from '../stores/appStore';
import type { CropPipelineModule } from '../modules/CropPipelineModule';

/**
 * Run the sideways heuristic on the CURRENT image's base pixels and publish
 * the per-image hint (or clear it). Reads pixels only to produce a
 * NON-PERSISTED suggestion — no params are baked, so this sits outside the
 * developing-guard perimeter (and the embedded preview shown during a
 * progressive RAW open carries the same orientation as the full decode).
 *
 * @param expectedPath when provided, the compute is skipped unless the
 * ImageService's current image matches — the caller's open-effect can fire
 * before the new decode lands, and analysing the PREVIOUS photo's base would
 * publish a wrong hint. A later originalSnapshotVersion bump retries.
 */
export function computeSidewaysHintForImage(imageId: string, expectedPath?: string): void {
  const store = useAppStore.getState();
  if (store.sidewaysDismissed[imageId]) {
    logger.debug(`Sideways compute[${imageId}]: skipped — dismissed this session`);
    store.setSidewaysHint(null);
    return;
  }
  const img = imageService.getCurrentImage();
  if (!img || !img.data || img.width <= 0 || img.height <= 0) {
    logger.debug(`Sideways compute[${imageId}]: skipped — no base pixels`);
    store.setSidewaysHint(null);
    return;
  }
  if (expectedPath && img.filePath !== expectedPath) {
    // The new open hasn't decoded yet — leave the hint cleared; the snapshot
    // bump that follows the decode re-triggers this compute with a match.
    logger.debug(`Sideways compute[${imageId}]: waiting — base is still ${img.filePath}`);
    return;
  }
  // The user (or a restored per-image edit) already quarter-turned this photo:
  // the BASE pixels predate that orientation, so a hint computed from them
  // would second-guess a fix that's already applied. Skip silently.
  const cropAdapter = imageProcessingPipeline.getModule<CropPipelineModule>('crop');
  if (cropAdapter && cropAdapter.getCropModule().normalizedOrientation() !== 0) {
    logger.debug(`Sideways compute[${imageId}]: skipped — orientation already applied`);
    store.setSidewaysHint(null);
    return;
  }
  const channels = Math.round(img.data.length / (img.width * img.height));
  if (channels !== 3 && channels !== 4) {
    logger.debug(`Sideways compute[${imageId}]: skipped — channel count ${channels}`);
    store.setSidewaysHint(null);
    return;
  }
  const hit = detectSideways(img.data, img.width, img.height, channels);
  // Always log the MEASURED signals (one line per open) — the thresholds were
  // validated against these base-pixel values on real photos (see the R2
  // report), and future recalibration needs the same ground truth.
  const s = measureSidewaysSignals(img.data, img.width, img.height, channels);
  if (s) {
    logger.info(
      `Sideways signals[${imageId}] ${img.width}x${img.height}: gx/gy=${s.edgeRatio.toFixed(2)}, ` +
      `lat=${s.lateralDelta.toFixed(3)}, vert=${s.verticalDelta.toFixed(3)}, edge=${s.meanEdgeEnergy.toFixed(4)} → ` +
      (hit ? `hint rotate ${hit.rotate}°` : 'no hint'),
    );
  }
  store.setSidewaysHint(hit ? { imageId, rotate: hit.rotate } : null);
  if (hit) logger.info(`Sideways hint: image ${imageId} may need a ${hit.rotate}° turn (badge only, no auto-rotate)`);
}

/**
 * Apply the suggested lossless quarter-turn (badge click) and clear the hint.
 * A hint is only ever born at orientation 0 (the compute gate above), so a
 * non-zero orientation at CLICK time means the hint went stale — a persisted
 * per-image orientation restored between compute and click, and applying the
 * suggested turn on top would land 180° on an already-fixed photo. Stale
 * hints are discarded: clear the badge, apply nothing.
 */
export function acceptSidewaysHint(): void {
  const hint = useAppStore.getState().sidewaysHint;
  if (!hint) return;
  const adapter = imageProcessingPipeline.getModule<CropPipelineModule>('crop');
  if (!adapter) return;
  const inner = adapter.getCropModule();
  if (inner.normalizedOrientation() !== 0) {
    logger.info('Sideways hint discarded at click: an orientation is already applied (stale hint)');
    useAppStore.getState().setSidewaysHint(null);
    return;
  }
  const next = hint.rotate;
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
