import { useState } from 'react';

interface ToolsPanelProps {
  onModuleSelect?: (moduleId: string) => void;
  moduleStates?: Record<string, { expanded: boolean; enabled: boolean }>;
  onModuleToggle?: (moduleId: string) => void;
  onModuleExpandCollapse?: (moduleId: string) => void;
}

interface ModuleCategory {
  id: string;
  name: string;
  modules: {
    id: string;
    name: string;
    icon?: string;
  }[];
}

const moduleCategories: ModuleCategory[] = [
  {
    id: 'geometric',
    name: 'GEOMETRIC',
    modules: [
      { id: 'crop', name: 'Crop & Transform', icon: '◧' },
      { id: 'lenscorrections', name: 'Lens Corrections', icon: '◎' },
    ]
  },
  {
    id: 'basic',
    name: 'BASIC ADJUSTMENTS',
    modules: [
      { id: 'basicadj', name: 'Exposure & Contrast', icon: '◐' },
      { id: 'whitebalance', name: 'White Balance', icon: '◈' },
      { id: 'shadowshighlights', name: 'Shadows & Highlights', icon: '◉' },
    ]
  },
  {
    id: 'color',
    name: 'COLOR & TONE',
    modules: [
      { id: 'tonecurve', name: 'Tone Curve', icon: '⟲' },
      { id: 'colorbalance', name: 'Color Balance', icon: '◪' },
    ]
  },
  {
    id: 'advanced',
    name: 'ADVANCED',
    modules: [
      { id: 'localadjustments', name: 'Local Adjustments', icon: '▨' },
      { id: 'noisereduction', name: 'Noise Reduction', icon: '◫' },
    ]
  }
];

export function ToolsPanel({
  onModuleSelect,
  moduleStates = {},
  onModuleToggle,
  onModuleExpandCollapse
}: ToolsPanelProps) {
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const toggleCategory = (categoryId: string) => {
    setCollapsedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  const handleModuleClick = (moduleId: string) => {
    if (onModuleExpandCollapse) {
      onModuleExpandCollapse(moduleId);
    }
    if (onModuleSelect) {
      onModuleSelect(moduleId);
    }
  };

  const handleModuleToggle = (e: React.MouseEvent, moduleId: string) => {
    e.stopPropagation();
    if (onModuleToggle) {
      onModuleToggle(moduleId);
    }
  };

  return (
    <div className="w-70 border-r flex flex-col overflow-hidden" style={{backgroundColor: 'var(--gray-900)', borderRightColor: 'var(--border)'}}>
      {/* Module List */}
      <div className="flex-1 overflow-y-auto">
        {moduleCategories.map((category) => (
          <div key={category.id} className="border-b p-4" style={{borderBottomColor: 'var(--border)'}}>
            {/* Category Header */}
            <div
              onClick={() => toggleCategory(category.id)}
              className="flex items-center justify-between mb-3 cursor-pointer select-none"
            >
              <h3 className="text-xxs font-semibold tracking-widest uppercase" style={{color: 'var(--gray-400)', letterSpacing: '1px'}}>
                {category.name}
              </h3>
              <span className="text-xxs" style={{color: 'var(--gray-500)'}}>
                {collapsedCategories.has(category.id) ? '▸' : '▼'}
              </span>
            </div>

            {/* Category Modules */}
            {!collapsedCategories.has(category.id) && (
              <div className="flex flex-col gap-px">
                {category.modules.map((module) => {
                  const state = moduleStates[module.id] || { expanded: false, enabled: false };
                  return (
                    <div
                      key={module.id}
                      className="px-3 py-2.5 flex items-center justify-between border rounded cursor-pointer"
                      style={{
                        backgroundColor: state.expanded ? 'var(--gray-800)' : 'transparent',
                        borderColor: state.expanded ? 'var(--border-light)' : 'transparent',
                        borderRadius: '3px',
                        transition: 'var(--transition-fast)'
                      }}
                      onMouseEnter={(e) => {
                        if (!state.expanded) {
                          e.currentTarget.style.backgroundColor = 'var(--gray-850)';
                          e.currentTarget.style.borderColor = 'var(--border-light)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!state.expanded) {
                          e.currentTarget.style.backgroundColor = 'transparent';
                          e.currentTarget.style.borderColor = 'transparent';
                        }
                      }}
                      onClick={() => handleModuleClick(module.id)}
                    >
                      <div className="flex items-center gap-2.5 flex-1">
                        {module.icon && (
                          <span className="text-sm w-4 h-4 flex items-center justify-center" style={{color: 'var(--gray-500)'}}>{module.icon}</span>
                        )}
                        <span className="text-xs" style={{color: 'var(--gray-200)'}}>{module.name}</span>
                      </div>

                      {/* Toggle Switch */}
                      <button
                        onClick={(e) => handleModuleToggle(e, module.id)}
                        className="relative w-9 h-5 rounded-full border"
                        style={{
                          backgroundColor: state.enabled ? 'var(--gray-700)' : 'var(--gray-800)',
                          borderColor: state.enabled ? 'var(--border-light)' : 'var(--border)',
                          transition: 'var(--transition-normal)'
                        }}
                        aria-label={`Toggle ${module.name}`}
                      >
                        <span
                          className="absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full"
                          style={{
                            backgroundColor: state.enabled ? 'var(--gray-200)' : 'var(--gray-500)',
                            transform: state.enabled ? 'translateX(16px)' : 'translateX(0)',
                            transition: 'var(--transition-normal)'
                          }}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
