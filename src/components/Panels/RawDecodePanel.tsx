import { useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronDown, ChevronRight, Aperture } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { rawImageService } from '../../services/RawImageService';
import { notificationService } from '../../services/NotificationService';
import type { ImageFileInfo } from '../../services/FileSystemService';
import type { DemosaicAlgo, HighlightMode, RawDecodeOptions } from '../../types/electron';

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
 * without trading away that test contract (see design_handoff_glass_ui — "keep hidden
 * selects" is the sanctioned fallback when a control swap would weaken value-binding).
 */
export function RawDecodePanel({ currentImage }: RawDecodePanelProps) {
  const rawDecodeOptions = useAppStore((s) => s.rawDecodeOptions);
  const reDecoding = useAppStore((s) => s.reDecoding);
  const [open, setOpen] = useState(false);

  const isRaw = currentImage ? rawImageService.isRawFile(currentImage.path) : false;
  if (!isRaw) return null;

  const runReDecode = (options: RawDecodeOptions) => {
    rawImageService.reDecode(options).catch((err) => {
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
          </span>
        )}
        {reDecoding && <span style={{ fontSize: 10.5, color: 'var(--accent)' }}>Decoding&hellip;</span>}
      </div>
      {open && (
        <div className="flex flex-col" style={{ gap: 12, padding: '4px 14px 14px' }}>
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
