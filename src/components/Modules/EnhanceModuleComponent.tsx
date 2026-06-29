// src/components/Modules/EnhanceModuleComponent.tsx
import { useCallback, useRef, useState } from 'react';
import { EnhanceModule } from '../../modules/EnhanceModule';
import { EnhanceParams } from '../../utils/enhanceChain';
import { enhanceService } from '../../services/EnhanceService';

interface Props { module: EnhanceModule; onParamsChange?: (p: Partial<EnhanceParams>) => void }

const ADVANCED: { key: keyof EnhanceParams; label: string; min: number; max: number; step: number }[] = [
  { key: 'denoiseStrength', label: 'Denoise', min: 0, max: 10, step: 0.5 },
  { key: 'psfSigma', label: 'Deblur radius', min: 0.5, max: 3, step: 0.1 },
  { key: 'rlIters', label: 'Deblur iterations', min: 0, max: 30, step: 1 },
  { key: 'alpha', label: 'Detail amount', min: 0, max: 1, step: 0.05 },
  { key: 'hpSigma', label: 'Detail radius', min: 0.5, max: 3, step: 0.1 },
  { key: 'sharpness', label: 'Sharpen strength', min: 0, max: 1, step: 0.05 },
];

export default function EnhanceModuleComponent({ module, onParamsChange }: Props) {
  const [params, setParams] = useState<EnhanceParams>(() => module.getParams());
  const paramsRef = useRef(params); paramsRef.current = params;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback((patch: Partial<EnhanceParams>) => {
    setParams((prev) => ({ ...prev, ...patch }));
    module.setParams(patch); // local only; no reprocess
  }, [module]);

  const applySharpen = useCallback(() => {
    const patch: Partial<EnhanceParams> = { enabled: true, sharpen: true, upscale: false };
    module.setParams(patch); setParams((p) => ({ ...p, ...patch }));
    onParamsChange?.(patch); // triggers the pipeline reprocess (mirrors Noise Reduction)
  }, [module, onParamsChange]);

  const applyUpscale = useCallback(async () => {
    setBusy(true); setError(null);
    try { await enhanceService.applyUpscale({ ...paramsRef.current, upscale: true }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);

  return (
    <div className="enhance-panel px-5 pt-4 space-y-4">
      <div className="flex gap-2">
        <button type="button" aria-pressed={params.sharpen} onClick={() => update({ sharpen: !params.sharpen })}>Sharpen</button>
        <button type="button" aria-pressed={params.upscale} onClick={() => update({ upscale: !params.upscale })}>Upscale</button>
      </div>
      {params.upscale && (
        <div className="flex gap-2">
          {[2, 4].map((s) => (
            <button key={s} type="button" aria-pressed={params.scale === s} onClick={() => update({ scale: s as 2 | 4 })}>{s}×</button>
          ))}
        </div>
      )}
      <details>
        <summary>Advanced</summary>
        {ADVANCED.map((s) => (
          <label key={String(s.key)} className="block text-xs">
            <span>{s.label}: {String(params[s.key])}</span>
            <input type="range" min={s.min} max={s.max} step={s.step} value={params[s.key] as number}
              onChange={(e) => update({ [s.key]: parseFloat(e.target.value) } as unknown as Partial<EnhanceParams>)} />
          </label>
        ))}
        <label className="block text-xs">
          <input type="checkbox" checked={params.chromaClean} onChange={(e) => update({ chromaClean: e.target.checked })} /> Chroma cleanup
        </label>
      </details>
      {error && <div role="alert" className="text-red-400 text-xs">{error}</div>}
      {params.upscale
        ? <button type="button" disabled={busy} onClick={applyUpscale}>{busy ? 'Enhancing…' : `Apply Enhance (×${params.scale})`}</button>
        : <button type="button" disabled={busy} onClick={applySharpen}>Apply Enhance</button>}
      {enhanceService.canRevert() && <button type="button" onClick={() => enhanceService.revert()}>Revert Enhance</button>}
    </div>
  );
}
