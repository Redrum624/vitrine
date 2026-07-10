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
  FolderOpen
} from 'lucide-react';
import { GlassModal } from './GlassModal';
import { ChipButton } from '../Controls/ChipButton';
import { AccentButton } from '../Controls/AccentButton';
import { SectionLabel } from '../Controls/SectionLabel';
import { SliderRow } from '../Controls/SliderRow';
import { inputStyle, statBoxStyle } from './glassFormStyles';
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
        return <Clock size={16} style={{ color: 'var(--glass-text-muted)' }} />;
      case 'running':
        return <Loader size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />;
      case 'completed':
        return <CheckCircle size={16} style={{ color: 'var(--glass-text-label)' }} />;
      case 'failed':
        return <XCircle size={16} style={{ color: 'var(--glass-text-muted)' }} />;
      case 'cancelled':
        return <Square size={16} style={{ color: 'var(--glass-text-muted)' }} />;
      default:
        return null;
    }
  };

  const renderJobsTab = () => {
    const statistics = batchProcessingService.getStatistics();

    return (
      <div className="space-y-6">
        {/* Statistics */}
        <div className="grid grid-cols-3 gap-3">
          <div style={statBoxStyle}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--glass-text-title)' }}>{statistics.totalJobs}</div>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--glass-text-muted)' }}>Total Jobs</div>
          </div>
          <div style={statBoxStyle}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--glass-text-title)' }}>{statistics.activeJobs}</div>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--glass-text-muted)' }}>Active Jobs</div>
          </div>
          <div style={statBoxStyle}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--glass-text-title)' }}>{statistics.totalImagesProcessed}</div>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--glass-text-muted)' }}>Images Processed</div>
          </div>
        </div>

        {/* Jobs List */}
        <div className="space-y-3">
          <div className="flex items-center mb-2" style={{ gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SectionLabel>Batch Jobs</SectionLabel>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <ChipButton onClick={() => batchProcessingService.clearCompletedJobs()}>Clear Completed</ChipButton>
              <ChipButton onClick={refreshJobs}>Refresh</ChipButton>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto space-y-2 pr-2">
            {jobs.length === 0 ? (
              <div className="text-center py-8" style={{ color: 'var(--glass-text-muted)' }}>
                <Image size={24} className="mx-auto mb-2 opacity-50" />
                <div style={{ fontSize: 12.5 }}>No batch jobs yet</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>Create a job to get started</div>
              </div>
            ) : (
              jobs.map((job) => (
                <div key={job.id} style={statBoxStyle}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(job.status)}
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--glass-text-title)' }}>{job.name}</span>
                    </div>
                    <div className="flex gap-1">
                      {job.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => handleStartJob(job.id)}
                          className="glass-pill-btn inline-flex items-center justify-center"
                          style={{ padding: 6, borderRadius: 7, border: '1px solid rgba(255,255,255,.1)', color: 'var(--glass-text-label)' }}
                          title="Start Job"
                        >
                          <Play size={12} />
                        </button>
                      )}
                      {job.status === 'running' && (
                        <button
                          type="button"
                          onClick={() => handleCancelJob(job.id)}
                          className="glass-pill-btn inline-flex items-center justify-center"
                          style={{ padding: 6, borderRadius: 7, border: '1px solid rgba(255,255,255,.1)', color: 'var(--glass-text-label)' }}
                          title="Cancel Job"
                        >
                          <Square size={12} />
                        </button>
                      )}
                      {(job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') && (
                        <button
                          type="button"
                          onClick={() => handleRemoveJob(job.id)}
                          className="glass-pill-btn inline-flex items-center justify-center"
                          style={{ padding: 6, borderRadius: 7, color: 'var(--glass-text-muted)' }}
                          title="Remove Job"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-2">
                    <div className="flex justify-between mb-1" style={{ fontSize: 11, color: 'var(--glass-text-muted)' }}>
                      <span>{job.progress.current} / {job.progress.total} images</span>
                      {job.status === 'running' && job.progress.estimatedTimeRemaining && (
                        <span>~{formatTime(job.progress.estimatedTimeRemaining)} remaining</span>
                      )}
                    </div>
                    <div style={{ position: 'relative', height: 5 }}>
                      <div
                        aria-hidden="true"
                        style={{ position: 'absolute', inset: 0, borderRadius: 3, background: 'rgba(255,255,255,.09)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,.6)' }}
                      />
                      <div
                        aria-hidden="true"
                        style={{
                          position: 'absolute', inset: 0, borderRadius: 3,
                          width: `${(job.progress.current / job.progress.total) * 100}%`,
                          background: 'var(--accent)', transition: 'width 300ms ease',
                        }}
                      />
                    </div>
                  </div>

                  {/* Current Image */}
                  {job.status === 'running' && job.progress.currentImageName && (
                    <div className="mb-2" style={{ fontSize: 11, color: 'var(--glass-text-muted)' }}>
                      Processing: {job.progress.currentImageName}
                    </div>
                  )}

                  {/* Results Summary */}
                  {job.results.length > 0 && (
                     <div className="grid grid-cols-3 gap-2" style={{ fontSize: 11, color: 'var(--glass-text-label)' }}>
                      <div>✓ {job.results.filter(r => r.success).length} successful</div>
                      <div>✗ {job.results.filter(r => !r.success).length} failed</div>
                      <div style={{ color: 'var(--glass-text-muted)' }}>⏱ {formatTime(job.results.reduce((sum, r) => sum + r.processingTime, 0))}</div>
                    </div>
                  )}

                  {/* Errors */}
                  {job.errors.length > 0 && (
                    <div className="mt-2" style={{ padding: 8, borderRadius: 8, background: 'rgba(0,0,0,.3)', border: '1px solid var(--glass-border)' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--glass-text-label)' }}>Errors:</div>
                      <div className="space-y-1 mt-1" style={{ fontSize: 11, color: 'var(--glass-text-muted)' }}>
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
        <SectionLabel>Job Name</SectionLabel>
        <input
          type="text"
          value={jobName}
          onChange={(e) => setJobName(e.target.value)}
          placeholder="Leave empty for auto-generated name"
          style={inputStyle}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center" style={{ gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <SectionLabel>Images to Process</SectionLabel>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {availableImages.length > 0 && (
              <ChipButton onClick={() => onSelectedImagesChange(mergeUnique(selectedImages, availableImages))}>
                <Plus size={12} style={{ marginRight: 6 }} />
                Add Open Images
              </ChipButton>
            )}
            <ChipButton onClick={onSelectImages}>
              <FolderOpen size={12} style={{ marginRight: 6 }} />
              Select Images
            </ChipButton>
          </div>
        </div>

        <div style={{ ...statBoxStyle, minHeight: 100 }}>
          {selectedImages.length === 0 ? (
            <div className="text-center py-4" style={{ color: 'var(--glass-text-muted)' }}>
              <Image size={24} className="mx-auto mb-2 opacity-50" />
              <div style={{ fontSize: 12.5 }}>No images selected</div>
            </div>
          ) : (
            <div className="space-y-2">
              <div style={{ fontSize: 12.5, color: 'var(--glass-text-label)' }}>
                {selectedImages.length} images selected
              </div>
              <div className="max-h-32 overflow-y-auto space-y-1 pr-2">
                {selectedImages.slice(0, 10).map((image, i) => (
                  <div key={i} className="flex justify-between items-center" style={{ fontSize: 11 }}>
                    <span className="truncate" style={{ color: 'var(--glass-text-label)' }}>{image.name}</span>
                    <span style={{ color: 'var(--glass-text-muted)' }}>{formatFileSize(image.size || 0)}</span>
                  </div>
                ))}
                {selectedImages.length > 10 && (
                  <div style={{ fontSize: 11, color: 'var(--glass-text-muted)' }}>
                    ... and {selectedImages.length - 10} more
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <SectionLabel>Processing Preset</SectionLabel>
        <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setSelectedPreset(preset.id)}
              data-active={selectedPreset === preset.id || undefined}
              className="glass-modal-card-btn w-full text-left"
              style={{ padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)' }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--glass-text-title)' }}>{preset.name}</div>
              <div style={{ fontSize: 11, marginTop: 2, color: 'var(--glass-text-muted)' }}>{preset.description}</div>
              <div style={{ fontSize: 10.5, marginTop: 6, color: 'var(--glass-text-muted)' }}>
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
        <AccentButton
          onClick={handleCreateJob}
          disabled={!selectedPreset || selectedImages.length === 0}
          fullWidth
          style={{ padding: 11 }}
        >
          <Plus size={15} />
          Create and Start Batch Job
        </AccentButton>
      </div>
    </div>
  );

  const renderSettingsTab = () => {
    const statistics = batchProcessingService.getStatistics();

    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <SectionLabel>Performance Settings</SectionLabel>
          <SliderRow
            label="Max Concurrent Jobs"
            value={2}
            // BatchProcessingService.maxConcurrentJobs defaults to 2 — matches the
            // hardcoded `value` above (this dialog doesn't read the service's live
            // setting back, so both stay in lockstep with the service default).
            defaultValue={2}
            min={1}
            max={5}
            step={1}
            onChange={(value: number) => batchProcessingService.setMaxConcurrentJobs(value)}
          />
          <div style={{ fontSize: 11, color: 'var(--glass-text-muted)' }}>
            Higher values use more system resources
          </div>
        </div>

        <div className="space-y-3">
          <SectionLabel>Statistics</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <div style={statBoxStyle}>
              <div style={{ fontSize: 11, marginBottom: 4, color: 'var(--glass-text-muted)' }}>Total Images Processed</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--glass-text-title)' }}>{statistics.totalImagesProcessed}</div>
            </div>
            <div style={statBoxStyle}>
              <div style={{ fontSize: 11, marginBottom: 4, color: 'var(--glass-text-muted)' }}>Avg Processing Time</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--glass-text-title)' }}>
                {statistics.averageProcessingTime > 0 ? formatTime(statistics.averageProcessingTime) : 'N/A'}
              </div>
            </div>
            <div style={statBoxStyle}>
              <div style={{ fontSize: 11, marginBottom: 4, color: 'var(--glass-text-muted)' }}>Completed Jobs</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--glass-text-title)' }}>{statistics.completedJobs}</div>
            </div>
            <div style={statBoxStyle}>
              <div style={{ fontSize: 11, marginBottom: 4, color: 'var(--glass-text-muted)' }}>Failed Jobs</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--glass-text-title)' }}>{statistics.failedJobs}</div>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <SectionLabel>Actions</SectionLabel>
          <div className="space-y-2">
            <ChipButton onClick={() => batchProcessingService.clearCompletedJobs()} className="w-full">
              Clear All Completed Jobs
            </ChipButton>
          </div>
        </div>
      </div>
    );
  };

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      icon={<Settings size={15} />}
      title="Batch Processing"
      cardClassName="w-full max-w-4xl h-4/5"
      cardStyle={{ maxHeight: '80vh' }}
      scrollBody={false}
    >
      <div className="flex flex-1 overflow-hidden">
        {/* Tab Navigation */}
        <div className="flex-shrink-0" style={{ width: 192, borderRight: '1px solid var(--glass-border)', padding: 14 }}>
          <nav className="flex flex-col" style={{ gap: 4 }}>
            {[
              { key: 'jobs', label: 'Active Jobs', icon: Play },
              { key: 'create', label: 'Create Job', icon: Plus },
              { key: 'settings', label: 'Settings', icon: Settings }
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key as TabType)}
                data-active={activeTab === key || undefined}
                className="glass-modal-tab w-full flex items-center gap-2"
                style={{
                  padding: '8px 10px', borderRadius: 9, fontSize: 12, textAlign: 'left',
                  border: '1px solid transparent', color: 'var(--glass-text-secondary)',
                }}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '20px 24px' }}>
          {activeTab === 'jobs' && renderJobsTab()}
          {activeTab === 'create' && renderCreateTab()}
          {activeTab === 'settings' && renderSettingsTab()}
        </div>
      </div>
    </GlassModal>
  );
};

export default BatchProcessingDialog;
