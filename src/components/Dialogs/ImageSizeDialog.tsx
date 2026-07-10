import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { Link, Unlink } from 'lucide-react';
import { GlassModal } from './GlassModal';

interface ImageSizeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (newWidth: number, newHeight: number) => void;
  currentWidth: number;
  currentHeight: number;
  mode: 'imageSize' | 'canvasSize';
}

const inputStyle: CSSProperties = {
  width: '100%',
  fontSize: 12,
  padding: '6px 8px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,.1)',
  background: 'rgba(255,255,255,.04)',
  color: 'var(--glass-text-label)',
};

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

  const title = mode === 'imageSize' ? 'Image Size' : 'Canvas Size';
  const hasImage = currentWidth > 0 && currentHeight > 0;

  const footer = (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        className="glass-modal-btn-secondary"
        style={{
          padding: '9px 16px', borderRadius: 10, fontSize: 12, fontWeight: 500,
          border: '1px solid rgba(255,255,255,.1)', background: 'transparent', color: 'var(--glass-text-secondary)',
        }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={handleApply}
        disabled={!hasImage}
        style={{
          padding: '9px 18px', borderRadius: 11,
          border: '1px solid var(--accent-ring)',
          background: 'var(--accent)', color: '#0b0b0c', fontSize: 12.5, fontWeight: 700,
          cursor: hasImage ? 'pointer' : 'not-allowed',
          opacity: hasImage ? 1 : 0.5,
          boxShadow: hasImage ? '0 2px 18px var(--accent-ring)' : 'none',
        }}
      >
        Apply
      </button>
    </div>
  );

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      cardClassName="w-full"
      cardStyle={{ width: 340 }}
      footer={footer}
    >
      <div className="flex flex-col" style={{ gap: 12, padding: 16 }}>
        {!hasImage ? (
          <p style={{ fontSize: 11.5, color: 'var(--glass-text-muted)' }}>No image loaded.</p>
        ) : (
          <>
            <div style={{ fontSize: 11.5, color: 'var(--glass-text-muted)' }}>
              Current: {currentWidth} x {currentHeight} px
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--glass-text-label)', display: 'block', marginBottom: 4 }}>Width (px)</label>
                <input
                  type="number"
                  value={width}
                  min={1}
                  max={16384}
                  onChange={e => handleWidthChange(parseInt(e.target.value) || 0)}
                  style={inputStyle}
                />
              </div>

              <button
                type="button"
                className="glass-pill-btn inline-flex items-center justify-center"
                style={{ marginTop: 18, padding: 6, borderRadius: 7, color: lockAspect ? 'var(--accent)' : 'var(--glass-text-muted)' }}
                onClick={() => setLockAspect(!lockAspect)}
                title={lockAspect ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
              >
                {lockAspect ? <Link size={14} /> : <Unlink size={14} />}
              </button>

              <div className="flex-1">
                <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--glass-text-label)', display: 'block', marginBottom: 4 }}>Height (px)</label>
                <input
                  type="number"
                  value={height}
                  min={1}
                  max={16384}
                  onChange={e => handleHeightChange(parseInt(e.target.value) || 0)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ fontSize: 11.5, color: 'var(--glass-text-muted)' }}>
              Scale: {scalePercent}%
            </div>
          </>
        )}
      </div>
    </GlassModal>
  );
}
