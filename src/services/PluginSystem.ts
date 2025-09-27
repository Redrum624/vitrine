import { logger } from '../utils/Logger';

interface ProcessingModule {
  getName(): string;
  id: string;
  [key: string]: unknown;
}

// Plugin API interfaces
export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  website?: string;
  icon?: string;
  category: 'filter' | 'adjustment' | 'tool' | 'export' | 'import' | 'utility';
  compatibility: string[]; // Supported app versions
  permissions: PluginPermission[];
}

export type PluginPermission =
  | 'read-image'
  | 'write-image'
  | 'file-system'
  | 'network'
  | 'ui-modification'
  | 'preferences'
  | 'processing-pipeline';

export interface PluginAPI {
  // Image processing
  getCurrentImage: () => Float32Array | null;
  setProcessedImage: (data: Float32Array) => void;
  getImageDimensions: () => { width: number; height: number } | null;

  // UI integration
  addMenuItem: (menu: string, label: string, action: () => void) => string;
  removeMenuItem: (id: string) => void;
  showNotification: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
  addToolbarButton: (icon: string, tooltip: string, action: () => void) => string;

  // Processing pipeline
  addProcessingModule: (module: ProcessingModule) => void;
  removeProcessingModule: (moduleId: string) => void;

  // Preferences
  getPreference: (key: string) => unknown;
  setPreference: (key: string, value: unknown) => void;

  // File operations
  openFile: (filters?: string[]) => Promise<string | null>;
  saveFile: (data: Uint8Array, filename: string) => Promise<boolean>;
}

export interface Plugin {
  metadata: PluginMetadata;
  activate: (api: PluginAPI) => Promise<void>;
  deactivate: () => Promise<void>;
  onImageLoad?: (imageData: Float32Array, width: number, height: number) => void;
  onImageProcess?: (imageData: Float32Array) => Float32Array | Promise<Float32Array>;
  onExport?: (imageData: Float32Array, format: string) => Uint8Array | Promise<Uint8Array>;
}

export interface PluginManifest {
  metadata: PluginMetadata;
  main: string; // Entry point file
  files: string[]; // Plugin files
}

export class PluginSystem {
  private plugins: Map<string, Plugin> = new Map();
  private activePlugins: Set<string> = new Set();
  private api: PluginAPI;
  private pluginDirectories: string[] = [];

  constructor() {
    this.api = this.createPluginAPI();
    logger.info('Plugin system initialized');
  }

  // Create the plugin API that will be exposed to plugins
  private createPluginAPI(): PluginAPI {
    return {
      // Image processing methods
      getCurrentImage: () => {
        // Would integrate with ImageService
        return null; // Placeholder
      },

      setProcessedImage: (_data: Float32Array) => {
        logger.debug('Plugin set processed image data');
        // Would integrate with image processing pipeline
      },

      getImageDimensions: () => {
        // Would integrate with ImageService
        return null; // Placeholder
      },

      // UI integration methods
      addMenuItem: (menu: string, label: string, _action: () => void) => {
        const id = `plugin-menu-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        logger.info(`Plugin added menu item: ${menu} -> ${label}`);
        // Would integrate with menu system
        return id;
      },

      removeMenuItem: (id: string) => {
        logger.info(`Plugin removed menu item: ${id}`);
        // Would integrate with menu system
      },

      showNotification: (type, title, message) => {
        logger.info(`Plugin notification: [${type}] ${title}: ${message}`);
        // Would integrate with notification system
      },

      addToolbarButton: (_icon: string, tooltip: string, _action: () => void) => {
        const id = `plugin-toolbar-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        logger.info(`Plugin added toolbar button: ${tooltip}`);
        // Would integrate with toolbar
        return id;
      },

      // Processing pipeline methods
      addProcessingModule: (module: ProcessingModule) => {
        logger.info(`Plugin added processing module: ${module.getName?.() || 'unknown'}`);
        // Would integrate with ImageProcessingPipeline
      },

      removeProcessingModule: (moduleId: string) => {
        logger.info(`Plugin removed processing module: ${moduleId}`);
        // Would integrate with ImageProcessingPipeline
      },

      // Preferences methods
      getPreference: (key: string) => {
        const value = localStorage.getItem(`plugin-pref-${key}`);
        return value ? JSON.parse(value) : null;
      },

      setPreference: (key: string, value: unknown) => {
        localStorage.setItem(`plugin-pref-${key}`, JSON.stringify(value));
      },

      // File operation methods
      openFile: async (filters?: string[]) => {
        logger.info('Plugin requested file open', filters);
        // Would integrate with file system
        return null; // Placeholder
      },

      saveFile: async (_data: Uint8Array, filename: string) => {
        logger.info(`Plugin requested file save: ${filename}`);
        // Would integrate with file system
        return false; // Placeholder
      }
    };
  }

  // Register a plugin directory to scan for plugins
  addPluginDirectory(path: string): void {
    if (!this.pluginDirectories.includes(path)) {
      this.pluginDirectories.push(path);
      logger.info(`Added plugin directory: ${path}`);
    }
  }

  // Load plugin from manifest
  async loadPlugin(manifest: PluginManifest): Promise<boolean> {
    try {
      // Validate plugin metadata
      if (!this.validatePlugin(manifest)) {
        logger.error(`Invalid plugin manifest: ${manifest.metadata.id}`);
        return false;
      }

      // Check if plugin already exists
      if (this.plugins.has(manifest.metadata.id)) {
        logger.warn(`Plugin already loaded: ${manifest.metadata.id}`);
        return false;
      }

      // Create plugin instance (would load from file in real implementation)
      const plugin: Plugin = {
        metadata: manifest.metadata,
        activate: async (_api: PluginAPI) => {
          logger.info(`Activating plugin: ${manifest.metadata.name}`);
          // Plugin activation logic would go here
        },
        deactivate: async () => {
          logger.info(`Deactivating plugin: ${manifest.metadata.name}`);
          // Plugin deactivation logic would go here
        }
      };

      this.plugins.set(manifest.metadata.id, plugin);
      logger.info(`Plugin loaded: ${manifest.metadata.name} v${manifest.metadata.version}`);
      return true;

    } catch (error) {
      logger.error(`Failed to load plugin ${manifest.metadata.id}:`, error);
      return false;
    }
  }

  // Activate a plugin
  async activatePlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      logger.error(`Plugin not found: ${pluginId}`);
      return false;
    }

    if (this.activePlugins.has(pluginId)) {
      logger.warn(`Plugin already active: ${pluginId}`);
      return true;
    }

    try {
      await plugin.activate(this.api);
      this.activePlugins.add(pluginId);
      logger.info(`Plugin activated: ${plugin.metadata.name}`);
      return true;
    } catch (error) {
      logger.error(`Failed to activate plugin ${pluginId}:`, error);
      return false;
    }
  }

  // Deactivate a plugin
  async deactivatePlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      logger.error(`Plugin not found: ${pluginId}`);
      return false;
    }

    if (!this.activePlugins.has(pluginId)) {
      logger.warn(`Plugin not active: ${pluginId}`);
      return true;
    }

    try {
      await plugin.deactivate();
      this.activePlugins.delete(pluginId);
      logger.info(`Plugin deactivated: ${plugin.metadata.name}`);
      return true;
    } catch (error) {
      logger.error(`Failed to deactivate plugin ${pluginId}:`, error);
      return false;
    }
  }

  // Unload a plugin
  async unloadPlugin(pluginId: string): Promise<boolean> {
    // Deactivate first if active
    if (this.activePlugins.has(pluginId)) {
      await this.deactivatePlugin(pluginId);
    }

    const plugin = this.plugins.get(pluginId);
    if (plugin) {
      this.plugins.delete(pluginId);
      logger.info(`Plugin unloaded: ${plugin.metadata.name}`);
      return true;
    }

    return false;
  }

  // Get all loaded plugins
  getPlugins(): PluginMetadata[] {
    return Array.from(this.plugins.values()).map(plugin => plugin.metadata);
  }

  // Get active plugins
  getActivePlugins(): PluginMetadata[] {
    return Array.from(this.activePlugins)
      .map(id => this.plugins.get(id))
      .filter(plugin => plugin !== undefined)
      .map(plugin => plugin!.metadata);
  }

  // Get plugin by ID
  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }

  // Check if plugin is active
  isPluginActive(pluginId: string): boolean {
    return this.activePlugins.has(pluginId);
  }

  // Validate plugin manifest
  private validatePlugin(manifest: PluginManifest): boolean {
    const { metadata } = manifest;

    // Check required fields
    if (!metadata.id || !metadata.name || !metadata.version) {
      logger.error('Plugin missing required metadata fields');
      return false;
    }

    // Validate version format
    if (!/^\d+\.\d+\.\d+/.test(metadata.version)) {
      logger.error('Plugin version must follow semver format');
      return false;
    }

    // Check permissions
    const validPermissions: PluginPermission[] = [
      'read-image', 'write-image', 'file-system', 'network',
      'ui-modification', 'preferences', 'processing-pipeline'
    ];

    for (const permission of metadata.permissions) {
      if (!validPermissions.includes(permission)) {
        logger.error(`Invalid plugin permission: ${permission}`);
        return false;
      }
    }

    return true;
  }

  // Plugin event handlers
  onImageLoad(imageData: Float32Array, width: number, height: number): void {
    for (const pluginId of this.activePlugins) {
      const plugin = this.plugins.get(pluginId);
      if (plugin?.onImageLoad) {
        try {
          plugin.onImageLoad(imageData, width, height);
        } catch (error) {
          logger.error(`Plugin ${pluginId} image load handler failed:`, error);
        }
      }
    }
  }

  async onImageProcess(imageData: Float32Array): Promise<Float32Array> {
    let processedData = imageData;

    for (const pluginId of this.activePlugins) {
      const plugin = this.plugins.get(pluginId);
      if (plugin?.onImageProcess) {
        try {
          const result = await plugin.onImageProcess(processedData);
          processedData = result;
        } catch (error) {
          logger.error(`Plugin ${pluginId} image process handler failed:`, error);
        }
      }
    }

    return processedData;
  }

  async onExport(_imageData: Float32Array, _format: string): Promise<Uint8Array> {
    // Default export implementation would go here
    // For now, return empty array as placeholder
    return new Uint8Array();
  }

  // Get plugin statistics
  getStatistics(): {
    totalPlugins: number;
    activePlugins: number;
    pluginsByCategory: Record<string, number>;
  } {
    const plugins = Array.from(this.plugins.values());
    const pluginsByCategory: Record<string, number> = {};

    plugins.forEach(plugin => {
      const category = plugin.metadata.category;
      pluginsByCategory[category] = (pluginsByCategory[category] || 0) + 1;
    });

    return {
      totalPlugins: plugins.length,
      activePlugins: this.activePlugins.size,
      pluginsByCategory
    };
  }

  // Cleanup
  async destroy(): Promise<void> {
    // Deactivate all plugins
    for (const pluginId of Array.from(this.activePlugins)) {
      await this.deactivatePlugin(pluginId);
    }

    this.plugins.clear();
    this.activePlugins.clear();
    logger.info('Plugin system destroyed');
  }
}

// Built-in example plugins
export const createExamplePlugins = (): PluginManifest[] => [
  {
    metadata: {
      id: 'example.sepia-filter',
      name: 'Sepia Filter',
      version: '1.0.0',
      description: 'Adds a classic sepia tone effect to images',
      author: 'Photo Editor Pro',
      category: 'filter',
      compatibility: ['1.0.0'],
      permissions: ['read-image', 'write-image']
    },
    main: 'sepia-filter.js',
    files: ['sepia-filter.js']
  },
  {
    metadata: {
      id: 'example.instagram-export',
      name: 'Instagram Export',
      version: '1.0.0',
      description: 'Export images with Instagram-optimized settings',
      author: 'Photo Editor Pro',
      category: 'export',
      compatibility: ['1.0.0'],
      permissions: ['read-image', 'file-system']
    },
    main: 'instagram-export.js',
    files: ['instagram-export.js']
  },
  {
    metadata: {
      id: 'example.auto-enhance',
      name: 'Auto Enhance',
      version: '1.0.0',
      description: 'Automatically enhance images using AI algorithms',
      author: 'Photo Editor Pro',
      category: 'adjustment',
      compatibility: ['1.0.0'],
      permissions: ['read-image', 'write-image', 'processing-pipeline']
    },
    main: 'auto-enhance.js',
    files: ['auto-enhance.js', 'ai-models/enhance-model.wasm']
  }
];

// Export singleton
export const pluginSystem = new PluginSystem();