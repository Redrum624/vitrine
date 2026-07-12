import { logger } from '../utils/Logger';

export interface DebounceOptions {
  immediate?: boolean;
  priority?: 'low' | 'normal' | 'high';
  maxWait?: number;
  adaptiveDelay?: boolean;
}

export interface ParameterChangeContext {
  moduleId: string;
  parameterName: string;
  changeType: 'slider' | 'input' | 'button' | 'auto';
  changeVelocity?: number; // For slider movements
  isSequentialChange?: boolean; // Part of a series of rapid changes
}

export class AdaptiveDebounceService {
  private static instance: AdaptiveDebounceService;
  private timers = new Map<string, NodeJS.Timeout>();
  private lastChangeTime = new Map<string, number>();
  private changeVelocities = new Map<string, number[]>(); // Track recent velocities for adaptive timing
  private priorityQueue: Array<{ callback: () => void; priority: number; timestamp: number }> = [];
  private isProcessingQueue = false;

  // Adaptive timing configuration
  private readonly baseTiming = {
    slider: { min: 30, max: 150, optimal: 80 },
    input: { min: 100, max: 300, optimal: 200 },
    button: { min: 0, max: 50, optimal: 10 },
    auto: { min: 50, max: 100, optimal: 75 }
  };

  // Processing complexity estimates (in ms)
  private readonly moduleComplexity = {
    exposure: 5,
    basicadj: 8,
    whitebalance: 12,
    tonecurve: 15,
    colorbalance: 10,
    shadowshighlights: 20,
    noise: 25,
    lens: 30
  };

  static getInstance(): AdaptiveDebounceService {
    if (!AdaptiveDebounceService.instance) {
      AdaptiveDebounceService.instance = new AdaptiveDebounceService();
    }
    return AdaptiveDebounceService.instance;
  }

  private constructor() {
    // Start priority queue processor
    this.processPriorityQueue();
  }

  // Calculate adaptive delay based on context and history
  private calculateAdaptiveDelay(context: ParameterChangeContext): number {
    const { moduleId, changeType, changeVelocity, isSequentialChange } = context;

    // Base timing for change type
    const baseTiming = this.baseTiming[changeType] || this.baseTiming.slider;
    let delay = baseTiming.optimal;

    // Adjust for processing complexity
    const complexity = this.moduleComplexity[moduleId as keyof typeof this.moduleComplexity] || 10;
    const complexityMultiplier = Math.max(0.5, Math.min(2.0, complexity / 15));
    delay *= complexityMultiplier;

    // Adapt for change velocity (slider movements)
    if (changeVelocity !== undefined) {
      const velocities = this.changeVelocities.get(moduleId) || [];
      velocities.push(changeVelocity);

      // Keep only recent velocities (last 5 changes)
      if (velocities.length > 5) {
        velocities.splice(0, velocities.length - 5);
      }
      this.changeVelocities.set(moduleId, velocities);

      // Calculate average velocity
      const avgVelocity = velocities.reduce((sum, v) => sum + v, 0) / velocities.length;

      // Faster changes = shorter delays, but not too short
      if (avgVelocity > 0.1) { // High velocity
        delay = Math.max(baseTiming.min, delay * 0.6);
      } else if (avgVelocity < 0.01) { // Low velocity (precise adjustments)
        delay = Math.min(baseTiming.max, delay * 1.4);
      }
    }

    // Sequential changes get shorter delays for responsive feedback
    if (isSequentialChange) {
      delay = Math.max(baseTiming.min, delay * 0.7);
    }

    // Ensure delay is within reasonable bounds
    delay = Math.max(baseTiming.min, Math.min(baseTiming.max, delay));

    logger.debug(`Adaptive delay for ${moduleId} (${changeType}): ${Math.round(delay)}ms`);
    return delay;
  }

  // Check if current change is part of a sequential series
  private isSequentialChange(moduleId: string): boolean {
    const lastTime = this.lastChangeTime.get(moduleId);
    const now = performance.now();

    if (!lastTime) {
      this.lastChangeTime.set(moduleId, now);
      return false;
    }

    const timeSinceLastChange = now - lastTime;
    this.lastChangeTime.set(moduleId, now);

    // Consider it sequential if less than 500ms since last change
    return timeSinceLastChange < 500;
  }

  // Debounce with adaptive timing and priority
  debounce(
    key: string,
    callback: () => void,
    context: ParameterChangeContext,
    options: DebounceOptions = {}
  ): void {
    const {
      immediate = false,
      priority = 'normal',
      maxWait = 1000,
      adaptiveDelay = true
    } = options;

    // Clear existing timer
    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.timers.delete(key);
    }

    // Execute immediately if requested
    if (immediate) {
      callback();
      return;
    }

    // Detect sequential changes
    const isSequential = this.isSequentialChange(context.moduleId);
    context.isSequentialChange = isSequential;

    // Calculate delay
    const delay = adaptiveDelay
      ? this.calculateAdaptiveDelay(context)
      : this.baseTiming[context.changeType]?.optimal || 100;

    // Set up timer with priority support
    const timer = setTimeout(() => {
      this.timers.delete(key);

      if (priority === 'high') {
        // Execute high priority immediately
        callback();
      } else {
        // Add to priority queue
        const priorityValue = priority === 'normal' ? 1 : 0;
        this.addToPriorityQueue(callback, priorityValue);
      }
    }, delay);

    this.timers.set(key, timer);

    // Ensure max wait time is respected
    if (maxWait > 0) {
      setTimeout(() => {
        if (this.timers.has(key)) {
          logger.debug(`Max wait time reached for ${key}, executing callback`);
          clearTimeout(this.timers.get(key)!);
          this.timers.delete(key);
          callback();
        }
      }, maxWait);
    }
  }

  // Add callback to priority queue
  private addToPriorityQueue(callback: () => void, priority: number): void {
    this.priorityQueue.push({
      callback,
      priority,
      timestamp: performance.now()
    });

    // Sort by priority (higher first), then by timestamp (older first)
    this.priorityQueue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.timestamp - b.timestamp;
    });
  }

  // Process priority queue using requestIdleCallback when available
  private async processPriorityQueue(): Promise<void> {
    const processNext = () => {
      if (this.priorityQueue.length === 0 || this.isProcessingQueue) {
        // Schedule next check
        setTimeout(() => this.processPriorityQueue(), 16); // ~60fps
        return;
      }

      this.isProcessingQueue = true;
      const item = this.priorityQueue.shift()!;

      try {
        item.callback();
      } catch (error) {
        logger.error('Error executing queued callback:', error);
      }

      this.isProcessingQueue = false;

      // Process next item
      if (this.priorityQueue.length > 0) {
        // Use requestIdleCallback if available, otherwise setTimeout
        if ('requestIdleCallback' in window) {
          (window as Window & { requestIdleCallback: (callback: () => void) => void }).requestIdleCallback(() => this.processPriorityQueue());
        } else {
          setTimeout(() => this.processPriorityQueue(), 0);
        }
      } else {
        // Schedule next check
        setTimeout(() => this.processPriorityQueue(), 16);
      }
    };

    processNext();
  }

  // Cancel specific debounced call
  cancel(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
      logger.debug(`Cancelled debounced call: ${key}`);
    }
  }

  // Cancel all pending debounced calls
  cancelAll(): void {
    for (const [, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.priorityQueue.length = 0;
    logger.debug('Cancelled all debounced calls');
  }

  // Clear change history for a module (useful when switching images)
  clearHistory(moduleId?: string): void {
    if (moduleId) {
      this.lastChangeTime.delete(moduleId);
      this.changeVelocities.delete(moduleId);
    } else {
      this.lastChangeTime.clear();
      this.changeVelocities.clear();
    }
  }

  // Get statistics about current debouncing state
  getStats(): {
    activeDebouncers: number;
    queuedCallbacks: number;
    moduleHistories: number;
  } {
    return {
      activeDebouncers: this.timers.size,
      queuedCallbacks: this.priorityQueue.length,
      moduleHistories: this.lastChangeTime.size
    };
  }

  // Manually flush all pending operations (useful for urgent operations)
  flush(): void {
    // Execute all pending timers immediately
    for (const [, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();

    // Execute all queued callbacks
    while (this.priorityQueue.length > 0) {
      const item = this.priorityQueue.shift()!;
      try {
        item.callback();
      } catch (error) {
        logger.error('Error executing flushed callback:', error);
      }
    }

    logger.debug('Flushed all pending debounced operations');
  }
}

export const adaptiveDebounceService = AdaptiveDebounceService.getInstance();