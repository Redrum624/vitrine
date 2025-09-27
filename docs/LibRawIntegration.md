# LibRaw WebAssembly Integration

## Overview

The Photo Editor Pro now includes real LibRaw WebAssembly support for professional RAW image processing, replacing the previous mock implementation.

## Features

### ✅ Real RAW Processing
- **LibRaw WebAssembly**: Uses `libraw-wasm` package for authentic RAW processing
- **Format Support**: 15+ RAW formats including Canon CR2/CR3, Nikon NEF, Sony ARW, Olympus ORF, Adobe DNG
- **Quality Presets**: Fast, Balanced, and Quality processing modes
- **Professional Options**: Advanced demosaicing, white balance, exposure correction

### ✅ Seamless Integration
- **Automatic Fallback**: Falls back to mock processing if LibRaw fails
- **Dual Environment**: Works in both Electron (file paths) and browser (ArrayBuffer)
- **Real-time Status**: LibRawStatus component shows initialization and processing status
- **TypeScript Support**: Full type definitions for libraw-wasm module

## Usage Examples

### Basic RAW Processing (File Path - Electron)
```typescript
import { rawImageService } from '../services/RawImageService';

// Load RAW file in Electron environment
const rawData = await rawImageService.loadRawImage('/path/to/image.cr2');
```

### Advanced RAW Processing (ArrayBuffer - Browser)
```typescript
import { rawImageService } from '../services/RawImageService';

// Process RAW file from buffer with quality preset
const rawData = await rawImageService.processRawFromBuffer(
  arrayBuffer,
  'image.orf',
  'quality'
);
```

### Custom Processing Options
```typescript
import { libRawService } from '../services/LibRawService';

const result = await libRawService.processRawFile(buffer, {
  user_qual: 3,        // AHD demosaicing (highest quality)
  use_camera_wb: true, // Use camera white balance
  output_bps: 8,       // 8-bit output for web
  user_cspace: 1,      // sRGB color space
  bright: 1.0,         // Default brightness
  threshold: 50        // Noise reduction threshold
});
```

## Processing Quality Presets

### Fast Preset
- Linear interpolation (fastest)
- Half resolution for speed
- Basic camera white balance
- Optimized for preview generation

### Balanced Preset (Default)
- VNG interpolation (good quality/speed balance)
- Full resolution
- Camera white balance
- Moderate noise reduction

### Quality Preset
- AHD interpolation (highest quality)
- Full resolution processing
- Advanced color processing
- Enhanced noise reduction
- Optimal for final output

## Architecture

### LibRawService
Core service providing LibRaw WebAssembly interface:
- Module initialization and management
- Processing with quality presets
- Format detection and validation
- Statistics and monitoring

### RawImageService
High-level service integrating LibRaw with the application:
- Seamless fallback to mock processing
- Electron/browser environment handling
- Metadata extraction and conversion
- Integration with image processing pipeline

### LibRawStatus Component
UI component showing LibRaw status:
- Initialization progress
- Error handling with retry
- Processing statistics
- Format support information

## Supported RAW Formats

| Brand | Extensions | Notes |
|-------|-----------|-------|
| Canon | .cr2, .cr3 | Full support including latest R series |
| Nikon | .nef, .nrw | Complete NEF processing |
| Sony | .arw, .srf, .sr2 | Alpha and mirrorless support |
| Olympus | .orf | Optimized processing |
| Panasonic | .rw2 | Lumix series support |
| Adobe | .dng | Digital Negative standard |
| Fujifilm | .raf | X-series support |
| Pentax | .pef, .ptx | Full format support |
| Others | .x3f, .3fr, .fff, .mef, .mos, .mrw, .r3d, .rwl | Professional formats |

## Performance

### WebAssembly Benefits
- **Native Speed**: Near-native C++ performance in browser
- **Memory Efficient**: Optimized memory usage for large RAW files
- **Parallel Processing**: Compatible with Web Worker processing pipeline
- **Progressive Loading**: Supports tiled processing for large images

### Processing Times (Estimated)
- **24MP RAW (Quality)**: ~2-5 seconds
- **24MP RAW (Balanced)**: ~1-3 seconds
- **24MP RAW (Fast)**: ~0.5-1 seconds
- **50MP RAW (Quality)**: ~5-10 seconds

*Times vary based on hardware and processing options*

## Integration Status

### ✅ Completed
- [x] LibRaw WebAssembly package integration
- [x] Professional processing options and presets
- [x] TypeScript definitions and type safety
- [x] Electron and browser environment support
- [x] Status monitoring and error handling
- [x] Build system integration and testing
- [x] Fallback to mock processing for development

### 🔮 Future Enhancements
- [ ] RAW histogram generation and clipping detection
- [ ] Advanced metadata parsing (maker notes, lens profiles)
- [ ] Camera-specific processing profiles
- [ ] Batch RAW processing optimization
- [ ] Progressive RAW preview generation

## Development Notes

### Build Output
The LibRaw WebAssembly integration adds to the build:
- `libraw-*.wasm` (~1.3MB) - LibRaw WebAssembly binary
- `libraw-*.js` (~70KB) - JavaScript wrapper and interface
- Automatic code splitting and lazy loading

### Testing
- Automatic fallback ensures development continues without real RAW files
- LibRawStatus component provides visual feedback for debugging
- TypeScript ensures type safety across the integration
- Build process validates WebAssembly module inclusion

This integration brings professional RAW processing capabilities to Photo Editor Pro, matching the quality of desktop applications like darktable while maintaining web compatibility.