/**
 * Compute the frame-drop rate over a measured window.
 *
 * Given the number of frames actually rendered (`frames`) during a window of
 * `deltaMs` milliseconds, this estimates how many frames were dropped against a
 * `targetFps` target (60fps by default) and returns the drop rate as a
 * percentage in the range [0, 100].
 *
 * The result is clamped to 0 when more frames than the target were rendered
 * (e.g. on a >60Hz display) and is 0 when the window has no duration.
 */
export function computeDropRate(frames: number, deltaMs: number, targetFps = 60): number {
  const targetFrames = Math.round((targetFps * deltaMs) / 1000);
  if (targetFrames <= 0) {
    return 0;
  }
  const droppedFrames = Math.max(0, targetFrames - frames);
  return (droppedFrames / targetFrames) * 100;
}
