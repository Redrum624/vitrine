import { logger } from '../utils/Logger';
import { keyboardEventBlocked } from '../utils/keyboardScope';

export interface KeyboardShortcut {
  id: string;
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  description: string;
  category: 'file' | 'edit' | 'view' | 'tools' | 'processing' | 'help';
  action: () => void;
  /**
   * Optional applicability gate, evaluated at keypress time. When it returns
   * false the shortcut neither fires NOR swallows the event — the capture-phase
   * handler returns BEFORE preventDefault/stopPropagation, so the keydown still
   * reaches bubble-phase listeners. This is how a shortcut yields to a
   * view-specific handler for the same key: the rating digits no-op'd in
   * Gallery but still swallowed the event at capture, which made GalleryView's
   * own 1-5/0 selection-rating listener silently dead (live-verified).
   */
  when?: () => boolean;
}

export class KeyboardShortcutsService {
  private shortcuts: Map<string, KeyboardShortcut> = new Map();
  private isEnabled = true;
  // FIXED: Store bound reference for proper cleanup
  private boundHandleKeyDown: (event: KeyboardEvent) => void;
  private listenerAttached = false;

  constructor() {
    // FIXED: Create bound reference once
    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    this.setupEventListeners();
  }

  // Register a keyboard shortcut
  register(shortcut: KeyboardShortcut): void {
    // Self-heal: callers (e.g. App's keyboard effect) may call destroy() on
    // cleanup and then re-register on the next run. destroy() removes the document
    // listener, so ensure it's re-attached here — otherwise shortcuts would sit in
    // the map with no listener firing them (the rating/zoom-keys "dead after first
    // image load" bug).
    this.setupEventListeners();
    const key = this.getShortcutKey(shortcut);
    this.shortcuts.set(key, shortcut);
    logger.debug(`Registered shortcut: ${this.formatShortcut(shortcut)} - ${shortcut.description}`);
  }

  // Unregister a keyboard shortcut
  unregister(shortcutId: string): void {
    for (const [key, shortcut] of this.shortcuts.entries()) {
      if (shortcut.id === shortcutId) {
        this.shortcuts.delete(key);
        logger.debug(`Unregistered shortcut: ${shortcutId}`);
        break;
      }
    }
  }

  // Enable or disable all shortcuts
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    logger.info(`Keyboard shortcuts ${enabled ? 'enabled' : 'disabled'}`);
  }

  // Get all registered shortcuts grouped by category
  getAllShortcuts(): Record<string, KeyboardShortcut[]> {
    const grouped: Record<string, KeyboardShortcut[]> = {};

    for (const shortcut of this.shortcuts.values()) {
      if (!grouped[shortcut.category]) {
        grouped[shortcut.category] = [];
      }
      grouped[shortcut.category].push(shortcut);
    }

    return grouped;
  }

  // Get shortcut by ID
  getShortcut(id: string): KeyboardShortcut | undefined {
    for (const shortcut of this.shortcuts.values()) {
      if (shortcut.id === id) {
        return shortcut;
      }
    }
    return undefined;
  }

  private setupEventListeners(): void {
    // Idempotent: only attach once. Re-attaches after a destroy() (the listener is
    // removed there) when register() is called again.
    if (this.listenerAttached) return;
    document.addEventListener('keydown', this.boundHandleKeyDown, true);
    this.listenerAttached = true;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.isEnabled) return;

    // Shared guard: don't trigger shortcuts while typing in a field OR while any
    // modal dialog is open. Returning HERE (before the match below) is what keeps
    // the capture-phase preventDefault/stopPropagation from firing, so the blocked
    // event still reaches the input/dialog's own handlers. See keyboardScope.ts.
    if (keyboardEventBlocked(event)) return;

    const key = this.getEventKey(event);
    const shortcut = this.shortcuts.get(key);

    if (shortcut) {
      // Applicability gate: return BEFORE swallowing, so an inapplicable
      // shortcut leaves the event for bubble-phase listeners (see the
      // KeyboardShortcut.when doc comment).
      if (shortcut.when && !shortcut.when()) return;

      event.preventDefault();
      event.stopPropagation();

      try {
        shortcut.action();
        logger.debug(`Executed shortcut: ${this.formatShortcut(shortcut)}`);
      } catch (error) {
        logger.error(`Failed to execute shortcut ${shortcut.id}:`, error);
      }
    }
  }

  private getShortcutKey(shortcut: KeyboardShortcut): string {
    return `${shortcut.ctrlKey ? 'Ctrl+' : ''}${shortcut.shiftKey ? 'Shift+' : ''}${shortcut.altKey ? 'Alt+' : ''}${shortcut.key}`;
  }

  private getEventKey(event: KeyboardEvent): string {
    return `${event.ctrlKey ? 'Ctrl+' : ''}${event.shiftKey ? 'Shift+' : ''}${event.altKey ? 'Alt+' : ''}${event.key}`;
  }

  private formatShortcut(shortcut: KeyboardShortcut): string {
    const parts = [];
    if (shortcut.ctrlKey) parts.push('Ctrl');
    if (shortcut.shiftKey) parts.push('Shift');
    if (shortcut.altKey) parts.push('Alt');
    parts.push(shortcut.key);
    return parts.join('+');
  }

  // FIXED: Use bound reference for proper cleanup
  destroy(): void {
    document.removeEventListener('keydown', this.boundHandleKeyDown, true);
    this.listenerAttached = false;
    this.shortcuts.clear();
    logger.info('Keyboard shortcuts service destroyed');
  }
}

// Default shortcuts configuration
export const createDefaultShortcuts = (callbacks: {
  onOpen?: () => void;
  onSave?: () => void;
  onExport?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onResetAll?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomFit?: () => void;
  onZoomActual?: () => void;
  onTogglePresets?: () => void;
  onToggleBatch?: () => void;
  onTogglePlugins?: () => void;
  onSelectTool?: (tool: string) => void;
}): KeyboardShortcut[] => {
  const shortcuts: KeyboardShortcut[] = [];

  // File operations
  if (callbacks.onOpen) {
    shortcuts.push({
      id: 'file-open',
      key: 'o',
      ctrlKey: true,
      description: 'Open image file',
      category: 'file',
      action: callbacks.onOpen
    });
  }

  if (callbacks.onSave) {
    shortcuts.push({
      id: 'file-save',
      key: 's',
      ctrlKey: true,
      description: 'Save current adjustments',
      category: 'file',
      action: callbacks.onSave
    });
  }

  if (callbacks.onExport) {
    shortcuts.push({
      id: 'file-export',
      key: 'e',
      ctrlKey: true,
      description: 'Export processed image',
      category: 'file',
      action: callbacks.onExport
    });
  }

  // Edit operations
  if (callbacks.onUndo) {
    shortcuts.push({
      id: 'edit-undo',
      key: 'z',
      ctrlKey: true,
      description: 'Undo last adjustment',
      category: 'edit',
      action: callbacks.onUndo
    });
  }

  if (callbacks.onRedo) {
    shortcuts.push({
      id: 'edit-redo',
      key: 'y',
      ctrlKey: true,
      description: 'Redo last adjustment',
      category: 'edit',
      action: callbacks.onRedo
    });
    shortcuts.push({
      id: 'edit-redo-alt',
      key: 'z',
      ctrlKey: true,
      shiftKey: true,
      description: 'Redo last adjustment',
      category: 'edit',
      action: callbacks.onRedo
    });
  }

  if (callbacks.onResetAll) {
    shortcuts.push({
      id: 'edit-reset-all',
      key: 'r',
      ctrlKey: true,
      shiftKey: true,
      description: 'Reset all adjustments',
      category: 'edit',
      action: callbacks.onResetAll
    });
  }

  // View operations
  if (callbacks.onZoomIn) {
    shortcuts.push({
      id: 'view-zoom-in',
      key: '+',
      ctrlKey: true,
      description: 'Zoom in',
      category: 'view',
      action: callbacks.onZoomIn
    });
    shortcuts.push({
      id: 'view-zoom-in-alt',
      key: '=',
      ctrlKey: true,
      description: 'Zoom in',
      category: 'view',
      action: callbacks.onZoomIn
    });
  }

  if (callbacks.onZoomOut) {
    shortcuts.push({
      id: 'view-zoom-out',
      key: '-',
      ctrlKey: true,
      description: 'Zoom out',
      category: 'view',
      action: callbacks.onZoomOut
    });
  }

  if (callbacks.onZoomFit) {
    shortcuts.push({
      id: 'view-zoom-fit',
      key: '0',
      ctrlKey: true,
      description: 'Fit image to window',
      category: 'view',
      action: callbacks.onZoomFit
    });
  }

  if (callbacks.onZoomActual) {
    shortcuts.push({
      id: 'view-zoom-actual',
      key: '1',
      ctrlKey: true,
      description: 'View at 100% size',
      category: 'view',
      action: callbacks.onZoomActual
    });
  }

  // Tool shortcuts
  if (callbacks.onSelectTool) {
    shortcuts.push({
      id: 'tool-select',
      key: 'v',
      description: 'Select tool',
      category: 'tools',
      action: () => callbacks.onSelectTool!('select')
    });
    shortcuts.push({
      id: 'tool-move',
      key: 'm',
      description: 'Move tool',
      category: 'tools',
      action: () => callbacks.onSelectTool!('move')
    });
    shortcuts.push({
      id: 'tool-crop',
      key: 'c',
      description: 'Crop tool',
      category: 'tools',
      action: () => callbacks.onSelectTool!('crop')
    });
    shortcuts.push({
      id: 'tool-brush',
      key: 'b',
      description: 'Brush tool',
      category: 'tools',
      action: () => callbacks.onSelectTool!('brush')
    });
  }

  // Processing shortcuts
  if (callbacks.onTogglePresets) {
    shortcuts.push({
      id: 'processing-presets',
      key: 'p',
      ctrlKey: true,
      description: 'Open preset manager',
      category: 'processing',
      action: callbacks.onTogglePresets
    });
  }

  if (callbacks.onToggleBatch) {
    shortcuts.push({
      id: 'processing-batch',
      key: 'b',
      ctrlKey: true,
      shiftKey: true,
      description: 'Open batch processing',
      category: 'processing',
      action: callbacks.onToggleBatch
    });
  }

  if (callbacks.onTogglePlugins) {
    shortcuts.push({
      id: 'processing-plugins',
      key: 'm',
      ctrlKey: true,
      shiftKey: true,
      description: 'Open plugin manager',
      category: 'processing',
      action: callbacks.onTogglePlugins
    });
  }

  return shortcuts;
};

// Star-rating shortcuts: pressing 1-5 sets that rating on the current image,
// 0 clears it. (Plain digits — Ctrl+0/Ctrl+1 stay bound to zoom in
// createDefaultShortcuts since modifier combos map to distinct keys.)
export const createRatingShortcuts = (
  onRate: (rating: number) => void,
  when?: () => boolean,
): KeyboardShortcut[] =>
  [0, 1, 2, 3, 4, 5].map((n) => ({
    id: `rate-${n}`,
    key: String(n),
    description: n === 0 ? 'Clear star rating' : `Set ${n}-star rating`,
    category: 'edit' as const,
    action: () => onRate(n),
    when,
  }));

export const keyboardShortcutsService = new KeyboardShortcutsService();