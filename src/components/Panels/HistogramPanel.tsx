import { useMemo } from 'react';

// Mock histogram data - in a real app, this would be computed from the image
const generateMockHistogram = () => {
  const width = 256;
  const red = new Array(width).fill(0).map((_, i) => Math.max(0, Math.sin(i * 0.02) * 100 + Math.random() * 50));
  const green = new Array(width).fill(0).map((_, i) => Math.max(0, Math.sin(i * 0.015 + 1) * 120 + Math.random() * 60));
  const blue = new Array(width).fill(0).map((_, i) => Math.max(0, Math.sin(i * 0.025 + 2) * 80 + Math.random() * 40));
  const luminance = red.map((r, i) => (r + green[i] + blue[i]) / 3);

  return { red, green, blue, luminance };
};

export function HistogramPanel() {
  const histogram = useMemo(generateMockHistogram, []);
  const maxValue = Math.max(...histogram.luminance);

  const renderChannel = (data: number[], color: string) => {
    return data.map((value, index) => {
      const height = (value / maxValue) * 80; // 80px max height
      return (
        <div
          key={index}
          className="absolute bottom-0"
          style={{
            left: `${(index / 256) * 100}%`,
            width: '0.4%',
            height: `${height}px`,
            backgroundColor: color,
            opacity: 0.7
          }}
        />
      );
    });
  };

  return (
    <div className="bg-dark-850 rounded-lg p-3 mb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium text-dark-300">Histogram</h3>
        <div className="flex space-x-2 text-xs">
          <div className="flex items-center">
            <div className="w-2 h-2 bg-red-500 rounded-full mr-1 opacity-80" />
            <span className="text-dark-300">R</span>
          </div>
          <div className="flex items-center">
            <div className="w-2 h-2 bg-green-500 rounded-full mr-1 opacity-80" />
            <span className="text-dark-300">G</span>
          </div>
          <div className="flex items-center">
            <div className="w-2 h-2 bg-blue-500 rounded-full mr-1 opacity-80" />
            <span className="text-dark-300">B</span>
          </div>
        </div>
      </div>

      {/* Histogram chart */}
      <div className="relative h-20 bg-dark-800 rounded-md border border-dark-700 overflow-hidden">
        {/* Grid lines */}
        <div className="absolute inset-0">
          {[0, 25, 50, 75, 100].map(percent => (
            <div
              key={percent}
              className="absolute w-full border-t border-dark-700 opacity-30"
              style={{ bottom: `${percent}%` }}
            />
          ))}
          {[0, 25, 50, 75, 100].map(percent => (
            <div
              key={percent}
              className="absolute h-full border-l border-dark-700 opacity-30"
              style={{ left: `${percent}%` }}
            />
          ))}
        </div>

        {/* Histogram data */}
        {renderChannel(histogram.red, '#ef4444')}
        {renderChannel(histogram.green, '#22c55e')}
        {renderChannel(histogram.blue, '#3b82f6')}
      </div>

      {/* Shadow/Highlight indicators */}
      <div className="flex justify-between mt-2 text-xs text-dark-300">
        <span>0</span>
        <span>128</span>
        <span>255</span>
      </div>

      {/* RGB values at cursor (mock) */}
      <div className="mt-3 p-2 bg-dark-800 rounded text-xs">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-red-400">R</div>
            <div className="text-dark-300">142</div>
          </div>
          <div>
            <div className="text-green-400">G</div>
            <div className="text-dark-300">156</div>
          </div>
          <div>
            <div className="text-blue-400">B</div>
            <div className="text-dark-300">128</div>
          </div>
        </div>
      </div>
    </div>
  );
}