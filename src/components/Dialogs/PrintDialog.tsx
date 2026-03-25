import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Printer, Layout, X, Sliders } from 'lucide-react';
import { printService, PaperSize } from '../../services/PrintService';
import { logger } from '../../utils/Logger';

interface PrintDialogProps {
  isOpen: boolean;
  onClose: () => void;
  imageData: Float32Array;
  imageWidth: number;
  imageHeight: number;
  fileName?: string;
}

type PrintTab = 'paper' | 'adjustments';

export const PrintDialog: React.FC<PrintDialogProps> = ({
  isOpen,
  onClose,
  imageData,
  imageWidth,
  imageHeight,
  fileName,
}) => {
  const [activeTab, setActiveTab] = useState<PrintTab>('paper');
  const [paperSize, setPaperSize] = useState('A4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>(
    imageWidth > imageHeight ? 'landscape' : 'portrait'
  );
  const [margins, setMargins] = useState({ top: 10, right: 10, bottom: 10, left: 10 });
  const [resolution, setResolution] = useState(300);
  const [colorAdj, setColorAdj] = useState({ brightness: 0, contrast: 0, saturation: 0, shadows: 0, highlights: 0 });
  const [isPrinting, setIsPrinting] = useState(false);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const paperSizes = printService.getPaperSizes();

  // Auto-detect orientation when image changes
  useEffect(() => {
    setOrientation(imageWidth > imageHeight ? 'landscape' : 'portrait');
  }, [imageWidth, imageHeight]);

  // Draw preview
  useEffect(() => {
    if (!isOpen || !previewRef.current) return;

    const canvas = previewRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const paper = paperSizes.find(p => p.name === paperSize) || paperSizes[0];
    const pw = orientation === 'landscape' ? paper.height : paper.width;
    const ph = orientation === 'landscape' ? paper.width : paper.height;

    // Fit preview into 280×360 box
    const maxW = 280, maxH = 360;
    const scale = Math.min(maxW / pw, maxH / ph);
    canvas.width = Math.round(pw * scale);
    canvas.height = Math.round(ph * scale);

    // White paper background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw image within margins
    const mT = margins.top * scale, mR = margins.right * scale;
    const mB = margins.bottom * scale, mL = margins.left * scale;
    const printW = canvas.width - mL - mR;
    const printH = canvas.height - mT - mB;

    if (printW > 0 && printH > 0) {
      // Fit image aspect ratio within printable area
      const imgAspect = imageWidth / imageHeight;
      const areaAspect = printW / printH;
      let drawW: number, drawH: number;
      if (imgAspect > areaAspect) {
        drawW = printW;
        drawH = printW / imgAspect;
      } else {
        drawH = printH;
        drawW = printH * imgAspect;
      }
      const drawX = mL + (printW - drawW) / 2;
      const drawY = mT + (printH - drawH) / 2;

      // Render the image at small preview size
      const thumbW = Math.min(imageWidth, 400);
      const thumbH = Math.round(thumbW / imgAspect);
      const offscreen = document.createElement('canvas');
      offscreen.width = thumbW;
      offscreen.height = thumbH;
      const offCtx = offscreen.getContext('2d')!;
      const imgD = offCtx.createImageData(thumbW, thumbH);

      const xR = imageWidth / thumbW;
      const yR = imageHeight / thumbH;
      const sampleMax = Math.max(...imageData.slice(0, Math.min(4000, imageData.length)));
      const norm = sampleMax <= 1.0;

      for (let y = 0; y < thumbH; y++) {
        for (let x = 0; x < thumbW; x++) {
          const sx = Math.floor(x * xR);
          const sy = Math.floor(y * yR);
          const si = (sy * imageWidth + sx) * 4;
          const di = (y * thumbW + x) * 4;
          for (let c = 0; c < 3; c++) {
            const v = imageData[si + c] || 0;
            imgD.data[di + c] = norm ? Math.round(Math.max(0, Math.min(1, v)) * 255) : Math.round(Math.max(0, Math.min(255, v)));
          }
          imgD.data[di + 3] = 255;
        }
      }
      offCtx.putImageData(imgD, 0, 0);
      ctx.drawImage(offscreen, drawX, drawY, drawW, drawH);
    }

    // Margin guides (dashed)
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(mL, mT, printW, printH);
    ctx.setLineDash([]);
  }, [isOpen, paperSize, orientation, margins, imageData, imageWidth, imageHeight, paperSizes]);

  const handlePrint = useCallback(async () => {
    setIsPrinting(true);
    try {
      await printService.printImage(imageData, imageWidth, imageHeight, {
        paperSize,
        orientation,
        margins,
        resolution,
        title: `Photo Editor Pro — ${fileName || 'Print'}`,
        colorAdjustments: colorAdj,
      });
      onClose();
    } catch (err) {
      logger.error('Print failed:', err);
    } finally {
      setIsPrinting(false);
    }
  }, [imageData, imageWidth, imageHeight, paperSize, orientation, margins, resolution, fileName, colorAdj, onClose]);

  if (!isOpen) return null;

  const selectedPaper = paperSizes.find(p => p.name === paperSize) || paperSizes[0];
  const printableW = (orientation === 'landscape' ? selectedPaper.height : selectedPaper.width) - margins.left - margins.right;
  const printableH = (orientation === 'landscape' ? selectedPaper.width : selectedPaper.height) - margins.top - margins.bottom;
  const printDPI = resolution;
  const printPixelsW = Math.round((printableW / 25.4) * printDPI);
  const printPixelsH = Math.round((printableH / 25.4) * printDPI);

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
      <div className="rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl" style={{ backgroundColor: 'var(--gray-900)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderBottomColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Printer size={18} style={{ color: 'var(--gray-300)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--white)' }}>Print Image</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded transition-colors" style={{ color: 'var(--gray-400)' }}>
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Tab Navigation */}
          <div className="w-48 border-r" style={{ borderRightColor: 'var(--border)' }}>
            <div className="p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--gray-500)' }}>Print Settings</h3>
              <nav className="space-y-1">
                {([
                  { key: 'paper' as const, label: 'Paper & Layout', icon: Layout },
                  { key: 'adjustments' as const, label: 'Print Adjustments', icon: Sliders },
                ]).map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded text-left text-sm transition-colors"
                    style={{
                      backgroundColor: activeTab === key ? 'var(--gray-800)' : 'transparent',
                      color: activeTab === key ? 'var(--white)' : 'var(--gray-400)'
                    }}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              </nav>
            </div>

            {/* Preview */}
            <div className="px-4 pb-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--gray-500)' }}>Preview</h3>
              <div className="flex items-center justify-center rounded p-2" style={{ backgroundColor: 'var(--gray-800)' }}>
                <canvas
                  ref={previewRef}
                  style={{ maxWidth: '100%', maxHeight: '200px', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}
                />
              </div>
            </div>
          </div>

          {/* Tab Content */}
          <div className="flex-1 px-6 py-5 overflow-y-auto">
            {activeTab === 'paper' && (
              <div className="space-y-6">
                {/* Paper Size */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Paper Size</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {paperSizes.map((p: PaperSize) => (
                      <button
                        key={p.name}
                        onClick={() => setPaperSize(p.name)}
                        className="p-3 rounded border text-left transition-colors"
                        style={{
                          backgroundColor: paperSize === p.name ? 'var(--gray-700)' : 'var(--gray-800)',
                          borderColor: paperSize === p.name ? 'var(--gray-500)' : 'var(--border)'
                        }}
                      >
                        <div className="text-sm font-semibold" style={{ color: 'var(--gray-200)' }}>{p.name}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--gray-400)' }}>{p.width} x {p.height} mm</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Orientation */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Orientation</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {(['portrait', 'landscape'] as const).map(o => (
                      <button
                        key={o}
                        onClick={() => setOrientation(o)}
                        className="p-3 rounded border text-left transition-colors"
                        style={{
                          backgroundColor: orientation === o ? 'var(--gray-700)' : 'var(--gray-800)',
                          borderColor: orientation === o ? 'var(--gray-500)' : 'var(--border)'
                        }}
                      >
                        <div className="text-sm font-semibold capitalize" style={{ color: 'var(--gray-200)' }}>{o}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Margins */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Margins (mm)</h3>
                  <div className="grid grid-cols-4 gap-3">
                    {(['top', 'right', 'bottom', 'left'] as const).map(side => (
                      <div key={side}>
                        <label className="block text-xs mb-1 capitalize" style={{ color: 'var(--gray-400)' }}>{side}</label>
                        <input
                          type="number"
                          value={margins[side]}
                          min={0} max={50}
                          onChange={e => setMargins(prev => ({ ...prev, [side]: parseInt(e.target.value) || 0 }))}
                          className="w-full px-2 py-1.5 text-xs text-white border bg-transparent rounded"
                          style={{ borderColor: 'var(--border)' }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Resolution */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>
                    Resolution: {resolution} DPI
                  </h3>
                  <input
                    type="range"
                    min={150} max={600} step={50}
                    value={resolution}
                    onChange={e => setResolution(parseInt(e.target.value))}
                    className="w-full h-1 rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, var(--gray-400) 0%, var(--gray-400) ${((resolution - 150) / 450) * 100}%, var(--gray-700) ${((resolution - 150) / 450) * 100}%, var(--gray-700) 100%)`,
                    }}
                  />
                  <div className="flex justify-between text-xs" style={{ color: 'var(--gray-500)' }}>
                    <span>150</span><span>300</span><span>450</span><span>600</span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'adjustments' && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Print Color Adjustments</h3>
                  <p className="text-xs" style={{ color: 'var(--gray-500)' }}>
                    Fine-tune colours for print output. Prints often appear darker than on screen.
                  </p>
                </div>

                {([
                  { key: 'brightness', label: 'Brightness', min: -50, max: 50 },
                  { key: 'contrast', label: 'Contrast', min: -50, max: 50 },
                  { key: 'saturation', label: 'Saturation', min: -50, max: 50 },
                  { key: 'shadows', label: 'Shadows', min: -50, max: 50 },
                  { key: 'highlights', label: 'Highlights', min: -50, max: 50 },
                ] as const).map(({ key, label, min, max }) => (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs" style={{ color: 'var(--gray-300)' }}>{label}</label>
                      <span className="text-xs tabular-nums" style={{ color: 'var(--gray-400)' }}>{colorAdj[key]}</span>
                    </div>
                    <input
                      type="range"
                      min={min} max={max} step={1}
                      value={colorAdj[key]}
                      onChange={e => setColorAdj(prev => ({ ...prev, [key]: parseInt(e.target.value) }))}
                      className="w-full h-1 rounded-full appearance-none cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, var(--gray-700) 0%, var(--gray-700) ${((colorAdj[key] - min) / (max - min)) * 100}%, var(--gray-700) 100%)`,
                      }}
                    />
                  </div>
                ))}

                <button
                  onClick={() => setColorAdj({ brightness: 0, contrast: 0, saturation: 0, shadows: 0, highlights: 0 })}
                  className="px-3 py-1.5 text-xs rounded border transition-colors"
                  style={{ borderColor: 'var(--border)', color: 'var(--gray-400)' }}
                >
                  Reset Adjustments
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t" style={{ borderTopColor: 'var(--border)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <div style={{ color: 'var(--gray-400)' }}>
                Image: <span className="font-semibold" style={{ color: 'var(--gray-200)' }}>{imageWidth} x {imageHeight}</span>
              </div>
              <div style={{ color: 'var(--gray-400)' }}>
                Print area: <span className="font-semibold" style={{ color: 'var(--gray-200)' }}>{printableW.toFixed(0)} x {printableH.toFixed(0)} mm</span>
              </div>
              <div style={{ color: 'var(--gray-400)' }}>
                Output: <span className="font-semibold" style={{ color: 'var(--gray-200)' }}>{printPixelsW} x {printPixelsH} px</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm transition-colors rounded"
                style={{ color: 'var(--gray-400)' }}
              >
                Cancel
              </button>
              <button
                onClick={handlePrint}
                disabled={isPrinting}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded border transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}
              >
                {isPrinting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--gray-300)' }} />
                    Preparing...
                  </>
                ) : (
                  <>
                    <Printer size={16} />
                    Print
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
