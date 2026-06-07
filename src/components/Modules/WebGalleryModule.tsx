import React, { useState, useEffect, useCallback } from 'react';
import { Globe, Download, Eye, Settings, Image, Palette, RefreshCw, Share2 } from 'lucide-react';
import { logger } from '../../utils/Logger';
import { useAppStore } from '../../stores/appStore';
import {
  webGalleryService,
  GalleryImage,
  GalleryTheme,
  GallerySettings,
  GalleryOutput
} from '../../services/WebGalleryService';
import {
  webGalleryCollectionStore,
  ImageCollection
} from '../../services/WebGalleryCollectionStore';

interface WebGalleryModuleProps {
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export const WebGalleryModule: React.FC<WebGalleryModuleProps> = ({
  isEnabled,
  onToggle
}) => {
  const currentImage = useAppStore((state) => state.currentImage);
  const processedImageData = useAppStore((state) => state.processedImageData);

  const [themes, setThemes] = useState<GalleryTheme[]>([]);
  const [collections, setCollections] = useState<ImageCollection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedGallery, setGeneratedGallery] = useState<GalleryOutput | null>(null);

  const [gallerySettings, setGallerySettings] = useState<GallerySettings>({
    title: 'My Photo Gallery',
    description: 'A beautiful collection of photographs',
    theme: webGalleryService.getThemes()[0],
    layout: 'grid',
    thumbnailQuality: 'high',
    previewQuality: 'high',
    includeMetadata: true,
    includeDownloadLinks: false,
    enableComments: false,
    enableSocialSharing: true,
    watermark: {
      enabled: false,
      position: 'bottom-right',
      opacity: 0.5
    }
  });

  // Load themes and collections on mount
  useEffect(() => {
    const availableThemes = webGalleryService.getThemes();
    setThemes(availableThemes);

    if (availableThemes.length > 0 && !gallerySettings.theme) {
      setGallerySettings(prev => ({ ...prev, theme: availableThemes[0] }));
    }

    // Load persisted user collections from disk, then upsert the live
    // 'Current Session' collection (regenerated from the current image) without
    // wiping the user's saved collections.
    const persisted = webGalleryCollectionStore.loadCollections();

    const demoCollection: ImageCollection = persisted.find(c => c.id === 'demo') ?? {
      id: 'demo',
      name: 'Current Session',
      images: [],
      createdAt: new Date()
    };

    if (currentImage && processedImageData) {
      const galleryImage: GalleryImage = {
        id: 'current',
        originalPath: currentImage.name || 'Unknown',
        title: (currentImage.name || 'Untitled').replace(/\.[^/.]+$/, ''),
        captureDate: currentImage.metadata.dateCreated,
        camera: 'Unknown Camera',
        lens: 'Unknown Lens',
        settings: {
          iso: undefined,
          aperture: undefined,
          shutterSpeed: undefined,
          focalLength: undefined
        },
        keywords: ['photography', 'edited']
      };

      demoCollection.images = [galleryImage];
    }

    // Merge: keep every persisted collection except the old 'demo' (replaced by
    // the freshly built one above), then prepend the live session collection.
    const merged: ImageCollection[] = [
      demoCollection,
      ...persisted.filter(c => c.id !== 'demo')
    ];

    webGalleryCollectionStore.saveCollections(merged);
    setCollections(merged);
    // Preserve the user's current selection across image/theme changes; only fall
    // back to the live 'demo' session collection when the prior selection no longer
    // exists (e.g. first mount). Previously this unconditionally reset to 'demo' on
    // every dependency change, discarding the user's chosen collection.
    setSelectedCollection(prev => (merged.some(c => c.id === prev) ? prev : 'demo'));
  }, [currentImage, processedImageData, gallerySettings.theme]);

  // Generate gallery
  const generateGallery = useCallback(async () => {
    const collection = collections.find(c => c.id === selectedCollection);
    if (!collection || collection.images.length === 0) {
      logger.warn('No images in selected collection');
      return;
    }

    try {
      setIsGenerating(true);
      logger.info('Generating web gallery...', {
        collectionName: collection.name,
        imageCount: collection.images.length,
        theme: gallerySettings.theme.name
      });

      const gallery = await webGalleryService.generateGallery(collection.images, gallerySettings);
      setGeneratedGallery(gallery);

      logger.info('Web gallery generated successfully', {
        totalSize: `${(gallery.totalSize / 1024 / 1024).toFixed(2)}MB`
      });

    } catch (error) {
      logger.error('Failed to generate web gallery:', error);
    } finally {
      setIsGenerating(false);
    }
  }, [collections, selectedCollection, gallerySettings]);

  // Download gallery
  const downloadGallery = useCallback(async () => {
    if (!generatedGallery) return;

    try {
      const blob = await webGalleryService.exportGallery(generatedGallery, gallerySettings.title);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${gallerySettings.title.toLowerCase().replace(/\s+/g, '-')}-gallery.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      logger.info('Gallery downloaded successfully');
    } catch (error) {
      logger.error('Failed to download gallery:', error);
    }
  }, [generatedGallery, gallerySettings.title]);

  // Preview gallery in new tab
  const previewGallery = useCallback(() => {
    if (!generatedGallery) return;

    try {
      const newWindow = window.open('', '_blank') as unknown as Window | null;
      if (newWindow && (newWindow as Window).document) {
        const doc = (newWindow as Window).document;
        doc.write(generatedGallery.htmlContent);
        if (doc.head) {
          doc.head.innerHTML += `<style>${generatedGallery.cssContent}</style>`;
          doc.head.innerHTML += `<script>${generatedGallery.jsContent}</script>`;
        }
        doc.title = gallerySettings.title;
      }
    } catch (error) {
      logger.error('Failed to preview gallery:', error);
    }
  }, [generatedGallery, gallerySettings.title]);

  const updateGallerySetting = <K extends keyof GallerySettings>(
    key: K,
    value: GallerySettings[K]
  ) => {
    setGallerySettings(prev => ({ ...prev, [key]: value }));
  };

  const updateWatermarkSetting = (key: string, value: unknown) => {
    setGallerySettings(prev => ({
      ...prev,
      watermark: {
        enabled: prev.watermark?.enabled || false,
        text: prev.watermark?.text || '',
        position: prev.watermark?.position || 'bottom-right',
        opacity: prev.watermark?.opacity || 0.5,
        ...prev.watermark,
        [key]: value
      }
    }));
  };

  const selectedCollectionData = collections.find(c => c.id === selectedCollection);

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      {/* Module Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <Globe className="w-5 h-5 text-gray-300" />
          <span className="text-white font-medium">Web Gallery</span>
          {isGenerating && (
            <RefreshCw className="w-4 h-4 text-gray-300 animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={previewGallery}
            disabled={!generatedGallery || isGenerating}
            className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-800 disabled:bg-gray-700 text-white rounded transition-colors"
            title="Preview gallery in new tab"
          >
            Preview
          </button>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => onToggle(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gray-400"></div>
          </label>
        </div>
      </div>

      {/* Module Content */}
      {isEnabled && (
        <div className="p-4 space-y-4">

          {/* Collection Selection */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Image className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-white">Image Collection</span>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Select Collection</label>
              <select
                value={selectedCollection}
                onChange={(e) => setSelectedCollection(e.target.value)}
                className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                disabled={isGenerating}
              >
                {collections.map(collection => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name} ({collection.images.length} images)
                  </option>
                ))}
              </select>
            </div>

            {selectedCollectionData && (
              <div className="bg-gray-800 border border-gray-600 rounded-lg p-3">
                <div className="text-sm text-gray-300">
                  <div className="font-medium">{selectedCollectionData.name}</div>
                  <div className="text-gray-300 text-xs">
                    {selectedCollectionData.images.length} images • Created {selectedCollectionData.createdAt.toLocaleDateString()}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Gallery Settings */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-white">Gallery Settings</span>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Title</label>
                <input
                  type="text"
                  value={gallerySettings.title}
                  onChange={(e) => updateGallerySetting('title', e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  placeholder="My Photo Gallery"
                  disabled={isGenerating}
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Description (Optional)</label>
                <textarea
                  value={gallerySettings.description}
                  onChange={(e) => updateGallerySetting('description', e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none resize-none"
                  rows={2}
                  placeholder="A beautiful collection of photographs"
                  disabled={isGenerating}
                />
              </div>
            </div>
          </div>

          {/* Theme Selection */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-white">Theme & Layout</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Theme</label>
                <select
                  value={gallerySettings.theme.name}
                  onChange={(e) => {
                    const theme = themes.find(t => t.name === e.target.value);
                    if (theme) updateGallerySetting('theme', theme);
                  }}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  disabled={isGenerating}
                >
                  {themes.map(theme => (
                    <option key={theme.name} value={theme.name}>
                      {theme.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Layout</label>
                <select
                  value={gallerySettings.layout}
                  onChange={(e) => updateGallerySetting('layout', e.target.value as 'grid' | 'masonry' | 'justified' | 'slideshow')}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  disabled={isGenerating}
                >
                  <option value="grid">Grid</option>
                  <option value="masonry">Masonry</option>
                  <option value="justified">Justified</option>
                  <option value="slideshow">Slideshow</option>
                </select>
              </div>
            </div>

            <div className="bg-gray-700/50 rounded p-3 text-xs">
              <div className="text-gray-400 mb-1">Theme Preview</div>
              <div className="text-gray-300">{gallerySettings.theme.description}</div>
              <div className="flex gap-2 mt-2">
                <div
                  className="w-4 h-4 rounded border border-gray-600"
                  style={{ backgroundColor: gallerySettings.theme.primaryColor }}
                  title="Primary Color"
                ></div>
                <div
                  className="w-4 h-4 rounded border border-gray-600"
                  style={{ backgroundColor: gallerySettings.theme.accentColor }}
                  title="Accent Color"
                ></div>
                <div
                  className="w-4 h-4 rounded border border-gray-600"
                  style={{ backgroundColor: gallerySettings.theme.backgroundColor }}
                  title="Background Color"
                ></div>
              </div>
            </div>
          </div>

          {/* Quality Settings */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Thumbnail Quality</label>
                <select
                  value={gallerySettings.thumbnailQuality}
                  onChange={(e) => updateGallerySetting('thumbnailQuality', e.target.value as 'low' | 'medium' | 'high')}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  disabled={isGenerating}
                >
                  <option value="low">Low (Fast)</option>
                  <option value="medium">Medium</option>
                  <option value="high">High (Best)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Preview Quality</label>
                <select
                  value={gallerySettings.previewQuality}
                  onChange={(e) => updateGallerySetting('previewQuality', e.target.value as 'medium' | 'high' | 'maximum')}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  disabled={isGenerating}
                >
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="maximum">Maximum</option>
                </select>
              </div>
            </div>
          </div>

          {/* Features */}
          <div className="space-y-3">
            <div className="text-sm font-medium text-white">Features</div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={gallerySettings.includeMetadata}
                  onChange={(e) => updateGallerySetting('includeMetadata', e.target.checked)}
                  className="mr-2 rounded"
                  disabled={isGenerating}
                />
                <span className="text-gray-300">Include Metadata</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={gallerySettings.enableSocialSharing}
                  onChange={(e) => updateGallerySetting('enableSocialSharing', e.target.checked)}
                  className="mr-2 rounded"
                  disabled={isGenerating}
                />
                <span className="text-gray-300">Social Sharing</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={gallerySettings.includeDownloadLinks}
                  onChange={(e) => updateGallerySetting('includeDownloadLinks', e.target.checked)}
                  className="mr-2 rounded"
                  disabled={isGenerating}
                />
                <span className="text-gray-300">Download Links</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={gallerySettings.watermark?.enabled}
                  onChange={(e) => updateWatermarkSetting('enabled', e.target.checked)}
                  className="mr-2 rounded"
                  disabled={isGenerating}
                />
                <span className="text-gray-300">Watermark</span>
              </label>
            </div>

            {/* Watermark Settings */}
            {gallerySettings.watermark?.enabled && (
              <div className="bg-gray-700/50 rounded p-3 space-y-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Watermark Text</label>
                  <input
                    type="text"
                    value={gallerySettings.watermark.text || ''}
                    onChange={(e) => updateWatermarkSetting('text', e.target.value)}
                    className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1 border border-gray-600 focus:border-gray-600 focus:outline-none"
                    placeholder="© Your Name"
                    disabled={isGenerating}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Position</label>
                    <select
                      value={gallerySettings.watermark.position}
                      onChange={(e) => updateWatermarkSetting('position', e.target.value)}
                      className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1 border border-gray-600 focus:border-gray-600 focus:outline-none"
                      disabled={isGenerating}
                    >
                      <option value="bottom-right">Bottom Right</option>
                      <option value="bottom-left">Bottom Left</option>
                      <option value="top-right">Top Right</option>
                      <option value="top-left">Top Left</option>
                      <option value="center">Center</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Opacity: {Math.round((gallerySettings.watermark.opacity || 0.5) * 100)}%
                    </label>
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.1"
                      value={gallerySettings.watermark.opacity || 0.5}
                      onChange={(e) => updateWatermarkSetting('opacity', parseFloat(e.target.value))}
                      className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-200"
                      disabled={isGenerating}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-gray-700">
            <button
              onClick={generateGallery}
              disabled={isGenerating || !selectedCollectionData || selectedCollectionData.images.length === 0}
              className="flex-1 bg-gray-800 hover:bg-gray-800 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded transition-colors flex items-center justify-center gap-2"
            >
              <Globe className="w-4 h-4" />
              {isGenerating ? 'Generating...' : 'Generate Gallery'}
            </button>

            {generatedGallery && (
              <>
                <button
                  onClick={previewGallery}
                  className="bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium py-2 px-4 rounded transition-colors flex items-center gap-2"
                >
                  <Eye className="w-4 h-4" />
                  Preview
                </button>

                <button
                  onClick={downloadGallery}
                  className="bg-gray-800 hover:bg-gray-800 text-white text-sm font-medium py-2 px-4 rounded transition-colors flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download
                </button>
              </>
            )}
          </div>

          {/* Gallery Info */}
          {generatedGallery && (
            <div className="bg-gray-800 border border-gray-600 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Share2 className="w-4 h-4 text-gray-300" />
                <span className="text-sm font-medium text-white">Gallery Ready</span>
              </div>
              <div className="text-xs text-gray-300">
                <div>Theme: {gallerySettings.theme.displayName}</div>
                <div>Layout: {gallerySettings.layout.charAt(0).toUpperCase() + gallerySettings.layout.slice(1)}</div>
                <div>Size: {(generatedGallery.totalSize / 1024 / 1024).toFixed(2)} MB</div>
                <div>Images: {selectedCollectionData?.images.length || 0}</div>
              </div>
            </div>
          )}

          {/* No Images Warning */}
          {selectedCollectionData && selectedCollectionData.images.length === 0 && (
            <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 text-center">
              <div className="text-gray-300 text-sm">
                No images in selected collection
              </div>
              <div className="text-gray-300 text-xs mt-1">
                Process an image to add it to the current session
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};