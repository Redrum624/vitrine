import { electronService } from './ElectronService';
import { editPersistenceService } from './EditPersistenceService';
import { checkpointService } from './CheckpointService';
import { logger } from '../utils/Logger';

interface UnsavedChangesChecker {
  hasUnsavedChanges(): boolean;
  getDescription(): string;
}

// Escape a string for safe interpolation into innerHTML. The unsaved-changes message is
// assembled from registry-derived checker descriptions (app-controlled today), but escaping
// is cheap defense-in-depth so a future checker that surfaces a filename/path containing
// `<`/`&`/quotes can never inject markup into the modal.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

class AppLifecycleService {
  private unsavedChangesCheckers: UnsavedChangesChecker[] = [];
  private cleanupTasks: (() => Promise<void> | void)[] = [];
  private isClosing = false;

  constructor() {
    // Set up event listeners for app close request
    window.addEventListener('electron-app-close-request', this.handleCloseRequest.bind(this));
    window.addEventListener('electron-app-cleanup', this.handleCleanup.bind(this));
  }

  // Register a checker for unsaved changes
  public registerUnsavedChangesChecker(checker: UnsavedChangesChecker) {
    this.unsavedChangesCheckers.push(checker);
  }

  // Register a cleanup task
  public registerCleanupTask(task: () => Promise<void> | void) {
    this.cleanupTasks.push(task);
  }

  // Check if there are any unsaved changes
  private hasUnsavedChanges(): boolean {
    return this.unsavedChangesCheckers.some(checker => checker.hasUnsavedChanges());
  }

  // Get descriptions of unsaved changes
  private getUnsavedChangesDescriptions(): string[] {
    return this.unsavedChangesCheckers
      .filter(checker => checker.hasUnsavedChanges())
      .map(checker => checker.getDescription());
  }

  // Handle the close request from Electron
  private async handleCloseRequest() {
    if (this.isClosing) return;

    try {
      logger.info('App close requested, checking for unsaved changes...');

      // Check for unsaved changes
      const hasUnsaved = this.hasUnsavedChanges();
      let shouldClose = true;
      let reason = 'Clean close';

      if (hasUnsaved) {
        const descriptions = this.getUnsavedChangesDescriptions();
        logger.info('Unsaved changes detected:', descriptions);

        // Show confirmation dialog
        shouldClose = await this.showUnsavedChangesDialog(descriptions);
        reason = shouldClose ? 'User confirmed close with unsaved changes' : 'User cancelled close due to unsaved changes';
      }

      if (shouldClose) {
        // Save current app state/preferences before closing
        await this.saveAppState();
      }

      // Send response back to Electron
      electronService.sendCloseResponse(shouldClose, reason);
      logger.info(`Close response sent: ${shouldClose ? 'proceed' : 'cancel'} - ${reason}`);

    } catch (error) {
      logger.error('Error during close request handling:', error);
      // Default to allowing close on error
      electronService.sendCloseResponse(true, 'Error during close handling, proceeding anyway');
    }
  }

  // Show dialog asking user about unsaved changes
  private async showUnsavedChangesDialog(descriptions: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const message = `You have unsaved changes:\n\n${descriptions.join('\n')}\n\nDo you want to close without saving?`;

      // Create a modal dialog
      const modal = this.createUnsavedChangesModal(message, (result) => {
        document.body.removeChild(modal);
        resolve(result);
      });

      document.body.appendChild(modal);
    });
  }

  // Create the unsaved changes modal
  private createUnsavedChangesModal(message: string, callback: (result: boolean) => void): HTMLElement {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50';
    // aria-modal (+ role=dialog) makes keyboardScope.ts's keyboardEventBlocked() guard cover this
    // dialog for free: every document-/window-level listener that routes through it (six, per Q1's
    // round-7 sweep) now early-returns while this confirm is up, instead of firing beneath it.
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    modal.innerHTML = `
      <div class="bg-dark-800 rounded-lg p-6 max-w-md mx-4 border border-dark-700">
        <div class="flex items-center mb-4">
          <div class="w-8 h-8 rounded-full bg-yellow-500 flex items-center justify-center mr-3">
            <svg class="w-5 h-5 text-yellow-900" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
            </svg>
          </div>
          <h3 class="text-lg font-semibold text-white">Unsaved Changes</h3>
        </div>

        <div class="mb-6">
          <p class="text-dark-300 whitespace-pre-line">${escapeHtml(message)}</p>
        </div>

        <div class="flex justify-end space-x-3">
          <button id="cancel-close" class="px-4 py-2 bg-dark-700 hover:bg-dark-600 text-white rounded transition-colors">
            Cancel
          </button>
          <button id="save-and-close" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors">
            Save & Close
          </button>
          <button id="close-without-saving" class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors">
            Close Without Saving
          </button>
        </div>
      </div>
    `;

    // Add event listeners
    const cancelBtn = modal.querySelector('#cancel-close');
    const saveAndCloseBtn = modal.querySelector('#save-and-close');
    const closeWithoutSavingBtn = modal.querySelector('#close-without-saving');

    // EVERY dismissal path must remove the capture-phase Esc listener below — a leaked
    // capture listener would silently swallow the app's NEXT Escape press anywhere
    // (stopImmediatePropagation) before self-removing. Button paths dismiss the dialog
    // without pressing Esc, so they clean up explicitly here.
    const removeEscListener = () => document.removeEventListener('keydown', handleKeyDown, true);

    cancelBtn?.addEventListener('click', () => { removeEscListener(); callback(false); });

    saveAndCloseBtn?.addEventListener('click', async () => {
      removeEscListener();
      // Attempt to save all changes
      try {
        await this.saveAllChanges();
        callback(true);
      } catch (error) {
        logger.error('Failed to save changes:', error);
        // Show error and let user decide
        alert('Failed to save changes. Close anyway?');
        callback(window.confirm('Failed to save changes. Close anyway?'));
      }
    });

    closeWithoutSavingBtn?.addEventListener('click', () => { removeEscListener(); callback(true); });

    // Close on escape key. Capture phase + stopImmediatePropagation (the Q5/Q6 popover
    // convention — InfoPopover / GalleryTileContextMenu): this dialog is created imperatively
    // (appendChild), not via the aria-modal React tree, so without this its bubble-phase Esc used
    // to co-fire with ThumbnailPanel's own bubble-phase Esc listener (closing the filmstrip out
    // from under this confirm). Consuming Escape here first — before any bubble-phase listener
    // sees it — closes that regardless of DOM registration order; aria-modal above is the
    // belt-and-suspenders guard for every OTHER listener that routes through keyboardEventBlocked.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        document.removeEventListener('keydown', handleKeyDown, true);
        callback(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);

    return modal;
  }

  // Save all pending changes
  private async saveAllChanges(): Promise<void> {
    logger.info('Attempting to save all changes before close...');

    // This would trigger save operations in various parts of the app
    window.dispatchEvent(new CustomEvent('app-save-all-changes'));

    // Give time for saves to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Save current app state and preferences
  private async saveAppState(): Promise<void> {
    try {
      logger.info('Saving app state before close...');

      // Persist the current image's edits + checkpoint history to the durable store on close.
      editPersistenceService.flush();
      checkpointService.flush();

      // Save current workspace state to localStorage
      const appState = {
        timestamp: Date.now(),
        lastImagePath: localStorage.getItem('lastImagePath'),
        workspaceLayout: {
          sidebarCollapsed: localStorage.getItem('sidebarCollapsed') === 'true',
          panelSizes: JSON.parse(localStorage.getItem('panelSizes') || '{}'),
          selectedTool: localStorage.getItem('selectedTool'),
        },
        recentFiles: JSON.parse(localStorage.getItem('recentFiles') || '[]'),
        preferences: JSON.parse(localStorage.getItem('preferences') || '{}'),
      };

      localStorage.setItem('appState', JSON.stringify(appState));
      logger.info('App state saved successfully');

    } catch (error) {
      logger.error('Failed to save app state:', error);
    }
  }

  // Handle cleanup signal from Electron
  private async handleCleanup() {
    if (this.isClosing) return;
    this.isClosing = true;

    try {
      logger.info('App cleanup requested, running cleanup tasks...');

      // Run all registered cleanup tasks
      for (const task of this.cleanupTasks) {
        try {
          await task();
        } catch (error) {
          logger.error('Cleanup task failed:', error);
        }
      }

      // Clean up services
      await this.cleanupServices();

      logger.info('App cleanup completed');

    } catch (error) {
      logger.error('Error during app cleanup:', error);
    }
  }

  // Clean up all services
  private async cleanupServices(): Promise<void> {
    try {
      // Clean up Electron service listeners
      electronService.cleanup();

      // Additional cleanup can be added here for other services
      logger.info('Services cleanup completed');

    } catch (error) {
      logger.error('Error during services cleanup:', error);
    }
  }

  // Public method to trigger save before close
  public async saveBeforeClose(): Promise<void> {
    await this.saveAllChanges();
    await this.saveAppState();
  }

  // Check if app is currently closing
  public isAppClosing(): boolean {
    return this.isClosing;
  }
}

// Create singleton instance
export const appLifecycleService = new AppLifecycleService();