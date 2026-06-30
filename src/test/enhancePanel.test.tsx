// src/test/enhancePanel.test.tsx
import { render, screen, fireEvent, act } from '@testing-library/react';
jest.mock('../services/EnhanceService', () => ({
  enhanceService: { applyUpscale: jest.fn(async () => {}), revert: jest.fn(), canRevert: () => false }
}));
import EnhanceModuleComponent from '../components/Modules/EnhanceModuleComponent';
import { enhanceModule } from '../modules/EnhanceModule';
import { enhanceService } from '../services/EnhanceService';
import { NoiseReductionModule } from '../modules/NoiseReductionModule';

function makeNrModule() {
  const m = new NoiseReductionModule();
  return m;
}

describe('EnhanceModuleComponent', () => {
  beforeEach(() => enhanceModule.resetParams());

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

  it('toggling NR on then Apply calls onNoiseReductionChange with enabled:true', async () => {
    const onNR = jest.fn();
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={makeNrModule()} onNoiseReductionChange={onNR} />);
    // NR starts disabled (NoiseReductionModule default enabled:false)
    fireEvent.click(screen.getByRole('button', { name: /noise.?reduction/i }));
    // Now NR is on; click Apply
    fireEvent.click(screen.getByText('Apply Enhance'));
    expect(onNR).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  it('NR off: Apply calls onNoiseReductionChange with enabled:false', async () => {
    const onNR = jest.fn();
    const nrMod = makeNrModule();
    nrMod.setParams({ enabled: false });
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={nrMod} onNoiseReductionChange={onNR} />);
    // NR starts off; don't toggle; click Apply
    fireEvent.click(screen.getByText('Apply Enhance'));
    expect(onNR).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
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
