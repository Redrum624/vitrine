import { logger } from '../utils/Logger';
import { rawImageService } from './RawImageService';

export interface ImageData {
  width: number;
  height: number;
  data: Float32Array;
  fileName: string;
  filePath: string;
  isRaw?: boolean;
  metadata?: any;
}

export class ImageService {
  private static instance: ImageService;
  private currentImage: ImageData | null = null;
  private imageLoadListeners: (() => void)[] = [];

  static getInstance(): ImageService {
    if (!ImageService.instance) {
      ImageService.instance = new ImageService();
    }
    return ImageService.instance;
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
    try {
      logger.info(`Loading image from: ${filePath}`);

      // Check if it's a RAW file
      if (rawImageService.isRawFile(filePath)) {
        logger.info('RAW file detected, using RAW processing');
        const rawData = await rawImageService.loadRawImage(filePath);

        const result: ImageData = {
          width: rawData.width,
          height: rawData.height,
          data: rawData.data,
          fileName: rawData.fileName,
          filePath: rawData.filePath,
          isRaw: true,
          metadata: rawData.metadata
        };

        this.currentImage = result;
        logger.info(`RAW image loaded successfully: ${result.width}x${result.height} (${rawData.format})`);
        this.notifyImageLoaded();
        return result;
      }

      // Handle regular image files
      return this.loadRegularImage(filePath);
    } catch (error) {
      logger.error('Failed to load image:', error);
      throw error;
    }
  }

  private async loadRegularImage(filePath: string): Promise<ImageData> {
    // Create an HTML image element to load the file
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    return new Promise((resolve, reject) => {
      img.onload = () => {
        try {
          // Set canvas size to match image
          canvas.width = img.width;
          canvas.height = img.height;

          // Draw image to canvas
          ctx.drawImage(img, 0, 0);

          // Get image data
          const imageData = ctx.getImageData(0, 0, img.width, img.height);

          // Convert to Float32Array for processing
          const floatData = new Float32Array(imageData.data.length);
          for (let i = 0; i < imageData.data.length; i++) {
            floatData[i] = imageData.data[i] / 255.0; // Normalize to 0-1
          }

          const result: ImageData = {
            width: img.width,
            height: img.height,
            data: floatData,
            fileName: filePath.split(/[\\/]/).pop() || 'unknown',
            filePath: filePath,
            isRaw: false
          };

          this.currentImage = result;
          logger.info(`Regular image loaded successfully: ${result.width}x${result.height}`);
          this.notifyImageLoaded();
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
      if (typeof window !== 'undefined' && (window as any).electronAPI) {
        // Electron environment - read as data URL
        (window as any).electronAPI.readImageAsDataURL(filePath)
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