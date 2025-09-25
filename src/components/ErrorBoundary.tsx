import { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '../utils/Logger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('Uncaught error:', error);
    logger.error('Error info:', errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen flex items-center justify-center bg-dark-900 text-dark-300">
          <div className="text-center max-w-md">
            <div className="mb-4">
              <svg className="w-16 h-16 mx-auto text-red-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-dark-400 mb-4">
              The application encountered an unexpected error.
            </p>
            {this.state.error && (
              <details className="text-left text-sm text-dark-500 mb-4">
                <summary className="cursor-pointer mb-2">Error details</summary>
                <pre className="bg-dark-800 p-2 rounded overflow-auto">
                  {this.state.error.toString()}
                </pre>
              </details>
            )}
            <button
              className="px-4 py-2 bg-dark-700 hover:bg-dark-600 rounded text-dark-200 transition-professional"
              onClick={() => window.location.reload()}
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}