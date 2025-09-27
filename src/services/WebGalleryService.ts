import { logger } from '../utils/Logger';

export interface GalleryImage {
  id: string;
  originalPath: string;
  title: string;
  description?: string;
  captureDate?: Date;
  camera?: string;
  lens?: string;
  settings?: {
    iso?: number;
    aperture?: number;
    shutterSpeed?: string;
    focalLength?: number;
  };
  keywords?: string[];
  thumbnailData?: string; // Base64 encoded
  previewData?: string; // Base64 encoded
  fullSizeData?: string; // Base64 encoded
}

export interface GalleryTheme {
  name: string;
  displayName: string;
  description: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  fontFamily: string;
  thumbnailSize: number;
  thumbnailSpacing: number;
  showMetadata: boolean;
  showTitles: boolean;
  lightboxEnabled: boolean;
  responsive: boolean;
}

export interface GallerySettings {
  title: string;
  description?: string;
  theme: GalleryTheme;
  layout: 'grid' | 'masonry' | 'justified' | 'slideshow';
  thumbnailQuality: 'low' | 'medium' | 'high';
  previewQuality: 'medium' | 'high' | 'maximum';
  includeMetadata: boolean;
  includeDownloadLinks: boolean;
  enableComments: boolean;
  enableSocialSharing: boolean;
  password?: string;
  watermark?: {
    enabled: boolean;
    text?: string;
    position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'center';
    opacity: number;
  };
}

export interface GalleryOutput {
  htmlContent: string;
  cssContent: string;
  jsContent: string;
  images: {
    thumbnails: Map<string, string>; // Base64 data
    previews: Map<string, string>;
    fullSize: Map<string, string>;
  };
  totalSize: number; // in bytes
}

/**
 * Web Gallery Service
 * Generates responsive HTML galleries for photo sharing
 */
export class WebGalleryService {
  private static instance: WebGalleryService;
  private galleryThemes: Map<string, GalleryTheme> = new Map();

  static getInstance(): WebGalleryService {
    if (!WebGalleryService.instance) {
      WebGalleryService.instance = new WebGalleryService();
    }
    return WebGalleryService.instance;
  }

  constructor() {
    this.initializeThemes();
  }

  /**
   * Initialize built-in gallery themes
   */
  private initializeThemes(): void {
    // Modern Dark Theme
    this.addTheme({
      name: 'modern-dark',
      displayName: 'Modern Dark',
      description: 'Clean dark theme for contemporary galleries',
      primaryColor: '#1f2937',
      secondaryColor: '#374151',
      backgroundColor: '#111827',
      textColor: '#f9fafb',
      accentColor: '#3b82f6',
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
      thumbnailSize: 280,
      thumbnailSpacing: 16,
      showMetadata: true,
      showTitles: true,
      lightboxEnabled: true,
      responsive: true
    });

    // Clean Light Theme
    this.addTheme({
      name: 'clean-light',
      displayName: 'Clean Light',
      description: 'Minimal light theme with focus on images',
      primaryColor: '#ffffff',
      secondaryColor: '#f3f4f6',
      backgroundColor: '#fafafa',
      textColor: '#111827',
      accentColor: '#059669',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      thumbnailSize: 250,
      thumbnailSpacing: 20,
      showMetadata: false,
      showTitles: true,
      lightboxEnabled: true,
      responsive: true
    });

    // Photography Portfolio
    this.addTheme({
      name: 'portfolio',
      displayName: 'Photography Portfolio',
      description: 'Professional portfolio theme with large previews',
      primaryColor: '#000000',
      secondaryColor: '#1a1a1a',
      backgroundColor: '#0a0a0a',
      textColor: '#ffffff',
      accentColor: '#fbbf24',
      fontFamily: 'Georgia, Times, serif',
      thumbnailSize: 320,
      thumbnailSpacing: 24,
      showMetadata: true,
      showTitles: true,
      lightboxEnabled: true,
      responsive: true
    });

    // Vintage Gallery
    this.addTheme({
      name: 'vintage',
      displayName: 'Vintage Gallery',
      description: 'Classic gallery with warm tones',
      primaryColor: '#8b5a2b',
      secondaryColor: '#a0672a',
      backgroundColor: '#f4f1eb',
      textColor: '#2d1b0e',
      accentColor: '#dc2626',
      fontFamily: 'Times New Roman, serif',
      thumbnailSize: 240,
      thumbnailSpacing: 12,
      showMetadata: true,
      showTitles: true,
      lightboxEnabled: true,
      responsive: true
    });

    // Masonry Grid
    this.addTheme({
      name: 'masonry',
      displayName: 'Masonry Grid',
      description: 'Pinterest-style masonry layout',
      primaryColor: '#ffffff',
      secondaryColor: '#e5e7eb',
      backgroundColor: '#f9fafb',
      textColor: '#374151',
      accentColor: '#8b5cf6',
      fontFamily: 'Helvetica Neue, Arial, sans-serif',
      thumbnailSize: 280,
      thumbnailSpacing: 16,
      showMetadata: false,
      showTitles: true,
      lightboxEnabled: true,
      responsive: true
    });

    logger.info(`Initialized ${this.galleryThemes.size} gallery themes`);
  }

  /**
   * Add custom theme
   */
  addTheme(theme: GalleryTheme): void {
    this.galleryThemes.set(theme.name, theme);
  }

  /**
   * Get all available themes
   */
  getThemes(): GalleryTheme[] {
    return Array.from(this.galleryThemes.values());
  }

  /**
   * Get theme by name
   */
  getTheme(name: string): GalleryTheme | undefined {
    return this.galleryThemes.get(name);
  }

  /**
   * Generate web gallery from images
   */
  async generateGallery(
    images: GalleryImage[],
    settings: GallerySettings
  ): Promise<GalleryOutput> {
    const startTime = performance.now();
    logger.info('Generating web gallery', {
      imageCount: images.length,
      theme: settings.theme.name,
      layout: settings.layout
    });

    // Process images for different sizes
    const processedImages = await this.processImages(images, settings);

    // Generate HTML structure
    const htmlContent = this.generateHTML(images, settings);

    // Generate CSS styles
    const cssContent = this.generateCSS(settings);

    // Generate JavaScript functionality
    const jsContent = this.generateJavaScript(settings);

    // Calculate total size
    let totalSize = htmlContent.length + cssContent.length + jsContent.length;
    for (const imageData of [
      ...processedImages.thumbnails.values(),
      ...processedImages.previews.values(),
      ...processedImages.fullSize.values()
    ]) {
      totalSize += imageData.length;
    }

    const processingTime = performance.now() - startTime;
    logger.info(`Web gallery generated in ${processingTime.toFixed(2)}ms`, {
      totalSize: `${(totalSize / 1024 / 1024).toFixed(2)}MB`
    });

    return {
      htmlContent,
      cssContent,
      jsContent,
      images: processedImages,
      totalSize
    };
  }

  /**
   * Process images into different sizes
   */
  private async processImages(
    images: GalleryImage[],
    settings: GallerySettings
  ): Promise<{
    thumbnails: Map<string, string>;
    previews: Map<string, string>;
    fullSize: Map<string, string>;
  }> {
    const thumbnails = new Map<string, string>();
    const previews = new Map<string, string>();
    const fullSize = new Map<string, string>();

    for (const image of images) {
      // Use existing processed data or generate placeholder
      if (image.thumbnailData) {
        thumbnails.set(image.id, image.thumbnailData);
      } else {
        thumbnails.set(image.id, this.generatePlaceholder(settings.theme.thumbnailSize, settings.theme.thumbnailSize));
      }

      if (image.previewData) {
        previews.set(image.id, image.previewData);
      } else {
        previews.set(image.id, this.generatePlaceholder(800, 600));
      }

      if (image.fullSizeData) {
        fullSize.set(image.id, image.fullSizeData);
      } else {
        fullSize.set(image.id, this.generatePlaceholder(1920, 1440));
      }
    }

    return { thumbnails, previews, fullSize };
  }

  /**
   * Generate placeholder image
   */
  private generatePlaceholder(width: number, height: number): string {
    // Create a simple SVG placeholder
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#e5e7eb"/>
        <text x="50%" y="50%" font-family="Arial" font-size="14" fill="#9ca3af" text-anchor="middle" dominant-baseline="middle">
          ${width}×${height}
        </text>
      </svg>
    `;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }

  /**
   * Generate HTML structure
   */
  private generateHTML(images: GalleryImage[], settings: GallerySettings): string {
    const imageGrid = this.generateImageGrid(images, settings);
    const lightbox = settings.theme.lightboxEnabled ? this.generateLightbox() : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.escapeHtml(settings.title)}</title>
    <meta name="description" content="${this.escapeHtml(settings.description || '')}">
    <link rel="stylesheet" href="gallery.css">
</head>
<body class="gallery-${settings.theme.name} layout-${settings.layout}">
    <header class="gallery-header">
        <h1 class="gallery-title">${this.escapeHtml(settings.title)}</h1>
        ${settings.description ? `<p class="gallery-description">${this.escapeHtml(settings.description)}</p>` : ''}
        <div class="gallery-stats">
            <span class="image-count">${images.length} Photos</span>
        </div>
    </header>

    <main class="gallery-main">
        ${imageGrid}
    </main>

    ${lightbox}

    <footer class="gallery-footer">
        <p class="gallery-credits">
            Generated with Photo Editor
            ${settings.enableSocialSharing ? this.generateSocialLinks() : ''}
        </p>
    </footer>

    <script src="gallery.js"></script>
</body>
</html>`;
  }

  /**
   * Generate image grid based on layout
   */
  private generateImageGrid(images: GalleryImage[], settings: GallerySettings): string {
    const layoutClass = `gallery-grid gallery-${settings.layout}`;

    const imageItems = images.map(image => {
      const metadata = this.generateMetadataHTML(image, settings);
      const title = settings.theme.showTitles && image.title ?
        `<div class="image-title">${this.escapeHtml(image.title)}</div>` : '';

      return `
        <div class="gallery-item" data-id="${image.id}">
          <div class="image-container">
            <img src="thumbnails/${image.id}.jpg"
                 alt="${this.escapeHtml(image.title)}"
                 data-preview="previews/${image.id}.jpg"
                 data-full="images/${image.id}.jpg"
                 loading="lazy">
            ${settings.theme.lightboxEnabled ? '<div class="image-overlay"><div class="zoom-icon">🔍</div></div>' : ''}
          </div>
          ${title}
          ${metadata}
        </div>
      `;
    }).join('\n');

    return `<div class="${layoutClass}">${imageItems}</div>`;
  }

  /**
   * Generate metadata HTML for image
   */
  private generateMetadataHTML(image: GalleryImage, settings: GallerySettings): string {
    if (!settings.includeMetadata || !settings.theme.showMetadata) {
      return '';
    }

    const metadata = [];

    if (image.camera) {
      metadata.push(`<span class="camera">${this.escapeHtml(image.camera)}</span>`);
    }

    if (image.settings) {
      const { iso, aperture, shutterSpeed, focalLength } = image.settings;
      if (iso) metadata.push(`<span class="iso">ISO ${iso}</span>`);
      if (aperture) metadata.push(`<span class="aperture">f/${aperture}</span>`);
      if (shutterSpeed) metadata.push(`<span class="shutter">${shutterSpeed}</span>`);
      if (focalLength) metadata.push(`<span class="focal">${focalLength}mm</span>`);
    }

    if (image.captureDate) {
      metadata.push(`<span class="date">${image.captureDate.toLocaleDateString()}</span>`);
    }

    return metadata.length > 0 ?
      `<div class="image-metadata">${metadata.join(' • ')}</div>` : '';
  }

  /**
   * Generate lightbox HTML
   */
  private generateLightbox(): string {
    return `
    <div id="lightbox" class="lightbox">
        <div class="lightbox-content">
            <button class="lightbox-close">&times;</button>
            <button class="lightbox-prev">‹</button>
            <button class="lightbox-next">›</button>
            <div class="lightbox-image-container">
                <img id="lightbox-image" src="" alt="">
            </div>
            <div class="lightbox-info">
                <h3 id="lightbox-title"></h3>
                <div id="lightbox-metadata"></div>
                <div id="lightbox-description"></div>
            </div>
        </div>
    </div>`;
  }

  /**
   * Generate social sharing links
   */
  private generateSocialLinks(): string {
    return `
    <div class="social-sharing">
        <a href="#" class="share-facebook" title="Share on Facebook">📘</a>
        <a href="#" class="share-twitter" title="Share on Twitter">🐦</a>
        <a href="#" class="share-pinterest" title="Pin on Pinterest">📌</a>
        <a href="#" class="share-link" title="Copy Link">🔗</a>
    </div>`;
  }

  /**
   * Generate CSS styles
   */
  private generateCSS(settings: GallerySettings): string {
    const theme = settings.theme;

    return `/* Gallery Styles - ${theme.displayName} */
:root {
  --primary-color: ${theme.primaryColor};
  --secondary-color: ${theme.secondaryColor};
  --bg-color: ${theme.backgroundColor};
  --text-color: ${theme.textColor};
  --accent-color: ${theme.accentColor};
  --thumbnail-size: ${theme.thumbnailSize}px;
  --thumbnail-spacing: ${theme.thumbnailSpacing}px;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: ${theme.fontFamily};
  background-color: var(--bg-color);
  color: var(--text-color);
  line-height: 1.6;
}

.gallery-header {
  text-align: center;
  padding: 3rem 2rem 2rem;
  background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
}

.gallery-title {
  font-size: 2.5rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
  text-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.gallery-description {
  font-size: 1.1rem;
  opacity: 0.9;
  max-width: 600px;
  margin: 0 auto 1rem;
}

.gallery-stats {
  font-size: 0.9rem;
  opacity: 0.8;
}

.gallery-main {
  padding: 2rem;
  max-width: 1400px;
  margin: 0 auto;
}

/* Grid Layouts */
.gallery-grid {
  display: grid;
  gap: var(--thumbnail-spacing);
}

.gallery-grid.gallery-grid {
  grid-template-columns: repeat(auto-fill, minmax(var(--thumbnail-size), 1fr));
}

.gallery-grid.gallery-masonry {
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  grid-auto-rows: 20px;
}

.gallery-grid.gallery-justified {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
}

.gallery-item {
  position: relative;
  background: var(--primary-color);
  border-radius: 8px;
  overflow: hidden;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
  cursor: ${theme.lightboxEnabled ? 'pointer' : 'default'};
}

.gallery-item:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 25px rgba(0,0,0,0.15);
}

.image-container {
  position: relative;
  overflow: hidden;
}

.gallery-item img {
  width: 100%;
  height: var(--thumbnail-size);
  object-fit: cover;
  display: block;
  transition: transform 0.3s ease;
}

.gallery-item:hover img {
  transform: scale(1.05);
}

.image-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.gallery-item:hover .image-overlay {
  opacity: 1;
}

.zoom-icon {
  font-size: 2rem;
  color: white;
}

.image-title {
  padding: 1rem;
  font-weight: 600;
  font-size: 1.1rem;
}

.image-metadata {
  padding: 0 1rem 1rem;
  font-size: 0.85rem;
  opacity: 0.8;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.image-metadata span {
  background: var(--secondary-color);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
}

/* Lightbox */
.lightbox {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0,0,0,0.9);
  z-index: 1000;
  align-items: center;
  justify-content: center;
}

.lightbox.active {
  display: flex;
}

.lightbox-content {
  position: relative;
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.lightbox-image-container {
  max-width: 100%;
  max-height: 70vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

#lightbox-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.lightbox-close,
.lightbox-prev,
.lightbox-next {
  position: absolute;
  background: rgba(255,255,255,0.1);
  border: none;
  color: white;
  font-size: 2rem;
  padding: 1rem;
  cursor: pointer;
  border-radius: 50%;
  transition: background-color 0.3s ease;
}

.lightbox-close:hover,
.lightbox-prev:hover,
.lightbox-next:hover {
  background: rgba(255,255,255,0.2);
}

.lightbox-close {
  top: 2rem;
  right: 2rem;
}

.lightbox-prev {
  left: 2rem;
  top: 50%;
  transform: translateY(-50%);
}

.lightbox-next {
  right: 2rem;
  top: 50%;
  transform: translateY(-50%);
}

.lightbox-info {
  color: white;
  text-align: center;
  margin-top: 2rem;
  max-width: 600px;
}

.gallery-footer {
  text-align: center;
  padding: 2rem;
  border-top: 1px solid var(--secondary-color);
  margin-top: 2rem;
  opacity: 0.7;
}

.social-sharing {
  display: inline-flex;
  gap: 1rem;
  margin-left: 1rem;
}

.social-sharing a {
  text-decoration: none;
  font-size: 1.5rem;
  transition: transform 0.2s ease;
}

.social-sharing a:hover {
  transform: scale(1.2);
}

/* Responsive Design */
@media (max-width: 768px) {
  .gallery-header {
    padding: 2rem 1rem;
  }

  .gallery-title {
    font-size: 2rem;
  }

  .gallery-main {
    padding: 1rem;
  }

  :root {
    --thumbnail-size: 200px;
    --thumbnail-spacing: 12px;
  }

  .lightbox-prev,
  .lightbox-next {
    font-size: 1.5rem;
    padding: 0.5rem;
  }
}

@media (max-width: 480px) {
  .gallery-grid.gallery-grid {
    grid-template-columns: 1fr 1fr;
  }

  :root {
    --thumbnail-size: 150px;
    --thumbnail-spacing: 8px;
  }
}`;
  }

  /**
   * Generate JavaScript functionality
   */
  private generateJavaScript(settings: GallerySettings): string {
    return `// Gallery JavaScript
class Gallery {
  constructor() {
    this.currentImageIndex = 0;
    this.images = Array.from(document.querySelectorAll('.gallery-item'));
    this.lightbox = document.getElementById('lightbox');
    this.lightboxImage = document.getElementById('lightbox-image');
    this.lightboxTitle = document.getElementById('lightbox-title');
    this.lightboxMetadata = document.getElementById('lightbox-metadata');
    this.lightboxDescription = document.getElementById('lightbox-description');

    this.init();
  }

  init() {
    ${settings.theme.lightboxEnabled ? this.getLightboxJS() : ''}
    ${settings.enableSocialSharing ? this.getSocialSharingJS() : ''}

    // Lazy loading
    this.initLazyLoading();

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (this.lightbox && this.lightbox.classList.contains('active')) {
        switch(e.key) {
          case 'Escape':
            this.closeLightbox();
            break;
          case 'ArrowLeft':
            this.showPreviousImage();
            break;
          case 'ArrowRight':
            this.showNextImage();
            break;
        }
      }
    });
  }

  ${settings.theme.lightboxEnabled ? this.getLightboxMethods() : ''}

  initLazyLoading() {
    if ('IntersectionObserver' in window) {
      const imageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            img.classList.add('loaded');
            imageObserver.unobserve(img);
          }
        });
      });

      document.querySelectorAll('.gallery-item img').forEach(img => {
        imageObserver.observe(img);
      });
    }
  }

  ${settings.enableSocialSharing ? this.getSocialSharingMethods() : ''}
}

// Initialize gallery when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new Gallery();
});

// Service Worker for offline support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Service worker registration failed - not critical
  });
}`;
  }

  private getLightboxJS(): string {
    return `
    // Lightbox event listeners
    this.images.forEach((item, index) => {
      item.addEventListener('click', () => {
        this.currentImageIndex = index;
        this.openLightbox();
      });
    });

    if (this.lightbox) {
      document.querySelector('.lightbox-close')?.addEventListener('click', () => this.closeLightbox());
      document.querySelector('.lightbox-prev')?.addEventListener('click', () => this.showPreviousImage());
      document.querySelector('.lightbox-next')?.addEventListener('click', () => this.showNextImage());

      this.lightbox.addEventListener('click', (e) => {
        if (e.target === this.lightbox) {
          this.closeLightbox();
        }
      });
    }`;
  }

  private getLightboxMethods(): string {
    return `
  openLightbox() {
    if (!this.lightbox) return;

    const currentItem = this.images[this.currentImageIndex];
    const img = currentItem.querySelector('img');
    const title = currentItem.querySelector('.image-title')?.textContent || '';
    const metadata = currentItem.querySelector('.image-metadata')?.innerHTML || '';

    this.lightboxImage.src = img.dataset.full || img.src;
    this.lightboxTitle.textContent = title;
    this.lightboxMetadata.innerHTML = metadata;

    this.lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  closeLightbox() {
    if (!this.lightbox) return;

    this.lightbox.classList.remove('active');
    document.body.style.overflow = '';
  }

  showNextImage() {
    this.currentImageIndex = (this.currentImageIndex + 1) % this.images.length;
    this.openLightbox();
  }

  showPreviousImage() {
    this.currentImageIndex = (this.currentImageIndex - 1 + this.images.length) % this.images.length;
    this.openLightbox();
  }`;
  }

  private getSocialSharingJS(): string {
    return `
    // Social sharing
    document.querySelectorAll('.social-sharing a').forEach(link => {
      link.addEventListener('click', this.handleSocialShare.bind(this));
    });`;
  }

  private getSocialSharingMethods(): string {
    return `
  handleSocialShare(e) {
    e.preventDefault();
    const url = encodeURIComponent(window.location.href);
    const title = encodeURIComponent(document.title);

    let shareUrl = '';
    if (e.target.classList.contains('share-facebook')) {
      shareUrl = \`https://www.facebook.com/sharer/sharer.php?u=\${url}\`;
    } else if (e.target.classList.contains('share-twitter')) {
      shareUrl = \`https://twitter.com/intent/tweet?url=\${url}&text=\${title}\`;
    } else if (e.target.classList.contains('share-pinterest')) {
      shareUrl = \`https://pinterest.com/pin/create/button/?url=\${url}&description=\${title}\`;
    } else if (e.target.classList.contains('share-link')) {
      navigator.clipboard.writeText(window.location.href);
      alert('Link copied to clipboard!');
      return;
    }

    if (shareUrl) {
      window.open(shareUrl, '_blank', 'width=600,height=400');
    }
  }`;
  }

  /**
   * Escape HTML characters
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Export gallery as ZIP file (browser-compatible)
   */
  async exportGallery(galleryOutput: GalleryOutput, filename: string = 'photo-gallery'): Promise<Blob> {
    // In a real implementation, this would use JSZip or similar library
    // For now, we'll create a simple text-based archive structure

    const files = [
      { name: 'index.html', content: galleryOutput.htmlContent },
      { name: 'gallery.css', content: galleryOutput.cssContent },
      { name: 'gallery.js', content: galleryOutput.jsContent }
    ];

    // Add image files
    for (const [id, data] of galleryOutput.images.thumbnails) {
      files.push({ name: `thumbnails/${id}.jpg`, content: data });
    }
    for (const [id, data] of galleryOutput.images.previews) {
      files.push({ name: `previews/${id}.jpg`, content: data });
    }
    for (const [id, data] of galleryOutput.images.fullSize) {
      files.push({ name: `images/${id}.jpg`, content: data });
    }

    // Create a simple archive structure (would use proper ZIP in production)
    const archiveContent = JSON.stringify({
      name: filename,
      files: files,
      generatedAt: new Date().toISOString(),
      totalSize: galleryOutput.totalSize
    }, null, 2);

    return new Blob([archiveContent], { type: 'application/json' });
  }
}

export const webGalleryService = WebGalleryService.getInstance();