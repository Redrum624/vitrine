import React, { useState, useCallback, useEffect } from 'react';
import {
  Play,
  Square,
  Plus,
  Trash2,
  Settings,
  Image,
  Clock,
  CheckCircle,
  XCircle,
  Loader,
  X,
  FolderOpen
} from 'lucide-react';
import SliderControl from '../Controls/SliderControl';
import { BatchJob, BatchPreset, batchProcessingService } from '../../services/BatchProcessingService';
import { ImageFileInfo } from '../../services/FileSystemService';

interface BatchProcessingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  availableImages: ImageFileInfo[];
  onSelectImages: () => void;
}

type TabType = 'jobs' | 'create' | 'settings';

export const BatchProcessingDialog: React.FC<BatchProcessingDialogProps> = ({
  isOpen,
  onClose,
  onSelectImages
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('jobs');
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [selectedImages, setSelectedImages] = useState<ImageFileInfo[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [presets, setPresets] = useState<BatchPreset[]>([]);
  const [jobName, setJobName] = useState('');
  const [refreshInterval, setRefreshInterval] = useState<number>();

  // Load initial data
  useEffect(() => {
    if (isOpen) {
      setPresets(batchProcessingService.getPresets());
      refreshJobs();

      // Set up auto-refresh for active jobs
      const interval = window.setInterval(refreshJobs, 1000);
      setRefreshInterval(interval);

      return () => {
        if (interval) window.clearInterval(interval);
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    };
  }, [refreshInterval]);

  const refreshJobs = useCallback(() => {
    setJobs(batchProcessingService.getJobs());
  }, []);

  const handleCreateJob = useCallback(() => {
    if (!selectedPreset || selectedImages.length === 0) {
      alert('Please select a preset and images');
      return;
    }

    const preset = batchProcessingService.getPreset(selectedPreset);
    if (!preset) {
      alert('Selected preset not found');
      return;
    }

    const name = jobName || `${preset.name} - ${new Date().toLocaleString()}`;
    const jobId = batchProcessingService.createJobFromPreset(
      selectedPreset,
      name,
      selectedImages
    );

    if (jobId) {
      // Auto-start the job
      batchProcessingService.startBatchJob(jobId);

      // Reset form
      setJobName('');
      setSelectedImages([]);
      setSelectedPreset('');

      // Switch to jobs tab
      setActiveTab('jobs');

      refreshJobs();
    }
  }, [selectedPreset, selectedImages, jobName, refreshJobs]);

  const handleStartJob = useCallback((jobId: string) => {
    batchProcessingService.startBatchJob(jobId);
    refreshJobs();
  }, [refreshJobs]);

  const handleCancelJob = useCallback((jobId: string) => {
    batchProcessingService.cancelBatchJob(jobId);
    refreshJobs();
  }, [refreshJobs]);

  const handleRemoveJob = useCallback((jobId: string) => {
    batchProcessingService.removeJob(jobId);
    refreshJobs();
  }, [refreshJobs]);

  const formatTime = (milliseconds: number): string => {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusIcon = (status: BatchJob['status']) => {
    switch (status) {
      case 'pending':
        return <Clock size={16} className="text-yellow-500" />;
      case 'running':
        return <Loader size={16} className="text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle size={16} className="text-green-500" />;
      case 'failed':
        return <XCircle size={16} className="text-red-500" />;
      case 'cancelled':
        return <Square size={16} className="text-gray-500" />;
      default:
        return null;
    }
  };

  const renderJobsTab = () => {
    const statistics = batchProcessingService.getStatistics();

    return (
      <div className="space-y-4">
        {/* Statistics */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-700 rounded p-3">
            <div className="text-lg font-semibold text-white">{statistics.totalJobs}</div>
            <div className="text-xs text-gray-400">Total Jobs</div>
          </div>
          <div className="bg-gray-700 rounded p-3">
            <div className="text-lg font-semibold text-blue-400">{statistics.activeJobs}</div>
            <div className="text-xs text-gray-400">Active Jobs</div>
          </div>
          <div className="bg-gray-700 rounded p-3">
            <div className="text-lg font-semibold text-green-400">{statistics.totalImagesProcessed}</div>
            <div className="text-xs text-gray-400">Images Processed</div>
          </div>
        </div>

        {/* Jobs List */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h4 className="text-sm font-medium text-gray-300">Batch Jobs</h4>
            <div className="flex gap-2">
              <button
                onClick={() => batchProcessingService.clearCompletedJobs()}
                className="px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded"
              >
                Clear Completed
              </button>
              <button
                onClick={refreshJobs}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto space-y-2">
            {jobs.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Image size={32} className="mx-auto mb-2 opacity-50" />
                <div>No batch jobs yet</div>
                <div className="text-xs">Create a job to get started</div>
              </div>
            ) : (
              jobs.map((job) => (
                <div key={job.id} className="bg-gray-700 rounded p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(job.status)}
                      <span className="font-medium text-gray-200">{job.name}</span>
                    </div>
                    <div className="flex gap-1">
                      {job.status === 'pending' && (
                        <button
                          onClick={() => handleStartJob(job.id)}
                          className="p-1 bg-green-600 hover:bg-green-500 text-white rounded"
                          title="Start Job"
                        >
                          <Play size={12} />
                        </button>
                      )}
                      {job.status === 'running' && (
                        <button
                          onClick={() => handleCancelJob(job.id)}
                          className="p-1 bg-red-600 hover:bg-red-500 text-white rounded"
                          title="Cancel Job"
                        >
                          <Square size={12} />
                        </button>
                      )}
                      {(job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') && (
                        <button
                          onClick={() => handleRemoveJob(job.id)}
                          className="p-1 bg-gray-600 hover:bg-gray-500 text-white rounded"
                          title="Remove Job"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-2">
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>{job.progress.current} / {job.progress.total} images</span>
                      {job.status === 'running' && job.progress.estimatedTimeRemaining && (
                        <span>~{formatTime(job.progress.estimatedTimeRemaining)} remaining</span>
                      )}
                    </div>
                    <div className="w-full bg-gray-600 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-300 ${
                          job.status === 'completed' ? 'bg-green-500' :
                          job.status === 'failed' ? 'bg-red-500' :
                          job.status === 'cancelled' ? 'bg-gray-500' :
                          'bg-blue-500'
                        }`}
                        style={{
                          width: `${(job.progress.current / job.progress.total) * 100}%`
                        }}
                      />
                    </div>
                  </div>

                  {/* Current Image */}
                  {job.status === 'running' && job.progress.currentImageName && (
                    <div className="text-xs text-gray-400 mb-2">
                      Processing: {job.progress.currentImageName}
                    </div>
                  )}

                  {/* Results Summary */}
                  {job.results.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="text-green-400">
                        ✓ {job.results.filter(r => r.success).length} successful
                      </div>
                      <div className="text-red-400">
                        ✗ {job.results.filter(r => !r.success).length} failed
                      </div>
                      <div className="text-gray-400">
                        ⏱ {formatTime(job.results.reduce((sum, r) => sum + r.processingTime, 0))}
                      </div>
                    </div>
                  )}

                  {/* Errors */}
                  {job.errors.length > 0 && (
                    <div className="mt-2 p-2 bg-red-900/20 border border-red-500/30 rounded">
                      <div className="text-xs text-red-300 font-medium">Errors:</div>
                      <div className="text-xs text-red-400 mt-1">
                        {job.errors.slice(0, 3).map((error, i) => (
                          <div key={i}>• {error}</div>
                        ))}
                        {job.errors.length > 3 && (
                          <div>... and {job.errors.length - 3} more</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderCreateTab = () => (
    <div className="space-y-4">
      {/* Job Name */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-300">Job Name</label>
        <input
          type="text"
          value={jobName}
          onChange={(e) => setJobName(e.target.value)}
          placeholder="Leave empty for auto-generated name"
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
        />
      </div>

      {/* Image Selection */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-sm font-medium text-gray-300">Images to Process</label>
          <button
            onClick={onSelectImages}
            className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded"
          >
            <FolderOpen size={12} />
            Select Images
          </button>
        </div>

        <div className="p-3 bg-gray-700 rounded min-h-[100px]">
          {selectedImages.length === 0 ? (
            <div className="text-center text-gray-400 py-4">
              <Image size={24} className="mx-auto mb-2 opacity-50" />
              <div className="text-sm">No images selected</div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm text-gray-300">
                {selectedImages.length} images selected
              </div>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {selectedImages.slice(0, 10).map((image, i) => (
                  <div key={i} className="flex justify-between items-center text-xs">
                    <span className="text-gray-300 truncate">{image.name}</span>
                    <span className="text-gray-400">{formatFileSize(image.size || 0)}</span>
                  </div>
                ))}
                {selectedImages.length > 10 && (
                  <div className="text-xs text-gray-400">
                    ... and {selectedImages.length - 10} more
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Preset Selection */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-300">Processing Preset</label>
        <div className="space-y-2">
          {presets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => setSelectedPreset(preset.id)}
              className={`w-full text-left p-3 rounded border transition-colors ${
                selectedPreset === preset.id
                  ? 'border-blue-500 bg-blue-600/20'
                  : 'border-gray-600 bg-gray-700 hover:bg-gray-600'
              }`}
            >
              <div className="font-medium text-gray-200">{preset.name}</div>
              <div className="text-xs text-gray-400">{preset.description}</div>
              <div className="text-xs text-gray-500 mt-1">
                Format: {preset.exportOptions.format?.toUpperCase()} •
                {preset.exportOptions.width && preset.exportOptions.height ?
                  ` ${preset.exportOptions.width}×${preset.exportOptions.height}` :
                  ' Original size'
                }
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Create Button */}
      <div className="pt-4">
        <button
          onClick={handleCreateJob}
          disabled={!selectedPreset || selectedImages.length === 0}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors"
        >
          <Plus size={16} />
          Create and Start Batch Job
        </button>
      </div>
    </div>
  );

  const renderSettingsTab = () => {
    const statistics = batchProcessingService.getStatistics();

    return (
      <div className="space-y-4">
        {/* Performance Settings */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-gray-300">Performance Settings</h4>

          <SliderControl
            label="Max Concurrent Jobs"
            value={2} // Default value, would need to track this in service
            min={1}
            max={5}
            step={1}
            onChange={(value: number) => batchProcessingService.setMaxConcurrentJobs(value)}
            className="text-sm"
            description="Higher values use more system resources"
          />
        </div>

        {/* Statistics */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-gray-300">Statistics</h4>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-700 rounded p-3">
              <div className="text-sm font-medium text-gray-200">Total Images Processed</div>
              <div className="text-lg text-blue-400">{statistics.totalImagesProcessed}</div>
            </div>
            <div className="bg-gray-700 rounded p-3">
              <div className="text-sm font-medium text-gray-200">Average Processing Time</div>
              <div className="text-lg text-green-400">
                {statistics.averageProcessingTime > 0
                  ? formatTime(statistics.averageProcessingTime)
                  : 'N/A'
                }
              </div>
            </div>
            <div className="bg-gray-700 rounded p-3">
              <div className="text-sm font-medium text-gray-200">Completed Jobs</div>
              <div className="text-lg text-green-400">{statistics.completedJobs}</div>
            </div>
            <div className="bg-gray-700 rounded p-3">
              <div className="text-sm font-medium text-gray-200">Failed Jobs</div>
              <div className="text-lg text-red-400">{statistics.failedJobs}</div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-gray-300">Actions</h4>

          <div className="space-y-2">
            <button
              onClick={() => batchProcessingService.clearCompletedJobs()}
              className="w-full px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded transition-colors"
            >
              Clear All Completed Jobs
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Settings size={20} className="text-blue-400" />
            <h2 className="text-lg font-semibold text-gray-200">Batch Processing</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Tab Navigation */}
          <div className="w-48 border-r border-gray-700 bg-gray-850">
            <div className="p-3">
              <nav className="space-y-1">
                {[
                  { key: 'jobs', label: 'Active Jobs', icon: Play },
                  { key: 'create', label: 'Create Job', icon: Plus },
                  { key: 'settings', label: 'Settings', icon: Settings }
                ].map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key as TabType)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded text-left text-sm transition-colors ${
                      activeTab === key
                        ? 'bg-blue-600/20 text-blue-400'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                    }`}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              </nav>
            </div>
          </div>

          {/* Tab Content */}
          <div className="flex-1 p-4 overflow-y-auto">
            {activeTab === 'jobs' && renderJobsTab()}
            {activeTab === 'create' && renderCreateTab()}
            {activeTab === 'settings' && renderSettingsTab()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BatchProcessingDialog;