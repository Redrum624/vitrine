import React, { useRef, useEffect, useCallback } from 'react';

interface ColorWheelProps {
  cyanRed: number;
  magentaGreen: number;
  yellowBlue: number;
  onChange: (values: { cyanRed: number; magentaGreen: number; yellowBlue: number }) => void;
  size?: number;
  disabled?: boolean;
}

const ColorWheel: React.FC<ColorWheelProps> = ({
  cyanRed,
  magentaGreen,
  yellowBlue,
  onChange,
  size = 120,
  disabled = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const [canvasSize, setCanvasSize] = React.useState(size);

  const drawWheel = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const centerX = canvasSize / 2;
    const centerY = canvasSize / 2;
    const radius = canvasSize / 2 - 5;

    // Clear canvas
    ctx.clearRect(0, 0, canvasSize, canvasSize);

    // Draw color wheel background
    const imageData = ctx.createImageData(canvasSize, canvasSize);
    const data = imageData.data;

    for (let y = 0; y < canvasSize; y++) {
      for (let x = 0; x < canvasSize; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= radius) {
          // Calculate hue from angle
          const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
          // Calculate saturation from distance
          const saturation = Math.min(distance / radius, 1);

          // Convert HSL to RGB
          const h = hue / 60;
          const s = saturation;
          const l = 0.5;

          const c = (1 - Math.abs(2 * l - 1)) * s;
          const x1 = c * (1 - Math.abs((h % 2) - 1));
          const m = l - c / 2;

          let r, g, b;
          if (h < 1) { r = c; g = x1; b = 0; }
          else if (h < 2) { r = x1; g = c; b = 0; }
          else if (h < 3) { r = 0; g = c; b = x1; }
          else if (h < 4) { r = 0; g = x1; b = c; }
          else if (h < 5) { r = x1; g = 0; b = c; }
          else { r = c; g = 0; b = x1; }

          const pixelIndex = (y * canvasSize + x) * 4;
          data[pixelIndex] = Math.round((r + m) * 255);
          data[pixelIndex + 1] = Math.round((g + m) * 255);
          data[pixelIndex + 2] = Math.round((b + m) * 255);
          data[pixelIndex + 3] = 255;
        } else {
          // Outside circle - transparent
          const pixelIndex = (y * canvasSize + x) * 4;
          data[pixelIndex + 3] = 0;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Calculate point position from cyan-red and magenta-green values
    // Convert to polar coordinates
    const distance = Math.sqrt(cyanRed * cyanRed + magentaGreen * magentaGreen) * (radius - 5);
    const angle = Math.atan2(magentaGreen, cyanRed);

    const x = centerX + Math.cos(angle) * distance;
    const y = centerY + Math.sin(angle) * distance;

    // Draw selection point
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }, [cyanRed, magentaGreen, canvasSize]);

  const handleMouseMove = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (!isDraggingRef.current || disabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const centerX = canvasSize / 2;
    const centerY = canvasSize / 2;
    const radius = canvasSize / 2 - 5;

    const x = e.clientX - rect.left - centerX;
    const y = e.clientY - rect.top - centerY;

    // Constrain to circle
    const distance = Math.sqrt(x * x + y * y);
    const constrainedDistance = Math.min(distance, radius - 5);

    // Convert back to cyan-red and magenta-green values
    const normalizedDistance = constrainedDistance / (radius - 5);
    const angle = Math.atan2(y, x);

    const newCyanRed = Math.cos(angle) * normalizedDistance;
    const newMagentaGreen = Math.sin(angle) * normalizedDistance;

    onChange({
      cyanRed: Math.max(-1, Math.min(1, newCyanRed)),
      magentaGreen: Math.max(-1, Math.min(1, newMagentaGreen)),
      yellowBlue
    });
  }, [disabled, canvasSize, yellowBlue, onChange]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    isDraggingRef.current = true;
    handleMouseMove(e);
  }, [disabled, handleMouseMove]);

  const handleDoubleClick = useCallback(() => {
    if (disabled) return;
    // Reset to center (0, 0)
    onChange({
      cyanRed: 0,
      magentaGreen: 0,
      yellowBlue
    });
  }, [disabled, yellowBlue, onChange]);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => handleMouseMove(e);
    const handleGlobalMouseUp = () => handleMouseUp();

    if (isDraggingRef.current) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  useEffect(() => {
    drawWheel();
  }, [drawWheel]);

  // Update canvas size based on container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const width = container.clientWidth;
      // Make it square and leave some padding
      const newSize = Math.min(width, 300);
      setCanvasSize(newSize);
    };

    updateSize();
    const resizeObserver = new window.ResizeObserver(updateSize);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="flex flex-col items-center w-full">
      <canvas
        ref={canvasRef}
        width={canvasSize}
        height={canvasSize}
        className={`${disabled ? 'opacity-50' : 'cursor-pointer'}`}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        title="Double-click to reset to center"
      />
    </div>
  );
};

export default ColorWheel;