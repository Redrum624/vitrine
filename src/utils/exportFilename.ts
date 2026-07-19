/**
 * The filename suffix stamped on exported images. "_VIT" for Vitrine —
 * replaced the pre-rebrand "_PEP" (Photo Editor Pro) in v1.29.1. Single- and
 * multi-export share this constant so the two paths can never drift.
 */
export const EXPORT_SUFFIX = '_VIT';

/**
 * Returns a suffixed filename for multi-export output.
 * index 0  → `${baseName}_VIT.${ext}`
 * index N  → `${baseName}_VIT_${N}.${ext}`
 * @param baseName  The base name without extension.
 * @param ext       The bare extension WITHOUT a dot (e.g. 'jpg').
 * @param index     Zero-based export index.
 */
export function suffixedName(baseName: string, ext: string, index: number): string {
  if (index === 0) {
    return `${baseName}${EXPORT_SUFFIX}.${ext}`;
  }
  return `${baseName}${EXPORT_SUFFIX}_${index}.${ext}`;
}

/**
 * Strips the directory and the final extension from a file path,
 * returning just the base name. Handles both '/' and '\\' separators.
 * Only the LAST dot-extension is removed.
 * @param filePath  An absolute or relative file path.
 */
export function baseNameOf(filePath: string): string {
  // Normalise separators and take the last segment.
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0) {
    // No extension, or starts with a dot (hidden file) — return as-is.
    return fileName;
  }
  return fileName.slice(0, dotIndex);
}
