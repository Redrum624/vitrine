import React, { useState, useEffect, useCallback } from 'react';
import { Copyright, User, Calendar, MapPin, Tags, FileText, Download, Upload, CheckCircle, AlertTriangle } from 'lucide-react';
import { logger } from '../../utils/Logger';
import { useAppStore } from '../../stores/appStore';
import {
  copyrightService,
  IPTCMetadata,
  XMPMetadata,
  CopyrightTemplate,
  CopyrightPreset
} from '../../services/CopyrightService';

interface CopyrightModuleProps {
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export const CopyrightModule: React.FC<CopyrightModuleProps> = ({
  isEnabled,
  onToggle
}) => {
  const currentImage = useAppStore((state) => state.currentImage);

  const [templates, setTemplates] = useState<CopyrightTemplate[]>([]);
  const [presets, setPresets] = useState<CopyrightPreset[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; warnings: string[]; errors: string[] } | null>(null);

  const [templateVariables, setTemplateVariables] = useState({
    'Your Name': 'Your Name',
    'Your Studio': 'Your Studio',
    'Your Email': 'your.email@example.com',
    'Your Website': 'https://yourwebsite.com'
  });

  const [iptcMetadata, setIptcMetadata] = useState<IPTCMetadata>({
    copyrightNotice: '© 2024 Your Name. All rights reserved.',
    copyrightStatus: 'copyrighted',
    creator: 'Your Name',
    creatorJobTitle: 'Photographer',
    keywords: [],
    dateCreated: new Date()
  });

  const [xmpMetadata, setXmpMetadata] = useState<XMPMetadata>({
    rights: '© 2024 Your Name. All rights reserved.',
    creator: ['Your Name'],
    subject: []
  });

  // Load templates and presets on mount
  useEffect(() => {
    const availableTemplates = copyrightService.getTemplates();
    const availablePresets = copyrightService.getPresets();

    setTemplates(availableTemplates);
    setPresets(availablePresets);

    // Auto-select first template
    if (availableTemplates.length > 0) {
      setSelectedTemplate(availableTemplates[0].id);
    }
  }, []);

  // Validate metadata when it changes
  useEffect(() => {
    const result = copyrightService.validateMetadata(iptcMetadata);
    setValidationResult(result);
  }, [iptcMetadata]);

  // Apply template
  const applyTemplate = useCallback((templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (template) {
      const processedMetadata = copyrightService.applyTemplateVariables(
        template.metadata,
        templateVariables
      );
      setIptcMetadata(processedMetadata);
      setSelectedTemplate(templateId);
      logger.info('Applied copyright template:', template.name);
    }
  }, [templates, templateVariables]);

  // Apply preset
  const applyPreset = useCallback((presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (preset) {
      setIptcMetadata(prev => ({ ...prev, ...preset.iptc }));
      setXmpMetadata(prev => ({ ...prev, ...preset.xmp }));
      setSelectedPreset(presetId);
      logger.info('Applied copyright preset:', preset.name);
    }
  }, [presets]);

  // Update IPTC field
  const updateIptcField = <K extends keyof IPTCMetadata>(
    field: K,
    value: IPTCMetadata[K]
  ) => {
    setIptcMetadata(prev => ({ ...prev, [field]: value }));
  };

  // Update XMP field (used in preset application)
  const updateXmpField = <K extends keyof XMPMetadata>(
    field: K,
    value: XMPMetadata[K]
  ) => {
    setXmpMetadata(prev => ({ ...prev, [field]: value }));
  };

  // Update template variable
  const updateTemplateVariable = (variable: string, value: string) => {
    setTemplateVariables(prev => ({ ...prev, [variable]: value }));
  };

  // Add keyword
  const addKeyword = useCallback((keyword: string) => {
    if (keyword.trim() && !iptcMetadata.keywords?.includes(keyword.trim())) {
      const newKeywords = [...(iptcMetadata.keywords || []), keyword.trim()];
      updateIptcField('keywords', newKeywords);
    }
  }, [iptcMetadata.keywords]);

  // Remove keyword
  const removeKeyword = useCallback((index: number) => {
    if (iptcMetadata.keywords) {
      const newKeywords = iptcMetadata.keywords.filter((_, i) => i !== index);
      updateIptcField('keywords', newKeywords);
    }
  }, [iptcMetadata.keywords]);

  // Embed metadata
  const embedMetadata = useCallback(async () => {
    if (!currentImage) {
      logger.warn('No image selected for metadata embedding');
      return;
    }

    try {
      setIsEmbedding(true);
      logger.info('Embedding copyright metadata...');

      const success = await copyrightService.embedMetadata(
        currentImage.path,
        iptcMetadata,
        xmpMetadata
      );

      if (success) {
        logger.info('Copyright metadata embedded successfully');
      } else {
        logger.error('Failed to embed copyright metadata');
      }

    } catch (error) {
      logger.error('Error embedding metadata:', error);
    } finally {
      setIsEmbedding(false);
    }
  }, [currentImage, iptcMetadata, xmpMetadata]);

  // Export metadata
  const exportMetadata = useCallback(() => {
    try {
      const json = copyrightService.exportMetadata(iptcMetadata, xmpMetadata);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = 'copyright-metadata.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      logger.info('Copyright metadata exported');
    } catch (error) {
      logger.error('Failed to export metadata:', error);
    }
  }, [iptcMetadata, xmpMetadata]);

  // Import metadata
  const importMetadata = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = e.target?.result as string;
        const { iptc, xmp } = copyrightService.importMetadata(json);
        setIptcMetadata(prev => ({ ...prev, ...iptc }));
        setXmpMetadata(prev => ({ ...prev, ...xmp }));
        logger.info('Copyright metadata imported successfully');
      } catch (error) {
        logger.error('Failed to import metadata:', error);
      }
    };
    reader.readAsText(file);
  }, []);

  const categories = ['personal', 'commercial', 'stock', 'editorial'];
  const copyrightStatuses = [
    { value: 'copyrighted', label: 'Copyrighted' },
    { value: 'public-domain', label: 'Public Domain' },
    { value: 'unknown', label: 'Unknown' }
  ];

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      {/* Module Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <Copyright className="w-5 h-5 text-gray-300" />
          <span className="text-white font-medium">Copyright & Metadata</span>
          {isEmbedding && (
            <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportMetadata}
            className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-800 text-white rounded transition-colors"
            title="Export metadata"
          >
            Export
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

          {/* Templates & Presets */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-white">Templates & Presets</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Copyright Template</label>
                <select
                  value={selectedTemplate}
                  onChange={(e) => applyTemplate(e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                >
                  <option value="">Select template...</option>
                  {categories.map(category => (
                    <optgroup key={category} label={category.charAt(0).toUpperCase() + category.slice(1)}>
                      {templates
                        .filter(t => t.category === category)
                        .map(template => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Quick Preset</label>
                <select
                  value={selectedPreset}
                  onChange={(e) => applyPreset(e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                >
                  <option value="">Select preset...</option>
                  {presets.map(preset => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Template Variables */}
            <div className="bg-gray-700/30 rounded p-3 space-y-2">
              <div className="text-xs font-medium text-white">Template Variables</div>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(templateVariables).map(([variable, value]) => (
                  <div key={variable}>
                    <label className="block text-xs text-gray-400 mb-1">{variable}</label>
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => updateTemplateVariable(variable, e.target.value)}
                      className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-gray-600 focus:outline-none"
                      placeholder={variable}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Copyright Information */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Copyright className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-white">Copyright Information</span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Copyright Notice</label>
                <input
                  type="text"
                  value={iptcMetadata.copyrightNotice || ''}
                  onChange={(e) => updateIptcField('copyrightNotice', e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  placeholder="© 2024 Your Name. All rights reserved."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Copyright Status</label>
                  <select
                    value={iptcMetadata.copyrightStatus || 'copyrighted'}
                    onChange={(e) => updateIptcField('copyrightStatus', e.target.value as 'copyrighted' | 'public-domain' | 'unknown')}
                    className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  >
                    {copyrightStatuses.map(status => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Credit</label>
                  <input
                    type="text"
                    value={iptcMetadata.credit || ''}
                    onChange={(e) => updateIptcField('credit', e.target.value)}
                    className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                    placeholder="Photo credit"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Rights Usage Terms</label>
                <textarea
                  value={iptcMetadata.rightsUsageTerms || ''}
                  onChange={(e) => updateIptcField('rightsUsageTerms', e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none resize-none"
                  rows={2}
                  placeholder="Terms and conditions for usage rights"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Web Statement URL</label>
                <input
                  type="url"
                  value={iptcMetadata.webStatement || ''}
                  onChange={(e) => updateIptcField('webStatement', e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  placeholder="https://yourwebsite.com/copyright"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">XMP Rights Statement</label>
                <input
                  type="text"
                  value={xmpMetadata.rights || ''}
                  onChange={(e) => updateXmpField('rights', e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  placeholder="XMP rights statement"
                />
              </div>
            </div>
          </div>

          {/* Creator Information */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-white">Creator Information</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Creator Name</label>
                <input
                  type="text"
                  value={iptcMetadata.creator || ''}
                  onChange={(e) => updateIptcField('creator', e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  placeholder="Your Name"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Job Title</label>
                <input
                  type="text"
                  value={iptcMetadata.creatorJobTitle || ''}
                  onChange={(e) => updateIptcField('creatorJobTitle', e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  placeholder="Photographer"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Email</label>
                <input
                  type="email"
                  value={iptcMetadata.creatorEmail || ''}
                  onChange={(e) => updateIptcField('creatorEmail', e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  placeholder="your.email@example.com"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Website</label>
                <input
                  type="url"
                  value={iptcMetadata.creatorWebsite || ''}
                  onChange={(e) => updateIptcField('creatorWebsite', e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  placeholder="https://yourwebsite.com"
                />
              </div>
            </div>
          </div>

          {/* Image Information */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-white">Image Information</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Title</label>
                <input
                  type="text"
                  value={iptcMetadata.title || ''}
                  onChange={(e) => updateIptcField('title', e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  placeholder="Image title"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Category</label>
                <input
                  type="text"
                  value={iptcMetadata.category || ''}
                  onChange={(e) => updateIptcField('category', e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  placeholder="Photo category"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Description</label>
              <textarea
                value={iptcMetadata.description || ''}
                onChange={(e) => updateIptcField('description', e.target.value)}
                className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none resize-none"
                rows={2}
                placeholder="Image description"
              />
            </div>
          </div>

          {/* Keywords */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Tags className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-white">Keywords</span>
            </div>

            <div>
              <input
                type="text"
                placeholder="Add keyword and press Enter"
                className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    addKeyword((e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).value = '';
                  }
                }}
              />
            </div>

            {iptcMetadata.keywords && iptcMetadata.keywords.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {iptcMetadata.keywords.map((keyword, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-gray-800 text-white text-xs rounded cursor-pointer hover:bg-gray-800"
                    onClick={() => removeKeyword(index)}
                  >
                    {keyword}
                    <span className="text-xs">×</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Location */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-white">Location</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Location</label>
                <input
                  type="text"
                  value={iptcMetadata.location || ''}
                  onChange={(e) => updateIptcField('location', e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  placeholder="Specific location"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">City</label>
                <input
                  type="text"
                  value={iptcMetadata.city || ''}
                  onChange={(e) => updateIptcField('city', e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  placeholder="City"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">State/Province</label>
                <input
                  type="text"
                  value={iptcMetadata.state || ''}
                  onChange={(e) => updateIptcField('state', e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  placeholder="State or Province"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Country</label>
                <input
                  type="text"
                  value={iptcMetadata.country || ''}
                  onChange={(e) => updateIptcField('country', e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  placeholder="Country"
                />
              </div>
            </div>
          </div>

          {/* Validation */}
          {validationResult && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-white">Validation</div>

              {validationResult.valid ? (
                <div className="flex items-center gap-2 p-2 bg-gray-800 border border-gray-600 rounded">
                  <CheckCircle className="w-4 h-4 text-gray-300" />
                  <span className="text-gray-300 text-sm">Metadata validation passed</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {validationResult.errors.map((error, index) => (
                    <div key={index} className="flex items-center gap-2 p-2 bg-gray-800 border border-gray-600 rounded">
                      <AlertTriangle className="w-4 h-4 text-gray-300" />
                      <span className="text-gray-300 text-sm">{error}</span>
                    </div>
                  ))}
                </div>
              )}

              {validationResult.warnings.length > 0 && (
                <div className="space-y-1">
                  {validationResult.warnings.map((warning, index) => (
                    <div key={index} className="flex items-center gap-2 p-2 bg-gray-800 border border-gray-600 rounded">
                      <AlertTriangle className="w-4 h-4 text-gray-300" />
                      <span className="text-gray-300 text-sm">{warning}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-gray-700">
            <button
              onClick={embedMetadata}
              disabled={isEmbedding || !currentImage || !validationResult?.valid}
              className="flex-1 bg-gray-800 hover:bg-gray-800 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded transition-colors flex items-center justify-center gap-2"
            >
              <Copyright className="w-4 h-4" />
              {isEmbedding ? 'Embedding...' : 'Embed Metadata'}
            </button>

            <button
              onClick={exportMetadata}
              className="bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium py-2 px-4 rounded transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export
            </button>

            <label className="bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium py-2 px-4 rounded transition-colors flex items-center gap-2 cursor-pointer">
              <Upload className="w-4 h-4" />
              Import
              <input
                type="file"
                accept=".json"
                onChange={importMetadata}
                className="hidden"
              />
            </label>
          </div>

          {/* Current Image Info */}
          {currentImage && (
            <div className="bg-gray-800 border border-gray-600 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="w-4 h-4 text-gray-300" />
                <span className="text-sm font-medium text-white">Current Image</span>
              </div>
              <div className="text-xs text-gray-300">
                <div>File: {currentImage.name}</div>
                <div>Size: {currentImage.metadata.width}×{currentImage.metadata.height}</div>
                <div>Created: {currentImage.metadata.dateCreated.toLocaleDateString()}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};