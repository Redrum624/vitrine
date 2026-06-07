import { Image, Cpu, HardDrive, Zap, Activity } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

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
  const { viewport: _viewport } = useAppStore();

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

  // Get memory usage (if available)
  const getMemoryInfo = (): string => {
    if ('memory' in performance) {
      const memory = (performance as PerformanceWithMemory).memory;
      if (memory) {
        const used = memory.usedJSHeapSize / 1024 / 1024;
        return `${used.toFixed(1)} MB`;
      }
    }
    return '';
  };

  interface PerformanceWithMemory {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }

  return (
    <div className="h-6 border-t flex items-center justify-between px-4 text-xs no-select" style={{backgroundColor: 'var(--gray-850)', borderTopColor: 'var(--border)', color: 'var(--gray-400)'}}>
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
            <div className="w-px h-3" style={{backgroundColor: 'var(--border-light)'}} />
            <span>{formatDimensions(currentImage.width, currentImage.height)}</span>

            {currentImage.size && (
              <>
                <div className="w-px h-3" style={{backgroundColor: 'var(--border-light)'}} />
                <div className="flex items-center space-x-1">
                  <HardDrive className="w-3 h-3" />
                  <span>{formatFileSize(currentImage.size)}</span>
                </div>
              </>
            )}

            {currentImage.type && (
              <>
                <div className="w-px h-3" style={{backgroundColor: 'var(--border-light)'}} />
                <span className="uppercase">{currentImage.type}</span>
              </>
            )}
          </>
        )}

        {/* Processing stats */}
        {processingStats && (
          <>
            <div className="w-px h-3" style={{backgroundColor: 'var(--border-light)'}} />
            <div className="flex items-center space-x-1">
              <Cpu className="w-3 h-3" />
              <span>{processingStats.modulesActive}/{processingStats.totalModules} modules</span>
            </div>

            {processingStats.processingTime > 0 && (
              <>
                <div className="w-px h-3" style={{backgroundColor: 'var(--border-light)'}} />
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

        {/* Memory usage */}
        {getMemoryInfo() && (
          <>
            <div className="flex items-center space-x-1">
              <Activity className="w-3 h-3" />
              <span>{getMemoryInfo()}</span>
            </div>
            <div className="w-px h-3" style={{backgroundColor: 'var(--border-light)'}} />
          </>
        )}

      </div>
    </div>
  );
}