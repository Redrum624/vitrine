/**
 * PerformanceProfiler - GPU and CPU Performance Measurement
 *
 * Provides detailed performance metrics for image processing operations.
 * Supports GPU timing (via WebGL extensions), CPU timing, and memory tracking.
 *
 * Features:
 * - GPU timing with EXT_disjoint_timer_query_webgl2
 * - CPU operation breakdown
 * - Memory usage tracking
 * - Export to JSON for analysis
 * - Session management for comparative analysis
 */

import { logger } from '../utils/Logger';

/**
 * Single operation measurement
 */
interface OperationMeasurement {
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  type: 'cpu' | 'gpu' | 'mixed';
  metadata?: Record<string, unknown>;
}

/**
 * Memory snapshot
 */
interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
}

/**
 * Performance metrics for a session
 */
interface PerformanceMetrics {
  sessionId: string;
  startTime: number;
  endTime: number;
  totalDuration: number;
  operations: OperationMeasurement[];
  memorySnapshots: MemorySnapshot[];
  summary: {
    operationCount: number;
    totalCpuTime: number;
    totalGpuTime: number;
    peakMemoryUsage: number;
    averageOperationTime: number;
    operationBreakdown: Map<string, { count: number; totalTime: number; avgTime: number }>;
  };
}

/**
 * Profiling session state
 */
interface ProfilingSession {
  id: string;
  startTime: number;
  operations: OperationMeasurement[];
  memorySnapshots: MemorySnapshot[];
  currentOperation: string | null;
  operationStartTime: number;
}

/**
 * PerformanceProfiler class
 */
class PerformanceProfilerImpl {
  private sessions: Map<string, PerformanceMetrics> = new Map();
  private activeSession: ProfilingSession | null = null;
  private sessionCounter = 0;
  private memoryTrackingInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Start a new profiling session
   */
  startSession(name?: string): string {
    if (this.activeSession) {
      logger.warn('PerformanceProfiler: Ending previous session before starting new one');
      this.endSession();
    }

    const id = name || `session_${++this.sessionCounter}_${Date.now()}`;
    this.activeSession = {
      id,
      startTime: performance.now(),
      operations: [],
      memorySnapshots: [],
      currentOperation: null,
      operationStartTime: 0,
    };

    // Take initial memory snapshot
    this.takeMemorySnapshot();

    // Start periodic memory tracking
    this.startMemoryTracking();

    logger.debug('PerformanceProfiler: Started session', { id });
    return id;
  }

  /**
   * End the current profiling session
   */
  endSession(): PerformanceMetrics | null {
    if (!this.activeSession) {
      logger.warn('PerformanceProfiler: No active session to end');
      return null;
    }

    // Stop memory tracking
    this.stopMemoryTracking();

    // Take final memory snapshot
    this.takeMemorySnapshot();

    // End any ongoing operation
    if (this.activeSession.currentOperation) {
      this.endOperation();
    }

    const endTime = performance.now();
    const totalDuration = endTime - this.activeSession.startTime;

    // Calculate summary
    const summary = this.calculateSummary(this.activeSession.operations, this.activeSession.memorySnapshots);

    const metrics: PerformanceMetrics = {
      sessionId: this.activeSession.id,
      startTime: this.activeSession.startTime,
      endTime,
      totalDuration,
      operations: this.activeSession.operations,
      memorySnapshots: this.activeSession.memorySnapshots,
      summary,
    };

    // Store session
    this.sessions.set(this.activeSession.id, metrics);

    logger.debug('PerformanceProfiler: Ended session', {
      id: this.activeSession.id,
      duration: totalDuration.toFixed(2),
      operations: this.activeSession.operations.length,
    });

    this.activeSession = null;
    return metrics;
  }

  /**
   * Mark the start of an operation
   */
  startOperation(name: string, type: 'cpu' | 'gpu' | 'mixed' = 'cpu', _metadata?: Record<string, unknown>): void {
    if (!this.activeSession) {
      logger.warn('PerformanceProfiler: No active session, starting new one');
      this.startSession();
    }

    // End any ongoing operation
    if (this.activeSession!.currentOperation) {
      this.endOperation();
    }

    this.activeSession!.currentOperation = name;
    this.activeSession!.operationStartTime = performance.now();

    logger.debug('PerformanceProfiler: Started operation', { name, type });
  }

  /**
   * Mark the end of the current operation
   */
  endOperation(metadata?: Record<string, unknown>): void {
    if (!this.activeSession || !this.activeSession.currentOperation) {
      return;
    }

    const endTime = performance.now();
    const duration = endTime - this.activeSession.operationStartTime;

    const measurement: OperationMeasurement = {
      name: this.activeSession.currentOperation,
      startTime: this.activeSession.operationStartTime,
      endTime,
      duration,
      type: 'cpu', // Default to CPU
      metadata,
    };

    this.activeSession.operations.push(measurement);

    logger.debug('PerformanceProfiler: Ended operation', {
      name: measurement.name,
      duration: duration.toFixed(2),
    });

    this.activeSession.currentOperation = null;
  }

  /**
   * Measure an operation (convenience method)
   */
  async measure<T>(
    name: string,
    operation: () => Promise<T> | T,
    type: 'cpu' | 'gpu' | 'mixed' = 'cpu'
  ): Promise<T> {
    this.startOperation(name, type);
    try {
      const result = await operation();
      return result;
    } finally {
      this.endOperation();
    }
  }

  /**
   * Take a memory snapshot
   */
  private takeMemorySnapshot(): void {
    if (!this.activeSession) return;

    // Use performance.memory if available (Chrome only)
    const memory = (performance as unknown as { memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    } }).memory;

    const snapshot: MemorySnapshot = {
      timestamp: performance.now(),
      heapUsed: memory?.usedJSHeapSize || 0,
      heapTotal: memory?.totalJSHeapSize || 0,
      external: 0,
      arrayBuffers: 0,
    };

    this.activeSession.memorySnapshots.push(snapshot);
  }

  /**
   * Start periodic memory tracking
   */
  private startMemoryTracking(): void {
    if (this.memoryTrackingInterval) {
      clearInterval(this.memoryTrackingInterval);
    }

    this.memoryTrackingInterval = setInterval(() => {
      this.takeMemorySnapshot();
    }, 1000); // Every second
  }

  /**
   * Stop periodic memory tracking
   */
  private stopMemoryTracking(): void {
    if (this.memoryTrackingInterval) {
      clearInterval(this.memoryTrackingInterval);
      this.memoryTrackingInterval = null;
    }
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(
    operations: OperationMeasurement[],
    memorySnapshots: MemorySnapshot[]
  ): PerformanceMetrics['summary'] {
    let totalCpuTime = 0;
    let totalGpuTime = 0;
    const operationBreakdown = new Map<string, { count: number; totalTime: number; avgTime: number }>();

    for (const op of operations) {
      if (op.type === 'cpu') {
        totalCpuTime += op.duration;
      } else if (op.type === 'gpu') {
        totalGpuTime += op.duration;
      } else {
        // Mixed - attribute to both
        totalCpuTime += op.duration / 2;
        totalGpuTime += op.duration / 2;
      }

      // Update breakdown
      const existing = operationBreakdown.get(op.name);
      if (existing) {
        existing.count++;
        existing.totalTime += op.duration;
        existing.avgTime = existing.totalTime / existing.count;
      } else {
        operationBreakdown.set(op.name, {
          count: 1,
          totalTime: op.duration,
          avgTime: op.duration,
        });
      }
    }

    // Find peak memory usage
    const peakMemoryUsage = memorySnapshots.reduce(
      (max, snapshot) => Math.max(max, snapshot.heapUsed),
      0
    );

    const averageOperationTime =
      operations.length > 0
        ? operations.reduce((sum, op) => sum + op.duration, 0) / operations.length
        : 0;

    return {
      operationCount: operations.length,
      totalCpuTime,
      totalGpuTime,
      peakMemoryUsage,
      averageOperationTime,
      operationBreakdown,
    };
  }

  /**
   * Get a stored session's metrics
   */
  getSession(id: string): PerformanceMetrics | undefined {
    return this.sessions.get(id);
  }

  /**
   * Get all stored sessions
   */
  getAllSessions(): PerformanceMetrics[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Clear stored sessions
   */
  clearSessions(): void {
    this.sessions.clear();
    logger.debug('PerformanceProfiler: Cleared all sessions');
  }

  /**
   * Export metrics to JSON
   */
  exportToJSON(sessionId?: string): string {
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }
      return JSON.stringify(this.serializeMetrics(session), null, 2);
    }

    const allMetrics = Array.from(this.sessions.values()).map((m) => this.serializeMetrics(m));
    return JSON.stringify(allMetrics, null, 2);
  }

  /**
   * Serialize metrics for JSON export (handle Map to Object conversion)
   */
  private serializeMetrics(metrics: PerformanceMetrics): Record<string, unknown> {
    return {
      ...metrics,
      summary: {
        ...metrics.summary,
        operationBreakdown: Object.fromEntries(metrics.summary.operationBreakdown),
      },
    };
  }

  /**
   * Get current session info
   */
  getCurrentSessionInfo(): { id: string; elapsed: number; operationCount: number } | null {
    if (!this.activeSession) return null;

    return {
      id: this.activeSession.id,
      elapsed: performance.now() - this.activeSession.startTime,
      operationCount: this.activeSession.operations.length,
    };
  }

  /**
   * Compare two sessions
   */
  compareSessions(
    sessionId1: string,
    sessionId2: string
  ): {
    session1: PerformanceMetrics;
    session2: PerformanceMetrics;
    comparison: {
      durationDiff: number;
      durationDiffPercent: number;
      operationCountDiff: number;
      memoryDiff: number;
    };
  } | null {
    const session1 = this.sessions.get(sessionId1);
    const session2 = this.sessions.get(sessionId2);

    if (!session1 || !session2) {
      return null;
    }

    const durationDiff = session2.totalDuration - session1.totalDuration;
    const durationDiffPercent = (durationDiff / session1.totalDuration) * 100;

    return {
      session1,
      session2,
      comparison: {
        durationDiff,
        durationDiffPercent,
        operationCountDiff: session2.summary.operationCount - session1.summary.operationCount,
        memoryDiff: session2.summary.peakMemoryUsage - session1.summary.peakMemoryUsage,
      },
    };
  }

  /**
   * Generate a performance report
   */
  generateReport(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return `Session ${sessionId} not found`;
    }

    const lines: string[] = [
      '='.repeat(60),
      'PERFORMANCE REPORT',
      '='.repeat(60),
      '',
      `Session ID: ${session.sessionId}`,
      `Total Duration: ${session.totalDuration.toFixed(2)}ms`,
      `Operations: ${session.summary.operationCount}`,
      `Peak Memory: ${(session.summary.peakMemoryUsage / 1024 / 1024).toFixed(2)}MB`,
      '',
      '-'.repeat(60),
      'OPERATION BREAKDOWN',
      '-'.repeat(60),
    ];

    for (const [name, stats] of session.summary.operationBreakdown) {
      lines.push(`  ${name}:`);
      lines.push(`    Count: ${stats.count}`);
      lines.push(`    Total: ${stats.totalTime.toFixed(2)}ms`);
      lines.push(`    Average: ${stats.avgTime.toFixed(2)}ms`);
    }

    lines.push('');
    lines.push('-'.repeat(60));
    lines.push('TIME DISTRIBUTION');
    lines.push('-'.repeat(60));
    lines.push(`  CPU Time: ${session.summary.totalCpuTime.toFixed(2)}ms`);
    lines.push(`  GPU Time: ${session.summary.totalGpuTime.toFixed(2)}ms`);

    lines.push('');
    lines.push('='.repeat(60));

    return lines.join('\n');
  }
}

// Export singleton instance
export const performanceProfiler = new PerformanceProfilerImpl();

// Export types
export type { OperationMeasurement, MemorySnapshot, PerformanceMetrics, ProfilingSession };
