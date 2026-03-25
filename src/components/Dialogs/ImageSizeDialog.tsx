import { useState, useEffect } from 'react';
import { X, Link, Unlink } from 'lucide-react';

interface ImageSizeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (newWidth: number, newHeight: number) => void;
  currentWidth: number;
  currentHeight: number;
  mode: 'imageSize' | 'canvasSize';
}

export function ImageSizeDialog({
  isOpen,
  onClose,
  onApply,
  currentWidth,
  currentHeight,
  mode,
}: ImageSizeDialogProps) {
  const [width, setWidth] = useState(currentWidth);
  const [height, setHeight] = useState(currentHeight);
  const [lockAspect, setLockAspect] = useState(true);
  const aspectRatio = currentWidth / currentHeight;

  useEffect(() => {
    setWidth(currentWidth);
    setHeight(currentHeight);
  }, [currentWidth, currentHeight]);

  const handleWidthChange = (val: number) => {
    setWidth(val);
    if (lockAspect && val > 0) {
      setHeight(Math.round(val / aspectRatio));
    }
  };

  const handleHeightChange = (val: number) => {
    setHeight(val);
    if (lockAspect && val > 0) {
      setWidth(Math.round(val * aspectRatio));
    }
  };

  const handleApply = () => {
    if (width > 0 && height > 0 && (width !== currentWidth || height !== currentHeight)) {
      onApply(width, height);
    }
    onClose();
  };

  const scalePercent = currentWidth > 0 ? Math.round((width / currentWidth) * 100) : 100;

  if (!isOpen) return null;

  const title = mode === 'imageSize' ? 'Image Size' : 'Canvas Size';
  const hasImage = currentWidth > 0 && currentHeight > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div
        className="border shadow-xl"
        style={{
          backgroundColor: 'var(--gray-900)',
          borderColor: 'var(--border)',
          width: '340px',
          borderRadius: '4px',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderBottomColor: 'var(--border)' }}
        >
          <h3 className="text-sm font-medium text-white">{title}</h3>
          <button
            className="text-dark-400 hover:text-white bg-transparent border-0 cursor-pointer p-1"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-3">
          {!hasImage ? (
            <p className="text-xs text-dark-400">No image loaded.</p>
          ) : (
            <>
              <div className="text-xs text-dark-400 mb-3">
                Current: {currentWidth} x {currentHeight} px
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="text-xs text-dark-300 block mb-1">Width (px)</label>
                  <input
                    type="number"
                    value={width}
                    min={1}
                    max={16384}
                    onChange={e => handleWidthChange(parseInt(e.target.value) || 0)}
                    className="w-full px-2 py-1 text-xs text-white border bg-transparent"
                    style={{ borderColor: 'var(--border)', borderRadius: '2px' }}
                  />
                </div>

                <button
                  className="mt-4 p-1 bg-transparent border-0 cursor-pointer"
                  onClick={() => setLockAspect(!lockAspect)}
                  title={lockAspect ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                >
                  {lockAspect ? (
                    <Link size={14} className="text-accent-blue" />
                  ) : (
                    <Unlink size={14} className="text-dark-400" />
                  )}
                </button>

                <div className="flex-1">
                  <label className="text-xs text-dark-300 block mb-1">Height (px)</label>
                  <input
                    type="number"
                    value={height}
                    min={1}
                    max={16384}
                    onChange={e => handleHeightChange(parseInt(e.target.value) || 0)}
                    className="w-full px-2 py-1 text-xs text-white border bg-transparent"
                    style={{ borderColor: 'var(--border)', borderRadius: '2px' }}
                  />
                </div>
              </div>

              <div className="text-xs text-dark-400">
                Scale: {scalePercent}%
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 px-4 py-3 border-t"
          style={{ borderTopColor: 'var(--border)' }}
        >
          <button
            className="px-4 py-1.5 text-xs text-dark-300 hover:text-white bg-transparent border cursor-pointer"
            style={{ borderColor: 'var(--border)', borderRadius: '2px' }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-4 py-1.5 text-xs text-white cursor-pointer border-0"
            style={{
              backgroundColor: hasImage ? 'var(--accent-blue)' : 'var(--gray-700)',
              borderRadius: '2px',
              opacity: hasImage ? 1 : 0.5,
            }}
            onClick={handleApply}
            disabled={!hasImage}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
