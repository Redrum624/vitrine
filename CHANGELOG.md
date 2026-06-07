# Changelog

All notable changes to **Photo Editor Pro** are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and this
project adheres to [Semantic Versioning](https://semver.org/).

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
