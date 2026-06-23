# Changelog

All notable changes to **Photo Editor Pro** are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [1.7.2] - 2026-06-23

### Fixed
- **First image (and intermittent later loads) rendered black on the GPU canvas.** Cause:
  `present()` depended on a *separate* effect having sized the GL drawing buffer; when it
  ran first (canvas still 0×0) the v1.7.1 guard skipped the frame and nothing ever
  re-presented, so it stayed black. A second trigger: the ~150 ms histogram readback
  resized — and therefore cleared — the buffer with no re-present. Fix: `present()` now
  owns the drawing-buffer size (sized from the resident result dimensions, assigned only
  when it differs), and `redrawCanvas()` no longer writes the GL drawing buffer in GPU
  mode, eliminating the resize-fight. Affects: `src/shaders/GpuPreviewPipeline.ts`,
  `src/components/Layout/Canvas.tsx`.
- **Tone-curve-edited images rendered as a red gradient.** Cause: in the GPU render loop
  the tone-curve LUT upload called `uploadLut()` (which binds + `texImage2D`s on the
  *active* texture unit) **before** selecting the LUT's unit — while unit 0 still held the
  input image — so creating the LUT clobbered unit 0 and the shader's `u_image` sampled an
  R32F LUT instead of the photo. Fix: select the LUT's texture unit before uploading, so
  unit 0 stays the image. Affects: `src/shaders/GpuPreviewPipeline.ts`.
- **A faulty GPU shader corrupted the preview instead of falling back.** Cause: the
  GPU-vs-CPU self-test detected mismatched shaders but its result was only logged
  (dev-only) and never acted on. Fix: the self-test now runs in dev **and** production and
  reports the failing module IDs; `buildPassList` routes those to the CPU bridge, so any
  GPU pass that doesn't match its CPU reference (e.g. local adjustments) falls back to the
  proven CPU path rather than shipping a corrupted frame. Affects:
  `src/shaders/GpuPreviewPipeline.ts`, `src/shaders/passDescriptors.ts`, `src/App.tsx`.
- **Star ratings didn't persist across sessions.** Cause: ratings were written to the file
  (`xmp:Rating`) but never read back — the in-memory store reset to empty on load. Fix:
  added a `read-image-rating` IPC (embedded XMP for standard formats, sidecar `.xmp` for
  RAW) and seed each thumbnail's rating from the file on load. Affects: `electron/main.cjs`,
  `electron/imageWriter.cjs`, `electron/preload.cjs`, `src/types/electron.ts`,
  `src/components/Panels/ThumbnailPanel.tsx`.
- **RAW thumbnails showed in the wrong orientation.** Cause: the embedded-preview JPEG was
  handed to sharp with no auto-orient, and for Olympus ORF the orientation lives in the RAW
  container's IFD0, not the preview's EXIF. Fix: auto-orient from the preview's own EXIF
  when present, otherwise apply the container's IFD0 Orientation (tag 0x0112); the DNG
  fallback is auto-oriented too. Affects: `electron/main.cjs`, `electron/embeddedPreview.cjs`.

### Changed
- **Export diagnostics.** The export path already re-decodes the original and re-applies the
  full module pipeline (confirmed by a new regression test); added logging that reports how
  many modules are active per export so any "missing edits" report can be traced to module
  state rather than guessed. Affects: `src/components/Dialogs/ExportDialog.tsx`.

## [1.7.1] - 2026-06-16

### Fixed
- **Every image rendered upside-down on the GPU canvas.** Cause: the present vertex
  shader applied an extra vertical flip (`v_uv.y = 1.0 - unit.y`), but the source upload
  doesn't flip Y and the render+readback path preserves orientation (so the GPU-vs-CPU
  self-tests, which exercise render+readback and not `present()`, still passed). Fix: the
  present pass now samples `v_uv = vec2(unit.x, unit.y)`, matching the render/readback
  convention. Affects: `src/shaders/sources.ts`.
- **GL canvas went black after minimizing and restoring the window.** Cause: the GPU
  canvas is presented on demand (not every frame), but its WebGL2 context was created
  without `preserveDrawingBuffer`, so Chromium cleared the volatile drawing buffer after
  any composite that wasn't immediately followed by a `present()`. Fix: create the context
  with `preserveDrawingBuffer: true` and re-present when the window regains focus /
  visibility. Affects: `src/shaders/GpuPreviewPipeline.ts`, `src/components/Layout/Canvas.tsx`.
- **First image of a session rendered as red-and-black garbage.** Cause: on the very first
  GPU frame `present()` could run before the GL canvas drawing-buffer was sized (width/
  height still 0), so the destination-rect math divided by zero → `NaN` clip coordinates →
  a degenerate frame. Fix: `present()` now skips a frame when the canvas is not yet sized;
  the sizing pass then triggers a correct re-present. Affects: `src/shaders/GpuPreviewPipeline.ts`.
- **"Before / After" showed an edited "before" after switching images and returning.**
  Cause: the GPU before/after split sampled the editing *base* texture (`currentImage.data`,
  which rotate/flip/Auto-All bake in place via `updateCurrentImageData`) instead of the
  pristine original. Fix: disable the GPU split and rely on the dedicated `OriginalPane`,
  which draws the pristine `imageService.getOriginalImage()` snapshot in both CPU and GPU
  modes — a single source of truth for the "before" half. Affects: `src/components/Layout/Canvas.tsx`.

## [1.7.0] - 2026-06-16

### Added
- **Resident-texture WebGL2 GPU pipeline for the live preview.** The image is uploaded
  to the GPU once; every editing module runs as a fragment-shader pass ping-ponging
  between RGBA32F float textures, and the final result is **presented directly to the
  canvas with zero GPU→CPU readback** (on a dedicated WebGL canvas; the previous
  2D-canvas path stays as the CPU fallback, switched by a `renderMode` store flag). This
  replaces the old per-module GPU calls that copied pixels back to the CPU between every
  step. All editing modules now have a GPU path: Exposure, White Balance, Basic
  Adjustments, Tone Curve, Color Balance, Lens distortion/CA/vignetting,
  Shadows/Highlights, Sharpen (separable unsharp mask, multi-pass), and Local Adjustment
  masks (one mask-blend pass per layer). Why: real-time slider feedback without the
  per-module readback stalls. Files: `src/shaders/GpuPreviewPipeline.ts`,
  `passDescriptors.ts`, `sources.ts`, `uniforms.ts`, `Canvas.tsx`, `AdjustmentPanel.tsx`.
- **CPU fallback runs off the renderer main thread.** When WebGL2 is unavailable or an
  active operation has no GPU path, the preview pipeline runs in a **Web Worker** instead
  of blocking the UI. The worker is a Vite module worker that imports the real
  `ImageProcessingPipeline` — no duplicated pixel math (the old hand-ported worker that
  kept diverged copies of 5 modules was retired). The worker returns output dimensions so
  cropped previews stay correct across the worker boundary, with a graceful main-thread
  fallback if the worker can't be used. Files: `src/workers/pipeline.worker.ts`,
  `WebWorkerImageProcessor.ts`, `previewRouting.ts`.

### Changed
- **Export resize moved off the renderer thread.** Full-resolution downscaling now runs
  via **sharp in the Electron main process** (Lanczos3) for the common path, instead of a
  per-pixel bicubic loop on the UI thread — exports no longer freeze the window. The
  watermark path keeps the renderer-side resize (so the watermark composites at output
  size); 16-bit (true ushort) and ICC handling are unchanged, with a guard against
  double-resizing. Files: `electron/imageWriter.cjs`, `src/services/ExportService.ts`.

### Safety / correctness
- Every GPU operation keeps its CPU reference and a startup **GPU-vs-CPU self-check**; the
  GPU path is used only when it matches the CPU within tolerance. `renderMode` defaults to
  CPU and only flips to GPU once a render succeeds, so a machine without working WebGL2
  behaves exactly as before. Test suite: 1027 passing (was 920).

## [1.6.0] - 2026-06-12

### Changed
- **Export defaults.** Color Space now defaults to **Adobe RGB** and Bit Depth to the
  **highest the chosen format supports** (16-bit for PNG/TIFF, 8-bit for JPEG/WebP —
  switching format auto-adjusts the depth); Dimensions stay "original". Note: a
  16-bit + wide-gamut combination is currently written as 8-bit on disk (sharp can't
  embed a wide-gamut ICC into a 16-bit file without a colour shift) — pick sRGB when
  true 16-bit output matters more than the wider gamut.
- **Single-image export UX.** The export dialog **closes immediately** and progress is
  shown in the same cancellable top-left bar that multi-export uses. Cause of the old
  "stuck for minutes" feel: the full-resolution pipeline ran synchronously on the UI
  thread — with leftover per-module debug pixel scans making it far slower — freezing
  the window until done. The debug scans are removed and the pipeline now reports
  progress and yields between modules. Files: `ImageProcessingPipeline`, `ExportDialog`,
  `ExportService`.
- **Filmstrip selection visuals unified.** One blue hierarchy: the image open on the
  canvas gets a solid blue border + subtle glow; other multi-selected thumbnails get a
  dimmer blue border. The competing white border, white corner dot, and blue check
  badge were removed (deselect with **Ctrl/Cmd+click**).

### Fixed
- **Rating a photo no longer refreshes the filmstrip and jumps to the first
  thumbnail.** Cause: the `xmp:Rating` write modified the file inside the watched
  folder → `fs.watch` fired → full folder reload → a brand-new `images` array →
  the strip re-rendered from scratch and lost its scroll position. Fix: app-initiated
  writes (ratings, exports, metadata) are registered in `electron/selfWriteRegistry.cjs`
  and the watcher ignores them (race-free debouncer that still honours genuine external
  changes), and folder reloads that yield an identical file list keep the existing
  array reference (`src/utils/imageList.ts`). Affects: `main.cjs`, `App.tsx`.
- **Memory leaks.** (1) Full-resolution exports (single, multi, batch) parked a
  Float32 copy of the image **per pipeline module** in the preview cache — hundreds of
  MB to multiple GB per export; exports now skip the module cache (preview caching
  unchanged). (2) The filmstrip thumbnail cache was unbounded — now capped at 400
  entries with FIFO eviction (evicted thumbs lazily reload on scroll). (3) Stale
  `photoapp-raw-*` temp folders left behind by interrupted RAW decodes are swept at
  startup (>24 h old). (4) Every filmstrip scroll event re-issued thumbnail IPC
  fetches for already-loaded thumbs — loads are now ref-guarded. Affects:
  `ImageProcessingPipeline`, `ExportDialog`, `MultiExportService`,
  `BatchProcessingService`, `ThumbnailPanel`, `rawDecoder.cjs`, `main.cjs`.

## [1.5.0] - 2026-06-09

### Added
- **Sharpen module** (right sidebar, under Noise Reduction). A non-destructive
  unsharp-mask develop module with live **Amount / Radius / Detail** sliders. It runs
  inside the pipeline, so the canvas preview and the export match exactly. This
  replaces the old export-only "Output Sharpening". Files: `SharpenModule.ts`,
  `SharpenModuleComponent.tsx`, `ImageProcessingPipeline`, `AdjustmentPanel`, `IconSidebar`.
- **Blur & Film Grain in Lens Corrections** (non-destructive). Two new collapsible
  sections — **Blur** (Gaussian radius) and **Film Grain** (Amount + Grain Size,
  deterministic/seeded so it doesn't shimmer between preview and export) — relocated
  from the removed Filter menu. Files: `LensCorrectionsModule(.ts/Pipeline)`,
  `LensCorrectionsModuleComponent`.

### Changed
- **Auto White Balance is now median gray-world.** The White Balance panel's **Auto**
  button *and* **Auto All** scan the image's overall **median** colour cast and
  neutralise **both warmth (temperature) and tint**, inverting the module's own gain
  model so the corrected median is genuinely neutral. Cause of the old behaviour: it
  only gently nudged `meanR/meanB` toward a style-profile target (and used the mean),
  so it under-corrected. Files: `WhiteBalanceModule.ts`, `AdjustmentPanel`, `App`.
- **Sidebar order.** Color Balance moved to directly under White Balance; the new
  Sharpen module sits under Noise Reduction.
- **Lens Corrections** was silently inert in the live pipeline — its wrapper required
  a top-level `enabled` flag nothing ever set, so Vignetting/Distortion/Chromatic
  Aberration never ran. Enablement is now derived from the sections, so those
  corrections (and the new Blur/Film Grain) actually apply.
- **Toolbar export button** renamed **"Save" → "Export"**.
- **Seamless zoom-out.** The canvas background now matches the surrounding container,
  so a zoomed-out image no longer sits in a lighter-grey rectangle with a border.
  (Full-window zoom-in remains a planned follow-up.)

### Removed
- **Filter menu** removed from the menu bar. Its **Blur** and **Film Grain** moved
  into Lens Corrections (non-destructive); **Sharpen** and **Noise Reduction** are
  sidebar modules. The orphaned `FilterDialog` component was deleted.
- **Export "Output Sharpening" tab** removed — sharpening is now the Sharpen develop
  module, and export presets no longer apply export-time sharpening (prevents
  double-sharpening on top of the module).
- **File → New…** menu item removed (a placeholder that opened the Welcome screen;
  the Welcome screen is still under the **Window** menu).

### Fixed
- **Thumbnail selection checkmark couldn't be cleared.** Re-clicking a selected
  thumbnail kept the blue check. Cause: plain-click always re-selected and the check
  badge had no handler. The badge is now a clickable **"Deselect"** toggle, and
  re-clicking the sole-selected thumbnail clears it.

## [1.4.1] - 2026-06-08

### Fixed
- **Keyboard shortcuts died after the first image / tool change.** The keyboard
  init effect's cleanup called `destroy()`, removing the document keydown listener
  that is only added in the service constructor; re-registration never re-added it.
  `register()` now re-attaches the listener idempotently. This is why the **1–5 / 0
  rating keys** appeared not to work.
- **RAW export came out as noise.** Noise Reduction (disabled by default) was not
  recognised as a no-op, so it ran on every export and its full-resolution GPU pass
  corrupted the image. Disabled / identity modules are now correctly skipped — which
  also means **untouched modules are no longer processed** (faster export). In
  addition, the WebGL pipeline now falls back to the CPU above a safe texture size,
  and **output sharpening defaults to off** (it amplified RAW noise).
- **Single-image export** now uses the `_PEP` suffix (matching multi-export) instead
  of `_exported`.
- **Lens Corrections checkboxes** desynced after Vignetting **Auto-detect**; toggles
  and sliders are now applied to the module and the panel stays in sync.
- **The last-used mask couldn't be hidden** — re-click its chip to deselect it.
- **Mask dragging** is responsive again: the mask is baked at preview resolution
  during the drag (full resolution only for export), so handles react immediately.

### Changed
- **Numpad rating.** The numpad number keys now rate the current photo regardless of
  Num Lock, and no longer trigger image navigation.

### Removed
- **Non-functional placeholder features.** Removed the Lens Corrections **Lens
  Profile** section (it applied no correction and had no lens database), the
  **Plugin Manager** (a stub that did nothing — its store read "Coming Soon"), and
  the Welcome screen's fake **Recent Files**, decorative export-presets panel, and
  no-op tour button.

## [1.4.0] - 2026-06-08

### Added
- **Star rating on the canvas.** A larger, always-visible 5-star control sits at the
  bottom-right of the canvas whenever an image is open, mirroring the filmstrip
  thumbnail stars (click a star to set, click the active star to clear). Pressing
  **1–5** rates the current image and **0** clears it. The rating is written to the
  file (`xmp:Rating`) and stays in sync with the thumbnail.
- **Multi-export.** Select several photos in the filmstrip — **Ctrl/Cmd+click** to
  toggle individual ones, **Shift+click** to select a contiguous range — then click
  **Export N** to export them all with the same settings, chosen once in the Export
  dialog. Each photo is re-decoded at full resolution and exported with **its own**
  saved edits applied (an unedited photo never inherits another's edits). Files are
  written into a chosen folder as `<name>_PEP.<ext>` and auto-suffixed (`_PEP_1`,
  `_PEP_2`, …) so an existing file is never overwritten. A cancellable progress bar at
  the top-left shows "Exporting X of N", and a summary toast reports how many
  succeeded / failed.

### Changed
- **Exported filenames use the `_PEP` suffix** (single and multi export), e.g.
  `photo_PEP.jpg` instead of `photo_exported.jpg`.

### Fixed
- **Corrupted RAW exports.** Exporting a RAW file (ORF/CR2/NEF/…) produced a
  scrambled image — the exporter pulled the small embedded preview (~300×200)
  through the full-resolution pipeline. RAW files are now decoded at full
  resolution for export. Affected all output formats.
- **Masks couldn't be hidden.** Clicking an already-selected mask's button now
  deselects it, hiding the per-mask sliders and the on-canvas overlay.
- **Mask dragging now previews live.** Moving / resizing / rotating a mask on the
  canvas updates the masked adjustment during the drag (throttled), not only on
  release.

## [1.3.1] - 2026-06-07

### Fixed
- **Export produced a malformed path on Windows** (`C:\…\Desktop/C:\…\image.jpg` →
  "unable to open for write", all formats). The basename was split on `/` only, but
  Windows source paths use backslashes, so the whole absolute path was appended to the
  chosen folder. Now splits on both separators and joins folder + basename. Large 16-bit
  TIFFs also use BigTIFF to avoid the classic 4GB / `0xFFFFFFFF` limit.
- **Image went blurry when using Noise Reduction and then editing something else.** A slow
  NR pass and a second edit could run two pipeline passes concurrently through the shared
  GPU processor, corrupting the output. Passes are now serialized (synchronous guard) and
  a queued edit re-runs when the current pass finishes.
- **`npm run build:win` failed at the installer step from an elevated shell** — NSIS temp
  files in `C:\WINDOWS\TEMP` were swept mid-compile. The build now runs through a wrapper
  that points `TEMP`/`TMP` at the per-user temp.

### Changed
- **History checkpoints are labelled by the actual change** (e.g. "White Balance —
  Tint -4.00", "Lens Corrections — Barrel -15") instead of just the module name.

## [1.3.0] - 2026-06-07

### Added
- **History module.** A new sidebar tool (under Lens Corrections) showing a per-image
  checkpoint timeline. Every committed edit is auto-recorded as a labelled checkpoint;
  the full list is kept and you can click any checkpoint to restore that state (it never
  truncates later ones). Persisted per image in the durable store — survives sessions and
  app updates — and seeded with an "Opened" baseline. Separate from the Ctrl+Z undo/redo.
- **Lens Corrections redesign.** The 4-tab pill selector is now an accordion of clear
  category sections — Distortion, Vignetting, Chromatic Aberration, Lens Profile — each a
  collapsible card with its own enable toggle and reset (plus auto-detect for vignetting),
  so all categories are visible and divided at a glance.

### Fixed
- **Auto white balance was too green.** The standalone WB "Auto" button now uses the same
  user-style-profile white balance as Auto All, and the green/magenta tint is computed
  toward neutral (ratio-based, negative removes green) instead of the previous weak /
  wrong-signed correction that left images too green.
- **RAW thumbnails** try the embedded-JPEG extractor first (no misleading "sharp failed"
  noise for ORF) and are cached in the main process, so scrolling the filmstrip no longer
  re-decodes the same previews.
- **Splash screen** now appears fully painted instead of blank-then-fill (it was shown
  before its content rendered, and had a fade-in entrance).
- **Dev script** no longer hangs on "Cleaning up processes…" at shutdown (run-once guard
  + synchronous force-kill of the child process trees).
- Removed hardcoded placeholder stats (`6000 × 4000 / 24.0 MP / sRGB`) from the toolbar;
  the real values are in the footer status bar.

## [1.2.0] - 2026-06-07

### Added
- **Per-image edit persistence.** Edits now survive sessions **and** app updates. A new
  durable JSON store under Electron `userData` (outside the install dir) keeps every
  pipeline module's params + Local Adjustment layers (geometry only — the mask is rebuilt
  on load) keyed by the image's file path. Saved debounced on edit, when switching images,
  and on app close; restored automatically when you reopen a photo. (Settings already
  persisted via localStorage.)
- **Local Adjustments — graduated filter gradient.** The linear mask is now a proper
  one-sided graduated filter: a line through the centre, effect on one side, with a
  rotate handle and move-by-dragging-the-line. Feather is the spread — 0.5 ramps the
  effect 100% at the edge to 0% at the line; 1.0 is a solid full-effect rectangle.
- **Local Adjustments — rotate, delete, off-image masks.** Radial masks gain a rotation
  handle; **Delete/Backspace** removes the selected mask; masks may extend outside the
  image. The per-mask sliders moved under the mask buttons in a lighter card. Clicking
  the canvas off the handles deselects/hides the mask.
- **Noise Reduction — explicit Apply button.** No more algorithm dropdown (single engine);
  the sliders stage settings and NR runs only on **Apply** (with the canvas spinner), never
  on slider change.
- **Thumbnails.** Lazy-load (only visible + a margin), a **RAW** badge, brighter star
  outlines, and star ratings written to the file (`xmp:Rating`). Any range slider is now
  **wheel-adjustable** on hover. Removed the redundant status-bar clock.
- **Histogram** now stacks below the Controls instead of overlapping them.

### Fixed
- **RAW thumbnails for Olympus ORF (and similar).** The embedded-JPEG extractor scanned
  bytes for `FF D8 .. FF D9`, but those markers also occur inside entropy-coded data, so
  the preview came out truncated or spanning two images ("Corrupt JPEG / found marker
  0xd8 instead of RST"). Now it parses the JPEG marker structure to bound each preview
  exactly (ORF keeps its preview in the MakerNote); reads are capped before the raw strip.
- **Masked edits did nothing.** Masks were baked at full resolution but the pipeline runs
  a downscaled preview, so the mask indexed the wrong pixels. The mask is now rebuilt at
  the processing resolution — which also makes Local Adjustments export at full resolution.
- **Blurry/soft image after adding a mask + changing WB Tint.** The canvas `backdrop-blur`
  processing overlay could get stuck on. The spinner is now guarded by a per-run id (can't
  orphan), and a neutral mask skips its full-image pass so it no longer slows reprocessing.

## [1.1.0] - 2026-06-07

### Added
- **GPU acceleration (WebGL2).** A new `WebGLImageProcessor` runs the editing
  pipeline on the GPU: uploads RGBA Float32 → float texture → fragment-shader pass →
  RGBA32F framebuffer → Float32 readback. GPU-accelerated: **Basic Adjustments,
  White Balance, Color Balance, Tone Curve, Hue Curves, Lens vignetting, Lens
  distortion, Lens chromatic aberration**, and a **GPU Non-Local-Means** noise
  reducer (replaces the slow CPU BM3D — sub-second even on RAW). Each op carries a
  CPU reference and an init **self-check**: the GPU path is used only if its output
  matches the CPU within tolerance, so a faulty shader silently falls back rather
  than corrupting an image. Geometric ops (distortion/CA) use manual `texelFetch`
  bilinear to match the CPU exactly. Transparent: no UI change, automatic CPU
  fallback when WebGL2 is unavailable.

### Fixed
- **Hue Curves produced NaN when enabled.** Cause: `rgbToHsl` returns hue 0–360 and
  s/l 0–100, but the curve `sampleLUT` expects `[0,1]` (`idx = x*255`) → out-of-bounds.
  Fix: normalise h/360, s/100, l/100 after `rgbToHsl` and scale back before
  `hslToRgb`. Affects: `src/modules/HueCurvesModule.ts`.

### Changed
- **Default export is now PNG 16-bit** (was JPEG 8-bit). The pipeline is 32-bit
  float end-to-end; an 8-bit default discarded that precision. JPEG presets stay
  8-bit (JPEG is 8-bit only).

## [1.0.2] - 2026-06-07

### Fixed
- **Packaged RAW thumbnails (and export) were broken.** Cause: `sharp` is a native
  module but was not in electron-builder's `asarUnpack`, so its binding could not
  load from inside `app.asar` — `require('sharp')` failed in the built app, so RAW
  thumbnails (which need sharp) showed placeholders while JPEGs (no sharp) loaded
  fine. Fix: add `sharp` + `@img/**` to `asarUnpack`. Affects: `package.json`.
- **Lens Corrections tab pills** (Vignetting / Distortion / Chromatic / Profile)
  overflowed the selector on the narrow panel — the 4th spilled out. Fix:
  shrinkable pills (`min-w-0` + label truncation, tighter padding) so all 4 fit.

### Changed
- **Processing spinner** now appears for any adjustment that runs longer than
  ~0.8 s (e.g. noise reduction), not just Auto All / Paste Style — slow operations
  show feedback instead of looking frozen.
- **Noise Reduction "Auto"** no longer hangs on large images: above ~1 MP it uses
  the fast wavelet method instead of the heavy patch-based methods (BM3D / NLMeans
  / hybrid). A GPU-accelerated denoiser is being evaluated for full speed.

## [1.0.1] - 2026-06-07

### Fixed
- **RAW thumbnails not displaying.** Cause: the embedded-preview extractor read the
  entire RAW file and ran a synchronous `exifreader` parse on the full buffer for
  every thumbnail; the filmstrip requests all thumbnails at once, so this flooded
  the main process and starved the responses. Fix: bounded 24 MB read + fast native
  `Buffer.indexOf` scan, no `exifreader`. Affects: `electron/main.cjs`.
- **Welcome modal reappeared on every right-sidebar click.** Cause: the show-welcome
  effect had `selectedTool` in its dependencies, re-arming the 1 s timer on each tool
  change. Fix: show it once, on mount only. Affects: `src/App.tsx`.

### Changed
- **Filmstrip toggle.** The thumbnail panel's close (X) button is now a chevron
  (down/up) that collapses/expands the strip in place instead of closing it.
- **File → New…** added to reopen the Welcome / open-folder modal on demand.

## [1.0.0] - 2026-06-07

First release — a desktop RAW photo editor (Electron + React + a WebGL2/CPU
processing pipeline).

### Added
- Non-destructive editing modules: **Crop & Transform**, **Basic Adjustments**
  (exposure, contrast, highlights, brightness, black point, shadows, dehaze,
  saturation, vibrance), **White Balance**, **Tone Curve**, **Noise Reduction**,
  **Color Balance**, **Lens Corrections**.
- **Local Adjustments**: radial (circle/oval) and linear gradient masks with
  drag-to-place / move / resize on the canvas, per-mask feather, and a per-mask
  "second Basic Adjustments" panel — created from buttons at the top of Basic
  Adjustments.
- **RAW processing**: native LibRaw demosaic (`dcraw_emu`) with libraw-wasm and
  embedded-JPEG fallbacks.
- **Copy / Paste Style**: per-channel histogram matching to transfer a grade
  between images.
- **Auto adjustments**: per-image *Auto All* driven by a user-style profile, plus
  Auto Levels / Contrast / Color.
- **Export**: JPEG / PNG / TIFF / WebP, 8- and 16-bit, sRGB and wide-gamut
  (Adobe RGB / ProPhoto / Rec.2020) via generated ICC profiles, with EXIF/XMP
  metadata embedding.
- Filmstrip with star ratings and filtering, batch processing, presets,
  watermarking, web gallery, and print soft-proof.

### Fixed
- **16-bit export corruption** — exported 16-bit buffers were handed to sharp as
  8-bit raw, producing garbled files. Now written as true 16-bit (ushort +
  `toColourspace('rgb16')`), with depth-aware size validation.
- **Output sharpening** ran only a horizontal blur pass (directionally biased) —
  now a separable horizontal + vertical pass.
- **Paste Style / Auto All** changed the image but left the panel sliders stale —
  they now refresh, and the canvas shows an "Applying…" spinner.
- **Filmstrip** now scrolls left/right with the mouse wheel.
- **RAW thumbnails** — some RAWs showed no thumbnail because the embedded-preview
  scan was capped at the first 10 MB. Now scans the whole file (sharp →
  exifreader → full-file JPEG scan).

### Notes
- Windows build: `npm run build:win` (NSIS installer + portable; output in
  `release/`). The native LibRaw binaries and ICC profiles ship via
  electron-builder `extraResources`.
