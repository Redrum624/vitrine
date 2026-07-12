/**
 * Q7 LOW (round 9): the multi-export "unapplied enhancement" toast used to say only a COUNT
 * (`summary.upscaleSkipped.length`) even though `summary.upscaleSkipped` already carries each
 * skipped image's base name (MultiExportService.ts). Surface up to 3 names inline and fold the
 * rest into "and N more" so the toast stays readable for large batches.
 */
export function formatSkippedNames(names: string[]): string {
  const MAX_INLINE = 3;
  if (names.length <= MAX_INLINE) return names.join(', ');
  const shown = names.slice(0, MAX_INLINE).join(', ');
  const more = names.length - MAX_INLINE;
  return `${shown} and ${more} more`;
}
