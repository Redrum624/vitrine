import { logger } from '../utils/Logger';
import { imageProcessingPipeline } from './ImageProcessingPipeline';

export interface HistoryState {
  id: string;
  name: string;
  timestamp: number;
  moduleSettings: Record<string, any>;
}

export class HistoryService {
  private history: HistoryState[] = [];
  private currentIndex: number = -1;
  private readonly MAX_HISTORY_SIZE = 50;

  // Save current state to history
  saveState(name: string = 'Adjustment'): void {
    try {
      const moduleSettings = this.captureCurrentModuleSettings();

      const state: HistoryState = {
        id: `state_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name,
        timestamp: Date.now(),
        moduleSettings
      };

      // Remove any states after current index (when undoing then making new changes)
      if (this.currentIndex < this.history.length - 1) {
        this.history = this.history.slice(0, this.currentIndex + 1);
      }

      // Add new state
      this.history.push(state);
      this.currentIndex = this.history.length - 1;

      // Keep history within size limit
      if (this.history.length > this.MAX_HISTORY_SIZE) {
        this.history = this.history.slice(-this.MAX_HISTORY_SIZE);
        this.currentIndex = this.history.length - 1;
      }

      logger.info(`Saved state: ${name} (${this.history.length} states in history)`);
    } catch (error) {
      logger.error('Failed to save state:', error);
    }
  }

  // Undo to previous state
  undo(): boolean {
    if (!this.canUndo()) {
      logger.warn('Cannot undo: no previous state available');
      return false;
    }

    try {
      this.currentIndex--;
      const state = this.history[this.currentIndex];
      this.restoreState(state);
      logger.info(`Undid to: ${state.name}`);
      return true;
    } catch (error) {
      logger.error('Failed to undo:', error);
      this.currentIndex++; // Revert index on error
      return false;
    }
  }

  // Redo to next state
  redo(): boolean {
    if (!this.canRedo()) {
      logger.warn('Cannot redo: no next state available');
      return false;
    }

    try {
      this.currentIndex++;
      const state = this.history[this.currentIndex];
      this.restoreState(state);
      logger.info(`Redid to: ${state.name}`);
      return true;
    } catch (error) {
      logger.error('Failed to redo:', error);
      this.currentIndex--; // Revert index on error
      return false;
    }
  }

  // Check if undo is possible
  canUndo(): boolean {
    return this.currentIndex > 0;
  }

  // Check if redo is possible
  canRedo(): boolean {
    return this.currentIndex < this.history.length - 1;
  }

  // Get current state info
  getCurrentState(): HistoryState | null {
    if (this.currentIndex >= 0 && this.currentIndex < this.history.length) {
      return this.history[this.currentIndex];
    }
    return null;
  }

  // Get history summary
  getHistorySummary(): {
    totalStates: number;
    currentIndex: number;
    canUndo: boolean;
    canRedo: boolean;
    states: Array<{ name: string; timestamp: number }>;
  } {
    return {
      totalStates: this.history.length,
      currentIndex: this.currentIndex,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      states: this.history.map(state => ({
        name: state.name,
        timestamp: state.timestamp
      }))
    };
  }

  // Reset all modules to defaults
  resetAll(): void {
    try {
      // Save current state before resetting
      this.saveState('Before Reset All');

      // Reset all modules to their default parameters
      const modules = imageProcessingPipeline.getModules();
      for (const [moduleId, module] of modules) {
        if ('resetToDefaults' in module && typeof module.resetToDefaults === 'function') {
          (module as any).resetToDefaults();
        } else if ('reset' in module && typeof module.reset === 'function') {
          (module as any).reset();
        }
      }

      // Save the reset state
      this.saveState('Reset All');
      logger.info('Reset all modules to defaults');
    } catch (error) {
      logger.error('Failed to reset all modules:', error);
    }
  }

  // Clear history
  clearHistory(): void {
    this.history = [];
    this.currentIndex = -1;
    logger.info('Cleared adjustment history');
  }

  // Capture current module settings
  private captureCurrentModuleSettings(): Record<string, any> {
    const settings: Record<string, any> = {};

    try {
      const modules = imageProcessingPipeline.getModules();

      for (const [moduleId, module] of modules) {
        try {
          let moduleSettings: any = null;

          // Try different parameter getter methods
          if ('getParameters' in module && typeof module.getParameters === 'function') {
            moduleSettings = (module as any).getParameters();
          } else if ('getParams' in module && typeof module.getParams === 'function') {
            moduleSettings = (module as any).getParams();
          } else if ('getState' in module && typeof module.getState === 'function') {
            moduleSettings = (module as any).getState();
          }

          if (moduleSettings) {
            settings[moduleId] = {
              enabled: (module as any).isEnabled?.() || true,
              parameters: moduleSettings
            };
          }
        } catch (error) {
          logger.warn(`Failed to capture settings for module ${moduleId}:`, error);
        }
      }

      return settings;
    } catch (error) {
      logger.error('Failed to capture current module settings:', error);
      return {};
    }
  }

  // Restore state to modules
  private restoreState(state: HistoryState): void {
    const modules = imageProcessingPipeline.getModules();

    for (const [moduleId, module] of modules) {
      try {
        const moduleState = state.moduleSettings[moduleId];
        if (!moduleState) continue;

        // Set enabled state
        if ('enabled' in moduleState) {
          imageProcessingPipeline.setModuleEnabled(moduleId, moduleState.enabled);
        }

        // Set parameters
        if (moduleState.parameters) {
          if ('setParameters' in module && typeof module.setParameters === 'function') {
            (module as any).setParameters(moduleState.parameters);
          } else if ('setParams' in module && typeof module.setParams === 'function') {
            (module as any).setParams(moduleState.parameters);
          } else if ('setState' in module && typeof module.setState === 'function') {
            (module as any).setState(moduleState.parameters);
          }
        }
      } catch (error) {
        logger.warn(`Failed to restore state for module ${moduleId}:`, error);
      }
    }
  }
}

// Export singleton
export const historyService = new HistoryService();