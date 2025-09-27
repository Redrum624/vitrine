export interface PanelConfig {
  id: string;
  type: 'adjustment' | 'histogram' | 'navigator' | 'layers' | 'history' | 'metadata' | 'tools' | 'custom';
  title: string;
  position: 'left' | 'right' | 'bottom' | 'top' | 'floating';
  size: {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
  };
  isCollapsed: boolean;
  isVisible: boolean;
  isResizable: boolean;
  isDockable: boolean;
  order: number;
  content?: unknown;
  customComponent?: string;
}

export interface WorkspaceLayout {
  id: string;
  name: string;
  description: string;
  category: 'photo' | 'raw' | 'retouch' | 'print' | 'custom';
  panels: PanelConfig[];
  canvasArea: {
    centerPanel: boolean;
    showRulers: boolean;
    showGrid: boolean;
    backgroundColor: string;
  };
  isDefault?: boolean;
}

export interface WorkspacePreset {
  id: string;
  name: string;
  description: string;
  category: string;
  layout: WorkspaceLayout;
  thumbnail?: string;
  isBuiltIn: boolean;
}

export interface DragDropState {
  isDragging: boolean;
  draggedPanel?: PanelConfig;
  dropZone?: string;
  dropPosition?: 'before' | 'after' | 'inside';
  allowedDropZones: string[];
}

export interface PanelGroup {
  id: string;
  position: 'left' | 'right' | 'bottom' | 'top';
  width?: number;
  height?: number;
  panels: PanelConfig[];
  isCollapsed: boolean;
}

export interface WorkspaceState {
  currentLayout: WorkspaceLayout;
  panelGroups: Map<string, PanelGroup>;
  dragDropState: DragDropState;
  settings: {
    enablePanelAnimations: boolean;
    autoCollapsePanels: boolean;
    rememberPanelSizes: boolean;
    snapToGrid: boolean;
    gridSize: number;
  };
}

class WorkspaceService {
  private static instance: WorkspaceService;
  private state: WorkspaceState;
  private presets: Map<string, WorkspacePreset> = new Map();
  private observers: Set<(state: WorkspaceState) => void> = new Set();
  private customLayouts: Map<string, WorkspaceLayout> = new Map();

  private constructor() {
    this.state = this.createDefaultState();
    this.initializePresets();
    this.loadPersistedWorkspace();
  }

  static getInstance(): WorkspaceService {
    if (!WorkspaceService.instance) {
      WorkspaceService.instance = new WorkspaceService();
    }
    return WorkspaceService.instance;
  }

  private createDefaultState(): WorkspaceState {
    const defaultLayout = this.createDefaultLayout();

    return {
      currentLayout: defaultLayout,
      panelGroups: new Map([
        ['left', {
          id: 'left',
          position: 'left',
          width: 300,
          panels: [],
          isCollapsed: false
        }],
        ['right', {
          id: 'right',
          position: 'right',
          width: 350,
          panels: [],
          isCollapsed: false
        }],
        ['bottom', {
          id: 'bottom',
          position: 'bottom',
          height: 200,
          panels: [],
          isCollapsed: false
        }]
      ]),
      dragDropState: {
        isDragging: false,
        allowedDropZones: []
      },
      settings: {
        enablePanelAnimations: true,
        autoCollapsePanels: false,
        rememberPanelSizes: true,
        snapToGrid: false,
        gridSize: 10
      }
    };
  }

  private createDefaultLayout(): WorkspaceLayout {
    return {
      id: 'default-photo',
      name: 'Photo Editing',
      description: 'Standard layout for photo editing workflow',
      category: 'photo',
      panels: [
        {
          id: 'navigator',
          type: 'navigator',
          title: 'Navigator',
          position: 'left',
          size: { width: 300, height: 200, minHeight: 150 },
          isCollapsed: false,
          isVisible: true,
          isResizable: true,
          isDockable: true,
          order: 0
        },
        {
          id: 'histogram',
          type: 'histogram',
          title: 'Histogram',
          position: 'left',
          size: { width: 300, height: 250, minHeight: 200 },
          isCollapsed: false,
          isVisible: true,
          isResizable: true,
          isDockable: true,
          order: 1
        },
        {
          id: 'adjustments',
          type: 'adjustment',
          title: 'Adjustments',
          position: 'right',
          size: { width: 350, height: 400, minHeight: 300 },
          isCollapsed: false,
          isVisible: true,
          isResizable: true,
          isDockable: true,
          order: 0
        },
        {
          id: 'layers',
          type: 'layers',
          title: 'Layers',
          position: 'right',
          size: { width: 350, height: 300, minHeight: 200 },
          isCollapsed: false,
          isVisible: true,
          isResizable: true,
          isDockable: true,
          order: 1
        },
        {
          id: 'history',
          type: 'history',
          title: 'History',
          position: 'bottom',
          size: { height: 200, minHeight: 150 },
          isCollapsed: false,
          isVisible: true,
          isResizable: true,
          isDockable: true,
          order: 0
        }
      ],
      canvasArea: {
        centerPanel: true,
        showRulers: false,
        showGrid: false,
        backgroundColor: '#1e293b'
      },
      isDefault: true
    };
  }

  private initializePresets(): void {
    // Photo Editing Layout
    const photoLayout: WorkspaceLayout = this.createDefaultLayout();

    // RAW Processing Layout
    const rawLayout: WorkspaceLayout = {
      id: 'raw-processing',
      name: 'RAW Processing',
      description: 'Optimized layout for RAW image processing',
      category: 'raw',
      panels: [
        {
          id: 'raw-histogram',
          type: 'histogram',
          title: 'RAW Histogram',
          position: 'left',
          size: { width: 300, height: 300, minHeight: 250 },
          isCollapsed: false,
          isVisible: true,
          isResizable: true,
          isDockable: true,
          order: 0
        },
        {
          id: 'camera-settings',
          type: 'metadata',
          title: 'Camera Settings',
          position: 'left',
          size: { width: 300, height: 250, minHeight: 200 },
          isCollapsed: false,
          isVisible: true,
          isResizable: true,
          isDockable: true,
          order: 1
        },
        {
          id: 'raw-adjustments',
          type: 'adjustment',
          title: 'RAW Adjustments',
          position: 'right',
          size: { width: 400, height: 500, minHeight: 400 },
          isCollapsed: false,
          isVisible: true,
          isResizable: true,
          isDockable: true,
          order: 0
        },
        {
          id: 'noise-reduction',
          type: 'adjustment',
          title: 'Noise Reduction',
          position: 'right',
          size: { width: 400, height: 300, minHeight: 250 },
          isCollapsed: false,
          isVisible: true,
          isResizable: true,
          isDockable: true,
          order: 1
        }
      ],
      canvasArea: {
        centerPanel: true,
        showRulers: true,
        showGrid: false,
        backgroundColor: '#0f172a'
      }
    };

    // Retouching Layout
    const retouchLayout: WorkspaceLayout = {
      id: 'retouching',
      name: 'Retouching',
      description: 'Layout optimized for detailed retouching work',
      category: 'retouch',
      panels: [
        {
          id: 'tools',
          type: 'tools',
          title: 'Tools',
          position: 'left',
          size: { width: 250, height: 400, minHeight: 300 },
          isCollapsed: false,
          isVisible: true,
          isResizable: true,
          isDockable: true,
          order: 0
        },
        {
          id: 'navigator-zoom',
          type: 'navigator',
          title: 'Navigator',
          position: 'left',
          size: { width: 250, height: 200, minHeight: 150 },
          isCollapsed: false,
          isVisible: true,
          isResizable: true,
          isDockable: true,
          order: 1
        },
        {
          id: 'layers-masks',
          type: 'layers',
          title: 'Layers & Masks',
          position: 'right',
          size: { width: 350, height: 400, minHeight: 300 },
          isCollapsed: false,
          isVisible: true,
          isResizable: true,
          isDockable: true,
          order: 0
        },
        {
          id: 'spot-removal',
          type: 'adjustment',
          title: 'Spot Removal',
          position: 'right',
          size: { width: 350, height: 300, minHeight: 200 },
          isCollapsed: false,
          isVisible: true,
          isResizable: true,
          isDockable: true,
          order: 1
        },
        {
          id: 'history-detailed',
          type: 'history',
          title: 'History',
          position: 'bottom',
          size: { height: 180, minHeight: 120 },
          isCollapsed: false,
          isVisible: true,
          isResizable: true,
          isDockable: true,
          order: 0
        }
      ],
      canvasArea: {
        centerPanel: true,
        showRulers: true,
        showGrid: true,
        backgroundColor: '#1e293b'
      }
    };

    // Print Layout
    const printLayout: WorkspaceLayout = {
      id: 'print-workflow',
      name: 'Print Workflow',
      description: 'Layout for color-managed print preparation',
      category: 'print',
      panels: [
        {
          id: 'print-settings',
          type: 'adjustment',
          title: 'Print Settings',
          position: 'left',
          size: { width: 300, height: 350, minHeight: 250 },
          isCollapsed: false,
          isVisible: true,
          isResizable: true,
          isDockable: true,
          order: 0
        },
        {
          id: 'color-management',
          type: 'adjustment',
          title: 'Color Management',
          position: 'left',
          size: { width: 300, height: 250, minHeight: 200 },
          isCollapsed: false,
          isVisible: true,
          isResizable: true,
          isDockable: true,
          order: 1
        },
        {
          id: 'print-preview',
          type: 'custom',
          title: 'Print Preview',
          position: 'right',
          size: { width: 400, height: 500, minHeight: 400 },
          isCollapsed: false,
          isVisible: true,
          isResizable: true,
          isDockable: true,
          order: 0
        },
        {
          id: 'soft-proofing',
          type: 'histogram',
          title: 'Soft Proofing',
          position: 'right',
          size: { width: 400, height: 200, minHeight: 150 },
          isCollapsed: false,
          isVisible: true,
          isResizable: true,
          isDockable: true,
          order: 1
        }
      ],
      canvasArea: {
        centerPanel: true,
        showRulers: true,
        showGrid: false,
        backgroundColor: '#f8fafc'
      }
    };

    // Create presets
    this.presets.set('photo', {
      id: 'photo',
      name: 'Photo Editing',
      description: 'Standard layout for general photo editing',
      category: 'photo',
      layout: photoLayout,
      isBuiltIn: true
    });

    this.presets.set('raw', {
      id: 'raw',
      name: 'RAW Processing',
      description: 'Optimized for RAW image processing workflow',
      category: 'raw',
      layout: rawLayout,
      isBuiltIn: true
    });

    this.presets.set('retouch', {
      id: 'retouch',
      name: 'Retouching',
      description: 'Detailed retouching and healing work',
      category: 'retouch',
      layout: retouchLayout,
      isBuiltIn: true
    });

    this.presets.set('print', {
      id: 'print',
      name: 'Print Workflow',
      description: 'Color-managed print preparation',
      category: 'print',
      layout: printLayout,
      isBuiltIn: true
    });
  }

  setLayout(layoutId: string): void {
    const preset = this.presets.get(layoutId);
    const customLayout = this.customLayouts.get(layoutId);

    const layout = preset?.layout || customLayout;
    if (!layout) {
      console.warn(`Layout '${layoutId}' not found`);
      return;
    }

    this.state.currentLayout = layout;
    this.updatePanelGroups(layout);
    this.persistWorkspace();
    this.notifyObservers();
  }

  private updatePanelGroups(layout: WorkspaceLayout): void {
    // Clear existing groups
    this.state.panelGroups.forEach(group => {
      group.panels = [];
    });

    // Organize panels by position
    layout.panels.forEach(panel => {
      const group = this.state.panelGroups.get(panel.position);
      if (group) {
        group.panels.push(panel);
      }
    });

    // Sort panels by order within each group
    this.state.panelGroups.forEach(group => {
      group.panels.sort((a, b) => a.order - b.order);
    });
  }

  addPanel(panel: PanelConfig): void {
    this.state.currentLayout.panels.push(panel);
    this.updatePanelGroups(this.state.currentLayout);
    this.persistWorkspace();
    this.notifyObservers();
  }

  removePanel(panelId: string): void {
    this.state.currentLayout.panels = this.state.currentLayout.panels.filter(
      panel => panel.id !== panelId
    );
    this.updatePanelGroups(this.state.currentLayout);
    this.persistWorkspace();
    this.notifyObservers();
  }

  updatePanel(panelId: string, updates: Partial<PanelConfig>): void {
    const panel = this.state.currentLayout.panels.find(p => p.id === panelId);
    if (panel) {
      Object.assign(panel, updates);
      this.updatePanelGroups(this.state.currentLayout);
      this.persistWorkspace();
      this.notifyObservers();
    }
  }

  movePanel(panelId: string, newPosition: PanelConfig['position'], newOrder?: number): void {
    const panel = this.state.currentLayout.panels.find(p => p.id === panelId);
    if (!panel) return;

    panel.position = newPosition;

    if (newOrder !== undefined) {
      panel.order = newOrder;
    } else {
      // Auto-assign order
      const panelsInPosition = this.state.currentLayout.panels.filter(
        p => p.position === newPosition && p.id !== panelId
      );
      panel.order = panelsInPosition.length;
    }

    this.updatePanelGroups(this.state.currentLayout);
    this.persistWorkspace();
    this.notifyObservers();
  }

  resizePanel(panelId: string, size: Partial<PanelConfig['size']>): void {
    const panel = this.state.currentLayout.panels.find(p => p.id === panelId);
    if (panel) {
      panel.size = { ...panel.size, ...size };
      this.persistWorkspace();
      this.notifyObservers();
    }
  }

  togglePanelCollapse(panelId: string): void {
    const panel = this.state.currentLayout.panels.find(p => p.id === panelId);
    if (panel) {
      panel.isCollapsed = !panel.isCollapsed;
      this.persistWorkspace();
      this.notifyObservers();
    }
  }

  togglePanelVisibility(panelId: string): void {
    const panel = this.state.currentLayout.panels.find(p => p.id === panelId);
    if (panel) {
      panel.isVisible = !panel.isVisible;
      this.updatePanelGroups(this.state.currentLayout);
      this.persistWorkspace();
      this.notifyObservers();
    }
  }

  startDrag(panelId: string): void {
    const panel = this.state.currentLayout.panels.find(p => p.id === panelId);
    if (panel && panel.isDockable) {
      this.state.dragDropState = {
        isDragging: true,
        draggedPanel: panel,
        allowedDropZones: ['left', 'right', 'bottom', 'top', 'floating']
      };
      this.notifyObservers();
    }
  }

  updateDragState(dropZone?: string, dropPosition?: 'before' | 'after' | 'inside'): void {
    this.state.dragDropState.dropZone = dropZone;
    this.state.dragDropState.dropPosition = dropPosition;
    this.notifyObservers();
  }

  completeDrop(): void {
    const { draggedPanel, dropZone, dropPosition: _dropPosition } = this.state.dragDropState;

    if (draggedPanel && dropZone) {
      if (dropZone === 'floating') {
        // Handle floating panel logic
        draggedPanel.position = 'floating';
      } else {
        this.movePanel(draggedPanel.id, dropZone as PanelConfig['position']);
      }
    }

    this.cancelDrag();
  }

  cancelDrag(): void {
    this.state.dragDropState = {
      isDragging: false,
      allowedDropZones: []
    };
    this.notifyObservers();
  }

  saveLayoutAsPreset(name: string, description: string, category: string = 'custom'): string {
    const presetId = `custom-${Date.now()}`;
    const layoutCopy: WorkspaceLayout = JSON.parse(JSON.stringify(this.state.currentLayout));
    layoutCopy.id = presetId;
    layoutCopy.name = name;
    layoutCopy.description = description;
    layoutCopy.category = category as 'photo' | 'raw' | 'retouch' | 'print' | 'custom';

    const preset: WorkspacePreset = {
      id: presetId,
      name,
      description,
      category,
      layout: layoutCopy,
      isBuiltIn: false
    };

    this.presets.set(presetId, preset);
    this.customLayouts.set(presetId, layoutCopy);
    this.persistCustomLayouts();

    return presetId;
  }

  deleteCustomPreset(presetId: string): void {
    const preset = this.presets.get(presetId);
    if (preset && !preset.isBuiltIn) {
      this.presets.delete(presetId);
      this.customLayouts.delete(presetId);
      this.persistCustomLayouts();
    }
  }

  resetToDefault(): void {
    const defaultPreset = this.presets.get('photo');
    if (defaultPreset) {
      this.setLayout('photo');
    }
  }

  updateSettings(settings: Partial<WorkspaceState['settings']>): void {
    this.state.settings = { ...this.state.settings, ...settings };
    this.persistWorkspace();
    this.notifyObservers();
  }

  getPresets(): WorkspacePreset[] {
    return Array.from(this.presets.values());
  }

  getPresetsByCategory(category: string): WorkspacePreset[] {
    return Array.from(this.presets.values()).filter(preset => preset.category === category);
  }

  getCurrentState(): WorkspaceState {
    return this.state;
  }

  private persistWorkspace(): void {
    try {
      const dataToSave = {
        currentLayoutId: this.state.currentLayout.id,
        panels: this.state.currentLayout.panels,
        settings: this.state.settings
      };
      localStorage.setItem('photo-editor-workspace', JSON.stringify(dataToSave));
    } catch (error) {
      console.warn('Failed to persist workspace:', error);
    }
  }

  private persistCustomLayouts(): void {
    try {
      const customLayoutsArray = Array.from(this.customLayouts.entries());
      localStorage.setItem('photo-editor-custom-layouts', JSON.stringify(customLayoutsArray));
    } catch (error) {
      console.warn('Failed to persist custom layouts:', error);
    }
  }

  private loadPersistedWorkspace(): void {
    try {
      // Load custom layouts first
      const customLayoutsData = localStorage.getItem('photo-editor-custom-layouts');
      if (customLayoutsData) {
        const customLayoutsArray = JSON.parse(customLayoutsData);
        this.customLayouts = new Map(customLayoutsArray);

        // Add custom layouts to presets
        this.customLayouts.forEach((layout, id) => {
          this.presets.set(id, {
            id,
            name: layout.name,
            description: layout.description,
            category: layout.category,
            layout,
            isBuiltIn: false
          });
        });
      }

      // Load workspace settings
      const workspaceData = localStorage.getItem('photo-editor-workspace');
      if (workspaceData) {
        const parsed = JSON.parse(workspaceData);

        if (parsed.settings) {
          this.state.settings = { ...this.state.settings, ...parsed.settings };
        }

        if (parsed.currentLayoutId) {
          this.setLayout(parsed.currentLayoutId);
        }

        if (parsed.panels && Array.isArray(parsed.panels)) {
          this.state.currentLayout.panels = parsed.panels;
          this.updatePanelGroups(this.state.currentLayout);
        }
      }
    } catch (error) {
      console.warn('Failed to load persisted workspace:', error);
    }
  }

  subscribe(callback: (state: WorkspaceState) => void): () => void {
    this.observers.add(callback);

    // Call immediately with current state
    callback(this.state);

    // Return unsubscribe function
    return () => {
      this.observers.delete(callback);
    };
  }

  private notifyObservers(): void {
    this.observers.forEach(callback => {
      try {
        callback(this.state);
      } catch (error) {
        console.error('Error in workspace observer:', error);
      }
    });
  }

  exportLayout(layoutId?: string): string {
    const layout = layoutId ?
      (this.presets.get(layoutId)?.layout || this.customLayouts.get(layoutId)) :
      this.state.currentLayout;

    if (!layout) {
      throw new Error('Layout not found');
    }

    return JSON.stringify(layout, null, 2);
  }

  importLayout(layoutJson: string): string {
    try {
      const layout = JSON.parse(layoutJson) as WorkspaceLayout;

      // Validate layout structure
      if (!layout.id || !layout.name || !Array.isArray(layout.panels)) {
        throw new Error('Invalid layout structure');
      }

      // Generate new ID to avoid conflicts
      const newId = `imported-${Date.now()}`;
      layout.id = newId;

      this.customLayouts.set(newId, layout);
      this.presets.set(newId, {
        id: newId,
        name: layout.name,
        description: layout.description || 'Imported layout',
        category: layout.category || 'custom',
        layout,
        isBuiltIn: false
      });

      this.persistCustomLayouts();
      return newId;
    } catch {
      throw new Error('Failed to import layout: Invalid JSON or layout structure');
    }
  }

  dispose(): void {
    this.observers.clear();
  }
}

export default WorkspaceService;