// src/test/enhancePanel.test.tsx
import { render, screen, fireEvent, act } from '@testing-library/react';
jest.mock('../services/EnhanceService', () => ({ enhanceService: { applyUpscale: jest.fn(async () => {}), revert: jest.fn(), canRevert: () => false } }));
import EnhanceModuleComponent from '../components/Modules/EnhanceModuleComponent';
import { enhanceModule } from '../modules/EnhanceModule';
import { enhanceService } from '../services/EnhanceService';

describe('EnhanceModuleComponent', () => {
  beforeEach(() => enhanceModule.resetParams());
  it('shows the scale selector only when Upscale is on', () => {
    render(<EnhanceModuleComponent module={enhanceModule} />);
    expect(screen.queryByText('4×')).toBeNull();
    fireEvent.click(screen.getByText('Upscale'));
    expect(screen.getByText('4×')).toBeInTheDocument();
  });
  it('Sharpen-path Apply fires onParamsChange', () => {
    const onParamsChange = jest.fn();
    render(<EnhanceModuleComponent module={enhanceModule} onParamsChange={onParamsChange} />);
    fireEvent.click(screen.getByText('Apply Enhance'));
    expect(onParamsChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, sharpen: true, upscale: false }));
  });
  it('Upscale-path Apply calls enhanceService.applyUpscale', async () => {
    render(<EnhanceModuleComponent module={enhanceModule} />);
    fireEvent.click(screen.getByText('Upscale'));
    await act(async () => { fireEvent.click(screen.getByText(/Apply Enhance \(×/)); });
    expect(enhanceService.applyUpscale).toHaveBeenCalledWith(expect.objectContaining({ upscale: true }));
  });
});
