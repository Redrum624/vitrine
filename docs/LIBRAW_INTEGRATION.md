# RAW Decode Architecture (LibRaw)

This document describes how RAW files are actually decoded today. It replaces an
earlier version of this file that documented a WebAssembly-in-the-browser design
(`LibRawWasm.ts` / `AdvancedRawProcessor.ts` / `AdvancedRawModule.tsx`) that was
never real — `LibRawWasm` returned a hardcoded 4000×3000 gray image regardless of
input, and the components around it were removed once that was discovered
(`chore(raw): wasm fallback rung audited`). None of those files exist anymore.

## Decode flow

```
Renderer                         Main process (Electron)
────────────────────────────     ──────────────────────────────────────
RawImageService.loadRawImage()
  → window.electronAPI
      .decodeRawFile(path, opts)
                                  preload.cjs bridges to
                                  ipcMain.handle('decode-raw-file', …)
                                  in electron/main.cjs
                                            │
                                            ▼
                                  electron/rawDecoder.cjs
                                  decodeRawFile(filePath, log, options)
```

`decodeRawFile` tries three engines in order, each returning the same contract
(`{ data, width, height, channels, bitDepth }`), falling through on failure:

1. **Native `dcraw_emu`** (`decodeNative`, `vendor/libraw/dcraw_emu.exe`) — a true
   Bayer demosaic of the sensor data: camera white balance, sRGB primaries/gamma,
   16-bit output. Runs the bundled binary against a temp copy of the file and
   parses the resulting 16-bit PPM (`parsePpm16`). This is the normal path and
   what the rest of the app assumes ("a balanced but ungraded starting point").
2. **`libraw-wasm` in a Node `worker_thread`** (`decodeWasm` →
   `electron/librawWasmNode.cjs`) — the same true demosaic without the native
   binary, used only when step 1 throws (binary missing, decode failure, etc.).
   Noticeably slower (~10s/file); runs in a dedicated worker so a bad file can't
   wedge the main process.
3. **Embedded JPEG extraction** (`decodeEmbeddedJpeg`, via `sharp`) — last
   resort. Parses the RAW file's TIFF/IFD header for sensor dimensions, locates
   the largest embedded JPEG preview (`electron/embeddedPreview.cjs`), and
   upscales it to sensor size with Lanczos3. This is the camera's own
   already-graded rendering (looks like the out-of-camera JPEG), not a fresh
   demosaic — decode options below don't apply to it.

If all three throw, `decodeRawFile` rethrows and `RawImageService.loadRawImage`
propagates the error (no silent fallback to a placeholder image).

There is **no** renderer-side RAW decoder. A former iframe-isolated `libraw-wasm`
fallback (`src/services/LibRawService.ts` + `public/libraw-worker-frame.html`) was
removed in round-6 Task P9: it re-ran the identical `libraw-wasm` build the main
process had just failed on (so it added zero decode capability the main-process
chain lacked), and it could not even read the file without `window.electronAPI`.
In a non-Electron/browser context `decodeRawFile` therefore surfaces an error
rather than returning fabricated pixels.

## Per-image decode options

`RawDecodeOptions` (`src/types/electron.ts`):

```typescript
type DemosaicAlgo = 'ahd' | 'dcb';
type HighlightMode = 'off' | 'blend' | 'reconstruct';
interface RawDecodeOptions { demosaic: DemosaicAlgo; highlightMode: HighlightMode; }
// Default: { demosaic: 'dcb', highlightMode: 'blend' }
```

These are set per image from the RAW Decode panel and threaded end-to-end:
`RawImageService.reDecode(options)` → `loadRawImage(path, options)` → the
`decode-raw-file` IPC call → `decodeRawFile(filePath, log, options)`, which maps
them onto whichever engine actually runs:

| option | native `dcraw_emu` flag | libraw-wasm field |
|---|---|---|
| `demosaic: 'ahd'` / `'dcb'` | `-q 3` / `-q 4` | `userQual: 3` / `4` |
| `highlightMode: 'off'` | (omitted — LibRaw default = clip) | (omitted) |
| `highlightMode: 'blend'` | `-H 2` | `highlight: 2` |
| `highlightMode: 'reconstruct'` | `-H 5` | `highlight: 5` |

The embedded-JPEG fallback ignores both options (there is no demosaic to steer).

`reDecode()` re-runs the decode with the new options, re-checks the user hasn't
switched images while the async decode was in flight, then replaces the cached
base + working image and clears the processing pipeline's cache so existing
module edits re-apply on top of the fresh base. It does **not** push a History
checkpoint — decode options are a property of the base image, orthogonal to the
module-edit timeline (see the doc comment on `reDecode` for the full reasoning).

## Base-image cache

`ImageCacheService` (`src/services/ImageCacheService.ts`) keeps decoded RAW/regular
base pixels under a dedicated `__BASE__` key namespace (`setBase`/`getBase`),
with its own 700MB LRU budget entirely separate from the 500MB budget used by
sized/thumbnail cache entries — a base eviction can never take a sized entry and
vice versa. This is what lets the app hold several large RAW bases in memory in
the same session (e.g. after switching between a few open images) without a
prefetch or thumbnail stealing that room, and lets a reopened image serve
straight from cache instead of re-running a multi-second decode. `reDecode()`
overwrites the same base-cache key for the current path, so the cache can never
serve pixels from stale decode options.

## Where things live

| Piece | File |
|---|---|
| IPC handler | `electron/main.cjs` (`ipcMain.handle('decode-raw-file', …)`) |
| Preload bridge | `electron/preload.cjs` (`decodeRawFile`) |
| Decode fallback chain | `electron/rawDecoder.cjs` |
| libraw-wasm worker driver | `electron/librawWasmNode.cjs` |
| Embedded-JPEG preview finder | `electron/embeddedPreview.cjs` |
| Renderer entry point | `src/services/RawImageService.ts` |
| Decode options type + defaults | `src/types/electron.ts` |
| Base-image cache | `src/services/ImageCacheService.ts` |
| RAW Decode panel (UI) | `src/components/Panels/RawDecodePanel.tsx` |
