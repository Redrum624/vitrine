import type { MaskGeometry } from '../../modules/LocalAdjustmentsModule';

/** 'live' = a drag frame; 'commit' = the release. */
export type MaskGeometryPhase = 'live' | 'commit';

export interface MaskGeometryTarget {
  setLayerGeometryDeferred(layerId: string, geom: MaskGeometry, opts?: { draft?: boolean }): boolean;
}

export interface MaskGeometryHooks {
  invalidateModuleCache(moduleId: string): void;
  /** Reprocess now, outside processingVersion (no History checkpoint, no persistence save). */
  requestLivePreview(): void;
  /** processingVersion bump: reprocess + History checkpoint + persistence (App.tsx). */
  triggerReprocessing(): void;
}

/**
 * Apply a mask geometry from the overlay (Task 12c). The geometry is stored without a
 * bake; the render rebakes the mask once at its own (post-crop) size on both GPU and CPU
 * routes. Drag frames reprocess immediately via the live-preview request; only the
 * release goes through processingVersion, so History records the drag once.
 */
export function applyMaskGeometry(
  la: MaskGeometryTarget,
  layerId: string,
  geom: MaskGeometry,
  phase: MaskGeometryPhase,
  hooks: MaskGeometryHooks,
): void {
  // Drag frames bake a capped draft (≤ DRAFT_MASK_MAX_EDGE, upsampled); the release bakes full size.
  la.setLayerGeometryDeferred(layerId, geom, { draft: phase === 'live' });
  hooks.invalidateModuleCache('localadjustments');
  if (phase === 'live') hooks.requestLivePreview();
  else hooks.triggerReprocessing();
}
