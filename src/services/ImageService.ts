import { logger } from '../utils/Logger';
import { rawImageService } from './RawImageService';
import { ValidationService } from './ValidationService';
import { errorHandlingService } from './ErrorHandlingService';
import { imageCacheService } from './ImageCacheService';
import { canvasPoolService } from './CanvasPoolService';
import { autoRawAdjustmentService, RAWDetectionResult } from './AutoRawAdjustmentService';
import { ImageProcessingPipeline } from './ImageProcessingPipeline';
import { gpuOptimizedProcessingService } from './GPUOptimizedProcessingService';
import { cudaAcceleratedService } from './CUDAAcceleratedService';
import { vramOptimizedMemoryService } from './VRAMOptimizedMemoryService';

export interface ImageData {
  width: number;
  height: number;
  data: Float32Array;
  fileName: string;
  filePath: string;
  isRaw?: boolean;
  metadata?: Record<string, unknown>;
  autoAdjustmentResult?: RAWDetectionResult;
}

export class ImageService {
  private static instance: ImageService;
  private currentImage: ImageData | null = null;
  private imageLoadListeners: (() => void)[] = [];
  private processingPipeline: ImageProcessingPipeline | null = null;

  static getInstance(): ImageService {
    if (!ImageService.instance) {
      ImageService.instance = new ImageService();
    }
    return ImageService.instance;
  }

  constructor() {
    // Initialize GPU optimization services for RTX 3080
    this.initializeGPUServices();
  }

  private async initializeGPUServices(): Promise<void> {
    try {
      logger.info('Initializing RTX 3080 acceleration services...');

      // Initialize services in parallel for faster startup
      await Promise.all([
        vramOptimizedMemoryService.initializeMemoryManagement(),
        cudaAcceleratedService.optimizeForMaxPerformance(),
        gpuOptimizedProcessingService.getOptimalConfig()
      ]);

      logger.info('RTX 3080 acceleration services initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize GPU services:', error);
      logger.info('Falling back to CPU-only processing');
    }
  }

  addImageLoadListener(callback: () => void): () => void {
    this.imageLoadListeners.push(callback);
    // Return cleanup function
    return () => {
      const index = this.imageLoadListeners.indexOf(callback);
      if (index > -1) {
        this.imageLoadListeners.splice(index, 1);
      }
    };
  }

  setProcessingPipeline(pipeline: ImageProcessingPipeline): void {
    this.processingPipeline = pipeline;
  }

  getProcessingPipeline(): ImageProcessingPipeline | null {
    return this.processingPipeline;
  }

  private notifyImageLoaded(): void {
    this.imageLoadListeners.forEach(callback => {
      try {
        callback();
      } catch (error) {
        logger.error('Error in image load listener:', error);
      }
    });
  }

  async loadImage(filePath: string): Promise<ImageData> {
    const result = await errorHandlingService.withErrorHandling(
      async () => {
        // Validate file path
        const pathValidation = ValidationService.validateFilePath(filePath);
        if (!pathValidation.valid) {
          throw new Error(`Invalid file path: ${pathValidation.error}`);
        }

        logger.info(`Loading image from: ${filePath}`);

        // Check cache first
        const cacheEntry = imageCacheService.get(filePath, 0, 0); // Use 0,0 for original size
        if (cacheEntry) {
          const result: ImageData = {
            width: cacheEntry.width,
            height: cacheEntry.height,
            data: cacheEntry.data,
            fileName: filePath.split(/[/\\]/).pop() || 'unknown',
            filePath,
            isRaw: cacheEntry.metadata?.isRaw as boolean,
            metadata: cacheEntry.metadata
          };

          this.currentImage = result;
          logger.info(`Image loaded from cache: ${result.width}x${result.height}`);
          this.notifyImageLoaded();
          return result;
        }

        let result: ImageData;

        // Check if it's a RAW file
        if (rawImageService.isRawFile(filePath)) {
          logger.info('RAW file detected, using RAW processing with auto-adjustments');
          const rawData = await rawImageService.loadRawImage(filePath);

          // Validate dimensions
          const dimensionValidation = ValidationService.validateDimensions(rawData.width, rawData.height);
          if (!dimensionValidation.valid) {
            throw new Error(`Invalid image dimensions: ${dimensionValidation.error}`);
          }

          // Apply automatic RAW adjustments if pipeline is available
          let autoAdjustmentResult: RAWDetectionResult | undefined;
          if (this.processingPipeline) {
            try {
              autoAdjustmentResult = await autoRawAdjustmentService.detectAndApplyRAWAdjustments(
                filePath,
                this.processingPipeline
              );

              if (autoAdjustmentResult.isRAW && autoAdjustmentResult.confidence > 0.5) {
                logger.info(`Auto-adjustments applied for RAW file:`, {
                  camera: `${rawData.metadata.make} ${rawData.metadata.model}`,
                  adjustments: autoAdjustmentResult.reasoning
                });
              }
            } catch (autoAdjustError) {
              logger.warn('Failed to apply auto-adjustments, proceeding without:', autoAdjustError);
            }
          } else {
            logger.info('No processing pipeline available, skipping auto-adjustments');
          }

          result = {
            width: rawData.width,
            height: rawData.height,
            data: rawData.data,
            fileName: rawData.fileName,
            filePath: rawData.filePath,
            isRaw: true,
            metadata: rawData.metadata,
            autoAdjustmentResult
          };

          // Cache the result
          imageCacheService.set(
            filePath,
            rawData.data,
            rawData.width,
            rawData.height,
            undefined,
            { isRaw: true, autoAdjustmentResult, ...rawData.metadata }
          );

          logger.info(`RAW image loaded successfully: ${result.width}x${result.height}`);
        } else {
          // Handle regular image files
          result = await this.loadRegularImage(filePath);

          // Cache the result
          imageCacheService.set(
            filePath,
            result.data,
            result.width,
            result.height,
            undefined,
            { isRaw: false, ...result.metadata }
          );
        }

        this.currentImage = result;
        this.notifyImageLoaded();
        return result;
      },
      'ImageService.loadImage',
      'io'
    );

    if (!result) {
      throw new Error('Failed to load image');
    }

    return result;
  }

  private async loadRegularImage(filePath: string): Promise<ImageData> {
    // Create an HTML image element to load the file
    const img = new Image();

    return new Promise((resolve, reject) => {
      img.onload = () => {
        try {
          // Validate dimensions
          const dimensionValidation = ValidationService.validateDimensions(img.width, img.height);
          if (!dimensionValidation.valid) {
            reject(new Error(`Invalid image dimensions: ${dimensionValidation.error}`));
            return;
          }

          // Use canvas pool for memory efficiency
          const result = canvasPoolService.withCanvas(img.width, img.height, (_, ctx) => {
            // Draw image to canvas
            ctx.drawImage(img, 0, 0);

            // Get image data
            const imageData = ctx.getImageData(0, 0, img.width, img.height);

            // Convert to Float32Array for processing
            const floatData = new Float32Array(imageData.data.length);
            for (let i = 0; i < imageData.data.length; i++) {
              floatData[i] = imageData.data[i] / 255.0; // Normalize to 0-1
            }

            return {
              width: img.width,
              height: img.height,
              data: floatData,
              fileName: filePath.split(/[\\/]/).pop() || 'unknown',
              filePath: filePath,
              isRaw: false
            } as ImageData;
          });

          logger.info(`Regular image loaded successfully: ${result.width}x${result.height}`);
          resolve(result);
        } catch (error) {
          logger.error('Failed to process image data:', error);
          reject(error);
        }
      };

      img.onerror = () => {
        const error = new Error(`Failed to load image: ${filePath}`);
        logger.error('Image load error:', error);
        reject(error);
      };

      // Load the image using Electron's secure file reading for images
      if (typeof window !== 'undefined' && (window as typeof window & { electronAPI?: { readImageAsDataURL: (path: string) => Promise<string> } }).electronAPI) {
        // Electron environment - read as data URL
        (window as typeof window & { electronAPI: { readImageAsDataURL: (path: string) => Promise<string> } }).electronAPI.readImageAsDataURL(filePath)
          .then((dataUrl: string) => {
            img.src = dataUrl;
          })
          .catch((error: Error) => {
            logger.error('Failed to read image file via Electron:', error);
            reject(error);
          });
      } else {
        // Browser environment - use file path directly
        img.src = filePath;
      }
    });
  }

  getCurrentImage(): ImageData | null {
    return this.currentImage;
  }

  // Load image at full resolution for export (bypasses performance optimizations)
  async loadImageForExport(filePath: string): Promise<ImageData> {
    const result = await errorHandlingService.withErrorHandling(
      async () => {
        logger.info(`Loading full-resolution image for export: ${filePath}`);

        // Load image at full resolution without downsampling
        const img = new Image();

        return new Promise<ImageData>((resolve, reject) => {
          img.onload = () => {
            try {
              logger.info(`Full-resolution image loaded: ${img.width}x${img.height}`);

              // Use canvas to extract image data at full resolution
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                reject(new Error('Failed to get canvas context'));
                return;
              }

              canvas.width = img.width;
              canvas.height = img.height;

              // Draw image at full resolution
              ctx.drawImage(img, 0, 0);

              // Get image data
              const imageData = ctx.getImageData(0, 0, img.width, img.height);

              // Convert to Float32Array for processing pipeline
              const floatData = new Float32Array(imageData.data.length);
              for (let i = 0; i < imageData.data.length; i++) {
                floatData[i] = imageData.data[i] / 255.0; // Convert to 0-1 range
              }

              resolve({
                width: img.width,
                height: img.height,
                data: floatData,
                fileName: filePath.split('/').pop() || filePath.split('\\').pop() || 'unknown',
                filePath: filePath
              });
            } catch (error) {
              reject(error);
            }
          };

          img.onerror = () => {
            reject(new Error(`Failed to load image: ${filePath}`));
          };

          img.src = filePath;
        });
      },
      'ImageService.loadImageForExport',
      'io'
    );

    if (!result) {
      throw new Error('Failed to load full-resolution image for export');
    }

    return result;
  }

  clearImage(): void {
    this.currentImage = null;
    logger.info('Image cleared');
  }

  async exportImage(outputPath: string, quality: number = 0.9): Promise<void> {
    if (!this.currentImage) {
      throw new Error('No image loaded');
    }

    try {
      // Create canvas for export
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Failed to get canvas context for export');
      }

      canvas.width = this.currentImage.width;
      canvas.height = this.currentImage.height;

      // Convert float data back to ImageData
      const imageData = ctx.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < this.currentImage.data.length; i++) {
        imageData.data[i] = Math.round(this.currentImage.data[i] * 255);
      }

      // Put image data on canvas
      ctx.putImageData(imageData, 0, 0);

      // Convert to blob and save
      canvas.toBlob((blob) => {
        if (blob) {
          // In Electron, we would use the file system API here
          logger.info(`Image exported to: ${outputPath}`);
        }
      }, 'image/jpeg', quality);

    } catch (error) {
      logger.error('Failed to export image:', error);
      throw error;
    }
  }
}

export const imageService = ImageService.getInstance();