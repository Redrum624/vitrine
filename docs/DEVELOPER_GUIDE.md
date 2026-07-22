# Developer Guide - Photo Editing Application

**Version:** 1.0.0
**Last Updated:** 2025-10-22

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Core Systems](#core-systems)
4. [Development Setup](#development-setup)
5. [Creating New Modules](#creating-new-modules)
6. [Testing](#testing)
7. [Performance Optimization](#performance-optimization)
8. [Contributing](#contributing)

---

## Architecture Overview

### High-Level Architecture

```
┌──────────────────────────────────────────────────────┐
│                  User Interface (React)               │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐    │
│  │ Adjustment │  │   Canvas   │  │  Histogram │    │
│  │   Panel    │  │   Display  │  │   Display  │    │
│  └────────────┘  └────────────┘  └────────────┘    │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│         Image Processing Pipeline (Core)             │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐     │
│  │Module│→│Module│→│Module│→│Module│→│Module│ ...  │
│  │  1   │ │  2   │ │  3   │ │  4   │ │  10  │     │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘     │
│                      ▲                               │
│                      │ LRU Cache                     │
└──────────────────────┼───────────────────────────────┘
                       │
          ┌────────────┴──────────────┐
          │                           │
┌─────────▼────────┐     ┌───────────▼──────────┐
│   GPU Processing │     │  Advanced Algorithms  │
│   (WebGL2)       │     │  (BM3D, ACES, etc.)  │
│  ┌─────────────┐ │     │  ┌──────────────────┐│
│  │   Shaders   │ │     │  │ Denoising Service││
│  │  (7 types)  │ │     │  │ ACES Service     ││
│  └─────────────┘ │     │  │ Auto-Straighten  ││
└──────────────────┘     └─────────────────────┘
```

### Design Principles

1. **Modular Architecture**
   - Each processing step is an independent module
   - Modules are composable and reusable
   - Easy to add, remove, or reorder modules

2. **Non-Destructive Processing**
   - Original image data never modified
   - All adjustments are transformations
   - Full undo/redo capability

3. **Performance First**
   - LRU cache prevents redundant processing
   - GPU acceleration where possible
   - Async processing for responsiveness

4. **Type Safety**
   - Strict TypeScript throughout
   - Compile-time error detection
   - Better IDE support

5. **Local Processing**
   - No cloud dependencies
   - No external API calls
   - Complete user privacy

---

## Project Structure

```
photo_app/
├── src/
│   ├── components/          # React UI components
│   │   ├── Modules/         # Module-specific UI
│   │   ├── Panels/          # Adjustment panels
│   │   └── Canvas/          # Image display
│   │
│   ├── modules/             # Image processing modules
│   │   ├── CropModule.ts
│   │   ├── ExposureModule.ts
│   │   ├── NoiseReductionModule.ts
│   │   └── ... (10 total)
│   │
│   ├── services/            # Core services
│   │   ├── ImageProcessingPipeline.ts    # Main pipeline
│   │   ├── AdvancedDenoisingService.ts  # Denoising algorithms
│   │   ├── ACESColorService.ts          # ACES color science
│   │   ├── AutoStraightenService.ts     # Auto-straighten
│   │   └── WebWorkerImageProcessor.ts   # Multi-threading
│   │
│   ├── shaders/             # GPU shaders (WebGL2)
│   │   ├── GpuPreviewPipeline.ts   # Resident-texture preview pipeline
│   │   ├── passDescriptors.ts      # Per-module GPU pass definitions
│   │   └── ...
│   │
│   ├── utils/               # Utilities
│   │   ├── LRUCache.ts      # Memory management
│   │   ├── Logger.ts        # Logging system
│   │   └── ...
│   │
│   ├── test/                # Test suites
│   │   ├── PerformanceBenchmarks.ts
│   │   ├── IntegrationTests.ts
│   │   ├── ModuleTests.ts
│   │   ├── TestRunner.ts
│   │   └── runTests.ts
│   │
│   └── types/               # TypeScript definitions
│       └── darktable.d.ts
│
├── docs/                    # Documentation
│   ├── USER_GUIDE.md
│   ├── DEVELOPER_GUIDE.md (this file)
│   ├── API_REFERENCE.md
│   └── GETTING_STARTED.md
│
├── test-reports/            # Generated test reports
│
└── [config files]
    ├── tsconfig.json
    ├── package.json
    └── ...
```

---

## Core Systems

### 1. Image Processing Pipeline

**File:** `src/services/ImageProcessingPipeline.ts`

The pipeline is the heart of the application. It manages module execution order and caching.

**Key Responsibilities:**
- Module registration and ordering
- Sequential processing through modules
- LRU caching to prevent redundant computation
- Module parameter management

**Example Usage:**
```typescript
import { imageProcessingPipeline } from './services/ImageProcessingPipeline';

// Process an image
const result = await imageProcessingPipeline.processImage(
  imageData,    // Float32Array
  {
    width: 4000,
    height: 3000,
    channels: 4
  }
);
```

**Module Execution Order:**
1. Crop & Transform (geometric)
2. Lens Corrections (geometric)
3. Exposure
4. White Balance
5. Basic Adjustments
6. Tone Curve
7. Color Balance
8. Shadows & Highlights
9. Local Adjustments
10. Noise Reduction

### 2. LRU Cache System

**File:** `src/utils/LRUCache.ts`

Prevents memory leaks by limiting cache size.

**Features:**
- Maximum entry limit (100 items)
- Maximum memory limit (500MB)
- Least-recently-used eviction
- Automatic cleanup

**Example:**
```typescript
const cache = new LRUCache<CachedData>({
  maxSize: 100,
  maxMemory: 500 * 1024 * 1024,
  onEvict: (key, value) => {
    console.log(`Evicted: ${key}`);
  }
});

cache.set('key', data, sizeInBytes);
const result = cache.get('key');
```

### 3. Advanced Denoising Service

**File:** `src/services/AdvancedDenoisingService.ts`

Implements 4 world-class denoising algorithms.

**Algorithms:**
- **BM3D** - Block-Matching 3D (best quality, slowest)
- **Non-Local Means** - Excellent for textures
- **Wavelet** - Fast, edge-preserving
- **Hybrid** - Weighted combination of all methods

**Example:**
```typescript
import { advancedDenoisingService } from './services/AdvancedDenoisingService';

const denoised = advancedDenoisingService.denoiseSync(
  imageData,
  width,
  height,
  {
    method: 'bm3d',
    strength: 70,
    preserveDetail: 80
  }
);
```

### 4. GPU Processing System

**Files:** `src/shaders/GpuPreviewPipeline.ts`, `src/shaders/passDescriptors.ts`, `src/services/WebGLImageProcessor.ts`

Hardware-accelerated processing using WebGL2: a resident-texture preview pipeline
(the visible canvas renders straight from GPU passes defined per module in
`passDescriptors.ts`) plus `WebGLImageProcessor` for standalone GPU passes
(e.g. the tiled NLM denoiser used by exports). Gain/kernel math is shared with
the CPU path — e.g. white-balance gains come from the single `computeWBGains`
source and enhance kernels from `effectiveEnhanceKernels` — so GPU and CPU
cannot drift; parity self-tests gate the GPU route at startup.

**GPU-accelerated passes:**
- Exposure adjustment
- White balance
- Tone curve application
- Color balance
- Denoise (NLM, tiled for full-resolution exports)
- Saturation/vibrance
- Enhance (Richardson–Lucy deblur + FidelityFX CAS sharpening + Lanczos upscale)

### 5. ACES Color Science

**File:** `src/services/ACESColorService.ts`

Hollywood-standard color grading.

**Features:**
- sRGB ↔ ACES color space conversion
- ACES Reference Rendering Transform (RRT)
- ACES Output Device Transform (ODT)
- Color Decision List (CDL) support
- Filmic tone curves

**Example:**
```typescript
import { acesColorService } from './services/ACESColorService';

const processedImage = acesColorService.processImage(
  imageData,
  width,
  height,
  {
    exposure: 0.5,
    gamma: 1.0,
    saturation: 1.1
  }
);
```

### 6. Auto-Straighten Service

**File:** `src/services/AutoStraightenService.ts`

Automatic horizon detection using computer vision.

**Algorithms:**
- Canny edge detection (5-stage pipeline)
- Hough line transform
- Horizon line detection
- Vertical line detection
- Gradient-based fallback

**Example:**
```typescript
import { autoStraightenService } from './services/AutoStraightenService';

const result = await autoStraightenService.detectRotation(
  imageData,
  width,
  height
);

console.log(`Detected angle: ${result.angle}°`);
console.log(`Confidence: ${result.confidence}`);
console.log(`Method used: ${result.method}`);
```

---

## Development Setup

### Prerequisites

- Node.js 16+ and npm
- Git
- Modern IDE (VS Code recommended)
- WebGL2-compatible browser

### Installation

```bash
# Clone repository
git clone [repository-url]
cd photo_app

# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm run test

# Build for production
npm run build
```

### Development Scripts

```bash
npm run dev              # Start dev server with hot reload
npm run build            # Production build
npm run test             # Run all tests
npm run test:benchmark   # Run performance benchmarks only
npm run test:integration # Run integration tests only
npm run test:module      # Run module tests only
npm run lint             # Run linter
npm run typecheck        # TypeScript type checking
```

### IDE Setup (VS Code)

**Recommended Extensions:**
- ESLint
- Prettier
- TypeScript and JavaScript Language Features
- WebGL GLSL Editor

**Workspace Settings:**
```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  }
}
```

---

## Creating New Modules

### Module Interface

All modules must implement the `PipelineModule` interface:

```typescript
export interface PipelineModule {
  getId(): string;
  getName(): string;
  process(input: Float32Array, context: ProcessingContext): Float32Array;
  isEnabled?: boolean;
  getParams?(): Record<string, unknown>;
  resetParams?(): void;
}
```

### Step-by-Step Guide

**1. Create Module File**

`src/modules/MyNewModule.ts`:

```typescript
import { logger } from '../utils/Logger';

export interface MyNewModuleParams {
  enabled: boolean;
  strength: number;
  // ... other parameters
}

export class MyNewModule {
  private params: MyNewModuleParams = {
    enabled: false,
    strength: 50
  };

  getId(): string {
    return 'mynewmodule';
  }

  getName(): string {
    return 'My New Module';
  }

  getParams(): MyNewModuleParams {
    return { ...this.params };
  }

  setParams(params: Partial<MyNewModuleParams>): void {
    this.params = { ...this.params, ...params };
  }

  resetParams(): void {
    this.params = {
      enabled: false,
      strength: 50
    };
  }

  process(input: Float32Array, context: ProcessingContext): Float32Array {
    if (!this.params.enabled) {
      return new Float32Array(input);
    }

    const { width, height, channels } = context;
    const output = new Float32Array(input.length);

    // Your processing logic here
    for (let i = 0; i < input.length; i += channels) {
      output[i] = input[i] * (this.params.strength / 100);
      output[i + 1] = input[i + 1] * (this.params.strength / 100);
      output[i + 2] = input[i + 2] * (this.params.strength / 100);
      output[i + 3] = input[i + 3]; // Preserve alpha
    }

    return output;
  }
}
```

**2. Register Module in Pipeline**

`src/services/ImageProcessingPipeline.ts`:

```typescript
import { MyNewModule } from '../modules/MyNewModule';

private initializeModules(): void {
  // ... existing modules ...
  const myNewModule = new MyNewModule();

  // Add at appropriate position (8 = between shadows/highlights and noise reduction)
  this.addModule(myNewModule, 8);
}
```

**3. Create UI Component**

`src/components/Modules/MyNewModuleComponent.tsx`:

```typescript
import React from 'react';
import { MyNewModule, MyNewModuleParams } from '../../modules/MyNewModule';

interface Props {
  module: MyNewModule;
  onParamsChange: (params: Partial<MyNewModuleParams>) => void;
}

export function MyNewModuleComponent({ module, onParamsChange }: Props) {
  const params = module.getParams();

  return (
    <div className="module-panel">
      <h3>My New Module</h3>

      <label>
        <input
          type="checkbox"
          checked={params.enabled}
          onChange={(e) => onParamsChange({ enabled: e.target.checked })}
        />
        Enabled
      </label>

      <label>
        Strength: {params.strength}
        <input
          type="range"
          min="0"
          max="100"
          value={params.strength}
          onChange={(e) => onParamsChange({ strength: parseInt(e.target.value) })}
        />
      </label>
    </div>
  );
}
```

**4. Integrate into Adjustment Panel**

`src/components/Panels/AdjustmentPanel.tsx`:

```typescript
import { MyNewModuleComponent } from '../Modules/MyNewModuleComponent';

// In render:
const myNewModule = imageProcessingPipeline.getModule<MyNewModule>('mynewmodule');

{myNewModule && (
  <div className="module-section">
    <MyNewModuleComponent
      module={myNewModule}
      onParamsChange={(params) => handleModuleParamsChange('mynewmodule', params)}
    />
  </div>
)}
```

**5. Add Tests**

`src/test/ModuleTests.ts`:

```typescript
async testMyNewModule_Basic(): Promise<ModuleTestResult> {
  const startTime = performance.now();

  try {
    const module = new MyNewModule();
    const testImage = this.generateTestImage(512, 512, 0.5);

    module.setParams({ enabled: true, strength: 75 });
    const result = module.process(testImage, { width: 512, height: 512, channels: 4 });

    // Validate results
    // ... assertions ...

    return {
      moduleName: 'MyNewModule',
      testName: 'Basic Functionality',
      passed: true,
      duration: performance.now() - startTime
    };
  } catch (error) {
    return {
      moduleName: 'MyNewModule',
      testName: 'Basic Functionality',
      passed: false,
      duration: performance.now() - startTime,
      error: String(error)
    };
  }
}
```

---

## Testing

### Test Structure

We have 3 types of tests:

1. **Performance Benchmarks** - Measure processing speed
2. **Integration Tests** - End-to-end pipeline validation
3. **Module Tests** - Unit tests for individual modules

### Running Tests

```bash
# All tests
npm run test

# Individual suites
npm run test:benchmark
npm run test:integration
npm run test:module
```

### Writing Tests

**Performance Benchmark Example:**
```typescript
const results = await performanceBenchmarks.benchmarkModule(
  'exposure',     // module name
  4000,          // width
  3000,          // height
  10             // iterations
);
```

**Integration Test Example:**
```typescript
async testFullPipeline(): Promise<IntegrationTestResult> {
  const testImage = this.generateTestImage(1920, 1080, 'gradient');
  const result = await imageProcessingPipeline.processImage(
    testImage,
    { width: 1920, height: 1080, channels: 4 }
  );

  // Validate no crashes, no NaN values, correct size
  // ...

  return { testName: 'Full Pipeline', passed: true, duration: elapsed };
}
```

**Module Test Example:**
```typescript
async testExposureModule_Basic(): Promise<ModuleTestResult> {
  const module = new ExposureModule();
  module.setCurrentParams({ exposure: 1.0, black: 0 });

  const result = module.process(testImage, context);

  // Validate output is brighter
  // ...

  return { moduleName: 'ExposureModule', testName: 'Basic', passed: true };
}
```

---

## Performance Optimization

### CPU Optimization

**1. Minimize Array Allocations**
```typescript
// Bad - creates new array every call
function process(input: Float32Array): Float32Array {
  const output = new Float32Array(input.length);
  // ...
  return output;
}

// Good - reuse buffer if possible
function process(input: Float32Array, output?: Float32Array): Float32Array {
  if (!output || output.length !== input.length) {
    output = new Float32Array(input.length);
  }
  // ...
  return output;
}
```

**2. Use Typed Arrays**
```typescript
// Bad - generic arrays are slow
const data: number[] = [1, 2, 3];

// Good - typed arrays are fast
const data = new Float32Array([1, 2, 3]);
```

**3. Cache Calculations**
```typescript
// Bad - recalculates every pixel
for (let i = 0; i < pixels; i++) {
  const factor = Math.pow(2, exposure);
  output[i] = input[i] * factor;
}

// Good - calculate once
const factor = Math.pow(2, exposure);
for (let i = 0; i < pixels; i++) {
  output[i] = input[i] * factor;
}
```

### GPU Optimization

**1. Batch Operations**
- Process multiple operations in one shader pass
- Reduces texture uploads/downloads

**2. Use Appropriate Precision**
```glsl
// For most operations, mediump is sufficient
precision mediump float;

// Only use highp when necessary
precision highp float;
```

**3. Minimize Texture Lookups**
```glsl
// Bad - multiple lookups
vec4 color = texture(u_image, v_texCoord);
float r = texture(u_image, v_texCoord).r;
float g = texture(u_image, v_texCoord).g;

// Good - single lookup
vec4 color = texture(u_image, v_texCoord);
float r = color.r;
float g = color.g;
```

### Memory Optimization

**1. Use LRU Cache**
- Cache is automatically managed
- Manual invalidation when parameters change

**2. Limit Working Resolution**
- Preview at reduced resolution
- Process at full resolution for export

**3. Progressive Rendering**
- Low-res preview first
- High-res render after user stops adjusting

---

## Contributing

### Code Style

- Use TypeScript strict mode
- Follow existing naming conventions
- Add JSDoc comments for public APIs
- Keep functions small and focused
- Prefer functional programming patterns

### Git Workflow

```bash
# Create feature branch
git checkout -b feature/my-new-feature

# Make changes
# ... code ...

# Run tests
npm run test
npm run typecheck

# Commit
git add .
git commit -m "Add my new feature"

# Push
git push origin feature/my-new-feature

# Create pull request
```

### Pull Request Checklist

- [ ] Tests pass (`npm run test`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] Code is documented
- [ ] New tests added for new features
- [ ] Performance impact assessed
- [ ] README updated if needed

---

## Common Patterns

### Error Handling

```typescript
try {
  const result = await someOperation();
  logger.info('Operation succeeded');
  return result;
} catch (error) {
  logger.error('Operation failed:', error);
  // Return fallback or rethrow
  return fallbackValue;
}
```

### Async Processing

```typescript
async function processImage(imageData: Float32Array): Promise<Float32Array> {
  // Allow UI to stay responsive
  await new Promise(resolve => setTimeout(resolve, 0));

  // Do work
  const result = heavyProcessing(imageData);

  return result;
}
```

### Parameter Validation

```typescript
private validateParams(params: Partial<ModuleParams>): ModuleParams {
  const validated: ModuleParams = { ...this.defaultParams };

  if (params.strength !== undefined) {
    validated.strength = Math.max(0, Math.min(100, params.strength));
  }

  // ... validate other params ...

  return validated;
}
```

---

## Resources

### Internal Documentation
- `docs/USER_GUIDE.md` - End-user documentation
- `docs/API_REFERENCE.md` - Detailed API documentation
- `docs/GETTING_STARTED.md` - Quick start guide

### External Resources
- [WebGL2 Specification](https://www.khronos.org/registry/webgl/specs/latest/2.0/)
- [ACES Documentation](https://acescentral.com/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [React Documentation](https://react.dev/)

---

## FAQ

**Q: How do I debug WebGL shaders?**
A: Use Spector.js browser extension to capture WebGL frames and inspect shader execution.

**Q: Why is processing slow?**
A: Check GPU acceleration is enabled, reduce preview resolution, profile with Chrome DevTools.

**Q: How do I add support for a new file format?**
A: Implement a new loader in `src/services/ImageLoader.ts` and register it with the file input handler.

**Q: Can modules be processed in parallel?**
A: No, modules must be processed sequentially because each depends on the previous output.

---

**For questions or issues, please contact the development team or open an issue on GitHub.**
