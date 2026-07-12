import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Printer, Layout, Sliders } from 'lucide-react';
import { GlassModal } from './GlassModal';
import { ChipButton } from '../Controls/ChipButton';
import { AccentButton } from '../Controls/AccentButton';
import { SectionLabel } from '../Controls/SectionLabel';
import { SliderRow } from '../Controls/SliderRow';
import { inputStyle } from './glassFormStyles';
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

type ColorAdjustments = { brightness: number; contrast: number; saturation: number; shadows: number; highlights: number };

const DEFAULT_COLOR_ADJ: ColorAdjustments = { brightness: 0, contrast: 0, saturation: 0, shadows: 0, highlights: 0 };

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
  const [colorAdj, setColorAdj] = useState<ColorAdjustments>(DEFAULT_COLOR_ADJ);
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
        title: `Vitrine — ${fileName || 'Print'}`,
        colorAdjustments: colorAdj,
      });
      onClose();
    } catch (err) {
      logger.error('Print failed:', err);
    } finally {
      setIsPrinting(false);
    }
  }, [imageData, imageWidth, imageHeight, paperSize, orientation, margins, resolution, fileName, colorAdj, onClose]);

  const selectedPaper = paperSizes.find(p => p.name === paperSize) || paperSizes[0];
  const printableW = (orientation === 'landscape' ? selectedPaper.height : selectedPaper.width) - margins.left - margins.right;
  const printableH = (orientation === 'landscape' ? selectedPaper.width : selectedPaper.height) - margins.top - margins.bottom;
  const printDPI = resolution;
  const printPixelsW = Math.round((printableW / 25.4) * printDPI);
  const printPixelsH = Math.round((printableH / 25.4) * printDPI);

  const colorAdjustmentRows: Array<{ key: keyof ColorAdjustments; label: string }> = [
    { key: 'brightness', label: 'Brightness' },
    { key: 'contrast', label: 'Contrast' },
    { key: 'saturation', label: 'Saturation' },
    { key: 'shadows', label: 'Shadows' },
    { key: 'highlights', label: 'Highlights' },
  ];

  const footer = (
    <div className="flex items-center justify-between">
      <div className="flex items-center" style={{ gap: 16 }}>
        <div style={{ fontSize: 11.5, color: 'var(--glass-text-muted)' }}>
          Image: <span style={{ fontWeight: 600, color: 'var(--glass-text-label)' }}>{imageWidth} × {imageHeight}</span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--glass-text-muted)' }}>
          Print area: <span style={{ fontWeight: 600, color: 'var(--glass-text-label)' }}>{printableW.toFixed(0)} × {printableH.toFixed(0)} mm</span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--glass-text-muted)' }}>
          Output: <span style={{ fontWeight: 600, color: 'var(--glass-text-label)' }}>{printPixelsW} × {printPixelsH} px</span>
        </div>
      </div>

      <div className="flex gap-2">
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
        <AccentButton onClick={handlePrint} disabled={isPrinting}>
          {isPrinting ? (
            <>
              <span
                className="animate-spin"
                style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid rgba(11,11,12,0.35)', borderTopColor: '#0b0b0c' }}
              />
              Preparing...
            </>
          ) : (
            <>
              <Printer size={14} />
              Print
            </>
          )}
        </AccentButton>
      </div>
    </div>
  );

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      icon={<Printer size={15} />}
      title="Print Image"
      cardClassName="w-full max-w-4xl"
      cardStyle={{ maxHeight: '90vh' }}
      scrollBody={false}
      footer={footer}
    >
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: tabs + preview */}
        <div className="flex-shrink-0 flex flex-col" style={{ width: 200, borderRight: '1px solid var(--glass-border)' }}>
          <div style={{ padding: 14 }}>
            <SectionLabel className="mb-3">Print Settings</SectionLabel>
            <nav className="flex flex-col" style={{ gap: 4, marginTop: 10 }}>
              {[
                { key: 'paper' as const, label: 'Paper & Layout', icon: Layout },
                { key: 'adjustments' as const, label: 'Print Adjustments', icon: Sliders },
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  data-active={activeTab === key || undefined}
                  className="glass-modal-tab w-full flex items-center gap-2"
                  style={{
                    padding: '8px 10px', borderRadius: 9, fontSize: 12, textAlign: 'left',
                    border: '1px solid transparent', color: 'var(--glass-text-secondary)',
                  }}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </nav>
          </div>

          <div style={{ padding: '0 14px 14px' }}>
            <SectionLabel className="mb-2">Preview</SectionLabel>
            <div
              className="flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,.3)', borderRadius: 10, border: '1px solid var(--glass-border)', padding: 8 }}
            >
              <canvas
                ref={previewRef}
                style={{ maxWidth: '100%', maxHeight: 200, boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}
              />
            </div>
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '20px 24px' }}>
          {activeTab === 'paper' && (
            <div className="space-y-6">
              {/* Paper Size */}
              <div className="space-y-2">
                <SectionLabel>Paper Size</SectionLabel>
                <div className="grid grid-cols-3 gap-2">
                  {paperSizes.map((p: PaperSize) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => setPaperSize(p.name)}
                      data-active={paperSize === p.name || undefined}
                      className="glass-modal-card-btn text-left"
                      style={{ padding: 10, borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)' }}
                    >
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--glass-text-title)' }}>{p.name}</div>
                      <div style={{ fontSize: 10.5, marginTop: 2, color: 'var(--glass-text-muted)' }}>{p.width} × {p.height} mm</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Orientation */}
              <div className="space-y-2">
                <SectionLabel>Orientation</SectionLabel>
                <div className="grid grid-cols-2 gap-2">
                  {(['portrait', 'landscape'] as const).map(o => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setOrientation(o)}
                      data-active={orientation === o || undefined}
                      className="glass-modal-card-btn text-left capitalize"
                      style={{ padding: 10, borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)' }}
                    >
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--glass-text-title)' }}>{o}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Margins */}
              <div className="space-y-2">
                <SectionLabel>Margins (mm)</SectionLabel>
                <div className="grid grid-cols-4 gap-3">
                  {(['top', 'right', 'bottom', 'left'] as const).map(side => (
                    <div key={side}>
                      <label className="capitalize" style={{ display: 'block', fontSize: 11, marginBottom: 4, color: 'var(--glass-text-muted)' }}>{side}</label>
                      <input
                        type="number"
                        value={margins[side]}
                        min={0} max={50}
                        onChange={e => setMargins(prev => ({ ...prev, [side]: parseInt(e.target.value) || 0 }))}
                        style={inputStyle}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Resolution */}
              <SliderRow
                label="Resolution"
                value={resolution}
                defaultValue={300}
                min={150}
                max={600}
                step={50}
                onChange={setResolution}
                formatValue={(v) => `${v} DPI`}
              />
            </div>
          )}

          {activeTab === 'adjustments' && (
            <div className="space-y-6">
              <div className="space-y-1">
                <SectionLabel>Print Color Adjustments</SectionLabel>
                <p style={{ fontSize: 11, color: 'var(--glass-text-muted)' }}>
                  Fine-tune colours for print output. Prints often appear darker than on screen.
                </p>
              </div>

              <div className="space-y-5">
                {colorAdjustmentRows.map(({ key, label }) => (
                  <SliderRow
                    key={key}
                    label={label}
                    value={colorAdj[key]}
                    defaultValue={0}
                    min={-50}
                    max={50}
                    step={1}
                    onChange={(value) => setColorAdj(prev => ({ ...prev, [key]: value }))}
                  />
                ))}
              </div>

              <ChipButton onClick={() => setColorAdj(DEFAULT_COLOR_ADJ)}>
                Reset Adjustments
              </ChipButton>
            </div>
          )}
        </div>
      </div>
    </GlassModal>
  );
};
