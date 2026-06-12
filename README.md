# Photo Editor Pro 🎨

A **desktop RAW photo editor** built with Electron + React, featuring a WebGL2/CPU
processing pipeline, native LibRaw demosaicing, colour-managed export, and
non-destructive local adjustments.

![Version](https://img.shields.io/badge/Version-1.6.0-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-0_errors-blue)
![Tests](https://img.shields.io/badge/Tests-920_passing-brightgreen)
![Lint](https://img.shields.io/badge/Lint-clean-brightgreen)
![GPU](https://img.shields.io/badge/GPU-WebGL2_accelerated-success)

## 🌟 Features

### RAW processing
- **15+ RAW formats** — Canon CR2/CR3, Nikon NEF, Sony ARW, Olympus ORF, Adobe DNG,
  Panasonic RW2, Pentax PEF, and more.
- **True Bayer demosaic** in the Electron main process via native LibRaw
  (`dcraw_emu`), with `libraw-wasm` and embedded-JPEG fallbacks.

### Editing modules
- **Crop & Transform** — aspect ratios, rotation/straighten, flip.
- **Basic Adjustments** — exposure, contrast, highlights, brightness, black point,
  shadows, dehaze, saturation, vibrance. *(The old standalone Shadows & Highlights
  module was folded into Highlights/Shadows sliders here.)*
- **Local Adjustments** — radial (circle/oval) masks with a rotation handle, and a
  one-sided **graduated-filter** gradient (drag the line to move, the handle to rotate).
  Created from the top of Basic Adjustments; drag on the canvas to place / move / resize /
  rotate, click off to deselect, Delete to remove. Each mask gets its own Basic-Adjustments
  panel plus a feather control.
- **White Balance** (with **median gray-world Auto** that neutralises both warmth and
  tint), **Color Balance**, **Tone Curve** (with auto-levels), **Noise Reduction**
  (Apply button), **Sharpen** (unsharp-mask Amount / Radius / Detail), **Lens
  Corrections** (Distortion, Vignetting, Chromatic Aberration, plus non-destructive
  **Blur** and **Film Grain** sections).
- **Copy / Paste Style** — transfer a colour grade between images via per-channel
  histogram matching.
- **Auto adjustments** — one-click *Auto All* (its white-balance step uses the same
  median gray-world neutralisation as the WB panel's Auto button), plus Auto Levels /
  Contrast / Color.
- Non-destructive: adjustments are reversible and re-processed live, and **persist per
  image across sessions and app updates** (restored when you reopen a photo).
- **History** — a per-image checkpoint timeline of everything you've done; click any
  checkpoint to jump back to that state. Kept between sessions; separate from Ctrl+Z undo.

### GPU acceleration (WebGL2)
- The editing pipeline runs on the **GPU** when available: Basic Adjustments, White
  Balance, Color Balance, Tone Curve, Hue Curves, Lens vignetting/distortion/chromatic
  aberration, and a **GPU Non-Local-Means noise reducer** (sub-second even on RAW).
- Each GPU op carries a CPU reference and an init **self-check** — the GPU path is
  used only if its output matches the CPU within tolerance, so a faulty shader
  **falls back silently rather than corrupting an image**. Fully transparent, with
  automatic CPU fallback when WebGL2 is unavailable.

### Export & workflow
- **Export** (the toolbar **Export** button, or `Ctrl+E`) to JPEG / PNG / TIFF / WebP,
  8- and 16-bit (**defaults to PNG, Adobe RGB, and the highest bit depth the format
  supports** — switching format auto-adjusts the depth), in **sRGB or wide-gamut**
  (Adobe RGB / ProPhoto / Rec.2020) using generated ICC profiles, with **EXIF/XMP**
  metadata embedding. The dialog closes as soon as the export starts and a cancellable
  progress bar at the top-left tracks it. Sharpening is no longer a separate export
  option — the **Sharpen** module's result is baked into every export automatically.
- **Multi-export.** Select several photos in the filmstrip (**Ctrl/Cmd+click** to
  toggle individual ones, **Shift+click** for a contiguous range), then **Export N**
  writes them all with one set of settings — each with **its own saved edits** — into
  a chosen folder as `<name>_PEP.<ext>` (auto-suffixed `_PEP_1`, … so nothing is
  overwritten). A cancellable progress bar at the top-left tracks the run.
- **Star ratings** on the filmstrip thumbnails and a large bottom-right canvas overlay;
  press **1–5** to rate the open image (**0** clears), written to the file as
  `xmp:Rating`, plus rating-based filtering.
- Filmstrip (mouse-wheel scroll, collapsible, multi-select), **batch processing**,
  presets, watermarking, web-gallery generation, and print soft-proofing.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and a package manager (the repo is set up for **pnpm**; npm also works)
- Windows, macOS, or Linux · 8 GB+ RAM (16 GB+ recommended for large RAW files)

### Install & run (development)
```bash
git clone https://github.com/Redrum624/photo_app.git
cd photo_app
pnpm install            # or: npm install
pnpm run electron-dev   # Vite dev server + Electron
```

### Build a Windows release
```bash
npm run build:win       # clean dist + release -> tsc + vite build -> NSIS installer + portable (x64)
# Output: release/Photo Editor Pro Setup 1.5.0.exe  and  release/Photo Editor Pro 1.5.0.exe
npm run build:win:dir   # fast unpacked build (no installer)
npm run dist            # electron-builder for the current platform
```

## 🏗️ Architecture

### Technology stack
- **Desktop**: Electron 39
- **Frontend**: React 19 + TypeScript 5.9 + Vite 7 + Zustand 5
- **Styling**: Tailwind CSS 4
- **Processing**: WebGL2 GPU shaders + CPU pipeline + Web Workers; native LibRaw
  (`dcraw_emu`) and `libraw-wasm` for RAW; **sharp** for export encode/ICC/metadata
- **Build**: Vite + `tsc` + ESLint; packaging via electron-builder

### Core services
```
ImageProcessingPipeline   // module orchestration
rawDecoder.cjs            // main-process RAW demosaic (native -> wasm -> embedded JPEG)
imageWriter.cjs           // export encode (8/16-bit, ICC, EXIF/XMP) via sharp
ExportService             // format/quality/colour-space + wide-gamut conversion
StyleAnalysisService      // Copy/Paste Style (histogram matching)
AutoAdjustService         // Auto All driven by a user-style profile
LocalAdjustmentsModule    // radial/linear masks + per-mask adjustments
```

## 🧪 Development

```bash
npm run dev          # dev server (vite) + Electron via scripts/dev.cjs
npm run build        # tsc + vite build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint (0 problems)
npm run test         # jest (777 tests)
npm run test:e2e     # Playwright end-to-end tests
```

## 📚 Documentation

- **[CHANGELOG.md](CHANGELOG.md)** — release notes
- **[docs/USER_GUIDE.md](docs/USER_GUIDE.md)** — using the app
- **[docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md)** — system design
- **[docs/RAW_PROCESSING.md](docs/RAW_PROCESSING.md)** — LibRaw integration
- **[docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md)** — contributing

## 🤝 Contributing

1. Create a feature branch (`git checkout -b feat/your-feature`)
2. Make changes with proper TypeScript types
3. Keep `npm run typecheck`, `npm run lint`, and `npm run test` green
4. Commit with conventional commits and open a Pull Request

## 📄 License

MIT.

## 🙏 Acknowledgments

- **LibRaw** — RAW decoding · **sharp / libvips** — image encode & colour management
- **Electron**, **React**, **Vite**, **Tailwind CSS**

---

**Photo Editor Pro** — a RAW photo editor for the desktop. 🎨
