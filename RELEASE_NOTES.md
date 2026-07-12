# Vitrine - Release Notes

## Version 1.5.0 (2026-06-09)

**Sharpen module, streamlined menus, and a smarter Auto White Balance.**

### Added
- **Sharpen module** in the right icon sidebar, directly below Noise Reduction. A
  non-destructive unsharp-mask develop module with live sliders: **Amount** (0–150%),
  **Radius** (0.5–3 px), and **Detail** (0–100, protects smooth areas/noise). It applies
  to the whole image, so the canvas preview and the export match.
- **Blur** and **Film Grain** sections inside the **Lens Corrections** panel — both
  non-destructive. Blur is a Gaussian radius (0–20 px); Film Grain has Amount (0–100%)
  and Grain Size (1–4). Lens Corrections now contains Distortion, Vignetting, Chromatic
  Aberration, Blur, and Film Grain.

### Changed
- **Output Sharpening tab removed from the Export dialog.** Sharpening is now the Sharpen
  sidebar module; its result is baked into every export automatically by the pipeline.
- **Toolbar export button relabelled** from "Save" to **"Export"**.
- **Sidebar tool order** is now Crop & Transform, Basic Adjustments, White Balance, Color
  Balance, Tone Curve, Noise Reduction, Sharpen, Lens Corrections, History (Color Balance
  moved directly under White Balance; Sharpen is new under Noise Reduction).
- **Filter menu removed** from the top menu bar. Its former effects now live elsewhere:
  Sharpen and Noise Reduction are sidebar modules; Blur and Film Grain are Lens
  Corrections sections; Vignette is covered by the Vignetting section.
- **File → New… removed** (it was a placeholder). The Welcome screen is still available
  via **Window → Welcome Screen…**.
- **Auto White Balance now uses median gray-world.** Both the White Balance panel's
  **Auto** button and the **Auto All** action scan the image's overall median colour cast
  and neutralise both warmth (temperature) and tint (previously it only nudged toward a
  style profile).

### Fixed
- **Canvas zoom-out is now seamless** — the zoomed-out image no longer sits in a
  lighter-grey rectangle/border; it floats on the uniform dark canvas. (Zooming in is
  still bounded by the fit-to-window rectangle.)

---

## Version 1.0.0 (2025-12-18)

**First Production Release**

Vitrine is a professional-grade RAW photo editing application built with modern web technologies. This release includes complete image processing capabilities, professional color science, and GPU-accelerated performance.

---

### Features

#### Image Processing (10 Modules)
- **Crop & Transform** - Aspect ratios, rotation, perspective correction
- **Lens Corrections** - Distortion, vignette, chromatic aberration removal
- **Exposure** - Exposure, highlights, shadows, whites, blacks
- **White Balance** - Temperature, tint, auto white balance
- **Basic Adjustments** - Brightness, contrast, saturation, vibrance
- **Tone Curves** - RGB and individual channel curves with presets
- **Color Balance** - Shadow/midtone/highlight color control
- **Shadows & Highlights** - Recovery and detail enhancement
- **Local Adjustments** - Brush-based selective editing
- **Noise Reduction** - BM3D, Non-Local Means, Wavelet denoising

#### Professional Color Science
- **ACES Workflow** - Academy Color Encoding System support
- **CDL Support** - Color Decision List (Slope, Offset, Power, Saturation)
- **3D LUT Import** - Adobe .cube file support with trilinear/tetrahedral interpolation
- **Lab Color Space** - Full XYZ/Lab conversions with D50/D65 illuminants
- **Wide Gamut** - sRGB, Adobe RGB, ProPhoto RGB, Rec.2020, Rec.2100
- **HDR Support** - PQ (ST 2084) and HLG transfer functions with tone mapping
- **ICC Profiles** - v2/v4 profile parsing and application
- **Hue Curves** - HvH, HvS, HvL, SvS, LvS professional grading curves
- **Color Wheels** - Lift/Gamma/Gain color wheels UI

#### RAW Processing
- **LibRaw Integration** - WebAssembly-based RAW processing
- **Format Support** - Canon CR2/CR3, Nikon NEF, Sony ARW, Fuji RAF, Adobe DNG
- **Demosaicing** - Multiple algorithms including AHD, DCB, VNG
- **Camera Profiles** - Camera-specific color matrix support

#### GPU Acceleration
- **WebGL2 Shaders** - Hardware-accelerated image processing
- **Shader Pipeline** - Ping-pong framebuffer for chained operations
- **Buffer Pooling** - Texture and buffer reuse for memory efficiency
- **Web Workers** - Multi-threaded tile-based processing

#### Performance
- **Object Pooling** - Float32Array memory reuse (64KB to 192MB buckets)
- **LRU Caching** - Smart cache with 500MB memory limit
- **Performance Profiler** - GPU/CPU timing with JSON export

#### Application
- **Electron Desktop** - Native Windows application
- **History System** - 50-state undo/redo
- **Preset Management** - Save, load, and share editing presets
- **Batch Processing** - Process multiple images with same settings
- **Export Options** - JPEG, PNG, TIFF, WebP with quality control

---

### Technical Specifications

| Metric | Value |
|--------|-------|
| TypeScript Errors | 0 |
| ESLint Warnings | 0 |
| Jest Tests | 619 passing (19 suites) |
| Bundle Size (gzipped) | ~210 KB JS |
| Modules | 11 processing modules |
| Services | 65+ specialized services |

#### Test Coverage
- ColorUtils: 62 tests
- Processing Modules: 400+ tests
- Integration Tests: 21 tests
- Performance Benchmarks: 7 tests
- E2E Tests: Playwright configured

---

### System Requirements

#### Minimum
- **OS:** Windows 10 (64-bit)
- **RAM:** 8 GB
- **GPU:** WebGL2-compatible graphics card
- **Storage:** 500 MB free space

#### Recommended
- **OS:** Windows 11 (64-bit)
- **RAM:** 16 GB or more
- **GPU:** Dedicated GPU with 4GB+ VRAM
- **Storage:** SSD with 2 GB free space

---

### Known Limitations

1. **LibRaw WASM** - Some advanced RAW features use mock fallback
2. **GPU Acceleration** - Requires WebGL2 support (most modern GPUs)
3. **Large Files** - Images over 100MP may require more memory
4. **Platform** - Windows fully tested; macOS/Linux need verification

---

### Installation

#### Windows
1. Download `Vitrine Setup.exe` from releases
2. Run installer and follow prompts
3. Launch from Start Menu or Desktop shortcut

#### Development
```bash
git clone <repository>
cd photo_app
npm install
npm run dev
```

---

### Changelog

#### Added
- Complete image processing pipeline with 11 modules
- Professional color science (ACES, Lab, LUT, HDR, ICC)
- GPU-accelerated shader pipeline
- Memory-optimized object pooling
- Performance profiling system
- 619 comprehensive unit tests
- E2E testing framework
- Windows desktop application

#### Technical
- React 19 + TypeScript 5.9
- Electron 39 for desktop
- Vite 7 for building
- Jest 30 for testing
- Playwright for E2E

---

### Credits

Built with:
- [React](https://react.dev) - UI framework
- [Electron](https://electronjs.org) - Desktop framework
- [LibRaw](https://libraw.org) - RAW processing
- [Sharp](https://sharp.pixelplumbing.com) - Image processing
- [Tailwind CSS](https://tailwindcss.com) - Styling
- [Zustand](https://zustand-demo.pmnd.rs) - State management

---

### License

GPL-3.0 License - See LICENSE file for details.

---

**Vitrine v1.0.0** - Professional photo editing for everyone.
