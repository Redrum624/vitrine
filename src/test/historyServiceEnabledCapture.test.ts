/**
 * Round-9 MEDIUM-3: HistoryService.captureCurrentModuleSettings read the enabled flag as
 * `moduleInterface.isEnabled?.() || true` — calling isEnabled as a METHOD (it is a boolean
 * field/getter on the real pipeline modules), which threw "is not a function", was swallowed
 * by the per-module try/catch, and dropped the module from the captured settings entirely.
 * The `|| true` also forced every captured module to enabled:true. Both are the exact bug Z2
 * repaired in PresetService; the minimal fix is the same `?? true` boolean-field read.
 *
 * hasUnsavedChanges() is a LIVE caller (App.tsx registers it as an app-close unsaved checker),
 * so this is not dead code — a toggled module must register as an unsaved change.
 */
import { HistoryService } from '../services/HistoryService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';

describe('HistoryService — captures the real enabled flag (MEDIUM-3)', () => {
  afterEach(() => {
    imageProcessingPipeline.setModuleEnabled('colorbalance', true);
  });

  it('detects a module enable→disable as an unsaved change', () => {
    const svc = new HistoryService();
    imageProcessingPipeline.setModuleEnabled('colorbalance', true);

    svc.saveState('base'); // baseline snapshot with colorbalance enabled

    // Toggle only the enabled flag. Before the fix, capture threw for colorbalance (boolean
    // isEnabled) so it was absent from BOTH snapshots → compared equal → change missed.
    imageProcessingPipeline.setModuleEnabled('colorbalance', false);

    expect(svc.hasUnsavedChanges()).toBe(true);
  });
});
