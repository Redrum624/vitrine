// src/components/Modules/EnhanceModuleComponent.tsx
import { useCallback, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { EnhanceModule } from '../../modules/EnhanceModule';
import { NoiseReductionModule, NoiseReductionParams } from '../../modules/NoiseReductionModule';
import { EnhanceParams, DEFAULT_ENHANCE_PARAMS } from '../../utils/enhanceChain';
import { enhanceService } from '../../services/EnhanceService';

interface Props {
  module: EnhanceModule;
  noiseReductionModule: NoiseReductionModule;
  onParamsChange?: (p: Partial<EnhanceParams>) => void;
  onNoiseReductionChange?: (p: Partial<NoiseReductionParams>) => void;
}

export default function EnhanceModuleComponent({ module, noiseReductionModule, onParamsChange, onNoiseReductionChange }: Props) {
  const [params, setParams] = useState<EnhanceParams>(() => module.getParams());
  const paramsRef = useRef(params); paramsRef.current = params;
  const [nrEnabled, setNrEnabled] = useState<boolean>(() => noiseReductionModule.getParams().enabled);
  const [nrStrength, setNrStrength] = useState<number>(() => noiseReductionModule.getParams().strength);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revertVersion, setRevertVersion] = useState(0);
  const [sectionOpen, setSectionOpen] = useState(false);

  const update = useCallback((patch: Partial<EnhanceParams>) => {
    setParams((prev) => ({ ...prev, ...patch }));
    module.setParams(patch);
  }, [module]);

  const resetSection = useCallback(() => {
    setNrStrength(50);
    update({
      sharpness: DEFAULT_ENHANCE_PARAMS.sharpness,
      alpha: DEFAULT_ENHANCE_PARAMS.alpha,
      psfSigma: DEFAULT_ENHANCE_PARAMS.psfSigma,
      rlIters: DEFAULT_ENHANCE_PARAMS.rlIters,
      chromaClean: DEFAULT_ENHANCE_PARAMS.chromaClean,
    });
  }, [update]);

  const handleApply = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      if (nrEnabled) {
        onNoiseReductionChange?.({ enabled: true, strength: nrStrength, method: 'auto' });
      } else {
        onNoiseReductionChange?.({ enabled: false });
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

  return (
    <div className="enhance-panel px-5 pt-4 space-y-4">

      {/* Three mode toggles */}
      <div style={{ display: 'flex', gap: 8 }}>
        {/* Noise Reduction toggle */}
        <button
          type="button"
          aria-pressed={nrEnabled}
          onClick={() => setNrEnabled((v) => !v)}
          style={{
            flex: 1,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            padding: '10px 6px',
            borderRadius: 9, border: `1px solid ${nrEnabled ? 'var(--primary-500)' : 'var(--border)'}`,
            background: nrEnabled ? '#11254a' : 'var(--gray-800)',
            color: nrEnabled ? '#dbe7ff' : 'var(--gray-300)',
            fontSize: '0.74rem', fontWeight: 500, cursor: 'pointer',
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: nrEnabled ? 'var(--primary-500)' : 'var(--gray-600)',
            boxShadow: nrEnabled ? '0 0 0 3px rgba(59,130,246,.25)' : undefined,
          }} />
          <span>Noise<br />Reduction</span>
        </button>

        {/* Sharpen toggle */}
        <button
          type="button"
          aria-pressed={params.sharpen}
          onClick={() => update({ sharpen: !params.sharpen })}
          style={{
            flex: 1,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            padding: '10px 6px',
            borderRadius: 9, border: `1px solid ${params.sharpen ? 'var(--primary-500)' : 'var(--border)'}`,
            background: params.sharpen ? '#11254a' : 'var(--gray-800)',
            color: params.sharpen ? '#dbe7ff' : 'var(--gray-300)',
            fontSize: '0.74rem', fontWeight: 500, cursor: 'pointer',
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: params.sharpen ? 'var(--primary-500)' : 'var(--gray-600)',
            boxShadow: params.sharpen ? '0 0 0 3px rgba(59,130,246,.25)' : undefined,
          }} />
          <span>Sharpen</span>
        </button>

        {/* Upscale toggle */}
        <button
          type="button"
          aria-pressed={params.upscale}
          onClick={() => update({ upscale: !params.upscale })}
          style={{
            flex: 1,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            padding: '10px 6px',
            borderRadius: 9, border: `1px solid ${params.upscale ? 'var(--primary-500)' : 'var(--border)'}`,
            background: params.upscale ? '#11254a' : 'var(--gray-800)',
            color: params.upscale ? '#dbe7ff' : 'var(--gray-300)',
            fontSize: '0.74rem', fontWeight: 500, cursor: 'pointer',
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: params.upscale ? 'var(--primary-500)' : 'var(--gray-600)',
            boxShadow: params.upscale ? '0 0 0 3px rgba(59,130,246,.25)' : undefined,
          }} />
          <span>Upscale</span>
        </button>
      </div>

      {/* Scale selector (only when Upscale on) */}
      {params.upscale && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '.72rem', fontWeight: 500, color: 'var(--gray-300)', marginRight: 'auto' }}>Scale</span>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {([2, 4] as const).map((s) => (
              <button key={s} type="button"
                style={{
                  padding: '5px 14px',
                  background: params.scale === s ? 'var(--primary-600)' : 'var(--gray-800)',
                  color: params.scale === s ? '#fff' : 'var(--gray-300)',
                  border: 0,
                  fontSize: '.78rem', cursor: 'pointer', fontFamily: 'ui-monospace,monospace',
                }}
                onClick={() => update({ scale: s })}>{s}×</button>
            ))}
          </div>
        </div>
      )}

      {/* Detail & quality accordion */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div
          style={{
            padding: '9px 12px', background: 'var(--gray-800)',
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          }}
          onClick={() => setSectionOpen((v) => !v)}
        >
          {sectionOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-xs font-medium" style={{ flex: 1 }}>Detail &amp; quality</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); resetSection(); }}
            style={{
              fontSize: '.7rem', color: 'var(--gray-400)', background: 'transparent',
              border: 0, cursor: 'pointer', padding: '0 2px',
            }}
          >Reset</button>
        </div>
        {sectionOpen && (
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 13 }}>
            {/* NR strength */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{ color: '#9ec1ff' }}>Noise reduction strength</label>
                <span className="text-xs font-mono" style={{ color: 'var(--gray-400)' }}>{nrStrength}</span>
              </div>
              <input
                type="range" min={0} max={100} step={1} value={nrStrength}
                onChange={(e) => setNrStrength(parseFloat(e.target.value))}
                className="slider w-full"
              />
            </div>

            <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />

            {/* Sharpen strength */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{ color: 'var(--gray-300)' }}>Sharpen strength</label>
                <span className="text-xs font-mono" style={{ color: 'var(--gray-400)' }}>{params.sharpness.toFixed(2)}</span>
              </div>
              <input
                type="range" min={0} max={1} step={0.05} value={params.sharpness}
                onChange={(e) => update({ sharpness: parseFloat(e.target.value) })}
                className="slider w-full"
              />
            </div>

            {/* Detail amount */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{ color: 'var(--gray-300)' }}>Detail amount</label>
                <span className="text-xs font-mono" style={{ color: 'var(--gray-400)' }}>{params.alpha.toFixed(2)}</span>
              </div>
              <input
                type="range" min={0} max={1} step={0.05} value={params.alpha}
                onChange={(e) => update({ alpha: parseFloat(e.target.value) })}
                className="slider w-full"
              />
            </div>

            {/* Deblur radius */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{ color: 'var(--gray-300)' }}>Deblur radius</label>
                <span className="text-xs font-mono" style={{ color: 'var(--gray-400)' }}>{params.psfSigma.toFixed(1)} px</span>
              </div>
              <input
                type="range" min={0.5} max={3} step={0.1} value={params.psfSigma}
                onChange={(e) => update({ psfSigma: parseFloat(e.target.value) })}
                className="slider w-full"
              />
            </div>

            {/* Deblur iterations */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{ color: 'var(--gray-300)' }}>Deblur iterations</label>
                <span className="text-xs font-mono" style={{ color: 'var(--gray-400)' }}>{params.rlIters}</span>
              </div>
              <input
                type="range" min={0} max={30} step={1} value={params.rlIters}
                onChange={(e) => update({ rlIters: parseFloat(e.target.value) })}
                className="slider w-full"
              />
            </div>

            {/* Chroma cleanup */}
            <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--gray-300)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={params.chromaClean}
                onChange={(e) => update({ chromaClean: e.target.checked })}
              />
              Chroma cleanup
            </label>
          </div>
        )}
      </div>

      {error && <div role="alert" className="text-red-400 text-xs">{error}</div>}

      {/* Apply button */}
      <button
        type="button"
        disabled={busy}
        style={{
          width: '100%', padding: 11, borderRadius: 9, border: '1px solid var(--primary-500)',
          background: 'var(--primary-600)', color: '#fff', fontSize: '.84rem', fontWeight: 600,
          cursor: 'pointer', opacity: busy ? 0.6 : 1,
        }}
        onClick={handleApply}
      >
        {busy ? 'Enhancing…' : currentParams.upscale ? `Apply Enhance (×${currentParams.scale})` : 'Apply Enhance'}
      </button>

      {/* Revert button */}
      {revertVersion >= 0 && enhanceService.canRevert() && (
        <button
          type="button"
          style={{
            width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--gray-300)', fontSize: '.78rem', cursor: 'pointer',
          }}
          onClick={() => { enhanceService.revert(); setRevertVersion((v) => v + 1); }}
        >
          Revert Enhance
        </button>
      )}

      {/* In-session upscale note */}
      {params.upscale && (
        <div style={{
          fontSize: '.7rem', color: 'var(--gray-400)', background: 'var(--gray-900)',
          border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px',
          display: 'flex', gap: 7,
        }}>
          <span style={{ color: '#9ec1ff', flexShrink: 0 }}>ⓘ</span>
          <span>Upscale applies in this session; reopening the image returns the original.</span>
        </div>
      )}
    </div>
  );
}
