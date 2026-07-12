# Development Guide

## 🚀 **Getting Started**

This guide will help you set up, develop, and contribute to Vitrine.

## 🛠️ **Prerequisites**

### **System Requirements**
- **Node.js**: 16.0.0 or higher
- **npm**: 8.0.0 or higher
- **Git**: Latest version
- **Operating System**: Windows 10+, macOS 10.15+, or Linux (Ubuntu 18.04+)

### **Recommended Hardware**
- **RAM**: 16GB+ (8GB minimum)
- **Storage**: 10GB+ free space on SSD
- **GPU**: Any GPU with WebGL2 support (recommended for best performance)
- **CPU**: Multi-core processor (8+ cores recommended)

### **Development Tools**
- **Code Editor**: Visual Studio Code (recommended)
- **Extensions**: TypeScript, ESLint, Prettier, Tailwind CSS IntelliSense
- **Browser**: Chrome/Edge with WebGL2 support

## 📦 **Installation & Setup**

### **1. Clone the Repository**
```bash
git clone https://github.com/your-username/photo_app.git
cd photo_app
```

### **2. Install Dependencies**
```bash
# Install all dependencies
npm install

# Optional: Install global tools
npm install -g typescript eslint prettier
```

### **3. Environment Setup**
```bash
# Create environment file (optional)
cp .env.example .env

# Configure any local environment variables
# GPU_ACCELERATION=true
# DEBUG_MODE=true
# LOG_LEVEL=debug
```

### **4. Development Server**
```bash
# Start web development server
npm run dev

# Start Electron desktop app
npm run electron-dev

# Start both concurrently (recommended)
npm run start
```

### **5. Verify Installation**
Open your browser to `http://localhost:3005` and verify:
- ✅ Application loads without errors
- ✅ File browser works
- ✅ Image processing modules are functional
- ✅ GPU acceleration initializes (check browser console)

## 🏗️ **Project Structure**

```
photo_app/
├── src/                          # Main application source
│   ├── components/              # React components
│   │   ├── Controls/           # UI controls (sliders, buttons, etc.)
│   │   ├── Dialogs/            # Modal dialogs
│   │   ├── Layout/             # Layout components
│   │   ├── Modules/            # Processing module UIs
│   │   └── Panels/             # Main UI panels
│   ├── modules/                # Processing modules
│   ├── services/               # Core services
│   ├── stores/                 # State management
│   ├── types/                  # TypeScript definitions
│   ├── utils/                  # Utility functions
│   └── hooks/                  # Custom React hooks
├── electron/                   # Electron main process
├── public/                     # Static assets
├── docs/                       # Documentation
├── scripts/                    # Build and utility scripts
└── tests/                      # Test files
```

### **Key Directories Explained**

#### **`src/components/`**
React components organized by type:
- **Controls**: Reusable UI controls (ColorWheel, Slider, etc.)
- **Dialogs**: Modal dialogs (Export, Batch Processing, etc.)
- **Layout**: Main layout components (Canvas, FileBrowser, etc.)
- **Modules**: UI for each processing module
- **Panels**: Main application panels

#### **`src/services/`**
Core application services:
- **ImageProcessingPipeline**: Main processing orchestration
- **RawImageService**: RAW load/decode orchestration (decode runs in the Electron main process — `electron/rawDecoder.cjs`)
- **GPUAccelerationService**: WebGL2 GPU pipeline optimization
- **ExportService**: Multi-format export functionality

#### **`src/modules/`**
Processing modules implementing the standard interface:
- Each module handles specific processing (exposure, color, etc.)
- Consistent parameter management and validation
- Auto-adjustment capabilities

## 🔧 **Development Scripts**

### **Essential Commands**
```bash
# Development
npm run dev                    # Start Vite dev server
npm run electron-dev          # Start Electron app
npm start                     # Start both concurrently

# Code Quality
npm run lint                  # Run ESLint
npm run lint:fix              # Fix ESLint errors automatically
npm run typecheck             # TypeScript compilation check
npm run format                # Format code with Prettier

# Testing
npm test                      # Run test suite
npm run test:watch            # Run tests in watch mode
npm run test:coverage         # Generate coverage report

# Building
npm run build                 # Build for production
npm run electron-build        # Build Electron app
npm run electron-dist         # Build distribution packages
npm run analyze               # Analyze bundle size
```

### **Specialized Scripts**
```bash
# LibRaw WebAssembly
npm run build:libraw          # Compile LibRaw to WebAssembly
npm run test:libraw           # Test LibRaw integration

# Performance
npm run benchmark             # Run performance benchmarks
npm run profile              # Profile application performance

# Documentation
npm run docs:serve           # Serve documentation locally
npm run docs:build           # Build documentation
```

## 🎯 **Development Workflow**

### **1. Feature Development**
```bash
# Create feature branch
git checkout -b feature/amazing-new-feature

# Make changes with proper TypeScript types
# Ensure 0 ESLint errors
npm run lint

# Test your changes
npm test

# Commit with conventional commits
git commit -m "feat: add amazing new feature"

# Push and create PR
git push origin feature/amazing-new-feature
```

### **2. Code Standards**

#### **TypeScript Requirements**
- **100% Type Safety**: No `any` types allowed
- **Strict Mode**: All TypeScript strict checks enabled
- **Interface Definitions**: Proper interfaces for all data structures
- **Error Handling**: Comprehensive error types and handling

#### **Code Style**
```typescript
// ✅ Good: Proper typing and error handling
interface ProcessingResult {
  imageData: Float32Array;
  metadata: ImageMetadata;
  processingTime: number;
}

async function processImage(filePath: string): Promise<ProcessingResult> {
  try {
    const result = await imageService.processRawFile(filePath);
    return {
      imageData: result.data,
      metadata: result.metadata,
      processingTime: result.timing.total
    };
  } catch (error) {
    logger.error('Image processing failed', { filePath, error });
    throw new ProcessingError('Failed to process image', error);
  }
}

// ❌ Bad: Any types and poor error handling
async function processImage(filePath: any): Promise<any> {
  const result = await imageService.processRawFile(filePath);
  return result;
}
```

#### **Component Structure**
```typescript
// ✅ Good: Proper component structure
interface ExposureModuleProps {
  exposure: number;
  blackpoint: number;
  onChange: (params: ExposureParams) => void;
  disabled?: boolean;
}

const ExposureModule: React.FC<ExposureModuleProps> = ({
  exposure,
  blackpoint,
  onChange,
  disabled = false
}) => {
  const handleExposureChange = useCallback((value: number) => {
    onChange({ exposure: value, blackpoint });
  }, [blackpoint, onChange]);

  return (
    <div className="space-y-4">
      <Slider
        label="Exposure"
        value={exposure}
        min={-3}
        max={3}
        step={0.1}
        onChange={handleExposureChange}
        disabled={disabled}
      />
    </div>
  );
};
```

### **3. Testing Guidelines**

#### **Unit Tests**
```typescript
describe('ExposureModule', () => {
  it('should process exposure adjustment correctly', async () => {
    const module = new ExposureModule();
    const testData = new Float32Array([0.5, 0.5, 0.5, 1.0]);

    module.setParameters({ exposure: 1.0, blackpoint: 0 });
    const result = await module.process(testData, 1, 1);

    expect(result[0]).toBeCloseTo(1.0, 2); // Should double brightness
  });

  it('should validate parameters correctly', () => {
    const module = new ExposureModule();

    expect(module.validateParameters({ exposure: 5.5 })).toEqual({
      valid: false,
      errors: ['Exposure must be between -3 and 3']
    });
  });
});
```

#### **Integration Tests**
```typescript
describe('RAW Processing Pipeline', () => {
  it('should process Canon CR3 file correctly', async () => {
    const filePath = './test-assets/canon_eos_r5.cr3';
    const result = await autoRawAdjustmentService.detectAndApplyRAWAdjustments(
      filePath,
      pipeline
    );

    expect(result.detected).toBe(true);
    expect(result.camera).toContain('Canon');
    expect(result.processingTime).toBeLessThan(1000);
  });
});
```

## 🔍 **Debugging & Performance**

### **Development Tools**

#### **Performance Monitor**
Press `Ctrl+Shift+P` during development to access:
- Real-time performance metrics
- GPU utilization monitoring
- Memory usage tracking
- Processing time analysis

#### **Debug Console**
```typescript
// Enable debug logging
localStorage.setItem('DEBUG_MODE', 'true');

// Performance profiling
console.time('image-processing');
await processImage(filePath);
console.timeEnd('image-processing');

// GPU monitoring
const gpuInfo = await getGPUInfo();
console.log('GPU Utilization:', gpuInfo.utilization);
```

#### **Browser DevTools**
- **Sources**: Set breakpoints in TypeScript code
- **Performance**: Profile rendering and processing
- **Memory**: Monitor memory usage and leaks
- **Console**: View logs and error messages

### **Common Issues & Solutions**

#### **TypeScript Errors**
```bash
# Check for type errors
npm run typecheck

# Common fixes
# - Add proper type annotations
# - Import missing types
# - Use type assertions carefully
```

#### **ESLint Errors**
```bash
# Fix automatically fixable errors
npm run lint:fix

# Common issues:
# - Missing dependencies in useEffect
# - Unused variables
# - Inconsistent naming
```

#### **Performance Issues**
```typescript
// Monitor processing performance
const startTime = performance.now();
await processImage(filePath);
const processingTime = performance.now() - startTime;
console.log(`Processing took ${processingTime}ms`);

// GPU optimization
if (imageSize > 12 * 1024 * 1024) {
  // Use GPU acceleration for large images
  await gpuProcessor.processImage(imageData);
}
```

## 🧪 **Testing Strategy**

### **Test Types**
1. **Unit Tests**: Individual modules and services
2. **Integration Tests**: Service interactions and workflows
3. **Performance Tests**: Processing speed and memory usage
4. **Visual Tests**: UI component rendering
5. **E2E Tests**: Complete user workflows

### **Test Coverage Goals**
- **Services**: 90%+ coverage
- **Processing Modules**: 95%+ coverage
- **UI Components**: 80%+ coverage
- **Utils**: 100% coverage

### **Running Tests**
```bash
# All tests
npm test

# Specific test file
npm test -- ExposureModule.test.ts

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

## 📦 **Building & Deployment**

### **Production Build**
```bash
# Build web application
npm run build

# Build Electron application
npm run electron-build

# Create distribution packages
npm run electron-dist
```

### **Bundle Analysis**
```bash
# Analyze bundle size
npm run analyze

# Expected bundle sizes:
# Main app: ~450KB
# Services: ~155KB
# UI components: ~16KB
# Vendor: ~12KB
```

### **Performance Validation**
Before deployment, verify:
- [ ] TypeScript compilation: 0 errors
- [ ] ESLint: 0 errors, <150 warnings
- [ ] Bundle size: <700KB total
- [ ] Processing performance: Meets target times
- [ ] GPU acceleration: Functional

## 🤝 **Contributing Guidelines**

### **Pull Request Process**
1. **Fork** the repository
2. **Create** a feature branch with descriptive name
3. **Implement** changes with proper tests
4. **Ensure** all checks pass (TypeScript, ESLint, tests)
5. **Write** clear commit messages using conventional commits
6. **Submit** PR with detailed description
7. **Respond** to review feedback promptly

### **Code Review Checklist**
- [ ] TypeScript: Proper types, no `any`
- [ ] Performance: No blocking operations on main thread
- [ ] Error Handling: Comprehensive error catching
- [ ] Testing: Adequate test coverage
- [ ] Documentation: Code is well-documented
- [ ] Security: No XSS vulnerabilities or unsafe operations

### **Commit Message Format**
```
type(scope): description

feat(gpu): add WebGL2 resident-texture pipeline
fix(export): resolve JPEG quality issue
docs(readme): update installation instructions
perf(processing): optimize demosaicing algorithm
test(modules): add exposure module tests
```

## 🔧 **IDE Configuration**

### **Visual Studio Code Settings**
```json
{
  "typescript.preferences.importModuleSpecifier": "relative",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true,
    "source.organizeImports": true
  },
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "files.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/build": true
  }
}
```

### **Recommended Extensions**
- **TypeScript Importer**: Auto-import TypeScript symbols
- **ESLint**: Real-time linting
- **Prettier**: Code formatting
- **Tailwind CSS IntelliSense**: CSS utility suggestions
- **GitLens**: Enhanced Git integration
- **Error Lens**: Inline error display

## 📚 **Additional Resources**

### **Documentation**
- [Technical Architecture](TECHNICAL_ARCHITECTURE.md)

- [RAW Processing Guide](RAW_PROCESSING.md)
- [API Reference](API_REFERENCE.md)

### **External Resources**
- [React Documentation](https://reactjs.org/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs)
- [Electron Documentation](https://www.electronjs.org/docs)
- [Vite Documentation](https://vitejs.dev/guide)
- [LibRaw Documentation](https://libraw.org/docs)

### **Community**
- **Issues**: Report bugs and request features
- **Discussions**: Ask questions and share ideas
- **Wiki**: Community-maintained documentation
- **Discord**: Real-time development chat

## 🎉 **Welcome to the Team!**

Thank you for contributing to Vitrine! This project aims to create the best professional photo editing experience on the web, and your contributions help make that vision a reality.

For questions or support, feel free to:
- Open an issue on GitHub
- Join our Discord community
- Check the documentation
- Ask in discussions

Happy coding! 🚀✨