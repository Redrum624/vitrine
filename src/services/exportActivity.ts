/**
 * Export-in-progress counter (final-review fix 2). Every export path — the single export in
 * ExportDialog, MultiExportService.exportMany, BatchProcessingService jobs and the file write in
 * ExportService.exportImage — holds a token while it runs. AppLifecycleService refuses an app
 * close (window close or the updater's "Restart and install now") while any token is held:
 * quitting would kill the export mid-write (a truncated file; under "Replace" the original is
 * lost). A counter, not a flag: the paths nest (a batch calls exportImage per photo).
 */
let active = 0;

/** Marks one export as running; call the returned function (idempotent) when it ends. */
export function beginExport(): () => void {
  active++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    active = Math.max(0, active - 1);
  };
}

/** Runs `fn` as an export: in progress until it settles (resolves or throws). */
export async function trackExport<T>(fn: () => Promise<T>): Promise<T> {
  const end = beginExport();
  try {
    return await fn();
  } finally {
    end();
  }
}

export function isExportInProgress(): boolean {
  return active > 0;
}
