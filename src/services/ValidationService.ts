import { logger } from '../utils/Logger';
import { SecurityUtils } from '../utils/SecurityUtils';

/**
 * Comprehensive input validation service for security and data integrity
 */
export class ValidationService {
  // File path validation patterns
  private static readonly DANGEROUS_PATTERNS = [
    /\.\./,           // Path traversal
    /^\//,            // Absolute paths on Unix
    /^[a-zA-Z]:\\/,   // Absolute paths on Windows (allowed)
    /[<>"|*?]/,       // Invalid filename characters
    /\0/,             // Null bytes
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f]/     // Control characters (except allowed ones)
  ];

  // Supported image formats
  private static readonly SUPPORTED_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif',
    '.cr2', '.cr3', '.nef', '.arw', '.orf', '.dng', '.raf', '.rw2',
    '.pef', '.x3f', '.mrw', '.dcr', '.k25', '.kdc', '.erf', '.mef',
    '.mos', '.raw', '.rwl', '.srf', '.sr2'
  ]);

  /**
   * Validate file path for security issues
   */
  static validateFilePath(path: string): { valid: boolean; error?: string } {
    if (!path || typeof path !== 'string') {
      return { valid: false, error: 'Path must be a non-empty string' };
    }

    // Length check
    if (path.length > 260) { // Windows MAX_PATH limit
      return { valid: false, error: 'Path too long (max 260 characters)' };
    }

    // Check for dangerous patterns
    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(path) && !path.match(/^[a-zA-Z]:\\/)) {
        if (pattern.source === '\\.\\.' && path.includes('..')) {
          return { valid: false, error: 'Path traversal detected' };
        }
        if (pattern.source === '[<>"|*?]') {
          return { valid: false, error: 'Invalid characters in path' };
        }
        if (pattern.source === '\\0') {
          return { valid: false, error: 'Null byte detected in path' };
        }
        if (pattern.source === '[\\x00-\\x1f]') {
          return { valid: false, error: 'Control characters detected in path' };
        }
      }
    }

    // Validate file extension
    const extension = path.toLowerCase().substring(path.lastIndexOf('.'));
    if (!this.SUPPORTED_EXTENSIONS.has(extension)) {
      return { valid: false, error: `Unsupported file format: ${extension}` };
    }

    return { valid: true };
  }

  /**
   * Validate image dimensions
   */
  static validateDimensions(width: number, height: number): { valid: boolean; error?: string } {
    if (!Number.isInteger(width) || !Number.isInteger(height)) {
      return { valid: false, error: 'Dimensions must be integers' };
    }

    if (width <= 0 || height <= 0) {
      return { valid: false, error: 'Dimensions must be positive' };
    }

    if (width > 65535 || height > 65535) {
      return { valid: false, error: 'Dimensions too large (max 65535x65535)' };
    }

    // Check for reasonable memory usage (4 bytes per pixel for RGBA)
    const memoryUsage = width * height * 4;
    const maxMemory = 500 * 1024 * 1024; // 500MB limit
    if (memoryUsage > maxMemory) {
      return { valid: false, error: 'Image too large for processing (memory limit exceeded)' };
    }

    return { valid: true };
  }

  /**
   * Validate numeric range
   */
  static validateRange(value: number, min: number, max: number, name: string): { valid: boolean; error?: string } {
    if (typeof value !== 'number' || isNaN(value)) {
      return { valid: false, error: `${name} must be a valid number` };
    }

    if (value < min || value > max) {
      return { valid: false, error: `${name} must be between ${min} and ${max}` };
    }

    return { valid: true };
  }

  /**
   * Validate color values
   */
  static validateColor(r: number, g: number, b: number, a: number = 1): { valid: boolean; error?: string } {
    const channels = [
      { value: r, name: 'Red' },
      { value: g, name: 'Green' },
      { value: b, name: 'Blue' },
      { value: a, name: 'Alpha' }
    ];

    for (const channel of channels) {
      const result = this.validateRange(channel.value, 0, 1, channel.name);
      if (!result.valid) {
        return result;
      }
    }

    return { valid: true };
  }

  /**
   * Sanitize string input to prevent XSS
   */
  static sanitizeString(input: string): string {
    return SecurityUtils.sanitizeHtml(input).substring(0, 1000);
  }

  /**
   * Validate file size
   */
  static validateFileSize(size: number): { valid: boolean; error?: string } {
    if (typeof size !== 'number' || size < 0) {
      return { valid: false, error: 'File size must be a non-negative number' };
    }

    const maxSize = 100 * 1024 * 1024; // 100MB limit
    if (size > maxSize) {
      return { valid: false, error: 'File too large (max 100MB)' };
    }

    return { valid: true };
  }

  /**
   * Validate export options
   */
  static validateExportOptions(options: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate format
    if (options.format && !['jpeg', 'png', 'tiff', 'webp'].includes(options.format as string)) {
      errors.push('Invalid export format');
    }

    // Validate quality
    if (options.quality !== undefined) {
      const qualityResult = this.validateRange(options.quality as number, 0, 100, 'Quality');
      if (!qualityResult.valid) {
        errors.push(qualityResult.error!);
      }
    }

    // Validate dimensions if provided
    if (options.width !== undefined || options.height !== undefined) {
      const width = options.width as number || 1;
      const height = options.height as number || 1;
      const dimensionResult = this.validateDimensions(width, height);
      if (!dimensionResult.valid) {
        errors.push(dimensionResult.error!);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Log validation errors securely
   */
  static logValidationError(context: string, error: string, input: unknown): void {
    // Sanitize input for logging
    const sanitizedInput = typeof input === 'string'
      ? this.sanitizeString(input)
      : JSON.stringify(input).substring(0, 100);

    logger.warn(`Validation error in ${context}: ${error}`, { input: sanitizedInput });
  }

  /**
   * Validate ArrayBuffer for image processing
   */
  static validateArrayBuffer(buffer: ArrayBuffer, expectedMinSize: number = 1024): { valid: boolean; error?: string } {
    if (!buffer || !(buffer instanceof ArrayBuffer)) {
      return { valid: false, error: 'Invalid buffer provided' };
    }

    if (buffer.byteLength === 0) {
      return { valid: false, error: 'Empty buffer' };
    }

    if (buffer.byteLength < expectedMinSize) {
      return { valid: false, error: `Buffer too small (minimum ${expectedMinSize} bytes)` };
    }

    if (buffer.byteLength > 100 * 1024 * 1024) { // 100MB limit
      return { valid: false, error: 'Buffer too large for processing' };
    }

    return { valid: true };
  }

  /**
   * Validate processing parameters
   */
  static validateProcessingParams(params: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Common parameter validations
    const numberParams = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'];
    const percentParams = ['vibrance', 'saturation', 'clarity'];

    for (const param of numberParams) {
      if (params[param] !== undefined) {
        const result = this.validateRange(params[param] as number, -5, 5, param);
        if (!result.valid) {
          errors.push(result.error!);
        }
      }
    }

    for (const param of percentParams) {
      if (params[param] !== undefined) {
        const result = this.validateRange(params[param] as number, -100, 100, param);
        if (!result.valid) {
          errors.push(result.error!);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

export default ValidationService;