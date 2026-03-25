import React, { useRef, useEffect, useState } from 'react';
import { BarChart3, AlertTriangle, TrendingUp } from 'lucide-react';
import { HistogramData } from '../services/RawHistogramService';

interface HistogramDisplayProps {
  histogramData: HistogramData | null;
  width?: number;
  height?: number;
  showChannels?: boolean;
  showClippingWarnings?: boolean;
  showStatistics?: boolean;
  className?: string;
}

export const HistogramDisplay: React.FC<HistogramDisplayProps> = ({
  histogramData,
  width = 256,
  height = 120,
  showChannels = true,
  showClippingWarnings = true,
  showStatistics = true,
  className = ''
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activeChannel, setActiveChannel] = useState<'luminance' | 'red' | 'green' | 'blue'>('luminance');

  useEffect(() => {
    if (!histogramData || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = width;
    canvas.height = height;

    // Clear canvas
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, width, height);

    // Get the histogram data for the active channel
    const data = histogramData[activeChannel];
    const maxValue = Math.max(...data);

    if (maxValue === 0) return;

    // Draw histogram
    const barWidth = width / data.length;

    for (let i = 0; i < data.length; i++) {
      const barHeight = (data[i] / maxValue) * height;
      const x = i * barWidth;
      const y = height - barHeight;

      // Set color based on channel
      switch (activeChannel) {
        case 'red':
          ctx.fillStyle = `rgba(239, 68, 68, 0.8)`; // red-500
          break;
        case 'green':
          ctx.fillStyle = `rgba(34, 197, 94, 0.8)`; // green-500
          break;
        case 'blue':
          ctx.fillStyle = `rgba(59, 130, 246, 0.8)`; // blue-500
          break;
        case 'luminance':
        default:
          ctx.fillStyle = `rgba(156, 163, 175, 0.8)`; // gray-400
          break;
      }

      ctx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight);
    }

    // Draw clipping indicators if enabled
    if (showClippingWarnings) {
      const totalPixels = histogramData.exposure.underexposed +
        histogramData.exposure.overexposed +
        histogramData.exposure.wellExposed;

      // Shadow clipping indicator (left side)
      const shadowClipRatio = histogramData.clipping.shadows.total / totalPixels;
      if (shadowClipRatio > 0.01) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.6)'; // red with transparency
        ctx.fillRect(0, 0, 10, height);
      }

      // Highlight clipping indicator (right side)
      const highlightClipRatio = histogramData.clipping.highlights.total / totalPixels;
      if (highlightClipRatio > 0.01) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.6)'; // red with transparency
        ctx.fillRect(width - 10, 0, 10, height);
      }
    }

  }, [histogramData, activeChannel, width, height, showClippingWarnings]);

  if (!histogramData) {
    return (
      <div className={`bg-gray-800 rounded-lg p-4 ${className}`}>
        <div className="flex items-center gap-2 text-gray-400">
          <BarChart3 className="w-4 h-4" />
          <span className="text-sm">No histogram data available</span>
        </div>
      </div>
    );
  }

  const totalPixels = histogramData.exposure.underexposed +
    histogramData.exposure.overexposed +
    histogramData.exposure.wellExposed;

  const shadowClipPercent = ((histogramData.clipping.shadows.total / totalPixels) * 100).toFixed(1);
  const highlightClipPercent = ((histogramData.clipping.highlights.total / totalPixels) * 100).toFixed(1);

  return (
    <div className={`bg-gray-900 rounded-lg border border-l border-dark-700 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-gray-300" />
          <span className="text-sm font-medium text-white">RAW Histogram</span>
        </div>

        {/* Channel Selection */}
        {showChannels && (
          <div className="flex gap-1">
            {(['luminance', 'red', 'green', 'blue'] as const).map((channel) => (
              <button
                key={channel}
                onClick={() => setActiveChannel(channel)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  activeChannel === channel
                    ? channel === 'red'
                      ? 'bg-gray-800 text-white'
                      : channel === 'green'
                      ? 'bg-gray-800 text-white'
                      : channel === 'blue'
                      ? 'bg-gray-800 text-white'
                      : 'bg-gray-500 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {channel === 'luminance' ? 'RGB' : channel.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Histogram Canvas */}
      <div className="p-3">
        <div className="bg-gray-900 rounded border border-gray-600 relative">
          <canvas
            ref={canvasRef}
            className="w-full h-auto block rounded"
            style={{ imageRendering: 'pixelated' }}
          />

          {/* Clipping Warning Overlays */}
          {showClippingWarnings && (
            <>
              {parseFloat(shadowClipPercent) > 1 && (
                <div className="absolute left-1 top-1 bg-gray-800 text-white text-xs px-1 py-0.5 rounded">
                  Shadow
                </div>
              )}
              {parseFloat(highlightClipPercent) > 1 && (
                <div className="absolute right-1 top-1 bg-gray-800 text-white text-xs px-1 py-0.5 rounded">
                  Highlight
                </div>
              )}
            </>
          )}
        </div>

        {/* Statistics */}
        {showStatistics && (
          <div className="mt-3 space-y-2">
            {/* Channel Statistics */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-gray-700 rounded p-2">
                <div className="text-gray-400 mb-1">Mean</div>
                <div className="text-white font-mono">
                  {(histogramData.channels[activeChannel].mean * 100).toFixed(1)}%
                </div>
              </div>
              <div className="bg-gray-700 rounded p-2">
                <div className="text-gray-400 mb-1">Median</div>
                <div className="text-white font-mono">
                  {(histogramData.channels[activeChannel].median * 100).toFixed(1)}%
                </div>
              </div>
            </div>

            {/* Clipping Analysis */}
            {showClippingWarnings && (parseFloat(shadowClipPercent) > 0 || parseFloat(highlightClipPercent) > 0) && (
              <div className="bg-amber-900/20 border border-amber-500/20 rounded p-2">
                <div className="flex items-center gap-1 mb-1">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  <span className="text-xs font-medium text-amber-400">Clipping Detected</span>
                </div>
                <div className="text-xs text-amber-200 space-y-1">
                  {parseFloat(shadowClipPercent) > 0 && (
                    <div>Shadows: {shadowClipPercent}% clipped</div>
                  )}
                  {parseFloat(highlightClipPercent) > 0 && (
                    <div>Highlights: {highlightClipPercent}% clipped</div>
                  )}
                </div>
              </div>
            )}

            {/* Exposure Analysis */}
            <div className="bg-gray-800 border border-gray-600 rounded p-2">
              <div className="flex items-center gap-1 mb-1">
                <TrendingUp className="w-3 h-3 text-gray-300" />
                <span className="text-xs font-medium text-gray-300">Exposure Balance</span>
              </div>
              <div className="grid grid-cols-3 gap-1 text-xs">
                <div className="text-center">
                  <div className="text-gray-400">Under</div>
                  <div className="text-white font-mono">
                    {((histogramData.exposure.underexposed / totalPixels) * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-gray-400">Well</div>
                  <div className="text-gray-300 font-mono">
                    {((histogramData.exposure.wellExposed / totalPixels) * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-gray-400">Over</div>
                  <div className="text-white font-mono">
                    {((histogramData.exposure.overexposed / totalPixels) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};