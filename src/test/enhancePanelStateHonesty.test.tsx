// src/test/enhancePanelStateHonesty.test.tsx
// C4 (v1.36.0 wave) — Enhance panel state honesty: prefs-seeding gates (findings 1/2/5),
// the ONE commit model (finding 3: staged until Apply arms the module, live write-through
// after — matching every other module panel), no-op bakes must not mark applied (finding 4),
// re-apply re-derives from the PERSISTED pre-bake enhance params (finding 6), and header
// Reset neutralizes everything the panel shows as active (finding 8).
let mockOriginalDims: { width: number; height: number } | null = null;
let mockBaked = false;
let mockDeblurBaked = false;
import { render, screen, fireEvent, act } from '@testing-library/react';
jest.mock('../services/ImageService', () => ({ imageService: {
  getOriginalImage: jest.fn(() => (mockOriginalDims ? { data: new Float32Array(4), ...mockOriginalDims } : null)),
  getOriginalImageDimensions: jest.fn(() => mockOriginalDims),
  getCurrentImage: jest.fn(() => null),
  isBakedUpscaleActive: jest.fn(() => mockBaked),
  isBakedDeblurActive: jest.fn(() => mockDeblurBaked),
} }));
// Restore-stack depth is the panel's "did the bake actually commit?" signal (finding 4):
// guard-refusals (developing window, in-flight) return without pushing a restore point.
let mockRestoreDepth = 0;
jest.mock('../services/EnhanceService', () => ({
  getUpscaleFeasibility: jest.requireActual('../services/EnhanceService').getUpscaleFeasibility,
  enhanceService: {
    applyUpscale: jest.fn(async () => {}),
    applyMotionDeblur: jest.fn(async () => {}),
    revert: jest.fn(), canRevert: () => false,
    markEnhanceApplied: jest.fn(), isEnhanceStale: jest.fn(() => false),
    getRestoreDepth: jest.fn(() => mockRestoreDepth),
  },
}));
let mockPrefs: Record<string, unknown> | null = null;
jest.mock('../utils/enhancePrefsStorage', () => ({
  loadEnhancePrefs: jest.fn(async () => mockPrefs),
  saveEnhancePrefs: jest.fn(),
}));
jest.mock('../services/AiDeblurClient', () => ({ aiDeblurClient: { isAvailable: jest.fn(async () => false) } }));
import EnhanceModuleComponent from '../components/Modules/EnhanceModuleComponent';
import { EnhanceModule } from '../modules/EnhanceModule';
import { NoiseReductionModule, NoiseReductionParams } from '../modules/NoiseReductionModule';
import { DEFAULT_ENHANCE_PARAMS, EnhanceParams } from '../utils/enhanceChain';
import { enhanceService } from '../services/EnhanceService';
import { imageService } from '../services/ImageService';
import { aiDeblurClient } from '../services/AiDeblurClient';
import { editPersistenceService } from '../services/EditPersistenceService';
import { useAppStore } from '../stores/appStore';
import type { ModuleCardActions } from '../components/Controls/moduleCardActions';

interface PanelProps {
  onParamsChange?: (p: Partial<EnhanceParams>) => void;
  onNoiseReductionChange?: (p: Partial<NoiseReductionParams>) => void;
  onRegisterActions?: (a: ModuleCardActions | null) => void;
}

/** Render and flush the async prefs-seeding effect (loadEnhancePrefs().then). */
async function renderPanel(module: EnhanceModule, nrModule: NoiseReductionModule, props: PanelProps = {}) {
  const utils = render(
    <EnhanceModuleComponent module={module} noiseReductionModule={nrModule} {...props} />,
  );
  await act(async () => { await Promise.resolve(); });
  return utils;
}

beforeEach(() => {
  mockOriginalDims = { width: 2000, height: 1500 };
  mockBaked = false;
  mockDeblurBaked = false;
  mockPrefs = null;
  mockRestoreDepth = 0;
  useAppStore.setState({
    upscaleProgress: null, upscaleMode: null, upscaleIntent: null,
    deblurIntent: false, bakeOrder: [], developing: false, externalParamsVersion: 0,
  });
  (enhanceService.applyUpscale as jest.Mock).mockClear();
  (enhanceService.applyUpscale as jest.Mock).mockImplementation(async () => {});
  (enhanceService.applyMotionDeblur as jest.Mock).mockClear();
  (enhanceService.applyMotionDeblur as jest.Mock).mockImplementation(async () => {});
  (enhanceService.markEnhanceApplied as jest.Mock).mockClear();
  (enhanceService.isEnhanceStale as jest.Mock).mockReturnValue(false);
  (imageService.getCurrentImage as jest.Mock).mockReturnValue(null);
  (aiDeblurClient.isAvailable as jest.Mock).mockResolvedValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
  useAppStore.setState({ upscaleIntent: null, deblurIntent: false, bakeOrder: [], developing: false });
});

describe('finding 1 — prefs seeding never overrides a LIVE (enabled) module', () => {
  it('does NOT seed pref sliders into an enabled module whose sliders sit at factory defaults', async () => {
    mockPrefs = { sharpness: 0.9, rlIters: 20 };
    const mod = new EnhanceModule();
    mod.setParams({ enabled: true, sharpen: true }); // applied Sharpen, default sliders
    await renderPanel(mod, new NoiseReductionModule());
    expect(mod.getParams().sharpness).toBe(DEFAULT_ENHANCE_PARAMS.sharpness);
    expect(mod.getParams().rlIters).toBe(DEFAULT_ENHANCE_PARAMS.rlIters);
  });

  it('still seeds a disabled at-defaults module (the prefs memory keeps working)', async () => {
    mockPrefs = { sharpness: 0.9 };
    const mod = new EnhanceModule();
    await renderPanel(mod, new NoiseReductionModule());
    expect(mod.getParams().sharpness).toBe(0.9);
  });
});

describe('finding 2 — NR seeding gates on the NR module’s OWN defaults', () => {
  it('does NOT overwrite the NR display when the NR module carries saved per-image state', async () => {
    mockPrefs = { nrEnabled: false, nrStrength: 20 };
    const nr = new NoiseReductionModule();
    nr.setParams({ enabled: true, strength: 70 }); // saved NR-only edits restored
    await renderPanel(new EnhanceModule(), nr);    // enhance module at defaults → old gate leaked
    expect(screen.getByRole('button', { name: /noise.?reduction/i })).toHaveAttribute('aria-pressed', 'true');
    expect((screen.getByLabelText('Noise reduction strength') as HTMLInputElement).value).toBe('70');
  });

  it('seeds NR locals when the NR module is at factory defaults', async () => {
    mockPrefs = { nrEnabled: true, nrStrength: 35 };
    await renderPanel(new EnhanceModule(), new NoiseReductionModule());
    expect(screen.getByRole('button', { name: /noise.?reduction/i })).toHaveAttribute('aria-pressed', 'true');
    expect((screen.getByLabelText('Noise reduction strength') as HTMLInputElement).value).toBe('35');
  });
});

describe('finding 3 — ONE commit model: staged until Apply arms the module, live write-through after', () => {
  it('slider edits on a LIVE (enabled) module fire onParamsChange (write-through reprocess)', async () => {
    const mod = new EnhanceModule();
    mod.setParams({ enabled: true, sharpen: true });
    const onParamsChange = jest.fn();
    await renderPanel(mod, new NoiseReductionModule(), { onParamsChange });
    fireEvent.change(screen.getByLabelText('Sharpen strength'), { target: { value: '0.8' } });
    expect(onParamsChange).toHaveBeenCalledWith({ sharpness: 0.8 });
    expect(mod.getParams().sharpness).toBe(0.8);
  });

  it('toggling Sharpen OFF on a LIVE module fires onParamsChange (the removal must render)', async () => {
    const mod = new EnhanceModule();
    mod.setParams({ enabled: true, sharpen: true });
    const onParamsChange = jest.fn();
    await renderPanel(mod, new NoiseReductionModule(), { onParamsChange });
    fireEvent.click(screen.getByRole('button', { name: /^sharpen$/i }));
    expect(onParamsChange).toHaveBeenCalledWith({ sharpen: false });
  });

  it('slider edits stay STAGED (no reprocess) while the module is not yet applied', async () => {
    const mod = new EnhanceModule();
    const onParamsChange = jest.fn();
    await renderPanel(mod, new NoiseReductionModule(), { onParamsChange });
    fireEvent.change(screen.getByLabelText('Sharpen strength'), { target: { value: '0.8' } });
    expect(onParamsChange).not.toHaveBeenCalled();
  });

  it('NR strength edits on a LIVE NR module commit to the module and fire onNoiseReductionChange', async () => {
    const nr = new NoiseReductionModule();
    nr.setParams({ enabled: true, strength: 50 });
    const setParamsSpy = jest.spyOn(nr, 'setParams');
    const onNR = jest.fn();
    await renderPanel(new EnhanceModule(), nr, { onNoiseReductionChange: onNR });
    fireEvent.change(screen.getByLabelText('Noise reduction strength'), { target: { value: '80' } });
    expect(setParamsSpy).toHaveBeenCalledWith({ enabled: true, strength: 80, method: 'auto' });
    expect(onNR).toHaveBeenCalledWith({ enabled: true, strength: 80, method: 'auto' });
  });

  it('toggling NR OFF on a LIVE NR module commits the disable immediately', async () => {
    const nr = new NoiseReductionModule();
    nr.setParams({ enabled: true, strength: 60 });
    const onNR = jest.fn();
    await renderPanel(new EnhanceModule(), nr, { onNoiseReductionChange: onNR });
    fireEvent.click(screen.getByRole('button', { name: /noise.?reduction/i }));
    expect(nr.getParams().enabled).toBe(false);
    expect(onNR).toHaveBeenCalledWith({ enabled: false });
  });

  it('NR edits stay STAGED while the NR module is disabled (Apply commits them)', async () => {
    const nr = new NoiseReductionModule();
    const setParamsSpy = jest.spyOn(nr, 'setParams');
    const onNR = jest.fn();
    await renderPanel(new EnhanceModule(), nr, { onNoiseReductionChange: onNR });
    fireEvent.click(screen.getByRole('button', { name: /noise.?reduction/i })); // display on, staged
    fireEvent.change(screen.getByLabelText('Noise reduction strength'), { target: { value: '80' } });
    expect(setParamsSpy).not.toHaveBeenCalled();
    expect(onNR).not.toHaveBeenCalled();
  });
});

describe('finding 4 — silent no-op bakes must not mark applied; Apply gated while developing', () => {
  it('does NOT mark applied / bump revert when the upscale bake was refused (no restore point pushed)', async () => {
    const mod = new EnhanceModule();
    await renderPanel(mod, new NoiseReductionModule());
    fireEvent.click(screen.getByRole('button', { name: /upscale/i }));
    await act(async () => { fireEvent.click(screen.getByText(/Apply Enhance \(×/)); });
    expect(enhanceService.applyUpscale).toHaveBeenCalled();
    expect(enhanceService.markEnhanceApplied).not.toHaveBeenCalled();
  });

  it('marks applied when the upscale bake actually committed (restore depth grew)', async () => {
    (enhanceService.applyUpscale as jest.Mock).mockImplementation(async () => { mockRestoreDepth = 1; });
    const mod = new EnhanceModule();
    await renderPanel(mod, new NoiseReductionModule());
    fireEvent.click(screen.getByRole('button', { name: /upscale/i }));
    await act(async () => { fireEvent.click(screen.getByText(/Apply Enhance \(×/)); });
    expect(enhanceService.markEnhanceApplied).toHaveBeenCalled();
  });

  it('motion deblur: a refused bake does not mark applied; a committed one does', async () => {
    (aiDeblurClient.isAvailable as jest.Mock).mockResolvedValue(true);
    const mod = new EnhanceModule();
    await renderPanel(mod, new NoiseReductionModule());
    // Refused (depth unchanged).
    await act(async () => { fireEvent.click(screen.getByTestId('motion-deblur-apply')); });
    expect(enhanceService.applyMotionDeblur).toHaveBeenCalled();
    expect(enhanceService.markEnhanceApplied).not.toHaveBeenCalled();
    // Committed (depth grew).
    (enhanceService.applyMotionDeblur as jest.Mock).mockImplementation(async () => { mockRestoreDepth += 1; });
    await act(async () => { fireEvent.click(screen.getByTestId('motion-deblur-apply')); });
    expect(enhanceService.markEnhanceApplied).toHaveBeenCalled();
  });

  it('the Apply button is disabled while developing (parity with Re-apply and Motion deblur)', async () => {
    useAppStore.setState({ developing: true });
    await renderPanel(new EnhanceModule(), new NoiseReductionModule());
    expect(screen.getByRole('button', { name: /apply enhance/i })).toBeDisabled();
  });
});

describe('finding 5 — post-bake prefs re-seed must not re-arm the Upscale toggle', () => {
  it('skips seeding `upscale` while a baked upscale is live (accidental stacked bake guard)', async () => {
    mockBaked = true;
    mockPrefs = { upscale: true, scale: 4 as const };
    const mod = new EnhanceModule(); // at factory defaults after the bake's resetAllModules
    await renderPanel(mod, new NoiseReductionModule());
    expect(mod.getParams().upscale).toBe(false);
    expect(screen.getByRole('button', { name: /upscale/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('still seeds `upscale` when no bake is live', async () => {
    mockPrefs = { upscale: true };
    const mod = new EnhanceModule();
    await renderPanel(mod, new NoiseReductionModule());
    expect(mod.getParams().upscale).toBe(true);
  });
});

describe('finding 6 — re-apply re-derives from the PERSISTED pre-bake enhance params', () => {
  it('feeds the saved editState’s enhance params into applyUpscale, not the live (prefs-seeded) ones', async () => {
    useAppStore.setState({ upscaleIntent: { scale: 2, mode: 'ai' } });
    (imageService.getCurrentImage as jest.Mock).mockReturnValue({ filePath: '/test/shot.orf', width: 10, height: 10 });
    jest.spyOn(editPersistenceService, 'getSavedEditState').mockResolvedValue({
      version: 1,
      modules: { enhance: { ...DEFAULT_ENHANCE_PARAMS, sharpness: 0.9, denoiseStrength: 4 } },
    });
    const mod = new EnhanceModule();
    mod.setParams({ sharpness: 0.15, denoiseStrength: 8 }); // live panel state drifted (e.g. prefs-seeded)
    await renderPanel(mod, new NoiseReductionModule());
    await act(async () => { fireEvent.click(screen.getByTestId('upscale-reapply-btn')); });
    expect(enhanceService.applyUpscale).toHaveBeenCalledWith(
      expect.objectContaining({ sharpness: 0.9, denoiseStrength: 4, upscale: true, scale: 2 }),
    );
  });
});

describe('finding 8 — header Reset neutralizes everything the panel shows as active', () => {
  it('resets toggles (NR / Sharpen / Upscale) and staged NR strength, not just detail sliders', async () => {
    const actions: { current: ModuleCardActions | null } = { current: null };
    const mod = new EnhanceModule();
    const nr = new NoiseReductionModule();
    await renderPanel(mod, nr, { onRegisterActions: (a) => { if (a) actions.current = a; } });
    fireEvent.click(screen.getByRole('button', { name: /noise.?reduction/i })); // NR display on (staged)
    fireEvent.click(screen.getByRole('button', { name: /upscale/i }));           // Upscale armed
    fireEvent.change(screen.getByLabelText('Noise reduction strength'), { target: { value: '80' } });
    expect(actions.current?.reset).toBeDefined();
    act(() => { actions.current!.reset!(); });
    expect(screen.getByRole('button', { name: /noise.?reduction/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /upscale/i })).toHaveAttribute('aria-pressed', 'false');
    expect(mod.getParams().upscale).toBe(false);
    expect(mod.getParams().sharpen).toBe(DEFAULT_ENHANCE_PARAMS.sharpen);
    expect((screen.getByLabelText('Noise reduction strength') as HTMLInputElement).value).toBe('50');
  });

  it('Reset on a LIVE enhance module commits the disable and fires the reprocess', async () => {
    const actions: { current: ModuleCardActions | null } = { current: null };
    const mod = new EnhanceModule();
    mod.setParams({ enabled: true, sharpen: true, sharpness: 0.8 });
    const onParamsChange = jest.fn();
    await renderPanel(mod, new NoiseReductionModule(), { onParamsChange, onRegisterActions: (a) => { if (a) actions.current = a; } });
    act(() => { actions.current!.reset!(); });
    expect(mod.getParams().enabled).toBe(false);
    expect(mod.getParams().sharpness).toBe(DEFAULT_ENHANCE_PARAMS.sharpness);
    expect(onParamsChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('Reset on a LIVE NR module (enhance not applied) commits the NR disable via its own trigger', async () => {
    const actions: { current: ModuleCardActions | null } = { current: null };
    const nr = new NoiseReductionModule();
    nr.setParams({ enabled: true, strength: 60 });
    const onNR = jest.fn();
    await renderPanel(new EnhanceModule(), nr, { onNoiseReductionChange: onNR, onRegisterActions: (a) => { if (a) actions.current = a; } });
    act(() => { actions.current!.reset!(); });
    expect(nr.getParams().enabled).toBe(false);
    expect(onNR).toHaveBeenCalledWith({ enabled: false });
  });
});
