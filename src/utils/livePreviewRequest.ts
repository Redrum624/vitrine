/**
 * Live preview requests (Task 12c): a drag (e.g. moving a Local Adjustments mask) asks
 * the AdjustmentPanel to reprocess NOW, without the adaptive debounce and without the
 * processingVersion bump that drives History checkpoints and edit persistence — those
 * follow the release only.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function requestLivePreview(): void {
  for (const l of [...listeners]) l();
}

export function onLivePreviewRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
