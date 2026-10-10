import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { AccentButton } from './Controls/AccentButton';
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
        <div
          className="h-screen flex items-center justify-center"
          style={{ background: 'var(--vt-canvas)', color: 'var(--vt-text)', fontFamily: 'var(--font-ui)' }}
          role="alert"
        >
          <div
            className="vt-pop-in"
            style={{
              width: 420, maxWidth: 'calc(100vw - 32px)', padding: 24, borderRadius: 'var(--radius-10)',
              background: 'var(--vt-popover)', boxShadow: 'var(--shadow-popover)', border: '1px solid var(--vt-line-soft)',
            }}
          >
            <div className="flex items-start" style={{ gap: 12, marginBottom: 18 }}>
              <AlertTriangle size={20} strokeWidth={1.8} style={{ color: 'var(--accent)', flex: 'none', marginTop: 1 }} />
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Vitrine ran into a problem</h2>
                <p style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--vt-text-2)', margin: '6px 0 0' }}>
                  Your photos and saved edits are safe on disk. Try again, or reload the window.
                  {this.state.retryCount > 0 && ` (Attempt ${this.state.retryCount + 1})`}
                </p>
              </div>
            </div>

            {/* Recovery Actions */}
            <div className="flex flex-col" style={{ gap: 8 }}>
              {canRetry && (
                <AccentButton fullWidth onClick={this.handleRetry}>
                  Try Again {this.state.retryCount > 0 && `(${3 - this.state.retryCount} attempts left)`}
                </AccentButton>
              )}

              {isMemoryError && (
                <button type="button" className="glass-modal-btn-secondary" style={{ width: '100%' }} onClick={this.handleClearCache}>
                  Clear Cache & Retry
                </button>
              )}

              <button type="button" className="glass-modal-btn-secondary" style={{ width: '100%' }} onClick={this.handleReload}>
                Reload Window
              </button>
            </div>

            {/* Error Details */}
            {this.state.error && (
              <details style={{ marginTop: 18 }}>
                <summary style={{ fontSize: 12, color: 'var(--vt-text-3)' }}>
                  Technical details{this.state.errorId ? ` · ${this.state.errorId}` : ''}
                </summary>
                <div
                  style={{
                    marginTop: 8, padding: 10, borderRadius: 'var(--radius-6)', background: 'var(--vt-field)',
                    border: '1px solid var(--vt-line-soft)', fontSize: 11.5, color: 'var(--vt-text-2)', userSelect: 'text',
                  }}
                >
                  <div style={{ marginBottom: 4 }}>
                    <strong style={{ color: 'var(--vt-text)' }}>{this.state.error.name}:</strong> {this.state.error.message}
                  </div>
                  {this.state.error.stack && (
                    <pre
                      className="whitespace-pre-wrap overflow-auto"
                      style={{ maxHeight: 128, margin: 0, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--vt-text-3)' }}
                    >
                      {this.state.error.stack}
                    </pre>
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