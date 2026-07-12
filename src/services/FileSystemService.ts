import { logger } from '../utils/Logger';
import { isElectron } from '../types/electron';

export interface DriveInfo {
  id: string;
  name: string;
  path: string;
  type: 'drive' | 'folder';
  expanded?: boolean;
  children?: (DriveInfo | FolderInfo)[];
}

export interface FolderInfo {
  id: string;
  name: string;
  path: string;
  type: 'folder';
  expanded?: boolean;
  children?: FolderInfo[];
  images?: ImageFileInfo[];
}

export interface ImageFileInfo {
  id: string;
  name: string;
  path: string;
  size: number;
  format: string;
  type: string;
  lastModified: number;
  dimensions?: { width: number; height: number };
  dateModified: Date;
}

// Supported image formats
const IMAGE_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif',
  '.orf', '.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.rw2', '.pef'
];

export class FileSystemService {
  private static instance: FileSystemService;
  private currentImages: ImageFileInfo[] = [];
  private currentImageIndex: number = 0;

  static getInstance(): FileSystemService {
    if (!FileSystemService.instance) {
      FileSystemService.instance = new FileSystemService();
    }
    return FileSystemService.instance;
  }

  // Get system drives (Windows)
  async getSystemDrives(): Promise<DriveInfo[]> {
    try {
      if (isElectron() && window.electronAPI) {
        // Use actual Electron file system APIs
        const drives = await window.electronAPI.getSystemDrives();
        return drives.map(drive => ({
          ...drive,
          expanded: false
        }));
      } else {
        // Fallback for browser/development
        logger.warn('Running in browser mode - using mock data for file system');
        const drives: DriveInfo[] = [
          {
            id: 'c_drive',
            name: 'Local Disk (C:)',
            path: 'C:\\',
            type: 'drive',
            expanded: false
          },
          {
            id: 'pictures',
            name: 'Pictures',
            path: 'C:\\Users\\Pictures',
            type: 'folder',
            expanded: false
          }
        ];
        return drives;
      }
    } catch (error) {
      logger.error('Failed to get system drives:', error);
      return [];
    }
  }

  // Get folder contents
  async getFolderContents(folderPath: string): Promise<{ folders: FolderInfo[]; images: ImageFileInfo[] }> {
    try {
      logger.info(`Getting contents of folder: ${folderPath}`);

      if (isElectron() && window.electronAPI) {
        // Use actual Electron file system APIs
        const contents = await window.electronAPI.getFolderContents(folderPath);

        // Map the results to our interfaces
        const folders: FolderInfo[] = contents.folders.map(folder => ({
          ...folder,
          expanded: false
        }));

        const images: ImageFileInfo[] = contents.images.map(image => ({
          ...image,
          dateModified: new Date(image.lastModified)
        }));

        logger.info(`Loaded folder contents: ${folders.length} folders, ${images.length} images`);
        return { folders, images };
      } else {
        // Fallback for browser/development
        logger.warn('Running in browser mode - using mock data for folder contents');
        if (folderPath.includes('Pictures')) {
          return {
            folders: [
              {
                id: 'camera_roll',
                name: 'Camera Roll',
                path: folderPath + '\\Camera Roll',
                type: 'folder',
                expanded: false
              }
            ],
            images: [
              {
                id: 'img_001',
                name: 'IMG_001.jpg',
                path: folderPath + '\\IMG_001.jpg',
                size: 2500000,
                format: 'JPEG',
                type: 'image/jpeg',
                lastModified: new Date('2024-01-15').getTime(),
                dimensions: { width: 4000, height: 3000 },
                dateModified: new Date('2024-01-15')
              }
            ]
          };
        }
        return { folders: [], images: [] };
      }
    } catch (error) {
      logger.error(`Failed to get folder contents for ${folderPath}:`, error);
      return { folders: [], images: [] };
    }
  }

  // Set current image list for navigation
  setCurrentImages(images: ImageFileInfo[], startIndex: number = 0): void {
    this.currentImages = images;
    this.currentImageIndex = Math.max(0, Math.min(startIndex, images.length - 1));
    logger.info(`Current image list set: ${images.length} images, starting at index ${this.currentImageIndex}`);
  }

  // Navigate to next image
  nextImage(): ImageFileInfo | null {
    if (this.currentImages.length === 0) return null;
    this.currentImageIndex = (this.currentImageIndex + 1) % this.currentImages.length;
    return this.currentImages[this.currentImageIndex];
  }

  // Navigate to previous image
  previousImage(): ImageFileInfo | null {
    if (this.currentImages.length === 0) return null;
    this.currentImageIndex = this.currentImageIndex === 0
      ? this.currentImages.length - 1
      : this.currentImageIndex - 1;
    return this.currentImages[this.currentImageIndex];
  }

  // Get current image
  getCurrentImage(): ImageFileInfo | null {
    if (this.currentImages.length === 0) return null;
    return this.currentImages[this.currentImageIndex];
  }

  // Get current image info
  getCurrentImageInfo(): { current: number; total: number; image: ImageFileInfo | null } {
    return {
      current: this.currentImageIndex + 1,
      total: this.currentImages.length,
      image: this.getCurrentImage()
    };
  }

  // Check if file is an image
  isImageFile(fileName: string): boolean {
    // Get the extension and normalize it to lowercase
    const lastDotIndex = fileName.lastIndexOf('.');
    if (lastDotIndex === -1) return false; // No extension

    const extension = fileName.substring(lastDotIndex).toLowerCase();
    const isImage = IMAGE_EXTENSIONS.includes(extension);

    // Debug logging for ORF files (both cases)
    if (extension === '.orf' || fileName.toLowerCase().includes('.orf')) {
      logger.info(`ORF file check: original="${fileName}", processed extension="${extension}", isImage=${isImage}`);
      logger.info(`Available extensions:`, IMAGE_EXTENSIONS);
    }

    return isImage;
  }

  // Format file size
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}

export const fileSystemService = FileSystemService.getInstance();