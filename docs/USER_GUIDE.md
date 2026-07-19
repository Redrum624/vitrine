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

- **Multi-Module Processing Pipeline** - Professional-grade image adjustments
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

1. Use **File â†’ Openâ€¦**, or **Window â†’ Welcome Screenâ€¦** to bring up the welcome /
   open-folder screen, or drag-and-drop a file onto the application
2. Supported formats: JPG, PNG, TIFF, RAW (CR2, CR3, NEF, ARW, ORF, DNG, RW2, PEF, â€¦)
3. Wait for the image to load and process

### The Filmstrip

The thumbnail strip along the bottom lists every image in the current folder:

- **Scroll** left/right with the mouse wheel
- **Navigate** with â† / â†’ or by clicking a thumbnail
- **Rate** images with the inline stars and **filter** by minimum rating (you can also
  rate the open image from the bottom-right star overlay on the canvas, or press `1`â€“`5`)
- **Select multiple** images for export â€” **Ctrl/Cmd+click** toggles a thumbnail,
  **Shift+click** selects a contiguous range â€” then click the **Export N** button to
  export them all with the same settings (each keeps **its own** edits). A cancellable
  progress bar appears at the top-left, and the files are written as `<name>_VIT.<ext>`
- **Selection borders**: the image open on the canvas has a **bright blue border**;
  other images in a multi-selection have a **dimmer blue border**. Ctrl/Cmd+click a
  bordered thumbnail to remove it from the selection
- **Collapse / expand** the strip with the chevron (â–¼ / â–²) button in its header

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

The application processes images through these modules in this order:

### 1. Crop & Transform
**Purpose:** Geometric corrections
**When to use:** Start of every edit

**Controls:**
- **Aspect Ratio:** Free, 1:1, 3:2, 4:3, 16:9, Custom
- **Straighten Angle:** -45Â° to +45Â°
- **Auto-Straighten:** Automatically detect and correct horizon

**Tips:**
- Use Auto-Straighten for landscapes and architecture
- Crop last in your workflow to preserve maximum resolution
- Hold Shift while dragging to maintain aspect ratio

### 2. Lens Corrections
**Purpose:** Correct lens distortion, vignetting, chromatic aberration â€” plus creative
finishing effects (Blur, Film Grain)
**When to use:** After crop, before color adjustments

**Controls:**
- **Distortion Correction:** Barrel and pincushion correction
- **Vignetting Removal:** Brighten darkened corners
- **Chromatic Aberration:** Remove color fringing
- **Blur:** Non-destructive Gaussian blur (radius 0â€“20 px)
- **Film Grain:** Non-destructive grain (Amount 0â€“100%, Grain Size 1â€“4)

**Tips:**
- Enable for wide-angle shots (distortion)
- Use for images with dark corners (vignetting)
- Most noticeable in high-contrast edges
- Blur and Film Grain are non-destructive sections â€” they re-process live and persist
  with the image like every other adjustment

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

**Auto:** The **Auto** button uses **median gray-world** neutralisation â€” it scans the
image's overall median colour cast and corrects both warmth (Temperature) and Tint in
one click. (The same logic drives the white-balance step of **Auto All**.)

**Tips:**
- Find a neutral gray/white area to reference, or click **Auto** for an automatic neutral
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

### 8. Highlights & Shadows (in Basic Adjustments)
**Purpose:** Selective tonal recovery
**When to use:** For high-dynamic-range scenes

These now live as the **Highlights** and **Shadows** sliders inside **Basic
Adjustments** (the old standalone Shadows & Highlights module was removed). Both
are centred at 0 and luminance-masked, so they target the right tones:
- **Highlights:** negative recovers/compresses bright areas, positive brightens them
- **Shadows:** positive lifts shadows, negative deepens them

**Tips:**
- Pull Highlights negative to recover detail in bright skies
- Push Shadows positive for backlit subjects (silhouettes)
- Keep them subtle for a natural look

### 9. Local Adjustments (in Basic Adjustments)
**Purpose:** Selective edits to specific areas
**When to use:** For targeted corrections

At the top of **Basic Adjustments**, click **Circle** or **Gradient** to add a mask:
- **Circle (radial):** an ellipse for vignettes, spotlights, or subject isolation
- **Gradient (linear):** a graduated filter for skies/foregrounds

**Drag on the image** to place the mask; drag its centre to move it or its edge to
resize (drag an endpoint to move a gradient). Each mask gets its **own Basic
Adjustments** panel plus a **Feather** slider, so you can apply a different look to
that area only. Switch masks with the chips, and remove one with the trash icon.

**Tips:**
- Gradient masks for dramatic skies
- Circle masks for subject isolation / local dodging & burning
- Raise Feather for a softer, more natural transition

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

### 11. Enhance
**Purpose:** Non-destructive sharpening and in-session upscaling
**When to use:** After noise reduction, just before export; upscale before cropping for social/print delivery

**Controls:**
- **Sharpen toggle** â€” enables Richardsonâ€“Lucy deconvolution deblur + edge-masked luma
  graft + AMD FidelityFX CAS sharpening + luma-guided chroma cleanup (BT.601, alpha
  preserved).
- **Upscale toggle** â€” Ã—2 or Ã—4 Lanczos upscale (linear light). Bakes the enlarged image
  as the working image for the session; reopening the file returns the native original.
- **Apply Enhance** â€” runs the enabled operations (Sharpen and/or Upscale). Like Noise
  Reduction, it never auto-processes on slider change.

**Notes:**
- Reached from the sidebar (below Noise Reduction), replacing the old Sharpen module.
- The Sharpen result is baked into every export automatically; no separate export-sharpening
  option needed.
- Upscale is in-session only: History records an "Enhanced Ã—N" checkpoint and a multi-level
  Revert stack keeps the native original accessible.

---

## Auto Adjustments

Every **Auto** button â€” the per-module ones and the **Auto All** button in the toolbar â€” now uses *your personal style profile*, extracted from your graded photos. Instead of aiming at generic "neutral" targets, the Auto functions aim at the way *you* actually grade: darker, warmer, with more contrast and less saturation than a textbook neutral.

The profile is split into 5 **buckets** â€” `low_light`, `high_key`, `warm`, `cool`, and `standard`. **Auto All** automatically picks the right bucket for the current image based on its brightness and white balance, then adjusts Exposure, Basic Adjustments (including Highlights/Shadows), Tone Curve, and Color Balance in one click. Its **white-balance step** uses **median gray-world** neutralisation (the same as the WB panel's **Auto** button) â€” it scans the image's overall median colour cast and neutralises both warmth and tint, rather than nudging toward the style profile. The bucket it chose is written to the log (e.g. `AutoExposure[warm]: â€¦`) so you can tell which profile fired.

**To regenerate the profile after grading more photos**, re-run the extractor:

```
python scripts/extract_style_profile.py \
  --portfolio "/path/to/your/pictures::Portfolio-Sep" \
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
- `Ctrl/Cmd + 1` - 100% zoom
- `Ctrl/Cmd + 0` - Reset zoom
- `1`â€“`5` - Rate the current image Â· `0` - Clear rating

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
- Use the Highlights / Shadows sliders in Basic Adjustments
- Reduce Highlights slider (negative) to recover bright areas
- Increase Shadows slider (positive) to lift dark areas
- Add a Local Adjustment mask (Circle/Gradient) to target one area
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
