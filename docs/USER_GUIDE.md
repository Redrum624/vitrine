# Photo Editing Application - User Guide

**Version:** 1.0.0
**Last Updated:** 2025-10-22

---

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Processing Pipeline](#processing-pipeline)
4. [Module Reference](#module-reference)
5. [Keyboard Shortcuts](#keyboard-shortcuts)
6. [Tips & Best Practices](#tips--best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Introduction

Welcome to the Professional Photo Editing Application - a powerful, privacy-focused photo editor that processes all images locally on your computer. No cloud uploads, no subscriptions, no compromises.

### Key Features

- **10-Module Processing Pipeline** - Professional-grade image adjustments
- **World-Class Noise Reduction** - 4 advanced algorithms (BM3D, NLMeans, Wavelet, Hybrid)
- **GPU Acceleration** - Hardware-accelerated processing for real-time previews
- **ACES Color Science** - Hollywood-standard color grading
- **Auto-Straighten** - Intelligent horizon and vertical line detection
- **100% Local Processing** - All processing happens on your machine
- **No Subscriptions** - One-time purchase, yours forever

### System Requirements

**Minimum:**
- Modern web browser with WebGL2 support
- 4GB RAM
- Dual-core processor

**Recommended:**
- Chrome, Firefox, or Edge (latest version)
- 8GB+ RAM
- Quad-core processor
- Dedicated GPU

---

## Getting Started

### Opening an Image

1. Click **"Open Image"** or drag-and-drop a file onto the application
2. Supported formats: JPG, PNG, TIFF, RAW (CR2, NEF, ARW, DNG)
3. Wait for the image to load and process

### Basic Workflow

The typical editing workflow follows this order:

1. **Geometric Corrections** (Crop, Straighten, Lens Corrections)
2. **Exposure & White Balance** (Get the basics right first)
3. **Tone & Color** (Contrast, Saturation, Tone Curves, Color Balance)
4. **Local Adjustments** (Selective edits to specific areas)
5. **Noise Reduction** (Apply last for best results)
6. **Export** (Save your final image)

---

## Processing Pipeline

The application processes images through 10 modules in this order:

### 1. Crop & Transform
**Purpose:** Geometric corrections
**When to use:** Start of every edit

**Controls:**
- **Aspect Ratio:** Free, 1:1, 3:2, 4:3, 16:9, Custom
- **Straighten Angle:** -45° to +45°
- **Auto-Straighten:** Automatically detect and correct horizon

**Tips:**
- Use Auto-Straighten for landscapes and architecture
- Crop last in your workflow to preserve maximum resolution
- Hold Shift while dragging to maintain aspect ratio

### 2. Lens Corrections
**Purpose:** Correct lens distortion, vignetting, chromatic aberration
**When to use:** After crop, before color adjustments

**Controls:**
- **Distortion Correction:** Barrel and pincushion correction
- **Vignetting Removal:** Brighten darkened corners
- **Chromatic Aberration:** Remove color fringing

**Tips:**
- Enable for wide-angle shots (distortion)
- Use for images with dark corners (vignetting)
- Most noticeable in high-contrast edges

### 3. Exposure
**Purpose:** Overall image brightness
**When to use:** First color adjustment

**Controls:**
- **Exposure:** -3.0 to +3.0 EV (exposure value)
- **Black Point:** -0.1 to +0.1

**Tips:**
- Start here to get overall brightness right
- Use histogram to avoid clipping highlights/shadows
- +1 EV doubles brightness, -1 EV halves it

### 4. White Balance
**Purpose:** Correct color temperature
**When to use:** After exposure

**Controls:**
- **Temperature:** 2000K to 10000K (blue to yellow)
- **Tint:** -100 to +100 (green to magenta)
- **Mode:** Manual, Auto, Presets

**Presets:**
- **Daylight:** 5500K - Neutral outdoor light
- **Cloudy:** 6500K - Warmer for overcast days
- **Shade:** 7500K - Very warm for shaded areas
- **Tungsten:** 3200K - Cool for indoor bulbs
- **Fluorescent:** 4000K - For office lighting
- **Flash:** 5500K - Camera flash

**Tips:**
- Find a neutral gray/white area to reference
- Daylight is usually 5500K
- Indoor tungsten lights need cooling (lower K)
- Shade needs warming (higher K)

### 5. Basic Adjustments
**Purpose:** Fine-tune contrast, saturation, and tonal balance
**When to use:** After white balance

**Controls:**
- **Contrast:** -100 to +100
- **Saturation:** -100 to +100 (overall color intensity)
- **Vibrance:** -100 to +100 (smart saturation, affects muted colors more)
- **Highlights:** -100 to +100 (recover bright areas)
- **Shadows:** -100 to +100 (lift dark areas)
- **Whites:** -100 to +100 (brightest points)
- **Blacks:** -100 to +100 (darkest points)

**Tips:**
- Use Vibrance instead of Saturation for skin tones
- Negative Highlights to recover blown skies
- Positive Shadows to lift dark areas without washing out
- Adjust Whites/Blacks to set pure white/black points

### 6. Tone Curve
**Purpose:** Precise tonal control
**When to use:** For advanced tonal adjustments

**Controls:**
- **RGB Curve:** Affects all channels
- **Red/Green/Blue Curves:** Individual channel control
- **Point Editor:** Click to add control points

**Tips:**
- S-curve adds contrast (lift shadows, pull highlights)
- Flat curve reduces contrast
- Use individual RGB curves for color grading
- Lift blacks slightly for a "faded film" look

### 7. Color Balance
**Purpose:** Creative color grading
**When to use:** For mood and style

**Controls:**
- **Shadows:** R/G/B adjustment for dark tones
- **Midtones:** R/G/B adjustment for middle tones
- **Highlights:** R/G/B adjustment for bright tones

**Common Looks:**
- **Warm Sunset:** +Red/+Yellow in highlights, +Blue in shadows
- **Cool Cinematic:** +Cyan in shadows, +Orange in highlights
- **Teal & Orange:** +Teal in shadows, +Orange in highlights/midtones

**Tips:**
- Subtle adjustments go a long way
- Complementary colors (teal/orange, blue/yellow) create depth
- Match color temperatures between shadow/highlight for natural look

### 8. Shadows & Highlights
**Purpose:** Selective tonal recovery
**When to use:** For high-dynamic-range scenes

**Controls:**
- **Shadow Recovery:** 0-100% (lift shadows)
- **Highlight Recovery:** 0-100% (compress highlights)
- **Radius:** How far the effect extends
- **Amount:** Strength of the effect

**Tips:**
- Use for backlit subjects (silhouettes)
- Recover detail in bright skies
- Don't overdo it - looks unnatural above 70%

### 9. Local Adjustments
**Purpose:** Selective edits to specific areas
**When to use:** For targeted corrections

**Tools:**
- **Graduated Filter:** Linear gradient for skies/foregrounds
- **Radial Filter:** Circular vignettes and spotlights
- **Adjustment Brush:** Paint adjustments onto specific areas

**Tips:**
- Use graduated filter for dramatic skies
- Radial filter for subject isolation
- Brush for precise dodging and burning

### 10. Noise Reduction
**Purpose:** Remove digital noise from high-ISO images
**When to use:** Last step before export

**Controls:**
- **Method:** Auto, BM3D, Non-Local Means, Wavelet, Hybrid
- **Strength:** 0-100%
- **Detail Preservation:** 0-100%
- **Luminance Noise:** 0-100%
- **Chroma Noise:** 0-100%

**Methods Explained:**
- **Auto:** Analyzes image and selects best method
- **BM3D:** Best quality, slowest (use for final export)
- **Non-Local Means:** Great for textures
- **Wavelet:** Fast, good for edges
- **Hybrid:** Balanced approach

**Tips:**
- Always denoise last (after all other adjustments)
- Start with Auto method
- Higher Detail Preservation keeps textures
- Chroma noise (color noise) more visible than luminance
- Don't denoise ISO 100-400 images (unnecessary)

---

## Auto Adjustments

Every **Auto** button — the per-module ones and the **Auto All** button in the toolbar — now uses *your personal style profile*, extracted from 200 of your graded photos at `~\Pictures\Portfolio-Sep 22, 2019 – Feb 6, 2025`. Instead of aiming at generic "neutral" targets, the Auto functions aim at the way *you* actually grade: darker, warmer, with more contrast and less saturation than a textbook neutral.

The profile is split into 5 **buckets** — `low_light`, `high_key`, `warm`, `cool`, and `standard`. **Auto All** automatically picks the right bucket for the current image based on its brightness and white balance, then adjusts Exposure, White Balance, Basic Adjustments, Tone Curve, Color Balance, and Shadows/Highlights in one click. The bucket it chose is written to the log (e.g. `AutoExposure[warm]: …`) so you can tell which profile fired.

**To regenerate the profile after grading more photos**, re-run the extractor:

```
python scripts/extract_style_profile.py \
  --portfolio "C:/Users/<user>/Pictures::Portfolio-Sep" \
  --out src/services/UserStyleProfile.ts \
  --report logs/style_profile_report.json
```

---

## Keyboard Shortcuts

### General
- `Ctrl/Cmd + O` - Open image
- `Ctrl/Cmd + S` - Save/Export
- `Ctrl/Cmd + Z` - Undo
- `Ctrl/Cmd + Y` - Redo
- `Space` - Toggle before/after preview
- `F` - Fit to screen
- `1` - 100% zoom
- `Ctrl/Cmd + 0` - Reset zoom

### Module Controls
- `Tab` - Next module
- `Shift + Tab` - Previous module
- `R` - Reset current module
- `Ctrl/Cmd + R` - Reset all

### Crop Tool
- `X` - Swap width/height
- `Enter` - Apply crop
- `Esc` - Cancel crop

---

## Tips & Best Practices

### General Workflow Tips

1. **Work Non-Destructively**
   - All adjustments are non-destructive
   - Original file is never modified
   - Can reset any module at any time

2. **Use the Histogram**
   - Shows tonal distribution
   - Avoid clipping (spikes at edges)
   - Aim for balanced distribution

3. **Process in Order**
   - Follow the module order
   - Geometric corrections first
   - Noise reduction last

4. **Save Presets**
   - Create presets for common styles
   - Batch apply to similar images
   - Speed up workflow

### Performance Tips

1. **Image Size**
   - Downsize if slow (Settings > Performance)
   - Full resolution for export
   - Preview at 50% for speed

2. **GPU Acceleration**
   - Enable if available (Settings > GPU)
   - Significant speed boost
   - Some modules use GPU automatically

3. **Module Optimization**
   - Disable unused modules
   - BM3D denoising is slowest
   - Use Wavelet for preview, BM3D for export

### Quality Tips

1. **Exposure First**
   - Get brightness right before color
   - Easier to see color when properly exposed
   - Prevents double-adjusting

2. **Subtle Adjustments**
   - Small adjustments look natural
   - Can always add more
   - Easier than dialing back

3. **Use References**
   - Compare to other images
   - Check on different displays
   - View at 100% for sharpness

4. **Noise Reduction Strategy**
   - Only denoise if needed (ISO >800)
   - Higher Detail Preservation for textures
   - Accept some noise for natural look

---

## Troubleshooting

### Image Won't Load

**Problem:** Image fails to open
**Solutions:**
- Check file format is supported
- Try converting to JPG first
- Check file isn't corrupted
- Ensure sufficient RAM available

### Slow Performance

**Problem:** Laggy preview or slow processing
**Solutions:**
- Enable GPU acceleration (Settings)
- Reduce preview resolution
- Close other applications
- Process smaller images first
- Disable unused modules

### Results Look Different Than Preview

**Problem:** Exported image looks different
**Solutions:**
- Check export color space (sRGB recommended)
- Verify bit depth (8-bit for web, 16-bit for print)
- Test on calibrated display
- Export at full resolution

### Too Much Noise Reduction

**Problem:** Image looks plastic or overly smooth
**Solutions:**
- Reduce Strength to 50-70%
- Increase Detail Preservation to 80-90%
- Try different method (Wavelet preserves texture better)
- Accept some noise for natural look

### Colors Look Wrong

**Problem:** Colors appear off after white balance
**Solutions:**
- Check for colored light sources in scene
- Use neutral gray reference
- Try different presets
- Adjust Tint slider (green/magenta)

### Lost Detail in Shadows/Highlights

**Problem:** Detail lost in bright or dark areas
**Solutions:**
- Use Shadows/Highlights module
- Reduce Highlights slider (negative)
- Increase Shadows slider (positive)
- Check histogram for clipping
- Use bracketed exposure if available

---

## Advanced Topics

### ACES Color Science

This application uses ACES (Academy Color Encoding System), the same color science used in Hollywood films.

**Benefits:**
- Accurate color reproduction
- Smooth highlight rolloff
- Consistent color across devices
- Professional-grade color grading

**When to Use:**
- Cinematic color grading
- HDR processing
- Professional workflows
- Matching film look

### RAW File Processing

**Advantages:**
- Maximum dynamic range
- Best highlight recovery
- More latitude for adjustments
- Professional quality

**Tips:**
- Always shoot RAW for best results
- RAW files preserve more highlight detail
- Greater flexibility in post-processing
- Larger file sizes

### Batch Processing

**Workflow:**
1. Edit one image
2. Save as preset
3. Apply preset to batch
4. Fine-tune individual images
5. Export all

**Use Cases:**
- Wedding photos
- Event photography
- Product photography
- Consistent look across series

---

## Support

### Getting Help

- **Documentation:** docs/
- **Tutorials:** docs/tutorials/
- **FAQ:** docs/FAQ.md
- **Community:** [Link to forum/discord]

### Reporting Issues

Include:
- Operating system
- Browser version
- Image file type
- Steps to reproduce
- Error messages (if any)

---

**Thank you for using Professional Photo Editing Application!**

For the latest updates and news, visit [website]
