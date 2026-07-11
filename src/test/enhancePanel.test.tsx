// src/test/enhancePanel.test.tsx
// Controls what imageService.getOriginalImage() reports to the component (null = no image
// loaded → feasibility unknown → every scale stays enabled).
let mockOriginalDims: { width: number; height: number } | null = null;
import { render, screen, fireEvent, act } from '@testing-library/react';
jest.mock('../services/ImageService', () => ({ imageService: {
  getOriginalImage: jest.fn(() => (mockOriginalDims ? { data: new Float32Array(4), ...mockOriginalDims } : null)),
  getOriginalImageDimensions: jest.fn(() => mockOriginalDims),
  getCurrentImage: jest.fn(() => null),
} }));
jest.mock('../services/EnhanceService', () => ({
  // getUpscaleFeasibility is a PURE helper — use the real implementation so the
  // disabled states / tooltip numbers under test are the production ones.
  getUpscaleFeasibility: jest.requireActual('../services/EnhanceService').getUpscaleFeasibility,
  enhanceService: {
    applyUpscale: jest.fn(async () => {}), revert: jest.fn(), canRevert: () => false,
    markEnhanceApplied: jest.fn(), isEnhanceStale: jest.fn(() => false),
  },
}));
import EnhanceModuleComponent from '../components/Modules/EnhanceModuleComponent';
import { enhanceModule } from '../modules/EnhanceModule';
import { enhanceService } from '../services/EnhanceService';
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

  it('toggling NR on then Apply calls noiseReductionModule.setParams and onNoiseReductionChange with enabled:true', async () => {
    const onNR = jest.fn();
    const nrMod = makeNrModule();
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={nrMod} onNoiseReductionChange={onNR} />);
    // NR starts disabled (NoiseReductionModule default enabled:false)
    fireEvent.click(screen.getByRole('button', { name: /noise.?reduction/i }));
    // Now NR is on; click Apply
    fireEvent.click(screen.getByText('Apply Enhance'));
    expect(nrMod.setParams).toHaveBeenCalledWith({ enabled: true, strength: expect.any(Number), method: 'auto' });
    expect(onNR).toHaveBeenCalledWith({ enabled: true, strength: expect.any(Number), method: 'auto' });
  });

  it('NR off: Apply calls noiseReductionModule.setParams with enabled:false and onNoiseReductionChange with enabled:false', async () => {
    const onNR = jest.fn();
    const nrMod = makeNrModule();
    // NR module defaults to enabled:false — no setup call needed
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={nrMod} onNoiseReductionChange={onNR} />);
    // NR starts off; don't toggle; click Apply
    fireEvent.click(screen.getByText('Apply Enhance'));
    expect(nrMod.setParams).toHaveBeenCalledWith({ enabled: false });
    expect(onNR).toHaveBeenCalledWith({ enabled: false });
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

  it('sharpen path (no upscale) STILL fires onNoiseReductionChange — that reprocess is what applies enhance', () => {
    const onNR = jest.fn();
    const nrMod = makeNrModule();
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={nrMod} onNoiseReductionChange={onNR} />);
    fireEvent.click(screen.getByRole('button', { name: /noise.?reduction/i }));
    fireEvent.click(screen.getByText('Apply Enhance'));
    expect(onNR).toHaveBeenCalledWith({ enabled: true, strength: expect.any(Number), method: 'auto' });
  });
});
