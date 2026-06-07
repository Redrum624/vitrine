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
  selectedImages: ImageFileInfo[];
  onSelectedImagesChange: (imgs: ImageFileInfo[]) => void;
  onSelectImages: () => void;
}

type TabType = 'jobs' | 'create' | 'settings';

// Dedupe two ImageFileInfo lists by their file path.
const mergeUnique = (existing: ImageFileInfo[], incoming: ImageFileInfo[]): ImageFileInfo[] => {
  const seen = new Set(existing.map((img) => img.path));
  const merged = [...existing];
  for (const img of incoming) {
    if (!seen.has(img.path)) {
      seen.add(img.path);
      merged.push(img);
    }
  }
  return merged;
};

export const BatchProcessingDialog: React.FC<BatchProcessingDialogProps> = ({
  isOpen,
  onClose,
  availableImages,
  selectedImages,
  onSelectedImagesChange,
  onSelectImages
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('jobs');
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [presets, setPresets] = useState<BatchPreset[]>([]);
  const [jobName, setJobName] = useState('');
  const [refreshInterval, setRefreshInterval] = useState<number>();

  useEffect(() => {
    if (isOpen) {
      setPresets(batchProcessingService.getPresets());
      refreshJobs();

      const interval = window.setInterval(refreshJobs, 1000);
      setRefreshInterval(interval);

      return () => {
        if (interval) window.clearInterval(interval);
      };
    }
  }, [isOpen]);

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
      batchProcessingService.startBatchJob(jobId);
      setJobName('');
      onSelectedImagesChange([]);
      setSelectedPreset('');
      setActiveTab('jobs');
      refreshJobs();
    }
  }, [selectedPreset, selectedImages, jobName, refreshJobs, onSelectedImagesChange]);

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
        return <Clock size={16} style={{ color: 'var(--gray-400)' }} />;
      case 'running':
        return <Loader size={16} className="animate-spin" style={{ color: 'var(--gray-300)' }} />;
      case 'completed':
        return <CheckCircle size={16} style={{ color: 'var(--gray-300)' }} />;
      case 'failed':
        return <XCircle size={16} style={{ color: 'var(--gray-400)' }} />;
      case 'cancelled':
        return <Square size={16} style={{ color: 'var(--gray-500)' }} />;
      default:
        return null;
    }
  };

  const renderJobsTab = () => {
    const statistics = batchProcessingService.getStatistics();

    return (
      <div className="space-y-6">
        {/* Statistics */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded p-3 border" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}>
            <div className="text-lg font-semibold" style={{ color: 'var(--gray-200)' }}>{statistics.totalJobs}</div>
            <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Total Jobs</div>
          </div>
          <div className="rounded p-3 border" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}>
            <div className="text-lg font-semibold" style={{ color: 'var(--gray-200)' }}>{statistics.activeJobs}</div>
            <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Active Jobs</div>
          </div>
          <div className="rounded p-3 border" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}>
            <div className="text-lg font-semibold" style={{ color: 'var(--gray-200)' }}>{statistics.totalImagesProcessed}</div>
            <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Images Processed</div>
          </div>
        </div>

        {/* Jobs List */}
        <div className="space-y-3">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Batch Jobs</h3>
            <div className="flex gap-2">
              <button
                onClick={() => batchProcessingService.clearCompletedJobs()}
                className="px-3 py-1.5 text-xs rounded border"
                style={{ backgroundColor: 'transparent', borderColor: 'var(--border)', color: 'var(--gray-300)' }}
              >
                Clear Completed
              </button>
              <button
                onClick={refreshJobs}
                className="px-3 py-1.5 text-xs rounded border"
                style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto space-y-2 pr-2">
            {jobs.length === 0 ? (
              <div className="text-center py-8" style={{ color: 'var(--gray-500)' }}>
                <Image size={24} className="mx-auto mb-2 opacity-50" />
                <div className="text-sm">No batch jobs yet</div>
                <div className="text-xs mt-1">Create a job to get started</div>
              </div>
            ) : (
              jobs.map((job) => (
                <div key={job.id} className="rounded p-3 border" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(job.status)}
                      <span className="text-sm font-semibold" style={{ color: 'var(--gray-200)' }}>{job.name}</span>
                    </div>
                    <div className="flex gap-1">
                      {job.status === 'pending' && (
                        <button
                          onClick={() => handleStartJob(job.id)}
                          className="p-1 rounded border"
                          style={{ backgroundColor: 'var(--gray-900)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}
                          title="Start Job"
                        >
                          <Play size={12} />
                        </button>
                      )}
                      {job.status === 'running' && (
                        <button
                          onClick={() => handleCancelJob(job.id)}
                          className="p-1 rounded border"
                          style={{ backgroundColor: 'var(--gray-900)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}
                          title="Cancel Job"
                        >
                          <Square size={12} />
                        </button>
                      )}
                      {(job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') && (
                        <button
                          onClick={() => handleRemoveJob(job.id)}
                          className="p-1 rounded border"
                          style={{ backgroundColor: 'transparent', borderColor: 'transparent', color: 'var(--gray-400)' }}
                          title="Remove Job"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-2">
                    <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--gray-400)' }}>
                      <span>{job.progress.current} / {job.progress.total} images</span>
                      {job.status === 'running' && job.progress.estimatedTimeRemaining && (
                        <span>~{formatTime(job.progress.estimatedTimeRemaining)} remaining</span>
                      )}
                    </div>
                    <div className="w-full rounded-full h-1.5" style={{ backgroundColor: 'var(--gray-900)' }}>
                      <div
                        className="h-1.5 rounded-full transition-all duration-300"
                        style={{
                          backgroundColor: 'var(--gray-400)',
                          width: `${(job.progress.current / job.progress.total) * 100}%`
                        }}
                      />
                    </div>
                  </div>

                  {/* Current Image */}
                  {job.status === 'running' && job.progress.currentImageName && (
                    <div className="text-xs mb-2" style={{ color: 'var(--gray-400)' }}>
                      Processing: {job.progress.currentImageName}
                    </div>
                  )}

                  {/* Results Summary */}
                  {job.results.length > 0 && (
                     <div className="grid grid-cols-3 gap-2 text-xs" style={{ color: 'var(--gray-300)' }}>
                      <div>✓ {job.results.filter(r => r.success).length} successful</div>
                      <div>✗ {job.results.filter(r => !r.success).length} failed</div>
                      <div style={{ color: 'var(--gray-400)' }}>⏱ {formatTime(job.results.reduce((sum, r) => sum + r.processingTime, 0))}</div>
                    </div>
                  )}

                  {/* Errors */}
                  {job.errors.length > 0 && (
                    <div className="mt-2 p-2 rounded border" style={{ backgroundColor: 'var(--gray-900)', borderColor: 'var(--border)' }}>
                      <div className="text-xs font-semibold" style={{ color: 'var(--gray-300)' }}>Errors:</div>
                      <div className="text-xs mt-1 space-y-1" style={{ color: 'var(--gray-400)' }}>
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
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Job Name</label>
        <input
          type="text"
          value={jobName}
          onChange={(e) => setJobName(e.target.value)}
          placeholder="Leave empty for auto-generated name"
          className="w-full px-2 py-1.5 text-sm rounded border focus:outline-none"
          style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-200)' }}
        />
      </div>

      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Images to Process</label>
          <div className="flex gap-2">
            {availableImages.length > 0 && (
              <button
                onClick={() => onSelectedImagesChange(mergeUnique(selectedImages, availableImages))}
                className="flex items-center gap-1 px-3 py-1.5 rounded border text-xs"
                style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}
              >
                <Plus size={12} />
                Add Open Images
              </button>
            )}
            <button
              onClick={onSelectImages}
              className="flex items-center gap-1 px-3 py-1.5 rounded border text-xs"
              style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}
            >
              <FolderOpen size={12} />
              Select Images
            </button>
          </div>
        </div>

        <div className="p-3 rounded border min-h-[100px]" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}>
          {selectedImages.length === 0 ? (
            <div className="text-center py-4" style={{ color: 'var(--gray-500)' }}>
              <Image size={24} className="mx-auto mb-2 opacity-50" />
              <div className="text-sm">No images selected</div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm" style={{ color: 'var(--gray-300)' }}>
                {selectedImages.length} images selected
              </div>
              <div className="max-h-32 overflow-y-auto space-y-1 pr-2">
                {selectedImages.slice(0, 10).map((image, i) => (
                  <div key={i} className="flex justify-between items-center text-xs">
                    <span className="truncate" style={{ color: 'var(--gray-300)' }}>{image.name}</span>
                    <span style={{ color: 'var(--gray-400)' }}>{formatFileSize(image.size || 0)}</span>
                  </div>
                ))}
                {selectedImages.length > 10 && (
                  <div className="text-xs" style={{ color: 'var(--gray-400)' }}>
                    ... and {selectedImages.length - 10} more
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Processing Preset</label>
        <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
          {presets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => setSelectedPreset(preset.id)}
              className="w-full text-left p-3 rounded border transition-colors"
              style={{
                backgroundColor: selectedPreset === preset.id ? 'var(--gray-700)' : 'var(--gray-800)',
                borderColor: selectedPreset === preset.id ? 'var(--gray-500)' : 'var(--border)'
              }}
            >
              <div className="text-sm font-semibold" style={{ color: 'var(--gray-200)' }}>{preset.name}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--gray-400)' }}>{preset.description}</div>
              <div className="text-xs mt-1.5" style={{ color: 'var(--gray-500)' }}>
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

      <div className="pt-2">
        <button
          onClick={handleCreateJob}
          disabled={!selectedPreset || selectedImages.length === 0}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded border transition-colors disabled:opacity-50"
          style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}
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
      <div className="space-y-6">
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Performance Settings</h3>
          <SliderControl
            label="Max Concurrent Jobs"
            value={2}
            min={1}
            max={5}
            step={1}
            onChange={(value: number) => batchProcessingService.setMaxConcurrentJobs(value)}
            className="text-sm"
            description="Higher values use more system resources"
          />
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Statistics</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded p-3 border" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}>
              <div className="text-xs mb-1" style={{ color: 'var(--gray-400)' }}>Total Images Processed</div>
              <div className="text-sm font-semibold" style={{ color: 'var(--gray-200)' }}>{statistics.totalImagesProcessed}</div>
            </div>
            <div className="rounded p-3 border" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}>
              <div className="text-xs mb-1" style={{ color: 'var(--gray-400)' }}>Avg Processing Time</div>
              <div className="text-sm font-semibold" style={{ color: 'var(--gray-200)' }}>
                {statistics.averageProcessingTime > 0 ? formatTime(statistics.averageProcessingTime) : 'N/A'}
              </div>
            </div>
            <div className="rounded p-3 border" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}>
              <div className="text-xs mb-1" style={{ color: 'var(--gray-400)' }}>Completed Jobs</div>
              <div className="text-sm font-semibold" style={{ color: 'var(--gray-200)' }}>{statistics.completedJobs}</div>
            </div>
            <div className="rounded p-3 border" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}>
              <div className="text-xs mb-1" style={{ color: 'var(--gray-400)' }}>Failed Jobs</div>
              <div className="text-sm font-semibold" style={{ color: 'var(--gray-200)' }}>{statistics.failedJobs}</div>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>Actions</h3>
          <div className="space-y-2">
            <button
              onClick={() => batchProcessingService.clearCompletedJobs()}
              className="w-full px-3 py-2 text-sm rounded border transition-colors"
              style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}
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
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
      <div className="rounded-lg shadow-xl w-full max-w-4xl h-4/5 max-h-[80vh] flex flex-col" style={{ backgroundColor: 'var(--gray-900)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderBottomColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Settings size={18} style={{ color: 'var(--gray-300)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--white)' }}>Batch Processing</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded transition-colors"
            style={{ color: 'var(--gray-400)' }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Tab Navigation */}
          <div className="w-48 border-r" style={{ borderRightColor: 'var(--border)' }}>
            <div className="p-4">
              <nav className="space-y-1">
                {[
                  { key: 'jobs', label: 'Active Jobs', icon: Play },
                  { key: 'create', label: 'Create Job', icon: Plus },
                  { key: 'settings', label: 'Settings', icon: Settings }
                ].map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key as TabType)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded text-left text-sm transition-colors"
                    style={{
                      backgroundColor: activeTab === key ? 'var(--gray-800)' : 'transparent',
                      color: activeTab === key ? 'var(--white)' : 'var(--gray-400)'
                    }}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              </nav>
            </div>
          </div>

          {/* Tab Content */}
          <div className="flex-1 px-6 py-5 overflow-y-auto">
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