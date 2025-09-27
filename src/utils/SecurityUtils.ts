import { logger } from './Logger';

/**
 * Security utilities for input sanitization and XSS prevention
 */
export class SecurityUtils {
  // HTML entities map for encoding
  private static readonly HTML_ENTITIES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;'
  };

  // Dangerous HTML patterns
  private static readonly DANGEROUS_PATTERNS = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
    /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi,
    /<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi,
    /<link\b[^>]*>/gi,
    /<meta\b[^>]*>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /data:text\/html/gi,
    /on\w+\s*=/gi // Event handlers like onclick, onload, etc.
  ];

  // SQL injection patterns
  private static readonly SQL_INJECTION_PATTERNS = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
    /(UNION\s+SELECT)/gi,
    /(\b(OR|AND)\s+\d+\s*=\s*\d+)/gi,
    /('(\s*OR\s*'.*'|;\s*--))/gi,
    /(\/\*.*\*\/)/gi
  ];

  // Path traversal patterns
  private static readonly PATH_TRAVERSAL_PATTERNS = [
    /\.\.\//g,
    /\.\.\\g/,
    /%2e%2e%2f/gi,
    /%2e%2e\//gi,
    /\.%2e\//gi,
    /%2e\.\//gi,
    /%2e%2e%5c/gi,
    /%2e%2e\\/gi,
    /\.%2e\\/gi,
    /%2e\.\\/gi
  ];

  /**
   * Sanitize HTML content to prevent XSS attacks
   */
  static sanitizeHtml(input: string): string {
    if (typeof input !== 'string') {
      return '';
    }

    // First pass: encode HTML entities
    let sanitized = input.replace(/[&<>"'`=/]/g, (match) => {
      return this.HTML_ENTITIES[match] || match;
    });

    // Second pass: remove dangerous patterns
    for (const pattern of this.DANGEROUS_PATTERNS) {
      sanitized = sanitized.replace(pattern, '');
    }

    // Log potential XSS attempts
    if (sanitized !== input) {
      logger.warn('Potential XSS attempt detected and sanitized', {
        original: input.substring(0, 100),
        sanitized: sanitized.substring(0, 100)
      });
    }

    return sanitized;
  }

  /**
   * Sanitize input for safe display in attributes
   */
  static sanitizeAttribute(input: string): string {
    if (typeof input !== 'string') {
      return '';
    }

    return input
      .replace(/[&<>"']/g, (match) => this.HTML_ENTITIES[match] || match)
      .replace(/[\r\n\t]/g, ' ')
      .trim();
  }

  /**
   * Validate and sanitize file paths
   */
  static sanitizeFilePath(input: string): { sanitized: string; isValid: boolean } {
    if (typeof input !== 'string') {
      return { sanitized: '', isValid: false };
    }

    let sanitized = input.trim();
    let isValid = true;

    // Check for path traversal attempts
    for (const pattern of this.PATH_TRAVERSAL_PATTERNS) {
      if (pattern.test(sanitized)) {
        logger.warn('Path traversal attempt detected', { path: input });
        isValid = false;
      }
      sanitized = sanitized.replace(pattern, '');
    }

    // Normalize path separators
    sanitized = sanitized.replace(/[/\\]+/g, '/');

    // Remove null bytes and control characters
    // eslint-disable-next-line no-control-regex
    sanitized = sanitized.replace(/[\x00-\x1f\x7f]/g, '');

    // Check for reasonable length
    if (sanitized.length > 260) {
      logger.warn('File path exceeds maximum length', { path: input });
      isValid = false;
    }

    return { sanitized, isValid };
  }

  /**
   * Detect potential SQL injection attempts
   */
  static detectSqlInjection(input: string): boolean {
    if (typeof input !== 'string') {
      return false;
    }

    for (const pattern of this.SQL_INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        logger.warn('Potential SQL injection attempt detected', {
          input: input.substring(0, 100)
        });
        return true;
      }
    }

    return false;
  }

  /**
   * Sanitize user input for logging
   */
  static sanitizeForLogging(input: unknown): string {
    if (input === null || input === undefined) {
      return 'null';
    }

    let stringInput: string;

    if (typeof input === 'object') {
      try {
        stringInput = JSON.stringify(input);
      } catch {
        stringInput = '[Object]';
      }
    } else {
      stringInput = String(input);
    }

    // Truncate long inputs
    if (stringInput.length > 200) {
      stringInput = stringInput.substring(0, 200) + '...';
    }

    // Remove sensitive patterns
    stringInput = stringInput
      .replace(/password[^,}]*/gi, 'password=***')
      .replace(/token[^,}]*/gi, 'token=***')
      .replace(/key[^,}]*/gi, 'key=***')
      .replace(/secret[^,}]*/gi, 'secret=***');

    return this.sanitizeHtml(stringInput);
  }

  /**
   * Create Content Security Policy header value
   */
  static createCSP(): string {
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: file:",
      "media-src 'self' data: blob: file:",
      "font-src 'self' data:",
      "connect-src 'self' file:",
      "worker-src 'self' blob:",
      "child-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; ');
  }

  /**
   * Validate image file type by content
   */
  static validateImageContent(buffer: ArrayBuffer): {
    isValid: boolean;
    mimeType?: string;
    extension?: string;
  } {
    if (!buffer || buffer.byteLength < 8) {
      return { isValid: false };
    }

    const bytes = new Uint8Array(buffer, 0, 12);

    // Check magic bytes for common image formats
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
      return { isValid: true, mimeType: 'image/jpeg', extension: '.jpg' };
    }

    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      return { isValid: true, mimeType: 'image/png', extension: '.png' };
    }

    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      return { isValid: true, mimeType: 'image/gif', extension: '.gif' };
    }

    if (bytes[0] === 0x42 && bytes[1] === 0x4D) {
      return { isValid: true, mimeType: 'image/bmp', extension: '.bmp' };
    }

    if ((bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4D && bytes[1] === 0x4D)) {
      return { isValid: true, mimeType: 'image/tiff', extension: '.tiff' };
    }

    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      return { isValid: true, mimeType: 'image/webp', extension: '.webp' };
    }

    // Check for RAW formats (simplified detection)
    const signature = new TextDecoder().decode(bytes.slice(0, 4));
    if (['II*\0', 'MM\0*'].includes(signature)) {
      return { isValid: true, mimeType: 'image/x-adobe-dng', extension: '.dng' };
    }

    return { isValid: false };
  }

  /**
   * Rate limit for security-sensitive operations
   */
  static createRateLimiter(maxRequests: number, timeWindowMs: number) {
    const requests = new Map<string, number[]>();

    return (identifier: string): boolean => {
      const now = Date.now();
      const userRequests = requests.get(identifier) || [];

      // Clean old requests
      const validRequests = userRequests.filter(time => now - time < timeWindowMs);

      if (validRequests.length >= maxRequests) {
        logger.warn('Rate limit exceeded', { identifier, requests: validRequests.length });
        return false;
      }

      validRequests.push(now);
      requests.set(identifier, validRequests);

      return true;
    };
  }

  /**
   * Generate cryptographically secure random string
   */
  static generateSecureId(length: number = 32): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';

    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);

    for (let i = 0; i < length; i++) {
      result += chars[randomValues[i] % chars.length];
    }

    return result;
  }

  /**
   * Hash sensitive data for safe logging
   */
  static async hashForLogging(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
  }

  /**
   * Validate and sanitize CSS values
   */
  static sanitizeCssValue(input: string): string {
    if (typeof input !== 'string') {
      return '';
    }

    // Remove potentially dangerous CSS constructs
    return input
      .replace(/javascript:/gi, '')
      .replace(/expression\s*\(/gi, '')
      .replace(/@import/gi, '')
      .replace(/behavior:/gi, '')
      .replace(/binding:/gi, '')
      .replace(/url\s*\(\s*["']?\s*data:/gi, '')
      .trim();
  }
}

export default SecurityUtils;