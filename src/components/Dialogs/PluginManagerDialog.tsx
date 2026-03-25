import { useState, useEffect } from 'react';

interface PerformanceWithMemory {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}
import { X, Package, Download, Trash2, Play, Square, Search, ExternalLink, Shield } from 'lucide-react';
import { pluginSystem, PluginMetadata, createExamplePlugins } from '../../services/PluginSystem';
import { logger } from '../../utils/Logger';

interface PluginManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type PluginCategory = 'all' | 'filter' | 'adjustment' | 'tool' | 'export' | 'import' | 'utility';

const categoryNames: Record<PluginCategory, string> = {
  all: 'All Plugins',
  filter: 'Filters',
  adjustment: 'Adjustments',
  tool: 'Tools',
  export: 'Export',
  import: 'Import',
  utility: 'Utilities'
};

const categoryIcons: Record<PluginCategory, string> = {
  all: '📦',
  filter: '🎨',
  adjustment: '⚙️',
  tool: '🛠️',
  export: '📤',
  import: '📥',
  utility: '🔧'
};

export function PluginManagerDialog({ isOpen, onClose }: PluginManagerDialogProps) {
  const [plugins, setPlugins] = useState<PluginMetadata[]>([]);
  const [activePlugins, setActivePlugins] = useState<PluginMetadata[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<PluginCategory>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTab, setSelectedTab] = useState<'installed' | 'available'>('installed');

  const loadPlugins = () => {
    const allPlugins = pluginSystem.getPlugins();
    const active = pluginSystem.getActivePlugins();
    setPlugins(allPlugins);
    setActivePlugins(active);
    logger.info(`Loaded ${allPlugins.length} plugins, ${active.length} active`);
  };

  useEffect(() => {
    if (isOpen) {
      const timeoutId = setTimeout(() => loadPlugins(), 0);
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen]);

  const initializeExamplePlugins = async () => {
    const examplePlugins = createExamplePlugins();
    let loadedCount = 0;

    for (const manifest of examplePlugins) {
      const success = await pluginSystem.loadPlugin(manifest);
      if (success) loadedCount++;
    }

    loadPlugins();
    logger.info(`Initialized ${loadedCount} example plugins`);
  };

  const filteredPlugins = plugins.filter(plugin => {
    const matchesCategory = selectedCategory === 'all' || plugin.category === selectedCategory;
    const matchesSearch = plugin.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         plugin.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         plugin.author.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const isPluginActive = (pluginId: string): boolean => {
    return activePlugins.some(p => p.id === pluginId);
  };

  const handleTogglePlugin = async (pluginId: string) => {
    const isActive = isPluginActive(pluginId);

    try {
      if (isActive) {
        await pluginSystem.deactivatePlugin(pluginId);
        logger.info(`Deactivated plugin: ${pluginId}`);
      } else {
        await pluginSystem.activatePlugin(pluginId);
        logger.info(`Activated plugin: ${pluginId}`);
      }
      loadPlugins();
    } catch (error) {
      logger.error(`Failed to toggle plugin ${pluginId}:`, error);
    }
  };

  const handleUnloadPlugin = async (pluginId: string) => {
    try {
      await pluginSystem.unloadPlugin(pluginId);
      loadPlugins();
      logger.info(`Unloaded plugin: ${pluginId}`);
    } catch (error) {
      logger.error(`Failed to unload plugin ${pluginId}:`, error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
      <div className="rounded-lg shadow-xl w-5/6 max-w-6xl h-4/5 max-h-screen flex flex-col" style={{ backgroundColor: 'var(--gray-900)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderBottomColor: 'var(--border)' }}>
          <div className="flex items-center space-x-3">
            <Package className="w-5 h-5" style={{ color: 'var(--gray-300)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--white)' }}>Plugin Manager</h2>
          </div>
          <div className="flex items-center space-x-2">
            {plugins.length === 0 && (
              <button
                onClick={initializeExamplePlugins}
                className="px-3 py-1.5 text-sm rounded border transition-colors"
                style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}
              >
                Load Examples
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded transition-colors"
              style={{ color: 'var(--gray-400)' }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b" style={{ borderBottomColor: 'var(--border)' }}>
          <button
            onClick={() => setSelectedTab('installed')}
            className="px-6 py-3 text-sm font-semibold transition-colors border-b-2"
            style={{
              color: selectedTab === 'installed' ? 'var(--gray-200)' : 'var(--gray-500)',
              borderBottomColor: selectedTab === 'installed' ? 'var(--gray-400)' : 'transparent'
            }}
          >
            Installed ({plugins.length})
          </button>
          <button
            onClick={() => setSelectedTab('available')}
            className="px-6 py-3 text-sm font-semibold transition-colors border-b-2"
            style={{
              color: selectedTab === 'available' ? 'var(--gray-200)' : 'var(--gray-500)',
              borderBottomColor: selectedTab === 'available' ? 'var(--gray-400)' : 'transparent'
            }}
          >
            Available
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left Sidebar - Categories */}
          <div className="w-64 border-r p-4" style={{ borderRightColor: 'var(--border)' }}>
            <div className="mb-4">
              <div className="relative flex items-center">
                <Search className="absolute left-2 w-4 h-4" style={{ color: 'var(--gray-500)' }} />
                <input
                  type="text"
                  placeholder="Search plugins..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-2 py-1.5 text-sm rounded border focus:outline-none"
                  style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-200)' }}
                />
              </div>
            </div>

            <div className="space-y-1">
              {Object.entries(categoryNames).map(([category, name]) => {
                const count = category === 'all'
                  ? plugins.length
                  : plugins.filter(p => p.category === category).length;

                return (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category as PluginCategory)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded text-sm transition-colors"
                    style={{
                      backgroundColor: selectedCategory === category ? 'var(--gray-800)' : 'transparent',
                      color: selectedCategory === category ? 'var(--white)' : 'var(--gray-400)'
                    }}
                  >
                    <div className="flex items-center space-x-2">
                      <span>{categoryIcons[category as PluginCategory]}</span>
                      <span>{name}</span>
                    </div>
                    <span className="text-xs opacity-75">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 px-5 py-4 overflow-y-auto">
            {selectedTab === 'installed' ? (
              <div className="space-y-4">
                {filteredPlugins.length > 0 ? (
                  filteredPlugins.map((plugin) => (
                    <div
                      key={plugin.id}
                      className="rounded-lg p-5 border"
                      style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          {/* Plugin Header */}
                          <div className="flex items-center space-x-4 mb-3">
                            <div className="w-12 h-12 rounded-lg flex items-center justify-center border" style={{ backgroundColor: 'var(--gray-900)', borderColor: 'var(--border)' }}>
                              <span className="text-2xl">{categoryIcons[plugin.category]}</span>
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center space-x-2 mb-1">
                                <h3 className="text-sm font-semibold" style={{ color: 'var(--gray-200)' }}>{plugin.name}</h3>
                                <span className="text-xs px-1.5 py-0.5 rounded border" style={{ backgroundColor: 'var(--gray-900)', borderColor: 'var(--border)', color: 'var(--gray-400)' }}>
                                  v{plugin.version}
                                </span>
                                {isPluginActive(plugin.id) && (
                                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--gray-700)', color: 'var(--gray-200)' }}>
                                    Active
                                  </span>
                                )}
                              </div>
                              <p className="text-xs" style={{ color: 'var(--gray-400)' }}>{plugin.description}</p>
                              <div className="flex items-center space-x-2 mt-1.5">
                                <span className="text-xs" style={{ color: 'var(--gray-500)' }}>by {plugin.author}</span>
                                {plugin.website && (
                                  <a
                                    href={plugin.website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs transition-colors"
                                    style={{ color: 'var(--gray-400)' }}
                                  >
                                    <ExternalLink className="w-3 h-3 inline" />
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Permissions */}
                          <div className="mb-1">
                            <div className="flex items-center space-x-1.5 mb-1.5">
                              <Shield className="w-3.5 h-3.5" style={{ color: 'var(--gray-500)' }} />
                              <span className="text-xs" style={{ color: 'var(--gray-500)' }}>Permissions:</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {plugin.permissions.map((permission) => (
                                <span
                                  key={permission}
                                  className="text-xs px-1.5 py-0.5 rounded border"
                                  style={{ backgroundColor: 'var(--gray-900)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}
                                >
                                  {permission}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Plugin Actions */}
                        <div className="flex flex-col space-y-2 ml-4">
                          <button
                            onClick={() => handleTogglePlugin(plugin.id)}
                            className="flex items-center space-x-1.5 px-3 py-1.5 rounded text-sm border transition-colors"
                            style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}
                          >
                            {isPluginActive(plugin.id) ? (
                              <>
                                <Square className="w-3.5 h-3.5" />
                                <span>Deactivate</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5" />
                                <span>Activate</span>
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => handleUnloadPlugin(plugin.id)}
                            className="flex items-center justify-center space-x-1.5 px-3 py-1.5 rounded text-sm transition-colors border"
                            style={{ backgroundColor: 'transparent', borderColor: 'transparent', color: 'var(--gray-400)' }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Unload</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center mt-12" style={{ color: 'var(--gray-500)' }}>
                    <Package className="w-10 h-10 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">No plugins found</p>
                    <p className="text-xs mt-1">Try adjusting your search or load example plugins</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center mt-12" style={{ color: 'var(--gray-500)' }}>
                <Download className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">Plugin Store Coming Soon</p>
                <p className="text-xs mt-1">Browse and install plugins from the community</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Stats */}
        <div className="p-4 border-t" style={{ borderTopColor: 'var(--border)' }}>
          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--gray-400)' }}>
            <div className="flex items-center space-x-4">
              <span>📊 {plugins.length} total plugins</span>
              <span>✅ {activePlugins.length} active</span>
            </div>
            <div className="flex items-center space-x-2">
              <span>System memory usage: </span>
              <span style={{ color: 'var(--gray-300)' }}>
                {typeof (performance as PerformanceWithMemory).memory !== 'undefined'
                  ? `${((performance as PerformanceWithMemory).memory!.usedJSHeapSize / 1024 / 1024).toFixed(1)} MB`
                  : 'N/A'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
