import React, { useState, useEffect, useRef } from 'react';
import { Activity, Database, Cpu, HardDrive } from 'lucide-react';
import { imageCacheService } from '../../services/ImageCacheService';
import { canvasPoolService } from '../../services/CanvasPoolService';
import { errorHandlingService } from '../../services/ErrorHandlingService';
import { computeDropRate } from './computeDropRate';

interface PerformanceMetrics {
  memory: {
    used: number;
    total: number;
    limit: number;
  };
  cache: {
    hitRate: number;
    totalSize: number;
    entries: number;
  };
  canvasPool: {
    active: number;
    total: number;
    memory: string;
  };
  errors: {
    total: number;
    recent: number;
    rate: number;
  };
  fps: number;
  renderTime: number;
  // Windowed frame-drop rate (%) measured against a 60fps target.
  frameDrops: number;
}

export const PerformanceMonitor: React.FC = () => {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const frameCountRef = useRef(0);
  // Initialize with 0, will be set on first update
  const lastTimeRef = useRef(0);

  useEffect(() => {
    let animationFrame: number;
    let intervalId: ReturnType<typeof setInterval>;

    const updateMetrics = () => {
      try {
        // FPS calculation
        const now = Date.now();
        // Initialize lastTimeRef on first call
        if (lastTimeRef.current === 0) {
          lastTimeRef.current = now;
        }
        const deltaTime = now - lastTimeRef.current;
        if (deltaTime >= 1000) {
          const fps = Math.round((frameCountRef.current * 1000) / deltaTime);
          // Windowed frame-drop rate against a 60fps target, from the same frame data.
          const frameDrops = computeDropRate(frameCountRef.current, deltaTime);
          frameCountRef.current = 0;
          lastTimeRef.current = now;

          // Get memory info
          const memory = (performance as typeof performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
          const memoryInfo = {
            used: memory?.usedJSHeapSize || 0,
            total: memory?.totalJSHeapSize || 0,
            limit: memory?.jsHeapSizeLimit || 0
          };

          // Get cache stats
          const cacheStats = imageCacheService.getStats();

          // Get canvas pool stats
          const canvasStats = canvasPoolService.getStats();

          // Get error stats
          const errorStats = errorHandlingService.getErrorStats();

          const newMetrics: PerformanceMetrics = {
            memory: memoryInfo,
            cache: {
              hitRate: cacheStats.hitRate,
              totalSize: cacheStats.totalSize,
              entries: cacheStats.totalEntries
            },
            canvasPool: {
              active: canvasStats.inUseCanvases,
              total: canvasStats.totalCanvases,
              memory: canvasStats.memoryEstimate
            },
            errors: {
              total: (errorStats.total as number) || 0,
              recent: (errorStats.recentErrors as number) || 0,
              rate: 0 // Would calculate based on time window
            },
            fps,
            renderTime: performance.now() - now,
            frameDrops
          };

          setMetrics(newMetrics);
        } else {
          frameCountRef.current += 1;
        }
      } catch (error) {
        console.warn('Performance monitoring error:', error);
      }
    };

    const animate = () => {
      updateMetrics();
      animationFrame = requestAnimationFrame(animate);
    };

    if (isVisible) {
      animate();
      intervalId = setInterval(updateMetrics, 1000);
    }

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isVisible]);

  // Keyboard shortcut to toggle
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Ctrl+Shift+P to toggle performance monitor
      if (event.ctrlKey && event.shiftKey && event.key === 'P') {
        event.preventDefault();
        setIsVisible(prev => !prev);
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, []);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  if (!isVisible || !metrics) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 bg-dark-800/95 backdrop-blur-sm border border-dark-600 rounded-lg p-4 min-w-[300px] z-50 text-xs font-mono">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-dark-200 flex items-center">
          <Activity className="w-4 h-4 mr-2" />
          Performance Monitor
        </h3>
        <button
          onClick={() => setIsVisible(false)}
          className="text-dark-400 hover:text-dark-200 transition-colors"
        >
          ×
        </button>
      </div>

      <div className="space-y-3">
        {/* FPS and Render Time */}
        <div className="flex items-center space-x-2">
          <Cpu className="w-4 h-4 text-gray-300" />
          <div className="flex-1">
            <div className="flex justify-between">
              <span className="text-dark-300">FPS</span>
              <span className={`${metrics.fps < 30 ? 'text-gray-300' : metrics.fps < 45 ? 'text-gray-300' : 'text-gray-300'}`}>
                {metrics.fps}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-dark-300">Render</span>
              <span className="text-dark-400">{metrics.renderTime.toFixed(2)}ms</span>
            </div>
            <div className="flex justify-between">
              <span className="text-dark-300">Frame Drops</span>
              <span className="text-dark-400">{metrics.frameDrops.toFixed(1)}%</span>
            </div>
          </div>
        </div>

        {/* Memory Usage */}
        <div className="flex items-center space-x-2">
          <HardDrive className="w-4 h-4 text-gray-300" />
          <div className="flex-1">
            <div className="flex justify-between">
              <span className="text-dark-300">Memory</span>
              <span className="text-dark-400">
                {formatBytes(metrics.memory.used)} / {formatBytes(metrics.memory.total)}
              </span>
            </div>
            <div className="w-full bg-dark-700 rounded-full h-2 mt-1">
              <div
                className={`h-2 rounded-full transition-all duration-300 ${
                  metrics.memory.used / metrics.memory.total > 0.8 ? 'bg-gray-800' :
                  metrics.memory.used / metrics.memory.total > 0.6 ? 'bg-gray-800' : 'bg-gray-800'
                }`}
                style={{
                  width: `${Math.min(100, (metrics.memory.used / metrics.memory.total) * 100)}%`
                }}
              />
            </div>
          </div>
        </div>

        {/* Cache Performance */}
        <div className="flex items-center space-x-2">
          <Database className="w-4 h-4 text-gray-300" />
          <div className="flex-1">
            <div className="flex justify-between">
              <span className="text-dark-300">Cache Hit Rate</span>
              <span className={`${
                metrics.cache.hitRate > 80 ? 'text-gray-300' :
                metrics.cache.hitRate > 50 ? 'text-gray-300' : 'text-gray-300'
              }`}>
                {metrics.cache.hitRate.toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-dark-300">Entries</span>
              <span className="text-dark-400">{metrics.cache.entries}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-dark-300">Size</span>
              <span className="text-dark-400">{formatBytes(metrics.cache.totalSize)}</span>
            </div>
          </div>
        </div>

        {/* Canvas Pool */}
        <div>
          <div className="flex justify-between">
            <span className="text-dark-300">Canvas Pool</span>
            <span className="text-dark-400">
              {metrics.canvasPool.active}/{metrics.canvasPool.total}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-dark-300">Pool Memory</span>
            <span className="text-dark-400">{metrics.canvasPool.memory}</span>
          </div>
        </div>

        {/* Error Stats */}
        {metrics.errors.total > 0 && (
          <div>
            <div className="flex justify-between">
              <span className="text-dark-300">Errors</span>
              <span className={`${
                metrics.errors.recent > 0 ? 'text-gray-300' : 'text-dark-400'
              }`}>
                {metrics.errors.total}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-dark-300">Recent</span>
              <span className="text-dark-400">{metrics.errors.recent}</span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-dark-700 text-dark-500 text-center">
        Ctrl+Shift+P to toggle
      </div>
    </div>
  );
};