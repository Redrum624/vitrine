export interface KeyboardShortcut {
  id: string;
  key: string;
  modifiers: ('ctrl' | 'alt' | 'shift' | 'meta')[];
  description: string;
  category: 'file' | 'edit' | 'view' | 'image' | 'tools' | 'panels' | 'navigation' | 'custom';
  action: string;
  context?: 'global' | 'canvas' | 'panel' | 'dialog';
  enabled: boolean;
  customizable: boolean;
}

export interface KeyboardWorkflow {
  id: string;
  name: string;
  description: string;
  shortcuts: KeyboardShortcut[];
  category: 'beginner' | 'professional' | 'photographer' | 'retoucher' | 'custom';
  isActive: boolean;
}

export interface KeySequence {
  keys: string[];
  timestamp: number;
  action?: string;
}

export interface WorkflowStats {
  totalShortcutsUsed: number;
  mostUsedShortcuts: Array<{ shortcut: KeyboardShortcut; count: number }>;
  averageActionsPerMinute: number;
  workflowEfficiency: number;
  customShortcuts: number;
}

export interface KeyboardSettings {
  enableShortcuts: boolean;
  showTooltips: boolean;
  enableSequences: boolean;
  enableWorkflowHints: boolean;
  conflictResolution: 'warn' | 'override' | 'disable';
  customModifierKey: 'ctrl' | 'alt' | 'meta';
}

class KeyboardWorkflowService {
  private static instance: KeyboardWorkflowService;
  private shortcuts: Map<string, KeyboardShortcut> = new Map();
  private workflows: Map<string, KeyboardWorkflow> = new Map();
  private activeWorkflow: KeyboardWorkflow | null = null;
  private keySequence: KeySequence[] = [];
  private settings: KeyboardSettings;
  private stats: WorkflowStats;
  private observers: Set<(action: string, data?: any) => void> = new Set();
  private shortcutUsage: Map<string, number> = new Map();
  private isListening = false;

  private constructor() {
    this.settings = this.createDefaultSettings();
    this.stats = this.createDefaultStats();
    this.initializeBuiltInShortcuts();
    this.initializeWorkflows();
    this.loadPersistedSettings();
    this.startKeyboardListener();
  }

  static getInstance(): KeyboardWorkflowService {
    if (!KeyboardWorkflowService.instance) {
      KeyboardWorkflowService.instance = new KeyboardWorkflowService();
    }
    return KeyboardWorkflowService.instance;
  }

  private createDefaultSettings(): KeyboardSettings {
    return {
      enableShortcuts: true,
      showTooltips: true,
      enableSequences: true,
      enableWorkflowHints: true,
      conflictResolution: 'warn',
      customModifierKey: 'ctrl'
    };
  }

  private createDefaultStats(): WorkflowStats {
    return {
      totalShortcutsUsed: 0,
      mostUsedShortcuts: [],
      averageActionsPerMinute: 0,
      workflowEfficiency: 0,
      customShortcuts: 0
    };
  }

  private initializeBuiltInShortcuts(): void {
    const builtInShortcuts: KeyboardShortcut[] = [
      // File operations
      { id: 'file.new', key: 'n', modifiers: ['ctrl'], description: 'New project', category: 'file', action: 'file.new', enabled: true, customizable: true },
      { id: 'file.open', key: 'o', modifiers: ['ctrl'], description: 'Open image', category: 'file', action: 'file.open', enabled: true, customizable: true },
      { id: 'file.save', key: 's', modifiers: ['ctrl'], description: 'Save project', category: 'file', action: 'file.save', enabled: true, customizable: true },
      { id: 'file.export', key: 'e', modifiers: ['ctrl'], description: 'Export image', category: 'file', action: 'file.export', enabled: true, customizable: true },
      { id: 'file.print', key: 'p', modifiers: ['ctrl'], description: 'Print image', category: 'file', action: 'file.print', enabled: true, customizable: true },

      // Edit operations
      { id: 'edit.undo', key: 'z', modifiers: ['ctrl'], description: 'Undo last action', category: 'edit', action: 'edit.undo', enabled: true, customizable: true },
      { id: 'edit.redo', key: 'y', modifiers: ['ctrl'], description: 'Redo last action', category: 'edit', action: 'edit.redo', enabled: true, customizable: true },
      { id: 'edit.copy', key: 'c', modifiers: ['ctrl'], description: 'Copy', category: 'edit', action: 'edit.copy', enabled: true, customizable: true },
      { id: 'edit.paste', key: 'v', modifiers: ['ctrl'], description: 'Paste', category: 'edit', action: 'edit.paste', enabled: true, customizable: true },
      { id: 'edit.cut', key: 'x', modifiers: ['ctrl'], description: 'Cut', category: 'edit', action: 'edit.cut', enabled: true, customizable: true },

      // View operations
      { id: 'view.zoomIn', key: '=', modifiers: ['ctrl'], description: 'Zoom in', category: 'view', action: 'view.zoomIn', enabled: true, customizable: true },
      { id: 'view.zoomOut', key: '-', modifiers: ['ctrl'], description: 'Zoom out', category: 'view', action: 'view.zoomOut', enabled: true, customizable: true },
      { id: 'view.zoomFit', key: '0', modifiers: ['ctrl'], description: 'Fit to screen', category: 'view', action: 'view.zoomFit', enabled: true, customizable: true },
      { id: 'view.zoom100', key: '1', modifiers: ['ctrl'], description: '100% zoom', category: 'view', action: 'view.zoom100', enabled: true, customizable: true },
      { id: 'view.fullscreen', key: 'F11', modifiers: [], description: 'Toggle fullscreen', category: 'view', action: 'view.fullscreen', enabled: true, customizable: true },

      // Image adjustments
      { id: 'image.autoAdjust', key: 'a', modifiers: ['ctrl'], description: 'Auto adjust image', category: 'image', action: 'image.autoAdjust', enabled: true, customizable: true },
      { id: 'image.curves', key: 'm', modifiers: ['ctrl'], description: 'Open curves panel', category: 'image', action: 'image.curves', enabled: true, customizable: true },
      { id: 'image.levels', key: 'l', modifiers: ['ctrl'], description: 'Open levels panel', category: 'image', action: 'image.levels', enabled: true, customizable: true },
      { id: 'image.exposure', key: 'e', modifiers: ['ctrl', 'shift'], description: 'Open exposure panel', category: 'image', action: 'image.exposure', enabled: true, customizable: true },
      { id: 'image.whiteBalance', key: 'w', modifiers: ['ctrl'], description: 'Open white balance', category: 'image', action: 'image.whiteBalance', enabled: true, customizable: true },

      // Tools
      { id: 'tools.brush', key: 'b', modifiers: [], description: 'Brush tool', category: 'tools', action: 'tools.brush', enabled: true, customizable: true },
      { id: 'tools.crop', key: 'c', modifiers: [], description: 'Crop tool', category: 'tools', action: 'tools.crop', enabled: true, customizable: true },
      { id: 'tools.heal', key: 'j', modifiers: [], description: 'Healing tool', category: 'tools', action: 'tools.heal', enabled: true, customizable: true },
      { id: 'tools.clone', key: 's', modifiers: [], description: 'Clone tool', category: 'tools', action: 'tools.clone', enabled: true, customizable: true },
      { id: 'tools.gradient', key: 'g', modifiers: [], description: 'Gradient tool', category: 'tools', action: 'tools.gradient', enabled: true, customizable: true },

      // Panels
      { id: 'panels.adjustments', key: 'F1', modifiers: [], description: 'Toggle adjustments panel', category: 'panels', action: 'panels.adjustments', enabled: true, customizable: true },
      { id: 'panels.histogram', key: 'F2', modifiers: [], description: 'Toggle histogram panel', category: 'panels', action: 'panels.histogram', enabled: true, customizable: true },
      { id: 'panels.layers', key: 'F3', modifiers: [], description: 'Toggle layers panel', category: 'panels', action: 'panels.layers', enabled: true, customizable: true },
      { id: 'panels.history', key: 'F4', modifiers: [], description: 'Toggle history panel', category: 'panels', action: 'panels.history', enabled: true, customizable: true },
      { id: 'panels.tools', key: 'F5', modifiers: [], description: 'Toggle tools panel', category: 'panels', action: 'panels.tools', enabled: true, customizable: true },

      // Navigation
      { id: 'nav.nextImage', key: 'ArrowRight', modifiers: [], description: 'Next image', category: 'navigation', action: 'nav.nextImage', enabled: true, customizable: true },
      { id: 'nav.prevImage', key: 'ArrowLeft', modifiers: [], description: 'Previous image', category: 'navigation', action: 'nav.prevImage', enabled: true, customizable: true },
      { id: 'nav.selectAll', key: 'a', modifiers: ['ctrl'], description: 'Select all', category: 'navigation', action: 'nav.selectAll', enabled: true, customizable: true },
      { id: 'nav.deselect', key: 'd', modifiers: ['ctrl'], description: 'Deselect', category: 'navigation', action: 'nav.deselect', enabled: true, customizable: true },

      // Advanced shortcuts
      { id: 'advanced.performanceMonitor', key: 'p', modifiers: ['ctrl', 'shift'], description: 'Performance monitor', category: 'view', action: 'advanced.performanceMonitor', enabled: true, customizable: false },
      { id: 'advanced.resetPanels', key: 'r', modifiers: ['ctrl', 'shift'], description: 'Reset panel layout', category: 'panels', action: 'advanced.resetPanels', enabled: true, customizable: true },
      { id: 'advanced.quickExport', key: 'q', modifiers: ['ctrl'], description: 'Quick export', category: 'file', action: 'advanced.quickExport', enabled: true, customizable: true }
    ];

    builtInShortcuts.forEach(shortcut => {
      this.shortcuts.set(shortcut.id, shortcut);
    });
  }

  private initializeWorkflows(): void {
    // Professional Photographer Workflow
    const professionalPhotographer: KeyboardWorkflow = {
      id: 'professional-photographer',
      name: 'Professional Photographer',
      description: 'Optimized shortcuts for professional photography workflow',
      category: 'photographer',
      isActive: false,
      shortcuts: [
        this.shortcuts.get('file.open')!,
        this.shortcuts.get('view.zoomFit')!,
        this.shortcuts.get('image.autoAdjust')!,
        this.shortcuts.get('image.exposure')!,
        this.shortcuts.get('image.whiteBalance')!,
        this.shortcuts.get('panels.histogram')!,
        this.shortcuts.get('file.export')!,
        this.shortcuts.get('nav.nextImage')!,
        this.shortcuts.get('nav.prevImage')!
      ]
    };

    // Retoucher Workflow
    const retoucher: KeyboardWorkflow = {
      id: 'retoucher',
      name: 'Digital Retoucher',
      description: 'Shortcuts focused on detailed retouching work',
      category: 'retoucher',
      isActive: false,
      shortcuts: [
        this.shortcuts.get('view.zoom100')!,
        this.shortcuts.get('tools.heal')!,
        this.shortcuts.get('tools.clone')!,
        this.shortcuts.get('tools.brush')!,
        this.shortcuts.get('panels.layers')!,
        this.shortcuts.get('edit.undo')!,
        this.shortcuts.get('edit.redo')!,
        this.shortcuts.get('panels.history')!
      ]
    };

    // Beginner Workflow
    const beginner: KeyboardWorkflow = {
      id: 'beginner',
      name: 'Beginner Friendly',
      description: 'Essential shortcuts for learning photo editing',
      category: 'beginner',
      isActive: false,
      shortcuts: [
        this.shortcuts.get('file.open')!,
        this.shortcuts.get('file.save')!,
        this.shortcuts.get('edit.undo')!,
        this.shortcuts.get('edit.redo')!,
        this.shortcuts.get('view.zoomFit')!,
        this.shortcuts.get('image.autoAdjust')!,
        this.shortcuts.get('file.export')!
      ]
    };

    // Professional Workflow (Complete)
    const professional: KeyboardWorkflow = {
      id: 'professional',
      name: 'Professional Complete',
      description: 'Comprehensive shortcuts for professional workflow',
      category: 'professional',
      isActive: true,
      shortcuts: Array.from(this.shortcuts.values()).filter(s => s.enabled)
    };

    this.workflows.set('professional-photographer', professionalPhotographer);
    this.workflows.set('retoucher', retoucher);
    this.workflows.set('beginner', beginner);
    this.workflows.set('professional', professional);

    // Set default active workflow
    this.activeWorkflow = professional;
  }

  private startKeyboardListener(): void {
    if (typeof window === 'undefined' || this.isListening) return;

    this.isListening = true;

    document.addEventListener('keydown', this.handleKeyDown.bind(this), true);
    document.addEventListener('keyup', this.handleKeyUp.bind(this), true);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.settings.enableShortcuts) return;

    // Don't process shortcuts when typing in inputs
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    const shortcutKey = this.createShortcutKey(event);
    const matchingShortcut = this.findMatchingShortcut(shortcutKey);

    if (matchingShortcut && matchingShortcut.enabled) {
      event.preventDefault();
      event.stopPropagation();

      this.executeShortcut(matchingShortcut);
      this.recordShortcutUsage(matchingShortcut);
      this.addToKeySequence(shortcutKey, matchingShortcut.action);
    }
  }

  private handleKeyUp(_event: KeyboardEvent): void {
    // Handle key release events if needed
  }

  private createShortcutKey(event: KeyboardEvent): string {
    const modifiers: string[] = [];

    if (event.ctrlKey) modifiers.push('ctrl');
    if (event.altKey) modifiers.push('alt');
    if (event.shiftKey) modifiers.push('shift');
    if (event.metaKey) modifiers.push('meta');

    const key = event.key;
    return modifiers.length > 0 ? `${modifiers.join('+')}+${key}` : key;
  }

  private findMatchingShortcut(keyString: string): KeyboardShortcut | null {
    for (const shortcut of this.shortcuts.values()) {
      if (this.matchesShortcut(shortcut, keyString)) {
        return shortcut;
      }
    }
    return null;
  }

  private matchesShortcut(shortcut: KeyboardShortcut, keyString: string): boolean {
    const shortcutKey = shortcut.modifiers.length > 0
      ? `${shortcut.modifiers.join('+')}+${shortcut.key}`
      : shortcut.key;

    return shortcutKey.toLowerCase() === keyString.toLowerCase();
  }

  private executeShortcut(shortcut: KeyboardShortcut): void {
    this.notifyObservers(shortcut.action, { shortcut });

    // Show tooltip if enabled
    if (this.settings.showTooltips) {
      this.showShortcutTooltip(shortcut);
    }
  }

  private showShortcutTooltip(shortcut: KeyboardShortcut): void {
    // Create temporary tooltip element
    const tooltip = document.createElement('div');
    tooltip.className = 'keyboard-shortcut-tooltip';
    tooltip.textContent = shortcut.description;
    tooltip.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: var(--color-surface);
      color: var(--color-text-primary);
      padding: 8px 12px;
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      font-size: var(--text-sm);
      z-index: 10000;
      animation: fadeInOut 2s ease-in-out;
    `;

    // Add CSS animation if not exists
    if (!document.querySelector('#shortcut-tooltip-styles')) {
      const style = document.createElement('style');
      style.id = 'shortcut-tooltip-styles';
      style.textContent = `
        @keyframes fadeInOut {
          0% { opacity: 0; transform: translateY(-10px); }
          20% { opacity: 1; transform: translateY(0); }
          80% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-10px); }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(tooltip);

    // Remove after animation
    setTimeout(() => {
      if (tooltip.parentNode) {
        tooltip.parentNode.removeChild(tooltip);
      }
    }, 2000);
  }

  private recordShortcutUsage(shortcut: KeyboardShortcut): void {
    const currentCount = this.shortcutUsage.get(shortcut.id) || 0;
    this.shortcutUsage.set(shortcut.id, currentCount + 1);
    this.stats.totalShortcutsUsed++;
    this.updateStats();
  }

  private addToKeySequence(key: string, action?: string): void {
    if (!this.settings.enableSequences) return;

    this.keySequence.push({
      keys: [key],
      timestamp: Date.now(),
      action
    });

    // Keep only last 10 key sequences
    if (this.keySequence.length > 10) {
      this.keySequence = this.keySequence.slice(-10);
    }
  }

  private updateStats(): void {
    // Update most used shortcuts
    const sortedUsage = Array.from(this.shortcutUsage.entries())
      .map(([id, count]) => ({ shortcut: this.shortcuts.get(id)!, count }))
      .filter(item => item.shortcut)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    this.stats.mostUsedShortcuts = sortedUsage;

    // Calculate workflow efficiency (shortcuts per minute over last hour)
    const recentUsage = this.keySequence.filter(
      seq => Date.now() - seq.timestamp < 60 * 60 * 1000
    );
    this.stats.averageActionsPerMinute = recentUsage.length;

    // Calculate efficiency score
    const totalPossibleShortcuts = this.shortcuts.size;
    const uniqueShortcutsUsed = this.shortcutUsage.size;
    this.stats.workflowEfficiency = Math.round((uniqueShortcutsUsed / totalPossibleShortcuts) * 100);

    // Count custom shortcuts
    this.stats.customShortcuts = Array.from(this.shortcuts.values())
      .filter(s => s.category === 'custom').length;
  }

  setActiveWorkflow(workflowId: string): void {
    const workflow = this.workflows.get(workflowId);
    if (workflow) {
      // Disable all shortcuts first
      this.shortcuts.forEach(shortcut => {
        shortcut.enabled = false;
      });

      // Enable shortcuts for this workflow
      workflow.shortcuts.forEach(shortcut => {
        const mainShortcut = this.shortcuts.get(shortcut.id);
        if (mainShortcut) {
          mainShortcut.enabled = true;
        }
      });

      this.activeWorkflow = workflow;
      this.workflows.forEach(w => { w.isActive = false; });
      workflow.isActive = true;

      this.persistSettings();
      this.notifyObservers('workflow.changed', { workflow });
    }
  }

  addCustomShortcut(shortcut: Omit<KeyboardShortcut, 'id' | 'customizable'>): string {
    const id = `custom.${Date.now()}.${Math.random().toString(36).substr(2, 9)}`;
    const customShortcut: KeyboardShortcut = {
      ...shortcut,
      id,
      category: 'custom',
      customizable: true
    };

    // Check for conflicts
    const conflict = this.findConflictingShortcut(customShortcut);
    if (conflict) {
      this.handleShortcutConflict(customShortcut, conflict);
    }

    this.shortcuts.set(id, customShortcut);
    this.persistSettings();
    this.updateStats();

    return id;
  }

  updateShortcut(shortcutId: string, updates: Partial<KeyboardShortcut>): void {
    const shortcut = this.shortcuts.get(shortcutId);
    if (shortcut && shortcut.customizable) {
      // Check for conflicts if key changed
      if (updates.key || updates.modifiers) {
        const testShortcut = { ...shortcut, ...updates };
        const conflict = this.findConflictingShortcut(testShortcut);
        if (conflict && conflict.id !== shortcutId) {
          this.handleShortcutConflict(testShortcut, conflict);
        }
      }

      Object.assign(shortcut, updates);
      this.persistSettings();
      this.notifyObservers('shortcut.updated', { shortcut });
    }
  }

  removeCustomShortcut(shortcutId: string): void {
    const shortcut = this.shortcuts.get(shortcutId);
    if (shortcut && shortcut.category === 'custom') {
      this.shortcuts.delete(shortcutId);
      this.shortcutUsage.delete(shortcutId);
      this.persistSettings();
      this.updateStats();
      this.notifyObservers('shortcut.removed', { shortcutId });
    }
  }

  private findConflictingShortcut(shortcut: KeyboardShortcut): KeyboardShortcut | null {
    const shortcutKey = shortcut.modifiers.length > 0
      ? `${shortcut.modifiers.join('+')}+${shortcut.key}`
      : shortcut.key;

    for (const existingShortcut of this.shortcuts.values()) {
      if (existingShortcut.id === shortcut.id) continue;

      const existingKey = existingShortcut.modifiers.length > 0
        ? `${existingShortcut.modifiers.join('+')}+${existingShortcut.key}`
        : existingShortcut.key;

      if (shortcutKey.toLowerCase() === existingKey.toLowerCase()) {
        return existingShortcut;
      }
    }

    return null;
  }

  private handleShortcutConflict(newShortcut: KeyboardShortcut, conflictingShortcut: KeyboardShortcut): void {
    switch (this.settings.conflictResolution) {
      case 'warn':
        console.warn(`Shortcut conflict: "${newShortcut.key}" conflicts with "${conflictingShortcut.description}"`);
        break;
      case 'override':
        conflictingShortcut.enabled = false;
        break;
      case 'disable':
        newShortcut.enabled = false;
        break;
    }
  }

  createCustomWorkflow(name: string, description: string, shortcutIds: string[]): string {
    const workflowId = `custom.${Date.now()}`;
    const shortcuts = shortcutIds
      .map(id => this.shortcuts.get(id))
      .filter(Boolean) as KeyboardShortcut[];

    const workflow: KeyboardWorkflow = {
      id: workflowId,
      name,
      description,
      category: 'custom',
      shortcuts,
      isActive: false
    };

    this.workflows.set(workflowId, workflow);
    this.persistSettings();

    return workflowId;
  }

  getShortcuts(): KeyboardShortcut[] {
    return Array.from(this.shortcuts.values());
  }

  getShortcutsByCategory(category: KeyboardShortcut['category']): KeyboardShortcut[] {
    return Array.from(this.shortcuts.values()).filter(s => s.category === category);
  }

  getWorkflows(): KeyboardWorkflow[] {
    return Array.from(this.workflows.values());
  }

  getActiveWorkflow(): KeyboardWorkflow | null {
    return this.activeWorkflow;
  }

  getStats(): WorkflowStats {
    this.updateStats();
    return { ...this.stats };
  }

  getSettings(): KeyboardSettings {
    return { ...this.settings };
  }

  updateSettings(updates: Partial<KeyboardSettings>): void {
    this.settings = { ...this.settings, ...updates };
    this.persistSettings();
    this.notifyObservers('settings.updated', { settings: this.settings });
  }

  resetToDefaults(): void {
    this.shortcuts.clear();
    this.workflows.clear();
    this.shortcutUsage.clear();
    this.keySequence = [];

    this.initializeBuiltInShortcuts();
    this.initializeWorkflows();
    this.settings = this.createDefaultSettings();
    this.stats = this.createDefaultStats();

    this.persistSettings();
    this.notifyObservers('reset.complete');
  }

  getShortcutTooltip(action: string): string | null {
    const shortcut = Array.from(this.shortcuts.values()).find(s => s.action === action);
    if (!shortcut || !shortcut.enabled) return null;

    const modifierText = shortcut.modifiers.length > 0 ? `${shortcut.modifiers.join('+')}+` : '';
    return `${modifierText}${shortcut.key}`;
  }

  exportWorkflow(workflowId: string): string {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error('Workflow not found');

    return JSON.stringify(workflow, null, 2);
  }

  importWorkflow(workflowJson: string): string {
    try {
      const workflow = JSON.parse(workflowJson) as KeyboardWorkflow;
      const newId = `imported.${Date.now()}`;
      workflow.id = newId;
      workflow.isActive = false;

      this.workflows.set(newId, workflow);
      this.persistSettings();

      return newId;
    } catch (error) {
      throw new Error('Failed to import workflow: Invalid JSON');
    }
  }

  private persistSettings(): void {
    try {
      const dataToSave = {
        shortcuts: Array.from(this.shortcuts.entries()),
        workflows: Array.from(this.workflows.entries()),
        settings: this.settings,
        activeWorkflowId: this.activeWorkflow?.id,
        shortcutUsage: Array.from(this.shortcutUsage.entries())
      };
      localStorage.setItem('photo-editor-keyboard', JSON.stringify(dataToSave));
    } catch (error) {
      console.warn('Failed to persist keyboard settings:', error);
    }
  }

  private loadPersistedSettings(): void {
    try {
      const data = localStorage.getItem('photo-editor-keyboard');
      if (!data) return;

      const parsed = JSON.parse(data);

      if (parsed.shortcuts) {
        this.shortcuts = new Map(parsed.shortcuts);
      }

      if (parsed.workflows) {
        this.workflows = new Map(parsed.workflows);
      }

      if (parsed.settings) {
        this.settings = { ...this.settings, ...parsed.settings };
      }

      if (parsed.activeWorkflowId) {
        const activeWorkflow = this.workflows.get(parsed.activeWorkflowId);
        if (activeWorkflow) {
          this.activeWorkflow = activeWorkflow;
        }
      }

      if (parsed.shortcutUsage) {
        this.shortcutUsage = new Map(parsed.shortcutUsage);
      }

      this.updateStats();
    } catch (error) {
      console.warn('Failed to load keyboard settings:', error);
    }
  }

  subscribe(callback: (action: string, data?: any) => void): () => void {
    this.observers.add(callback);
    return () => this.observers.delete(callback);
  }

  private notifyObservers(action: string, data?: any): void {
    this.observers.forEach(callback => {
      try {
        callback(action, data);
      } catch (error) {
        console.error('Error in keyboard workflow observer:', error);
      }
    });
  }

  dispose(): void {
    if (this.isListening) {
      document.removeEventListener('keydown', this.handleKeyDown.bind(this), true);
      document.removeEventListener('keyup', this.handleKeyUp.bind(this), true);
      this.isListening = false;
    }
    this.observers.clear();
  }
}

export default KeyboardWorkflowService;