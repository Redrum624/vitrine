import React from 'react';
import { Clock, Image, Cpu, HardDrive, Zap, Activity } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { imageService } from '../../services/ImageService';

interface StatusBarProps {
  currentImage?: {
    name: string;
    width?: number;
    height?: number;
    size?: number;
    type?: string;
  } | null;
  processingStats?: {
    processingTime: number;
    modulesActive: number;
    totalModules: number;
  };
}

export function StatusBar({ currentImage, processingStats }: StatusBarProps) {
  const { viewport } = useAppStore();

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Format dimensions
  const formatDimensions = (width?: number, height?: number): string => {
    if (!width || !height) return 'No image';
    const megapixels = ((width * height) / 1000000).toFixed(1);
    return `${width} × ${height} (${megapixels} MP)`;
  };

  // Get current time
  const getCurrentTime = (): string => {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const [currentTime, setCurrentTime] = React.useState(getCurrentTime());

  // Update time every minute
  React.useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(getCurrentTime());
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  // Get memory usage (if available)
  const getMemoryInfo = (): string => {
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      const used = memory.usedJSHeapSize / 1024 / 1024;
      return `${used.toFixed(1)} MB`;
    }
    return '';
  };

  return (
    <div className="h-6 bg-dark-850 border-t border-dark-700 flex items-center justify-between px-4 text-xs text-dark-400 no-select">
      {/* Left side - Image info */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-1">
          <Image className="w-3 h-3" />
          <span>
            {currentImage ? currentImage.name : 'No image loaded'}
          </span>
        </div>

        {currentImage && (
          <>
            <div className="w-px h-3 bg-dark-600" />
            <span>{formatDimensions(currentImage.width, currentImage.height)}</span>

            {currentImage.size && (
              <>
                <div className="w-px h-3 bg-dark-600" />
                <div className="flex items-center space-x-1">
                  <HardDrive className="w-3 h-3" />
                  <span>{formatFileSize(currentImage.size)}</span>
                </div>
              </>
            )}

            {currentImage.type && (
              <>
                <div className="w-px h-3 bg-dark-600" />
                <span className="uppercase">{currentImage.type}</span>
              </>
            )}
          </>
        )}

        {/* Processing stats */}
        {processingStats && (
          <>
            <div className="w-px h-3 bg-dark-600" />
            <div className="flex items-center space-x-1">
              <Cpu className="w-3 h-3" />
              <span>{processingStats.modulesActive}/{processingStats.totalModules} modules</span>
            </div>

            {processingStats.processingTime > 0 && (
              <>
                <div className="w-px h-3 bg-dark-600" />
                <div className="flex items-center space-x-1">
                  <Zap className="w-3 h-3" />
                  <span>{processingStats.processingTime.toFixed(1)}ms</span>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Right side - System info */}
      <div className="flex items-center space-x-4">
        {/* Zoom level */}
        <span>{Math.round(viewport.zoom * 100)}%</span>

        <div className="w-px h-3 bg-dark-600" />

        {/* Memory usage */}
        {getMemoryInfo() && (
          <>
            <div className="flex items-center space-x-1">
              <Activity className="w-3 h-3" />
              <span>{getMemoryInfo()}</span>
            </div>
            <div className="w-px h-3 bg-dark-600" />
          </>
        )}

        {/* Current time */}
        <div className="flex items-center space-x-1">
          <Clock className="w-3 h-3" />
          <span>{currentTime}</span>
        </div>
      </div>
    </div>
  );
}