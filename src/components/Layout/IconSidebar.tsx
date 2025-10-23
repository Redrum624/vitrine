interface IconSidebarProps {
  onToolSelect?: (tool: string) => void;
  selectedTool?: string | null;
}

interface Tool {
  id: string;
  icon: string;
  name: string;
}

const tools: Tool[] = [
  { id: 'select', icon: '▨', name: 'Select' },
  { id: 'crop', icon: '◧', name: 'Crop' },
  { id: 'transform', icon: '⟲', name: 'Transform' },
  { id: 'brush', icon: '◉', name: 'Brush' },
  { id: 'gradient', icon: '◐', name: 'Gradient' },
  { id: 'text', icon: '◈', name: 'Text' },
  { id: 'shape', icon: '◎', name: 'Shape' },
  { id: 'eyedropper', icon: '◪', name: 'Eyedropper' },
  { id: 'hand', icon: '▭', name: 'Hand' },
  { id: 'zoom', icon: '◫', name: 'Zoom' },
];

export function IconSidebar({ onToolSelect, selectedTool }: IconSidebarProps) {
  const handleToolClick = (toolId: string) => {
    if (onToolSelect) {
      onToolSelect(toolId);
    }
  };

  return (
    <div className="bg-black border-r border-dark-700 flex flex-col items-center" style={{width: '64px', padding: '20px 0', gap: '4px'}}>
      {tools.slice(0, 4).map((tool) => (
        <button
          key={tool.id}
          className={`
            relative flex items-center justify-center
            border border-transparent cursor-pointer
            transition-all
            ${selectedTool === tool.id
              ? 'bg-dark-850 border-dark-600 text-white'
              : 'bg-transparent text-dark-400 hover:bg-dark-900 hover:text-dark-100'
            }
          `}
          style={{width: '48px', height: '48px', margin: '0 8px', fontSize: '18px', borderRadius: '4px'}}
          onClick={() => handleToolClick(tool.id)}
          title={tool.name}
          aria-label={tool.name}
        >
          {selectedTool === tool.id && (
            <div className="absolute bg-white" style={{left: '-8px', top: '50%', transform: 'translateY(-50%)', width: '2px', height: '24px'}} />
          )}
          {tool.icon}
        </button>
      ))}

      <div className="flex-1" />

      <button
        className="flex items-center justify-center border border-transparent cursor-pointer transition-all bg-transparent text-dark-400 hover:bg-dark-900 hover:text-dark-100"
        style={{width: '48px', height: '48px', margin: '0 8px', fontSize: '18px', borderRadius: '4px'}}
        title="Settings"
      >
        ⚙
      </button>
    </div>
  );
}
