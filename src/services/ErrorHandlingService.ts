import { logger } from '../utils/Logger';

export interface ErrorInfo {
  id: string;
  message: string;
  category: 'validation' | 'processing' | 'io' | 'network' | 'system' | 'unknown';
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  context?: Record<string, unknown>;
  stack?: string;
  recoverable: boolean;
  userMessage: string;
}

export interface RecoveryAction {
  id: string;
  label: string;
  action: () => Promise<void> | void;
  description?: string;
}

/**
 * Centralized error handling service
 */
export class ErrorHandlingService {
  private static instance: ErrorHandlingService;
  private errorHandlers = new Map<string, (error: ErrorInfo) => void>();
  private errorHistory: ErrorInfo[] = [];
  private maxHistorySize = 100;

  static getInstance(): ErrorHandlingService {
    if (!ErrorHandlingService.instance) {
      ErrorHandlingService.instance = new ErrorHandlingService();
    }
    return ErrorHandlingService.instance;
  }

  /**
   * Handle and categorize errors
   */
  handleError(
    error: Error | unknown,
    context: string,
    category: ErrorInfo['category'] = 'unknown',
    severity: ErrorInfo['severity'] = 'medium'
  ): ErrorInfo {
    const errorInfo: ErrorInfo = this.createErrorInfo(error, context, category, severity);

    // Log the error
    this.logError(errorInfo);

    // Add to history
    this.addToHistory(errorInfo);

    // Notify handlers
    this.notifyHandlers(errorInfo);

    return errorInfo;
  }

  /**
   * Create standardized error info
   */
  private createErrorInfo(
    error: Error | unknown,
    context: string,
    category: ErrorInfo['category'],
    severity: ErrorInfo['severity']
  ): ErrorInfo {
    const id = this.generateErrorId();
    let message: string;
    let stack: string | undefined;

    if (error instanceof Error) {
      message = error.message;
      stack = error.stack;
    } else {
      message = String(error);
    }

    return {
      id,
      message,
      category,
      severity,
      timestamp: new Date(),
      context: { location: context },
      stack,
      recoverable: this.isRecoverable(category, severity),
      userMessage: this.generateUserMessage(message, category, severity)
    };
  }

  /**
   * Generate user-friendly error messages
   */
  private generateUserMessage(
    technicalMessage: string,
    category: ErrorInfo['category'],
    severity: ErrorInfo['severity']
  ): string {
    switch (category) {
      case 'validation':
        return 'Please check your input and try again.';
      case 'processing':
        if (severity === 'critical') {
          return 'Image processing failed. Please try with a different image or restart the application.';
        }
        return 'Processing encountered an issue. Please try again.';
      case 'io':
        if (technicalMessage.includes('ENOENT')) {
          return 'File not found. Please check the file path and try again.';
        }
        if (technicalMessage.includes('EACCES')) {
          return 'Permission denied. Please check file permissions.';
        }
        return 'File operation failed. Please check the file and try again.';
      case 'network':
        return 'Network connection issue. Please check your internet connection.';
      case 'system':
        return 'System error occurred. Please try restarting the application.';
      default:
        return 'An unexpected error occurred. Please try again.';
    }
  }

  /**
   * Determine if error is recoverable
   */
  private isRecoverable(category: ErrorInfo['category'], severity: ErrorInfo['severity']): boolean {
    if (severity === 'critical') return false;
    if (category === 'system' && severity === 'high') return false;
    return true;
  }

  /**
   * Generate unique error ID
   */
  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Log error with appropriate level
   */
  private logError(errorInfo: ErrorInfo): void {
    const logData = {
      id: errorInfo.id,
      category: errorInfo.category,
      context: errorInfo.context,
      recoverable: errorInfo.recoverable
    };

    switch (errorInfo.severity) {
      case 'critical':
        logger.error(`CRITICAL ERROR: ${errorInfo.message}`, logData);
        break;
      case 'high':
        logger.error(errorInfo.message, logData);
        break;
      case 'medium':
        logger.warn(errorInfo.message, logData);
        break;
      case 'low':
        logger.info(errorInfo.message, logData);
        break;
    }

    // Include stack trace for errors
    if (errorInfo.stack && errorInfo.severity !== 'low') {
      logger.debug('Stack trace:', { stack: errorInfo.stack });
    }
  }

  /**
   * Add error to history
   */
  private addToHistory(errorInfo: ErrorInfo): void {
    this.errorHistory.unshift(errorInfo);
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory = this.errorHistory.slice(0, this.maxHistorySize);
    }
  }

  /**
   * Notify registered error handlers
   */
  private notifyHandlers(errorInfo: ErrorInfo): void {
    for (const [handlerId, handler] of this.errorHandlers) {
      try {
        handler(errorInfo);
      } catch (handlerError) {
        logger.error(`Error handler ${handlerId} failed:`, handlerError);
      }
    }
  }

  /**
   * Register error handler
   */
  registerHandler(id: string, handler: (error: ErrorInfo) => void): void {
    this.errorHandlers.set(id, handler);
  }

  /**
   * Unregister error handler
   */
  unregisterHandler(id: string): void {
    this.errorHandlers.delete(id);
  }

  /**
   * Get error history
   */
  getErrorHistory(limit?: number): ErrorInfo[] {
    return limit ? this.errorHistory.slice(0, limit) : [...this.errorHistory];
  }

  /**
   * Clear error history
   */
  clearHistory(): void {
    this.errorHistory = [];
  }

  /**
   * Get error statistics
   */
  getErrorStats(): Record<string, unknown> {
    const stats = {
      total: this.errorHistory.length,
      byCategory: {} as Record<string, number>,
      bySeverity: {} as Record<string, number>,
      recentErrors: this.errorHistory.slice(0, 5).length
    };

    for (const error of this.errorHistory) {
      stats.byCategory[error.category] = (stats.byCategory[error.category] || 0) + 1;
      stats.bySeverity[error.severity] = (stats.bySeverity[error.severity] || 0) + 1;
    }

    return stats;
  }

  /**
   * Wrapped async function with error handling
   */
  async withErrorHandling<T>(
    operation: () => Promise<T>,
    context: string,
    category: ErrorInfo['category'] = 'unknown',
    fallback?: T
  ): Promise<T | undefined> {
    try {
      return await operation();
    } catch (error) {
      const errorInfo = this.handleError(error, context, category);

      if (fallback !== undefined) {
        logger.info(`Using fallback value for ${context}`, { fallback });
        return fallback;
      }

      if (errorInfo.recoverable) {
        logger.warn(`Recoverable error in ${context}, continuing...`);
        return undefined;
      }

      throw error;
    }
  }

  /**
   * Create recovery actions for common error scenarios
   */
  createRecoveryActions(errorInfo: ErrorInfo): RecoveryAction[] {
    const actions: RecoveryAction[] = [];

    switch (errorInfo.category) {
      case 'processing':
        actions.push({
          id: 'retry_processing',
          label: 'Retry Processing',
          description: 'Attempt to process the image again',
          action: () => {
            logger.info('User initiated processing retry');
            // This would be implemented by the calling code
          }
        });
        break;

      case 'io':
        actions.push({
          id: 'select_different_file',
          label: 'Select Different File',
          description: 'Choose a different image file',
          action: () => {
            logger.info('User requested file selection');
            // This would trigger file selection dialog
          }
        });
        break;

      case 'validation':
        actions.push({
          id: 'reset_to_defaults',
          label: 'Reset to Defaults',
          description: 'Reset all settings to default values',
          action: () => {
            logger.info('User reset settings to defaults');
            // This would reset the processing pipeline
          }
        });
        break;
    }

    // Always offer refresh/restart for high severity errors
    if (errorInfo.severity === 'high' || errorInfo.severity === 'critical') {
      actions.push({
        id: 'restart_app',
        label: 'Restart Application',
        description: 'Restart the application to clear any unstable state',
        action: () => {
          logger.info('User initiated application restart');
          if (typeof window !== 'undefined' && (window as typeof window & { electron?: { app: { relaunch: () => void } } }).electron) {
            (window as typeof window & { electron: { app: { relaunch: () => void } } }).electron.app.relaunch();
          } else {
            window.location.reload();
          }
        }
      });
    }

    return actions;
  }

  /**
   * Handle unhandled promise rejections
   */
  setupGlobalErrorHandling(): void {
    // Handle unhandled promise rejections
    if (typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', (event) => {
        this.handleError(
          event.reason,
          'unhandledrejection',
          'system',
          'high'
        );
      });

      // Handle uncaught errors
      window.addEventListener('error', (event) => {
        this.handleError(
          event.error || event.message,
          'uncaughtexception',
          'system',
          'high'
        );
      });
    }
  }
}

export const errorHandlingService = ErrorHandlingService.getInstance();