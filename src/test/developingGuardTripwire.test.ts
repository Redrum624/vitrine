/**
 * TRIPWIRE (Task R2): every base-pixel action that runs during the progressive-RAW-open
 * `developing` window must pass through `guardDeveloping()` — enforced by scanning SOURCE,
 * so the NEXT ungated site fails a test at introduction time, not at review time.
 *
 * Why this exists: v1.16.0's progressive open makes the app interactive during a ~5s window
 * where `imageService.getCurrentImage()` returns the camera-graded embedded PREVIEW, not the
 * neutral full-res base. Any action that (a) WRITES the working base, or (b) READS base pixels
 * to bake stats into persisted params, would apply against the preview and then be clobbered —
 * or silently wrong — once the background full decode swaps in. The guard (`src/utils/
 * developingGuard.ts`) blocks such actions during the window. That perimeter was breached THREE
 * times across review rounds — each time a NEW action type was added without the gate:
 *   round 1: App.tsx toolbar/menu handlers (Auto Levels/Contrast/Color, Print, Copy/Paste Style)
 *   round 2: the six per-module Auto (⚡) handlers that read the preview directly
 *   round 3: base-mutating transforms (rotate/flip/resize) + Enhance upscale + revert
 *
 * WHAT THIS ENFORCES — two enumerable, low-false-positive surfaces:
 *   A. BASE WRITES: every production `*.updateCurrentImageData(` call (the single choke point for
 *      replacing the working base) must sit in a function that also calls `guardDeveloping(`,
 *      or be on WRITE_ALLOWLIST with a one-line justification.
 *   B. BASE-PIXEL ANALYSIS READS: every production call to a pixel-analysis PRIMITIVE — the
 *      operations that consume base pixels to compute persisted params — must sit in a function
 *      that also calls `guardDeveloping(`, or be on READ_ALLOWLIST with a justification.
 *
 * WHY analysis PRIMITIVES rather than raw `.data` reads: most `getCurrentImage().data` reads are
 * legitimate render/pipeline work (Canvas draw, HistogramPanel, processCurrentImageRealTime) that
 * SHOULD run on whatever is current — including the preview. Flagging every `.data` read would be
 * badly false-positive-prone (the failure mode the brief warns against). The ACTUAL harm is baking
 * PREVIEW statistics into persisted params; that harm flows exclusively through a small, stable set
 * of analysis entry-points (PRIMITIVES below). Enforcing those catches the real breach class with
 * near-zero false positives.
 *
 * KNOWN BOUNDARY (read intentionally): this catches new *call sites* of the KNOWN primitives and
 * every new base WRITE. Two classes need a manual step in the SAME change that introduces them:
 *   1. A brand-new analysis PRIMITIVE (a new function that reads base pixels to bake params) is
 *      only covered once its name is added to PRIMITIVES.
 *   2. OUTPUT EMISSION — an action that reads current pixels to EMIT them somewhere durable
 *      (print, export/resize seeding, copy-image-to-clipboard, share, save-as). This was the
 *      round-1 breach class (Print emitted low-res preview pixels; export seeded preview dims).
 *      The existing emitters are gated (Print via guardDeveloping; ExportDialog via dims-write
 *      gating), but a NEW emitter (e.g. "Copy image to clipboard") reading
 *      getCurrentImage().data during developing would ship preview pixels with this tripwire
 *      GREEN — raw `.data` reads are deliberately not scanned (see WHY above). When adding any
 *      feature that sends current pixels outside the app, gate it with guardDeveloping AND add
 *      its entry point to PRIMITIVES.
 * The allow-lists are asserted non-stale, so they can't rot into a rubber stamp.
 *
 * Precedent for source-scanning tests: keyboardShortcutsSingleRegistration.test.ts,
 * mainRawFormatsConsolidation.test.ts.
 */
import fs from 'fs';
import path from 'path';

const SRC_ROOT = path.join(__dirname, '..');

// ── Source-file collection ────────────────────────────────────────────────
// Scan ALL production .ts/.tsx under src/ (recursively) — hardcoding file paths would let a NEW
// ungated site in a NEW file slip. Exclude tests, type decls, and the guard module itself.
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    if (/\.d\.ts$/.test(entry.name)) continue;
    if (entry.name === 'developingGuard.ts') continue; // the guard's own definition
    out.push(full);
  }
  return out;
}

const SOURCE_FILES = collectSourceFiles(SRC_ROOT);
const FILE_TEXT = new Map<string, string>(SOURCE_FILES.map((f) => [f, fs.readFileSync(f, 'utf8')]));

// ── Enclosing-function extraction ─────────────────────────────────────────
// Given a call offset, walk OUT through any nested control-flow blocks (if/for/try/…) to the
// enclosing FUNCTION body, so a guard placed as the function's early-return is still "in scope"
// even when the mutating call is nested inside a try/if. Naive brace matching (like the repo's
// precedent source tests) — verified against the real tree by the "all gated sites detected" test.
const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'try', 'else', 'do', 'finally']);

function findEnclosingOpenBrace(src: string, from: number): number {
  let depth = 0;
  for (let i = from - 1; i >= 0; i--) {
    const c = src[i];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

function matchCloseBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return src.length - 1;
}

function matchOpenParen(src: string, close: number): number {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (src[i] === ')') depth++;
    else if (src[i] === '(') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Strip line + block comments (for the guard-presence check only) so a comment that merely
 *  MENTIONS `guardDeveloping(` can't mask an ungated function. Brace matching runs on the raw
 *  source, not this stripped text, so it can't be thrown off by removed braces. */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function readWordEndingAt(src: string, end: number): string {
  let k = end;
  while (k >= 0 && /[A-Za-z0-9_$]/.test(src[k])) k--;
  return src.slice(k + 1, end + 1);
}

/** Is the block opened at `open` a function body (true) or a control-flow block (false)? */
function isFunctionBrace(src: string, open: number): boolean {
  let q = open - 1;
  while (q >= 0 && /\s/.test(src[q])) q--;
  if (q < 0) return true;
  // `=> {`  → arrow function
  if (src[q] === '>' && q >= 1 && src[q - 1] === '=') return true;
  // `) {`   → could be a function/method OR an `if (...) {` / `for (...) {` / `catch (...) {`
  if (src[q] === ')') {
    const openParen = matchOpenParen(src, q);
    if (openParen === -1) return true;
    let k = openParen - 1;
    while (k >= 0 && /\s/.test(src[k])) k--;
    const word = readWordEndingAt(src, k);
    return !CONTROL_KEYWORDS.has(word); // `if`/`for`/… → control; a function name → function
  }
  // otherwise the token before `{` is a word: `try {`, `else {`, `do {` → control; a return-type
  // identifier (`boolean {`, `void {`) → function body.
  const word = readWordEndingAt(src, q);
  return !CONTROL_KEYWORDS.has(word);
}

/** Source text of the function enclosing offset `idx`, or null if none found. */
function enclosingFunctionBody(src: string, idx: number): string | null {
  let pos = idx;
  for (let hops = 0; hops < 64; hops++) {
    const open = findEnclosingOpenBrace(src, pos);
    if (open === -1) return null;
    if (isFunctionBrace(src, open)) {
      return src.slice(open, matchCloseBrace(src, open) + 1);
    }
    pos = open; // control-flow block — search outward for the next enclosing brace
  }
  return null;
}

// ── Call-site enumeration ─────────────────────────────────────────────────
interface Site {
  file: string;      // absolute path
  base: string;      // basename
  index: number;     // offset of the call in the file
  line: string;      // trimmed text of the call's own line (for allow-list matching + messages)
  lineNo: number;    // 1-based line number (for messages)
  guarded: boolean;  // enclosing function calls guardDeveloping()
}

function lineInfoAt(src: string, index: number): { line: string; lineNo: number } {
  const start = src.lastIndexOf('\n', index) + 1;
  const nl = src.indexOf('\n', index);
  const end = nl === -1 ? src.length : nl;
  const lineNo = src.slice(0, index).split('\n').length;
  return { line: src.slice(start, end).trim(), lineNo };
}

function findSites(pattern: RegExp): Site[] {
  const sites: Site[] = [];
  for (const file of SOURCE_FILES) {
    const src = FILE_TEXT.get(file)!;
    const re = new RegExp(pattern.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const body = enclosingFunctionBody(src, m.index);
      const { line, lineNo } = lineInfoAt(src, m.index);
      sites.push({
        file,
        base: path.basename(file),
        index: m.index,
        line,
        lineNo,
        guarded: body !== null && stripComments(body).includes('guardDeveloping('),
      });
    }
  }
  return sites;
}

// Base WRITES: method CALLS only (`.updateCurrentImageData(`); the method DEFINITION in
// ImageService has no leading dot and is correctly excluded.
const WRITE_SITES = findSites(/\.updateCurrentImageData\s*\(/);

// Base-pixel ANALYSIS primitives — the operations that consume base pixels to bake persisted
// params. CALLS only (leading dot); their definitions have no dot and are excluded. Add a new
// primitive's name here in the SAME change that introduces it (see KNOWN BOUNDARY above).
const ANALYSIS_PRIMITIVES = [
  /\.analyse\s*\(/,               // AutoAdjustService.analyse — histogram/levels/WB stats
  /\.autoAll\s*\(/,               // AutoAdjustService.autoAll — one-shot analyse + bucket
  /\.autoDetectWhiteBalance\s*\(/, // WhiteBalanceModule.autoDetectWhiteBalance — gray-candidate WB
  /\.copyStyle\s*\(/,             // StyleAnalysisService.copyStyle — reads pixels into a fingerprint
  /\.pasteStyle\s*\(/,            // StyleAnalysisService.pasteStyle — reads target pixels to match
  /\.autoStraighten\s*\(/,        // CropModule.autoStraighten — bakes a pixel-derived angle+crop (v1.37.0 R2)
];
const READ_SITES = ANALYSIS_PRIMITIVES.flatMap((p) => findSites(p));

// ── Allow-lists ───────────────────────────────────────────────────────────
// A site is allowed iff an entry matches its basename AND its call line includes `contains`.
// Each entry was seeded by READING the site and verifying it is safe. Adding a site here is a
// CONSCIOUS decision that must carry a one-line justification.
interface Allow { base: string; contains: string; why: string }

const WRITE_ALLOWLIST: Allow[] = [
  {
    base: 'ImageService.ts',
    contains: 'this.updateCurrentImageData(rawData.data',
    why:
      'developFullDecode\'s own preview→full-res swap. This IS the moment `developing` clears; ' +
      'it is the resolution the guard protects, not a user action inside the window.',
  },
  {
    base: 'RawImageService.ts',
    contains: 'imageService.updateCurrentImageData(rawData.data',
    why:
      'reDecode replaces the base with a freshly-decoded full-res RAW buffer under its own ' +
      'in-flight (reDecoding) + identity guards; it is the decode path itself, not a ' +
      'preview-window pixel action (brief-designated safe exclude).',
  },
  {
    base: 'EnhanceService.ts',
    contains: 'imageService.updateCurrentImageData(new Float32Array(rp.data)',
    why:
      '_popAndRestore has TWO callers: revert() (gated with guardDeveloping) and unwindToDepth() ' +
      '(ungated, but a no-op during developing — the restore stack is provably empty in that ' +
      'window: onImageSwitched clears it on every fresh open and the only pusher, applyUpscale, ' +
      'is itself gated). A new caller that can run with a non-empty stack during developing ' +
      'must be gated.',
  },
];

const READ_ALLOWLIST: Allow[] = [
  {
    base: 'AutoAdjustService.ts',
    contains: 'const stats = this.analyse(data, width, height)',
    why:
      'Service-internal: autoAll() re-analyses its own caller-supplied buffer. Every autoAll() ' +
      'call site is itself gated (AutoAllService.applyAutoAll since v1.37.0 R2).',
  },
  {
    base: 'CropModuleComponent.tsx',
    contains: 'const success = module.autoStraighten(imgData.data, context)',
    why:
      'The crop card\'s ⚡ reads the PROCESSED PREVIEW buffer (store processedImageData), never ' +
      'base pixels. Tilt geometry is identical between the embedded preview and the full decode, ' +
      'so an angle baked during developing stays valid after the swap.',
  },
  {
    base: 'TransformModuleComponent.tsx',
    contains: 'const success = module.autoStraighten(imageData, context)',
    why:
      'Archived component (src/components/Modules/archive) — not rendered anywhere; kept only as ' +
      'reference source. No runtime path reaches it.',
  },
  {
    base: 'TransformPipelineModule.ts',
    contains: 'const success = this.transformModule.autoStraighten(input, transformContext)',
    why:
      'Archived module (src/modules/archive) — never registered in the pipeline. No runtime path ' +
      'reaches it.',
  },
];

function matchAllow(list: Allow[], site: Site): Allow | undefined {
  return list.find((a) => a.base === site.base && site.line.includes(a.contains));
}

function describe_(site: Site): string {
  return `${site.base}:${site.lineNo}  ${site.line}`;
}

// ── Tests ─────────────────────────────────────────────────────────────────
describe('developing-guard tripwire — base-pixel actions must gate during progressive RAW open', () => {
  test('found the expected call surfaces (scan sanity — patterns still match reality)', () => {
    // If these drop to 0 the scan silently stopped enforcing anything (renamed API, moved files).
    expect(WRITE_SITES.length).toBeGreaterThanOrEqual(9);
    // v1.37.0 R2: 6 analyse + 1 autoAll + 2 autoDetectWB + 2 copy/pasteStyle
    // + 4 autoStraighten (crop card, 2 archived, AutoAllService) = 15. Update
    // this floor CONSCIOUSLY when adding/removing a primitive call site.
    expect(READ_SITES.length).toBeGreaterThanOrEqual(15);
  });

  test('every base WRITE (updateCurrentImageData) is guarded or consciously allow-listed', () => {
    const offenders = WRITE_SITES.filter((s) => !s.guarded && !matchAllow(WRITE_ALLOWLIST, s));
    expect(
      offenders.length === 0
        ? offenders
        : offenders.map(describe_),
    ).toEqual([]);
  });

  test('every base-pixel ANALYSIS read is guarded or consciously allow-listed', () => {
    const offenders = READ_SITES.filter((s) => !s.guarded && !matchAllow(READ_ALLOWLIST, s));
    expect(
      offenders.length === 0
        ? offenders
        : offenders.map(describe_),
    ).toEqual([]);
  });

  test('allow-lists are not stale — every entry still matches exactly one real ungated site', () => {
    const ungatedWrites = WRITE_SITES.filter((s) => !s.guarded);
    for (const a of WRITE_ALLOWLIST) {
      const hits = ungatedWrites.filter((s) => s.base === a.base && s.line.includes(a.contains));
      expect({ entry: a.contains, hits: hits.length }).toEqual({ entry: a.contains, hits: 1 });
    }
    const ungatedReads = READ_SITES.filter((s) => !s.guarded);
    for (const a of READ_ALLOWLIST) {
      const hits = ungatedReads.filter((s) => s.base === a.base && s.line.includes(a.contains));
      expect({ entry: a.contains, hits: hits.length }).toEqual({ entry: a.contains, hits: 1 });
    }
  });

  test('walker sanity — the in-function-gated sites are actually detected as gated', () => {
    // Guards against a walker regression silently reporting a gated site as ungated (a false
    // positive that the author would "fix" by needlessly allow-listing). These six are gated
    // WITHIN their own function (5 App transforms + EnhanceService.applyUpscale).
    const gatedWriteFns = WRITE_SITES.filter((s) => s.guarded);
    expect(gatedWriteFns.length).toBeGreaterThanOrEqual(6);
    // applyUpscale's mutate is nested inside a try{} — proves the walk-out-of-control-flow works.
    const upscale = WRITE_SITES.find(
      (s) => s.base === 'EnhanceService.ts' && s.line.includes('updateCurrentImageData(enhanced'),
    );
    expect(upscale?.guarded).toBe(true);
    // Task S4: applyMotionDeblur is a NEW base-writer (bakes the deblurred image). Its
    // updateCurrentImageData must be detected as gated (guardDeveloping at the function top) —
    // registering the new entry point on this tripwire as the KNOWN BOUNDARY doc requires.
    const deblur = WRITE_SITES.find(
      (s) => s.base === 'EnhanceService.ts' && s.line.includes('updateCurrentImageData(new Float32Array(base)'),
    );
    expect(deblur?.guarded).toBe(true);
  });
});
