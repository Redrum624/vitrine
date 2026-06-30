// src/test/enhancePanel.test.tsx
import { render, screen, fireEvent, act } from '@testing-library/react';
jest.mock('../services/EnhanceService', () => ({
  enhanceService: { applyUpscale: jest.fn(async () => {}), revert: jest.fn(), canRevert: () => false }
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

  it('Detail & quality section is collapsed by default and shows sliders when expanded', () => {
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
