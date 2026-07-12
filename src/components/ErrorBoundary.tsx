import { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '../utils/Logger';
import { errorHandlingService } from '../services/ErrorHandlingService';
import { canvasPoolService } from '../services/CanvasPoolService';
import { imageCacheService } from '../services/ImageCacheService';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorId?: string;
  retryCount: number;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    retryCount: 0
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, retryCount: 0 };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Use error handling service
    const errorId = errorHandlingService.handleError(
      error,
      `ErrorBoundary - ${errorInfo.componentStack?.split('\n')[1] || 'Unknown component'}`,
      'system',
      'high'
    ).id;

    this.setState({ errorId });

    logger.error('Uncaught error:', error);
    logger.error('Error info:', errorInfo);
  }

  private handleRetry = () => {
    const newRetryCount = this.state.retryCount + 1;

    if (newRetryCount <= 3) {
      this.setState({
        hasError: false,
        error: undefined,
        errorId: undefined,
        retryCount: newRetryCount
      });
      logger.info(`Error boundary retry attempt ${newRetryCount}`);
    } else {
      // Force reload after 3 retries
      window.location.reload();
    }
  }

  private handleClearCache = () => {
    try {
      // Clear all caches to resolve potential memory issues
      imageCacheService.clear();
      canvasPoolService.clearPool();

      // Clear browser caches if available
      if ('serviceWorker' in navigator && typeof caches !== 'undefined') {
        caches.keys().then(cacheNames => {
          return Promise.all(cacheNames.map(cache => caches.delete(cache)));
        });
      }

      logger.info('Caches cleared by user');
      this.handleRetry();
    } catch (clearError) {
      logger.error('Failed to clear caches:', clearError);
      window.location.reload();
    }
  }

  private handleReload = () => {
    window.location.reload();
  }

  public render() {
    if (this.state.hasError) {
      const canRetry = this.state.retryCount <= 3;
      const isMemoryError = this.state.error?.message.includes('memory') ||
                           this.state.error?.message.includes('allocation') ||
                           this.state.error?.name === 'OutOfMemoryError';

      return (
        <div className="h-screen flex items-center justify-center bg-dark-900 text-dark-300">
          <div className="text-center max-w-lg p-6">
            <div className="mb-6">
              <svg className="w-20 h-20 mx-auto text-gray-300" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>

            <h2 className="text-2xl font-semibold mb-3">Application Error</h2>

            <p className="text-dark-400 mb-6 leading-relaxed">
              The application encountered an unexpected error and needs to recover.
              {this.state.retryCount > 0 && ` (Attempt ${this.state.retryCount + 1})`}
            </p>

            {/* Error ID for support */}
            {this.state.errorId && (
              <div className="mb-4 text-xs text-dark-500">
                Error ID: <code className="bg-dark-800 px-1 rounded">{this.state.errorId}</code>
              </div>
            )}

            {/* Recovery Actions */}
            <div className="space-y-3 mb-6">
              {canRetry && (
                <button
                  className="w-full px-4 py-3 bg-gray-800 hover:bg-gray-800 rounded-lg text-white font-medium transition-professional"
                  onClick={this.handleRetry}
                >
                  Try Again {this.state.retryCount > 0 && `(${3 - this.state.retryCount} attempts left)`}
                </button>
              )}

              {isMemoryError && (
                <button
                  className="w-full px-4 py-3 bg-gray-800 hover:bg-gray-800 rounded-lg text-white font-medium transition-professional"
                  onClick={this.handleClearCache}
                >
                  Clear Cache & Retry
                </button>
              )}

              <button
                className="w-full px-4 py-2 bg-dark-700 hover:bg-dark-600 rounded-lg text-dark-200 transition-professional"
                onClick={this.handleReload}
              >
                Reload Application
              </button>
            </div>

            {/* Error Details */}
            {this.state.error && (
              <details className="text-left">
                <summary className="cursor-pointer text-sm text-dark-400 hover:text-dark-300 mb-2">
                  Technical Details
                </summary>
                <div className="bg-dark-800 rounded-lg p-3 text-xs">
                  <div className="mb-2">
                    <strong>Error:</strong> {this.state.error.name}
                  </div>
                  <div className="mb-2">
                    <strong>Message:</strong> {this.state.error.message}
                  </div>
                  {this.state.error.stack && (
                    <div>
                      <strong>Stack:</strong>
                      <pre className="mt-1 text-dark-500 whitespace-pre-wrap overflow-auto max-h-32">
                        {this.state.error.stack}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}