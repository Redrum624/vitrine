import { useState, useEffect } from 'react';
import { X, Save, FolderOpen, Download, Upload, Star, Search, Filter } from 'lucide-react';
import { presetService, AdjustmentPreset } from '../../services/PresetService';
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

  const loadPresets = () => {
    const allPresets = presetService.getAllPresets();
    setPresets(allPresets);
    logger.info(`Loaded ${allPresets.length} presets`);
  };

  useEffect(() => {
    if (isOpen) {
      const timeoutId = setTimeout(() => loadPresets(), 0);
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen]);

  const filteredPresets = presets.filter(preset => {
    const matchesCategory = selectedCategory === 'all' || preset.category === selectedCategory;
    const matchesSearch = preset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         preset.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

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
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
      <div className="rounded-lg shadow-xl w-5/6 max-w-6xl h-4/5 max-h-screen flex flex-col" style={{ backgroundColor: 'var(--gray-900)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderBottomColor: 'var(--border)' }}>
          <div className="flex items-center space-x-3">
            <FolderOpen className="w-5 h-5" style={{ color: 'var(--gray-300)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--white)' }}>Preset Manager</h2>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowCreateDialog(true)}
              className="px-3 py-1.5 text-sm rounded border transition-colors flex items-center"
              style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}
            >
              <Save className="w-4 h-4 mr-1" />
              Create Preset
            </button>
            <button
              onClick={handleExportPresets}
              className="p-1.5 rounded border transition-colors"
              title="Export Presets"
              style={{ backgroundColor: 'transparent', borderColor: 'transparent', color: 'var(--gray-400)' }}
            >
              <Download className="w-4 h-4" />
            </button>
            <label className="p-1.5 rounded transition-colors cursor-pointer" title="Import Presets" style={{ color: 'var(--gray-400)' }}>
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
              className="p-1.5 rounded transition-colors"
              style={{ color: 'var(--gray-400)' }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left Sidebar - Categories */}
          <div className="w-64 border-r p-4" style={{ borderRightColor: 'var(--border)' }}>
            <div className="mb-4">
              <div className="relative flex items-center">
                <Search className="absolute left-2 w-4 h-4" style={{ color: 'var(--gray-500)' }} />
                <input
                  type="text"
                  placeholder="Search presets..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-2 py-1.5 text-sm rounded border focus:outline-none"
                  style={{
                    backgroundColor: 'var(--gray-800)',
                    borderColor: 'var(--border)',
                    color: 'var(--gray-200)'
                  }}
                />
              </div>
            </div>

            <div className="space-y-1">
              {categoriesWithCounts.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.id)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded text-sm transition-colors"
                  style={{
                    backgroundColor: selectedCategory === category.id ? 'var(--gray-800)' : 'transparent',
                    color: selectedCategory === category.id ? 'var(--white)' : 'var(--gray-400)'
                  }}
                >
                  <span>{category.name}</span>
                  <span className="text-xs opacity-75">{category.count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Main Content - Preset Grid */}
          <div className="flex-1 px-5 py-4 overflow-y-auto">
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredPresets.map((preset) => (
                <div
                  key={preset.id}
                  className="rounded-lg p-4 cursor-pointer transition-all border"
                  onClick={() => handleApplyPreset(preset)}
                  style={{
                    backgroundColor: 'var(--gray-800)',
                    borderColor: selectedPreset?.id === preset.id ? 'var(--gray-500)' : 'var(--border)'
                  }}
                >
                  {/* Preset Preview */}
                  <div className="aspect-video rounded mb-3 flex items-center justify-center" style={{ backgroundColor: 'var(--gray-900)' }}>
                    <Filter className="w-8 h-8" style={{ color: 'var(--gray-500)' }} />
                  </div>

                  {/* Preset Info */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--gray-200)' }}>{preset.name}</h3>
                      <div className="flex items-center space-x-1">
                        <Star className="w-3 h-3" style={{ color: 'var(--gray-400)' }} />
                        <span className="text-xs" style={{ color: 'var(--gray-400)' }}>{preset.metadata.imageCount || 0}</span>
                      </div>
                    </div>
                    <p className="text-xs line-clamp-2" style={{ color: 'var(--gray-400)' }}>{preset.description}</p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="px-2 py-1 rounded text-xs" style={{ backgroundColor: 'var(--gray-900)', color: 'var(--gray-300)' }}>
                        {preset.category === 'bw' ? 'B&W' : preset.category.charAt(0).toUpperCase() + preset.category.slice(1)}
                      </span>
                      {preset.category === 'custom' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePreset(preset.id);
                          }}
                          className="text-xs transition-colors"
                          style={{ color: 'var(--gray-500)' }}
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
              <div className="text-center mt-12" style={{ color: 'var(--gray-500)' }}>
                <Filter className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No presets found</p>
                <p className="text-xs mt-1">Try adjusting your search or category filter</p>
              </div>
            )}
          </div>
        </div>

        {/* Create Preset Dialog */}
        {showCreateDialog && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
            <div className="rounded-lg p-5 w-96 border" style={{ backgroundColor: 'var(--gray-900)', borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--white)' }}>Create New Preset</h3>
              <div className="space-y-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Name</label>
                  <input
                    type="text"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    className="px-2 py-1.5 text-sm rounded border focus:outline-none"
                    style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-200)' }}
                    placeholder="My Custom Preset"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Description</label>
                  <textarea
                    value={newPresetDescription}
                    onChange={(e) => setNewPresetDescription(e.target.value)}
                    className="px-2 py-1.5 text-sm rounded border focus:outline-none"
                    style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-200)' }}
                    rows={3}
                    placeholder="Description of the preset..."
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Category</label>
                  <select
                    value={newPresetCategory}
                    onChange={(e) => setNewPresetCategory(e.target.value as Exclude<PresetCategory, 'all'>)}
                    className="px-2 py-1.5 text-sm rounded border focus:outline-none"
                    style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-200)' }}
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
              <div className="flex justify-end space-x-2 mt-6">
                <button
                  onClick={() => setShowCreateDialog(false)}
                  className="px-3 py-1.5 text-sm rounded border transition-colors"
                  style={{ backgroundColor: 'transparent', borderColor: 'transparent', color: 'var(--gray-400)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreatePreset}
                  disabled={!newPresetName.trim()}
                  className="px-3 py-1.5 text-sm rounded border transition-colors disabled:opacity-50"
                  style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}
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
