import { logger } from '../utils/Logger';

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
      // In Electron, we would use Node.js fs APIs
      // For now, simulate common Windows drives
      const drives: DriveInfo[] = [
        {
          id: 'c_drive',
          name: 'Local Disk (C:)',
          path: 'C:\\',
          type: 'drive',
          expanded: false
        },
        {
          id: 'd_drive',
          name: 'Local Disk (D:)',
          path: 'D:\\',
          type: 'drive',
          expanded: false
        }
      ];

      // Add user folders
      const userFolders: DriveInfo[] = [
        {
          id: 'pictures',
          name: 'Pictures',
          path: 'C:\\Users\\Pictures',
          type: 'folder',
          expanded: false
        },
        {
          id: 'documents',
          name: 'Documents',
          path: 'C:\\Users\\Documents',
          type: 'folder',
          expanded: false
        },
        {
          id: 'desktop',
          name: 'Desktop',
          path: 'C:\\Users\\Desktop',
          type: 'folder',
          expanded: false
        }
      ];

      return [...drives, ...userFolders];
    } catch (error) {
      logger.error('Failed to get system drives:', error);
      return [];
    }
  }

  // Get folder contents
  async getFolderContents(folderPath: string): Promise<{ folders: FolderInfo[]; images: ImageFileInfo[] }> {
    try {
      logger.info(`Getting contents of folder: ${folderPath}`);

      // In Electron, we would use Node.js fs.readdir()
      // For demo, return mock data based on common folders
      if (folderPath.includes('Pictures')) {
        return {
          folders: [
            {
              id: 'camera_roll',
              name: 'Camera Roll',
              path: folderPath + '\\Camera Roll',
              type: 'folder',
              expanded: false
            },
            {
              id: 'screenshots',
              name: 'Screenshots',
              path: folderPath + '\\Screenshots',
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
              dimensions: { width: 4000, height: 3000 },
              dateModified: new Date('2024-01-15')
            },
            {
              id: 'raw_001',
              name: 'DSC_001.orf',
              path: folderPath + '\\DSC_001.orf',
              size: 25000000,
              format: 'ORF',
              dimensions: { width: 5184, height: 3888 },
              dateModified: new Date('2024-01-14')
            },
            {
              id: 'img_002',
              name: 'IMG_002.png',
              path: folderPath + '\\IMG_002.png',
              size: 8500000,
              format: 'PNG',
              dimensions: { width: 3840, height: 2160 },
              dateModified: new Date('2024-01-13')
            }
          ]
        };
      }

      // Default empty folder
      return { folders: [], images: [] };
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
    const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
    return IMAGE_EXTENSIONS.includes(extension);
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