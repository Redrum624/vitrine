/**
 * Preset apply must repaint the canvas — before this fix, PresetDialog called
 * presetService.applyPreset() (which mutates pipeline module state directly)
 * without ever calling notifyExternalParamsChange()/triggerReprocessing(), the
 * same follow-up doUndo/doRedo use after CheckpointService.restore() (see
 * App.tsx doUndo). So a preset applied its settings to the pipeline but the
 * canvas + panels never re-rendered until some unrelated edit nudged them.
 *
 * Covers: a successful apply fires both store bumps + onApplyPreset; a failed
 * apply (presetService.applyPreset returns false) fires neither.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const getAllPresets = jest.fn();
const applyPreset = jest.fn();
const hasUnportableBrushLayers = jest.fn();

jest.mock('../services/PresetService', () => ({
  presetService: {
    getAllPresets: (...args: unknown[]) => getAllPresets(...args),
    applyPreset: (...args: unknown[]) => applyPreset(...args),
    hasUnportableBrushLayers: (...args: unknown[]) => hasUnportableBrushLayers(...args),
  },
}));

import { PresetDialog } from '../components/Dialogs/PresetDialog';
import { useAppStore } from '../stores/appStore';
import type { AdjustmentPreset } from '../services/PresetService';

const preset: AdjustmentPreset = {
  id: 'preset_1',
  name: 'Golden Hour',
  description: 'Warm portrait look',
  category: 'custom',
  tags: [],
  createdAt: '',
  modifiedAt: '',
  settings: {},
  metadata: { version: '1.0.0', compatibility: ['1.0.0'], imageCount: 0, rating: 0 },
};

function setup() {
  const onApplyPreset = jest.fn();
  const onClose = jest.fn();
  render(<PresetDialog isOpen={true} onClose={onClose} onApplyPreset={onApplyPreset} />);
  return { onApplyPreset, onClose };
}

describe('PresetDialog — repaint after preset apply', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getAllPresets.mockReturnValue([preset]);
    hasUnportableBrushLayers.mockReturnValue(false);
    useAppStore.setState({ processingVersion: 0, externalParamsVersion: 0 });
  });

  it('bumps notifyExternalParamsChange + triggerReprocessing and calls onApplyPreset after a successful apply', async () => {
    applyPreset.mockReturnValue(true);
    const { onApplyPreset } = setup();

    fireEvent.click(await screen.findByText('Golden Hour'));

    await waitFor(() => expect(applyPreset).toHaveBeenCalledWith('preset_1'));
    expect(useAppStore.getState().externalParamsVersion).toBe(1);
    expect(useAppStore.getState().processingVersion).toBe(1);
    expect(onApplyPreset).toHaveBeenCalledWith(preset);
  });

  it('does NOT repaint or call onApplyPreset when the apply fails', async () => {
    applyPreset.mockReturnValue(false);
    const { onApplyPreset } = setup();

    fireEvent.click(await screen.findByText('Golden Hour'));

    await waitFor(() => expect(applyPreset).toHaveBeenCalledWith('preset_1'));
    expect(useAppStore.getState().externalParamsVersion).toBe(0);
    expect(useAppStore.getState().processingVersion).toBe(0);
    expect(onApplyPreset).not.toHaveBeenCalled();
  });
});
