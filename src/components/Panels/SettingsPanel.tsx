import { useEffect, useState, type ReactNode } from 'react';
import { useAppStore } from '../../stores/appStore';
import { Segmented, type SegmentedOption } from '../Controls/Segmented';
import { SectionLabel } from '../Controls/SectionLabel';
import { ChipButton } from '../Controls/ChipButton';
import { imageCacheService } from '../../services/ImageCacheService';
import { notificationService } from '../../services/NotificationService';
import { loadRawDecodeDefaults, saveRawDecodeDefaults } from '../../utils/rawDecodeDefaultsStorage';
import { DEFAULT_RAW_DECODE_OPTIONS, type DemosaicAlgo, type HighlightMode, type RawDecodeOptions } from '../../types/electron';

// Same key the Welcome screen's "Don't show again" writes and App reads at startup.
const WELCOME_DISMISSED_KEY = 'photo-editor-welcome-dismissed';

const DEMOSAIC_OPTIONS: SegmentedOption<DemosaicAlgo>[] = [
  { value: 'ahd', label: 'AHD' },
  { value: 'dcb', label: 'DCB' },
];

const HIGHLIGHT_OPTIONS: SegmentedOption<HighlightMode>[] = [
  { value: 'off', label: 'Off' },
  { value: 'blend', label: 'Blend' },
  { value: 'reconstruct', label: 'Reconstruct' },
];

function readWelcomeEnabled(): boolean {
  try { return localStorage.getItem(WELCOME_DISMISSED_KEY) !== 'true'; } catch { return true; }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

/** Label on the left, control on the right — or, `stacked`, the control full-width underneath. */
function Row({ label, hint, stacked, children }: { label: string; hint?: string; stacked?: boolean; children: ReactNode }) {
  const text = (
    <div className="min-w-0">
      <div style={{ fontSize: 12.5, color: 'var(--vt-text)' }}>{label}</div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--vt-text-3)', marginTop: 1 }}>{hint}</div>}
    </div>
  );
  if (stacked) {
    return <div className="flex flex-col" style={{ gap: 6 }}>{text}{children}</div>;
  }
  return (
    <div className="flex items-center justify-between" style={{ gap: 12, minHeight: 32 }}>
      {text}
      <div style={{ flex: 'none' }}>{children}</div>
    </div>
  );
}

/**
 * Settings: only things that are real and take effect. RAW defaults apply to photos that have no
 * saved decode options of their own (a photo you already opened keeps its own, see
 * rawDecodeDefaultsStorage); the rest is startup behaviour, memory and version info.
 */
export function SettingsPanel() {
  const renderMode = useAppStore((s) => s.renderMode);

  // Real app version via the same IPC source the splash and the MenuBar About
  // dialog use (main.cjs 'get-app-version' reads package.json).
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [rawDefaults, setRawDefaults] = useState<RawDecodeOptions>(DEFAULT_RAW_DECODE_OPTIONS);
  const [welcomeEnabled, setWelcomeEnabled] = useState(readWelcomeEnabled);
  const [cacheSize, setCacheSize] = useState(() => imageCacheService.getStats().totalSize);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.getAppVersion?.()
      .then((version) => { if (!cancelled) setAppVersion(version); })
      .catch(() => { /* leave null — the line shows a placeholder */ });
    loadRawDecodeDefaults()
      .then((opts) => { if (!cancelled) setRawDefaults(opts); })
      .catch(() => { /* factory defaults stay */ });
    return () => { cancelled = true; };
  }, []);

  const updateRawDefaults = (patch: Partial<RawDecodeOptions>) => {
    const next = { ...rawDefaults, ...patch };
    setRawDefaults(next);
    saveRawDecodeDefaults(next);
  };

  const toggleWelcome = (enabled: boolean) => {
    setWelcomeEnabled(enabled);
    try {
      if (enabled) localStorage.removeItem(WELCOME_DISMISSED_KEY);
      else localStorage.setItem(WELCOME_DISMISSED_KEY, 'true');
    } catch { /* storage unavailable — the toggle just won't persist */ }
  };

  const clearCache = () => {
    const freed = imageCacheService.getStats().totalSize;
    imageCacheService.clear();
    setCacheSize(imageCacheService.getStats().totalSize);
    notificationService.success('Cache cleared', `Freed ${formatBytes(freed)} of memory.`);
  };

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--vt-panel)' }}>
      <div className="flex items-center" style={{ height: 52, padding: '0 16px', borderBottom: '1px solid var(--vt-line-soft)' }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--vt-text)', margin: 0 }}>Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto vt-fade-in" style={{ padding: '16px 16px 24px' }}>
        <div className="flex flex-col" style={{ gap: 22 }}>
          <section className="flex flex-col" style={{ gap: 12 }} aria-label="RAW defaults">
            <SectionLabel>RAW defaults for new photos</SectionLabel>
            <Row label="Demosaic" stacked>
              <Segmented size="sm" className="w-full" options={DEMOSAIC_OPTIONS} value={rawDefaults.demosaic}
                onChange={(demosaic) => updateRawDefaults({ demosaic })} />
            </Row>
            <Row label="Highlights" stacked>
              <Segmented size="sm" className="w-full" options={HIGHLIGHT_OPTIONS} value={rawDefaults.highlightMode}
                onChange={(highlightMode) => updateRawDefaults({ highlightMode })} />
            </Row>
            <Row label="Camera match" hint="Start from the camera's own look">
              <input type="checkbox" aria-label="Camera match" checked={!!rawDefaults.cameraMatch}
                onChange={(e) => updateRawDefaults({ cameraMatch: e.target.checked })} />
            </Row>
          </section>

          <section className="flex flex-col" style={{ gap: 8 }} aria-label="Startup">
            <SectionLabel>Startup</SectionLabel>
            <Row label="Show welcome screen">
              <input type="checkbox" aria-label="Show welcome screen" checked={welcomeEnabled}
                onChange={(e) => toggleWelcome(e.target.checked)} />
            </Row>
          </section>

          <section className="flex flex-col" style={{ gap: 8 }} aria-label="Performance">
            <SectionLabel>Performance</SectionLabel>
            <Row label="Rendering" hint={renderMode === 'gpu' ? 'Graphics card (WebGL 2)' : 'Processor'}>
              <span style={{ fontSize: 12, color: 'var(--vt-text-3)' }}>Automatic</span>
            </Row>
            <Row label="Memory cache" hint={`${formatBytes(cacheSize)} in use`}>
              <ChipButton onClick={clearCache}>Clear</ChipButton>
            </Row>
          </section>

          <section className="flex flex-col" style={{ gap: 6 }} aria-label="About">
            <SectionLabel>About</SectionLabel>
            <div className="flex flex-col" style={{ gap: 2, fontSize: 12, color: 'var(--vt-text-2)' }}>
              <p style={{ margin: 0, color: 'var(--vt-text)' }}>Vitrine</p>
              <p style={{ margin: 0 }}>Version {appVersion ?? '—'}</p>
              <p style={{ margin: 0, color: 'var(--vt-text-3)' }}>© {new Date().getFullYear()} Redrum624 · Free for non-commercial use</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
