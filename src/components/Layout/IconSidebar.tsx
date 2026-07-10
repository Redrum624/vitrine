import type { CSSProperties, ReactNode } from 'react';
import { HardDrive, Settings, BarChart3, Sun, Droplet, Activity, Crop, Palette, Focus, History, Sparkles } from 'lucide-react';
import { RAIL_OFFSET } from '../../layout/photoRegion';

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
  { id: 'file-explorer', icon: <HardDrive className="w-5 h-5" />, name: 'File Explorer' },
  { id: 'crop', icon: <Crop className="w-5 h-5" />, name: 'Crop & Transform' },
  { id: 'basicadj', icon: <Sun className="w-5 h-5" />, name: 'Basic Adjustments' },
  { id: 'whitebalance', icon: <Droplet className="w-5 h-5" />, name: 'White Balance' },
  { id: 'colorbalance', icon: <Palette className="w-5 h-5" />, name: 'Color Balance' },
  { id: 'tonecurve', icon: <Activity className="w-5 h-5" />, name: 'Tone Curve' },
  { id: 'enhance', icon: <Sparkles className="w-5 h-5" />, name: 'Enhance' },
  { id: 'lenscorrections', icon: <Focus className="w-5 h-5" />, name: 'Lens Corrections' },
  { id: 'history', icon: <History className="w-5 h-5" />, name: 'History' },
];

// 42px tile, radius 12. Interactive hover (scale 1.06) lives in .glass-rail-btn
// (index.css). Active = accent-soft tile + accent-ring border + accent glyph + glow.
const railBtn: CSSProperties = {
  width: '42px',
  height: '42px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '12px',
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--glass-text-chrome-idle)',
  cursor: 'pointer',
};

const railBtnActive: CSSProperties = {
  background: 'var(--accent-soft)',
  border: '1px solid var(--accent-ring)',
  color: 'var(--accent)',
  boxShadow: '0 0 14px rgba(59, 130, 246, 0.35)',
};

function RailButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className={`glass-rail-btn${active ? ' is-active' : ''}`}
      style={{ ...railBtn, ...(active ? railBtnActive : null) }}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
  );
}

export function IconSidebar({ onToolSelect, selectedTool, histogramVisible }: IconSidebarProps) {
  const handleToolClick = (toolId: string) => onToolSelect?.(toolId);

  return (
    <div
      className="glass-chrome absolute flex flex-col items-center no-select"
      style={{ right: RAIL_OFFSET, top: '50%', transform: 'translateY(-50%)', borderRadius: '16px', padding: '10px 8px', gap: '6px', zIndex: 30 }}
    >
      {tools.map((tool) => (
        <RailButton
          key={tool.id}
          active={selectedTool === tool.id}
          icon={tool.icon}
          label={tool.name}
          onClick={() => handleToolClick(tool.id)}
        />
      ))}

      <div style={{ width: '24px', height: '1px', background: 'var(--glass-border)', margin: '4px 0' }} />

      <RailButton active={!!histogramVisible} icon={<BarChart3 className="w-5 h-5" />} label="Histogram" onClick={() => handleToolClick('histogram')} />
      <RailButton active={selectedTool === 'settings'} icon={<Settings className="w-5 h-5" />} label="Settings" onClick={() => handleToolClick('settings')} />
    </div>
  );
}
