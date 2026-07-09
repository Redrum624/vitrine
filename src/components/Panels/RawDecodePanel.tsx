import { useState } from 'react';
import { ChevronDown, ChevronRight, Aperture } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { rawImageService } from '../../services/RawImageService';
import type { DemosaicAlgo, HighlightMode } from '../../types/electron';

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

/**
 * Collapsible "RAW Decode" section — demosaic algorithm + highlight recovery mode for the
 * currently open RAW file. Hidden entirely for non-RAW images (own gate, mirrors the
 * established RAW-detection pattern used by CopyrightModule: rawImageService.isRawFile on
 * the store's currentImage.path — the store's ImageFile.isRaw field isn't populated on
 * open, so the file-extension helper is the reliable signal here).
 *
 * Both selects are bound to appStore.rawDecodeOptions (kept in lock-step with the actually
 * decoded base) and, on change, call rawImageService.reDecode with the full merged options —
 * the only path by which decode options take effect (see RawImageService.reDecode). While a
 * re-decode is in flight (store.reDecoding) both controls are disabled and a progress note
 * is shown, mirroring the guard reDecode itself applies.
 */
export function RawDecodePanel() {
  const currentImage = useAppStore((s) => s.currentImage);
  const rawDecodeOptions = useAppStore((s) => s.rawDecodeOptions);
  const reDecoding = useAppStore((s) => s.reDecoding);
  const [open, setOpen] = useState(false);

  const isRaw = currentImage ? rawImageService.isRawFile(currentImage.path) : false;
  if (!isRaw) return null;

  const handleDemosaicChange = (demosaic: DemosaicAlgo) => {
    rawImageService.reDecode({ ...rawDecodeOptions, demosaic });
  };

  const handleHighlightChange = (highlightMode: HighlightMode) => {
    rawImageService.reDecode({ ...rawDecodeOptions, highlightMode });
  };

  return (
    <div className="rounded-lg border overflow-hidden mb-3" style={{ borderColor: 'var(--border)' }}>
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer"
        style={{ backgroundColor: 'var(--gray-800)' }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--gray-500)' }} />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--gray-500)' }} />
        )}
        <Aperture className="w-3.5 h-3.5" style={{ color: 'var(--primary-400)' }} />
        <span className="text-xs font-medium flex-1 truncate" style={{ color: 'var(--gray-100)' }}>RAW Decode</span>
        {!open && (
          <span className="text-xs font-mono" style={{ color: 'var(--gray-500)' }}>
            {rawDecodeOptions.demosaic.toUpperCase()} &middot; {rawDecodeOptions.highlightMode}
          </span>
        )}
        {reDecoding && <span className="text-xs" style={{ color: 'var(--primary-400)' }}>Decoding&hellip;</span>}
      </div>
      {open && (
        <div className="px-3 py-3 space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="raw-decode-demosaic" className="text-xs font-medium" style={{ color: 'var(--gray-300)' }}>
              Demosaic
            </label>
            <select
              id="raw-decode-demosaic"
              value={rawDecodeOptions.demosaic}
              disabled={reDecoding}
              title={RE_DECODE_TOOLTIP}
              onChange={(e) => handleDemosaicChange(e.target.value as DemosaicAlgo)}
              className="w-full text-xs rounded px-2 py-1.5"
              style={{ backgroundColor: 'var(--gray-700)', color: 'var(--white)', border: '1px solid var(--border)' }}
            >
              {DEMOSAIC_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="raw-decode-highlights" className="text-xs font-medium" style={{ color: 'var(--gray-300)' }}>
              Highlights
            </label>
            <select
              id="raw-decode-highlights"
              value={rawDecodeOptions.highlightMode}
              disabled={reDecoding}
              title={RE_DECODE_TOOLTIP}
              onChange={(e) => handleHighlightChange(e.target.value as HighlightMode)}
              className="w-full text-xs rounded px-2 py-1.5"
              style={{ backgroundColor: 'var(--gray-700)', color: 'var(--white)', border: '1px solid var(--border)' }}
            >
              {HIGHLIGHT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {reDecoding && (
            <div className="text-xs" role="status" style={{ color: 'var(--gray-400)' }}>
              Re-decoding RAW file&hellip;
            </div>
          )}
          <div className="text-xs" style={{ color: 'var(--gray-500)' }}>
            {RE_DECODE_TOOLTIP}
          </div>
        </div>
      )}
    </div>
  );
}

export default RawDecodePanel;
