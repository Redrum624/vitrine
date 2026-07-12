import { logger } from '../utils/Logger';
import { imageService } from './ImageService';
import { imageProcessingPipeline } from './ImageProcessingPipeline';
import { exportService, ExportOptions } from './ExportService';
import { ImageFileInfo } from './FileSystemService';

interface ModuleParameters {
  [key: string]: unknown;
}

interface ModuleInterface {
  getParameters?(): ModuleParameters;
  getParams?(): ModuleParameters;
  setParameters?(params: ModuleParameters): void;
  setParams?(params: ModuleParameters): void;
}

export interface BatchJob {
  id: string;
  name: string;
  images: ImageFileInfo[];
  processingSettings: BatchProcessingSettings;
  exportOptions: Partial<ExportOptions>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: {
    current: number;
    total: number;
    currentImageName?: string;
    startTime?: number;
    estimatedTimeRemaining?: number;
  };
  results: BatchJobResult[];
  errors: string[];
}

export interface BatchProcessingSettings {
  // Which modules to apply (if empty, apply all current settings)
  moduleSettings?: Record<string, ModuleParameters>;

  // Processing options
  useCurrentAdjustments: boolean;
  preserveOriginalSettings: boolean;

  // Quality settings
  processInBackground: boolean;
  maxConcurrentJobs: number;

  // Output naming
  outputSuffix: string;
  outputDirectory?: string;
}

export interface BatchJobResult {
  imageId: string;
  imageName: string;
  success: boolean;
  outputPath?: string;
  processingTime: number;
  error?: string;
  originalSize?: number;
  outputSize?: number;
}

export interface BatchPreset {
  id: string;
  name: string;
  description: string;
  processingSettings: BatchProcessingSettings;
  exportOptions: Partial<ExportOptions>;
}

export class BatchProcessingService {
  private jobs: Map<string, BatchJob> = new Map();
  private activeJobs: Set<string> = new Set();
  private maxConcurrentJobs = 2;
  private jobQueue: string[] = [];

  private readonly builtinPresets: BatchPreset[] = [
    {
      id: 'web_resize',
      name: 'Web Resize Batch',
      description: 'Resize images for web publishing with current adjustments',
      processingSettings: {
        useCurrentAdjustments: true,
        preserveOriginalSettings: false,
        processInBackground: true,
        maxConcurrentJobs: 2,
        outputSuffix: '_web'
      },
      exportOptions: {
        format: 'jpeg',
        quality: 90,
        width: 1920,
        height: 1920,
        resizeMode: 'fit',
        colorSpace: 'srgb',
        outputSharpening: {
          enabled: true,
          media: 'web',
          amount: 60,
          radius: 1.0,
          threshold: 4
        }
      }
    },
    {
      id: 'print_batch',
      name: 'Print Preparation',
      description: 'High-quality processing for printing with output sharpening',
      processingSettings: {
        useCurrentAdjustments: true,
        preserveOriginalSettings: true,
        processInBackground: false,
        maxConcurrentJobs: 1,
        outputSuffix: '_print'
      },
      exportOptions: {
        format: 'tiff',
        compression: 'lzw',
        colorSpace: 'adobergb',
        bitDepth: 16,
        outputSharpening: {
          enabled: true,
          media: 'print',
          amount: 40,
          radius: 1.2,
          threshold: 6
        }
      }
    },
    {
      id: 'social_media',
      name: 'Social Media Batch',
      description: 'Square crop and optimize for social media platforms',
      processingSettings: {
        useCurrentAdjustments: true,
        preserveOriginalSettings: false,
        processInBackground: true,
        maxConcurrentJobs: 3,
        outputSuffix: '_social'
      },
      exportOptions: {
        format: 'jpeg',
        quality: 95,
        width: 1080,
        height: 1080,
        resizeMode: 'crop',
        colorSpace: 'srgb',
        outputSharpening: {
          enabled: true,
          media: 'web',
          amount: 70,
          radius: 0.8,
          threshold: 3
        }
      }
    },
    {
      id: 'archive_batch',
      name: 'Archive Processing',
      description: 'High-quality archival processing with metadata preservation',
      processingSettings: {
        useCurrentAdjustments: true,
        preserveOriginalSettings: true,
        processInBackground: false,
        maxConcurrentJobs: 1,
        outputSuffix: '_archive'
      },
      exportOptions: {
        format: 'tiff',
        compression: 'lzw',
        colorSpace: 'prophoto',
        bitDepth: 16,
        preserveMetadata: true,
        includeProcessingHistory: true,
        outputSharpening: {
          enabled: false,
          amount: 50,
          radius: 1.0,
          threshold: 0,
          media: 'screen'
        }
      }
    }
  ];

  // Create a new batch job
  createBatchJob(
    name: string,
    images: ImageFileInfo[],
    processingSettings: BatchProcessingSettings,
    exportOptions: Partial<ExportOptions>
  ): string {
    const jobId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const job: BatchJob = {
      id: jobId,
      name,
      images: [...images],
      processingSettings,
      exportOptions,
      status: 'pending',
      progress: {
        current: 0,
        total: images.length
      },
      results: [],
      errors: []
    };

    this.jobs.set(jobId, job);
    logger.info(`Created batch job: ${name} with ${images.length} images`);

    return jobId;
  }

  // Start processing a batch job
  async startBatchJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) {
      logger.error(`Batch job not found: ${jobId}`);
      return false;
    }

    if (job.status !== 'pending') {
      logger.warn(`Batch job ${jobId} is not in pending state: ${job.status}`);
      return false;
    }

    // Check concurrent job limits
    if (this.activeJobs.size >= this.maxConcurrentJobs) {
      this.jobQueue.push(jobId);
      logger.info(`Batch job ${jobId} queued (${this.activeJobs.size}/${this.maxConcurrentJobs} active)`);
      return true;
    }

    return this.executeBatchJob(jobId);
  }

  // Execute a batch job
  private async executeBatchJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    this.activeJobs.add(jobId);
    job.status = 'running';
    job.progress.startTime = Date.now();

    logger.info(`Starting batch job: ${job.name} (${job.images.length} images)`);

    try {
      // Capture current pipeline settings if needed
      let pipelineSettings: Record<string, ModuleParameters> | null = null;
      if (job.processingSettings.useCurrentAdjustments) {
        pipelineSettings = this.capturePipelineSettings();
      }

      // Process each image
      for (let i = 0; i < job.images.length; i++) {
        if ((job.status as string) === 'cancelled') {
          logger.info(`Batch job ${jobId} was cancelled`);
          break;
        }

        const image = job.images[i];
        job.progress.current = i;
        job.progress.currentImageName = image.name;

        // Update estimated time remaining
        if (i > 0 && job.progress.startTime) {
          const elapsed = Date.now() - job.progress.startTime;
          const avgTimePerImage = elapsed / i;
          job.progress.estimatedTimeRemaining = avgTimePerImage * (job.images.length - i);
        }

        const result = await this.processImage(image, job, pipelineSettings);
        job.results.push(result);

        if (!result.success) {
          job.errors.push(`Failed to process ${image.name}: ${result.error}`);
        }

        // Brief pause to prevent overwhelming the system
        if (!job.processingSettings.processInBackground) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // Mark as completed
      if ((job.status as string) !== 'cancelled') {
        job.status = 'completed';
      }
      job.progress.current = job.images.length;

      const successful = job.results.filter(r => r.success).length;
      const failed = job.results.filter(r => !r.success).length;

      logger.info(`Batch job ${jobId} completed: ${successful} successful, ${failed} failed`);

      // Start next job in queue
      this.activeJobs.delete(jobId);
      this.processQueue();

      return job.status === 'completed';

    } catch (error) {
      job.status = 'failed';
      job.errors.push(`Batch job failed: ${error}`);
      logger.error(`Batch job ${jobId} failed:`, error);

      this.activeJobs.delete(jobId);
      this.processQueue();

      return false;
    }
  }

  // Process a single image within a batch job
  private async processImage(
    image: ImageFileInfo,
    job: BatchJob,
    pipelineSettings: Record<string, ModuleParameters> | null
  ): Promise<BatchJobResult> {
    const startTime = Date.now();

    try {
      logger.debug(`Processing batch image: ${image.name}`);

      // Decode the image via the side-effect-free export decode (NOT loadImage). This gives the
      // batch three things loadImage did NOT:
      //   1. PER-IMAGE decode options — decodeForExport resolves each file's own persisted RAW
      //      options (EditPersistenceService.getSavedRawDecodeOptions, shape-validated) instead of
      //      the STORE's current options (which belong to whatever image the user has open). A
      //      batch of RAWs with different demosaic/highlight settings now each decode with THEIR own.
      //   2. No editor side effects — it never sets currentImage / fires notifyImageLoaded, so a
      //      batch run no longer swaps the user's open image out from under them per file.
      //   3. interactive=false disk behaviour — decodeForExport decodes with interactive=false, so a
      //      one-shot batch decode never write-through-churns the disk base-cache LRU (disk READS
      //      still apply — a coherent, free win if a prior interactive open persisted it).
      const imageData = await imageService.decodeForExport(image.path);

      // Apply pipeline settings if specified
      let processedData = imageData.data;
      if (pipelineSettings) {
        // Apply the captured settings
        this.applyPipelineSettings(pipelineSettings);

        // Process through the pipeline (full-res: skip the module cache so
        // batch runs don't park huge Float32 copies in memory)
        processedData = await imageProcessingPipeline.processImage(imageData.data, {
          width: imageData.width,
          height: imageData.height,
          channels: 4
        }, { cacheResults: false });
      }

      // Export the processed image
      const exportResult = await exportService.exportImage(
        processedData,
        imageData.width,
        imageData.height,
        {
          ...job.exportOptions,
          suffix: job.processingSettings.outputSuffix,
          outputDirectory: job.processingSettings.outputDirectory
        },
        image.path
      );

      const processingTime = Date.now() - startTime;

      if (exportResult.success) {
        return {
          imageId: image.path,
          imageName: image.name,
          success: true,
          outputPath: exportResult.outputPath,
          processingTime,
          originalSize: image.size,
          outputSize: exportResult.outputSize
        };
      } else {
        return {
          imageId: image.path,
          imageName: image.name,
          success: false,
          processingTime,
          error: exportResult.error
        };
      }

    } catch (error) {
      const processingTime = Date.now() - startTime;

      return {
        imageId: image.path,
        imageName: image.name,
        success: false,
        processingTime,
        error: error instanceof Error ? error.message : 'Unknown processing error'
      };
    }
  }

  // Capture current pipeline settings
  private capturePipelineSettings(): Record<string, ModuleParameters> {
    const settings: Record<string, ModuleParameters> = {};

    // Get all pipeline modules and their current settings
    const modules = imageProcessingPipeline.getModules();
    for (const [moduleId, module] of modules) {
      try {
        const moduleInterface = module as ModuleInterface;
        if ('getParameters' in module && typeof moduleInterface.getParameters === 'function') {
          settings[moduleId] = moduleInterface.getParameters();
        } else if ('getParams' in module && typeof moduleInterface.getParams === 'function') {
          settings[moduleId] = moduleInterface.getParams();
        }
      } catch (error) {
        logger.warn(`Failed to capture settings for module ${moduleId}:`, error);
      }
    }

    logger.debug('Captured pipeline settings for batch processing');
    return settings;
  }

  // Apply captured pipeline settings
  private applyPipelineSettings(settings: Record<string, ModuleParameters>): void {
    const modules = imageProcessingPipeline.getModules();

    for (const [moduleId, moduleSettings] of Object.entries(settings)) {
      const module = modules.get(moduleId);
      if (!module) continue;

      try {
        const moduleInterface = module as ModuleInterface;
        if ('setParameters' in module && typeof moduleInterface.setParameters === 'function') {
          moduleInterface.setParameters(moduleSettings);
        } else if ('setParams' in module && typeof moduleInterface.setParams === 'function') {
          moduleInterface.setParams(moduleSettings);
        }
      } catch (error) {
        logger.warn(`Failed to apply settings for module ${moduleId}:`, error);
      }
    }
  }

  // Process job queue
  private processQueue(): void {
    while (this.jobQueue.length > 0 && this.activeJobs.size < this.maxConcurrentJobs) {
      const nextJobId = this.jobQueue.shift();
      if (nextJobId) {
        this.executeBatchJob(nextJobId);
      }
    }
  }

  // Cancel a batch job
  cancelBatchJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'pending') {
      // Remove from queue
      const queueIndex = this.jobQueue.indexOf(jobId);
      if (queueIndex > -1) {
        this.jobQueue.splice(queueIndex, 1);
      }
      job.status = 'cancelled';
    } else if (job.status === 'running') {
      // Mark for cancellation (will be checked in processing loop)
      job.status = 'cancelled';
    }

    logger.info(`Batch job ${jobId} cancelled`);
    return true;
  }

  // Remove a completed job
  removeJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'running') {
      logger.warn(`Cannot remove running job: ${jobId}`);
      return false;
    }

    this.jobs.delete(jobId);
    logger.info(`Batch job ${jobId} removed`);
    return true;
  }

  // Get all jobs
  getJobs(): BatchJob[] {
    return Array.from(this.jobs.values());
  }

  // Get job by ID
  getJob(jobId: string): BatchJob | undefined {
    return this.jobs.get(jobId);
  }

  // Get job status
  getJobStatus(jobId: string): BatchJob['status'] | null {
    const job = this.jobs.get(jobId);
    return job ? job.status : null;
  }

  // Get active jobs count
  getActiveJobsCount(): number {
    return this.activeJobs.size;
  }

  // Get queue length
  getQueueLength(): number {
    return this.jobQueue.length;
  }

  // Get built-in presets
  getPresets(): BatchPreset[] {
    return [...this.builtinPresets];
  }

  // Get preset by ID
  getPreset(presetId: string): BatchPreset | undefined {
    return this.builtinPresets.find(p => p.id === presetId);
  }

  // Create job from preset
  createJobFromPreset(
    presetId: string,
    name: string,
    images: ImageFileInfo[]
  ): string | null {
    const preset = this.getPreset(presetId);
    if (!preset) {
      logger.error(`Batch preset not found: ${presetId}`);
      return null;
    }

    return this.createBatchJob(
      name || preset.name,
      images,
      preset.processingSettings,
      preset.exportOptions
    );
  }

  // Get processing statistics
  getStatistics(): {
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
    activeJobs: number;
    queuedJobs: number;
    totalImagesProcessed: number;
    averageProcessingTime: number;
  } {
    const jobs = Array.from(this.jobs.values());
    const completedJobs = jobs.filter(j => j.status === 'completed').length;
    const failedJobs = jobs.filter(j => j.status === 'failed').length;

    const totalResults = jobs.flatMap(j => j.results);
    const totalImagesProcessed = totalResults.filter(r => r.success).length;
    const averageProcessingTime = totalResults.length > 0
      ? totalResults.reduce((sum, r) => sum + r.processingTime, 0) / totalResults.length
      : 0;

    return {
      totalJobs: jobs.length,
      completedJobs,
      failedJobs,
      activeJobs: this.activeJobs.size,
      queuedJobs: this.jobQueue.length,
      totalImagesProcessed,
      averageProcessingTime
    };
  }

  // Clear completed jobs
  clearCompletedJobs(): number {
    const completedJobs = Array.from(this.jobs.entries())
      .filter(([_, job]) => job.status === 'completed' || job.status === 'failed')
      .map(([id]) => id);

    completedJobs.forEach(id => this.jobs.delete(id));

    logger.info(`Cleared ${completedJobs.length} completed batch jobs`);
    return completedJobs.length;
  }

  // Set maximum concurrent jobs
  setMaxConcurrentJobs(max: number): void {
    this.maxConcurrentJobs = Math.max(1, Math.min(10, max));
    logger.info(`Max concurrent batch jobs set to: ${this.maxConcurrentJobs}`);

    // Process queue in case we increased the limit
    this.processQueue();
  }
}

// Export singleton
export const batchProcessingService = new BatchProcessingService();