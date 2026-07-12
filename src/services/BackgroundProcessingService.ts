import { JobData, ProcessingParameters } from '../types/index';

export interface ProcessingJob {
  id: string;
  type: 'export' | 'batch' | 'background_edit' | 'thumbnail' | 'analysis';
  priority: number; // 0 = highest priority
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0-100
  data: JobData;
  parameters: ProcessingParameters;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  estimatedDuration?: number;
  actualDuration?: number;
  error?: string;
  result?: JobData;
  dependencies?: string[]; // Job IDs this job depends on
  retryCount: number;
  maxRetries: number;
}

export interface JobProgress {
  jobId: string;
  progress: number;
  status: string;
  message?: string;
  currentStep?: string;
  totalSteps?: number;
  estimatedTimeRemaining?: number;
}

export interface ProcessingQueue {
  highPriority: ProcessingJob[];
  normalPriority: ProcessingJob[];
  lowPriority: ProcessingJob[];
  background: ProcessingJob[];
}

export interface WorkerConfig {
  maxWorkers: number;
  workerTimeout: number;
  retryDelay: number;
  enableConcurrency: boolean;
  enablePrioritization: boolean;
}

export interface QueueStats {
  totalJobs: number;
  queuedJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
  averageProcessingTime: number;
  throughput: number; // jobs per minute
  queueLength: number;
  estimatedWaitTime: number;
}

class BackgroundProcessingService {
  private static instance: BackgroundProcessingService;
  private jobs: Map<string, ProcessingJob> = new Map();
  private queue: ProcessingQueue;
  private workers: Map<string, Worker> = new Map();
  private activeJobs: Map<string, ProcessingJob> = new Map();
  private config: WorkerConfig;
  private stats: QueueStats;
  private progressCallbacks: Map<string, (progress: JobProgress) => void> = new Map();
  private completionCallbacks: Map<string, (job: ProcessingJob) => void> = new Map();
  private isProcessing = false;

  private constructor() {
    this.config = this.createDefaultConfig();
    this.stats = this.createDefaultStats();
    this.queue = {
      highPriority: [],
      normalPriority: [],
      lowPriority: [],
      background: []
    };

    this.initializeWorkers();
    this.startJobProcessor();
    this.startStatsUpdater();
  }

  static getInstance(): BackgroundProcessingService {
    if (!BackgroundProcessingService.instance) {
      BackgroundProcessingService.instance = new BackgroundProcessingService();
    }
    return BackgroundProcessingService.instance;
  }

  private createDefaultConfig(): WorkerConfig {
    const cores = navigator.hardwareConcurrency || 4;
    return {
      maxWorkers: Math.max(2, Math.min(cores - 1, 6)), // Leave one core for main thread
      workerTimeout: 5 * 60 * 1000, // 5 minutes
      retryDelay: 2000, // 2 seconds
      enableConcurrency: true,
      enablePrioritization: true
    };
  }

  private createDefaultStats(): QueueStats {
    return {
      totalJobs: 0,
      queuedJobs: 0,
      processingJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      averageProcessingTime: 0,
      throughput: 0,
      queueLength: 0,
      estimatedWaitTime: 0
    };
  }

  configure(config: Partial<WorkerConfig>): void {
    this.config = { ...this.config, ...config };

    // Adjust worker pool if needed
    if (config.maxWorkers !== undefined) {
      this.adjustWorkerPool(config.maxWorkers);
    }
  }

  queueJob(
    type: ProcessingJob['type'],
    data: JobData,
    parameters: ProcessingParameters = {},
    priority: number = 5,
    dependencies: string[] = [],
    maxRetries: number = 3
  ): string {
    const job: ProcessingJob = {
      id: this.generateJobId(),
      type,
      priority,
      status: 'queued',
      progress: 0,
      data,
      parameters,
      createdAt: Date.now(),
      dependencies,
      retryCount: 0,
      maxRetries,
      estimatedDuration: this.estimateJobDuration(type, data)
    };

    this.jobs.set(job.id, job);
    this.addToQueue(job);
    this.stats.totalJobs++;
    this.stats.queuedJobs++;

    this.processNextJobs();

    console.log(`Queued job ${job.id} (${type}) with priority ${priority}`);
    return job.id;
  }

  async waitForJob(jobId: string): Promise<ProcessingJob> {
    return new Promise((resolve, reject) => {
      const job = this.jobs.get(jobId);
      if (!job) {
        reject(new Error(`Job ${jobId} not found`));
        return;
      }

      if (job.status === 'completed') {
        resolve(job);
        return;
      }

      if (job.status === 'failed' || job.status === 'cancelled') {
        reject(new Error(`Job ${jobId} ${job.status}: ${job.error}`));
        return;
      }

      // Set up completion callback
      this.completionCallbacks.set(jobId, (completedJob) => {
        if (completedJob.status === 'completed') {
          resolve(completedJob);
        } else {
          reject(new Error(`Job ${jobId} ${completedJob.status}: ${completedJob.error}`));
        }
      });
    });
  }

  onProgress(jobId: string, callback: (progress: JobProgress) => void): void {
    this.progressCallbacks.set(jobId, callback);
  }

  onCompletion(jobId: string, callback: (job: ProcessingJob) => void): void {
    this.completionCallbacks.set(jobId, callback);
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'completed' || job.status === 'failed') {
      return false; // Cannot cancel finished jobs
    }

    if (job.status === 'processing') {
      // Find and terminate the worker
      for (const [workerId, activeJob] of this.activeJobs.entries()) {
        if (activeJob.id === jobId) {
          const worker = this.workers.get(workerId);
          if (worker) {
            worker.terminate();
            this.recreateWorker(workerId);
          }
          this.activeJobs.delete(workerId);
          break;
        }
      }
    } else {
      // Remove from queue
      this.removeFromQueue(job);
      this.stats.queuedJobs--;
    }

    job.status = 'cancelled';
    job.completedAt = Date.now();

    const callback = this.completionCallbacks.get(jobId);
    if (callback) {
      callback(job);
      this.completionCallbacks.delete(jobId);
    }

    return true;
  }

  retryJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'failed') return false;

    if (job.retryCount >= job.maxRetries) {
      return false;
    }

    job.retryCount++;
    job.status = 'queued';
    job.progress = 0;
    job.error = undefined;
    job.startedAt = undefined;
    job.completedAt = undefined;

    this.addToQueue(job);
    this.stats.queuedJobs++;
    this.stats.failedJobs--;

    this.processNextJobs();
    return true;
  }

  private addToQueue(job: ProcessingJob): void {
    // Check dependencies
    if (job.dependencies && job.dependencies.length > 0) {
      const unmetDependencies = job.dependencies.filter(depId => {
        const depJob = this.jobs.get(depId);
        return !depJob || depJob.status !== 'completed';
      });

      if (unmetDependencies.length > 0) {
        // Wait for dependencies
        setTimeout(() => this.addToQueue(job), 1000);
        return;
      }
    }

    // Add to appropriate priority queue
    if (job.priority <= 1) {
      this.queue.highPriority.push(job);
    } else if (job.priority <= 5) {
      this.queue.normalPriority.push(job);
    } else if (job.priority <= 8) {
      this.queue.lowPriority.push(job);
    } else {
      this.queue.background.push(job);
    }

    // Sort by priority within each queue
    this.sortQueues();
  }

  private removeFromQueue(job: ProcessingJob): void {
    const queues = [
      this.queue.highPriority,
      this.queue.normalPriority,
      this.queue.lowPriority,
      this.queue.background
    ];

    for (const queue of queues) {
      const index = queue.findIndex(j => j.id === job.id);
      if (index !== -1) {
        queue.splice(index, 1);
        break;
      }
    }
  }

  private sortQueues(): void {
    const sortFn = (a: ProcessingJob, b: ProcessingJob) => a.priority - b.priority;

    this.queue.highPriority.sort(sortFn);
    this.queue.normalPriority.sort(sortFn);
    this.queue.lowPriority.sort(sortFn);
    this.queue.background.sort(sortFn);
  }

  private getNextJob(): ProcessingJob | null {
    // Process high priority first
    if (this.queue.highPriority.length > 0) {
      return this.queue.highPriority.shift()!;
    }

    // Then normal priority
    if (this.queue.normalPriority.length > 0) {
      return this.queue.normalPriority.shift()!;
    }

    // Then low priority
    if (this.queue.lowPriority.length > 0) {
      return this.queue.lowPriority.shift()!;
    }

    // Finally background tasks
    if (this.queue.background.length > 0) {
      return this.queue.background.shift()!;
    }

    return null;
  }

  private async processNextJobs(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // Find available workers
      const availableWorkers = Array.from(this.workers.keys()).filter(
        workerId => !this.activeJobs.has(workerId)
      );

      // Process jobs up to available worker capacity
      for (const workerId of availableWorkers) {
        const job = this.getNextJob();
        if (!job) break;

        await this.processJob(job, workerId);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async processJob(job: ProcessingJob, workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    job.status = 'processing';
    job.startedAt = Date.now();
    job.progress = 0;

    this.activeJobs.set(workerId, job);
    this.stats.queuedJobs--;
    this.stats.processingJobs++;

    // Set up worker message handlers
    const timeoutId = setTimeout(() => {
      this.handleJobTimeout(job, workerId);
    }, this.config.workerTimeout);

    worker.onmessage = (event) => {
      this.handleWorkerMessage(job, workerId, event.data, timeoutId);
    };

    worker.onerror = (error) => {
      this.handleWorkerError(job, workerId, error, timeoutId);
    };

    // Send job to worker
    try {
      worker.postMessage({
        jobId: job.id,
        type: job.type,
        data: job.data,
        parameters: job.parameters
      });
    } catch (error) {
      this.handleJobError(job, workerId, `Failed to send job to worker: ${error}`, timeoutId);
    }
  }

  private handleWorkerMessage(
    job: ProcessingJob,
    workerId: string,
    message: {
      type: string;
      progress?: number;
      result?: JobData;
      error?: string;
      message?: string;
      currentStep?: number;
      totalSteps?: number;
      estimatedTimeRemaining?: number;
    },
    timeoutId: NodeJS.Timeout
  ): void {
    clearTimeout(timeoutId);

    if (message.type === 'progress') {
      job.progress = message.progress ?? 0;

      const progressCallback = this.progressCallbacks.get(job.id);
      if (progressCallback) {
        progressCallback({
          jobId: job.id,
          progress: job.progress,
          status: job.status,
          message: message.message ?? '',
          currentStep: (message.currentStep ?? 0).toString(),
          totalSteps: message.totalSteps ?? 1,
          estimatedTimeRemaining: message.estimatedTimeRemaining ?? 0
        });
      }

    } else if (message.type === 'completed') {
      this.handleJobCompletion(job, workerId, message.result ?? {});

    } else if (message.type === 'error') {
      this.handleJobError(job, workerId, message.error ?? 'Unknown error', timeoutId);
    }
  }

  private handleWorkerError(
    job: ProcessingJob,
    workerId: string,
    error: ErrorEvent,
    timeoutId: NodeJS.Timeout
  ): void {
    this.handleJobError(job, workerId, error.message, timeoutId);
  }

  private handleJobTimeout(job: ProcessingJob, workerId: string): void {
    this.handleJobError(job, workerId, 'Job timeout exceeded');
  }

  private handleJobError(
    job: ProcessingJob,
    workerId: string,
    error: string,
    timeoutId?: NodeJS.Timeout
  ): void {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    job.status = 'failed';
    job.error = error;
    job.completedAt = Date.now();
    job.actualDuration = job.completedAt - (job.startedAt || job.createdAt);

    this.activeJobs.delete(workerId);
    this.stats.processingJobs--;
    this.stats.failedJobs++;

    // Recreate worker in case it's corrupted
    this.recreateWorker(workerId);

    console.error(`Job ${job.id} failed:`, error);

    // Retry if possible
    if (job.retryCount < job.maxRetries) {
      setTimeout(() => {
        this.retryJob(job.id);
      }, this.config.retryDelay);
    } else {
      const callback = this.completionCallbacks.get(job.id);
      if (callback) {
        callback(job);
        this.completionCallbacks.delete(job.id);
      }
    }

    // Process next jobs
    this.processNextJobs();
  }

  private handleJobCompletion(job: ProcessingJob, workerId: string, result: JobData): void {
    job.status = 'completed';
    job.progress = 100;
    job.result = result;
    job.completedAt = Date.now();
    job.actualDuration = job.completedAt - (job.startedAt || job.createdAt);

    this.activeJobs.delete(workerId);
    this.stats.processingJobs--;
    this.stats.completedJobs++;

    // Update average processing time
    this.updateAverageProcessingTime(job.actualDuration);

    console.log(`Job ${job.id} completed in ${job.actualDuration}ms`);

    const callback = this.completionCallbacks.get(job.id);
    if (callback) {
      callback(job);
      this.completionCallbacks.delete(job.id);
    }

    // Process next jobs
    this.processNextJobs();
  }

  private initializeWorkers(): void {
    for (let i = 0; i < this.config.maxWorkers; i++) {
      this.createWorker(`worker_${i}`);
    }
  }

  private createWorker(workerId: string): void {
    try {
      const workerScript = this.generateWorkerScript();
      const blob = new Blob([workerScript], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);

      const worker = new Worker(url);
      this.workers.set(workerId, worker);

      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(`Failed to create worker ${workerId}:`, error);
    }
  }

  private recreateWorker(workerId: string): void {
    const existingWorker = this.workers.get(workerId);
    if (existingWorker) {
      existingWorker.terminate();
    }

    this.createWorker(workerId);
  }

  private adjustWorkerPool(newSize: number): void {
    const currentSize = this.workers.size;

    if (newSize > currentSize) {
      // Add workers
      for (let i = currentSize; i < newSize; i++) {
        this.createWorker(`worker_${i}`);
      }
    } else if (newSize < currentSize) {
      // Remove workers
      const workersToRemove = Array.from(this.workers.keys()).slice(newSize);
      workersToRemove.forEach(workerId => {
        const worker = this.workers.get(workerId);
        if (worker && !this.activeJobs.has(workerId)) {
          worker.terminate();
          this.workers.delete(workerId);
        }
      });
    }
  }

  private generateWorkerScript(): string {
    return `
      // Background processing worker
      let currentJob = null;

      function updateProgress(progress, message, currentStep, totalSteps) {
        self.postMessage({
          type: 'progress',
          progress: Math.max(0, Math.min(100, progress)),
          message: message,
          currentStep: currentStep,
          totalSteps: totalSteps
        });
      }

      function processExportJob(data, parameters) {
        updateProgress(0, 'Starting export...', 1, 5);

        // Simulate export processing
        const images = data.images || [data];
        const totalImages = images.length;

        for (let i = 0; i < totalImages; i++) {
          updateProgress(
            (i / totalImages) * 80,
            \`Processing image \${i + 1} of \${totalImages}\`,
            i + 2,
            totalImages + 4
          );

          // Simulate processing time
          const start = Date.now();
          while (Date.now() - start < 100) {
            // Busy wait to simulate work
          }
        }

        updateProgress(90, 'Finalizing export...', totalImages + 3, totalImages + 4);

        // Simulate final processing
        const start = Date.now();
        while (Date.now() - start < 200) {
          // Busy wait
        }

        updateProgress(100, 'Export completed', totalImages + 4, totalImages + 4);

        return {
          success: true,
          exportedFiles: totalImages,
          format: parameters.format || 'jpeg',
          quality: parameters.quality || 95
        };
      }

      function processBatchJob(data, parameters) {
        updateProgress(0, 'Starting batch processing...', 1, 4);

        const operations = data.operations || [];
        const totalOps = operations.length;

        for (let i = 0; i < totalOps; i++) {
          updateProgress(
            (i / totalOps) * 90,
            \`Applying \${operations[i]} (\${i + 1}/\${totalOps})\`,
            i + 2,
            totalOps + 3
          );

          // Simulate operation processing
          const start = Date.now();
          while (Date.now() - start < 150) {
            // Busy wait
          }
        }

        updateProgress(100, 'Batch processing completed', totalOps + 3, totalOps + 3);

        return {
          success: true,
          processedOperations: totalOps,
          appliedTo: data.imageCount || 1
        };
      }

      function processBackgroundEdit(data, parameters) {
        updateProgress(0, 'Preparing edit...', 1, 3);

        // Simulate background editing
        const start = Date.now();
        while (Date.now() - start < 300) {
          updateProgress(
            Math.min(90, ((Date.now() - start) / 300) * 90),
            'Processing edit...',
            2,
            3
          );
        }

        updateProgress(100, 'Edit completed', 3, 3);

        return {
          success: true,
          operation: parameters.operation || 'unknown',
          result: 'Background edit completed'
        };
      }

      function processThumbnailJob(data, parameters) {
        updateProgress(0, 'Generating thumbnails...', 1, 2);

        const count = data.count || 1;
        const size = parameters.size || 256;

        // Simulate thumbnail generation
        const start = Date.now();
        while (Date.now() - start < 100 * count) {
          updateProgress(
            Math.min(90, ((Date.now() - start) / (100 * count)) * 90),
            \`Generating \${size}x\${size} thumbnails...\`,
            1,
            2
          );
        }

        updateProgress(100, 'Thumbnails generated', 2, 2);

        return {
          success: true,
          thumbnailsGenerated: count,
          size: size
        };
      }

      function processAnalysisJob(data, parameters) {
        updateProgress(0, 'Starting image analysis...', 1, 4);

        // Simulate analysis steps
        const steps = [
          'Analyzing histogram',
          'Detecting features',
          'Calculating statistics',
          'Generating report'
        ];

        for (let i = 0; i < steps.length; i++) {
          updateProgress(
            (i / steps.length) * 100,
            steps[i],
            i + 1,
            steps.length
          );

          // Simulate processing time
          const start = Date.now();
          while (Date.now() - start < 200) {
            // Busy wait
          }
        }

        updateProgress(100, 'Analysis completed', steps.length, steps.length);

        return {
          success: true,
          analysisType: parameters.type || 'full',
          features: ['histogram', 'exposure', 'composition'],
          score: Math.random() * 100
        };
      }

      self.onmessage = function(event) {
        const { jobId, type, data, parameters } = event.data;
        currentJob = { jobId, type };

        try {
          let result;

          switch (type) {
            case 'export':
              result = processExportJob(data, parameters);
              break;

            case 'batch':
              result = processBatchJob(data, parameters);
              break;

            case 'background_edit':
              result = processBackgroundEdit(data, parameters);
              break;

            case 'thumbnail':
              result = processThumbnailJob(data, parameters);
              break;

            case 'analysis':
              result = processAnalysisJob(data, parameters);
              break;

            default:
              throw new Error('Unknown job type: ' + type);
          }

          self.postMessage({
            type: 'completed',
            result: result
          });

        } catch (error) {
          self.postMessage({
            type: 'error',
            error: error.message
          });
        } finally {
          currentJob = null;
        }
      };
    `;
  }

  private estimateJobDuration(type: ProcessingJob['type'], data: JobData): number {
    const baseTimes = {
      export: 5000,      // 5 seconds
      batch: 3000,       // 3 seconds
      background_edit: 2000, // 2 seconds
      thumbnail: 1000,   // 1 second
      analysis: 4000     // 4 seconds
    };

    let baseTime = baseTimes[type] || 2000;

    // Adjust based on data size
    if (data.images) {
      baseTime *= data.images.length;
    }

    if (data.operations) {
      baseTime *= data.operations.length;
    }

    return baseTime;
  }

  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private updateAverageProcessingTime(duration: number): void {
    const alpha = 0.1; // Weight for new sample
    this.stats.averageProcessingTime =
      this.stats.averageProcessingTime * (1 - alpha) + duration * alpha;
  }

  private startJobProcessor(): void {
    setInterval(() => {
      this.processNextJobs();
    }, 1000); // Check for new jobs every second
  }

  private startStatsUpdater(): void {
    setInterval(() => {
      this.updateStats();
    }, 5000); // Update stats every 5 seconds
  }

  private updateStats(): void {
    const allQueues = [
      ...this.queue.highPriority,
      ...this.queue.normalPriority,
      ...this.queue.lowPriority,
      ...this.queue.background
    ];

    this.stats.queueLength = allQueues.length;
    this.stats.queuedJobs = allQueues.length;
    this.stats.processingJobs = this.activeJobs.size;

    // Calculate throughput (jobs per minute)
    const completedInLastMinute = Array.from(this.jobs.values()).filter(
      job => job.status === 'completed' &&
             job.completedAt &&
             Date.now() - job.completedAt < 60000
    ).length;

    this.stats.throughput = completedInLastMinute;

    // Estimate wait time
    if (this.stats.queueLength > 0 && this.stats.averageProcessingTime > 0) {
      const activeWorkers = Math.min(this.config.maxWorkers, this.stats.queueLength);
      this.stats.estimatedWaitTime =
        (this.stats.queueLength / activeWorkers) * this.stats.averageProcessingTime;
    } else {
      this.stats.estimatedWaitTime = 0;
    }
  }

  getJob(jobId: string): ProcessingJob | undefined {
    return this.jobs.get(jobId);
  }

  getJobsByStatus(status: ProcessingJob['status']): ProcessingJob[] {
    return Array.from(this.jobs.values()).filter(job => job.status === status);
  }

  getJobsByType(type: ProcessingJob['type']): ProcessingJob[] {
    return Array.from(this.jobs.values()).filter(job => job.type === type);
  }

  getStats(): QueueStats {
    this.updateStats();
    return { ...this.stats };
  }

  getQueueInfo(): {
    highPriority: number;
    normalPriority: number;
    lowPriority: number;
    background: number;
    total: number;
  } {
    return {
      highPriority: this.queue.highPriority.length,
      normalPriority: this.queue.normalPriority.length,
      lowPriority: this.queue.lowPriority.length,
      background: this.queue.background.length,
      total: this.queue.highPriority.length +
             this.queue.normalPriority.length +
             this.queue.lowPriority.length +
             this.queue.background.length
    };
  }

  clearCompleted(): number {
    const completedJobs = Array.from(this.jobs.entries())
      .filter(([_, job]) => job.status === 'completed')
      .map(([id, _]) => id);

    completedJobs.forEach(id => {
      this.jobs.delete(id);
      this.progressCallbacks.delete(id);
      this.completionCallbacks.delete(id);
    });

    return completedJobs.length;
  }

  pause(): void {
    // Implementation would pause job processing
    console.log('Background processing paused');
  }

  resume(): void {
    // Implementation would resume job processing
    this.processNextJobs();
    console.log('Background processing resumed');
  }

  dispose(): void {
    // Cancel all jobs
    for (const job of this.jobs.values()) {
      if (job.status === 'queued' || job.status === 'processing') {
        this.cancelJob(job.id);
      }
    }

    // Terminate all workers
    for (const worker of this.workers.values()) {
      worker.terminate();
    }

    // Clear all data
    this.jobs.clear();
    this.workers.clear();
    this.activeJobs.clear();
    this.progressCallbacks.clear();
    this.completionCallbacks.clear();

    this.queue.highPriority.length = 0;
    this.queue.normalPriority.length = 0;
    this.queue.lowPriority.length = 0;
    this.queue.background.length = 0;
  }
}

export default BackgroundProcessingService;