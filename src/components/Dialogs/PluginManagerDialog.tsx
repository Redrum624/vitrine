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

  // Load plugins on mount (use setTimeout to avoid synchronous setState in effect)
  useEffect(() => {
    if (isOpen) {
      const timeoutId = setTimeout(() => loadPlugins(), 0);
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen]);

  // Initialize with example plugins if none exist
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

  // Filter plugins based on category and search
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

  const getPermissionColor = (permission: string): string => {
    switch (permission) {
      case 'read-image':
      case 'write-image':
        return 'bg-blue-600';
      case 'file-system':
        return 'bg-yellow-600';
      case 'network':
        return 'bg-red-600';
      case 'ui-modification':
        return 'bg-purple-600';
      case 'preferences':
        return 'bg-green-600';
      case 'processing-pipeline':
        return 'bg-orange-600';
      default:
        return 'bg-gray-600';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-dark-800 rounded-lg shadow-xl w-5/6 max-w-6xl h-4/5 max-h-screen flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-dark-700">
          <div className="flex items-center space-x-3">
            <Package className="w-6 h-6 text-blue-400" />
            <h2 className="text-xl font-semibold text-dark-200">Plugin Manager</h2>
          </div>
          <div className="flex items-center space-x-2">
            {plugins.length === 0 && (
              <button
                onClick={initializeExamplePlugins}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm transition-colors"
              >
                Load Examples
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-dark-400 hover:text-dark-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-dark-700">
          <button
            onClick={() => setSelectedTab('installed')}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              selectedTab === 'installed'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-dark-400 hover:text-dark-200'
            }`}
          >
            Installed ({plugins.length})
          </button>
          <button
            onClick={() => setSelectedTab('available')}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              selectedTab === 'available'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-dark-400 hover:text-dark-200'
            }`}
          >
            Available
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left Sidebar - Categories */}
          <div className="w-64 border-r border-dark-700 p-4">
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-dark-400" />
                <input
                  type="text"
                  placeholder="Search plugins..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-dark-700 border border-dark-600 rounded-md text-dark-200 placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
                      selectedCategory === category
                        ? 'bg-blue-600 text-white'
                        : 'text-dark-300 hover:bg-dark-700'
                    }`}
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
          <div className="flex-1 p-6 overflow-y-auto">
            {selectedTab === 'installed' ? (
              <div className="space-y-4">
                {filteredPlugins.length > 0 ? (
                  filteredPlugins.map((plugin) => (
                    <div
                      key={plugin.id}
                      className="bg-dark-700 rounded-lg p-6 border border-dark-600 hover:border-dark-500 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          {/* Plugin Header */}
                          <div className="flex items-center space-x-3 mb-2">
                            <div className="w-12 h-12 bg-dark-600 rounded-lg flex items-center justify-center">
                              <span className="text-2xl">{categoryIcons[plugin.category]}</span>
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center space-x-2 mb-1">
                                <h3 className="text-lg font-semibold text-dark-200">{plugin.name}</h3>
                                <span className="text-xs text-dark-400 bg-dark-600 px-2 py-1 rounded">
                                  v{plugin.version}
                                </span>
                                {isPluginActive(plugin.id) && (
                                  <span className="text-xs text-green-400 bg-green-900 px-2 py-1 rounded">
                                    Active
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-dark-400">{plugin.description}</p>
                              <div className="flex items-center space-x-2 mt-1">
                                <span className="text-xs text-dark-500">by {plugin.author}</span>
                                {plugin.website && (
                                  <a
                                    href={plugin.website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-400 hover:text-blue-300"
                                  >
                                    <ExternalLink className="w-3 h-3 inline" />
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Permissions */}
                          <div className="mb-4">
                            <div className="flex items-center space-x-2 mb-2">
                              <Shield className="w-4 h-4 text-dark-400" />
                              <span className="text-sm text-dark-400">Permissions:</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {plugin.permissions.map((permission) => (
                                <span
                                  key={permission}
                                  className={`text-xs px-2 py-1 rounded text-white ${getPermissionColor(permission)}`}
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
                            className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm transition-colors ${
                              isPluginActive(plugin.id)
                                ? 'bg-red-600 hover:bg-red-700 text-white'
                                : 'bg-green-600 hover:bg-green-700 text-white'
                            }`}
                          >
                            {isPluginActive(plugin.id) ? (
                              <>
                                <Square className="w-4 h-4" />
                                <span>Deactivate</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-4 h-4" />
                                <span>Activate</span>
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => handleUnloadPlugin(plugin.id)}
                            className="flex items-center space-x-2 px-3 py-2 bg-dark-600 hover:bg-dark-500 text-dark-200 rounded-md text-sm transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                            <span>Unload</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-dark-400 mt-12">
                    <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p className="text-lg mb-2">No plugins found</p>
                    <p className="text-sm mt-1">Try adjusting your search or load example plugins</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-dark-400 mt-12">
                <Download className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg mb-2">Plugin Store Coming Soon</p>
                <p className="text-sm mt-1">Browse and install plugins from the community</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Stats */}
        <div className="p-4 border-t border-dark-700 bg-dark-750">
          <div className="flex items-center justify-between text-sm text-dark-400">
            <div className="flex items-center space-x-4">
              <span>📊 {plugins.length} total plugins</span>
              <span>✅ {activePlugins.length} active</span>
            </div>
            <div className="flex items-center space-x-2">
              <span>System memory usage: </span>
              <span className="text-dark-200">
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