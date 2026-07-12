import { JobData } from '../types/index';

// Worker operation interfaces
export interface WorkerParams {
  priority?: number;
  timeout?: number;
  maxRetries?: number;
  [key: string]: unknown;
}

export interface ProcessingTaskData {
  imageData: Float32Array;
  width: number;
  height: number;
  operation: string;
  params?: Record<string, unknown>;
}

export interface WorkerTask {
  id: string;
  type: string;
  data: JobData;
  priority: number; // 0 = highest priority
  createdAt: number;
  estimatedDuration?: number;
}

export interface WorkerResult {
  id: string;
  type: string;
  data: JobData | ProcessingTaskData[];
  success: boolean;
  error?: string;
  executionTime: number;
}

export interface WorkerPool {
  workers: Worker[];
  availableWorkers: Set<number>;
  busyWorkers: Map<number, WorkerTask>;
  taskQueue: WorkerTask[];
  completedTasks: Map<string, WorkerResult>;
}

export interface ThreadingOptions {
  maxWorkers: number;
  workerIdleTimeout: number; // ms
  taskTimeout: number; // ms
  enablePriority: boolean;
  enableBatching: boolean;
  batchSize: number;
}

export interface ProcessingStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageExecutionTime: number;
  queueLength: number;
  activeWorkers: number;
  cpuUtilization: number;
}

class MultiThreadingService {
  private static instance: MultiThreadingService;
  private workerPool: WorkerPool;
  private options: ThreadingOptions;
  private taskCallbacks: Map<string, (result: WorkerResult) => void> = new Map();
  private stats: ProcessingStats;
  private isInitialized = false;

  private constructor() {
    this.options = this.createDefaultOptions();
    this.stats = this.createDefaultStats();
    this.workerPool = {
      workers: [],
      availableWorkers: new Set(),
      busyWorkers: new Map(),
      taskQueue: [],
      completedTasks: new Map()
    };
  }

  static getInstance(): MultiThreadingService {
    if (!MultiThreadingService.instance) {
      MultiThreadingService.instance = new MultiThreadingService();
    }
    return MultiThreadingService.instance;
  }

  private createDefaultOptions(): ThreadingOptions {
    const cores = navigator.hardwareConcurrency || 4;
    return {
      maxWorkers: Math.max(2, Math.min(cores, 8)),
      workerIdleTimeout: 30000, // 30 seconds
      taskTimeout: 60000, // 60 seconds
      enablePriority: true,
      enableBatching: false,
      batchSize: 10
    };
  }

  private createDefaultStats(): ProcessingStats {
    return {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      averageExecutionTime: 0,
      queueLength: 0,
      activeWorkers: 0,
      cpuUtilization: 0
    };
  }

  async initialize(options: Partial<ThreadingOptions> = {}): Promise<void> {
    if (this.isInitialized) return;

    this.options = { ...this.options, ...options };

    // Create worker pool
    await this.createWorkerPool();

    // Start queue processor
    this.startQueueProcessor();

    // Start stats updater
    this.startStatsUpdater();

    this.isInitialized = true;
    console.log(`MultiThreading service initialized with ${this.options.maxWorkers} workers`);
  }

  private async createWorkerPool(): Promise<void> {
    const workerScript = this.generateWorkerScript();
    const workerBlob = new Blob([workerScript], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(workerBlob);

    for (let i = 0; i < this.options.maxWorkers; i++) {
      try {
        const worker = new Worker(workerUrl);

        worker.onmessage = (event) => {
          this.handleWorkerMessage(i, event.data);
        };

        worker.onerror = (error) => {
          console.error(`Worker ${i} error:`, error);
          this.handleWorkerError(i, error);
        };

        this.workerPool.workers[i] = worker;
        this.workerPool.availableWorkers.add(i);
      } catch (error) {
        console.error(`Failed to create worker ${i}:`, error);
      }
    }

    URL.revokeObjectURL(workerUrl);
  }

  private generateWorkerScript(): string {
    return `
      // Image processing utilities
      function processImage(imageData, width, height, operation, params) {
        const result = new Float32Array(imageData.length);

        switch (operation) {
          case 'brightness_contrast':
            return applyBrightnessContrast(imageData, params.brightness || 0, params.contrast || 1);

          case 'gaussian_blur':
            return applyGaussianBlur(imageData, width, height, params.radius || 1, params.sigma || 1);

          case 'unsharp_mask':
            return applyUnsharpMask(imageData, width, height, params.amount || 1, params.radius || 1, params.threshold || 0);

          case 'color_temperature':
            return applyColorTemperature(imageData, params.temperature || 6500, params.tint || 0);

          case 'resize':
            return resizeImage(imageData, width, height, params.newWidth, params.newHeight, params.interpolation || 'linear');

          case 'histogram':
            return calculateHistogram(imageData, params.bins || 256);

          case 'statistics':
            return calculateStatistics(imageData);

          default:
            throw new Error('Unknown operation: ' + operation);
        }
      }

      function applyBrightnessContrast(imageData, brightness, contrast) {
        const result = new Float32Array(imageData.length);

        for (let i = 0; i < imageData.length; i += 4) {
          result[i] = Math.max(0, Math.min(255, (imageData[i] + brightness) * contrast));
          result[i + 1] = Math.max(0, Math.min(255, (imageData[i + 1] + brightness) * contrast));
          result[i + 2] = Math.max(0, Math.min(255, (imageData[i + 2] + brightness) * contrast));
          result[i + 3] = imageData[i + 3]; // Alpha unchanged
        }

        return result;
      }

      function applyGaussianBlur(imageData, width, height, radius, sigma) {
        const result = new Float32Array(imageData.length);
        const kernel = generateGaussianKernel(radius, sigma);

        // Horizontal pass
        const temp = new Float32Array(imageData.length);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            for (let c = 0; c < 4; c++) {
              let sum = 0;
              let weightSum = 0;

              for (let kx = -radius; kx <= radius; kx++) {
                const sx = Math.max(0, Math.min(width - 1, x + kx));
                const weight = kernel[kx + radius];
                sum += imageData[(y * width + sx) * 4 + c] * weight;
                weightSum += weight;
              }

              temp[(y * width + x) * 4 + c] = sum / weightSum;
            }
          }
        }

        // Vertical pass
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            for (let c = 0; c < 4; c++) {
              let sum = 0;
              let weightSum = 0;

              for (let ky = -radius; ky <= radius; ky++) {
                const sy = Math.max(0, Math.min(height - 1, y + ky));
                const weight = kernel[ky + radius];
                sum += temp[(sy * width + x) * 4 + c] * weight;
                weightSum += weight;
              }

              result[(y * width + x) * 4 + c] = sum / weightSum;
            }
          }
        }

        return result;
      }

      function generateGaussianKernel(radius, sigma) {
        const kernel = new Float32Array(radius * 2 + 1);
        let sum = 0;

        for (let i = -radius; i <= radius; i++) {
          const value = Math.exp(-(i * i) / (2 * sigma * sigma));
          kernel[i + radius] = value;
          sum += value;
        }

        // Normalize
        for (let i = 0; i < kernel.length; i++) {
          kernel[i] /= sum;
        }

        return kernel;
      }

      function applyUnsharpMask(imageData, width, height, amount, radius, threshold) {
        // First blur the image
        const blurred = applyGaussianBlur(imageData, width, height, Math.round(radius), radius / 3);
        const result = new Float32Array(imageData.length);

        for (let i = 0; i < imageData.length; i += 4) {
          for (let c = 0; c < 3; c++) { // Skip alpha
            const original = imageData[i + c];
            const blur = blurred[i + c];
            const difference = original - blur;

            if (Math.abs(difference) > threshold) {
              result[i + c] = Math.max(0, Math.min(255, original + difference * amount));
            } else {
              result[i + c] = original;
            }
          }
          result[i + 3] = imageData[i + 3]; // Alpha unchanged
        }

        return result;
      }

      function applyColorTemperature(imageData, temperature, tint) {
        const result = new Float32Array(imageData.length);
        const tempFactor = temperature / 6500; // 6500K is neutral
        const tintFactor = tint / 100;

        for (let i = 0; i < imageData.length; i += 4) {
          let r = imageData[i];
          let g = imageData[i + 1];
          let b = imageData[i + 2];

          // Temperature adjustment
          if (tempFactor > 1) { // Warmer
            r *= (1 + (tempFactor - 1) * 0.3);
            b *= (1 - (tempFactor - 1) * 0.2);
          } else { // Cooler
            r *= (1 + (tempFactor - 1) * 0.2);
            b *= (1 - (tempFactor - 1) * 0.3);
          }

          // Tint adjustment
          g *= (1 + tintFactor * 0.1);

          result[i] = Math.max(0, Math.min(255, r));
          result[i + 1] = Math.max(0, Math.min(255, g));
          result[i + 2] = Math.max(0, Math.min(255, b));
          result[i + 3] = imageData[i + 3];
        }

        return result;
      }

      function resizeImage(imageData, srcWidth, srcHeight, dstWidth, dstHeight, interpolation) {
        const result = new Float32Array(dstWidth * dstHeight * 4);
        const scaleX = srcWidth / dstWidth;
        const scaleY = srcHeight / dstHeight;

        for (let dstY = 0; dstY < dstHeight; dstY++) {
          for (let dstX = 0; dstX < dstWidth; dstX++) {
            const srcXf = dstX * scaleX;
            const srcYf = dstY * scaleY;

            const srcX = Math.floor(srcXf);
            const srcY = Math.floor(srcYf);

            const fracX = srcXf - srcX;
            const fracY = srcYf - srcY;

            const x1 = Math.min(srcX + 1, srcWidth - 1);
            const y1 = Math.min(srcY + 1, srcHeight - 1);

            const dstIdx = (dstY * dstWidth + dstX) * 4;

            for (let c = 0; c < 4; c++) {
              const p00 = imageData[(srcY * srcWidth + srcX) * 4 + c] || 0;
              const p10 = imageData[(srcY * srcWidth + x1) * 4 + c] || 0;
              const p01 = imageData[(y1 * srcWidth + srcX) * 4 + c] || 0;
              const p11 = imageData[(y1 * srcWidth + x1) * 4 + c] || 0;

              const top = p00 * (1 - fracX) + p10 * fracX;
              const bottom = p01 * (1 - fracX) + p11 * fracX;

              result[dstIdx + c] = top * (1 - fracY) + bottom * fracY;
            }
          }
        }

        return result;
      }

      function calculateHistogram(imageData, bins) {
        const histogram = {
          red: new Array(bins).fill(0),
          green: new Array(bins).fill(0),
          blue: new Array(bins).fill(0),
          luminance: new Array(bins).fill(0)
        };

        const scale = bins / 256;

        for (let i = 0; i < imageData.length; i += 4) {
          const r = Math.floor(imageData[i] * scale);
          const g = Math.floor(imageData[i + 1] * scale);
          const b = Math.floor(imageData[i + 2] * scale);
          const lum = Math.floor((imageData[i] * 0.299 + imageData[i + 1] * 0.587 + imageData[i + 2] * 0.114) * scale);

          histogram.red[Math.min(r, bins - 1)]++;
          histogram.green[Math.min(g, bins - 1)]++;
          histogram.blue[Math.min(b, bins - 1)]++;
          histogram.luminance[Math.min(lum, bins - 1)]++;
        }

        return histogram;
      }

      function calculateStatistics(imageData) {
        let rSum = 0, gSum = 0, bSum = 0;
        let rMin = 255, gMin = 255, bMin = 255;
        let rMax = 0, gMax = 0, bMax = 0;
        const pixels = imageData.length / 4;

        for (let i = 0; i < imageData.length; i += 4) {
          const r = imageData[i];
          const g = imageData[i + 1];
          const b = imageData[i + 2];

          rSum += r; gSum += g; bSum += b;
          rMin = Math.min(rMin, r); gMin = Math.min(gMin, g); bMin = Math.min(bMin, b);
          rMax = Math.max(rMax, r); gMax = Math.max(gMax, g); bMax = Math.max(bMax, b);
        }

        return {
          mean: { r: rSum / pixels, g: gSum / pixels, b: bSum / pixels },
          min: { r: rMin, g: gMin, b: bMin },
          max: { r: rMax, g: gMax, b: bMax },
          pixels
        };
      }

      // Worker message handler
      self.onmessage = function(event) {
        const { id, type, data, params } = event.data;
        const startTime = performance.now();

        try {
          let result;

          if (type === 'batch') {
            // Process multiple tasks in batch
            result = data.map(task => {
              return processImage(task.imageData, task.width, task.height, task.operation, task.params);
            });
          } else {
            // Single task processing
            result = processImage(data.imageData, data.width, data.height, type, params);
          }

          const executionTime = performance.now() - startTime;

          self.postMessage({
            id,
            type,
            data: result,
            success: true,
            executionTime
          });

        } catch (error) {
          const executionTime = performance.now() - startTime;

          self.postMessage({
            id,
            type,
            data: null,
            success: false,
            error: error.message,
            executionTime
          });
        }
      };
    `;
  }

  private handleWorkerMessage(workerId: number, result: WorkerResult): void {
    const task = this.workerPool.busyWorkers.get(workerId);

    if (task) {
      // Mark worker as available
      this.workerPool.busyWorkers.delete(workerId);
      this.workerPool.availableWorkers.add(workerId);

      // Store result
      this.workerPool.completedTasks.set(result.id, result);

      // Update stats
      this.stats.completedTasks++;
      if (!result.success) {
        this.stats.failedTasks++;
      }

      // Update average execution time
      const totalExecutionTime = this.stats.averageExecutionTime * (this.stats.completedTasks - 1) + result.executionTime;
      this.stats.averageExecutionTime = totalExecutionTime / this.stats.completedTasks;

      // Call callback if exists
      const callback = this.taskCallbacks.get(result.id);
      if (callback) {
        callback(result);
        this.taskCallbacks.delete(result.id);
      }
    }

    // Process next task in queue
    this.processNextTask();
  }

  private handleWorkerError(workerId: number, error: ErrorEvent): void {
    const task = this.workerPool.busyWorkers.get(workerId);

    if (task) {
      // Create error result
      const result: WorkerResult = {
        id: task.id,
        type: task.type,
        data: [] as ProcessingTaskData[],
        success: false,
        error: error.message,
        executionTime: Date.now() - task.createdAt
      };

      this.handleWorkerMessage(workerId, result);
    }

    // Restart worker
    this.restartWorker(workerId);
  }

  private async restartWorker(workerId: number): Promise<void> {
    try {
      // Terminate old worker
      this.workerPool.workers[workerId]?.terminate();

      // Create new worker
      const workerScript = this.generateWorkerScript();
      const workerBlob = new Blob([workerScript], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(workerBlob);

      const worker = new Worker(workerUrl);

      worker.onmessage = (event) => {
        this.handleWorkerMessage(workerId, event.data);
      };

      worker.onerror = (error) => {
        console.error(`Worker ${workerId} error:`, error);
        this.handleWorkerError(workerId, error);
      };

      this.workerPool.workers[workerId] = worker;
      this.workerPool.availableWorkers.add(workerId);

      URL.revokeObjectURL(workerUrl);
    } catch (error) {
      console.error(`Failed to restart worker ${workerId}:`, error);
    }
  }

  async processImage(
    imageData: Float32Array,
    width: number,
    height: number,
    operation: string,
    params: WorkerParams = {},
    priority: number = 5
  ): Promise<WorkerResult> {
    return new Promise((resolve, reject) => {
      const task: WorkerTask = {
        id: this.generateTaskId(),
        type: operation,
        data: { imageData, width, height },
        priority,
        createdAt: Date.now(),
        estimatedDuration: this.estimateTaskDuration(operation, width * height)
      };

      this.taskCallbacks.set(task.id, (result) => {
        if (result.success) {
          resolve(result);
        } else {
          reject(new Error(result.error));
        }
      });

      this.queueTask(task, params);
    });
  }

  async processBatch(
    tasks: Array<{
      imageData: Float32Array;
      width: number;
      height: number;
      operation: string;
      params?: Record<string, unknown>;
    }>,
    priority: number = 5
  ): Promise<WorkerResult[]> {
    if (!this.options.enableBatching) {
      // Process individually
      return Promise.all(tasks.map(task =>
        this.processImage(task.imageData, task.width, task.height, task.operation, task.params, priority)
      ));
    }

    // Batch processing
    const batches = this.createBatches(tasks);
    const results: WorkerResult[] = [];

    for (const batch of batches) {
      const batchResult = await new Promise<WorkerResult>((resolve, reject) => {
        const task: WorkerTask = {
          id: this.generateTaskId(),
          type: 'batch',
          data: { operations: batch } as JobData,
          priority,
          createdAt: Date.now()
        };

        this.taskCallbacks.set(task.id, (result) => {
          if (result.success) {
            resolve(result);
          } else {
            reject(new Error(result.error));
          }
        });

        this.queueTask(task);
      });

      if (Array.isArray(batchResult.data)) {
        results.push(...batchResult.data.map((data, index) => ({
          ...batchResult,
          id: `${batchResult.id}_${index}`,
          data
        })));
      }
    }

    return results;
  }

  private createBatches<T>(items: T[]): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += this.options.batchSize) {
      batches.push(items.slice(i, i + this.options.batchSize));
    }
    return batches;
  }

  private queueTask(task: WorkerTask, params: WorkerParams = {}): void {
    this.stats.totalTasks++;

    if (this.options.enablePriority) {
      // Insert task in priority order
      const insertIndex = this.workerPool.taskQueue.findIndex(t => t.priority > task.priority);
      if (insertIndex === -1) {
        this.workerPool.taskQueue.push(task);
      } else {
        this.workerPool.taskQueue.splice(insertIndex, 0, task);
      }
    } else {
      this.workerPool.taskQueue.push(task);
    }

    this.stats.queueLength = this.workerPool.taskQueue.length;

    // Try to process immediately
    this.processNextTask(params);
  }

  private processNextTask(params: WorkerParams = {}): void {
    if (this.workerPool.taskQueue.length === 0 || this.workerPool.availableWorkers.size === 0) {
      return;
    }

    const task = this.workerPool.taskQueue.shift()!;
    const workerId = Array.from(this.workerPool.availableWorkers)[0];

    this.workerPool.availableWorkers.delete(workerId);
    this.workerPool.busyWorkers.set(workerId, task);

    this.stats.queueLength = this.workerPool.taskQueue.length;

    // Send task to worker
    this.workerPool.workers[workerId].postMessage({
      id: task.id,
      type: task.type,
      data: task.data,
      params
    });

    // Set timeout for task
    setTimeout(() => {
      if (this.workerPool.busyWorkers.has(workerId)) {
        console.warn(`Task ${task.id} timed out`);
        this.handleWorkerError(workerId, new ErrorEvent('Task timeout'));
      }
    }, this.options.taskTimeout);
  }

  private startQueueProcessor(): void {
    setInterval(() => {
      this.processNextTask();
    }, 100); // Check queue every 100ms
  }

  private startStatsUpdater(): void {
    setInterval(() => {
      this.stats.activeWorkers = this.workerPool.busyWorkers.size;
      this.stats.cpuUtilization = (this.stats.activeWorkers / this.options.maxWorkers) * 100;
    }, 1000); // Update stats every second
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private estimateTaskDuration(operation: string, pixelCount: number): number {
    // Simple estimation based on operation type and pixel count
    const baseTime = {
      'brightness_contrast': 0.001,
      'gaussian_blur': 0.005,
      'unsharp_mask': 0.008,
      'color_temperature': 0.002,
      'resize': 0.003,
      'histogram': 0.002,
      'statistics': 0.001
    };

    return ((baseTime as Record<string, number>)[operation] || 0.003) * pixelCount / 1000; // ms per 1000 pixels
  }

  getStats(): ProcessingStats {
    return { ...this.stats };
  }

  getWorkerStatus(): {
    total: number;
    available: number;
    busy: number;
    queueLength: number;
  } {
    return {
      total: this.workerPool.workers.length,
      available: this.workerPool.availableWorkers.size,
      busy: this.workerPool.busyWorkers.size,
      queueLength: this.workerPool.taskQueue.length
    };
  }

  clearQueue(): void {
    this.workerPool.taskQueue.length = 0;
    this.stats.queueLength = 0;
  }

  setWorkerCount(count: number): void {
    if (count < 1 || count > 32) {
      throw new Error('Worker count must be between 1 and 32');
    }

    this.options.maxWorkers = count;

    // Adjust worker pool size
    if (count > this.workerPool.workers.length) {
      // Add workers
      this.createAdditionalWorkers(count - this.workerPool.workers.length);
    } else if (count < this.workerPool.workers.length) {
      // Remove workers
      this.removeExcessWorkers(this.workerPool.workers.length - count);
    }
  }

  private async createAdditionalWorkers(count: number): Promise<void> {
    const startIndex = this.workerPool.workers.length;

    for (let i = 0; i < count; i++) {
      const workerId = startIndex + i;
      try {
        const workerScript = this.generateWorkerScript();
        const workerBlob = new Blob([workerScript], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(workerBlob);

        const worker = new Worker(workerUrl);

        worker.onmessage = (event) => {
          this.handleWorkerMessage(workerId, event.data);
        };

        worker.onerror = (error) => {
          console.error(`Worker ${workerId} error:`, error);
          this.handleWorkerError(workerId, error);
        };

        this.workerPool.workers[workerId] = worker;
        this.workerPool.availableWorkers.add(workerId);

        URL.revokeObjectURL(workerUrl);
      } catch (error) {
        console.error(`Failed to create worker ${workerId}:`, error);
      }
    }
  }

  private removeExcessWorkers(count: number): void {
    for (let i = 0; i < count; i++) {
      const workerId = this.workerPool.workers.length - 1 - i;

      if (this.workerPool.workers[workerId]) {
        this.workerPool.workers[workerId].terminate();
        this.workerPool.availableWorkers.delete(workerId);
        this.workerPool.busyWorkers.delete(workerId);
      }
    }

    this.workerPool.workers.length -= count;
  }

  dispose(): void {
    // Terminate all workers
    this.workerPool.workers.forEach(worker => worker.terminate());

    // Clear all data structures
    this.workerPool.workers.length = 0;
    this.workerPool.availableWorkers.clear();
    this.workerPool.busyWorkers.clear();
    this.workerPool.taskQueue.length = 0;
    this.workerPool.completedTasks.clear();
    this.taskCallbacks.clear();

    this.isInitialized = false;
  }
}

export default MultiThreadingService;