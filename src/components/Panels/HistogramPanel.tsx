import { useMemo, useEffect, useState } from 'react';
import { imageService } from '../../services/ImageService';
import { useAppStore } from '../../stores/appStore';

interface HistogramData {
  red: number[];
  green: number[];
  blue: number[];
  luminance: number[];
}

const computeHistogram = (imageData: Float32Array, width: number, height: number): HistogramData => {
  const bins = 256;
  const red = new Array(bins).fill(0);
  const green = new Array(bins).fill(0);
  const blue = new Array(bins).fill(0);
  const luminance = new Array(bins).fill(0);

  // Process each pixel
  const totalPixels = width * height;
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;

    // Get RGB values (0-1 range) and convert to 0-255 range
    const r = Math.min(255, Math.max(0, Math.floor(imageData[idx] * 255)));
    const g = Math.min(255, Math.max(0, Math.floor(imageData[idx + 1] * 255)));
    const b = Math.min(255, Math.max(0, Math.floor(imageData[idx + 2] * 255)));

    // Increment histogram bins
    red[r]++;
    green[g]++;
    blue[b]++;

    // Compute luminance using standard coefficients (ITU-R BT.709)
    const lum = Math.min(255, Math.max(0, Math.floor((0.2126 * r) + (0.7152 * g) + (0.0722 * b))));
    luminance[lum]++;
  }

  return { red, green, blue, luminance };
};

export function HistogramPanel() {
  const { processedImageData } = useAppStore();
  const [histogram, setHistogram] = useState<HistogramData>({
    red: new Array(256).fill(0),
    green: new Array(256).fill(0),
    blue: new Array(256).fill(0),
    luminance: new Array(256).fill(0)
  });

  // Compute histogram from processed image or current image
  useEffect(() => {
    const computeFromImage = () => {
      // Use processed image if available, otherwise use current image
      if (processedImageData && typeof processedImageData === 'object' && 'data' in processedImageData) {
        // ProcessedImageData type
        const newHistogram = computeHistogram(
          processedImageData.data,
          processedImageData.width,
          processedImageData.height
        );
        setHistogram(newHistogram);
      } else {
        const currentImage = imageService.getCurrentImage();
        if (currentImage) {
          const newHistogram = computeHistogram(
            currentImage.data,
            currentImage.width,
            currentImage.height
          );
          setHistogram(newHistogram);
        }
      }
    };

    computeFromImage();

    // Listen for image changes
    const cleanup = imageService.addImageLoadListener(() => {
      computeFromImage();
    });

    return cleanup;
  }, [processedImageData]);

  const maxValue = Math.max(...histogram.luminance);

  // Calculate average RGB values from histogram
  const avgRGB = useMemo(() => {
    const calculateAverage = (channel: number[]) => {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < channel.length; i++) {
        sum += i * channel[i];
        count += channel[i];
      }
      return count > 0 ? Math.round(sum / count) : 0;
    };

    return {
      r: calculateAverage(histogram.red),
      g: calculateAverage(histogram.green),
      b: calculateAverage(histogram.blue)
    };
  }, [histogram]);

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
    <div className="px-4 py-2" style={{backgroundColor: 'var(--gray-900)'}}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{color: 'var(--gray-400)', letterSpacing: '1px'}}>Histogram</h3>
        <div className="flex items-center gap-3">
          <button
            className="text-xs px-2 py-1 rounded border"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--gray-400)',
              backgroundColor: 'transparent',
              transition: 'var(--transition-fast)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--gray-800)';
              e.currentTarget.style.borderColor = 'var(--border-light)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.borderColor = 'var(--border)';
            }}
          >
            RGB
          </button>
        </div>
      </div>

      {/* Histogram chart - taller and more prominent */}
      <div className="relative rounded border overflow-hidden" style={{height: '120px', backgroundColor: 'var(--black)', borderColor: 'var(--border)'}}>
        {/* Subtle grid lines */}
        <div className="absolute inset-0" style={{opacity: 0.15}}>
          {[25, 50, 75].map(percent => (
            <div
              key={percent}
              className="absolute w-full"
              style={{ bottom: `${percent}%`, height: '1px', backgroundColor: 'var(--gray-600)' }}
            />
          ))}
        </div>

        {/* Histogram data */}
        {renderChannel(histogram.red, '#ef4444')}
        {renderChannel(histogram.green, '#22c55e')}
        {renderChannel(histogram.blue, '#3b82f6')}
      </div>

      {/* Exposure indicators */}
      <div className="flex justify-between items-center mt-1.5">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm" style={{backgroundColor: 'var(--black)', border: '1px solid var(--border)'}} />
          <span className="text-xs" style={{color: 'var(--gray-500)'}}>Shadows</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm" style={{backgroundColor: 'var(--gray-500)'}} />
          <span className="text-xs" style={{color: 'var(--gray-500)'}}>Midtones</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm" style={{backgroundColor: 'var(--white)'}} />
          <span className="text-xs" style={{color: 'var(--gray-500)'}}>Highlights</span>
        </div>
      </div>

      {/* RGB values - compact grid */}
      <div className="mt-2 p-2 rounded border" style={{backgroundColor: 'var(--gray-850)', borderColor: 'var(--border)'}}>
        <div className="grid grid-cols-3 gap-3 text-center text-xs">
          <div>
            <div style={{color: '#ef4444', fontSize: '10px', fontWeight: 600, marginBottom: '2px'}}>R</div>
            <div className="font-mono" style={{color: 'var(--gray-200)', fontSize: '13px', fontWeight: 500}}>{avgRGB.r}</div>
          </div>
          <div>
            <div style={{color: '#22c55e', fontSize: '10px', fontWeight: 600, marginBottom: '2px'}}>G</div>
            <div className="font-mono" style={{color: 'var(--gray-200)', fontSize: '13px', fontWeight: 500}}>{avgRGB.g}</div>
          </div>
          <div>
            <div style={{color: '#3b82f6', fontSize: '10px', fontWeight: 600, marginBottom: '2px'}}>B</div>
            <div className="font-mono" style={{color: 'var(--gray-200)', fontSize: '13px', fontWeight: 500}}>{avgRGB.b}</div>
          </div>
        </div>
      </div>
    </div>
  );
}