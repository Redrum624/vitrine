import { logger } from '../utils/Logger';
import { colorManagementService, PrintProfile, SoftProofOptions } from './ColorManagementService';

export interface PrintLayout {
  name: string;
  description: string;
  paperSize: PaperSize;
  orientation: 'portrait' | 'landscape';
  margins: Margins;
  imagePositions: ImagePosition[];
}

export interface PaperSize {
  name: string;
  width: number; // in mm
  height: number; // in mm
  aspectRatio: number;
}

export interface Margins {
  top: number; // in mm
  right: number;
  bottom: number;
  left: number;
}

export interface ImagePosition {
  x: number; // in mm
  y: number; // in mm
  width: number; // in mm
  height: number; // in mm
  rotation: number; // in degrees
  cropX?: number; // 0-1
  cropY?: number; // 0-1
  cropWidth?: number; // 0-1
  cropHeight?: number; // 0-1
}

export interface PrintSettings {
  layout: PrintLayout;
  colorProfile: PrintProfile;
  renderingIntent: 'perceptual' | 'relative' | 'saturation' | 'absolute';
  blackPointCompensation: boolean;
  resolution: number; // DPI
  qualityLevel: 'draft' | 'normal' | 'high' | 'maximum';
  colorAdjustments: {
    brightness: number; // -100 to 100
    contrast: number; // -100 to 100
    saturation: number; // -100 to 100
    shadows: number; // -100 to 100
    highlights: number; // -100 to 100
  };
}

export interface PrintJob {
  id: string;
  imageData: Float32Array;
  width: number;
  height: number;
  settings: PrintSettings;
  timestamp: Date;
  status: 'pending' | 'processing' | 'ready' | 'printed' | 'error';
  previewData?: Float32Array;
  estimatedInkUsage?: InkUsage;
}

export interface InkUsage {
  cyan: number; // percentage
  magenta: number;
  yellow: number;
  black: number;
  total: number;
}

/**
 * Professional Print Service
 * Handles print layouts, color management, soft proofing, and print job management
 */
export class PrintService {
  private static instance: PrintService;
  private printLayouts: Map<string, PrintLayout> = new Map();
  private printJobs: Map<string, PrintJob> = new Map();
  private paperSizes: Map<string, PaperSize> = new Map();

  static getInstance(): PrintService {
    if (!PrintService.instance) {
      PrintService.instance = new PrintService();
    }
    return PrintService.instance;
  }

  constructor() {
    this.initializeStandardPaperSizes();
    this.initializeStandardLayouts();
  }

  /**
   * Initialize standard paper sizes
   */
  private initializeStandardPaperSizes(): void {
    // ISO A series
    this.addPaperSize({ name: 'A4', width: 210, height: 297, aspectRatio: 210 / 297 });
    this.addPaperSize({ name: 'A3', width: 297, height: 420, aspectRatio: 297 / 420 });
    this.addPaperSize({ name: 'A3+', width: 329, height: 483, aspectRatio: 329 / 483 });
    this.addPaperSize({ name: 'A2', width: 420, height: 594, aspectRatio: 420 / 594 });

    // US Letter series
    this.addPaperSize({ name: 'Letter', width: 215.9, height: 279.4, aspectRatio: 215.9 / 279.4 });
    this.addPaperSize({ name: 'Legal', width: 215.9, height: 355.6, aspectRatio: 215.9 / 355.6 });
    this.addPaperSize({ name: 'Tabloid', width: 279.4, height: 431.8, aspectRatio: 279.4 / 431.8 });

    // Photo sizes
    this.addPaperSize({ name: '4x6"', width: 101.6, height: 152.4, aspectRatio: 101.6 / 152.4 });
    this.addPaperSize({ name: '5x7"', width: 127, height: 177.8, aspectRatio: 127 / 177.8 });
    this.addPaperSize({ name: '8x10"', width: 203.2, height: 254, aspectRatio: 203.2 / 254 });
    this.addPaperSize({ name: '11x14"', width: 279.4, height: 355.6, aspectRatio: 279.4 / 355.6 });
    this.addPaperSize({ name: '13x19"', width: 330.2, height: 482.6, aspectRatio: 330.2 / 482.6 });
    this.addPaperSize({ name: '16x20"', width: 406.4, height: 508, aspectRatio: 406.4 / 508 });

    logger.info(`Initialized ${this.paperSizes.size} standard paper sizes`);
  }

  /**
   * Initialize standard print layouts
   */
  private initializeStandardLayouts(): void {
    // Single photo layouts
    this.addPrintLayout({
      name: 'Single Photo - A4',
      description: 'Single photograph centered on A4 paper',
      paperSize: this.paperSizes.get('A4')!,
      orientation: 'portrait',
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      imagePositions: [{
        x: 20,
        y: 20,
        width: 170,
        height: 257,
        rotation: 0
      }]
    });

    this.addPrintLayout({
      name: 'Single Photo - 8x10"',
      description: 'Single photograph on 8x10 inch paper',
      paperSize: this.paperSizes.get('8x10"')!,
      orientation: 'portrait',
      margins: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
      imagePositions: [{
        x: 12.7,
        y: 12.7,
        width: 177.8,
        height: 228.6,
        rotation: 0
      }]
    });

    // Multiple photo layouts
    this.addPrintLayout({
      name: '2-up Contact Sheet',
      description: 'Two photos side by side',
      paperSize: this.paperSizes.get('A4')!,
      orientation: 'landscape',
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      imagePositions: [
        {
          x: 20,
          y: 20,
          width: 128.5,
          height: 171.5,
          rotation: 0
        },
        {
          x: 158.5,
          y: 20,
          width: 128.5,
          height: 171.5,
          rotation: 0
        }
      ]
    });

    this.addPrintLayout({
      name: '4-up Contact Sheet',
      description: 'Four photos in a 2x2 grid',
      paperSize: this.paperSizes.get('A4')!,
      orientation: 'portrait',
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      imagePositions: [
        { x: 20, y: 20, width: 85, height: 113.5, rotation: 0 },
        { x: 115, y: 20, width: 85, height: 113.5, rotation: 0 },
        { x: 20, y: 143.5, width: 85, height: 113.5, rotation: 0 },
        { x: 115, y: 143.5, width: 85, height: 113.5, rotation: 0 }
      ]
    });

    this.addPrintLayout({
      name: 'Panorama - A3',
      description: 'Panoramic photo on A3 paper',
      paperSize: this.paperSizes.get('A3')!,
      orientation: 'landscape',
      margins: { top: 30, right: 30, bottom: 30, left: 30 },
      imagePositions: [{
        x: 30,
        y: 120,
        width: 360,
        height: 120,
        rotation: 0
      }]
    });

    logger.info(`Initialized ${this.printLayouts.size} standard print layouts`);
  }

  /**
   * Add paper size
   */
  addPaperSize(paperSize: PaperSize): void {
    this.paperSizes.set(paperSize.name, paperSize);
  }

  /**
   * Add print layout
   */
  addPrintLayout(layout: PrintLayout): void {
    this.printLayouts.set(layout.name, layout);
  }

  /**
   * Get all available paper sizes
   */
  getPaperSizes(): PaperSize[] {
    return Array.from(this.paperSizes.values());
  }

  /**
   * Get all available print layouts
   */
  getPrintLayouts(): PrintLayout[] {
    return Array.from(this.printLayouts.values());
  }

  /**
   * Get print layouts for specific paper size
   */
  getPrintLayoutsForPaper(paperName: string): PrintLayout[] {
    return Array.from(this.printLayouts.values())
      .filter(layout => layout.paperSize.name === paperName);
  }

  /**
   * Create a new print job
   */
  async createPrintJob(
    imageData: Float32Array,
    width: number,
    height: number,
    settings: PrintSettings
  ): Promise<string> {
    const jobId = this.generateJobId();

    const printJob: PrintJob = {
      id: jobId,
      imageData,
      width,
      height,
      settings,
      timestamp: new Date(),
      status: 'pending'
    };

    this.printJobs.set(jobId, printJob);

    // Start processing the print job
    this.processPrintJob(jobId);

    logger.info(`Created print job ${jobId}`, {
      layout: settings.layout.name,
      profile: settings.colorProfile.name,
      resolution: settings.resolution
    });

    return jobId;
  }

  /**
   * Process a print job
   */
  private async processPrintJob(jobId: string): Promise<void> {
    const job = this.printJobs.get(jobId);
    if (!job) return;

    try {
      job.status = 'processing';

      // Apply color management and soft proofing
      const colorManagedData = await this.applyColorManagement(job);

      // Generate print layout
      const layoutData = await this.generatePrintLayout(colorManagedData, job);

      // Apply print-specific adjustments
      const printReadyData = await this.applyPrintAdjustments(layoutData, job);

      // Generate preview
      job.previewData = await this.generatePrintPreview(printReadyData, job);

      // Estimate ink usage
      job.estimatedInkUsage = this.estimateInkUsage(printReadyData, job.settings.colorProfile);

      job.status = 'ready';
      logger.info(`Print job ${jobId} processed successfully`);

    } catch (error) {
      job.status = 'error';
      logger.error(`Failed to process print job ${jobId}:`, error);
    }
  }

  /**
   * Apply color management to print job
   */
  private async applyColorManagement(job: PrintJob): Promise<Float32Array> {
    const currentProfile = colorManagementService.getCurrentDisplayProfile();
    if (!currentProfile) {
      throw new Error('No display profile available');
    }

    return await colorManagementService.convertColorProfile(
      job.imageData,
      job.width,
      job.height,
      {
        sourceProfile: currentProfile,
        destinationProfile: job.settings.colorProfile,
        renderingIntent: job.settings.renderingIntent,
        blackPointCompensation: job.settings.blackPointCompensation
      }
    );
  }

  /**
   * Generate print layout with positioned images
   */
  private async generatePrintLayout(
    imageData: Float32Array,
    job: PrintJob
  ): Promise<Float32Array> {
    const layout = job.settings.layout;
    const dpi = job.settings.resolution;

    // Calculate canvas size in pixels
    const canvasWidthPx = Math.round((layout.paperSize.width / 25.4) * dpi);
    const canvasHeightPx = Math.round((layout.paperSize.height / 25.4) * dpi);

    // Create white canvas
    const canvas = new Float32Array(canvasWidthPx * canvasHeightPx * 4);
    for (let i = 0; i < canvas.length; i += 4) {
      canvas[i] = 1; // R
      canvas[i + 1] = 1; // G
      canvas[i + 2] = 1; // B
      canvas[i + 3] = 1; // A
    }

    // Place images according to layout
    for (const position of layout.imagePositions) {
      await this.placeImageOnCanvas(
        canvas,
        canvasWidthPx,
        canvasHeightPx,
        imageData,
        job.width,
        job.height,
        position,
        dpi
      );
    }

    return canvas;
  }

  /**
   * Place an image on the print canvas
   */
  private async placeImageOnCanvas(
    canvas: Float32Array,
    canvasWidth: number,
    canvasHeight: number,
    imageData: Float32Array,
    imageWidth: number,
    imageHeight: number,
    position: ImagePosition,
    dpi: number
  ): Promise<void> {
    // Convert position from mm to pixels
    const xPx = Math.round((position.x / 25.4) * dpi);
    const yPx = Math.round((position.y / 25.4) * dpi);
    const widthPx = Math.round((position.width / 25.4) * dpi);
    const heightPx = Math.round((position.height / 25.4) * dpi);

    // Apply cropping if specified
    let srcX = 0, srcY = 0, srcWidth = imageWidth, srcHeight = imageHeight;
    if (position.cropX !== undefined) {
      srcX = Math.round(position.cropX * imageWidth);
      srcWidth = Math.round((position.cropWidth || 1) * imageWidth);
    }
    if (position.cropY !== undefined) {
      srcY = Math.round(position.cropY * imageHeight);
      srcHeight = Math.round((position.cropHeight || 1) * imageHeight);
    }

    // Resize image to fit position
    const resizedImageData = await this.resizeImage(
      imageData,
      srcWidth,
      srcHeight,
      widthPx,
      heightPx,
      srcX,
      srcY,
      imageWidth
    );

    // Copy resized image to canvas
    for (let y = 0; y < heightPx; y++) {
      for (let x = 0; x < widthPx; x++) {
        const canvasX = xPx + x;
        const canvasY = yPx + y;

        if (canvasX >= 0 && canvasX < canvasWidth && canvasY >= 0 && canvasY < canvasHeight) {
          const srcIdx = (y * widthPx + x) * 4;
          const destIdx = (canvasY * canvasWidth + canvasX) * 4;

          canvas[destIdx] = resizedImageData[srcIdx];
          canvas[destIdx + 1] = resizedImageData[srcIdx + 1];
          canvas[destIdx + 2] = resizedImageData[srcIdx + 2];
          canvas[destIdx + 3] = resizedImageData[srcIdx + 3];
        }
      }
    }
  }

  /**
   * Resize image using bilinear interpolation
   */
  private async resizeImage(
    imageData: Float32Array,
    srcWidth: number,
    srcHeight: number,
    destWidth: number,
    destHeight: number,
    srcX: number = 0,
    srcY: number = 0,
    originalWidth: number
  ): Promise<Float32Array> {
    const result = new Float32Array(destWidth * destHeight * 4);

    const xScale = srcWidth / destWidth;
    const yScale = srcHeight / destHeight;

    for (let y = 0; y < destHeight; y++) {
      for (let x = 0; x < destWidth; x++) {
        const srcXf = srcX + x * xScale;
        const srcYf = srcY + y * yScale;

        const x1 = Math.floor(srcXf);
        const y1 = Math.floor(srcYf);
        const x2 = Math.min(srcX + srcWidth - 1, x1 + 1);
        const y2 = Math.min(srcY + srcHeight - 1, y1 + 1);

        const fx = srcXf - x1;
        const fy = srcYf - y1;

        const destIdx = (y * destWidth + x) * 4;

        for (let c = 0; c < 4; c++) {
          const tl = imageData[(y1 * originalWidth + x1) * 4 + c] || 0;
          const tr = imageData[(y1 * originalWidth + x2) * 4 + c] || 0;
          const bl = imageData[(y2 * originalWidth + x1) * 4 + c] || 0;
          const br = imageData[(y2 * originalWidth + x2) * 4 + c] || 0;

          const top = tl + (tr - tl) * fx;
          const bottom = bl + (br - bl) * fx;
          result[destIdx + c] = top + (bottom - top) * fy;
        }
      }
    }

    return result;
  }

  /**
   * Apply print-specific adjustments
   */
  private async applyPrintAdjustments(
    imageData: Float32Array,
    job: PrintJob
  ): Promise<Float32Array> {
    const adjustments = job.settings.colorAdjustments;
    const result = new Float32Array(imageData.length);

    for (let i = 0; i < imageData.length; i += 4) {
      let r = imageData[i];
      let g = imageData[i + 1];
      let b = imageData[i + 2];
      const a = imageData[i + 3];

      // Apply brightness adjustment
      const brightness = adjustments.brightness / 100;
      r = Math.max(0, Math.min(1, r + brightness));
      g = Math.max(0, Math.min(1, g + brightness));
      b = Math.max(0, Math.min(1, b + brightness));

      // Apply contrast adjustment
      const contrast = (adjustments.contrast / 100) + 1;
      r = Math.max(0, Math.min(1, (r - 0.5) * contrast + 0.5));
      g = Math.max(0, Math.min(1, (g - 0.5) * contrast + 0.5));
      b = Math.max(0, Math.min(1, (b - 0.5) * contrast + 0.5));

      // Apply saturation adjustment
      const saturation = (adjustments.saturation / 100) + 1;
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = Math.max(0, Math.min(1, gray + (r - gray) * saturation));
      g = Math.max(0, Math.min(1, gray + (g - gray) * saturation));
      b = Math.max(0, Math.min(1, gray + (b - gray) * saturation));

      result[i] = r;
      result[i + 1] = g;
      result[i + 2] = b;
      result[i + 3] = a;
    }

    return result;
  }

  /**
   * Generate print preview (scaled down version)
   */
  private async generatePrintPreview(
    printData: Float32Array,
    job: PrintJob
  ): Promise<Float32Array> {
    const layout = job.settings.layout;
    const dpi = job.settings.resolution;

    const fullWidthPx = Math.round((layout.paperSize.width / 25.4) * dpi);
    const fullHeightPx = Math.round((layout.paperSize.height / 25.4) * dpi);

    // Generate preview at 150 DPI for reasonable size
    const previewDpi = 150;
    const previewWidth = Math.round((layout.paperSize.width / 25.4) * previewDpi);
    const previewHeight = Math.round((layout.paperSize.height / 25.4) * previewDpi);

    return await this.resizeImage(
      printData,
      fullWidthPx,
      fullHeightPx,
      previewWidth,
      previewHeight,
      0,
      0,
      fullWidthPx
    );
  }

  /**
   * Estimate ink usage for print job
   */
  private estimateInkUsage(printData: Float32Array, _profile: PrintProfile): InkUsage {
    let totalPixels = 0;
    let cyanUsage = 0;
    let magentaUsage = 0;
    let yellowUsage = 0;
    let blackUsage = 0;

    for (let i = 0; i < printData.length; i += 4) {
      const r = printData[i];
      const g = printData[i + 1];
      const b = printData[i + 2];

      // Convert RGB to CMY (simplified)
      const c = 1 - r;
      const m = 1 - g;
      const y = 1 - b;

      // Estimate black generation (simplified UCR)
      const k = Math.min(c, m, y) * 0.7;

      cyanUsage += Math.max(0, c - k);
      magentaUsage += Math.max(0, m - k);
      yellowUsage += Math.max(0, y - k);
      blackUsage += k;

      totalPixels++;
    }

    const pixelCount = totalPixels / 4;

    return {
      cyan: Math.round((cyanUsage / pixelCount) * 100),
      magenta: Math.round((magentaUsage / pixelCount) * 100),
      yellow: Math.round((yellowUsage / pixelCount) * 100),
      black: Math.round((blackUsage / pixelCount) * 100),
      total: Math.round(((cyanUsage + magentaUsage + yellowUsage + blackUsage) / pixelCount) * 100)
    };
  }

  /**
   * Get print job by ID
   */
  getPrintJob(jobId: string): PrintJob | undefined {
    return this.printJobs.get(jobId);
  }

  /**
   * Get all print jobs
   */
  getAllPrintJobs(): PrintJob[] {
    return Array.from(this.printJobs.values()).sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  /**
   * Delete print job
   */
  deletePrintJob(jobId: string): boolean {
    return this.printJobs.delete(jobId);
  }

  /**
   * Generate soft proof for print settings
   */
  async generateSoftProof(
    imageData: Float32Array,
    width: number,
    height: number,
    settings: PrintSettings
  ): Promise<Float32Array> {
    const softProofOptions: SoftProofOptions = {
      outputProfile: settings.colorProfile,
      renderingIntent: settings.renderingIntent,
      blackPointCompensation: settings.blackPointCompensation,
      gamutWarning: false,
      paperWhiteSimulation: true
    };

    return await colorManagementService.applySoftProof(
      imageData,
      width,
      height,
      softProofOptions
    );
  }

  /**
   * Print the current image via the native system print dialog.
   *
   * Renders the processed Float32Array onto a temporary canvas, embeds it
   * in a print-optimised window, and invokes the OS print dialog.
   */
  async printImage(
    imageData: Float32Array,
    width: number,
    height: number,
    options?: {
      paperSize?: string;         // e.g. 'A4', '8x10"'
      orientation?: 'portrait' | 'landscape';
      margins?: Margins;          // mm
      resolution?: number;        // DPI (informational — browser controls actual)
      title?: string;
      colorAdjustments?: PrintSettings['colorAdjustments'];
    }
  ): Promise<void> {
    const paper = this.paperSizes.get(options?.paperSize || 'A4') || this.paperSizes.get('A4')!;
    const orientation = options?.orientation ||
      (width > height ? 'landscape' : 'portrait');
    const margins = options?.margins || { top: 10, right: 10, bottom: 10, left: 10 };
    const title = options?.title || 'Vitrine — Print';

    // ── Apply colour adjustments if provided ──────────────────────────
    let data = imageData;
    if (options?.colorAdjustments) {
      const adj = options.colorAdjustments;
      const hasAdj = adj.brightness || adj.contrast || adj.saturation || adj.shadows || adj.highlights;
      if (hasAdj) {
        const mockJob = {
          imageData, width, height,
          settings: { colorAdjustments: adj },
        } as unknown as PrintJob;
        data = await this.applyPrintAdjustments(imageData, mockJob);
      }
    }

    // ── Render to an off-screen canvas ────────────────────────────────
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.createImageData(width, height);

    // Detect normalisation range
    const sampleMax = Math.max(...data.slice(0, Math.min(4000, data.length)));
    const isNormalized = sampleMax <= 1.0;

    for (let i = 0; i < data.length; i++) {
      imgData.data[i] = isNormalized
        ? Math.round(Math.max(0, Math.min(1, data[i])) * 255)
        : Math.round(Math.max(0, Math.min(255, data[i])));
    }
    ctx.putImageData(imgData, 0, 0);

    const dataUrl = canvas.toDataURL('image/png');

    // ── Paper dimensions for CSS ──────────────────────────────────────
    const paperW = orientation === 'landscape' ? paper.height : paper.width;
    const paperH = orientation === 'landscape' ? paper.width : paper.height;

    // ── Open a print window ───────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const printWindow = window.open('', '_blank', 'width=900,height=700') as any;
    if (!printWindow || !printWindow.document) {
      throw new Error('Could not open print window — check popup blocker');
    }

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    @page {
      size: ${paperW}mm ${paperH}mm;
      margin: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; }

    /* Screen preview */
    body {
      display: flex; align-items: center; justify-content: center;
      background: #1a1a1a; font-family: system-ui, sans-serif;
    }
    .page {
      background: #fff; padding: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;
      width: ${paperW}mm; min-height: ${paperH}mm;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5);
    }
    img {
      max-width: 100%; max-height: ${paperH - margins.top - margins.bottom}mm;
      object-fit: contain; display: block;
    }
    .hint {
      position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
      color: #888; font-size: 13px;
    }

    /* When actually printing */
    @media print {
      body { background: none; }
      .page { box-shadow: none; padding: 0; width: 100%; min-height: auto; }
      img { max-width: 100%; max-height: 100%; }
      .hint { display: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <img src="${dataUrl}" alt="Print" />
  </div>
  <div class="hint">Press Ctrl+P or close this window when done</div>
  <script>
    window.onafterprint = function() { window.close(); };
    // Auto-trigger print after image loads
    window.onload = function() { setTimeout(function() { window.print(); }, 400); };
  </script>
</body>
</html>`);

    printWindow.document.close();
    logger.info(`Print dialog opened: ${width}x${height} on ${paper.name} (${orientation})`);
  }

  /**
   * Generate unique job ID
   */
  private generateJobId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2);
    return `print_${timestamp}_${random}`;
  }
}

export const printService = PrintService.getInstance();