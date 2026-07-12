import { useEffect, useState } from 'react';

export function SettingsPanel() {
  // Real app version via the same IPC source the splash and the MenuBar About
  // dialog use (main.cjs 'get-app-version' reads package.json). The block used
  // to hardcode "Version 1.0.0" and never updated across releases.
  const [appVersion, setAppVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.getAppVersion?.()
      .then((version) => { if (!cancelled) setAppVersion(version); })
      .catch(() => { /* leave null — the line shows a placeholder */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--gray-900)' }}>
      {/* Header */}
      <div className="px-5 py-4 border-b" style={{ borderBottomColor: 'var(--border)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--white)' }}>
          Settings
        </h2>
      </div>

      {/* Settings Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-6">
          {/* Appearance Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>
              Appearance
            </h3>
            <div className="space-y-2">
              <label className="flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--gray-300)' }}>Dark Mode</span>
                <input
                  type="checkbox"
                  checked={true}
                  readOnly
                  className="w-4 h-4"
                />
              </label>
            </div>
          </div>

          {/* Performance Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>
              Performance
            </h3>
            <div className="space-y-2">
              <label className="flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--gray-300)' }}>Hardware Acceleration</span>
                <input
                  type="checkbox"
                  checked={true}
                  readOnly
                  className="w-4 h-4"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--gray-300)' }}>Use GPU Processing</span>
                <input
                  type="checkbox"
                  checked={true}
                  readOnly
                  className="w-4 h-4"
                />
              </label>
            </div>
          </div>

          {/* Image Processing Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>
              Image Processing
            </h3>
            <div className="space-y-2">
              <div className="flex flex-col gap-1">
                <label className="text-sm" style={{ color: 'var(--gray-300)' }}>Default Color Space</label>
                <select
                  className="px-2 py-1.5 text-sm rounded border"
                  style={{
                    backgroundColor: 'var(--gray-800)',
                    borderColor: 'var(--border)',
                    color: 'var(--gray-200)'
                  }}
                >
                  <option>sRGB</option>
                  <option>Adobe RGB</option>
                  <option>ProPhoto RGB</option>
                  <option>Display P3</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm" style={{ color: 'var(--gray-300)' }}>Bit Depth</label>
                <select
                  className="px-2 py-1.5 text-sm rounded border"
                  style={{
                    backgroundColor: 'var(--gray-800)',
                    borderColor: 'var(--border)',
                    color: 'var(--gray-200)'
                  }}
                >
                  <option>8-bit</option>
                  <option>16-bit</option>
                  <option>32-bit (Float)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Cache Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>
              Cache & Storage
            </h3>
            <div className="space-y-2">
              <div className="flex flex-col gap-1">
                <label className="text-sm" style={{ color: 'var(--gray-300)' }}>Cache Size (MB)</label>
                <input
                  type="number"
                  defaultValue={512}
                  className="px-2 py-1.5 text-sm rounded border"
                  style={{
                    backgroundColor: 'var(--gray-800)',
                    borderColor: 'var(--border)',
                    color: 'var(--gray-200)'
                  }}
                />
              </div>
              <button
                className="px-3 py-1.5 text-sm rounded border"
                style={{
                  backgroundColor: 'var(--gray-800)',
                  borderColor: 'var(--border)',
                  color: 'var(--gray-300)'
                }}
              >
                Clear Cache
              </button>
            </div>
          </div>

          {/* About Section */}
          <div className="space-y-3 pb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>
              About
            </h3>
            <div className="space-y-1 text-xs" style={{ color: 'var(--gray-400)' }}>
              <p>Vitrine</p>
              <p>Version {appVersion ?? '—'}</p>
              <p>© {new Date().getFullYear()} All rights reserved</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
