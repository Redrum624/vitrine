// src/test/enhancePanel.test.tsx
// Controls what imageService.getOriginalImage() reports to the component (null = no image
// loaded → feasibility unknown → every scale stays enabled).
let mockOriginalDims: { width: number; height: number } | null = null;
import { render, screen, fireEvent, act } from '@testing-library/react';
let mockBaked = false;
let mockDeblurBaked = false;
jest.mock('../services/ImageService', () => ({ imageService: {
  getOriginalImage: jest.fn(() => (mockOriginalDims ? { data: new Float32Array(4), ...mockOriginalDims } : null)),
  getOriginalImageDimensions: jest.fn(() => mockOriginalDims),
  getCurrentImage: jest.fn(() => null),
  isBakedUpscaleActive: jest.fn(() => mockBaked),
  isBakedDeblurActive: jest.fn(() => mockDeblurBaked),
} }));
jest.mock('../services/EnhanceService', () => ({
  // getUpscaleFeasibility is a PURE helper — use the real implementation so the
  // disabled states / tooltip numbers under test are the production ones.
  getUpscaleFeasibility: jest.requireActual('../services/EnhanceService').getUpscaleFeasibility,
  enhanceService: {
    applyUpscale: jest.fn(async () => {}), applyMotionDeblur: jest.fn(async () => {}),
    revert: jest.fn(), canRevert: () => false,
    markEnhanceApplied: jest.fn(), isEnhanceStale: jest.fn(() => false),
  },
}));
import EnhanceModuleComponent from '../components/Modules/EnhanceModuleComponent';
import { enhanceModule } from '../modules/EnhanceModule';
import { enhanceService } from '../services/EnhanceService';
import { imageService } from '../services/ImageService';
import { editPersistenceService } from '../services/EditPersistenceService';
import { NoiseReductionModule } from '../modules/NoiseReductionModule';
import { useAppStore } from '../stores/appStore';

function makeNrModule() {
  const m = new NoiseReductionModule();
  jest.spyOn(m, 'setParams');
  return m;
}

describe('EnhanceModuleComponent', () => {
  beforeEach(() => {
    enhanceModule.resetParams();
    useAppStore.setState({ upscaleProgress: null, upscaleMode: null });
    mockOriginalDims = null;
  });

  it('shows the scale selector only when Upscale is on', () => {
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    expect(screen.queryByText('4×')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /upscale/i }));
    expect(screen.getByText('4×')).toBeInTheDocument();
  });

  it('Sharpen-path Apply fires onParamsChange with enabled:true sharpen:true upscale:false', () => {
    const onParamsChange = jest.fn();
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} onParamsChange={onParamsChange} />);
    fireEvent.click(screen.getByText('Apply Enhance'));
    expect(onParamsChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, sharpen: true, upscale: false }));
  });

  it('Upscale-path Apply calls enhanceService.applyUpscale', async () => {
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    fireEvent.click(screen.getByRole('button', { name: /upscale/i }));
    await act(async () => { fireEvent.click(screen.getByText(/Apply Enhance \(×/)); });
    expect(enhanceService.applyUpscale).toHaveBeenCalledWith(expect.objectContaining({ upscale: true }));
  });

  it('toggling NR on then Apply (sharpen default on) commits NR params but SKIPS onNoiseReductionChange (the enhance pass carries NR)', async () => {
    const onNR = jest.fn();
    const nrMod = makeNrModule();
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={nrMod} onNoiseReductionChange={onNR} />);
    // NR starts disabled (NoiseReductionModule default enabled:false); enhance sharpen defaults ON.
    fireEvent.click(screen.getByRole('button', { name: /noise.?reduction/i }));
    // Now NR is on; click Apply — sharpen path fires onParamsChange('enhance'), whose full-pipeline
    // pass runs noise-reduction (module 7) before enhance (module 8), so the separate NR reprocess
    // is a redundant duplicate and must NOT fire (round-7 Q4).
    fireEvent.click(screen.getByText('Apply Enhance'));
    expect(nrMod.setParams).toHaveBeenCalledWith({ enabled: true, strength: expect.any(Number), method: 'auto' });
    expect(onNR).not.toHaveBeenCalled();
  });

  it('NR off + sharpen on: Apply commits noiseReductionModule.setParams(enabled:false) but SKIPS onNoiseReductionChange', async () => {
    const onNR = jest.fn();
    const nrMod = makeNrModule();
    // NR module defaults to enabled:false — no setup call needed; enhance sharpen defaults ON.
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={nrMod} onNoiseReductionChange={onNR} />);
    // NR starts off; don't toggle; click Apply — sharpen path carries the reprocess.
    fireEvent.click(screen.getByText('Apply Enhance'));
    expect(nrMod.setParams).toHaveBeenCalledWith({ enabled: false });
    expect(onNR).not.toHaveBeenCalled();
  });

  it('renders an "AI" badge when the store upscaleMode is "ai"', () => {
    act(() => { useAppStore.setState({ upscaleMode: 'ai' }); });
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    fireEvent.click(screen.getByRole('button', { name: /upscale/i })); // reveal the scale row
    expect(screen.getByTestId('upscale-mode-badge')).toHaveTextContent('AI');
  });

  it('renders a "Standard" badge when the store upscaleMode is "standard"', () => {
    act(() => { useAppStore.setState({ upscaleMode: 'standard' }); });
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    fireEvent.click(screen.getByRole('button', { name: /upscale/i }));
    expect(screen.getByTestId('upscale-mode-badge')).toHaveTextContent('Standard');
  });

  it('shows determinate progress % on the Apply button while enhancing', async () => {
    let resolveApply: () => void = () => {};
    (enhanceService.applyUpscale as jest.Mock).mockImplementationOnce(
      () => new Promise<void>((r) => { resolveApply = r; }),
    );
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    fireEvent.click(screen.getByRole('button', { name: /upscale/i }));
    await act(async () => { fireEvent.click(screen.getByText(/Apply Enhance \(×/)); }); // busy=true, apply pending
    act(() => { useAppStore.setState({ upscaleProgress: 0.45 }); });
    expect(screen.getByText(/Enhancing… 45%/)).toBeInTheDocument();
    await act(async () => { resolveApply(); }); // let it finish
  });

  it('Detail & quality section is always open and shows its sliders', () => {
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    // Section header should exist
    expect(screen.getByText('Detail & quality')).toBeInTheDocument();
    // Slider label should not be visible when collapsed (may vary by implementation)
    // Click to expand
    fireEvent.click(screen.getByText('Detail & quality'));
    expect(screen.getByText('Sharpen strength')).toBeInTheDocument();
    expect(screen.getByText('Noise reduction strength')).toBeInTheDocument();
  });
});

describe('EnhanceModuleComponent — upscale feasibility (160 MP output cap)', () => {
  beforeEach(() => {
    enhanceModule.resetParams();
    useAppStore.setState({ upscaleProgress: null, upscaleMode: null });
    mockOriginalDims = null;
    (enhanceService.applyUpscale as jest.Mock).mockClear();
  });

  it('disables ×4 with an explanatory title for a 20 MP (5200×3904) image; ×2 stays enabled', () => {
    mockOriginalDims = { width: 5200, height: 3904 };
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    fireEvent.click(screen.getByRole('button', { name: /upscale/i }));

    const x4 = screen.getByRole('button', { name: '4×' });
    expect(x4).toBeDisabled();
    const title = x4.getAttribute('title') ?? '';
    expect(title).toMatch(/325 MP/);   // 20800×15616 = 324,812,800 px → 325 MP
    expect(title).toMatch(/160 MP/);   // the cap
    expect(title).toMatch(/×2/);       // max feasible scale for this image
    expect(screen.getByRole('button', { name: '2×' })).toBeEnabled();
  });

  it('keeps ×4 enabled (no warning title) for a small 2000×1500 image', () => {
    mockOriginalDims = { width: 2000, height: 1500 };
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    fireEvent.click(screen.getByRole('button', { name: /upscale/i }));

    const x4 = screen.getByRole('button', { name: '4×' });
    expect(x4).toBeEnabled();
    expect(x4.getAttribute('title')).toBeNull();
  });

  it('prevents Apply when the SELECTED scale is infeasible (e.g. ×4 kept after an image switch)', async () => {
    mockOriginalDims = { width: 5200, height: 3904 };
    enhanceModule.setParams({ upscale: true, scale: 4 });
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);

    // Inline hint near the selector explains why, with the computed numbers.
    expect(screen.getByTestId('upscale-infeasible-hint')).toHaveTextContent(/max for this image: ×2/i);

    const apply = screen.getByRole('button', { name: /apply enhance/i });
    expect(apply).toBeDisabled();
    await act(async () => { fireEvent.click(apply); });
    expect(enhanceService.applyUpscale).not.toHaveBeenCalled();
  });

  it('still surfaces a residual service throw via the role="alert" error line', async () => {
    mockOriginalDims = { width: 2000, height: 1500 };
    (enhanceService.applyUpscale as jest.Mock).mockRejectedValueOnce(new Error('boom from service'));
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    fireEvent.click(screen.getByRole('button', { name: /upscale/i }));
    await act(async () => { fireEvent.click(screen.getByText(/Apply Enhance \(×/)); });
    expect(screen.getByRole('alert')).toHaveTextContent('boom from service');
  });
});

describe('EnhanceModuleComponent — staleness affordance (P7 item 3)', () => {
  beforeEach(() => {
    enhanceModule.resetParams();
    useAppStore.setState({ upscaleProgress: null, upscaleMode: null, externalParamsVersion: 0 });
    mockOriginalDims = null;
    (enhanceService.isEnhanceStale as jest.Mock).mockReturnValue(false);
    (enhanceService.markEnhanceApplied as jest.Mock).mockClear();
  });

  it('snapshots the upstream baseline on Apply (markEnhanceApplied) and shows NO hint yet', () => {
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    fireEvent.click(screen.getByText('Apply Enhance'));
    expect(enhanceService.markEnhanceApplied).toHaveBeenCalled();
    expect(screen.queryByTestId('enhance-stale-hint')).toBeNull();
  });

  it('shows the "Re-apply to update" hint when the service reports the enhance is stale', () => {
    (enhanceService.isEnhanceStale as jest.Mock).mockReturnValue(true);
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    expect(screen.getByTestId('enhance-stale-hint')).toHaveTextContent(/re-apply/i);
  });

  it('re-evaluates on an externalParamsVersion bump (bulk upstream change → hint appears)', () => {
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    expect(screen.queryByTestId('enhance-stale-hint')).toBeNull();
    (enhanceService.isEnhanceStale as jest.Mock).mockReturnValue(true);
    act(() => { useAppStore.setState({ externalParamsVersion: 1 }); });
    expect(screen.getByTestId('enhance-stale-hint')).toBeInTheDocument();
  });

  it('clears the hint after a re-apply (markEnhanceApplied re-snapshots; service reports fresh)', () => {
    (enhanceService.isEnhanceStale as jest.Mock).mockReturnValue(true);
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    expect(screen.getByTestId('enhance-stale-hint')).toBeInTheDocument();
    (enhanceService.isEnhanceStale as jest.Mock).mockReturnValue(false);
    fireEvent.click(screen.getByText('Apply Enhance'));
    expect(enhanceService.markEnhanceApplied).toHaveBeenCalled();
    expect(screen.queryByTestId('enhance-stale-hint')).toBeNull();
  });
});

describe('EnhanceModuleComponent — NR + Upscale single reprocess (P7 item 4)', () => {
  beforeEach(() => {
    enhanceModule.resetParams();
    useAppStore.setState({ upscaleProgress: null, upscaleMode: null });
    mockOriginalDims = { width: 2000, height: 1500 };
    (enhanceService.applyUpscale as jest.Mock).mockClear();
    (enhanceService.isEnhanceStale as jest.Mock).mockReturnValue(false);
  });

  it('upscale path with NR on commits NR params for the bake but SKIPS the redundant onNoiseReductionChange reprocess', async () => {
    const onNR = jest.fn();
    const nrMod = makeNrModule();
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={nrMod} onNoiseReductionChange={onNR} />);
    fireEvent.click(screen.getByRole('button', { name: /noise.?reduction/i })); // enable NR
    fireEvent.click(screen.getByRole('button', { name: /upscale/i }));          // enable Upscale
    await act(async () => { fireEvent.click(screen.getByText(/Apply Enhance \(×/)); });
    // NR params ARE committed to the module (applyUpscale bakes them into the new base)...
    expect(nrMod.setParams).toHaveBeenCalledWith({ enabled: true, strength: expect.any(Number), method: 'auto' });
    // ...but the parent's reprocess trigger is NOT fired — applyUpscale owns the single post-bake pass.
    expect(onNR).not.toHaveBeenCalled();
    expect(enhanceService.applyUpscale).toHaveBeenCalledWith(expect.objectContaining({ upscale: true }));
  });

  it('sharpen path with NR on commits NR params but SKIPS the redundant onNoiseReductionChange (enhance pass carries NR)', () => {
    const onNR = jest.fn();
    const onParamsChange = jest.fn();
    const nrMod = makeNrModule();
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={nrMod} onNoiseReductionChange={onNR} onParamsChange={onParamsChange} />);
    fireEvent.click(screen.getByRole('button', { name: /noise.?reduction/i })); // enable NR (sharpen defaults on)
    fireEvent.click(screen.getByText('Apply Enhance'));
    // NR params ARE committed (the enhance pass's full pipeline runs noise-reduction before enhance)...
    expect(nrMod.setParams).toHaveBeenCalledWith({ enabled: true, strength: expect.any(Number), method: 'auto' });
    // ...but the separate NR reprocess is a duplicate of the enhance pass → NOT fired (round-7 Q4).
    expect(onNR).not.toHaveBeenCalled();
    // The enhance pass IS the single reprocess that applies both NR and enhance.
    expect(onParamsChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, sharpen: true, upscale: false }));
  });

  it('NR-only path (sharpen OFF, upscale off) fires onNoiseReductionChange — it is the ONLY reprocess', () => {
    const onNR = jest.fn();
    const onParamsChange = jest.fn();
    const nrMod = makeNrModule();
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={nrMod} onNoiseReductionChange={onNR} onParamsChange={onParamsChange} />);
    fireEvent.click(screen.getByRole('button', { name: /noise.?reduction/i })); // enable NR
    fireEvent.click(screen.getByRole('button', { name: /^sharpen$/i }));          // disable sharpen (default on)
    fireEvent.click(screen.getByText('Apply Enhance'));
    // No sharpen/upscale pass exists, so the NR trigger is load-bearing and must fire.
    expect(nrMod.setParams).toHaveBeenCalledWith({ enabled: true, strength: expect.any(Number), method: 'auto' });
    expect(onNR).toHaveBeenCalledWith({ enabled: true, strength: expect.any(Number), method: 'auto' });
    // Sharpen is off → no enhance param pass.
    expect(onParamsChange).not.toHaveBeenCalled();
  });
});

describe('EnhanceModuleComponent — Chroma noise + Detail radius sliders (P10 R4)', () => {
  beforeEach(() => {
    enhanceModule.resetParams();
    useAppStore.setState({ upscaleProgress: null, upscaleMode: null });
    mockOriginalDims = null;
  });

  it('exposes the joint-bilateral chroma denoise (denoiseStrength) and graft radius (hpSigma) as sliders', () => {
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    expect(screen.getByLabelText('Chroma noise')).toBeInTheDocument();
    expect(screen.getByLabelText('Detail radius')).toBeInTheDocument();
  });

  it('the Chroma noise slider drives EnhanceParams.denoiseStrength (P7\'s filter is now reachable)', () => {
    const setParamsSpy = jest.spyOn(enhanceModule, 'setParams');
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    fireEvent.change(screen.getByLabelText('Chroma noise'), { target: { value: '5' } });
    expect(setParamsSpy).toHaveBeenCalledWith({ denoiseStrength: 5 });
  });

  it('the Detail radius slider drives EnhanceParams.hpSigma', () => {
    const setParamsSpy = jest.spyOn(enhanceModule, 'setParams');
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    fireEvent.change(screen.getByLabelText('Detail radius'), { target: { value: '2' } });
    expect(setParamsSpy).toHaveBeenCalledWith({ hpSigma: 2 });
  });
});

describe('EnhanceModuleComponent — reopen upscale re-apply notice (Q7)', () => {
  beforeEach(() => {
    enhanceModule.resetParams();
    mockBaked = false;
    mockOriginalDims = { width: 2000, height: 1500 };
    useAppStore.setState({ upscaleProgress: null, upscaleMode: null, upscaleIntent: null, developing: false });
    (enhanceService.applyUpscale as jest.Mock).mockClear();
    (enhanceService.applyUpscale as jest.Mock).mockResolvedValue(undefined);
  });
  afterEach(() => {
    mockBaked = false;
    useAppStore.setState({ upscaleIntent: null, developing: false });
  });

  it('shows the notice with scale + mode when a persisted intent exists and the base is NOT baked', () => {
    useAppStore.setState({ upscaleIntent: { scale: 2, mode: 'ai' } });
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    const notice = screen.getByTestId('upscale-reapply-notice');
    expect(notice).toHaveTextContent(/×2/);
    expect(notice).toHaveTextContent(/AI/);
    expect(screen.getByTestId('upscale-reapply-btn')).toBeEnabled();
  });

  it('hides the notice once the upscale is baked (re-applied in-session)', () => {
    mockBaked = true;
    useAppStore.setState({ upscaleIntent: { scale: 2, mode: 'ai' } });
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    expect(screen.queryByTestId('upscale-reapply-notice')).toBeNull();
  });

  it('re-apply re-runs applyUpscale with the saved scale (upscale:true) and marks applied', async () => {
    useAppStore.setState({ upscaleIntent: { scale: 4, mode: 'standard' } });
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    await act(async () => { fireEvent.click(screen.getByTestId('upscale-reapply-btn')); });
    expect(enhanceService.applyUpscale).toHaveBeenCalledWith(expect.objectContaining({ upscale: true, scale: 4 }));
    expect(enhanceService.markEnhanceApplied).toHaveBeenCalled();
  });

  it('disables the re-apply button while developing (full quality still landing)', () => {
    useAppStore.setState({ upscaleIntent: { scale: 2, mode: 'ai' }, developing: true });
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    expect(screen.getByTestId('upscale-reapply-btn')).toBeDisabled();
  });

  it('shows no notice when there is no persisted intent', () => {
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    expect(screen.queryByTestId('upscale-reapply-notice')).toBeNull();
  });
});

describe('EnhanceModuleComponent — reopen re-apply notice for deblur + stacked (Z1)', () => {
  beforeEach(() => {
    enhanceModule.resetParams();
    mockBaked = false;
    mockDeblurBaked = false;
    mockOriginalDims = { width: 2000, height: 1500 };
    useAppStore.setState({ upscaleProgress: null, upscaleMode: null, upscaleIntent: null, deblurIntent: false, bakeOrder: [], developing: false });
    (enhanceService.applyUpscale as jest.Mock).mockClear();
    (enhanceService.applyUpscale as jest.Mock).mockResolvedValue(undefined);
    (enhanceService.applyMotionDeblur as jest.Mock).mockClear();
    (enhanceService.applyMotionDeblur as jest.Mock).mockResolvedValue(undefined);
  });
  afterEach(() => {
    mockBaked = false;
    mockDeblurBaked = false;
    useAppStore.setState({ upscaleIntent: null, deblurIntent: false, bakeOrder: [], developing: false });
  });

  it('shows the notice for a deblur-only persisted intent', () => {
    useAppStore.setState({ deblurIntent: true });
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    expect(screen.getByTestId('upscale-reapply-notice')).toHaveTextContent(/deblur/i);
  });

  it('re-apply of a deblur-only intent runs applyMotionDeblur', async () => {
    useAppStore.setState({ deblurIntent: true });
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    await act(async () => { fireEvent.click(screen.getByTestId('upscale-reapply-btn')); });
    expect(enhanceService.applyMotionDeblur).toHaveBeenCalled();
    expect(enhanceService.applyUpscale).not.toHaveBeenCalled();
  });

  it('a stacked intent shows a combined notice and replays upscale THEN deblur in bakeOrder', async () => {
    useAppStore.setState({ upscaleIntent: { scale: 2, mode: 'ai' }, deblurIntent: true, bakeOrder: ['upscale', 'deblur'] });
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    const notice = screen.getByTestId('upscale-reapply-notice');
    expect(notice).toHaveTextContent(/×2/);
    expect(notice).toHaveTextContent(/deblur/i);
    await act(async () => { fireEvent.click(screen.getByTestId('upscale-reapply-btn')); });
    expect(enhanceService.applyUpscale).toHaveBeenCalledWith(expect.objectContaining({ upscale: true, scale: 2 }));
    expect(enhanceService.applyMotionDeblur).toHaveBeenCalled();
  });

  it('hides the notice once a deblur is baked (re-applied in-session)', () => {
    mockDeblurBaked = true;
    useAppStore.setState({ deblurIntent: true });
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    expect(screen.queryByTestId('upscale-reapply-notice')).toBeNull();
  });
});

describe('EnhanceModuleComponent — re-apply replays post-bake edits; mid-replay failure re-attaches (Z1 LOW)', () => {
  const savedEdits = { modules: { basicadj: { exposure: 0.7 } } };

  beforeEach(() => {
    enhanceModule.resetParams();
    mockBaked = false;
    mockDeblurBaked = false;
    mockOriginalDims = { width: 2000, height: 1500 };
    useAppStore.setState({ upscaleProgress: null, upscaleMode: null, upscaleIntent: null, deblurIntent: false, bakeOrder: [], developing: false });
    (enhanceService.applyUpscale as jest.Mock).mockClear();
    (enhanceService.applyUpscale as jest.Mock).mockResolvedValue(undefined);
    (enhanceService.applyMotionDeblur as jest.Mock).mockClear();
    (enhanceService.applyMotionDeblur as jest.Mock).mockResolvedValue(undefined);
    // handleReapply reads the saved state through the CURRENT image's path.
    (imageService.getCurrentImage as jest.Mock).mockReturnValue({ filePath: '/test/shot.orf', width: 100, height: 100 });
    jest.spyOn(editPersistenceService, 'getSavedEditState')
      .mockResolvedValue({ version: 1, modules: {}, editsOnBakedBase: savedEdits });
    jest.spyOn(editPersistenceService, 'applyPostBakeEdits').mockImplementation(() => {});
    jest.spyOn(editPersistenceService, 'persistPostBakeEdits').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    (imageService.getCurrentImage as jest.Mock).mockReturnValue(null);
    useAppStore.setState({ upscaleIntent: null, deblurIntent: false, bakeOrder: [], developing: false });
  });

  it('SUCCESS: applies the saved post-bake edits and durably re-attaches them (persistPostBakeEdits, not flush)', async () => {
    useAppStore.setState({ upscaleIntent: { scale: 2, mode: 'ai' } });
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    await act(async () => { fireEvent.click(screen.getByTestId('upscale-reapply-btn')); });
    expect(editPersistenceService.applyPostBakeEdits).toHaveBeenCalledWith(savedEdits, 100, 100);
    expect(editPersistenceService.persistPostBakeEdits).toHaveBeenCalledWith(savedEdits);
  });

  it('MID-REPLAY FAILURE: re-attaches the already-read edits to disk instead of dropping them', async () => {
    // Stacked replay: upscale succeeds (its persist consumed editsOnBakedBase), deblur throws.
    useAppStore.setState({ upscaleIntent: { scale: 2, mode: 'ai' }, deblurIntent: true, bakeOrder: ['upscale', 'deblur'] });
    (enhanceService.applyMotionDeblur as jest.Mock).mockRejectedValue(new Error('deblur backend gone'));
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} />);
    await act(async () => { fireEvent.click(screen.getByTestId('upscale-reapply-btn')); });
    // The edits were never applied (replay aborted) but ARE re-attached for a retry / next reopen.
    expect(editPersistenceService.applyPostBakeEdits).not.toHaveBeenCalled();
    expect(editPersistenceService.persistPostBakeEdits).toHaveBeenCalledWith(savedEdits);
    expect(screen.getByRole('alert')).toHaveTextContent('deblur backend gone');
  });
});
