/**
 * AutoAllService — the Auto All application flow (v1.37.0 R2, user decision D4).
 *
 * Extracted from App.tsx's handleAutoAll into a dependency-injected seam
 * (mirrors the module-level transform actions pattern) so tests exercise the
 * REAL composition against the real pipeline singleton without rendering
 * <App/>.
 *
 * Composition:
 *  1. The standalone Basic-Adjustments bundle (autoAdjustService.autoAll →
 *     autoBasicAdj standalone) — exposure toward neutral, highlights/shadows
 *     recovery, black_point clip-lift, stronger gains. ONE bundle shared with
 *     the Basic Adjustments card's ⚡ Auto. No ExposureModule write, no
 *     Shadows/Highlights-module fold (both removed by D4).
 *  2. The pixel auto-WB (gray-candidate estimation, the WB card's own engine),
 *     skipped on a camera-matched base — the match already reproduces the
 *     camera's WB decision.
 *  3. Camera-matched softening: the bundle is scaled toward neutral by
 *     CAMERA_MATCHED_AUTO_STRENGTH so it nudges instead of double-grading.
 *  4. Auto Crop (D4 Part B): headless auto-straighten on the current preview
 *     pixels, ONLY for a fresh-photo crop state — see applyAutoStraighten.
 */
import { logger } from '../utils/Logger';
import { guardDeveloping } from '../utils/developingGuard';
import { imageService } from './ImageService';
import { imageProcessingPipeline } from './ImageProcessingPipeline';
import { autoAdjustService, CAMERA_MATCHED_AUTO_STRENGTH } from './AutoAdjustService';
import { checkpointService } from './CheckpointService';
import { useAppStore } from '../stores/appStore';
import type { CropPipelineModule } from '../modules/CropPipelineModule';

export interface AutoAllDeps {
  showSuccess: (title: string, message: string) => void;
  showError: (title: string, message: string) => void;
  showInfo: (title: string, message: string) => void;
}

export function applyAutoAll(deps: AutoAllDeps): void {
  const { showSuccess, showError, showInfo } = deps;
  if (guardDeveloping(showInfo, 'Auto All')) return;
  const img = imageService.getCurrentImage();
  if (!img) { showError('Auto All', 'No image loaded'); return; }

  useAppStore.getState().setIsProcessing(true); // canvas spinner while applying

  // Camera-matched base → soften the grade (half strength) and keep the
  // camera's WB. A full-strength correction on a matched base double-grades
  // (camera tone mapping + full pull = crushed bright scenes).
  const cameraMatched = !!img.isRaw && !!useAppStore.getState().rawDecodeOptions.cameraMatch;

  // Single coordinator call: analyses once, picks the user-style bucket, and
  // returns the standalone Basic-Adj bundle (pre-scaled when camera-matched).
  const result = autoAdjustService.autoAll(img.data, img.width, img.height, {
    strength: cameraMatched ? CAMERA_MATCHED_AUTO_STRENGTH : 1,
  });
  logger.info(`Auto All: bucket=${result.bucket} (${result.stats.meanLum.toFixed(3)} lum, cameraMatched=${cameraMatched})`);

  // White Balance — gray-candidate estimation + damped correction, the SAME
  // engine as the WB card's "Auto" button: estimate the illuminant from
  // near-neutral samples (median cast, inverting the module's own gain model),
  // then apply a partial correction that cleans the cast while retaining some
  // of the scene's warmth. Skipped on a camera-matched base: the match already
  // reproduces the camera's WB decision, and a gray-world pull on top of it
  // fights that intent.
  const wbMod = cameraMatched ? null : imageProcessingPipeline.getModule('temperature');
  if (wbMod) {
    const wbChannels = Math.max(3, Math.round(img.data.length / (img.width * img.height)));
    (wbMod as unknown as { autoDetectWhiteBalance: (d: Float32Array, ctx: { width: number; height: number; channels: number }) => void })
      .autoDetectWhiteBalance(img.data, { width: img.width, height: img.height, channels: wbChannels });
    imageProcessingPipeline.invalidateModuleCache('temperature');
  }

  // Basic Adjustments — the WHOLE standalone bundle in one write: exposure,
  // contrast/brightness/saturation/vibrance, highlights/shadows recovery and
  // the black_point clip-lift all land on these sliders.
  const baMod = imageProcessingPipeline.getModule('basicadj');
  if (baMod) {
    (baMod as unknown as { setParams: (p: Record<string, unknown>) => void }).setParams(result.basicAdj);
    imageProcessingPipeline.invalidateModuleCache('basicadj');
  }

  // Auto Crop (Part B): headless auto-straighten — fresh-photo only.
  const straightened = applyAutoStraighten(img, showInfo);

  // Refresh the open module panel's sliders, then reprocess.
  useAppStore.getState().notifyExternalParamsChange();
  useAppStore.getState().triggerReprocessing();
  // History: one "Auto All" entry for the whole transaction (WB + bundle + straighten).
  // Recorded here so the label isn't the generic "Multiple adjustments (n)" the debounced
  // describeChange would produce; the App's processingVersion record then dedupes against
  // this snapshot. dedupe:true → a repeat no-op click adds no duplicate entry.
  checkpointService.recordLabeled('Auto All', undefined, true);
  showSuccess(
    'Auto All',
    `Applied "${result.bucket}" auto adjustments${straightened ? ' + auto-straighten' : ''}${cameraMatched ? ' (softened — camera-matched base)' : ''}`,
  );
  logger.info(`Auto All: standalone bundle + auto-WB applied (bucket=${result.bucket}, straightened=${straightened})`);
}

/**
 * Headless auto-straighten inside Auto All (v1.37.0 R2 Part B, user decision
 * D4: "add the Auto Crop if it can auto find the right orientation ... and
 * auto straighten").
 *
 * Runs the inner CropModule.autoStraighten — 6-line analysis, ≥0.1° and ≤5°
 * by its own contract — on the CURRENT preview pixels, channels-detected the
 * same way the crop card's ⚡ does — but ONLY when the photo is in the
 * fresh-photo crop state: no crop rect, no orientation quarter-turn, no
 * straighten angle. Already-rotated pixels would double-correct, and Auto All
 * must NEVER fight user framing — any existing crop/rotation means silent skip.
 *
 * On detection it applies the angle plus the SHARED wedge-free crop patch
 * (CropModule.wedgeFreeCropPatch — one source with the crop card) via the
 * v1.34.0 programmatic recipe: inner setParams({...patch, enabled:true}) +
 * adapter setEnabled(true) + invalidateModuleCache('crop'). The caller emits
 * the single notifyExternalParamsChange + triggerReprocessing for the whole
 * Auto All transaction.
 */
function applyAutoStraighten(
  img: { width: number; height: number },
  showInfo: AutoAllDeps['showInfo'],
): boolean {
  // Defense-in-depth: applyAutoAll already gates the developing window before
  // any pixels are read; this inner gate keeps the straighten path honest if a
  // future caller reaches it directly (it bakes preview-derived crop params).
  if (guardDeveloping(showInfo, 'Auto All')) return false;

  const adapter = imageProcessingPipeline.getModule<CropPipelineModule>('crop');
  if (!adapter) return false;
  const inner = adapter.getCropModule();
  const p = inner.getParams();

  const hasCropRect = p.x !== 0 || p.y !== 0 || p.width !== 1.0 || p.height !== 1.0;
  const hasOrientation = inner.normalizedOrientation() !== 0;
  const hasAngle = Math.abs(p.angle) >= 0.01;
  if (hasCropRect || hasOrientation || hasAngle) {
    logger.debug('Auto All: auto-straighten skipped — photo already has crop/rotation');
    return false;
  }

  // The preview the user is looking at (same source as the crop card's ⚡).
  const pd = useAppStore.getState().processedImageData;
  const preview = pd && typeof pd === 'object' && 'data' in pd
    ? (pd as { data: Float32Array; width: number; height: number })
    : null;
  if (!preview || !preview.data || preview.width <= 0 || preview.height <= 0) return false;

  const channels = Math.round(preview.data.length / (preview.width * preview.height));
  if (channels !== 3 && channels !== 4) {
    logger.warn(`Auto All: auto-straighten skipped — unexpected channel count ${channels}`);
    return false;
  }

  const detected = inner.autoStraighten(preview.data, {
    width: preview.width, height: preview.height, channels,
  });
  if (!detected) return false;

  const angle = inner.getParams().angle;
  // Frame dims for the inscribed-rect math: the BASE image dims, exactly what
  // the crop card passes (the patch is normalized, so only aspect matters).
  const patch = inner.wedgeFreeCropPatch(angle, img.width, img.height);
  inner.setParams({ ...patch, enabled: true });
  adapter.setEnabled(true); // v1.34.0 adapter-enable mirror
  imageProcessingPipeline.invalidateModuleCache('crop');
  logger.info(`Auto All: auto-straighten applied ${angle.toFixed(2)}° with wedge-free crop`);
  return true;
}
