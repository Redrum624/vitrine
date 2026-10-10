import type { CSSProperties, ReactNode } from 'react';
import { HardDrive, Settings, BarChart3, Sun, Droplet, Activity, Crop, Palette, Focus, History, Sparkles } from 'lucide-react';
import { TOOL_STRIP_WIDTH } from '../../layout/photoRegion';

interface IconSidebarProps {
  onToolSelect?: (tool: string) => void;
  selectedTool?: string | null;
  histogramVisible?: boolean;
}

interface Tool {
  id: string;
  icon: ReactNode;
  name: string;
}

const tools: Tool[] = [
  { id: 'file-explorer', icon: <HardDrive size={18} strokeWidth={1.6} />, name: 'File Explorer' },
  { id: 'crop', icon: <Crop size={18} strokeWidth={1.6} />, name: 'Crop & Transform' },
  { id: 'basicadj', icon: <Sun size={18} strokeWidth={1.6} />, name: 'Basic Adjustments' },
  { id: 'whitebalance', icon: <Droplet size={18} strokeWidth={1.6} />, name: 'White Balance' },
  { id: 'colorbalance', icon: <Palette size={18} strokeWidth={1.6} />, name: 'Color Balance' },
  { id: 'tonecurve', icon: <Activity size={18} strokeWidth={1.6} />, name: 'Tone Curve' },
  { id: 'enhance', icon: <Sparkles size={18} strokeWidth={1.6} />, name: 'Enhance' },
  { id: 'lenscorrections', icon: <Focus size={18} strokeWidth={1.6} />, name: 'Lens Corrections' },
  { id: 'history', icon: <History size={18} strokeWidth={1.6} />, name: 'History' },
];

const TILE = 36;
const GAP = 4;

// 36px tile, radius 7. Hover/press fills live in .glass-rail-btn (index.css).
const railBtn: CSSProperties = {
  width: TILE,
  height: TILE,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 7,
  border: 0,
  background: 'transparent',
  color: 'var(--glass-text-chrome-idle)',
  flex: 'none',
};

// The selected tool reads as a raised tile; the amber bar beside it (below)
// is the only accent in the strip.
const railBtnActive: CSSProperties = {
  background: 'var(--vt-raised)',
  color: 'var(--vt-text)',
};

function RailButton({ active, icon, label, onClick, pressed }: { active: boolean; icon: ReactNode; label: string; onClick: () => void; pressed?: boolean }) {
  return (
    <button
      type="button"
      className={`glass-rail-btn${active ? ' is-active' : ''}`}
      style={{ ...railBtn, ...(active ? railBtnActive : null) }}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      aria-current={pressed === undefined && active ? 'true' : undefined}
    >
      {icon}
    </button>
  );
}

/**
 * Docked tool strip (far right of the window). Module tabs at the top — the
 * selected one is a raised tile with an amber bar on its left edge that
 * slides between tools on the spring curve — and the Histogram / Settings
 * toggles pinned to the bottom.
 */
export function IconSidebar({ onToolSelect, selectedTool, histogramVisible }: IconSidebarProps) {
  const handleToolClick = (toolId: string) => onToolSelect?.(toolId);
  const activeIndex = tools.findIndex((t) => t.id === selectedTool);

  return (
    <nav
      aria-label="Tools"
      className="flex flex-col items-center no-select"
      style={{
        width: TOOL_STRIP_WIDTH,
        flex: 'none',
        padding: '8px 0',
        background: 'var(--vt-chrome)',
        borderLeft: '1px solid var(--vt-line-soft)',
        minHeight: 0,
        overflowY: 'auto',
        scrollbarWidth: 'none',
      }}
    >
      <div className="flex flex-col items-center" style={{ position: 'relative', gap: GAP }}>
        {/* Sliding selection bar — moves to the selected module tab. */}
        <span
          aria-hidden="true"
          data-testid="tool-strip-indicator"
          style={{
            position: 'absolute',
            left: -((TOOL_STRIP_WIDTH - TILE) / 2) + 1,
            top: 0,
            width: 3,
            height: 20,
            marginTop: (TILE - 20) / 2,
            borderRadius: 2,
            background: 'var(--accent)',
            opacity: activeIndex >= 0 ? 1 : 0,
            transform: `translateY(${Math.max(0, activeIndex) * (TILE + GAP)}px)`,
            transition: 'transform 380ms var(--ease-spring), opacity 160ms ease',
          }}
        />
        {tools.map((tool) => (
          <RailButton
            key={tool.id}
            active={selectedTool === tool.id}
            icon={tool.icon}
            label={tool.name}
            onClick={() => handleToolClick(tool.id)}
          />
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 12 }} />
      <div style={{ width: 24, height: 1, background: 'var(--vt-line)', margin: '4px 0 8px', flex: 'none' }} />

      <div className="flex flex-col items-center" style={{ gap: GAP }}>
        <RailButton active={!!histogramVisible} pressed={!!histogramVisible} icon={<BarChart3 size={18} strokeWidth={1.6} />} label="Histogram" onClick={() => handleToolClick('histogram')} />
        <RailButton active={selectedTool === 'settings'} icon={<Settings size={18} strokeWidth={1.6} />} label="Settings" onClick={() => handleToolClick('settings')} />
      </div>
    </nav>
  );
}
