# Getting Started

Welcome to the Professional Photo Editing Application!

## Quick Start

### 1. Installation
```bash
npm install
npm run dev
```

### 2. Open an Image
- Click "Open Image" or drag-and-drop
- Supported: JPG, PNG, TIFF, RAW

### 3. Basic Editing Workflow
1. **Straighten** - Use Auto-Straighten or manual
2. **Exposure** - Adjust overall brightness
3. **White Balance** - Correct color temperature
4. **Contrast & Saturation** - Fine-tune appearance
5. **Noise Reduction** - Remove digital noise (if needed)
6. **Export** - Save your final image

## First Edit Tutorial

### Example: Landscape Photo

**Step 1: Straighten Horizon**
- Open Crop & Transform module
- Click "Auto-Straighten"
- Fine-tune angle if needed

**Step 2: Adjust Exposure**  
- Open Exposure module
- Adjust slider to brighten/darken
- Watch histogram to avoid clipping

**Step 3: Enhance Sky**
- Use Graduated Filter (Local Adjustments)
- Drag from top down
- Reduce Highlights to recover sky detail

**Step 4: Color Grading**
- Open Color Balance
- Add blue to shadows
- Add warm tones to highlights

**Step 5: Final Touch**
- Basic Adjustments: +10 Contrast, +10 Vibrance
- Enhance (Sharpen and/or Upscale) if needed

**Step 6: Export**
- Full resolution
- sRGB color space for web
- JPG quality 90%

## Keyboard Shortcuts

- `Ctrl/Cmd + O` - Open image
- `Space` - Before/After preview
- `F` - Fit to screen
- `1` - 100% zoom
- `R` - Reset current module

## Tips for Best Results

1. **Always work in order**: Geometric → Exposure → Color → Details
2. **Use subtle adjustments**: Small changes look natural
3. **Check at 100% zoom**: Ensure sharpness and noise
4. **Use presets**: Save time on similar images
5. **Denoise last**: Apply after all other adjustments

## Common Issues

**Image looks different after export?**
- Use sRGB color space
- Check bit depth (8-bit for web)

**Processing is slow?**
- Enable GPU acceleration
- Reduce preview resolution
- Close other applications

**Too much noise reduction?**
- Lower Strength to 60-70%
- Increase Detail Preservation to 80%

## Next Steps

- Read **USER_GUIDE.md** for detailed module documentation
- See **DEVELOPER_GUIDE.md** if building/extending
- Check **API_REFERENCE.md** for programming reference

## Support

For help:
- Documentation: docs/
- Issues: GitHub issues
- Community: [forum link]

**Happy editing!**
