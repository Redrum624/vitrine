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
 */
import { logger } from '../utils/Logger';
import { guardDeveloping } from '../utils/developingGuard';
import { imageService } from './ImageService';
import { imageProcessingPipeline } from './ImageProcessingPipeline';
import { autoAdjustService, CAMERA_MATCHED_AUTO_STRENGTH } from './AutoAdjustService';
import { useAppStore } from '../stores/appStore';

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

  // Refresh the open module panel's sliders, then reprocess.
  useAppStore.getState().notifyExternalParamsChange();
  useAppStore.getState().triggerReprocessing();
  showSuccess(
    'Auto All',
    `Applied "${result.bucket}" auto adjustments${cameraMatched ? ' (softened — camera-matched base)' : ''}`,
  );
  logger.info(`Auto All: standalone bundle + auto-WB applied (bucket=${result.bucket})`);
}
