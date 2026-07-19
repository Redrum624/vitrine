import { logger } from '../utils/Logger';
import { EXPORT_SUFFIX } from '../utils/exportFilename';
import { isElectron, EmbeddableMetadata } from '../types/electron';
import { COLOR_SPACE_CONVERSIONS } from './colorSpaceMatrices';

export interface ExportOptions {
  // Output format
  format: 'jpeg' | 'png' | 'tiff' | 'webp';

  // Quality settings
  quality: number;           // 0-100 for JPEG/WebP, ignored for PNG/TIFF
  compression: 'none' | 'lzw' | 'zip' | 'jpeg'; // TIFF compression
  progressive?: boolean;     // Progressive encoding for JPEG
  compressionLevel?: number; // PNG compression level (0-9)
  lossless?: boolean;        // Lossless mode for WebP

  // Dimensions
  width?: number;           // Output width (null = original)
  height?: number;          // Output height (null = original)
  resizeMode: 'fit' | 'fill' | 'stretch' | 'crop';
  maintainAspectRatio: boolean;
  resize?: {                // Resize options
    width?: number;
    height?: number;
    fit?: string;
  };

  // Color management
  colorSpace: 'srgb' | 'adobergb' | 'prophoto' | 'rec2020';
  bitDepth: 8 | 16;        // Bit depth per channel

  // Metadata
  preserveMetadata: boolean;
  includeProcessingHistory: boolean;
  customMetadata: Record<string, string>;
  // EXIF copyright/artist + IPTC-as-XMP fields to embed into the exported file:
  // an optional passthrough forwarded straight to the main-process writer, which
  // embeds it during the encode.
  metadata?: EmbeddableMetadata;

  // Sharpening
  outputSharpening: {
    enabled: boolean;
    amount: number;        // 0-100
    radius: number;        // 0.1-5.0
    threshold: number;     // 0-255
    media: 'screen' | 'print' | 'web';
  };

  // File naming
  filename?: string;
  suffix?: string;         // Added to original filename
  outputDirectory?: string;
}

export interface ExportResult {
  success: boolean;
  outputPath?: string;
  outputSize?: number;     // File size in bytes
  dimensions?: { width: number; height: number };
  processingTime?: number;
  error?: string;
  warnings?: string[];
}

export interface ExportPreset {
  id: string;
  name: string;
  description: string;
  options: Partial<ExportOptions>;
}

export class ExportService {
  private readonly defaultOptions: ExportOptions = {
    format: 'png',
    quality: 95,
    compression: 'none',
    resizeMode: 'fit',
    maintainAspectRatio: true,
    // Defaults: original dimensions (no width/height set → no resize), Adobe RGB
    // colour space, and the highest bit depth the default format (PNG) supports.
    colorSpace: 'adobergb',
    bitDepth: 16,
    preserveMetadata: true,
    includeProcessingHistory: false,
    customMetadata: {},
    outputSharpening: {
      // Always OFF. Sharpening now lives in the develop pipeline as the "Sharpen"
      // module (sidebar, under Noise Reduction) so the canvas preview and the export
      // match exactly. The legacy export-time unsharp path is kept inert for back-
      // compat; leaving it enabled here would double-sharpen on top of the module.
      enabled: false,
      amount: 50,
      radius: 1.0,
      threshold: 4,
      media: 'screen'
    }
  };

  private readonly builtinPresets: ExportPreset[] = [
    {
      id: 'web_high',
      name: 'Web (High Quality)',
      description: 'JPEG 95% quality, sRGB, optimized for web',
      options: {
        format: 'jpeg',
        quality: 95,
        colorSpace: 'srgb',
        bitDepth: 8,
        width: 2048,
        height: 2048,
        resizeMode: 'fit',
        outputSharpening: { enabled: false, media: 'web', amount: 60, radius: 1.0, threshold: 0 }
      }
    },
    {
      id: 'web_medium',
      name: 'Web (Medium Quality)',
      description: 'JPEG 85% quality, smaller file size',
      options: {
        format: 'jpeg',
        quality: 85,
        colorSpace: 'srgb',
        bitDepth: 8,
        width: 1200,
        height: 1200,
        resizeMode: 'fit',
        outputSharpening: { enabled: false, media: 'web', amount: 50, radius: 1.0, threshold: 0 }
      }
    },
    {
      id: 'print_high',
      name: 'Print (High Quality)',
      description: 'TIFF 16-bit, Adobe RGB, for professional printing',
      options: {
        format: 'tiff',
        colorSpace: 'adobergb',
        bitDepth: 16,
        compression: 'lzw',
        outputSharpening: { enabled: false, media: 'print', amount: 40, radius: 1.2, threshold: 0 }
      }
    },
    {
      id: 'archive',
      name: 'Archive Quality',
      description: 'PNG lossless, full resolution, maximum quality',
      options: {
        format: 'png',
        colorSpace: 'srgb',
        bitDepth: 16,
        preserveMetadata: true,
        includeProcessingHistory: true,
        outputSharpening: { enabled: false, amount: 50, radius: 1.0, threshold: 0, media: 'screen' }
      }
    },
    {
      id: 'social_media',
      name: 'Social Media',
      description: 'JPEG optimized for social media platforms',
      options: {
        format: 'jpeg',
        quality: 90,
        colorSpace: 'srgb',
        bitDepth: 8,
        width: 1080,
        height: 1080,
        resizeMode: 'crop',
        outputSharpening: { enabled: false, media: 'web', amount: 70, radius: 1.0, threshold: 0 }
      }
    }
  ];

  // Export processed image with given options
  async exportImage(
    imageData: Float32Array,
    originalWidth: number,
    originalHeight: number,
    options: Partial<ExportOptions> = {},
    originalFilePath?: string
  ): Promise<ExportResult> {
    const startTime = performance.now();
    const exportOptions = { ...this.defaultOptions, ...options };
    const warnings: string[] = [];

    try {
      // Debug: Check actual image data dimensions vs expected
      const expectedDataLength = originalWidth * originalHeight * 4; // RGBA
      const actualDataLength = imageData.length;

      logger.info(`Starting export: ${originalWidth}x${originalHeight} to ${exportOptions.format}`);
      logger.info(`Expected data length: ${expectedDataLength}, Actual: ${actualDataLength}`);

      if (expectedDataLength !== actualDataLength) {
        // Try to recover dimensions assuming the same aspect ratio (e.g. a
        // downscaled preview buffer). Only adopt the candidate if it factors
        // EXACTLY into the pixel count — otherwise deriving width/height from a
        // single scalar would fabricate a sheared/mis-strided grid and corrupt
        // the output.
        const actualPixelCount = actualDataLength / 4;
        const aspectRatio = originalWidth / originalHeight;
        const candidateHeight = Math.round(Math.sqrt(actualPixelCount / aspectRatio));
        const candidateWidth = candidateHeight > 0 ? Math.round(actualPixelCount / candidateHeight) : 0;

        if (candidateWidth > 0 && candidateHeight > 0 && candidateWidth * candidateHeight === actualPixelCount) {
          logger.warn(`Export dimension mismatch; using data-derived ${candidateWidth}x${candidateHeight}`);
          originalWidth = candidateWidth;
          originalHeight = candidateHeight;
        } else {
          // Cannot safely recover exact dimensions; keep the caller's values. The
          // main-process writer validates the byte size and throws if they are
          // wrong, surfacing the error instead of writing a sheared image.
          logger.error(
            `Export dimension mismatch: expected ${expectedDataLength} samples for ` +
            `${originalWidth}x${originalHeight}, got ${actualDataLength}. Refusing to fabricate dimensions.`
          );
        }
      }

      // Calculate output dimensions
      const outputDimensions = this.calculateOutputDimensions(
        originalWidth,
        originalHeight,
        exportOptions
      );

      const needsResize =
        outputDimensions.width !== originalWidth || outputDimensions.height !== originalHeight;

      // RESIZE STRATEGY (moved off the renderer main thread): defer the resize to
      // the main process. sharp downscales the raw buffer with lanczos3 BEFORE
      // encode, off the UI thread and at higher quality than the old JS bicubic.
      // The renderer-side sharpening/colour-space/bit-depth steps below run at FULL
      // resolution — they are all PER-PIXEL transforms, so the result is identical
      // whether applied before or after a resize (only the pixel count differs).

      // Dimensions the renderer-side per-pixel steps (sharpen/colour/bit-depth)
      // operate on, and that the buffer handed to createImageFile is sized for.
      // The resize is deferred to sharp, so this stays at the full/original size.
      let processedData = imageData;
      const workingWidth = originalWidth;
      const workingHeight = originalHeight;

      // Apply output sharpening (disabled by default; sharpening lives in the
      // develop pipeline now). Kept inert here for back-compat.
      if (exportOptions.outputSharpening.enabled) {
        processedData = this.applyOutputSharpening(
          processedData,
          workingWidth,
          workingHeight,
          exportOptions.outputSharpening
        );
      }

      // Convert color space if needed
      if (exportOptions.colorSpace !== 'srgb') {
        processedData = this.convertColorSpace(
          processedData,
          workingWidth,
          workingHeight,
          'srgb',
          exportOptions.colorSpace
        );
        warnings.push(`Converted to ${exportOptions.colorSpace} with an embedded ICC profile`);
        if (exportOptions.bitDepth === 16) {
          warnings.push('16-bit + wide-gamut is exported at 8-bit (encoder limitation)');
        }
      }

      // Convert to the appropriate bit depth
      const outputData = this.convertBitDepth(
        processedData,
        workingWidth,
        workingHeight,
        exportOptions.bitDepth
      );

      // Determine output path, then bump the numeric suffix until it's a name
      // that doesn't exist yet — a single export must never overwrite an
      // earlier one (photo_VIT.jpg → photo_VIT_1.jpg → …), matching the
      // multi-export non-clobber behaviour.
      const outputPath = await this.resolveNonClobberingPath(
        this.generateOutputPath(originalFilePath, exportOptions),
      );

      // Create the image file. When the resize was deferred, we pass the full-res
      // buffer dimensions plus the target dimensions so the main-process writer
      // resizes with sharp before encoding.
      await this.createImageFile(
        outputData,
        workingWidth,
        workingHeight,
        exportOptions,
        outputPath,
        needsResize ? outputDimensions : undefined
      );

      // Get file size
      const outputSize = await this.getFileSize(outputPath);

      const processingTime = performance.now() - startTime;
      logger.info(`Export completed in ${processingTime.toFixed(2)}ms: ${outputPath}`);

      return {
        success: true,
        outputPath,
        outputSize,
        dimensions: outputDimensions,
        processingTime,
        warnings: warnings.length > 0 ? warnings : undefined
      };

    } catch (error) {
      const processingTime = performance.now() - startTime;
      logger.error(`Export failed after ${processingTime.toFixed(2)}ms:`, error);

      return {
        success: false,
        processingTime,
        error: error instanceof Error ? error.message : 'Unknown export error'
      };
    }
  }

  // Batch export multiple images
  async batchExport(
    images: Array<{
      data: Float32Array;
      width: number;
      height: number;
      filePath?: string;
    }>,
    options: Partial<ExportOptions> = {}
  ): Promise<ExportResult[]> {
    logger.info(`Starting batch export of ${images.length} images`);

    const results: ExportResult[] = [];

    for (let i = 0; i < images.length; i++) {
      const image = images[i];

      logger.info(`Processing image ${i + 1}/${images.length}`);

      // Add batch suffix to avoid filename conflicts
      const batchOptions = {
        ...options,
        suffix: options.suffix ? `${options.suffix}_${i + 1}` : `_${i + 1}`
      };

      const result = await this.exportImage(
        image.data,
        image.width,
        image.height,
        batchOptions,
        image.filePath
      );

      results.push(result);

      // Brief pause between exports to prevent system overload
      if (i < images.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    const successful = results.filter(r => r.success).length;
    logger.info(`Batch export completed: ${successful}/${images.length} successful`);

    return results;
  }

  // Calculate output dimensions based on resize options
  private calculateOutputDimensions(
    originalWidth: number,
    originalHeight: number,
    options: ExportOptions
  ): { width: number; height: number } {
    let { width, height } = options;

    // If no dimensions specified, use original
    if (!width && !height) {
      return { width: originalWidth, height: originalHeight };
    }

    // If only one dimension specified, calculate the other
    if (!width) {
      width = Math.round((originalWidth * height!) / originalHeight);
    }
    if (!height) {
      height = Math.round((originalHeight * width) / originalWidth);
    }

    if (!options.maintainAspectRatio) {
      return { width, height };
    }

    // Maintain aspect ratio based on resize mode
    const originalAspect = originalWidth / originalHeight;
    const targetAspect = width / height;

    switch (options.resizeMode) {
      case 'fit':
        if (originalAspect > targetAspect) {
          height = Math.round(width / originalAspect);
        } else {
          width = Math.round(height * originalAspect);
        }
        break;

      case 'fill':
        if (originalAspect > targetAspect) {
          width = Math.round(height * originalAspect);
        } else {
          height = Math.round(width / originalAspect);
        }
        break;

      case 'crop':
        // Keep target dimensions, will crop during resize
        break;

      case 'stretch':
        // Keep target dimensions, ignore aspect ratio
        break;
    }

    return { width, height };
  }

  // Apply output sharpening
  private applyOutputSharpening(
    imageData: Float32Array,
    width: number,
    height: number,
    sharpening: ExportOptions['outputSharpening']
  ): Float32Array {
    const { amount, radius, threshold } = sharpening;

    if (amount === 0) return imageData;

    logger.debug(`Applying output sharpening: amount=${amount}, radius=${radius}, threshold=${threshold}`);

    const sharpened = new Float32Array(imageData);
    const blurred = this.gaussianBlur(imageData, width, height, radius);

    const normalizedAmount = amount / 100.0;
    const normalizedThreshold = threshold / 255.0;

    for (let i = 0; i < imageData.length; i += 4) {
      for (let c = 0; c < 3; c++) { // RGB channels only
        const original = imageData[i + c];
        const blur = blurred[i + c];
        const difference = Math.abs(original - blur);

        if (difference > normalizedThreshold) {
          const sharpAmount = normalizedAmount * (difference / normalizedThreshold);
          const unsharpMask = original + (original - blur) * sharpAmount;
          sharpened[i + c] = Math.max(0, Math.min(1, unsharpMask));
        }
      }
    }

    return sharpened;
  }

  // Gaussian blur for unsharp mask
  private gaussianBlur(
    imageData: Float32Array,
    width: number,
    height: number,
    radius: number
  ): Float32Array {
    // Separable box-blur approximation: a horizontal pass followed by a vertical
    // pass. BOTH passes are required for an isotropic blur — running only the
    // horizontal pass produced directionally-biased sharpening (only vertical
    // edges) on every export, since output sharpening is enabled by default.
    const kernelSize = Math.max(3, Math.round(radius * 2) * 2 + 1);
    const halfKernel = Math.floor(kernelSize / 2);

    // Horizontal pass: imageData -> horizontal
    const horizontal = new Float32Array(imageData);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const destIndex = (y * width + x) * 4;
        let r = 0, g = 0, b = 0, a = 0, weightSum = 0;

        for (let kx = -halfKernel; kx <= halfKernel; kx++) {
          const sx = Math.max(0, Math.min(width - 1, x + kx));
          const srcIndex = (y * width + sx) * 4;
          r += imageData[srcIndex];
          g += imageData[srcIndex + 1];
          b += imageData[srcIndex + 2];
          a += imageData[srcIndex + 3];
          weightSum += 1;
        }

        horizontal[destIndex] = r / weightSum;
        horizontal[destIndex + 1] = g / weightSum;
        horizontal[destIndex + 2] = b / weightSum;
        horizontal[destIndex + 3] = a / weightSum;
      }
    }

    // Vertical pass: horizontal -> blurred
    const blurred = new Float32Array(horizontal);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const destIndex = (y * width + x) * 4;
        let r = 0, g = 0, b = 0, a = 0, weightSum = 0;

        for (let ky = -halfKernel; ky <= halfKernel; ky++) {
          const sy = Math.max(0, Math.min(height - 1, y + ky));
          const srcIndex = (sy * width + x) * 4;
          r += horizontal[srcIndex];
          g += horizontal[srcIndex + 1];
          b += horizontal[srcIndex + 2];
          a += horizontal[srcIndex + 3];
          weightSum += 1;
        }

        blurred[destIndex] = r / weightSum;
        blurred[destIndex + 1] = g / weightSum;
        blurred[destIndex + 2] = b / weightSum;
        blurred[destIndex + 3] = a / weightSum;
      }
    }

    return blurred;
  }

  // Convert from sRGB to a wide-gamut output space (Adobe RGB / ProPhoto /
  // Rec.2020) using the linear-light matrices generated alongside the embedded
  // ICC profiles (scripts/gen-icc-profiles.cjs). Decodes the sRGB gamma, applies
  // the sRGB->target 3x3 matrix in linear light, then re-encodes with the target
  // profile's TRC gamma so the pixel values match the ICC profile the writer
  // attaches. Returns the input unchanged when no conversion is defined.
  private convertColorSpace(
    imageData: Float32Array,
    _width: number,
    _height: number,
    fromSpace: string,
    toSpace: string
  ): Float32Array {
    if (fromSpace === toSpace) return imageData;

    const conv = COLOR_SPACE_CONVERSIONS[toSpace];
    if (fromSpace !== 'srgb' || !conv) {
      logger.warn(`No color-space conversion for ${fromSpace} -> ${toSpace}; exporting sRGB values`);
      return imageData;
    }

    logger.debug(`Converting color space: ${fromSpace} → ${toSpace}`);

    const m = conv.srgbToLinearTarget;
    const encodeGamma = 1 / conv.gamma;
    const srgbToLinear = (c: number): number =>
      c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

    const converted = new Float32Array(imageData);
    for (let i = 0; i < imageData.length; i += 4) {
      const r = srgbToLinear(imageData[i]);
      const g = srgbToLinear(imageData[i + 1]);
      const b = srgbToLinear(imageData[i + 2]);

      const lr = Math.max(0, m[0][0] * r + m[0][1] * g + m[0][2] * b);
      const lg = Math.max(0, m[1][0] * r + m[1][1] * g + m[1][2] * b);
      const lb = Math.max(0, m[2][0] * r + m[2][1] * g + m[2][2] * b);

      converted[i] = Math.min(1, Math.pow(lr, encodeGamma));
      converted[i + 1] = Math.min(1, Math.pow(lg, encodeGamma));
      converted[i + 2] = Math.min(1, Math.pow(lb, encodeGamma));
      // alpha (i + 3) left unchanged
    }

    return converted;
  }

  // Convert bit depth
  private convertBitDepth(
    imageData: Float32Array,
    width: number,
    height: number,
    bitDepth: 8 | 16
  ): Uint8Array | Uint16Array {
    if (bitDepth === 8) {
      const output = new Uint8Array(width * height * 4);
      for (let i = 0; i < imageData.length; i++) {
        output[i] = Math.round(Math.max(0, Math.min(1, imageData[i])) * 255);
      }
      return output;
    } else {
      const output = new Uint16Array(width * height * 4);
      for (let i = 0; i < imageData.length; i++) {
        output[i] = Math.round(Math.max(0, Math.min(1, imageData[i])) * 65535);
      }
      return output;
    }
  }

  /**
   * If `outputPath` already exists on disk, append/bump a numeric suffix
   * (…_VIT.jpg → …_VIT_1.jpg → …_VIT_2.jpg) until the name is free. Fail-open:
   * if the existence check is unavailable (browser env / IPC error), the
   * original path is returned unchanged (pre-existing overwrite behaviour).
   */
  private async resolveNonClobberingPath(outputPath: string): Promise<string> {
    const exists = async (p: string): Promise<boolean> => {
      try {
        if (isElectron() && window.electronAPI?.fileExists) {
          return await window.electronAPI.fileExists(p);
        }
      } catch { /* fail-open */ }
      return false;
    };

    if (!(await exists(outputPath))) return outputPath;

    const dot = outputPath.lastIndexOf('.');
    const stem = dot > 0 ? outputPath.slice(0, dot) : outputPath;
    const ext = dot > 0 ? outputPath.slice(dot) : '';
    for (let n = 1; n < 1000; n++) {
      const candidate = `${stem}_${n}${ext}`;
      if (!(await exists(candidate))) return candidate;
    }
    return outputPath; // 999 collisions — give up and overwrite rather than loop forever
  }

  // Generate output file path. NOTE: basenames are split on BOTH "/" and "\\" —
  // Windows source paths use backslashes, so splitting on "/" only left the whole
  // absolute path as the "filename" and produced e.g. "C:\\...\\Desktop/C:\\...\\img.jpg".
  private generateOutputPath(originalPath: string | undefined, options: ExportOptions): string {
    const baseNameOf = (p: string) => p.split(/[/\\]/).pop() || p;
    const join = (dir: string, name: string) => `${dir.replace(/[/\\]+$/, '')}/${name}`;

    if (options.filename) {
      return options.outputDirectory ? join(options.outputDirectory, baseNameOf(options.filename)) : options.filename;
    }

    const stem = (originalPath ? baseNameOf(originalPath) : 'exported_image').replace(/\.[^/.]+$/, '');
    const suffix = options.suffix || EXPORT_SUFFIX;
    const extension = options.format === 'jpeg' ? 'jpg' : options.format;
    const filename = `${stem}${suffix}.${extension}`;

    if (options.outputDirectory) return join(options.outputDirectory, filename);

    // No output directory chosen → write next to the original (keep its folder).
    if (originalPath) {
      const dir = originalPath.slice(0, originalPath.length - baseNameOf(originalPath).length).replace(/[/\\]+$/, '');
      return dir ? join(dir, filename) : filename;
    }
    return filename;
  }

  // Create image file (simplified - would use actual image libraries in production)
  private async createImageFile(
    imageData: Uint8Array | Uint16Array,
    width: number,
    height: number,
    options: ExportOptions,
    outputPath: string,
    // When set, the buffer is at full/original resolution and the main-process
    // writer must resize it (with sharp, off the renderer thread) to these dims
    // BEFORE encoding. Omitted when no resize is needed.
    targetDimensions?: { width: number; height: number }
  ): Promise<void> {
    logger.debug(`Creating ${options.format.toUpperCase()} file: ${width}x${height}, ${options.bitDepth}-bit`);

    if (isElectron() && window.electronAPI) {
      // Use Electron with Sharp for high-quality image processing
      const exportOptions: Record<string, unknown> = {
        width,
        height,
        channels: 4, // RGBA
        bitDepth: options.bitDepth,     // tells the writer to use 16-bit (ushort) raw input
        colorSpace: options.colorSpace, // drives ICC tagging (sRGB embedded by the writer)
        quality: options.quality,
        progressive: options.progressive,
        compressionLevel: options.compressionLevel,
        compression: options.compression,
        lossless: options.lossless
      };

      // Primary export resize, deferred to the main process (sharp lanczos3).
      // ExportService.calculateOutputDimensions already produced aspect-correct
      // dimensions, so 'fill' honours them exactly without re-applying aspect math.
      if (targetDimensions) {
        exportOptions.targetWidth = targetDimensions.width;
        exportOptions.targetHeight = targetDimensions.height;
        exportOptions.targetFit = 'fill';
      }

      // Add resize options if specified
      if (options.resize && (options.resize.width || options.resize.height)) {
        exportOptions.resize = {
          width: options.resize.width,
          height: options.resize.height,
          fit: options.resize.fit || 'inside'
        };
      }

      // Embed copyright/IPTC metadata when the caller supplied an EXIF/XMP block.
      if (options.metadata && (options.metadata.exif || options.metadata.xmp)) {
        exportOptions.metadata = options.metadata;
      }

      await window.electronAPI.writeImageFile(
        outputPath,
        imageData.buffer as ArrayBuffer, // Type assertion for ArrayBuffer
        options.format,
        exportOptions as {
          width: number;
          height: number;
          channels?: number;
          bitDepth?: number;
          colorSpace?: string;
          quality?: number;
          progressive?: boolean;
          compressionLevel?: number;
          compression?: string;
          lossless?: boolean;
          targetWidth?: number;
          targetHeight?: number;
          targetFit?: string;
          resize?: {
            width?: number;
            height?: number;
            fit?: string;
          };
          metadata?: EmbeddableMetadata;
        }
      );
    } else {
      // No browser export path: the only real writer is the Electron/Sharp
      // pipeline above. Fail loudly instead of fabricating a successful save.
      throw new Error('Image export is only supported in the Electron app');
    }
  }

  // Get file size
  private async getFileSize(filePath: string): Promise<number> {
    if (isElectron() && window.electronAPI) {
      try {
        const stats = await window.electronAPI.getFileStats(filePath);
        return stats.size;
      } catch (error) {
        logger.warn('Failed to get file size, using fallback:', error);
        return 0;
      }
    } else {
      // Browser fallback: no filesystem access, so the real size is unknown.
      // Never fabricate a size; report 0 rather than an invented value.
      logger.warn('Browser mode: Cannot get actual file size');
      return 0;
    }
  }

  // Get available presets
  getPresets(): ExportPreset[] {
    return [...this.builtinPresets];
  }

  // Get preset by ID
  getPreset(id: string): ExportPreset | undefined {
    return this.builtinPresets.find(preset => preset.id === id);
  }

  // Get default options
  getDefaultOptions(): ExportOptions {
    return { ...this.defaultOptions };
  }

  // Validate export options
  validateOptions(options: Partial<ExportOptions>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (options.quality !== undefined && (options.quality < 0 || options.quality > 100)) {
      errors.push('Quality must be between 0 and 100');
    }

    if (options.width !== undefined && options.width <= 0) {
      errors.push('Width must be positive');
    }

    if (options.height !== undefined && options.height <= 0) {
      errors.push('Height must be positive');
    }

    if (options.outputSharpening?.amount !== undefined &&
        (options.outputSharpening.amount < 0 || options.outputSharpening.amount > 100)) {
      errors.push('Sharpening amount must be between 0 and 100');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// Export singleton
export const exportService = new ExportService();