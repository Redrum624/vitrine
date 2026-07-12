# Vitrine — User Guide

Welcome to Vitrine — the darkroom, behind glass. This guide will help you get started.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Interface Overview](#interface-overview)
3. [Opening Images](#opening-images)
4. [Editing Workflow](#editing-workflow)
5. [Module Reference](#module-reference)
6. [Exporting Images](#exporting-images)
7. [Tips & Best Practices](#tips--best-practices)
8. [Troubleshooting](#troubleshooting)

---

## Getting Started

### First Launch

When you first open Vitrine:

1. **Welcome Screen** - Shows quick start tips
2. **Interface** - Main editing workspace with panels
3. **File Browser** - Left panel for image selection
4. **Canvas** - Center area for image display
5. **Adjustment Panels** - Right side for editing controls

### System Requirements

- **OS:** Windows 10/11, macOS 10.15+, or Linux
- **RAM:** 8GB minimum, 16GB recommended
- **Display:** 1920x1080 minimum resolution
- **Storage:** 500MB for application, more for image cache

---

## Interface Overview

### Layout

```
┌─────────────────────────────────────────────────────┐
│                    Toolbar                          │
├──────────┬─────────────────────────┬───────────────┤
│          │                         │               │
│   File   │       Canvas            │  Adjustment   │
│  Browser │      (Image)            │    Panel      │
│          │                         │               │
│          │                         │               │
└──────────┴─────────────────────────┴───────────────┘
```

### Panels

**File Browser** (Left)
- Browse folders and drives
- Thumbnail previews
- Quick image selection
- Filter by file type

**Canvas** (Center)
- Image display and preview
- Zoom and pan controls
- Crop/transform overlays
- Before/after comparison

**Adjustment Panel** (Right)
- Editing modules
- Real-time preview
- Module enable/disable
- Parameter controls

**Toolbar** (Top)
- File operations (Open, Export)
- Undo/Redo buttons
- Zoom controls
- View options
- Help access

---

## Opening Images

### Method 1: File Menu
1. Click **File → Open** or press `Ctrl+O`
2. Navigate to your image
3. Select and click **Open**

### Method 2: File Browser
1. Use left panel to browse folders
2. Click on an image thumbnail
3. Image loads automatically

### Method 3: Drag & Drop
1. Drag image file from file explorer
2. Drop onto canvas area
3. Image loads automatically

### Supported Formats

**Standard Images:**
- JPEG/JPG (.jpg, .jpeg)
- PNG (.png)
- TIFF (.tiff, .tif)
- WebP (.webp)
- BMP (.bmp)

**RAW Formats:**
- Canon CR2
- Nikon NEF
- Sony ARW
- Adobe DNG
- Olympus ORF
- Panasonic RW2
- Pentax PEF

---

## Editing Workflow

### Basic Workflow

1. **Open Image**
   - Load your photo using any method above
   - Image appears in canvas

2. **Make Adjustments**
   - Expand modules in right panel
   - Adjust sliders and controls
   - See changes in real-time

3. **Export Result**
   - Click Export or press `Ctrl+E`
   - Choose format and quality
   - Save to desired location

### Professional Workflow

1. **Load & Assess**
   - Open RAW or high-resolution image
   - Zoom to 100% to check sharpness
   - Identify needed adjustments

2. **Geometric Corrections** (do first!)
   - Crop & Transform module
   - Straighten horizon
   - Fix lens distortion

3. **Tonal Adjustments**
   - Exposure and Basic Adjustments
   - Tone Curve for precision
   - Shadows & Highlights recovery

4. **Color Corrections**
   - White Balance
   - Color Balance
   - Saturation/Vibrance

5. **Local Adjustments**
   - Brush specific areas
   - Graduated filters
   - Spot corrections

6. **Sharpen** (Sharpen module)
   - Apply unsharp-mask sharpening with Amount / Radius / Detail
   - The result is baked into the export automatically

7. **Export**
   - Choose appropriate format
   - Set quality settings

---

## Module Reference

### 1. Crop & Transform
**Location:** Top of panel (geometric operations come first)

**Features:**
- **Crop:** Select image area to keep
- **Aspect Ratios:** Free, 1:1, 3:2, 4:3, 16:9, custom
- **Rotation:** -45° to +45° with auto-straighten
- **Flip:** Horizontal and vertical mirroring
- **Interactive Handles:** Drag corners/edges to crop
- **Grid Overlay:** Rule of thirds composition guide

**Workflow:**
1. Click module to expand
2. Choose aspect ratio or drag handles
3. Rotate with slider or auto-straighten
4. Click **Apply** to confirm changes
5. Use **Cancel** to revert

### 2. Lens Corrections
**Purpose:** Fix optical lens issues and add creative finishing effects

**Features:**
- **Distortion:** Fix barrel/pincushion distortion
- **Vignetting:** Remove dark corners (with **Auto-Detect**)
- **Chromatic Aberration:** Remove color fringing
- **Blur:** Non-destructive Gaussian blur (radius 0–20 px)
- **Film Grain:** Non-destructive grain (Amount 0–100%, Grain Size 1–4)

### 3. White Balance
**Purpose:** Correct color temperature

**Features:**
- **Temperature:** Warm (yellow) to Cool (blue)
- **Tint:** Green to Magenta correction
- **Presets:** Daylight, Cloudy, Tungsten, Fluorescent, etc.
- **Auto:** Median gray-world neutralisation — scans the image's overall median colour
  cast and corrects both temperature (warmth) and tint in one click

**Tips:**
- Start with a preset, then fine-tune
- Use eyedropper on neutral gray area, or click **Auto** for an automatic neutral
- Temperature: 2000K (candle) to 10000K (blue sky)

### 4. Basic Adjustments
**Purpose:** Primary tonal and color adjustments

**Controls:**
- **Exposure:** Overall brightness (-1 to +1 EV)
- **Contrast:** Tonal separation (-100 to +100)
- **Brightness:** Midtone brightness (-100 to +100)
- **Black Point:** Shadow depth adjustment
- **Saturation:** Color intensity (-100 to +100)
- **Vibrance:** Smart saturation (protects skin tones)

**Best Practice:**
- Start with Exposure
- Add Contrast for punch
- Use Vibrance over Saturation for natural results

### 5. Tone Curve
**Purpose:** Precise tonal control

**Features:**
- **Custom Curve:** Click to add points, drag to adjust
- **RGB Curves:** Separate red, green, blue channels
- **Auto Levels:** Automatic histogram optimization
- **Presets:** S-curve, film looks, etc.

**Usage:**
- Lower left = shadows
- Middle = midtones
- Upper right = highlights
- Drag up to brighten, down to darken

### 6. Color Balance
**Purpose:** Color grading and correction

**Features:**
- **3-Way Color:** Separate shadows, midtones, highlights
- **8-Color HSL:** Per-color hue, saturation, luminance
- **Range Selection:** Targeted color adjustments

**Color Wheel Controls:**
- Drag toward cyan/red for temperature
- Drag toward magenta/green for tint
- Use sliders for precise values

### 7. Shadows & Highlights
**Purpose:** Recover detail in shadows and highlights

**Features:**
- **Shadow Recovery:** Lift shadows without affecting midtones
- **Highlight Recovery:** Pull down bright areas
- **Radius:** Size of recovery effect
- **Strength:** Intensity of recovery

**When to Use:**
- Backlit subjects (recover dark shadows)
- Blown highlights (recover bright skies)
- High-contrast scenes

### 8. Local Adjustments
**Purpose:** Apply edits to specific areas

**Features:**
- **Brush Tool:** Paint adjustments
- **Graduated Filter:** Linear gradient effect
- **Radial Filter:** Circular/elliptical selection
- **Layer System:** Multiple adjustment layers
- **Mask Editing:** Refine selection areas

**Workflow:**
1. Create new layer
2. Choose tool (brush/gradient/radial)
3. Paint or drag to select area
4. Adjust parameters (exposure, saturation, etc.)
5. Refine mask if needed

### 9. Sharpen
**Purpose:** Non-destructive unsharp-mask sharpening (in the sidebar, below Noise Reduction)

**Controls:**
- **Amount:** Sharpening strength (0–150%)
- **Radius:** Edge radius (0.5–3 px)
- **Detail:** Protects smooth areas and noise (0–100)

**Notes:**
- Applies to the whole image, so the canvas preview matches the export exactly
- Sharpening is baked into exports automatically — there is no separate export option

---

## Exporting Images

### Export Dialog

Access via:
- **File → Export** menu
- **Export** button in toolbar
- Keyboard: `Ctrl+E`

### Format Selection

**JPEG (.jpg)**
- Best for: Photos for web, sharing
- Quality: 60-100% (90% recommended)
- Compression: Smaller file sizes
- Color Space: sRGB (standard), Adobe RGB (print)

**PNG (.png)**
- Best for: Graphics, transparency
- Quality: Lossless compression
- File Size: Larger than JPEG
- Use When: Need transparency or maximum quality

**TIFF (.tif)**
- Best for: Professional printing, archival
- Quality: Lossless, 8-bit or 16-bit
- File Size: Very large
- Color Space: ProPhoto RGB or Adobe RGB

**WebP (.webp)**
- Best for: Modern web use
- Quality: Adjustable compression
- File Size: Smaller than JPEG/PNG
- Browser Support: Modern browsers only

### Export Settings

**Quality/Compression**
- 100%: Maximum quality, largest file
- 90%: Excellent quality, good file size (recommended)
- 80%: Good quality, smaller file
- 60%: Medium quality, small file (web thumbnails)

**Color Space**
- **sRGB:** Standard for web, most displays
- **Adobe RGB:** Wider gamut for printing
- **ProPhoto RGB:** Maximum color (TIFF only)
- **Rec. 2020:** HDR/modern displays

**Bit Depth** (TIFF/PNG only)
- **8-bit:** Standard, smaller files
- **16-bit:** Professional, maximum quality

**Sharpening**
- Sharpening is not an export option. Use the **Sharpen** module (sidebar, below Noise
  Reduction) to set Amount / Radius / Detail; its result is baked into the export.

**Metadata**
- **Preserve All:** Keep EXIF, GPS, camera data
- **Strip Location:** Remove GPS coordinates
- **Remove All:** Clean file (smallest size)

### Export Presets

**Web - High Quality**
- Format: JPEG
- Quality: 90%
- Color: sRGB

**Print - Maximum Quality**
- Format: TIFF
- Depth: 16-bit
- Color: Adobe RGB

**Social Media**
- Format: JPEG
- Quality: 85%
- Color: sRGB
- Dimensions: Platform-specific

---

## Tips & Best Practices

### Performance Tips

1. **Large Images**
   - Application uses progressive preview
   - Full resolution applied at export
   - Close unused images to free memory

2. **RAW Files**
   - LibRAW automatically processes
   - Auto-adjustments applied on load
   - Disable if you want manual control

3. **Module Order**
   - Geometric corrections first (crop, lens)
   - Then tonal adjustments (exposure, curves)
   - Finally color grading
   - Local adjustments last

### Workflow Optimization

1. **Use Presets**
   - Save common adjustment combinations
   - Apply to similar images quickly
   - Customize after applying

2. **Keyboard Shortcuts**
   - Learn common shortcuts (Ctrl+Z, Ctrl+E)
   - Use F1 to see all shortcuts
   - Disable when typing in fields (automatic)

3. **Before/After Comparison**
   - Use 'B' key to toggle
   - Check if adjustments help or hurt
   - Zoom to 100% for detail check

### Quality Preservation

1. **Non-Destructive Editing**
   - Original image never modified
   - All edits in processing pipeline
   - Can undo/redo any change

2. **Export Strategy**
   - Keep original RAW/high-res files
   - Export JPEG for sharing
   - Export TIFF for archival/printing
   - Use appropriate color space

3. **Bit Depth**
   - Work in high bit depth if possible
   - Export 16-bit TIFF for maximum quality
   - 8-bit JPEG/PNG for final delivery

---

## Troubleshooting

### Common Issues

**Problem: Image won't load**
- Check file format is supported
- Verify file isn't corrupted (open in another app)
- Check file permissions (not read-only or locked)
- Try copying file to local drive

**Problem: Slow performance**
- Close other applications
- Reduce preview quality (automatic)
- Check if image is extremely large (>100MP)
- Restart application to clear cache

**Problem: Export fails**
- Check disk space available
- Verify write permissions for output folder
- Try different export format
- Check export settings are valid

**Problem: Colors look wrong**
- Verify monitor is calibrated
- Check color space settings in export
- Ensure color management enabled
- Try different color space (sRGB vs Adobe RGB)

**Problem: Changes not showing**
- Check module is enabled (toggle button)
- Verify adjustment values aren't at zero
- Try zooming to 100% to see detail
- Check if processing is complete (wait for "Processing..." to finish)

### Getting Help

**In-App Help**
- Press `F1` for keyboard shortcuts
- Hover over controls for tooltips
- Check status bar for messages

**Documentation**
- USER_GUIDE.md (this file)
- KEYBOARD_SHORTCUTS.md
- MODULE_REFERENCE.md (if available)

**Technical Support**
- Check application logs
- Report issues with sample image
- Include system information

---

## Advanced Features

### Batch Processing

1. Open Batch Processing dialog (`Ctrl+B`)
2. Click "Select Images" to choose files
3. Configure output settings:
   - Output folder
   - Naming convention
   - Format and quality
4. Choose preset or current settings
5. Click "Start Processing"

**Use Cases:**
- Apply same edit to multiple photos
- Batch resize images
- Convert formats in bulk
- Apply watermark to series

### Preset System

**Creating Presets:**
1. Adjust image to desired look
2. Click "Presets" button
3. Click "Save Current Settings"
4. Name your preset
5. Choose category (optional)

**Applying Presets:**
1. Open Presets dialog
2. Browse or search presets
3. Click preset to preview
4. Click "Apply" to use

**Managing Presets:**
- Edit existing presets
- Delete unused presets
- Import/Export preset files
- Share presets with others

### Layers & Masks (Local Adjustments)

**Creating Layers:**
1. Open Local Adjustments module
2. Click "New Layer"
3. Choose adjustment type
4. Paint or select area
5. Adjust parameters

**Mask Editing:**
- Use brush to paint/erase mask
- Adjust opacity for gradual effects
- Invert mask if needed
- Combine multiple layers

---

## Appendix

### File Formats Explained

**JPEG**
- Lossy compression
- 24-bit color (16.7 million colors)
- Small file size
- Universal support
- Best for photos

**PNG**
- Lossless compression
- Alpha channel (transparency)
- Larger file size
- Web standard
- Best for graphics

**TIFF**
- Lossless or compressed
- 8-bit or 16-bit
- Very large files
- Professional standard
- Best for archival

**WebP**
- Modern format
- Better compression than JPEG
- Supports transparency
- Not universal yet
- Best for modern web

### Color Spaces Explained

**sRGB**
- Standard RGB
- Most common color space
- Best for web and general use
- Smallest color gamut

**Adobe RGB**
- Wider color gamut than sRGB
- Better for printing
- Professional photography
- Requires color-managed workflow

**ProPhoto RGB**
- Widest color gamut
- Professional archival
- Exceeds most displays/printers
- Risk of clipping if not careful

**Rec. 2020**
- For HDR and wide-color displays
- Future-proof for new displays
- Very wide gamut
- Limited current support

### Recommended Settings

**For Web:**
- Format: JPEG
- Quality: 80-90%
- Color: sRGB
- Sharpen module: modest Amount, ~1 px Radius
- Max dimension: 2000px

**For Print:**
- Format: TIFF or JPEG (95%+)
- Color: Adobe RGB
- Resolution: 300 DPI
- Sharpen module: higher Amount, ~1.5–2 px Radius
- 16-bit if possible

**For Archival:**
- Format: TIFF or DNG (RAW)
- Color: ProPhoto RGB
- Bit depth: 16-bit
- Compression: None or lossless
- Preserve all metadata

---

**Version:** 1.0.0
**Last Updated:** 2025-10-05
**Application:** Vitrine

For the latest documentation, check the application's Help menu or visit the project repository.

---

*Happy editing!* 📸
