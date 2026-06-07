# Changelog

All notable changes to **Photo Editor Pro** are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and this
project adheres to [Semantic Versioning](https://semver.org/).

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
