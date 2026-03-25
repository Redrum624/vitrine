import React, { useState, useEffect, useCallback } from 'react';
import { Folder, Plus, Settings, Download, Eye, Trash2, Copy, Users, Calendar, BarChart3, Search } from 'lucide-react';
import { logger } from '../../utils/Logger';
import { useAppStore } from '../../stores/appStore';
import {
  outputCollectionService,
  OutputCollection,
  CollectionTemplate,
  CollectionStats
} from '../../services/OutputCollectionService';

interface OutputCollectionModuleProps {
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export const OutputCollectionModule: React.FC<OutputCollectionModuleProps> = ({
  isEnabled,
  onToggle
}) => {
  const currentImage = useAppStore((state) => state.currentImage);

  const [collections, setCollections] = useState<OutputCollection[]>([]);
  const [templates, setTemplates] = useState<CollectionTemplate[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>('');
  const [stats, setStats] = useState<CollectionStats | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeView, setActiveView] = useState<'list' | 'stats' | 'create'>('list');

  const [newCollection, setNewCollection] = useState({
    name: '',
    description: '',
    category: 'project' as OutputCollection['category'],
    templateId: ''
  });

  // Load collections and templates
  useEffect(() => {
    const loadData = () => {
      const allCollections = outputCollectionService.getCollections();
      const allTemplates = outputCollectionService.getTemplates();
      const statistics = outputCollectionService.getStatistics();

      setCollections(allCollections);
      setTemplates(allTemplates);
      setStats(statistics);

      if (allCollections.length > 0 && !selectedCollection) {
        setSelectedCollection(allCollections[0].id);
      }
    };

    loadData();
  }, [selectedCollection]);

  // Create new collection
  const createCollection = useCallback(async () => {
    if (!newCollection.name.trim()) return;

    try {
      setIsCreating(true);

      const collectionId = outputCollectionService.createCollection(
        newCollection.name,
        newCollection.description,
        newCollection.category,
        newCollection.templateId || undefined
      );

      // Add current image if available
      if (currentImage && collectionId) {
        outputCollectionService.addImageToCollection(
          collectionId,
          currentImage.path,
          currentImage.name
        );
      }

      // Reset form
      setNewCollection({
        name: '',
        description: '',
        category: 'project',
        templateId: ''
      });

      // Refresh collections
      const updatedCollections = outputCollectionService.getCollections();
      setCollections(updatedCollections);
      setSelectedCollection(collectionId);
      setActiveView('list');

      logger.info('Collection created successfully:', newCollection.name);

    } catch (error) {
      logger.error('Failed to create collection:', error);
    } finally {
      setIsCreating(false);
    }
  }, [newCollection, currentImage]);

  // Add current image to collection
  const addCurrentImageToCollection = useCallback((collectionId: string) => {
    if (!currentImage) return;

    const success = outputCollectionService.addImageToCollection(
      collectionId,
      currentImage.path,
      currentImage.name
    );

    if (success) {
      const updatedCollections = outputCollectionService.getCollections();
      setCollections(updatedCollections);
      logger.info(`Added ${currentImage.name} to collection`);
    }
  }, [currentImage]);

  // Delete collection
  const deleteCollection = useCallback((collectionId: string) => {
    const collection = collections.find(c => c.id === collectionId);
    if (!collection) return;

    const confirmed = window.confirm(`Delete collection "${collection.name}"? This cannot be undone.`);
    if (!confirmed) return;

    const success = outputCollectionService.deleteCollection(collectionId);
    if (success) {
      const updatedCollections = outputCollectionService.getCollections();
      setCollections(updatedCollections);

      if (selectedCollection === collectionId) {
        setSelectedCollection(updatedCollections[0]?.id || '');
      }

      logger.info('Collection deleted:', collection.name);
    }
  }, [collections, selectedCollection]);

  // Duplicate collection
  const duplicateCollection = useCallback((collectionId: string) => {
    const duplicateId = outputCollectionService.duplicateCollection(collectionId);
    if (duplicateId) {
      const updatedCollections = outputCollectionService.getCollections();
      setCollections(updatedCollections);
      setSelectedCollection(duplicateId);
      logger.info('Collection duplicated');
    }
  }, []);

  // Export collection
  const exportCollection = useCallback(async (collectionId: string) => {
    const collection = collections.find(c => c.id === collectionId);
    if (!collection) return;

    try {
      setIsExporting(true);
      setExportProgress(0);

      const destination = '/tmp/exports'; // In production, would use file picker

      const exportRecord = await outputCollectionService.exportCollection(
        collectionId,
        destination,
        {
          callback: (progress, current) => {
            setExportProgress(progress);
            logger.debug(`Exporting: ${current} (${progress.toFixed(1)}%)`);
          }
        }
      );

      logger.info(`Collection exported: ${exportRecord.imageCount} images, ${(exportRecord.totalSize / 1024 / 1024).toFixed(2)}MB`);

      // Refresh collections to show updated export info
      const updatedCollections = outputCollectionService.getCollections();
      setCollections(updatedCollections);

    } catch (error) {
      logger.error('Export failed:', error);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }, [collections]);

  // Filter collections based on search
  const filteredCollections = searchQuery
    ? outputCollectionService.searchCollections(searchQuery)
    : collections;

  const selectedCollectionData = collections.find(c => c.id === selectedCollection);

  const categories = [
    { value: 'client', label: 'Client Work', icon: Users },
    { value: 'portfolio', label: 'Portfolio', icon: Eye },
    { value: 'stock', label: 'Stock', icon: BarChart3 },
    { value: 'personal', label: 'Personal', icon: Folder },
    { value: 'project', label: 'Project', icon: Calendar },
    { value: 'custom', label: 'Custom', icon: Settings }
  ];

  const formatFileSize = (bytes: number): string => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      {/* Module Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <Folder className="w-5 h-5 text-gray-300" />
          <span className="text-white font-medium">Output Collections</span>
          {isExporting && (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-gray-300">{exportProgress.toFixed(0)}%</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveView(activeView === 'stats' ? 'list' : 'stats')}
            className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-800 text-white rounded transition-colors"
            title="View statistics"
          >
            {activeView === 'stats' ? 'Collections' : 'Stats'}
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

          {/* View Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setActiveView('list')}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                activeView === 'list'
                  ? 'bg-gray-800 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Collections
            </button>
            <button
              onClick={() => setActiveView('create')}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                activeView === 'create'
                  ? 'bg-gray-800 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Create New
            </button>
            <button
              onClick={() => setActiveView('stats')}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                activeView === 'stats'
                  ? 'bg-gray-800 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Statistics
            </button>
          </div>

          {/* Collections List View */}
          {activeView === 'list' && (
            <div className="space-y-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded pl-10 pr-3 py-2 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  placeholder="Search collections..."
                />
              </div>

              {/* Collections List */}
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {filteredCollections.map(collection => {
                  const categoryInfo = categories.find(c => c.value === collection.category);
                  const CategoryIcon = categoryInfo?.icon || Folder;

                  return (
                    <div
                      key={collection.id}
                      className={`p-3 rounded border cursor-pointer transition-colors ${
                        selectedCollection === collection.id
                          ? 'bg-gray-800 border-gray-600'
                          : 'bg-gray-700/50 border-gray-600 hover:bg-gray-700'
                      }`}
                      onClick={() => setSelectedCollection(collection.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CategoryIcon className="w-4 h-4 text-gray-300" />
                          <div>
                            <div className="text-sm font-medium text-white">{collection.name}</div>
                            <div className="text-xs text-gray-400">
                              {collection.images.length} images • {categoryInfo?.label}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              exportCollection(collection.id);
                            }}
                            disabled={isExporting || collection.images.length === 0}
                            className="p-1 text-gray-300 hover:text-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                            title="Export collection"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              duplicateCollection(collection.id);
                            }}
                            className="p-1 text-gray-300 hover:text-gray-300"
                            title="Duplicate collection"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteCollection(collection.id);
                            }}
                            className="p-1 text-gray-300 hover:text-gray-300"
                            title="Delete collection"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {collection.description && (
                        <div className="text-xs text-gray-400 mt-1">{collection.description}</div>
                      )}

                      {collection.lastExportDate && (
                        <div className="text-xs text-gray-300 mt-1">
                          Last exported: {collection.lastExportDate.toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {filteredCollections.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  {searchQuery ? 'No collections match your search' : 'No collections yet'}
                </div>
              )}

              {/* Selected Collection Details */}
              {selectedCollectionData && (
                <div className="border-t border-gray-700 pt-3">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-white">Collection Details</h3>
                      {currentImage && (
                        <button
                          onClick={() => addCurrentImageToCollection(selectedCollectionData.id)}
                          className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-800 text-white rounded transition-colors flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          Add Current
                        </button>
                      )}
                    </div>

                    <div className="bg-gray-700/30 rounded p-3 space-y-2">
                      <div className="text-xs">
                        <span className="text-gray-400">Name:</span>{' '}
                        <span className="text-white">{selectedCollectionData.name}</span>
                      </div>
                      <div className="text-xs">
                        <span className="text-gray-400">Category:</span>{' '}
                        <span className="text-white">{categories.find(c => c.value === selectedCollectionData.category)?.label}</span>
                      </div>
                      <div className="text-xs">
                        <span className="text-gray-400">Images:</span>{' '}
                        <span className="text-white">{selectedCollectionData.images.length}</span>
                      </div>
                      <div className="text-xs">
                        <span className="text-gray-400">Created:</span>{' '}
                        <span className="text-white">{selectedCollectionData.createdDate.toLocaleDateString()}</span>
                      </div>
                      {selectedCollectionData.totalExports > 0 && (
                        <div className="text-xs">
                          <span className="text-gray-400">Total Exports:</span>{' '}
                          <span className="text-white">{selectedCollectionData.totalExports}</span>
                        </div>
                      )}
                    </div>

                    {/* Recent Images */}
                    {selectedCollectionData.images.length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-white mb-2">Recent Images</div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {selectedCollectionData.images.slice(0, 5).map(image => (
                            <div key={image.id} className="flex items-center justify-between text-xs">
                              <span className="text-gray-300 truncate">{image.name}</span>
                              <span className={`px-1 rounded text-xs ${
                                image.status === 'completed' ? 'bg-gray-800 text-gray-300' :
                                image.status === 'error' ? 'bg-gray-800 text-gray-300' :
                                image.status === 'processing' ? 'bg-gray-800 text-gray-300' :
                                'bg-gray-700 text-gray-300'
                              }`}>
                                {image.status}
                              </span>
                            </div>
                          ))}
                          {selectedCollectionData.images.length > 5 && (
                            <div className="text-xs text-gray-400">
                              +{selectedCollectionData.images.length - 5} more images
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Create Collection View */}
          {activeView === 'create' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white mb-2">Collection Name</label>
                <input
                  type="text"
                  value={newCollection.name}
                  onChange={(e) => setNewCollection(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  placeholder="Enter collection name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white mb-2">Description (Optional)</label>
                <textarea
                  value={newCollection.description}
                  onChange={(e) => setNewCollection(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600 focus:border-gray-600 focus:outline-none resize-none"
                  rows={2}
                  placeholder="Describe this collection"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white mb-2">Category</label>
                <select
                  value={newCollection.category}
                  onChange={(e) => setNewCollection(prev => ({ ...prev, category: e.target.value as 'client' | 'portfolio' | 'stock' | 'personal' | 'project' | 'custom' }))}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600 focus:border-gray-600 focus:outline-none"
                >
                  {categories.map(category => (
                    <option key={category.value} value={category.value}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-white mb-2">Template (Optional)</label>
                <select
                  value={newCollection.templateId}
                  onChange={(e) => setNewCollection(prev => ({ ...prev, templateId: e.target.value }))}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600 focus:border-gray-600 focus:outline-none"
                >
                  <option value="">No template</option>
                  {templates.map(template => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={createCollection}
                  disabled={isCreating || !newCollection.name.trim()}
                  className="flex-1 bg-gray-800 hover:bg-gray-800 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded transition-colors flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  {isCreating ? 'Creating...' : 'Create Collection'}
                </button>
                <button
                  onClick={() => setActiveView('list')}
                  className="bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium py-2 px-4 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>

              {currentImage && (
                <div className="bg-gray-800 border border-gray-600 rounded p-3">
                  <div className="text-sm text-gray-300">
                    The current image ({currentImage.name}) will be added to the new collection.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Statistics View */}
          {activeView === 'stats' && stats && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-700/30 rounded p-3">
                  <div className="text-xs text-gray-400">Total Collections</div>
                  <div className="text-lg font-bold text-white">{stats.totalCollections}</div>
                </div>
                <div className="bg-gray-700/30 rounded p-3">
                  <div className="text-xs text-gray-400">Total Images</div>
                  <div className="text-lg font-bold text-white">{stats.totalImages}</div>
                </div>
              </div>

              <div className="bg-gray-700/30 rounded p-3">
                <div className="text-xs text-gray-400 mb-2">Storage Used</div>
                <div className="text-lg font-bold text-white">{formatFileSize(stats.storageUsed)}</div>
              </div>

              <div>
                <div className="text-sm font-medium text-white mb-2">Collections by Category</div>
                <div className="space-y-2">
                  {Object.entries(stats.collectionsByCategory).map(([category, count]) => {
                    const categoryInfo = categories.find(c => c.value === category);
                    return (
                      <div key={category} className="flex items-center justify-between text-sm">
                        <span className="text-gray-300">{categoryInfo?.label || category}</span>
                        <span className="text-white">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {stats.popularFormats.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-white mb-2">Popular Export Formats</div>
                  <div className="space-y-1">
                    {stats.popularFormats.slice(0, 3).map(format => (
                      <div key={format.format} className="flex items-center justify-between text-sm">
                        <span className="text-gray-300">{format.format.toUpperCase()}</span>
                        <span className="text-white">{format.count} exports</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {stats.recentActivity.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-white mb-2">Recent Activity</div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {stats.recentActivity.slice(0, 5).map((activity, index) => (
                      <div key={index} className="text-xs">
                        <span className="text-gray-400">{activity.date.toLocaleDateString()}</span>
                        <span className="text-white ml-2">{activity.details}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* No Image Warning */}
          {!currentImage && activeView === 'list' && (
            <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 text-center">
              <div className="text-gray-300 text-sm">
                Load an image to add it to collections
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};