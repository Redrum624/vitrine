# API Reference

**Version:** 1.0.0

Quick reference for all public APIs.

## ImageProcessingPipeline
- processImage() - Main processing function
- getModule() - Get module by ID  
- setModuleEnabled() - Enable/disable modules

## Module IDs
crop, exposure, whitebalance, basicadj, tonecurve, colorbalance, shadowshighlights, noise-reduction

## AdvancedDenoisingService
- denoiseSync() - Synchronous denoising
- Methods: auto, bm3d, nlmeans, wavelet, hybrid

## ACESColorService
- processImage() - Apply ACES pipeline
- sRGBToACES() - Color space conversion

## CropModule (auto-straighten)
- autoStraighten() - 6-line scan angle detection + apply
- wedgeFreeCropPatch() - inscribed/intersected crop patch for a straighten angle

See DEVELOPER_GUIDE.md for full documentation.
