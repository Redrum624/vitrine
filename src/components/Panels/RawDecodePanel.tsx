import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronDown, ChevronRight, Aperture } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { rawImageService } from '../../services/RawImageService';
import { notificationService } from '../../services/NotificationService';
import { imageProcessingPipeline } from '../../services/ImageProcessingPipeline';
import type { ImageFileInfo } from '../../services/FileSystemService';
import type { DemosaicAlgo, HighlightMode, RawDecodeOptions } from '../../types/electron';

const HR_MODULE_ID = 'highlightrecovery';
const HR_TOOLTIP =
  'Reconstructs blown highlight channels from the surviving ones after decode. ' +
  'Post-decode module — does NOT re-decode the file. 0 = off.';

/** Read the live highlight-recovery strength (0..100) off the registered pipeline module. */
function readHrStrength(): number {
  const m = imageProcessingPipeline.getModule(HR_MODULE_ID) as
    | { getParams?: () => { strength?: number } }
    | undefined;
  return m?.getParams?.().strength ?? 0;
}

const DEMOSAIC_OPTIONS: { value: DemosaicAlgo; label: string }[] = [
  { value: 'ahd', label: 'AHD' },
  { value: 'dcb', label: 'DCB' },
];

const HIGHLIGHT_OPTIONS: { value: HighlightMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'blend', label: 'Blend' },
  { value: 'reconstruct', label: 'Reconstruct' },
];

const RE_DECODE_TOOLTIP = 'Changing this re-decodes the RAW file from disk.';

const CAMERA_MATCH_TOOLTIP =
  'Fits the decode to this photo’s own embedded camera JPEG, so the starting point ' +
  'matches the out-of-camera render (picture mode and gradation included). ' +
  'Off gives Vitrine’s neutral bright render. Changing this re-decodes the file.';

// Shared glass-card select look (kept as REAL native <select>s — see the file-level
// note below on why Demosaic/Highlights aren't Segmented here).
const selectStyle: CSSProperties = {
  width: '100%',
  fontSize: 12,
  padding: '6px 8px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,.1)',
  background: 'rgba(255,255,255,.04)',
  color: 'var(--glass-text-label)',
};

interface RawDecodePanelProps {
  /**
   * The currently open image (App's live selection, threaded down through
   * AdjustmentPanel). Passed as a prop rather than read from the Zustand store
   * because this app keeps `currentImage` in App-local state — the store's
   * `currentImage` is never populated, so gating on it left this panel
   * permanently invisible.
   */
  currentImage?: ImageFileInfo | null;
}

/**
 * Collapsible "RAW Decode" section — demosaic algorithm + highlight recovery mode for the
 * currently open RAW file. Hidden entirely for non-RAW images (own gate via the file-extension
 * helper rawImageService.isRawFile, since ImageFileInfo carries no reliable isRaw flag).
 *
 * Both selects are bound to appStore.rawDecodeOptions (kept in lock-step with the actually
 * decoded base) and, on change, call rawImageService.reDecode with the full merged options —
 * the only path by which decode options take effect (see RawImageService.reDecode). While a
 * re-decode is in flight (store.reDecoding) both controls are disabled and a progress note
 * is shown, mirroring the guard reDecode itself applies. A rejected re-decode surfaces a
 * notification instead of an unhandled promise rejection.
 *
 * Demosaic/Highlights stay real <select> elements (not the Segmented control used elsewhere
 * in the Glass · Sectioned redesign): jest-dom's `toHaveValue`/`toBeDisabled`/title-attribute
 * assertions in rawDecodePanel.test.tsx need a genuine form control, and a native <select>
 * restyled with the same glass tokens reads identically to the rest of the card system
 * without trading away that test contract (see the Glass UI design spec — "keep hidden
 * selects" is the sanctioned fallback when a control swap would weaken value-binding).
 */
export function RawDecodePanel({ currentImage }: RawDecodePanelProps) {
  const rawDecodeOptions = useAppStore((s) => s.rawDecodeOptions);
  const reDecoding = useAppStore((s) => s.reDecoding);
  const externalParamsVersion = useAppStore((s) => s.externalParamsVersion);
  const [open, setOpen] = useState(false);
  // Highlight-recovery strength lives on the pipeline module (persisted per-image by
  // EditPersistenceService like every other module param — NOT a decode option, so no
  // re-decode on change). Mirror it into local state for the slider, re-syncing when the
  // open image changes AND on externalParamsVersion: the per-image restore lands AFTER
  // the image-change effect fires (async decode), and Canvas bumps the signal once
  // restoreState completes — without it a reopened image renders with its saved strength
  // while the slider displays 0 (v1.20.0 smoke H2 caught this live).
  const [hrStrength, setHrStrength] = useState<number>(readHrStrength);

  useEffect(() => {
    setHrStrength(readHrStrength());
  }, [currentImage?.id, externalParamsVersion]);

  const applyHrStrength = (strength: number) => {
    setHrStrength(strength);
    const m = imageProcessingPipeline.getModule(HR_MODULE_ID) as
      | { setParams?: (p: { strength: number }) => void }
      | undefined;
    m?.setParams?.({ strength });
    imageProcessingPipeline.invalidateModuleCache(HR_MODULE_ID);
    useAppStore.getState().triggerReprocessing(); // no re-decode — just re-runs the pipeline
  };

  const isRaw = currentImage ? rawImageService.isRawFile(currentImage.path) : false;
  if (!isRaw) return null;

  const runReDecode = (options: RawDecodeOptions) => {
    rawImageService.reDecode(options, currentImage?.id).catch((err) => {
      notificationService.error(
        'RAW re-decode failed',
        err instanceof Error ? err.message : String(err),
      );
    });
  };

  const handleDemosaicChange = (demosaic: DemosaicAlgo) => {
    runReDecode({ ...rawDecodeOptions, demosaic });
  };

  const handleHighlightChange = (highlightMode: HighlightMode) => {
    runReDecode({ ...rawDecodeOptions, highlightMode });
  };

  const handleCameraMatchChange = (cameraMatch: boolean) => {
    runReDecode({ ...rawDecodeOptions, cameraMatch });
  };

  return (
    <div className="glass-card dc-rise" style={{ overflow: 'hidden', marginBottom: 12 }}>
      <div
        className="flex items-center"
        style={{ gap: 8, padding: '10px 14px', cursor: 'pointer' }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown size={14} style={{ color: 'var(--glass-text-muted)' }} />
        ) : (
          <ChevronRight size={14} style={{ color: 'var(--glass-text-muted)' }} />
        )}
        <Aperture size={14} style={{ color: 'var(--accent)' }} />
        <span className="flex-1 truncate" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--glass-text-title)' }}>RAW Decode</span>
        {!open && (
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: 'var(--glass-text-muted)' }}>
            {rawDecodeOptions.demosaic.toUpperCase()} &middot; {rawDecodeOptions.highlightMode}
            {rawDecodeOptions.cameraMatch ? ' · cam' : ''}
          </span>
        )}
        {reDecoding && <span style={{ fontSize: 10.5, color: 'var(--accent)' }}>Decoding&hellip;</span>}
      </div>
      {open && (
        <div className="flex flex-col" style={{ gap: 12, padding: '4px 14px 14px' }}>
          <div className="flex items-center justify-between" style={{ gap: 8 }}>
            <label htmlFor="raw-decode-camera-match" style={{ fontSize: 11, fontWeight: 500, color: 'var(--glass-text-label)' }}>
              Camera match
            </label>
            <input
              id="raw-decode-camera-match"
              type="checkbox"
              checked={!!rawDecodeOptions.cameraMatch}
              disabled={reDecoding}
              title={CAMERA_MATCH_TOOLTIP}
              onChange={(e) => handleCameraMatchChange(e.target.checked)}
            />
          </div>
          <div className="flex flex-col" style={{ gap: 6 }}>
            <label htmlFor="raw-decode-demosaic" style={{ fontSize: 11, fontWeight: 500, color: 'var(--glass-text-label)' }}>
              Demosaic
            </label>
            <select
              id="raw-decode-demosaic"
              value={rawDecodeOptions.demosaic}
              disabled={reDecoding}
              title={RE_DECODE_TOOLTIP}
              onChange={(e) => handleDemosaicChange(e.target.value as DemosaicAlgo)}
              style={selectStyle}
            >
              {DEMOSAIC_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col" style={{ gap: 6 }}>
            <label htmlFor="raw-decode-highlights" style={{ fontSize: 11, fontWeight: 500, color: 'var(--glass-text-label)' }}>
              Highlights
            </label>
            <select
              id="raw-decode-highlights"
              value={rawDecodeOptions.highlightMode}
              disabled={reDecoding}
              title={RE_DECODE_TOOLTIP}
              onChange={(e) => handleHighlightChange(e.target.value as HighlightMode)}
              style={selectStyle}
            >
              {HIGHLIGHT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col" style={{ gap: 6 }}>
            <div className="flex items-center justify-between">
              <label htmlFor="raw-highlight-recovery" style={{ fontSize: 11, fontWeight: 500, color: 'var(--glass-text-label)' }}>
                Highlight recovery
              </label>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: 'var(--glass-text-muted)' }}>
                {hrStrength.toFixed(0)}
              </span>
            </div>
            <input
              id="raw-highlight-recovery"
              type="range"
              min={0}
              max={100}
              step={1}
              value={hrStrength}
              title={HR_TOOLTIP}
              onChange={(e) => applyHrStrength(parseFloat(e.target.value))}
              onDoubleClick={() => applyHrStrength(0)}
              className="slider"
              style={{ width: '100%' }}
            />
            <div style={{ fontSize: 10.5, color: 'var(--glass-text-muted)' }}>
              {HR_TOOLTIP}
            </div>
          </div>
          {reDecoding && (
            <div role="status" style={{ fontSize: 11, color: 'var(--glass-text-secondary)' }}>
              Re-decoding RAW file&hellip;
            </div>
          )}
          <div style={{ fontSize: 10.5, color: 'var(--glass-text-muted)' }}>
            {RE_DECODE_TOOLTIP}
          </div>
        </div>
      )}
    </div>
  );
}

export default RawDecodePanel;
