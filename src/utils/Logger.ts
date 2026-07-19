// Enhanced logging system with automatic log capture
interface PerformanceWithMemory {
  now(): number;
  timeOrigin?: number;
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

export interface LogEntry {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: unknown;
  source: 'renderer' | 'main' | 'preload';
  stack?: string;
  [key: string]: unknown; // Index signature for Record compatibility
}

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 1000;
  private lastLogTime = new Map<string, number>();
  private throttleMs = 50; // Throttle identical messages within 50ms
  private originalConsole: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  };

  constructor() {
    // Store original console methods
    this.originalConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console)
    };

    this.interceptConsole();
    this.setupErrorHandling();
  }

  private interceptConsole() {
    // Override console methods to capture logs
    console.log = (...args) => {
      this.addLog('info', this.formatMessage(args));
      this.originalConsole.log(...args);
    };

    console.info = (...args) => {
      this.addLog('info', this.formatMessage(args));
      this.originalConsole.info(...args);
    };

    console.warn = (...args) => {
      this.addLog('warn', this.formatMessage(args));
      this.originalConsole.warn(...args);
    };

    console.error = (...args) => {
      this.addLog('error', this.formatMessage(args), args.find(arg => arg instanceof Error));
      this.originalConsole.error(...args);
    };

    console.debug = (...args) => {
      this.addLog('debug', this.formatMessage(args));
      this.originalConsole.debug(...args);
    };
  }

  private setupErrorHandling() {
    // WORKER-SAFETY: this singleton is imported (transitively) by
    // pipeline.worker.ts — a bare `window` reference here crashed the whole
    // worker bundle at module evaluation ("window is not defined"), which made
    // every ≥1MP CPU preview pass hang through 30s dead-worker timeouts.
    // Workers report errors through their own message channel instead.
    if (typeof window === 'undefined') return;

    // Catch unhandled errors
    window.addEventListener('error', (event) => {
      this.addLog('error', `Uncaught Error: ${event.message}`, event.error);
    });

    // Catch unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.addLog('error', `Unhandled Promise Rejection: ${event.reason}`, event.reason);
    });
  }

  private formatMessage(args: unknown[]): string {
    return args.map(arg => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.message;
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }).join(' ');
  }

  private addLog(level: LogEntry['level'], message: string, error?: Error) {
    // Throttle identical messages to prevent spam
    const messageKey = `${level}:${message}`;
    const now = Date.now();
    const lastTime = this.lastLogTime.get(messageKey) || 0;

    // Skip throttled messages except for errors
    if (level !== 'error' && now - lastTime < this.throttleMs) {
      return;
    }

    this.lastLogTime.set(messageKey, now);

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      source: 'renderer',
      stack: error?.stack
    };

    this.logs.push(entry);

    // Keep only the last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Send to Electron main process if available (renderer only — `window`
    // doesn't exist inside the pipeline worker).
    if (typeof window !== 'undefined' && window.electronAPI) {
      // We'll extend the electronAPI to handle logs
      this.sendToElectron(entry);
    }
  }

  private async sendToElectron(entry: LogEntry) {
    // Send log entry to main process for file logging
    try {
      if (window.electronAPI && window.electronAPI.writeLog) {
        await window.electronAPI.writeLog(entry);
      }
      window.dispatchEvent(new CustomEvent('log-entry', { detail: entry }));
    } catch (error) {
      this.originalConsole.error('Failed to send log to Electron:', error);
    }
  }

  // Public API
  public getLogs(level?: LogEntry['level'], limit?: number): LogEntry[] {
    let filteredLogs = level ? this.logs.filter(log => log.level === level) : this.logs;

    if (limit) {
      filteredLogs = filteredLogs.slice(-limit);
    }

    return filteredLogs;
  }

  public getLogsAsString(level?: LogEntry['level'], limit?: number): string {
    return this.getLogs(level, limit)
      .map(log => `[${log.timestamp.toISOString()}] ${log.level.toUpperCase()}: ${log.message}`)
      .join('\n');
  }

  public clearLogs() {
    this.logs = [];
  }

  public exportLogs(): string {
    const logData = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      logs: this.logs
    };

    return JSON.stringify(logData, null, 2);
  }

  // Manual logging methods (for structured logging)
  public debug(message: string, data?: unknown) {
    this.addLog('debug', message);
    if (data !== undefined) {
      this.originalConsole.debug(message, data);
    } else {
      this.originalConsole.debug(message);
    }
  }

  public info(message: string, data?: unknown) {
    this.addLog('info', message);
    if (data !== undefined) {
      this.originalConsole.info(message, data);
    } else {
      this.originalConsole.info(message);
    }
  }

  public warn(message: string, data?: unknown) {
    this.addLog('warn', message);
    if (data !== undefined) {
      this.originalConsole.warn(message, data);
    } else {
      this.originalConsole.warn(message);
    }
  }

  public error(message: string, error?: Error | unknown) {
    this.addLog('error', message, error instanceof Error ? error : undefined);
    if (error !== undefined) {
      this.originalConsole.error(message, error);
    } else {
      this.originalConsole.error(message);
    }
  }

  // Get performance metrics
  public getPerformanceInfo() {
    const perf = performance;
    const perfMemory = (performance as PerformanceWithMemory).memory;
    return {
      navigation: perf.getEntriesByType('navigation')[0],
      memory: perfMemory ? {
        usedJSHeapSize: perfMemory.usedJSHeapSize,
        totalJSHeapSize: perfMemory.totalJSHeapSize,
        jsHeapSizeLimit: perfMemory.jsHeapSizeLimit
      } : null,
      timing: {
        domContentLoaded: perf.timing ? (perf.timing.domContentLoadedEventEnd - perf.timing.navigationStart) : 0,
        loadComplete: perf.timing ? (perf.timing.loadEventEnd - perf.timing.navigationStart) : 0
      }
    };
  }
}

// Create singleton instance
export const logger = new Logger();

// Global access for debugging (renderer only — the pipeline worker imports
// this module and has no `window`; see setupErrorHandling).
if (typeof window !== 'undefined') {
  (window as { __logger?: Logger }).__logger = logger;
}