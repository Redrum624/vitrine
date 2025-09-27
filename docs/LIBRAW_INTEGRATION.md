# LibRaw WebAssembly Integration

This document describes the LibRaw WebAssembly integration for professional RAW image processing in Photo Editor Pro.

> **Note**: This document has been superseded by [RAW Processing Guide](RAW_PROCESSING.md). This file is kept for historical reference.

## Overview

The LibRaw integration provides professional-grade RAW image processing capabilities through WebAssembly, enabling high-quality demosaicing, color correction, and camera-specific optimizations directly in the browser.

## Architecture

### Core Components

1. **LibRawWasm** (`src/services/LibRawWasm.ts`)
   - Low-level WebAssembly bindings to LibRaw C++ library
   - Memory management and parameter marshalling
   - Mock fallback implementation for development

2. **AdvancedRawProcessor** (`src/services/AdvancedRawProcessor.ts`)
   - High-level RAW processing pipeline
   - Camera profile management
   - Quality enhancement algorithms (denoising, sharpening)

3. **AdvancedRawModule** (`src/components/Modules/AdvancedRawModule.tsx`)
   - React UI component for advanced RAW controls
   - Professional parameter adjustment interface
   - Real-time processing feedback

### Integration Flow

```
RAW File → LibRawWasm → AdvancedRawProcessor → AdvancedRawModule
    ↓            ↓              ↓                     ↓
File Load → WASM Process → Apply Profiles → Update UI
    ↓            ↓              ↓                     ↓
Canvas Update ← ImageData ← Enhanced Data ← User Controls
```

## Features

### Demosaicing Algorithms

- **Draft (Linear)**: Fast processing for previews
- **Good (VNG)**: Balanced quality and performance
- **Best (AHD)**: Highest quality for final output

### White Balance Options

- **Camera WB**: Use camera-recorded white balance
- **Auto WB**: Automatic white balance detection
- **Custom WB**: Manual temperature (2000K-25000K) and tint adjustment

### Color Management

- **Color Spaces**: sRGB, Adobe RGB, ProPhoto RGB
- **Camera Profiles**: Manufacturer-specific color matrices
- **Bit Depth**: 8-bit or 16-bit output

### Quality Enhancement

- **Noise Reduction**: Advanced bilateral filtering
- **Sharpening**: Unsharp mask algorithm
- **Highlight Recovery**: Blend/clip/rebuild modes

### Camera-Specific Optimizations

#### Olympus
- AHD demosaicing with highlight blending
- Custom color matrices for natural color reproduction
- Optimized gamma curve (γ=2.2, slope=4.5)

#### Canon
- AHD demosaicing with unclipped highlights
- Standard sRGB gamma for consistent results
- Enhanced baseline sharpness

#### Nikon
- VNG demosaicing (works well with Nikon sensors)
- Clipped highlight handling
- Standard color matrices

#### Sony
- AHD demosaicing with highlight blending
- Custom color science for Sony's unique sensor characteristics
- Slightly enhanced contrast

## WebAssembly Compilation

### Prerequisites

1. **Emscripten SDK**
   ```bash
   git clone https://github.com/emscripten-core/emsdk.git
   cd emsdk
   ./emsdk install latest
   ./emsdk activate latest
   source ./emsdk_env.sh
   ```

2. **LibRaw Source**
   - Located in `darktable/src/external/LibRaw/`
   - Version 0.21.1+ recommended

### Build Process

1. **Run Build Script**
   ```bash
   node scripts/build-libraw-wasm.js
   ```

2. **Manual Compilation** (if needed)
   ```bash
   cd build/libraw-wasm
   emconfigure cmake ../darktable/src/external/LibRaw
   emmake make

   # Compile to WebAssembly
   emcc -O3 -s WASM=1 -s MODULARIZE=1 \
        -s EXPORT_NAME="LibRawWasm" \
        -s INITIAL_MEMORY=64MB \
        -s MAXIMUM_MEMORY=2GB \
        -s ALLOW_MEMORY_GROWTH=1 \
        [LibRaw source files] \
        -o public/wasm/libraw.js
   ```

### Build Configuration

The build uses these key flags:
- `-O3`: Maximum optimization
- `-s WASM=1`: Enable WebAssembly output
- `-s MODULARIZE=1`: Create module function
- `-s INITIAL_MEMORY=64MB`: Start with 64MB heap
- `-s MAXIMUM_MEMORY=2GB`: Allow up to 2GB for large RAW files
- `-s ALLOW_MEMORY_GROWTH=1`: Dynamic memory allocation

## API Reference

### LibRawWasm

#### Core Methods

```typescript
// Initialize the WASM module
await libraw.initialize(): Promise<void>

// Process RAW file with parameters
await libraw.processRawFile(
  filePath: string,
  params?: LibRawProcessingParams
): Promise<{imageData: LibRawImageData, metadata: LibRawMetadata}>

// Olympus-specific processing
await libraw.processOlympusORF(
  filePath: string,
  params?: Partial<LibRawProcessingParams>
): Promise<{imageData: LibRawImageData, metadata: LibRawMetadata}>
```

#### Processing Parameters

```typescript
interface LibRawProcessingParams {
  // White balance
  temperature: number;          // 2000-25000K
  tint: number;                 // 0.2-2.5
  useAutoWB: boolean;
  useCameraWB: boolean;

  // Exposure
  exposure: number;             // -5 to +5 EV
  brightness: number;           // 0.1-4.0

  // Output
  outputColorSpace: number;     // 0=sRGB, 1=Adobe RGB, etc.
  outputDepth: number;          // 8 or 16 bits
  gamma: [number, number];      // [gamma, slope]

  // Demosaicing
  demosaicAlgorithm: number;    // 0=linear, 1=VNG, 2=PPG, 3=AHD
  halfSize: boolean;
  fourColorRGB: boolean;

  // Quality
  highlightMode: number;        // 0=clip, 1=unclip, 2=blend, 3=rebuild
  denoise: boolean;
  useCameraProfile: boolean;
}
```

### AdvancedRawProcessor

#### Processing Options

```typescript
interface AdvancedRawProcessingOptions {
  // Quality settings
  demosaicQuality: 'draft' | 'good' | 'best';

  // White balance
  whiteBalanceMode: 'camera' | 'auto' | 'custom';
  temperature?: number;         // Custom temperature
  tint?: number;               // Custom tint

  // Exposure and tone
  exposureCompensation: number; // -5 to +5 EV
  highlightRecovery: boolean;
  shadowBoost: boolean;

  // Color management
  colorSpace: 'sRGB' | 'AdobeRGB' | 'ProPhotoRGB';
  useManufacturerProfile: boolean;

  // Output
  outputBitDepth: 8 | 16;
  outputSize: 'full' | 'half' | 'quarter';

  // Enhancement
  denoiseThreshold: number;     // 0-1
  sharpening: number;          // 0-2
  applyLensCorrections: boolean;
}
```

### Camera Profiles

Camera profiles contain manufacturer-specific color matrices and processing parameters:

```typescript
interface CameraProfile {
  make: string;
  model: string;
  colorMatrix1: number[];       // 3x3 color matrix
  colorMatrix2: number[];       // Second illuminant matrix
  dngColorSpace: number;
  baselineExposure: number;     // Exposure bias
  baselineNoise: number;        // Noise level
  baselineSharpness: number;    // Sharpness level
}
```

## Performance Considerations

### Memory Usage

- **Small RAW files** (12-24MP): ~100-200MB peak memory
- **Large RAW files** (40-60MP): ~400-800MB peak memory
- **Extreme files** (100MP+): Up to 2GB with growth enabled

### Processing Speed

- **Draft mode**: ~500-1000ms for 24MP files
- **Good mode**: ~1500-3000ms for 24MP files
- **Best mode**: ~3000-6000ms for 24MP files

### Optimization Tips

1. **Use appropriate quality setting** for the use case
2. **Enable half-size processing** for previews
3. **Process in Web Workers** (future enhancement)
4. **Cache processed results** for identical parameters
5. **Use progressive loading** for large files

## Error Handling

The implementation includes comprehensive error handling:

```typescript
// Graceful fallback to basic processing
try {
  const result = await advancedRawProcessor.processRawFile(filePath, options);
} catch (advancedError) {
  logger.warn('Advanced processing failed, falling back to basic');
  const result = await rawImageService.decodeRawFile(filePath);
}
```

### Common Error Scenarios

1. **WASM module not loaded**: Falls back to mock implementation
2. **Unsupported RAW format**: Returns appropriate error message
3. **Memory exhaustion**: Reduces quality settings automatically
4. **Corrupted RAW file**: Provides detailed error information

## Testing

### Test Files

Use these RAW formats for testing:
- **Olympus**: `.orf` files from OM-D series
- **Canon**: `.cr2`, `.cr3` files from EOS series
- **Nikon**: `.nef` files from Z and D series
- **Sony**: `.arw` files from α series

### Test Scenarios

1. **Basic processing**: Load and process with default settings
2. **Quality modes**: Test draft/good/best demosaicing
3. **White balance**: Test camera/auto/custom WB modes
4. **Color spaces**: Test sRGB/Adobe RGB/ProPhoto RGB output
5. **Large files**: Test with 40MP+ RAW files
6. **Error conditions**: Test with corrupted or unsupported files

## Development Status

### ✅ Completed

- WebAssembly integration architecture
- Professional processing pipeline
- Camera profile system
- UI components for all parameters
- Mock implementation for development
- Build scripts and documentation

### ⚠️ In Progress

- LibRaw WebAssembly compilation
- Real WASM module integration
- Performance optimization

### 📋 Future Enhancements

- Web Worker processing
- Progressive image loading
- Advanced lens corrections
- Custom camera profiles
- Batch processing support

## Contributing

### Adding New Camera Profiles

1. Research camera's color matrices from DNG specifications
2. Add profile to `AdvancedRawProcessor.loadCameraProfiles()`
3. Test with actual RAW files from that camera
4. Document any special processing requirements

### Optimizing Processing Algorithms

1. Profile performance with actual RAW files
2. Identify bottlenecks in the processing pipeline
3. Consider SIMD optimizations in WebAssembly
4. Add progressive processing for better UX

### Testing Contributions

1. Test with various RAW formats and cameras
2. Report processing quality and performance results
3. Document any issues with specific file types
4. Verify memory usage with large files

## References

- [LibRaw Documentation](https://libraw.org/docs)
- [Emscripten Documentation](https://emscripten.org/docs)
- [DNG Specification](https://helpx.adobe.com/camera-raw/digital-negative.html)
- [RAW Processing Theory](https://en.wikipedia.org/wiki/Raw_image_format)
- [Color Science Resources](https://www.color.org/)