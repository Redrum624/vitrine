// src/components/Modules/EnhanceModuleComponent.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { EnhanceModule } from '../../modules/EnhanceModule';
import { NoiseReductionModule, NoiseReductionParams } from '../../modules/NoiseReductionModule';
import { EnhanceParams, DEFAULT_ENHANCE_PARAMS } from '../../utils/enhanceChain';
import { loadEnhancePrefs, saveEnhancePrefs } from '../../utils/enhancePrefsStorage';
import { enhanceService, getUpscaleFeasibility, UpscaleFeasibility } from '../../services/EnhanceService';
import { aiDeblurClient } from '../../services/AiDeblurClient';
import { imageService } from '../../services/ImageService';
import { editPersistenceService } from '../../services/EditPersistenceService';
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
  const nrRef = useRef({ enabled: nrEnabled, strength: nrStrength });
  nrRef.current = { enabled: nrEnabled, strength: nrStrength };
  // Preference memory (v1.32.0): seed the panel from saved prefs ONLY when the
  // module is still at factory defaults (a photo's own restored per-image state
  // always wins), then persist every change. hydratedRef gates saving so the
  // mount itself never writes factory values over the stored prefs.
  const hydratedRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const upscaleProgress = useAppStore((s) => s.upscaleProgress);
  const upscaleMode = useAppStore((s) => s.upscaleMode);
  const deblurProgress = useAppStore((s) => s.deblurProgress);
  // AI motion deblur is DirectML-only with no deterministic fallback, so the control is HIDDEN (not
  // disabled) when the backend is unavailable (spike policy). Probe once on mount; null = unknown.
  const [deblurAvailable, setDeblurAvailable] = useState<boolean | null>(null);
  // Durable upscale intent (Q7): set when a reopened image carries a persisted-but-not-reapplied
  // upscale (or a live bake). Drives the one-click re-apply notice below. `developing` gates the
  // button during the progressive-open window (applyUpscale itself is gated too — belt & braces).
  const upscaleIntent = useAppStore((s) => s.upscaleIntent);
  // Durable deblur intent + stacked bake order (Z1) — drive the same reopen re-apply notice.
  const deblurIntent = useAppStore((s) => s.deblurIntent);
  const bakeOrder = useAppStore((s) => s.bakeOrder);
  const developing = useAppStore((s) => s.developing);
  // Re-render on bulk upstream param changes (Auto All / Paste Style / presets bump this) so the
  // staleness hint re-evaluates while the panel stays mounted. Normal per-module slider edits
  // happen while THIS panel is unmounted (single module panel visible at a time), so navigating
  // back re-mounts and re-reads isEnhanceStale() — no live signal needed for that path.
  const externalParamsVersion = useAppStore((s) => s.externalParamsVersion);
  const [error, setError] = useState<string | null>(null);
  const [revertVersion, setRevertVersion] = useState(0);

  // C4 finding 3 — the panel's ONE commit model: STAGED until Apply arms the module
  // (enabled=false → edits only stage panel/module state, nothing renders or reprocesses),
  // LIVE write-through once armed (enabled=true → every edit commits + fires the parent's
  // debounced reprocess, exactly how every other module panel commits). Before this, a
  // post-Apply slider tweak (or toggling Sharpen OFF) wrote the module but never rendered —
  // exports picked up never-previewed values. Firing on the was-enabled edge too means a
  // patch that DISABLES the module (header Reset) still reprocesses the removal.
  const update = useCallback((patch: Partial<EnhanceParams>) => {
    setParams((prev) => ({ ...prev, ...patch }));
    const wasEnabled = module.getParams().enabled;
    module.setParams(patch);
    if (wasEnabled || module.getParams().enabled) onParamsChange?.(patch);
  }, [module, onParamsChange]);

  const PREF_KEYS = ['sharpen', 'upscale', 'scale', 'denoiseStrength', 'psfSigma', 'rlIters', 'alpha', 'hpSigma', 'sharpness', 'chromaClean'] as const;

  // Seed from saved prefs once per mount (the panel remounts per photo/module
  // switch), only when the module still sits at factory defaults.
  useEffect(() => {
    let cancelled = false;
    void loadEnhancePrefs().then((prefs) => {
      if (cancelled) return;
      if (prefs) {
        const { nrEnabled: prefNrEnabled, nrStrength: prefNrStrength, ...enhance } = prefs;
        const cur = module.getParams();
        // C4 finding 1: per-image state ALWAYS wins — a LIVE (enabled) module is never
        // reseeded, even when its sliders happen to sit at factory defaults. Without the
        // enabled gate, any remount (undo, Auto All, reopen) silently grafted pref sliders
        // into the applied module with no reprocess.
        const atDefaults = cur.enabled === false && PREF_KEYS.every((k) => cur[k] === DEFAULT_ENHANCE_PARAMS[k]);
        if (atDefaults) {
          // C4 finding 5: never re-arm the Upscale toggle over a live baked upscale — the
          // post-bake remount reseeds an at-defaults module, and an armed toggle invites an
          // accidental stacked second bake.
          if (enhance.upscale && imageService.isBakedUpscaleActive()) delete enhance.upscale;
          if (Object.keys(enhance).length) update(enhance);
        }
        // C4 finding 2: NR seeding gates on the NR MODULE's OWN factory defaults — the
        // enhance-module gate said nothing about saved NR-only edits, so prefs overwrote
        // their display (and Apply then committed pref NR over the saved NR).
        const nr = noiseReductionModule.getParams();
        if (nr.enabled === false && nr.strength === 50) {
          if (typeof prefNrEnabled === 'boolean') setNrEnabled(prefNrEnabled);
          if (typeof prefNrStrength === 'number') setNrStrength(prefNrStrength);
        }
      }
      hydratedRef.current = true;
    });
    return () => { cancelled = true; };
  }, []);

  // Persist the durable preference snapshot on every change (debounced in the
  // storage util; gated until hydration so the mount never clobbers the store).
  useEffect(() => {
    if (!hydratedRef.current) return;
    const p = paramsRef.current;
    saveEnhancePrefs({
      sharpen: p.sharpen, upscale: p.upscale, scale: p.scale,
      denoiseStrength: p.denoiseStrength, psfSigma: p.psfSigma, rlIters: p.rlIters,
      alpha: p.alpha, hpSigma: p.hpSigma, sharpness: p.sharpness, chromaClean: p.chromaClean,
      nrEnabled: nrRef.current.enabled, nrStrength: nrRef.current.strength,
    });
  }, [params, nrEnabled, nrStrength]);

  // C4 finding 3 (NR side of the ONE commit model): NR controls stage while the NR module
  // is disabled (Apply commits them), but once the module is LIVE (a prior Apply enabled it)
  // every toggle/strength edit commits + fires the parent's debounced reprocess — same
  // staged-until-armed / live-after rule as the enhance params in update().
  const handleNrToggle = useCallback(() => {
    const next = !nrRef.current.enabled;
    setNrEnabled(next);
    if (noiseReductionModule.getParams().enabled) {
      const patch = next
        ? { enabled: true, strength: nrRef.current.strength, method: 'auto' as const }
        : { enabled: false };
      noiseReductionModule.setParams(patch);
      onNoiseReductionChange?.(patch);
    }
  }, [noiseReductionModule, onNoiseReductionChange]);

  const handleNrStrength = useCallback((v: number) => {
    setNrStrength(v);
    if (noiseReductionModule.getParams().enabled) {
      const patch = { enabled: true, strength: v, method: 'auto' as const };
      noiseReductionModule.setParams(patch);
      onNoiseReductionChange?.(patch);
    }
  }, [noiseReductionModule, onNoiseReductionChange]);

  // C4 finding 8: Reset neutralizes EVERYTHING the panel shows as active — the three mode
  // toggles and staged NR strength included, not just the detail sliders. A LIVE enhance
  // module gets its disable committed + reprocessed through update()'s live path; a LIVE NR
  // module gets an explicit disable commit, firing its own trigger only when no enhance
  // reprocess already covers it (the full-pipeline pass runs NR before enhance).
  const resetSection = useCallback(() => {
    setNrEnabled(false);
    setNrStrength(50);
    const enhanceWasEnabled = module.getParams().enabled;
    update({
      enabled: false,
      sharpen: DEFAULT_ENHANCE_PARAMS.sharpen,
      upscale: DEFAULT_ENHANCE_PARAMS.upscale,
      scale: DEFAULT_ENHANCE_PARAMS.scale,
      sharpness: DEFAULT_ENHANCE_PARAMS.sharpness,
      alpha: DEFAULT_ENHANCE_PARAMS.alpha,
      hpSigma: DEFAULT_ENHANCE_PARAMS.hpSigma,
      psfSigma: DEFAULT_ENHANCE_PARAMS.psfSigma,
      rlIters: DEFAULT_ENHANCE_PARAMS.rlIters,
      denoiseStrength: DEFAULT_ENHANCE_PARAMS.denoiseStrength,
      chromaClean: DEFAULT_ENHANCE_PARAMS.chromaClean,
    });
    if (noiseReductionModule.getParams().enabled) {
      const nrOff = { enabled: false };
      noiseReductionModule.setParams(nrOff);
      if (!enhanceWasEnabled) onNoiseReductionChange?.(nrOff);
    }
  }, [update, module, noiseReductionModule, onNoiseReductionChange]);

  // Card header (Task 2): Reset ↺ = reset the panel's full active scope (Enhance has
  // no auto function). Reuses the existing resetSection handler unchanged.
  useRegisterModuleCardActions(onRegisterActions, { reset: resetSection });

  // C4 finding 4 — "did the bake actually commit?" signal: applyUpscale/applyMotionDeblur
  // return early on guardDeveloping/inFlight refusals and mid-bake photo-switch aborts (W2's
  // identity-abort paths, which toast their own notices), all WITHOUT pushing a restore
  // point. A grown restore depth is therefore the observable commit marker — marking applied
  // on a refused bake manufactured a false "Re-apply to update" staleness for a bake that
  // never ran. Optional-chained so unit mocks without getRestoreDepth degrade to the legacy
  // always-committed behavior (null before-depth → treated as committed).
  const readBakeDepth = useCallback((): number | null => enhanceService.getRestoreDepth?.() ?? null, []);
  const bakeCommitted = useCallback((depthBefore: number | null): boolean =>
    depthBefore === null || (readBakeDepth() ?? depthBefore) > depthBefore, [readBakeDepth]);

  const handleApply = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const isUpscale = paramsRef.current.upscale;
      const nrParams = nrEnabled
        ? { enabled: true, strength: nrStrength, method: 'auto' as const }
        : { enabled: false };
      // Always commit NR params to the module so the pipeline (and applyUpscale's own bake pass)
      // picks them up. The parent's onNoiseReductionChange ALSO fires a debounced FULL-pipeline
      // pass — but that pass is REDUNDANT whenever another pass already reprocesses the whole
      // pipeline, which runs noise-reduction (module 7) BEFORE enhance (module 8):
      //   • UPSCALE path: applyUpscale bakes NR into the new base + owns exactly one post-bake
      //     reprocess; the parent's pass would waste a full pass on the pre-upscale preview the
      //     bake immediately discards (round-6 P7 item 4 — NR + Upscale double-reprocess).
      //   • SHARPEN path: onParamsChange('enhance') below fires a debounced full-pipeline pass that
      //     ALREADY includes noise-reduction with these committed params — the separate NR pass is
      //     an identical duplicate (round-7 Q4; both call processCurrentImageRealTime on the same
      //     committed module state). The NR module cache is param+dims-keyed and self-invalidates,
      //     so dropping the NR trigger's own cache-invalidation is safe.
      // Only the NR-ONLY path (neither sharpen nor upscale) has no other reprocess, so THERE the
      // NR trigger is load-bearing and must fire.
      noiseReductionModule.setParams(nrParams);
      if (!isUpscale && !paramsRef.current.sharpen) onNoiseReductionChange?.(nrParams);

      // Snapshot the upstream param state this Apply result reflects (markEnhanceApplied), so a
      // later upstream edit surfaces the "Re-apply to update" staleness hint. Only after a REAL
      // apply: the sharpen path always commits, but the upscale path marks ONLY when the bake
      // actually committed (C4 finding 4) — guard-refused/aborted bakes leave the baseline (and
      // revertVersion) untouched. A no-op click (neither toggle on) touches nothing.
      if (isUpscale) {
        const depthBefore = readBakeDepth();
        await enhanceService.applyUpscale({ ...paramsRef.current, upscale: true });
        if (bakeCommitted(depthBefore)) {
          setRevertVersion((v) => v + 1);
          enhanceService.markEnhanceApplied();
        }
      } else if (paramsRef.current.sharpen) {
        const patch = { enabled: true, sharpen: true, upscale: false };
        module.setParams(patch); setParams((p) => ({ ...p, ...patch }));
        onParamsChange?.(patch);
        enhanceService.markEnhanceApplied();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [nrEnabled, nrStrength, module, onParamsChange, onNoiseReductionChange, readBakeDepth, bakeCommitted]);

  // Re-apply a persisted bake intent on a reopened image (Q7 upscale + Z1 deblur/stacked): replays
  // the saved bake sequence (upscale with the saved scale, and/or AI motion deblur) in order on top
  // of the restored native-dims params, re-deriving the SAME baked base the user had last session,
  // then replays any post-bake edits (editsOnBakedBase) on top. One-click and explicit — never
  // auto-run on open (a multi-second unrequested bake would be hostile). applyUpscale auto-routes
  // AI/Standard by availability, so the saved mode is a preference the environment may not honor.
  const handleReapply = useCallback(async () => {
    if (!upscaleIntent && !deblurIntent) return;
    setBusy(true); setError(null);
    // Hoisted so the catch can re-attach the read edits after a mid-replay failure (review LOW fix).
    let postBakeEditsRead: NonNullable<Awaited<ReturnType<typeof editPersistenceService.getSavedEditState>>>['editsOnBakedBase'] | null = null;
    try {
      // Read the saved post-bake edits BEFORE the bakes run — each bake's persist write overwrites
      // the disk state without editsOnBakedBase, so reading afterwards would miss them.
      const img = imageService.getCurrentImage();
      const saved = img?.filePath ? await editPersistenceService.getSavedEditState(img.filePath) : null;
      const postBakeEdits = saved?.editsOnBakedBase ?? null;
      postBakeEditsRead = postBakeEdits;
      // C4 finding 6: the replay must re-derive the SAME baked result the user had — so it
      // feeds the PERSISTED pre-bake editState's enhance params (what the original bake ran
      // with), not the live panel params, which the prefs seeding may have drifted since
      // (the detail sliders shape the AI finishing pass and the deterministic chain alike).
      // Live params remain only the fallback for pre-Q7 saves that carry no enhance entry.
      const savedEnhance = (saved?.modules?.['enhance'] ?? null) as Partial<EnhanceParams> | null;
      // Derive the replay order: an explicit stacked bakeOrder, else the single active intent.
      const order = bakeOrder.length
        ? bakeOrder
        : upscaleIntent
          ? (['upscale'] as const)
          : (['deblur'] as const);
      // C4 finding 4 (same honesty as handleApply): count what we ATTEMPT vs what COMMITTED
      // (restore-depth growth) — a guard-refused replay must not mark applied, and the saved
      // post-bake edits must never be grafted onto a base the bakes never produced.
      const depthBefore = readBakeDepth();
      let attempted = 0;
      for (const kind of order) {
        if (kind === 'upscale' && upscaleIntent) {
          attempted++;
          await enhanceService.applyUpscale({ ...module.getParams(), ...(savedEnhance ?? {}), upscale: true, scale: upscaleIntent.scale });
        } else if (kind === 'deblur') {
          attempted++;
          await enhanceService.applyMotionDeblur();
        }
      }
      const depthAfter = readBakeDepth();
      const bakesRun = depthBefore === null || depthAfter === null ? attempted : depthAfter - depthBefore;
      if (postBakeEdits) {
        const baked = imageService.getCurrentImage();
        if (baked && bakesRun >= attempted) {
          editPersistenceService.applyPostBakeEdits(postBakeEdits, baked.width, baked.height);
          useAppStore.getState().notifyExternalParamsChange();
          useAppStore.getState().triggerReprocessing();
          // Deterministically re-attach the replayed edits to disk. NOT a plain flush(): the redirect
          // is suspended when the replay stacked >1 bake, and flush would then silently drop them.
          editPersistenceService.persistPostBakeEdits(postBakeEdits);
        } else {
          // Replay incomplete (a bake was refused) — re-attach the already-read edits so a retry /
          // the next reopen can still replay them (mirrors the catch path below).
          editPersistenceService.persistPostBakeEdits(postBakeEdits);
        }
      }
      if (bakesRun > 0) {
        setRevertVersion((v) => v + 1);
        enhanceService.markEnhanceApplied();
      }
    } catch (e) {
      // Mid-replay failure (review LOW fix): an earlier bake's persist write already consumed
      // editsOnBakedBase from disk before a later bake threw. Re-attach the already-read edits so a
      // retry / the next reopen can still replay them (no-ops if no bake persisted — disk untouched).
      if (postBakeEditsRead) editPersistenceService.persistPostBakeEdits(postBakeEditsRead);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [upscaleIntent, deblurIntent, bakeOrder, module, readBakeDepth]);

  // Probe AI-deblur availability once (capability doesn't change at runtime; the client caches it).
  useEffect(() => {
    let alive = true;
    aiDeblurClient.isAvailable().then((v) => { if (alive) setDeblurAvailable(v); });
    return () => { alive = false; };
  }, []);

  // Apply an AI motion deblur (opt-in, one-shot bake). Mirrors handleReapply's busy/error seam.
  const handleMotionDeblur = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      // C4 finding 4: mark applied only when the bake actually committed (restore depth grew) —
      // guardDeveloping/inFlight refusals return early without pushing a restore point.
      const depthBefore = readBakeDepth();
      await enhanceService.applyMotionDeblur();
      if (bakeCommitted(depthBefore)) {
        setRevertVersion((v) => v + 1);
        enhanceService.markEnhanceApplied();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [readBakeDepth, bakeCommitted]);

  // Show the reopen notice when a durable intent exists (upscale and/or deblur) but the working base
  // is NOT currently baked (reopened, not yet re-applied). Once re-applied, the base carries a bake
  // marker → hide. Optional-chain isBakedDeblurActive so mocks that omit it degrade gracefully.
  const showReopenNotice =
    (!!upscaleIntent || deblurIntent) &&
    !imageService.isBakedUpscaleActive() &&
    !imageService.isBakedDeblurActive?.();
  // Compose the notice label from whichever intents are pending (e.g. "Upscale ×2 (AI) + AI motion
  // deblur"), so a single button restores the full stacked sequence.
  const reapplyLabelParts: string[] = [];
  if (upscaleIntent) reapplyLabelParts.push(`Upscale ×${upscaleIntent.scale} (${upscaleIntent.mode === 'ai' ? 'AI' : 'Standard'})`);
  if (deblurIntent) reapplyLabelParts.push('AI motion deblur');
  const reapplyLabel = reapplyLabelParts.join(' + ');

  const currentParams = paramsRef.current;

  // Staleness affordance: an Apply Enhance result goes stale once an upstream (non-enhance)
  // pipeline param changes. `externalParamsVersion` is read only to re-subscribe on bulk changes
  // (its value is always ≥ 0, so it never gates the flag); the truth comes from the service
  // snapshot vs the live pipeline params. Hidden while busy (a re-apply is already in flight).
  const enhanceStale = externalParamsVersion >= 0 && !busy && enhanceService.isEnhanceStale();

  // Per-scale output-size feasibility for the CURRENT image (crop-adjusted dims, mirroring
  // EnhanceService.applyUpscale). Unknown dims (no image) ⇒ leave every scale enabled; the
  // service guard still protects the actual apply.
  const feasibility: Partial<Record<2 | 4, UpscaleFeasibility>> = (() => {
    // Dims-only accessor: getOriginalImage() would materialize the deferred 310MB
    // snapshot synchronously inside this render (L4 review finding).
    const original = imageService.getOriginalImageDimensions();
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

  // AI motion deblur is offered only when the DirectML backend is present AND the (crop-adjusted)
  // image is >= 384px on both axes (the hard model floor — smaller inputs corrupt on DML). Unknown
  // dims (no image) ⇒ treat as too small so the control stays hidden until an image is loaded.
  const deblurMinOk = (() => {
    const original = imageService.getOriginalImageDimensions();
    if (!original) return false;
    const cropMod = imageProcessingPipeline.getModule?.('crop') as
      | { getOutputDimensions(w: number, h: number): { width: number; height: number } }
      | undefined;
    const dims = cropMod
      ? cropMod.getOutputDimensions(original.width, original.height)
      : { width: original.width, height: original.height };
    return dims.width >= 384 && dims.height >= 384;
  })();
  const showMotionDeblur = deblurAvailable === true && deblurMinOk;

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

      {/* Reopen surfacing (Q7 upscale + Z1 deblur/stacked): a durable bake intent was restored but
          not re-applied. Passive notice + one-click re-apply (gated while developing, like Apply). No
          auto-bake on open. Editing WITHOUT re-applying first invalidates any saved post-bake edits
          (the two timelines must not merge) — surfaced in the button tooltip. */}
      {showReopenNotice && (
        <div
          data-testid="upscale-reapply-notice"
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 9,
            border: '1px solid var(--accent-ring)', background: 'var(--accent-soft)',
            fontSize: 11, color: 'var(--glass-text-label)', lineHeight: 1.45,
          }}
        >
          <span style={{ flex: 1 }}>
            {reapplyLabel} was applied — re-apply to restore.
          </span>
          <button
            type="button"
            data-testid="upscale-reapply-btn"
            disabled={busy || developing}
            title={developing
              ? 'Available when full quality finishes developing'
              : 'Re-derives the baked pixels and restores your post-bake edits. Editing before re-applying discards those saved post-bake edits. A second enhance stacked on top of another is session-only and is not restored here.'}
            onClick={handleReapply}
            style={{
              flexShrink: 0, padding: '6px 12px', borderRadius: 8,
              border: '1px solid var(--accent-ring)', background: 'var(--accent)', color: '#0b0b0c',
              fontSize: 11, fontWeight: 700,
              cursor: busy || developing ? 'not-allowed' : 'pointer',
              opacity: busy || developing ? 0.6 : 1,
            }}
          >
            {busy ? 'Re-applying…' : 'Re-apply'}
          </button>
        </div>
      )}

      {/* Three mode toggles */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" aria-pressed={nrEnabled} onClick={handleNrToggle} style={modeTileStyle(nrEnabled)}>
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
          onChange={handleNrStrength}
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
          label="Detail radius"
          value={params.hpSigma}
          defaultValue={DEFAULT_ENHANCE_PARAMS.hpSigma}
          min={0.5}
          max={3}
          step={0.1}
          formatValue={(v) => `${v.toFixed(1)} px`}
          onChange={(v) => update({ hpSigma: v })}
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

        {/* AI motion deblur (opt-in, GPU-only). HIDDEN when no DirectML backend or the image is
            below the 384px model floor — never auto-routed, and never a replacement for the RL
            Deblur sliders above (those target defocus; this targets camera-shake / motion blur). */}
        {showMotionDeblur && (
          <div
            data-testid="motion-deblur-control"
            style={{
              display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 11px', borderRadius: 9,
              border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.03)',
            }}
          >
            <div className="flex items-center" style={{ gap: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--glass-text-label)' }}>Motion deblur</span>
              <span
                data-testid="motion-deblur-ai-badge"
                title="Runs a neural network on your GPU (DirectML). Aim it at camera-shake / motion blur, not soft focus."
                style={{
                  fontSize: 9.5, fontWeight: 700, letterSpacing: '.04em', padding: '2px 7px',
                  borderRadius: 999, textTransform: 'uppercase',
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  border: '1px solid var(--accent-ring)',
                }}
              >
                AI
              </span>
              <button
                type="button"
                data-testid="motion-deblur-apply"
                disabled={busy || developing}
                title={developing ? 'Available when full quality finishes developing' : undefined}
                onClick={handleMotionDeblur}
                style={{
                  marginLeft: 'auto', flexShrink: 0, padding: '6px 12px', borderRadius: 8,
                  border: '1px solid var(--accent-ring)', background: 'var(--accent)', color: '#0b0b0c',
                  fontSize: 11, fontWeight: 700,
                  cursor: busy || developing ? 'not-allowed' : 'pointer',
                  opacity: busy || developing ? 0.6 : 1,
                }}
              >
                {busy && deblurProgress != null ? `Deblurring… ${Math.round(deblurProgress * 100)}%` : 'Apply'}
              </button>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--glass-text-muted)', lineHeight: 1.5 }}>
              Removes camera-shake / motion blur with AI (GPU). Bakes a new base; Revert Enhance undoes it.
            </div>
          </div>
        )}

        <SliderRow
          label="Chroma noise"
          value={params.denoiseStrength}
          defaultValue={DEFAULT_ENHANCE_PARAMS.denoiseStrength}
          min={0}
          max={10}
          step={0.5}
          formatValue={(v) => (v === 0 ? 'Off' : v.toFixed(1))}
          onChange={(v) => update({ denoiseStrength: v })}
        />

        <label className="flex items-center gap-2" style={{ fontSize: 11.5, color: 'var(--glass-text-label)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={params.chromaClean}
            onChange={(e) => update({ chromaClean: e.target.checked })}
          />
          Chroma cleanup
        </label>

        {/* Route-aware disclosure: on the AI upscale route these sliders apply to the AI OUTPUT
            (Chroma / Detail / Sharpen refine on top), but the Deblur stage is skipped because
            Real-ESRGAN already resolves detail. Shown once an AI upscale has actually run. */}
        {upscaleMode === 'ai' && (
          <div data-testid="enhance-ai-slider-hint" style={{ fontSize: 10.5, color: 'var(--glass-text-muted)', lineHeight: 1.5 }}>
            AI upscale already denoises and sharpens — Chroma, Detail & Sharpen refine on top; Deblur is skipped on the AI route.
          </div>
        )}
      </div>

      {error && <div role="alert" className="text-xs" style={{ color: '#f87171' }}>{error}</div>}

      {/* Apply button. C4 finding 4: gated while developing (parity with Re-apply and Motion
          deblur) — the service guard would refuse the bake anyway; disabling makes it honest. */}
      <button
        type="button"
        disabled={busy || developing || selectedScaleInfeasible}
        title={developing ? 'Available when full quality finishes developing' : undefined}
        style={{
          width: '100%', padding: 11, borderRadius: 11,
          border: '1px solid var(--accent-ring)',
          background: 'var(--accent)', color: '#0b0b0c', fontSize: 12.5, fontWeight: 700,
          cursor: busy ? 'wait' : developing || selectedScaleInfeasible ? 'not-allowed' : 'pointer',
          opacity: busy || developing || selectedScaleInfeasible ? 0.6 : 1,
          boxShadow: busy || developing || selectedScaleInfeasible ? 'none' : '0 2px 18px var(--accent-ring)',
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

      {/* Staleness hint: upstream edits changed after Apply Enhance ran → the result is out of date. */}
      {enhanceStale && (
        <div
          data-testid="enhance-stale-hint"
          style={{
            display: 'flex', alignItems: 'center', gap: 6, marginTop: -6,
            fontSize: 10.5, color: 'var(--accent)',
          }}
        >
          <span aria-hidden style={{ flexShrink: 0 }}>↻</span>
          <span>Upstream edits changed — Re-apply to update.</span>
        </div>
      )}

      {/* Revert button */}
      {revertVersion >= 0 && enhanceService.canRevert() && (
        <button
          type="button"
          disabled={busy}
          style={{
            width: '100%', padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,.1)',
            background: 'transparent', color: 'var(--glass-text-secondary)', fontSize: 11.5,
            cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
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
          <span>Upscale bakes a new base. The intent is saved — reopen the photo and re-apply to restore it (the pixels re-derive).</span>
        </div>
      )}
    </div>
  );
}
