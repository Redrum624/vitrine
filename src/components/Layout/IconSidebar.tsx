import { HardDrive, Settings, BarChart3, Sun, Droplet, Activity, Crop, Palette, Focus, Filter } from 'lucide-react';

interface IconSidebarProps {
  onToolSelect?: (tool: string) => void;
  selectedTool?: string | null;
  histogramVisible?: boolean;
}

interface Tool {
  id: string;
  icon: string | React.ReactNode;
  name: string;
}

const tools: Tool[] = [
  { id: 'file-explorer', icon: <HardDrive className="w-5 h-5" />, name: 'File Explorer' },
  { id: 'crop', icon: <Crop className="w-5 h-5" />, name: 'Crop & Transform' },
  { id: 'basicadj', icon: <Sun className="w-5 h-5" />, name: 'Basic Adjustments' },
  { id: 'whitebalance', icon: <Droplet className="w-5 h-5" />, name: 'White Balance' },
  { id: 'tonecurve', icon: <Activity className="w-5 h-5" />, name: 'Tone Curve' },
  { id: 'noisereduction', icon: <Filter className="w-5 h-5" />, name: 'Noise Reduction' },
  { id: 'colorbalance', icon: <Palette className="w-5 h-5" />, name: 'Color Balance' },
  { id: 'lenscorrections', icon: <Focus className="w-5 h-5" />, name: 'Lens Corrections' },
];

export function IconSidebar({ onToolSelect, selectedTool, histogramVisible }: IconSidebarProps) {
  const handleToolClick = (toolId: string) => {
    if (onToolSelect) {
      onToolSelect(toolId);
    }
  };

  return (
    <div className="bg-black border-r flex flex-col items-center" style={{width: '64px', padding: '20px 0', gap: '4px', borderRightColor: 'var(--border)'}}>
      {/* Panel switchers - File Explorer and Modules */}
      {tools.map((tool) => (
        <button
          key={tool.id}
          className={`
            relative flex items-center justify-center
            border cursor-pointer
            ${selectedTool === tool.id
              ? 'text-white'
              : 'bg-transparent hover:text-dark-100'
            }
          `}
          style={{
            width: '48px',
            height: '48px',
            margin: '0 8px',
            fontSize: '18px',
            borderRadius: '4px',
            transition: 'var(--transition-fast)',
            backgroundColor: selectedTool === tool.id ? 'var(--gray-850)' : 'transparent',
            borderColor: selectedTool === tool.id ? 'var(--border-light)' : 'transparent',
            color: selectedTool === tool.id ? 'var(--white)' : 'var(--gray-400)'
          }}
          onMouseEnter={(e) => {
            if (selectedTool !== tool.id) {
              e.currentTarget.style.backgroundColor = 'var(--gray-900)';
            }
          }}
          onMouseLeave={(e) => {
            if (selectedTool !== tool.id) {
              e.currentTarget.style.backgroundColor = 'transparent';
            }
          }}
          onClick={() => handleToolClick(tool.id)}
          title={tool.name}
          aria-label={tool.name}
        >
          {selectedTool === tool.id && (
            <div className="absolute" style={{left: '-8px', top: '50%', transform: 'translateY(-50%)', width: '2px', height: '24px', backgroundColor: 'var(--white)'}} />
          )}
          {tool.icon}
        </button>
      ))}

      <div className="flex-1" />

      {/* Histogram button */}
      <button
        className={`
          relative flex items-center justify-center
          border cursor-pointer
          ${histogramVisible
            ? 'text-white'
            : 'bg-transparent hover:text-dark-100'
          }
        `}
        style={{
          width: '48px',
          height: '48px',
          margin: '0 8px 4px 8px',
          fontSize: '18px',
          borderRadius: '4px',
          transition: 'var(--transition-fast)',
          backgroundColor: histogramVisible ? 'var(--gray-850)' : 'transparent',
          borderColor: histogramVisible ? 'var(--border-light)' : 'transparent',
          color: histogramVisible ? 'var(--white)' : 'var(--gray-400)'
        }}
        onMouseEnter={(e) => {
          if (!histogramVisible) {
            e.currentTarget.style.backgroundColor = 'var(--gray-900)';
          }
        }}
        onMouseLeave={(e) => {
          if (!histogramVisible) {
            e.currentTarget.style.backgroundColor = 'transparent';
          }
        }}
        onClick={() => handleToolClick('histogram')}
        title="Histogram"
        aria-label="Histogram"
      >
        {histogramVisible && (
          <div className="absolute" style={{left: '-8px', top: '50%', transform: 'translateY(-50%)', width: '2px', height: '24px', backgroundColor: 'var(--white)'}} />
        )}
        <BarChart3 className="w-5 h-5" />
      </button>

      {/* Settings button */}
      <button
        className={`
          relative flex items-center justify-center
          border cursor-pointer
          ${selectedTool === 'settings'
            ? 'text-white'
            : 'bg-transparent hover:text-dark-100'
          }
        `}
        style={{
          width: '48px',
          height: '48px',
          margin: '0 8px',
          fontSize: '18px',
          borderRadius: '4px',
          transition: 'var(--transition-fast)',
          backgroundColor: selectedTool === 'settings' ? 'var(--gray-850)' : 'transparent',
          borderColor: selectedTool === 'settings' ? 'var(--border-light)' : 'transparent',
          color: selectedTool === 'settings' ? 'var(--white)' : 'var(--gray-400)'
        }}
        onMouseEnter={(e) => {
          if (selectedTool !== 'settings') {
            e.currentTarget.style.backgroundColor = 'var(--gray-900)';
          }
        }}
        onMouseLeave={(e) => {
          if (selectedTool !== 'settings') {
            e.currentTarget.style.backgroundColor = 'transparent';
          }
        }}
        onClick={() => handleToolClick('settings')}
        title="Settings"
        aria-label="Settings"
      >
        {selectedTool === 'settings' && (
          <div className="absolute" style={{left: '-8px', top: '50%', transform: 'translateY(-50%)', width: '2px', height: '24px', backgroundColor: 'var(--white)'}} />
        )}
        <Settings className="w-5 h-5" />
      </button>
    </div>
  );
}
