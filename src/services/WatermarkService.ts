import { logger } from '../utils/Logger';

export interface WatermarkSettings {
  enabled: boolean;
  type: 'text' | 'image';

  // Text watermark settings
  text?: string;
  font?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
  color?: string;

  // Image watermark settings
  imageUrl?: string;
  imageData?: string; // Base64 encoded image

  // Common settings
  position: 'top-left' | 'top-center' | 'top-right' | 'center-left' | 'center' | 'center-right' | 'bottom-left' | 'bottom-center' | 'bottom-right' | 'tiled';
  opacity: number; // 0-1
  scale: number; // 0-2 (1 = 100%)
  offsetX: number; // pixels
  offsetY: number; // pixels

  // Advanced settings
  blendMode: 'source-over' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'hard-light' | 'difference' | 'exclusion';
  rotation: number; // degrees
  padding: number; // pixels from edge

  // Tiled settings
  spacing?: number; // pixels between tiles when tiled
  tiledOpacity?: number; // separate opacity for tiled mode
}

export interface WatermarkPreset {
  id: string;
  name: string;
  description: string;
  settings: WatermarkSettings;
  category: 'text' | 'logo' | 'copyright' | 'custom';
}

export class WatermarkService {
  private static instance: WatermarkService;
  private canvas: HTMLCanvasElement;
  private presets: WatermarkPreset[] = [];

  private constructor() {
    this.canvas = document.createElement('canvas');
    this.initializePresets();
  }

  static getInstance(): WatermarkService {
    if (!WatermarkService.instance) {
      WatermarkService.instance = new WatermarkService();
    }
    return WatermarkService.instance;
  }

  private initializePresets() {
    this.presets = [
      {
        id: 'copyright-bottom-right',
        name: 'Copyright - Bottom Right',
        description: 'Simple copyright text in bottom right corner',
        category: 'copyright',
        settings: {
          enabled: true,
          type: 'text',
          text: '© Your Name',
          font: 'Arial',
          fontSize: 24,
          fontWeight: 'normal',
          color: '#FFFFFF',
          position: 'bottom-right',
          opacity: 0.7,
          scale: 1,
          offsetX: -20,
          offsetY: -20,
          blendMode: 'source-over',
          rotation: 0,
          padding: 10
        }
      },
      {
        id: 'signature-bottom-center',
        name: 'Signature - Bottom Center',
        description: 'Elegant signature in bottom center',
        category: 'text',
        settings: {
          enabled: true,
          type: 'text',
          text: 'Your Photography',
          font: 'Georgia',
          fontSize: 18,
          fontWeight: '300',
          color: '#FFFFFF',
          position: 'bottom-center',
          opacity: 0.6,
          scale: 1,
          offsetX: 0,
          offsetY: -30,
          blendMode: 'soft-light',
          rotation: 0,
          padding: 15
        }
      },
      {
        id: 'logo-top-left',
        name: 'Logo - Top Left',
        description: 'Logo watermark in top left corner',
        category: 'logo',
        settings: {
          enabled: true,
          type: 'image',
          position: 'top-left',
          opacity: 0.8,
          scale: 0.3,
          offsetX: 20,
          offsetY: 20,
          blendMode: 'source-over',
          rotation: 0,
          padding: 10
        }
      },
      {
        id: 'tiled-copyright',
        name: 'Tiled Copyright',
        description: 'Subtle tiled copyright protection',
        category: 'copyright',
        settings: {
          enabled: true,
          type: 'text',
          text: '© PROTECTED',
          font: 'Arial',
          fontSize: 32,
          fontWeight: 'bold',
          color: '#FFFFFF',
          position: 'tiled',
          opacity: 0.1,
          scale: 1,
          offsetX: 0,
          offsetY: 0,
          blendMode: 'overlay',
          rotation: -45,
          padding: 0,
          spacing: 200,
          tiledOpacity: 0.05
        }
      },
      {
        id: 'subtle-corner',
        name: 'Subtle Corner Mark',
        description: 'Minimalist corner watermark',
        category: 'text',
        settings: {
          enabled: true,
          type: 'text',
          text: '•',
          font: 'Arial',
          fontSize: 48,
          fontWeight: 'normal',
          color: '#FFFFFF',
          position: 'bottom-right',
          opacity: 0.4,
          scale: 1,
          offsetX: -25,
          offsetY: -25,
          blendMode: 'soft-light',
          rotation: 0,
          padding: 5
        }
      }
    ];
  }

  /**
   * Get all available watermark presets
   */
  getPresets(): WatermarkPreset[] {
    return [...this.presets];
  }

  /**
   * Get presets by category
   */
  getPresetsByCategory(category: string): WatermarkPreset[] {
    return this.presets.filter(preset => preset.category === category);
  }

  /**
   * Add custom preset
   */
  addPreset(preset: Omit<WatermarkPreset, 'id'>): string {
    const id = `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newPreset: WatermarkPreset = {
      ...preset,
      id,
      category: 'custom'
    };
    this.presets.push(newPreset);
    logger.info('Added custom watermark preset:', newPreset.name);
    return id;
  }

  /**
   * Apply watermark to image data
   */
  async applyWatermark(
    imageData: ImageData,
    settings: WatermarkSettings,
    targetCanvas?: HTMLCanvasElement
  ): Promise<ImageData> {
    if (!settings.enabled) {
      return imageData;
    }

    try {
      const startTime = performance.now();

      // Use provided canvas or create temporary one
      const canvas = targetCanvas || this.canvas;
      const ctx = canvas.getContext('2d')!;

      // Set canvas size to match image
      canvas.width = imageData.width;
      canvas.height = imageData.height;

      // Draw original image
      ctx.putImageData(imageData, 0, 0);

      // Apply watermark based on type
      if (settings.type === 'text' && settings.text) {
        await this.applyTextWatermark(ctx, canvas.width, canvas.height, settings);
      } else if (settings.type === 'image' && (settings.imageUrl || settings.imageData)) {
        await this.applyImageWatermark(ctx, canvas.width, canvas.height, settings);
      }

      const result = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const processingTime = performance.now() - startTime;
      logger.debug(`Watermark applied in ${processingTime.toFixed(2)}ms`);

      return result;

    } catch (error) {
      logger.error('Failed to apply watermark:', error);
      return imageData; // Return original on error
    }
  }

  /**
   * Apply text watermark
   */
  private async applyTextWatermark(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    settings: WatermarkSettings
  ): Promise<void> {
    if (!settings.text) return;

    // Set up text styling
    const fontSize = (settings.fontSize || 24) * settings.scale;
    ctx.font = `${settings.fontWeight || 'normal'} ${fontSize}px ${settings.font || 'Arial'}`;
    ctx.fillStyle = settings.color || '#FFFFFF';
    ctx.globalAlpha = settings.opacity;
    ctx.globalCompositeOperation = (settings.blendMode || 'source-over') as GlobalCompositeOperation;

    // Measure text
    const textMetrics = ctx.measureText(settings.text);
    const textWidth = textMetrics.width;
    const textHeight = fontSize;

    if (settings.position === 'tiled') {
      await this.applyTiledText(ctx, width, height, settings, textWidth, textHeight);
    } else {
      const position = this.calculatePosition(
        settings.position,
        width,
        height,
        textWidth,
        textHeight,
        settings.offsetX || 0,
        settings.offsetY || 0,
        settings.padding || 0
      );

      // Apply rotation if specified
      if (settings.rotation && settings.rotation !== 0) {
        ctx.save();
        ctx.translate(position.x + textWidth / 2, position.y + textHeight / 2);
        ctx.rotate((settings.rotation * Math.PI) / 180);
        ctx.fillText(settings.text, -textWidth / 2, textHeight / 4);
        ctx.restore();
      } else {
        ctx.fillText(settings.text, position.x, position.y + textHeight);
      }
    }

    // Reset context
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Apply tiled text watermark
   */
  private async applyTiledText(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    settings: WatermarkSettings,
    textWidth: number,
    textHeight: number
  ): Promise<void> {
    const spacing = settings.spacing || 200;
    const tiledOpacity = settings.tiledOpacity || settings.opacity;

    ctx.globalAlpha = tiledOpacity;

    const rows = Math.ceil(height / spacing) + 1;
    const cols = Math.ceil(width / spacing) + 1;

    ctx.save();

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * spacing - textWidth / 2;
        const y = row * spacing;

        if (settings.rotation && settings.rotation !== 0) {
          ctx.save();
          ctx.translate(x + textWidth / 2, y + textHeight / 2);
          ctx.rotate((settings.rotation * Math.PI) / 180);
          ctx.fillText(settings.text!, -textWidth / 2, textHeight / 4);
          ctx.restore();
        } else {
          ctx.fillText(settings.text!, x, y + textHeight);
        }
      }
    }

    ctx.restore();
  }

  /**
   * Apply image watermark
   */
  private async applyImageWatermark(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    settings: WatermarkSettings
  ): Promise<void> {
    try {
      let img: HTMLImageElement;

      if (settings.imageData) {
        // Use base64 data
        img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = settings.imageData!;
        });
      } else if (settings.imageUrl) {
        // Load from URL
        img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.crossOrigin = 'anonymous';
          img.src = settings.imageUrl!;
        });
      } else {
        return;
      }

      // Calculate scaled dimensions
      const scaledWidth = img.width * settings.scale;
      const scaledHeight = img.height * settings.scale;

      const position = this.calculatePosition(
        settings.position,
        width,
        height,
        scaledWidth,
        scaledHeight,
        settings.offsetX || 0,
        settings.offsetY || 0,
        settings.padding || 0
      );

      // Set opacity and blend mode
      ctx.globalAlpha = settings.opacity;
      ctx.globalCompositeOperation = (settings.blendMode || 'source-over') as GlobalCompositeOperation;

      // Apply rotation if specified
      if (settings.rotation && settings.rotation !== 0) {
        ctx.save();
        ctx.translate(position.x + scaledWidth / 2, position.y + scaledHeight / 2);
        ctx.rotate((settings.rotation * Math.PI) / 180);
        ctx.drawImage(img, -scaledWidth / 2, -scaledHeight / 2, scaledWidth, scaledHeight);
        ctx.restore();
      } else {
        ctx.drawImage(img, position.x, position.y, scaledWidth, scaledHeight);
      }

      // Reset context
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

    } catch (error) {
      logger.error('Failed to load watermark image:', error);
    }
  }

  /**
   * Calculate watermark position
   */
  private calculatePosition(
    position: string,
    canvasWidth: number,
    canvasHeight: number,
    elementWidth: number,
    elementHeight: number,
    offsetX: number,
    offsetY: number,
    padding: number
  ): { x: number; y: number } {
    let x = 0;
    let y = 0;

    switch (position) {
      case 'top-left':
        x = padding + offsetX;
        y = padding + offsetY;
        break;
      case 'top-center':
        x = (canvasWidth - elementWidth) / 2 + offsetX;
        y = padding + offsetY;
        break;
      case 'top-right':
        x = canvasWidth - elementWidth - padding + offsetX;
        y = padding + offsetY;
        break;
      case 'center-left':
        x = padding + offsetX;
        y = (canvasHeight - elementHeight) / 2 + offsetY;
        break;
      case 'center':
        x = (canvasWidth - elementWidth) / 2 + offsetX;
        y = (canvasHeight - elementHeight) / 2 + offsetY;
        break;
      case 'center-right':
        x = canvasWidth - elementWidth - padding + offsetX;
        y = (canvasHeight - elementHeight) / 2 + offsetY;
        break;
      case 'bottom-left':
        x = padding + offsetX;
        y = canvasHeight - elementHeight - padding + offsetY;
        break;
      case 'bottom-center':
        x = (canvasWidth - elementWidth) / 2 + offsetX;
        y = canvasHeight - elementHeight - padding + offsetY;
        break;
      case 'bottom-right':
        x = canvasWidth - elementWidth - padding + offsetX;
        y = canvasHeight - elementHeight - padding + offsetY;
        break;
    }

    return { x, y };
  }

  /**
   * Preview watermark settings (returns canvas for preview)
   */
  async previewWatermark(
    imageData: ImageData,
    settings: WatermarkSettings,
    previewSize: { width: number; height: number }
  ): Promise<HTMLCanvasElement> {
    const canvas = document.createElement('canvas');
    canvas.width = previewSize.width;
    canvas.height = previewSize.height;

    const ctx = canvas.getContext('2d')!;

    // Scale image data to preview size
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = imageData.width;
    tempCanvas.height = imageData.height;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(imageData, 0, 0);

    // Draw scaled image
    ctx.drawImage(tempCanvas, 0, 0, previewSize.width, previewSize.height);

    // Apply watermark at preview scale
    const scaledSettings = {
      ...settings,
      fontSize: (settings.fontSize || 24) * (previewSize.width / imageData.width),
      offsetX: (settings.offsetX || 0) * (previewSize.width / imageData.width),
      offsetY: (settings.offsetY || 0) * (previewSize.height / imageData.height),
      padding: (settings.padding || 0) * (previewSize.width / imageData.width),
      spacing: (settings.spacing || 200) * (previewSize.width / imageData.width)
    };

    if (settings.type === 'text' && settings.text) {
      await this.applyTextWatermark(ctx, previewSize.width, previewSize.height, scaledSettings);
    } else if (settings.type === 'image' && (settings.imageUrl || settings.imageData)) {
      await this.applyImageWatermark(ctx, previewSize.width, previewSize.height, scaledSettings);
    }

    return canvas;
  }

  /**
   * Validate watermark settings
   */
  validateSettings(settings: WatermarkSettings): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (settings.enabled) {
      if (settings.type === 'text') {
        if (!settings.text || settings.text.trim() === '') {
          errors.push('Text watermark requires text content');
        }
        if (settings.fontSize && (settings.fontSize < 1 || settings.fontSize > 200)) {
          errors.push('Font size must be between 1 and 200 pixels');
        }
      } else if (settings.type === 'image') {
        if (!settings.imageUrl && !settings.imageData) {
          errors.push('Image watermark requires image URL or image data');
        }
      }

      if (settings.opacity < 0 || settings.opacity > 1) {
        errors.push('Opacity must be between 0 and 1');
      }
      if (settings.scale < 0.1 || settings.scale > 5) {
        errors.push('Scale must be between 0.1 and 5');
      }
      if (settings.rotation < -360 || settings.rotation > 360) {
        errors.push('Rotation must be between -360 and 360 degrees');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Export settings to JSON
   */
  exportSettings(settings: WatermarkSettings): string {
    return JSON.stringify(settings, null, 2);
  }

  /**
   * Import settings from JSON
   */
  importSettings(json: string): WatermarkSettings {
    try {
      const settings = JSON.parse(json) as WatermarkSettings;
      const validation = this.validateSettings(settings);

      if (!validation.valid) {
        throw new Error(`Invalid settings: ${validation.errors.join(', ')}`);
      }

      return settings;
    } catch (error) {
      logger.error('Failed to import watermark settings:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const watermarkService = WatermarkService.getInstance();