import { useMemo, useEffect, useRef, useState } from 'react';
import { imageService } from '../../services/ImageService';
import { useAppStore } from '../../stores/appStore';
import { gpuPreviewPipeline } from '../../shaders/GpuPreviewPipeline';

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
  const { processedImageData, gpuResultVersion, renderMode } = useAppStore();
  const [histogram, setHistogram] = useState<HistogramData>({
    red: new Array(256).fill(0),
    green: new Array(256).fill(0),
    blue: new Array(256).fill(0),
    luminance: new Array(256).fill(0)
  });
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Compute histogram from processed image or current image.
  // In GPU mode we read back the result texture directly so the histogram
  // reflects the live edit independent of the laggy shared CPU readback.
  useEffect(() => {
    const computeFromImage = () => {
      if (renderMode === 'gpu') {
        try {
          const pixels = gpuPreviewPipeline.readback();
          const { width, height } = gpuPreviewPipeline.getSize();
          if (pixels && width > 0 && height > 0) {
            setHistogram(computeHistogram(pixels, width, height));
            return;
          }
        } catch {
          // GPU not ready — fall through to CPU path below
        }
      }

      // CPU mode (or GPU fallback)
      if (processedImageData && typeof processedImageData === 'object' && 'data' in processedImageData) {
        setHistogram(computeHistogram(
          processedImageData.data,
          processedImageData.width,
          processedImageData.height
        ));
      } else {
        const currentImage = imageService.getCurrentImage();
        if (currentImage) {
          setHistogram(computeHistogram(
            currentImage.data,
            currentImage.width,
            currentImage.height
          ));
        }
      }
    };

    // Debounce GPU readbacks so a fast slider drag doesn't force a readback every frame.
    // CPU mode is cheap enough to run immediately (no extra readPixels call).
    const scheduleCompute = () => {
      if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
      if (renderMode === 'gpu') {
        debounceTimer.current = setTimeout(() => {
          debounceTimer.current = null;
          computeFromImage();
        }, 120);
      } else {
        computeFromImage();
      }
    };

    scheduleCompute();

    // Listen for image load/switch events
    const cleanup = imageService.addImageLoadListener(() => {
      scheduleCompute();
    });

    return () => {
      cleanup();
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    };
  }, [processedImageData, gpuResultVersion, renderMode]);

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

  // DOM-div bars (unchanged rendering) recoloured to the spec's RGB fills at 55%.
  const renderChannel = (data: number[], color: string) => {
    return data.map((value, index) => {
      const height = (value / maxValue) * 96; // scale into the 104px chart
      return (
        <div
          key={index}
          className="absolute bottom-0"
          style={{
            left: `${(index / 256) * 100}%`,
            width: '0.4%',
            height: `${height}px`,
            backgroundColor: color,
            opacity: 0.55,
          }}
        />
      );
    });
  };

  return (
    <div className="glass-card dc-rise" style={{ padding: 14, overflow: 'hidden' }}>
      {/* Header row: HISTOGRAM + inline R · G · B mono averages */}
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--glass-text-muted)' }}>
          HISTOGRAM
        </span>
        <span
          data-testid="histogram-averages"
          style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10.5, letterSpacing: '.3px', color: 'var(--glass-text-muted)' }}
        >
          R {avgRGB.r} · G {avgRGB.g} · B {avgRGB.b}
        </span>
      </div>

      {/* Chart: 104px tall, radius 12, near-black gradient */}
      <div
        className="relative overflow-hidden"
        style={{
          height: 104,
          borderRadius: 12,
          background: 'linear-gradient(180deg, #0d0d10 0%, #050506 100%)',
          border: '1px solid var(--glass-border)',
        }}
      >
        {renderChannel(histogram.red, '#f87171')}
        {renderChannel(histogram.green, '#4ade80')}
        {renderChannel(histogram.blue, '#60a5fa')}
      </div>
    </div>
  );
}