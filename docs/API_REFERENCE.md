# API Reference

## 🏗️ **Core Services API**

This document provides comprehensive API documentation for Photo Editor Pro's core services and interfaces.

## 📷 **Image Processing Pipeline**

### **ImageProcessingPipeline**

The main orchestrator for all image processing operations.

```typescript
class ImageProcessingPipeline {
  // Initialize pipeline with modules
  constructor(modules: ProcessingModule[]);

  // Core processing
  async processImage(
    imageData: Float32Array,
    width: number,
    height: number
  ): Promise<Float32Array>;

  // Module management
  getModule(moduleId: string): ProcessingModule | null;
  addModule(module: ProcessingModule): void;
  removeModule(moduleId: string): boolean;
  getModuleOrder(): string[];
  setModuleOrder(order: string[]): void;

  // Parameter management
  getAllParameters(): Record<string, ModuleParameters>;
  setModuleParameters(moduleId: string, params: Partial<ModuleParameters>): void;
  resetAllParameters(): void;

  // History management
  saveState(description: string): void;
  undo(): boolean;
  redo(): boolean;
  getHistoryLength(): number;
}
```

#### **Events**
```typescript
interface PipelineEvents {
  'processing:start': (moduleId: string) => void;
  'processing:progress': (progress: number) => void;
  'processing:complete': (result: ProcessingResult) => void;
  'processing:error': (error: ProcessingError) => void;
  'parameters:changed': (moduleId: string, params: ModuleParameters) => void;
}
```

## 🎛️ **Processing Modules**

### **ProcessingModule Interface**

All processing modules implement this standard interface:

```typescript
interface ProcessingModule {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly category: ModuleCategory;

  // Core processing
  process(
    imageData: Float32Array,
    width: number,
    height: number,
    params?: ModuleParameters
  ): Promise<Float32Array>;

  // Parameter management
  getParameters(): ModuleParameters;
  setParameters(params: Partial<ModuleParameters>): void;
  resetParameters(): void;
  getDefaultParameters(): ModuleParameters;

  // Validation
  validateParameters(params: ModuleParameters): ValidationResult;

  // Auto-adjustment (optional)
  autoAdjust?(
    imageData: Float32Array,
    metadata?: ImageMetadata
  ): void;

  // Performance
  estimateProcessingTime(width: number, height: number): number;
  supportsGPUAcceleration(): boolean;

  // Metadata
  getParameterSchema(): ParameterSchema;
  getDescription(): string;
}
```

### **Exposure Module**

```typescript
interface ExposureParams {
  exposure: number;      // -3.0 to 3.0 EV
  blackpoint: number;    // -0.3 to 0.3
  mode: 'additive' | 'multiplicative';
}

class ExposureModule implements ProcessingModule {
  readonly id = 'exposure';
  readonly name = 'Exposure';
  readonly version = '1.0.0';

  async process(
    imageData: Float32Array,
    width: number,
    height: number
  ): Promise<Float32Array>;

  setParameters(params: Partial<ExposureParams>): void;
  autoAdjust(imageData: Float32Array, metadata?: ImageMetadata): void;
}
```

### **White Balance Module**

```typescript
interface WhiteBalanceParams {
  temperature: number;   // 2000 to 25000 K
  tint: number;         // -2.0 to 2.0
  illuminant: 'daylight' | 'tungsten' | 'fluorescent' | 'flash' | 'custom';
}

class WhiteBalanceModule implements ProcessingModule {
  readonly id = 'whiteBalance';
  readonly name = 'White Balance';
  readonly version = '1.0.0';

  async process(
    imageData: Float32Array,
    width: number,
    height: number
  ): Promise<Float32Array>;

  setParameters(params: Partial<WhiteBalanceParams>): void;
  autoAdjust(imageData: Float32Array, metadata?: ImageMetadata): void;
}
```

### **Basic Adjustments Module**

```typescript
interface BasicAdjustmentsParams {
  contrast: number;      // -1.0 to 1.0
  brightness: number;    // -1.0 to 1.0
  saturation: number;    // 0.0 to 2.0
  vibrance: number;      // 0.0 to 2.0
  clarity: number;       // -1.0 to 1.0
}

class BasicAdjustmentsModule implements ProcessingModule {
  readonly id = 'basicAdjustments';
  readonly name = 'Basic Adjustments';
  readonly version = '1.0.0';

  async process(
    imageData: Float32Array,
    width: number,
    height: number
  ): Promise<Float32Array>;

  setParameters(params: Partial<BasicAdjustmentsParams>): void;
  autoAdjust(imageData: Float32Array, metadata?: ImageMetadata): void;
}
```

## 🖼️ **RAW Processing Services**

### **LibRawService**

Professional RAW processing via WebAssembly.

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

class LibRawService {
  // Core processing
  async processRawFile(
    buffer: ArrayBuffer,
    params?: Partial<LibRawProcessingParams>
  ): Promise<LibRawResult>;

  // Quality presets
  async processWithPreset(
    buffer: ArrayBuffer,
    preset: 'fast' | 'balanced' | 'quality'
  ): Promise<LibRawResult>;

  // Module management
  async initialize(): Promise<void>;
  isInitialized(): boolean;
  getVersion(): string;
  getSupportedFormats(): string[];
}

interface LibRawResult {
  imageData: Float32Array;
  width: number;
  height: number;
  metadata: RawMetadata;
  processingTime: number;
}
```

### **AutoRawAdjustmentService**

Intelligent parameter detection and application for RAW files.

```typescript
interface AutoAdjustmentParams {
  // Exposure
  exposure?: number;
  blackpoint?: number;

  // White balance
  temperature?: number;
  tint?: number;

  // Basic adjustments
  contrast?: number;
  brightness?: number;
  saturation?: number;
  vibrance?: number;
  clarity?: number;

  // Shadow/highlight recovery
  shadowRecovery?: number;
  highlightRecovery?: number;
  whitepoint?: number;
}

class AutoRawAdjustmentService {
  // Main auto-adjustment method
  async detectAndApplyRAWAdjustments(
    filePath: string,
    pipeline: ImageProcessingPipeline
  ): Promise<RAWDetectionResult>;

  // Camera-specific presets
  getCameraPresets(make?: string, model?: string): Partial<AutoAdjustmentParams>;

  // Condition-based adjustments
  getConditionBasedAdjustments(metadata: RawMetadata): Partial<AutoAdjustmentParams>;

  // Reset adjustments
  resetAutoAdjustments(pipeline: ImageProcessingPipeline): void;

  // Status
  isRAWFile(filePath: string): boolean;
  getSupportedFormats(): string[];
}

interface RAWDetectionResult {
  detected: boolean;
  camera?: string;
  adjustments?: AutoAdjustmentParams;
  processingTime?: number;
  error?: string;
}
```

## 🚀 **GPU Acceleration Services**

### **GPUAccelerationService**

WebGL2 high-performance processing.

```typescript
interface GPUProcessingOptions {
  useGPU: boolean;
  preferHighPerformance: boolean;
  maxTextureSize: number;
  enableShaderCache: boolean;
}

class GPUAccelerationService {
  // Core GPU processing
  async processWithGPU(
    imageData: Float32Array,
    width: number,
    height: number,
    shaderName: string,
    uniforms?: Record<string, any>
  ): Promise<Float32Array>;

  // Initialization
  async initialize(options?: GPUProcessingOptions): Promise<void>;
  isInitialized(): boolean;
  getGPUInfo(): GPUInfo;

  // Shader management
  async loadShader(name: string, vertexSource: string, fragmentSource: string): Promise<void>;
  hasShader(name: string): boolean;
  precompileShaders(): Promise<void>;

  // Memory management
  allocateTexture(width: number, height: number): WebGLTexture;
  releaseTexture(texture: WebGLTexture): void;
  getMemoryUsage(): MemoryUsage;
}

interface GPUInfo {
  vendor: string;
  renderer: string;
  version: string;
  maxTextureSize: number;
  maxRenderBufferSize: number;
  maxCombinedTextureImageUnits: number;
}
```

### **CUDAAcceleratedService**

CUDA/Tensor Core integration for RTX GPUs.

```typescript
interface CUDAProcessingOptions {
  enableTensorCores: boolean;
  streamCount: number;
  memoryPoolSize: string;
  priority: 'low' | 'normal' | 'high';
}

class CUDAAcceleratedService {
  // CUDA processing
  async processWithCUDA(
    imageData: Float32Array,
    width: number,
    height: number,
    algorithm: string
  ): Promise<Float32Array>;

  // Tensor Core AI
  async denoiseWithTensorCores(
    imageData: Float32Array,
    noiseProfile: NoiseProfile
  ): Promise<Float32Array>;

  // Stream management
  createStream(options?: CUDAProcessingOptions): CUDAStream;
  releaseStream(stream: CUDAStream): void;
  getStreamCount(): number;

  // Memory management
  allocateVRAM(size: number): VRAMBuffer;
  releaseVRAM(buffer: VRAMBuffer): void;
  getVRAMUsage(): VRAMUsage;
}
```

## 📤 **Export Services**

### **ExportService**

Multi-format export with quality settings.

```typescript
interface ExportOptions {
  format: 'jpeg' | 'png' | 'tiff' | 'webp' | 'avif';
  quality: number;              // 1-100 for lossy formats
  colorSpace: 'sRGB' | 'AdobeRGB' | 'ProPhotoRGB';
  bitDepth: 8 | 16;
  includeMetadata: boolean;
  stripLocation: boolean;
}

class ExportService {
  // Single export
  async exportImage(
    imageData: Float32Array,
    width: number,
    height: number,
    options: ExportOptions,
    outputPath: string
  ): Promise<ExportResult>;

  // Batch export
  async exportBatch(
    exports: ExportTask[],
    progressCallback?: (progress: number) => void
  ): Promise<ExportResult[]>;

  // Format validation
  validateExportOptions(options: ExportOptions): ValidationResult;
  getSupportedFormats(): ExportFormat[];
  getOptimalQuality(format: string, fileSize: number): number;
}

interface ExportResult {
  success: boolean;
  outputPath: string;
  fileSize: number;
  processingTime: number;
  error?: string;
}
```

### **BatchProcessingService**

Queue-based batch operations.

```typescript
interface BatchTask {
  id: string;
  type: 'process' | 'export' | 'preset';
  inputPath: string;
  outputPath?: string;
  parameters: any;
  priority: 'low' | 'normal' | 'high';
}

class BatchProcessingService {
  // Queue management
  addTask(task: BatchTask): string;
  removeTask(taskId: string): boolean;
  clearQueue(): void;
  getQueueLength(): number;

  // Processing control
  start(): void;
  pause(): void;
  stop(): void;
  isRunning(): boolean;

  // Progress monitoring
  onProgress(callback: (progress: BatchProgress) => void): void;
  onComplete(callback: (results: BatchResult[]) => void): void;
  onError(callback: (error: BatchError) => void): void;

  // Statistics
  getProcessingStats(): BatchStats;
}

interface BatchProgress {
  completed: number;
  total: number;
  currentTask: BatchTask;
  estimatedTimeRemaining: number;
}
```

## 🎨 **Advanced Features**

### **LocalAdjustmentsService**

Brush, gradient, and parametric adjustments.

```typescript
interface LocalAdjustment {
  id: string;
  type: 'brush' | 'gradient' | 'radial' | 'parametric';
  mask: Float32Array;
  parameters: AdjustmentParameters;
  blendMode: BlendMode;
  opacity: number;
}

class LocalAdjustmentsService {
  // Adjustment management
  addAdjustment(adjustment: LocalAdjustment): string;
  removeAdjustment(id: string): boolean;
  updateAdjustment(id: string, updates: Partial<LocalAdjustment>): void;
  getAdjustments(): LocalAdjustment[];

  // Mask operations
  createBrushMask(strokes: BrushStroke[]): Float32Array;
  createGradientMask(start: Point, end: Point, type: GradientType): Float32Array;
  createRadialMask(center: Point, radius: number): Float32Array;
  createParametricMask(criteria: ParametricCriteria): Float32Array;

  // Processing
  async applyAdjustments(
    imageData: Float32Array,
    width: number,
    height: number
  ): Promise<Float32Array>;
}
```

### **LuminosityMaskService**

Automatic luminosity-based selections.

```typescript
type LuminosityRange = 'lights' | 'darks' | 'midtones';

class LuminosityMaskService {
  // Mask generation
  generateLuminosityMask(
    imageData: Float32Array,
    width: number,
    height: number,
    range: LuminosityRange,
    level: number
  ): Float32Array;

  // Mask refinement
  refineMask(
    mask: Float32Array,
    width: number,
    height: number,
    options: MaskRefinementOptions
  ): Float32Array;

  // Mask operations
  combineMasks(
    mask1: Float32Array,
    mask2: Float32Array,
    operation: 'add' | 'subtract' | 'intersect' | 'exclude'
  ): Float32Array;

  // Preview generation
  generateMaskPreview(
    mask: Float32Array,
    width: number,
    height: number
  ): ImageData;
}
```

## 🔧 **Utility Services**

### **PresetService**

Preset management and sharing.

```typescript
interface Preset {
  id: string;
  name: string;
  description: string;
  category: string;
  parameters: Record<string, ModuleParameters>;
  thumbnail?: string;
  createdAt: Date;
  author?: string;
}

class PresetService {
  // Preset management
  savePreset(name: string, description: string, category: string): Preset;
  loadPreset(id: string): Preset | null;
  deletePreset(id: string): boolean;
  getPresets(category?: string): Preset[];

  // Import/Export
  async importPreset(data: string | File): Promise<Preset>;
  exportPreset(id: string): string;
  exportAllPresets(): string;

  // Application
  async applyPreset(presetId: string, pipeline: ImageProcessingPipeline): Promise<void>;
}
```

### **HistoryService**

Undo/redo with state management.

```typescript
interface HistoryState {
  id: string;
  description: string;
  parameters: Record<string, ModuleParameters>;
  timestamp: Date;
}

class HistoryService {
  // State management
  saveState(description: string, parameters: Record<string, ModuleParameters>): void;
  undo(): HistoryState | null;
  redo(): HistoryState | null;
  canUndo(): boolean;
  canRedo(): boolean;

  // History management
  getHistory(): HistoryState[];
  clearHistory(): void;
  setMaxHistoryLength(length: number): void;
  getHistoryLength(): number;

  // Events
  onStateChange(callback: (state: HistoryState) => void): void;
}
```

## 🛡️ **Error Handling**

### **Error Types**

```typescript
class ProcessingError extends Error {
  constructor(
    message: string,
    public readonly module: string,
    public readonly cause?: Error
  );
}

class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: any
  );
}

class GPUError extends Error {
  constructor(
    message: string,
    public readonly context: string,
    public readonly gpuInfo?: GPUInfo
  );
}

class FileFormatError extends Error {
  constructor(
    message: string,
    public readonly format: string,
    public readonly filePath: string
  );
}
```

### **Error Recovery**

```typescript
interface ErrorRecoveryStrategy {
  canRecover(error: Error): boolean;
  recover(error: Error): Promise<void>;
}

class ErrorHandlingService {
  // Error registration
  registerErrorHandler(errorType: string, handler: ErrorRecoveryStrategy): void;

  // Error handling
  async handleError(error: Error): Promise<void>;
  reportError(error: Error, context: string): void;

  // Recovery
  canRecover(error: Error): boolean;
  async attemptRecovery(error: Error): Promise<boolean>;
}
```

## 📊 **Performance Monitoring**

### **PerformanceService**

```typescript
interface PerformanceMetrics {
  processingTime: number;
  memoryUsage: number;
  gpuUtilization: number;
  cpuUsage: number;
  frameRate: number;
}

class PerformanceService {
  // Metrics collection
  startProfiling(operation: string): void;
  endProfiling(operation: string): number;
  recordMetric(name: string, value: number): void;

  // Real-time monitoring
  getMetrics(): PerformanceMetrics;
  onMetricsUpdate(callback: (metrics: PerformanceMetrics) => void): void;

  // Benchmarking
  async runBenchmark(test: BenchmarkTest): Promise<BenchmarkResult>;
  getBenchmarkHistory(): BenchmarkResult[];
}
```

## 🔌 **Plugin System**

### **Plugin Interface**

```typescript
interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;

  // Lifecycle
  initialize(context: PluginContext): Promise<void>;
  activate(): Promise<void>;
  deactivate(): Promise<void>;

  // Capabilities
  getCommands(): PluginCommand[];
  getMenuItems(): MenuItem[];
  getToolbarItems(): ToolbarItem[];
}

class PluginManager {
  // Plugin management
  async loadPlugin(pluginPath: string): Promise<Plugin>;
  unloadPlugin(id: string): boolean;
  getLoadedPlugins(): Plugin[];

  // Plugin execution
  executeCommand(pluginId: string, commandId: string, args?: any): Promise<any>;

  // Events
  onPluginLoaded(callback: (plugin: Plugin) => void): void;
  onPluginUnloaded(callback: (pluginId: string) => void): void;
}
```

This API reference provides the foundation for building professional photo editing applications with comprehensive RAW processing, GPU acceleration, and advanced editing capabilities. 🎨✨