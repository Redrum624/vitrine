import React, { useState, useEffect } from 'react';
import { Camera, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { rawImageService } from '../services/RawImageService';
import { logger } from '../utils/Logger';

interface LibRawStatusProps {
  className?: string;
  showDetails?: boolean;
}

type InitStatus = 'uninit' | 'initializing' | 'ready' | 'error';

export const LibRawStatus: React.FC<LibRawStatusProps> = ({
  className = '',
  showDetails = true
}) => {
  const [status, setStatus] = useState<InitStatus>('uninit');
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    // Only initialize if not already initialized
    if (status === 'uninit') {
      initializeLibRaw();
    }
  }, [status]);

  const initializeLibRaw = async () => {
    setStatus('initializing');
    setError(null);

    try {
      logger.info('Initializing LibRaw WebAssembly service...');
      await rawImageService.initializeLibRaw();

      const libRawStats = rawImageService.getLibRawStats();
      setStats(libRawStats);
      setStatus('ready');

      logger.info('LibRaw WebAssembly service ready');

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      setStatus('error');
      logger.warn('LibRaw initialization failed:', errorMessage);
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'ready':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'initializing':
        return <AlertCircle className="w-4 h-4 text-yellow-500 animate-pulse" />;
      default:
        return <Camera className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'ready':
        return 'LibRaw Ready';
      case 'error':
        return 'LibRaw Error';
      case 'initializing':
        return 'Initializing...';
      default:
        return 'LibRaw Uninit';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'ready':
        return 'text-green-500';
      case 'error':
        return 'text-red-500';
      case 'initializing':
        return 'text-yellow-500';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      {getStatusIcon()}

      <div className="flex flex-col">
        <span className={`text-xs font-medium ${getStatusColor()}`}>
          {getStatusText()}
        </span>

        {showDetails && stats && status === 'ready' && (
          <span className="text-xs text-gray-400">
            {stats.supportedFormats} formats supported
          </span>
        )}

        {error && showDetails && (
          <span className="text-xs text-red-400 max-w-48 truncate" title={error}>
            {error}
          </span>
        )}
      </div>

      {status === 'error' && (
        <button
          onClick={initializeLibRaw}
          className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
          title="Retry initialization"
        >
          Retry
        </button>
      )}
    </div>
  );
};

export default LibRawStatus;