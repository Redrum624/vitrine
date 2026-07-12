/**
 * Regression test: the keyboard-shortcuts service must register ONCE for the app's
 * life, not tear down + re-initialise on every image open / tool switch.
 *
 * Root cause (perf profile, latency round 4): App.tsx's keyboard-init `useEffect`
 * listed `[selectedTool, setSelectedTool, currentImage]` as its dependency array.
 * Every image switch changes `currentImage`, so the effect re-fired: its cleanup ran
 * `keyboardShortcutsService.destroy()` (logging "Keyboard shortcuts service
 * destroyed") and the body re-ran (logging "App component mounted" + "Initialized N
 * keyboard shortcuts" + re-registering all 20 shortcuts). The profiler saw this
 * destroy→re-register block inside the first ~125ms of EVERY open — the misleading
 * "App remounts per image" signature. It was pure churn: the rating/tool handlers
 * already read live state through refs (`currentImageRef`, and now `selectedToolRef`).
 *
 * The fix makes the effect mount-only (`[]` deps) by reading `selectedTool` through
 * `selectedToolRef.current` in the `onSelectTool` closure, so an image switch or tool
 * change is a pure state update that never touches the shortcuts service.
 *
 * Like `handleFileOpen` (see fileOpenSetsCurrentImage.test.ts), the effect is an
 * unexported closure inside `App()`; this suite has no full-`<App/>`-render harness
 * (~20 child components + ~15 services, several doing real WebGL/canvas work). So this
 * test statically asserts the single change that eliminates the per-open churn — the
 * effect's dependency array no longer contains `currentImage`/`selectedTool` — plus
 * that the fix routes `onSelectTool` through the ref (not a stale-closure regression)
 * and still registers the shortcuts. The service's own destroy→re-register resilience
 * is covered behaviourally by ratingShortcuts.test.ts.
 */
import fs from 'fs';
import path from 'path';

const appSource = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');

/**
 * Locates the `useEffect` whose body contains `marker` and returns its brace-balanced
 * body plus the dependency-array text that follows the closing brace.
 */
function effectContaining(source: string, marker: string): { body: string; deps: string } {
  const markerIdx = source.indexOf(marker);
  if (markerIdx === -1) throw new Error(`marker not found in App.tsx: ${marker}`);
  const effectStart = source.lastIndexOf('useEffect(() => {', markerIdx);
  if (effectStart === -1) throw new Error('enclosing useEffect not found for marker');
  const braceStart = source.indexOf('{', effectStart);

  let depth = 0;
  let bodyEnd = -1;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { bodyEnd = i; break; }
    }
  }
  if (bodyEnd === -1) throw new Error('could not brace-balance the effect body');

  const after = source.slice(bodyEnd + 1);
  const bracketStart = after.indexOf('[');
  const bracketEnd = after.indexOf(']');
  if (bracketStart === -1 || bracketEnd === -1) throw new Error('dependency array not found after effect');

  return {
    body: source.slice(braceStart, bodyEnd + 1),
    deps: after.slice(bracketStart, bracketEnd + 1),
  };
}

describe('App keyboard-init effect — registers once (no per-image-open remount churn)', () => {
  const effect = effectContaining(appSource, "logger.info('App component mounted')");

  test('dependency array is empty (mount-only) — the effect never re-fires on image switch', () => {
    expect(effect.deps.replace(/\s/g, '')).toBe('[]');
  });

  test('dependency array does not contain currentImage (the per-open re-fire trigger)', () => {
    expect(effect.deps).not.toContain('currentImage');
  });

  test('dependency array does not contain selectedTool (the per-tool-switch re-fire trigger)', () => {
    expect(effect.deps).not.toContain('selectedTool');
  });

  test('onSelectTool reads selectedTool through the ref (no stale-closure regression from dropping the dep)', () => {
    expect(effect.body).toMatch(/onSelectTool:\s*\(tool\)\s*=>\s*setSelectedTool\(selectedToolRef\.current\s*===\s*tool/);
  });

  test('the effect still registers the shortcuts (behaviour preserved, only the churn removed)', () => {
    expect(effect.body).toMatch(/keyboardShortcutsService\.register/);
    expect(effect.body).toMatch(/createDefaultShortcuts\(/);
  });

  test('a selectedToolRef mirror is maintained so the ref is always current', () => {
    expect(appSource).toMatch(/selectedToolRef\.current\s*=\s*selectedTool/);
  });
});
