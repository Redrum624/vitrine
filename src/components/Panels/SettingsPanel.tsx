import { useEffect, useState, type ReactNode } from 'react';
import { useAppStore } from '../../stores/appStore';
import { SectionLabel } from '../Controls/SectionLabel';
import { ChipButton } from '../Controls/ChipButton';
import { imageCacheService } from '../../services/ImageCacheService';
import { notificationService } from '../../services/NotificationService';

// Same key the Welcome screen's "Don't show again" writes and App reads at startup.
const WELCOME_DISMISSED_KEY = 'photo-editor-welcome-dismissed';

function readWelcomeEnabled(): boolean {
  try { return localStorage.getItem(WELCOME_DISMISSED_KEY) !== 'true'; } catch { return true; }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

/** Label on the left, control on the right — one line per setting. */
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between" style={{ gap: 12, minHeight: 32 }}>
      <div className="min-w-0">
        <div style={{ fontSize: 12.5, color: 'var(--vt-text)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: 'var(--vt-text-3)', marginTop: 1 }}>{hint}</div>}
      </div>
      <div style={{ flex: 'none' }}>{children}</div>
    </div>
  );
}

/**
 * Settings: only things that are real and take effect — startup behaviour, memory and version
 * info. (RAW decoding has no settings: every RAW decodes one fixed way, see rawDecoder.cjs.)
 */
export function SettingsPanel() {
  const renderMode = useAppStore((s) => s.renderMode);

  // Real app version via the same IPC source the splash and the MenuBar About
  // dialog use (main.cjs 'get-app-version' reads package.json).
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [welcomeEnabled, setWelcomeEnabled] = useState(readWelcomeEnabled);
  const [cacheSize, setCacheSize] = useState(() => imageCacheService.getStats().totalSize);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.getAppVersion?.()
      .then((version) => { if (!cancelled) setAppVersion(version); })
      .catch(() => { /* leave null — the line shows a placeholder */ });
    return () => { cancelled = true; };
  }, []);

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
