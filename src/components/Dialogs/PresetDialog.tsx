import React, { useState, useEffect } from 'react';
import { X, Save, FolderOpen, Download, Upload, Star, Search, Filter } from 'lucide-react';
import { presetService, AdjustmentPreset } from '../../services/PresetService';
import { useAppStore } from '../../stores/appStore';
import { logger } from '../../utils/Logger';

interface PresetDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyPreset: (preset: AdjustmentPreset) => void;
}

type PresetCategory = 'all' | 'portrait' | 'landscape' | 'street' | 'bw' | 'vintage' | 'cinematic' | 'custom';

export function PresetDialog({ isOpen, onClose, onApplyPreset }: PresetDialogProps) {
  const [presets, setPresets] = useState<AdjustmentPreset[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<PresetCategory>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetDescription, setNewPresetDescription] = useState('');
  const [newPresetCategory, setNewPresetCategory] = useState<Exclude<PresetCategory, 'all'>>('custom');
  const [selectedPreset, setSelectedPreset] = useState<AdjustmentPreset | null>(null);

  const categories = [
    { id: 'all' as const, name: 'All Presets', count: 0 },
    { id: 'portrait' as const, name: 'Portrait', count: 0 },
    { id: 'landscape' as const, name: 'Landscape', count: 0 },
    { id: 'street' as const, name: 'Street', count: 0 },
    { id: 'bw' as const, name: 'Black & White', count: 0 },
    { id: 'vintage' as const, name: 'Vintage', count: 0 },
    { id: 'cinematic' as const, name: 'Cinematic', count: 0 },
    { id: 'custom' as const, name: 'Custom', count: 0 }
  ];

  // Load presets on mount
  useEffect(() => {
    if (isOpen) {
      loadPresets();
    }
  }, [isOpen]);

  const loadPresets = () => {
    const allPresets = presetService.getAllPresets();
    setPresets(allPresets);
    logger.info(`Loaded ${allPresets.length} presets`);
  };

  // Filter presets based on category and search
  const filteredPresets = presets.filter(preset => {
    const matchesCategory = selectedCategory === 'all' || preset.category === selectedCategory;
    const matchesSearch = preset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         preset.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Update category counts
  const categoriesWithCounts = categories.map(category => ({
    ...category,
    count: category.id === 'all'
      ? presets.length
      : presets.filter(p => p.category === category.id).length
  }));

  const handleApplyPreset = (preset: AdjustmentPreset) => {
    try {
      setSelectedPreset(preset);
      onApplyPreset(preset);
      presetService.applyPreset(preset.id);
      logger.info(`Applied preset: ${preset.name}`);
    } catch (error) {
      logger.error('Failed to apply preset:', error);
    }
  };

  const handleCreatePreset = async () => {
    if (!newPresetName.trim()) return;

    try {
      const presetId = presetService.createPresetFromCurrent(
        newPresetName.trim(),
        newPresetDescription.trim(),
        newPresetCategory,
        []
      );

      const newPreset = presetService.getPreset(presetId);

      if (newPreset) {
        setPresets([...presets, newPreset]);
        setShowCreateDialog(false);
        setNewPresetName('');
        setNewPresetDescription('');
        logger.info(`Created new preset: ${newPreset.name}`);
      }
    } catch (error) {
      logger.error('Failed to create preset:', error);
    }
  };

  const handleDeletePreset = (presetId: string) => {
    try {
      if (presetService.deletePreset(presetId)) {
        setPresets(presets.filter(p => p.id !== presetId));
        logger.info(`Deleted preset: ${presetId}`);
      }
    } catch (error) {
      logger.error('Failed to delete preset:', error);
    }
  };

  const handleExportPresets = () => {
    try {
      const exportData = presetService.exportPresets(filteredPresets.map(p => p.id));

      // Download the preset file
      const blob = new Blob([exportData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `photo-editor-presets-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      logger.info(`Exported ${filteredPresets.length} presets`);
    } catch (error) {
      logger.error('Failed to export presets:', error);
    }
  };

  const handleImportPresets = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const result = presetService.importPresets(text);

      if (result.imported > 0) {
        // Reload presets to get the new ones
        loadPresets();
        logger.info(`Imported ${result.imported} presets, skipped ${result.skipped}`);
      }

      if (result.errors.length > 0) {
        logger.error('Import errors:', result.errors);
      }
    } catch (error) {
      logger.error('Failed to import presets:', error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-dark-800 rounded-lg shadow-xl w-5/6 max-w-6xl h-4/5 max-h-screen flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-dark-700">
          <div className="flex items-center space-x-3">
            <FolderOpen className="w-6 h-6 text-blue-400" />
            <h2 className="text-xl font-semibold text-dark-200">Preset Manager</h2>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowCreateDialog(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm transition-colors"
            >
              <Save className="w-4 h-4 inline mr-1" />
              Create Preset
            </button>
            <button
              onClick={handleExportPresets}
              className="p-2 text-dark-400 hover:text-dark-200 transition-colors"
              title="Export Presets"
            >
              <Download className="w-4 h-4" />
            </button>
            <label className="p-2 text-dark-400 hover:text-dark-200 transition-colors cursor-pointer" title="Import Presets">
              <Upload className="w-4 h-4" />
              <input
                type="file"
                accept=".json"
                onChange={handleImportPresets}
                className="hidden"
              />
            </label>
            <button
              onClick={onClose}
              className="p-2 text-dark-400 hover:text-dark-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left Sidebar - Categories */}
          <div className="w-64 border-r border-dark-700 p-4">
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-dark-400" />
                <input
                  type="text"
                  placeholder="Search presets..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-dark-700 border border-dark-600 rounded-md text-dark-200 placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="space-y-1">
              {categoriesWithCounts.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
                    selectedCategory === category.id
                      ? 'bg-blue-600 text-white'
                      : 'text-dark-300 hover:bg-dark-700'
                  }`}
                >
                  <span>{category.name}</span>
                  <span className="text-xs opacity-75">{category.count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Main Content - Preset Grid */}
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredPresets.map((preset) => (
                <div
                  key={preset.id}
                  className={`bg-dark-700 rounded-lg p-4 cursor-pointer transition-all hover:bg-dark-600 border-2 ${
                    selectedPreset?.id === preset.id ? 'border-blue-500' : 'border-transparent'
                  }`}
                  onClick={() => handleApplyPreset(preset)}
                >
                  {/* Preset Preview */}
                  <div className="aspect-video bg-dark-800 rounded-md mb-3 flex items-center justify-center">
                    <Filter className="w-8 h-8 text-dark-400" />
                  </div>

                  {/* Preset Info */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-dark-200 truncate">{preset.name}</h3>
                      <div className="flex items-center space-x-1">
                        <Star className="w-3 h-3 text-yellow-400" />
                        <span className="text-xs text-dark-400">{preset.metadata.imageCount || 0}</span>
                      </div>
                    </div>
                    <p className="text-sm text-dark-400 line-clamp-2">{preset.description}</p>
                    <div className="flex items-center justify-between">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        preset.category === 'portrait' ? 'bg-pink-600 text-white' :
                        preset.category === 'landscape' ? 'bg-green-600 text-white' :
                        preset.category === 'street' ? 'bg-gray-600 text-white' :
                        preset.category === 'bw' ? 'bg-gray-800 text-white' :
                        preset.category === 'vintage' ? 'bg-amber-600 text-white' :
                        preset.category === 'cinematic' ? 'bg-purple-600 text-white' :
                        'bg-blue-600 text-white'
                      }`}>
                        {preset.category === 'bw' ? 'B&W' : preset.category.charAt(0).toUpperCase() + preset.category.slice(1)}
                      </span>
                      {preset.category === 'custom' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePreset(preset.id);
                          }}
                          className="text-red-400 hover:text-red-300 text-xs"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {filteredPresets.length === 0 && (
              <div className="text-center text-dark-400 mt-12">
                <Filter className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No presets found</p>
                <p className="text-sm mt-1">Try adjusting your search or category filter</p>
              </div>
            )}
          </div>
        </div>

        {/* Create Preset Dialog */}
        {showCreateDialog && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
            <div className="bg-dark-800 rounded-lg p-6 w-96">
              <h3 className="text-lg font-semibold text-dark-200 mb-4">Create New Preset</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-dark-300 mb-1">Name</label>
                  <input
                    type="text"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-md text-dark-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="My Custom Preset"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark-300 mb-1">Description</label>
                  <textarea
                    value={newPresetDescription}
                    onChange={(e) => setNewPresetDescription(e.target.value)}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-md text-dark-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                    placeholder="Description of the preset..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark-300 mb-1">Category</label>
                  <select
                    value={newPresetCategory}
                    onChange={(e) => setNewPresetCategory(e.target.value as Exclude<PresetCategory, 'all'>)}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-md text-dark-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="custom">Custom</option>
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                    <option value="street">Street</option>
                    <option value="bw">Black & White</option>
                    <option value="vintage">Vintage</option>
                    <option value="cinematic">Cinematic</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowCreateDialog(false)}
                  className="px-4 py-2 text-dark-300 hover:text-dark-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreatePreset}
                  disabled={!newPresetName.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-dark-600 disabled:text-dark-400 text-white rounded-md transition-colors"
                >
                  Create Preset
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}