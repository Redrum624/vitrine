import { useState, useEffect } from 'react';
import { Save, FolderOpen, Download, Upload, Star, Search, Filter } from 'lucide-react';
import { GlassModal } from './GlassModal';
import { ChipButton } from '../Controls/ChipButton';
import { AccentButton } from '../Controls/AccentButton';
import { SectionLabel } from '../Controls/SectionLabel';
import { inputStyle } from './glassFormStyles';
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
      const applied = presetService.applyPreset(preset.id);
      if (applied) {
        // Same follow-up doUndo/doRedo use after CheckpointService.restore() — the
        // preset applied its settings directly to the pipeline modules, so the
        // canvas + panels need an explicit nudge to actually repaint.
        const store = useAppStore.getState();
        store.notifyExternalParamsChange();
        store.triggerReprocessing();
        onApplyPreset(preset);
        logger.info(`Applied preset: ${preset.name}`);
      } else {
        logger.error(`Failed to apply preset: ${preset.name}`);
      }
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

      if (result.warnings.length > 0) {
        logger.warn('Import warnings:', result.warnings);
      }

      if (result.errors.length > 0) {
        logger.error('Import errors:', result.errors);
      }
    } catch (error) {
      logger.error('Failed to import presets:', error);
    }
  };

  const headerActions = (
    <div className="flex items-center flex-shrink-0" style={{ gap: 6 }}>
      <ChipButton onClick={() => setShowCreateDialog(true)}>
        <Save size={12} style={{ marginRight: 6 }} />
        Create Preset
      </ChipButton>
      <button
        type="button"
        onClick={handleExportPresets}
        title="Export Presets"
        className="glass-pill-btn inline-flex items-center justify-center"
        style={{ padding: 6, borderRadius: 7, color: 'var(--glass-text-muted)' }}
      >
        <Download size={14} />
      </button>
      <label
        className="glass-pill-btn inline-flex items-center justify-center cursor-pointer"
        title="Import Presets"
        style={{ padding: 6, borderRadius: 7, color: 'var(--glass-text-muted)' }}
      >
        <Upload size={14} />
        <input type="file" accept=".json" onChange={handleImportPresets} className="hidden" />
      </label>
    </div>
  );

  return (
    <>
      <GlassModal
        isOpen={isOpen}
        onClose={onClose}
        icon={<FolderOpen size={15} />}
        title="Preset Manager"
        headerActions={headerActions}
        cardClassName="w-5/6 max-w-6xl h-4/5"
        cardStyle={{ maxHeight: '90vh' }}
        scrollBody={false}
      >
        <div className="flex flex-1 overflow-hidden">
          {/* Categories */}
          <div className="flex-shrink-0 flex flex-col" style={{ width: 216, borderRight: '1px solid var(--glass-border)', padding: 14, gap: 12 }}>
            <div className="relative flex items-center">
              <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--glass-text-muted)' }} />
              <input
                type="text"
                placeholder="Search presets..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ ...inputStyle, paddingLeft: 26 }}
              />
            </div>

            <nav className="flex flex-col" style={{ gap: 4 }}>
              {categoriesWithCounts.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedCategory(category.id)}
                  data-active={selectedCategory === category.id || undefined}
                  className="glass-modal-tab w-full flex items-center justify-between"
                  style={{
                    padding: '8px 10px', borderRadius: 9, fontSize: 12, textAlign: 'left',
                    border: '1px solid transparent', color: 'var(--glass-text-secondary)',
                  }}
                >
                  <span>{category.name}</span>
                  <span style={{ fontSize: 10.5, opacity: 0.75 }}>{category.count}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* Preset grid */}
          <div className="flex-1 overflow-y-auto" style={{ padding: '20px 24px' }}>
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredPresets.map((preset) => (
                <div
                  key={preset.id}
                  onClick={() => handleApplyPreset(preset)}
                  data-active={selectedPreset?.id === preset.id || undefined}
                  className="glass-modal-card-btn cursor-pointer"
                  style={{ padding: 14, borderRadius: 12, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)' }}
                >
                  {/* Preview */}
                  <div className="aspect-video rounded flex items-center justify-center mb-3" style={{ background: 'rgba(0,0,0,.3)' }}>
                    <Filter size={22} style={{ color: 'var(--glass-text-muted)' }} />
                  </div>

                  <div className="flex items-center justify-between">
                    <h3 className="truncate" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--glass-text-title)' }}>{preset.name}</h3>
                    <div className="flex items-center" style={{ gap: 4 }}>
                      <Star size={11} style={{ color: 'var(--glass-text-muted)' }} />
                      <span style={{ fontSize: 10.5, color: 'var(--glass-text-muted)' }}>{preset.metadata.imageCount || 0}</span>
                    </div>
                  </div>
                  <p className="line-clamp-2" style={{ fontSize: 11, marginTop: 4, color: 'var(--glass-text-muted)' }}>{preset.description}</p>
                  <div className="flex items-center justify-between" style={{ marginTop: 8 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, background: 'rgba(0,0,0,.3)', color: 'var(--glass-text-label)' }}>
                      {preset.category === 'bw' ? 'B&W' : preset.category.charAt(0).toUpperCase() + preset.category.slice(1)}
                    </span>
                    {preset.category === 'custom' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePreset(preset.id);
                        }}
                        style={{ fontSize: 10.5, color: 'var(--glass-text-muted)', background: 'transparent', border: 0, cursor: 'pointer' }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {filteredPresets.length === 0 && (
              <div className="text-center" style={{ marginTop: 48, color: 'var(--glass-text-muted)' }}>
                <Filter size={36} className="mx-auto mb-3 opacity-50" />
                <p style={{ fontSize: 12.5 }}>No presets found</p>
                <p style={{ fontSize: 11, marginTop: 4 }}>Try adjusting your search or category filter</p>
              </div>
            )}
          </div>
        </div>
      </GlassModal>

      {/* Create Preset sub-dialog */}
      <GlassModal
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        title="Create New Preset"
        cardStyle={{ width: 400 }}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreateDialog(false)}
              className="glass-modal-btn-secondary"
              style={{
                padding: '9px 16px', borderRadius: 10, fontSize: 12, fontWeight: 500,
                border: '1px solid rgba(255,255,255,.1)', background: 'transparent', color: 'var(--glass-text-secondary)',
              }}
            >
              Cancel
            </button>
            <AccentButton onClick={handleCreatePreset} disabled={!newPresetName.trim()}>
              Create Preset
            </AccentButton>
          </div>
        }
      >
        <div className="flex flex-col" style={{ gap: 14, padding: 16 }}>
          <div className="flex flex-col gap-1">
            <SectionLabel>Name</SectionLabel>
            <input
              type="text"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              style={inputStyle}
              placeholder="My Custom Preset"
            />
          </div>
          <div className="flex flex-col gap-1">
            <SectionLabel>Description</SectionLabel>
            <textarea
              value={newPresetDescription}
              onChange={(e) => setNewPresetDescription(e.target.value)}
              style={{ ...inputStyle, resize: 'vertical' }}
              rows={3}
              placeholder="Description of the preset..."
            />
          </div>
          <div className="flex flex-col gap-1">
            <SectionLabel>Category</SectionLabel>
            <select
              value={newPresetCategory}
              onChange={(e) => setNewPresetCategory(e.target.value as Exclude<PresetCategory, 'all'>)}
              style={inputStyle}
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
          {presetService.hasUnportableBrushLayers() && (
            <p style={{ fontSize: 11, color: 'var(--glass-text-muted)', margin: 0, lineHeight: 1.5 }}>
              Note: brush-mask layers aren&apos;t included in presets — their painted masks aren&apos;t portable.
              Radial and gradient masks are saved.
            </p>
          )}
        </div>
      </GlassModal>
    </>
  );
}
