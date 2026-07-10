// src/components/Modules/EnhanceModuleComponent.tsx
import { useCallback, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { EnhanceModule } from '../../modules/EnhanceModule';
import { NoiseReductionModule, NoiseReductionParams } from '../../modules/NoiseReductionModule';
import { EnhanceParams, DEFAULT_ENHANCE_PARAMS } from '../../utils/enhanceChain';
import { enhanceService, getUpscaleFeasibility, UpscaleFeasibility } from '../../services/EnhanceService';
import { imageService } from '../../services/ImageService';
import { imageProcessingPipeline } from '../../services/ImageProcessingPipeline';
import { useAppStore } from '../../stores/appStore';
import { useRegisterModuleCardActions, type RegisterModuleCardActions } from '../Controls/moduleCardActions';
import { SectionLabel } from '../Controls/SectionLabel';
import { ChipButton } from '../Controls/ChipButton';
import { SliderRow } from '../Controls/SliderRow';

interface Props {
  module: EnhanceModule;
  noiseReductionModule: NoiseReductionModule;
  onParamsChange?: (p: Partial<EnhanceParams>) => void;
  onNoiseReductionChange?: (p: Partial<NoiseReductionParams>) => void;
  /** Surfaces this module's Reset to the unified card header (Task 2; no auto). */
  onRegisterActions?: RegisterModuleCardActions;
}

export default function EnhanceModuleComponent({ module, noiseReductionModule, onParamsChange, onNoiseReductionChange, onRegisterActions }: Props) {
  const [params, setParams] = useState<EnhanceParams>(() => module.getParams());
  const paramsRef = useRef(params); paramsRef.current = params;
  const [nrEnabled, setNrEnabled] = useState<boolean>(() => noiseReductionModule.getParams().enabled);
  const [nrStrength, setNrStrength] = useState<number>(() => noiseReductionModule.getParams().strength);
  const [busy, setBusy] = useState(false);
  const upscaleProgress = useAppStore((s) => s.upscaleProgress);
  const upscaleMode = useAppStore((s) => s.upscaleMode);
  const [error, setError] = useState<string | null>(null);
  const [revertVersion, setRevertVersion] = useState(0);

  const update = useCallback((patch: Partial<EnhanceParams>) => {
    setParams((prev) => ({ ...prev, ...patch }));
    module.setParams(patch);
  }, [module]);

  const resetSection = useCallback(() => {
    setNrStrength(50);
    update({
      sharpness: DEFAULT_ENHANCE_PARAMS.sharpness,
      alpha: DEFAULT_ENHANCE_PARAMS.alpha,
      hpSigma: DEFAULT_ENHANCE_PARAMS.hpSigma,
      psfSigma: DEFAULT_ENHANCE_PARAMS.psfSigma,
      rlIters: DEFAULT_ENHANCE_PARAMS.rlIters,
      chromaClean: DEFAULT_ENHANCE_PARAMS.chromaClean,
    });
  }, [update]);

  // Card header (Task 2): Reset ↺ = reset the detail/quality params (Enhance has
  // no auto function). Reuses the existing resetSection handler unchanged.
  useRegisterModuleCardActions(onRegisterActions, { reset: resetSection });

  const handleApply = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      if (nrEnabled) {
        const nrParams = { enabled: true, strength: nrStrength, method: 'auto' as const };
        noiseReductionModule.setParams(nrParams);
        onNoiseReductionChange?.(nrParams);
      } else {
        const nrParams = { enabled: false };
        noiseReductionModule.setParams(nrParams);
        onNoiseReductionChange?.(nrParams);
      }
      if (paramsRef.current.upscale) {
        await enhanceService.applyUpscale({ ...paramsRef.current, upscale: true });
        setRevertVersion((v) => v + 1);
      } else if (paramsRef.current.sharpen) {
        const patch = { enabled: true, sharpen: true, upscale: false };
        module.setParams(patch); setParams((p) => ({ ...p, ...patch }));
        onParamsChange?.(patch);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [nrEnabled, nrStrength, module, onParamsChange, onNoiseReductionChange]);

  const currentParams = paramsRef.current;

  // Per-scale output-size feasibility for the CURRENT image (crop-adjusted dims, mirroring
  // EnhanceService.applyUpscale). Unknown dims (no image) ⇒ leave every scale enabled; the
  // service guard still protects the actual apply.
  const feasibility: Partial<Record<2 | 4, UpscaleFeasibility>> = (() => {
    const original = imageService.getOriginalImage();
    if (!original) return {};
    const cropMod = imageProcessingPipeline.getModule?.('crop') as
      | { getOutputDimensions(w: number, h: number): { width: number; height: number } }
      | undefined;
    const dims = cropMod
      ? cropMod.getOutputDimensions(original.width, original.height)
      : { width: original.width, height: original.height };
    return {
      2: getUpscaleFeasibility(dims.width, dims.height, 2),
      4: getUpscaleFeasibility(dims.width, dims.height, 4),
    };
  })();

  const infeasibleHint = (s: 2 | 4): string | undefined => {
    const f = feasibility[s];
    if (!f || f.feasible) return undefined;
    const outMP = Math.round(f.outputPixels / 1e6);
    const maxMP = Math.round(f.maxPixels / 1e6);
    const maxHint = f.maxFeasibleScale !== null ? ` (max for this image: ×${f.maxFeasibleScale})` : '';
    return `×${s} would create a ${outMP} MP image — over the ${maxMP} MP limit${maxHint}`;
  };

  const selectedScaleInfeasible =
    params.upscale && feasibility[params.scale as 2 | 4]?.feasible === false;

  // Mode tile look: idle vs active (accent-soft/ring/text), shared across the
  // three toggles — same tokens ChipButton uses, just a taller stacked layout
  // (dot indicator + label) that ChipButton itself doesn't model.
  const modeTileStyle = (active: boolean): CSSProperties => ({
    flex: 1,
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    padding: '10px 6px',
    borderRadius: 9,
    border: `1px solid ${active ? 'var(--accent-ring)' : 'rgba(255,255,255,.1)'}`,
    background: active ? 'var(--accent-soft)' : 'rgba(255,255,255,.04)',
    color: active ? 'var(--accent)' : 'var(--glass-text-secondary)',
    fontSize: 11.5, fontWeight: 500, cursor: 'pointer',
  });
  const modeDotStyle = (active: boolean): CSSProperties => ({
    width: 8, height: 8, borderRadius: '50%',
    background: active ? 'var(--accent)' : 'rgba(255,255,255,.2)',
    boxShadow: active ? '0 0 0 3px var(--accent-soft)' : undefined,
  });

  return (
    <div className="enhance-panel px-5 pt-4" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Three mode toggles */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" aria-pressed={nrEnabled} onClick={() => setNrEnabled((v) => !v)} style={modeTileStyle(nrEnabled)}>
          <span style={modeDotStyle(nrEnabled)} />
          <span>Noise Reduction</span>
        </button>

        <button type="button" aria-pressed={params.sharpen} onClick={() => update({ sharpen: !params.sharpen })} style={modeTileStyle(params.sharpen)}>
          <span style={modeDotStyle(params.sharpen)} />
          <span>Sharpen</span>
        </button>

        <button type="button" aria-pressed={params.upscale} onClick={() => update({ upscale: !params.upscale })} style={modeTileStyle(params.upscale)}>
          <span style={modeDotStyle(params.upscale)} />
          <span>Upscale</span>
        </button>
      </div>

      {/* Scale selector (only when Upscale on) */}
      {params.upscale && (
        <div className="flex flex-col" style={{ gap: 8 }}>
          <div className="flex items-center" style={{ gap: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--glass-text-label)', marginRight: 'auto' }}>Scale</span>
            {upscaleMode && (
              <span
                data-testid="upscale-mode-badge"
                title="AI upscale uses your GPU when available; falls back to Standard otherwise."
                style={{
                  fontSize: 9.5, fontWeight: 700, letterSpacing: '.04em', padding: '2px 7px',
                  borderRadius: 999, textTransform: 'uppercase',
                  background: upscaleMode === 'ai' ? 'var(--accent-soft)' : 'rgba(255,255,255,.04)',
                  color: upscaleMode === 'ai' ? 'var(--accent)' : 'var(--glass-text-secondary)',
                  border: `1px solid ${upscaleMode === 'ai' ? 'var(--accent-ring)' : 'rgba(255,255,255,.1)'}`,
                }}
              >
                {upscaleMode === 'ai' ? 'AI' : 'Standard'}
              </span>
            )}
            <div className="flex" style={{ gap: 4 }}>
              {([2, 4] as const).map((s) => {
                const infeasible = feasibility[s]?.feasible === false;
                return (
                  <ChipButton
                    key={s}
                    active={params.scale === s}
                    disabled={infeasible}
                    title={infeasibleHint(s)}
                    onClick={() => update({ scale: s })}
                  >
                    {s}×
                  </ChipButton>
                );
              })}
            </div>
          </div>
          {selectedScaleInfeasible && (
            <div data-testid="upscale-infeasible-hint" style={{ fontSize: 10.5, color: '#f87171' }}>
              {infeasibleHint(params.scale as 2 | 4)}
            </div>
          )}
          <div style={{ fontSize: 10.5, color: 'var(--glass-text-muted)' }}>
            AI super-resolution on your GPU when available, otherwise Standard (Lanczos).
          </div>
        </div>
      )}

      {/* Detail & quality */}
      <div className="flex flex-col" style={{ gap: 12 }}>
        <SectionLabel>Detail & quality</SectionLabel>

        <SliderRow
          label="Noise reduction strength"
          value={nrStrength}
          defaultValue={50}
          min={0}
          max={100}
          step={1}
          onChange={setNrStrength}
        />
        <SliderRow
          label="Sharpen strength"
          value={params.sharpness}
          defaultValue={DEFAULT_ENHANCE_PARAMS.sharpness}
          min={0}
          max={1}
          step={0.05}
          formatValue={(v) => v.toFixed(2)}
          onChange={(v) => update({ sharpness: v })}
        />
        <SliderRow
          label="Detail amount"
          value={params.alpha}
          defaultValue={DEFAULT_ENHANCE_PARAMS.alpha}
          min={0}
          max={1}
          step={0.05}
          formatValue={(v) => v.toFixed(2)}
          onChange={(v) => update({ alpha: v })}
        />
        <SliderRow
          label="Deblur radius"
          value={params.psfSigma}
          defaultValue={DEFAULT_ENHANCE_PARAMS.psfSigma}
          min={0.5}
          max={3}
          step={0.1}
          formatValue={(v) => `${v.toFixed(1)} px`}
          onChange={(v) => update({ psfSigma: v })}
        />
        <SliderRow
          label="Deblur iterations"
          value={params.rlIters}
          defaultValue={DEFAULT_ENHANCE_PARAMS.rlIters}
          min={0}
          max={30}
          step={1}
          onChange={(v) => update({ rlIters: v })}
        />

        <label className="flex items-center gap-2" style={{ fontSize: 11.5, color: 'var(--glass-text-label)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={params.chromaClean}
            onChange={(e) => update({ chromaClean: e.target.checked })}
          />
          Chroma cleanup
        </label>
      </div>

      {error && <div role="alert" className="text-xs" style={{ color: '#f87171' }}>{error}</div>}

      {/* Apply button */}
      <button
        type="button"
        disabled={busy || selectedScaleInfeasible}
        style={{
          width: '100%', padding: 11, borderRadius: 11,
          border: '1px solid var(--accent-ring)',
          background: 'var(--accent)', color: '#0b0b0c', fontSize: 12.5, fontWeight: 700,
          cursor: busy ? 'wait' : selectedScaleInfeasible ? 'not-allowed' : 'pointer',
          opacity: busy || selectedScaleInfeasible ? 0.6 : 1,
          boxShadow: busy || selectedScaleInfeasible ? 'none' : '0 2px 18px var(--accent-ring)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
        onClick={handleApply}
      >
        {busy && (
          <span
            className="animate-spin"
            style={{
              width: 14, height: 14, borderRadius: '50%',
              border: '2px solid rgba(11,11,12,0.35)', borderTopColor: '#0b0b0c',
              flexShrink: 0,
            }}
          />
        )}
        {busy
          ? (upscaleProgress != null ? `Enhancing… ${Math.round(upscaleProgress * 100)}%` : 'Enhancing…')
          : currentParams.upscale ? `Apply Enhance (×${currentParams.scale})` : 'Apply Enhance'}
      </button>

      {/* Revert button */}
      {revertVersion >= 0 && enhanceService.canRevert() && (
        <button
          type="button"
          style={{
            width: '100%', padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,.1)',
            background: 'transparent', color: 'var(--glass-text-secondary)', fontSize: 11.5, cursor: 'pointer',
          }}
          onClick={() => { enhanceService.revert(); setRevertVersion((v) => v + 1); }}
        >
          Revert Enhance
        </button>
      )}

      {/* In-session upscale note */}
      {params.upscale && (
        <div style={{
          fontSize: 10.5, color: 'var(--glass-text-secondary)', background: 'rgba(255,255,255,.03)',
          border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, padding: '8px 10px',
          display: 'flex', gap: 7,
        }}>
          <span style={{ color: 'var(--accent)', flexShrink: 0 }}>ⓘ</span>
          <span>Upscale applies in this session; reopening the image returns the original.</span>
        </div>
      )}
    </div>
  );
}
