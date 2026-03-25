import React, { useState, useEffect, useCallback } from 'react';
import { Printer, Layout, Palette, Eye, EyeOff, Download, Trash2, RefreshCw } from 'lucide-react';
import { logger } from '../../utils/Logger';
import { useAppStore } from '../../stores/appStore';
import {
  printService,
  PrintLayout,
  PaperSize,
  PrintSettings,
  PrintJob,
  InkUsage
} from '../../services/PrintService';
import {
  colorManagementService,
  PrintProfile
} from '../../services/ColorManagementService';

interface PrintModuleProps {
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export const PrintModule: React.FC<PrintModuleProps> = ({
  isEnabled,
  onToggle
}) => {
  const currentImage = useAppStore((state) => state.currentImage);
  const processedImageData = useAppStore((state) => state.processedImageData);

  const [paperSizes, setPaperSizes] = useState<PaperSize[]>([]);
  const [printLayouts, setPrintLayouts] = useState<PrintLayout[]>([]);
  const [printProfiles, setPrintProfiles] = useState<PrintProfile[]>([]);
  const [printJobs, setPrintJobs] = useState<PrintJob[]>([]);

  const [selectedPaperSize, setSelectedPaperSize] = useState<string>('A4');
  const [selectedLayout, setSelectedLayout] = useState<string>('');
  const [selectedProfile, setSelectedProfile] = useState<string>('');
  const [showSoftProof, setShowSoftProof] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const [printSettings, setPrintSettings] = useState<Partial<PrintSettings>>({
    renderingIntent: 'perceptual',
    blackPointCompensation: true,
    resolution: 300,
    qualityLevel: 'high',
    colorAdjustments: {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      shadows: 0,
      highlights: 0
    }
  });

  // Load available options on mount
  useEffect(() => {
    const sizes = printService.getPaperSizes();
    const profiles = colorManagementService.getPrintProfiles();

    setPaperSizes(sizes);
    setPrintProfiles(profiles);

    // Set default selections
    if (sizes.length > 0 && !selectedPaperSize) {
      setSelectedPaperSize(sizes[0].name);
    }
    if (profiles.length > 0 && !selectedProfile) {
      setSelectedProfile(profiles[0].name);
    }
  }, [selectedPaperSize, selectedProfile]);

  // Update layouts when paper size changes
  useEffect(() => {
    if (selectedPaperSize) {
      const layouts = printService.getPrintLayoutsForPaper(selectedPaperSize);
      setPrintLayouts(layouts);
      if (layouts.length > 0 && !selectedLayout) {
        setSelectedLayout(layouts[0].name);
      }
    }
  }, [selectedPaperSize, selectedLayout]);

  // Load print jobs
  useEffect(() => {
    if (isEnabled) {
      const jobs = printService.getAllPrintJobs();
      setPrintJobs(jobs);
    }
  }, [isEnabled]);

  // Generate soft proof when settings change
  const generateSoftProof = useCallback(async () => {
    if (!processedImageData || !currentImage || !selectedProfile || !selectedLayout) return;

    try {
      setIsProcessing(true);

      const layout = printLayouts.find(l => l.name === selectedLayout);
      const profile = printProfiles.find(p => p.name === selectedProfile);

      if (!layout || !profile) return;

      const settings: PrintSettings = {
        layout,
        colorProfile: profile,
        renderingIntent: printSettings.renderingIntent || 'perceptual',
        blackPointCompensation: printSettings.blackPointCompensation || true,
        resolution: printSettings.resolution || 300,
        qualityLevel: printSettings.qualityLevel || 'high',
        colorAdjustments: printSettings.colorAdjustments || {
          brightness: 0,
          contrast: 0,
          saturation: 0,
          shadows: 0,
          highlights: 0
        }
      };

      const imageData = processedImageData instanceof Float32Array
        ? processedImageData
        : processedImageData.data;

      await printService.generateSoftProof(
        imageData,
        currentImage.metadata.width,
        currentImage.metadata.height,
        settings
      );

      // Would store proofData for actual soft proof display
      logger.info('Soft proof generated successfully');

    } catch (error) {
      logger.error('Failed to generate soft proof:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [processedImageData, currentImage, selectedProfile, selectedLayout, printLayouts, printProfiles, printSettings]);

  // Create print job
  const createPrintJob = useCallback(async () => {
    if (!processedImageData || !currentImage || !selectedProfile || !selectedLayout) return;

    try {
      setIsProcessing(true);

      const layout = printLayouts.find(l => l.name === selectedLayout);
      const profile = printProfiles.find(p => p.name === selectedProfile);

      if (!layout || !profile) return;

      const settings: PrintSettings = {
        layout,
        colorProfile: profile,
        renderingIntent: printSettings.renderingIntent || 'perceptual',
        blackPointCompensation: printSettings.blackPointCompensation || true,
        resolution: printSettings.resolution || 300,
        qualityLevel: printSettings.qualityLevel || 'high',
        colorAdjustments: printSettings.colorAdjustments || {
          brightness: 0,
          contrast: 0,
          saturation: 0,
          shadows: 0,
          highlights: 0
        }
      };

      const imageData2 = processedImageData instanceof Float32Array
        ? processedImageData
        : processedImageData.data;

      const jobId = await printService.createPrintJob(
        imageData2,
        currentImage.metadata.width,
        currentImage.metadata.height,
        settings
      );

      // Refresh print jobs list
      const jobs = printService.getAllPrintJobs();
      setPrintJobs(jobs);

      logger.info(`Print job created: ${jobId}`);

    } catch (error) {
      logger.error('Failed to create print job:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [processedImageData, currentImage, selectedProfile, selectedLayout, printLayouts, printProfiles, printSettings]);

  const updatePrintSetting = <K extends keyof PrintSettings>(
    key: K,
    value: PrintSettings[K]
  ) => {
    setPrintSettings(prev => ({ ...prev, [key]: value }));
  };

  const updateColorAdjustment = (adjustment: string, value: number) => {
    setPrintSettings(prev => ({
      ...prev,
      colorAdjustments: {
        brightness: prev.colorAdjustments?.brightness || 0,
        contrast: prev.colorAdjustments?.contrast || 0,
        saturation: prev.colorAdjustments?.saturation || 0,
        shadows: prev.colorAdjustments?.shadows || 0,
        highlights: prev.colorAdjustments?.highlights || 0,
        ...prev.colorAdjustments,
        [adjustment]: value
      }
    }));
  };

  const deletePrintJob = (jobId: string) => {
    printService.deletePrintJob(jobId);
    const jobs = printService.getAllPrintJobs();
    setPrintJobs(jobs);
  };

  const formatInkUsage = (usage: InkUsage) => {
    return `C:${usage.cyan}% M:${usage.magenta}% Y:${usage.yellow}% K:${usage.black}%`;
  };

  const getJobStatusColor = (status: string) => {
    switch (status) {
      case 'ready': return 'text-gray-300';
      case 'processing': return 'text-gray-300';
      case 'error': return 'text-gray-300';
      default: return 'text-gray-400';
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      {/* Module Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <Printer className="w-5 h-5 text-gray-300" />
          <span className="text-white font-medium">Print Module</span>
          {isProcessing && (
            <RefreshCw className="w-4 h-4 text-gray-300 animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSoftProof(!showSoftProof)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              showSoftProof ? 'bg-gray-800 text-white' : 'bg-gray-700 text-gray-300'
            }`}
            title="Toggle soft proof preview"
          >
            Proof
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

          {/* Paper Size Selection */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Layout className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-white">Paper & Layout</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Paper Size</label>
                <select
                  value={selectedPaperSize}
                  onChange={(e) => setSelectedPaperSize(e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  disabled={isProcessing}
                >
                  {paperSizes.map(size => (
                    <option key={size.name} value={size.name}>
                      {size.name} ({size.width}×{size.height}mm)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Layout</label>
                <select
                  value={selectedLayout}
                  onChange={(e) => setSelectedLayout(e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  disabled={isProcessing || printLayouts.length === 0}
                >
                  {printLayouts.map(layout => (
                    <option key={layout.name} value={layout.name}>
                      {layout.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Color Management */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-white">Color Management</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Print Profile</label>
                <select
                  value={selectedProfile}
                  onChange={(e) => setSelectedProfile(e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  disabled={isProcessing}
                >
                  {printProfiles.map(profile => (
                    <option key={profile.name} value={profile.name}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Rendering Intent</label>
                <select
                  value={printSettings.renderingIntent}
                  onChange={(e) => updatePrintSetting('renderingIntent', e.target.value as 'perceptual' | 'relative' | 'saturation' | 'absolute')}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  disabled={isProcessing}
                >
                  <option value="perceptual">Perceptual</option>
                  <option value="relative">Relative Colorimetric</option>
                  <option value="saturation">Saturation</option>
                  <option value="absolute">Absolute Colorimetric</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={printSettings.blackPointCompensation}
                  onChange={(e) => updatePrintSetting('blackPointCompensation', e.target.checked)}
                  className="mr-2 rounded"
                  disabled={isProcessing}
                />
                <span className="text-xs text-gray-300">Black Point Compensation</span>
              </label>
            </div>
          </div>

          {/* Print Quality */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Resolution: {printSettings.resolution} DPI
                </label>
                <input
                  type="range"
                  min="150"
                  max="600"
                  step="150"
                  value={printSettings.resolution}
                  onChange={(e) => updatePrintSetting('resolution', parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-200"
                  disabled={isProcessing}
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Quality Level</label>
                <select
                  value={printSettings.qualityLevel}
                  onChange={(e) => updatePrintSetting('qualityLevel', e.target.value as 'draft' | 'normal' | 'high' | 'maximum')}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
                  disabled={isProcessing}
                >
                  <option value="draft">Draft</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="maximum">Maximum</option>
                </select>
              </div>
            </div>
          </div>

          {/* Color Adjustments */}
          <div className="space-y-3">
            <div className="text-sm font-medium text-white">Print Adjustments</div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-gray-400 mb-1">
                  Brightness: {printSettings.colorAdjustments?.brightness || 0}
                </label>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={printSettings.colorAdjustments?.brightness || 0}
                  onChange={(e) => updateColorAdjustment('brightness', parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-200"
                  disabled={isProcessing}
                />
              </div>

              <div>
                <label className="block text-gray-400 mb-1">
                  Contrast: {printSettings.colorAdjustments?.contrast || 0}
                </label>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={printSettings.colorAdjustments?.contrast || 0}
                  onChange={(e) => updateColorAdjustment('contrast', parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-200"
                  disabled={isProcessing}
                />
              </div>

              <div>
                <label className="block text-gray-400 mb-1">
                  Saturation: {printSettings.colorAdjustments?.saturation || 0}
                </label>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={printSettings.colorAdjustments?.saturation || 0}
                  onChange={(e) => updateColorAdjustment('saturation', parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-200"
                  disabled={isProcessing}
                />
              </div>

              <div>
                <label className="block text-gray-400 mb-1">
                  Shadows: {printSettings.colorAdjustments?.shadows || 0}
                </label>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={printSettings.colorAdjustments?.shadows || 0}
                  onChange={(e) => updateColorAdjustment('shadows', parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-200"
                  disabled={isProcessing}
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-gray-700">
            <button
              onClick={generateSoftProof}
              disabled={isProcessing || !processedImageData || !selectedLayout || !selectedProfile}
              className="flex-1 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded transition-colors flex items-center justify-center gap-2"
            >
              {showSoftProof ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {isProcessing ? 'Processing...' : 'Soft Proof'}
            </button>

            <button
              onClick={createPrintJob}
              disabled={isProcessing || !processedImageData || !selectedLayout || !selectedProfile}
              className="flex-1 bg-gray-800 hover:bg-gray-800 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded transition-colors flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              {isProcessing ? 'Creating...' : 'Create Print Job'}
            </button>
          </div>

          {/* Print Jobs */}
          {printJobs.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-gray-700">
              <div className="text-sm font-medium text-white">Print Queue</div>

              <div className="space-y-2 max-h-48 overflow-y-auto">
                {printJobs.slice(0, 5).map(job => (
                  <div key={job.id} className="bg-gray-700/50 rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-medium text-white">
                        {job.settings.layout.name}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-mono ${getJobStatusColor(job.status)}`}>
                          {job.status.toUpperCase()}
                        </span>
                        <button
                          onClick={() => deletePrintJob(job.id)}
                          className="p-1 hover:bg-gray-600 rounded transition-colors"
                        >
                          <Trash2 className="w-3 h-3 text-gray-400" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-300">
                      <div>
                        <span className="text-gray-500">Profile:</span> {job.settings.colorProfile.name}
                      </div>
                      <div>
                        <span className="text-gray-500">DPI:</span> {job.settings.resolution}
                      </div>
                      {job.estimatedInkUsage && (
                        <>
                          <div className="col-span-2">
                            <span className="text-gray-500">Ink:</span> {formatInkUsage(job.estimatedInkUsage)}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};