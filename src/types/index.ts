// Metadata types for image processing
export interface ExifData {
  [key: string]: string | number | boolean | Date | null | undefined;
  // Common EXIF fields
  Make?: string;
  Model?: string;
  DateTime?: string;
  ISO?: number;
  FNumber?: number;
  ExposureTime?: string;
  FocalLength?: number;
  Flash?: number;
  WhiteBalance?: number;
  ColorSpace?: number;
  ExifImageWidth?: number;
  ExifImageHeight?: number;
  Orientation?: number;
}

export interface IptcData {
  [key: string]: string | string[] | undefined;
  // Common IPTC fields
  title?: string;
  description?: string;
  keywords?: string[];
  category?: string;
  urgency?: string;
  byline?: string;
  credit?: string;
  source?: string;
  copyright?: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface XmpData {
  [namespace: string]: Record<string, unknown> | undefined;
  // Common XMP namespaces
  dc?: Record<string, unknown>; // Dublin Core
  xmp?: Record<string, unknown>; // XMP Basic
  photoshop?: Record<string, unknown>; // Photoshop
  tiff?: Record<string, unknown>; // TIFF
  exif?: Record<string, unknown>; // EXIF
}

export interface IccProfile {
  profileDescription?: string;
  colorSpace?: string;
  profileClass?: string;
  deviceManufacturer?: string;
  deviceModel?: string;
  renderingIntent?: number;
  whitePoint?: number[];
  redColorant?: number[];
  greenColorant?: number[];
  blueColorant?: number[];
  [key: string]: string | number | number[] | undefined;
}

export interface ThumbnailData {
  data?: ArrayBuffer;
  width?: number;
  height?: number;
  format?: string;
  quality?: number;
}

export interface ImageMetadata {
  exif: ExifData;
  iptc: IptcData;
  xmp: XmpData;
  icc: IccProfile;
  thumbnail: ThumbnailData;
}

// Processing job types
export interface JobData {
  imageData?: Float32Array;
  filePath?: string;
  outputPath?: string;
  settings?: ProcessingSettings;
  metadata?: ImageMetadata;
  format?: string;
  quality?: number;
  width?: number;
  height?: number;
  moduleParameters?: Record<string, ModuleParameters>;
  images?: ImageOperation[];
  operations?: ProcessingOperation[];
}

export interface ProcessingParameters {
  [moduleId: string]: ModuleParameters | undefined;
  exposure?: ExposureParams;
  whiteBalance?: WhiteBalanceParams;
  basicAdjustments?: BasicAdjustmentsParams;
  toneCurve?: ToneCurveParams;
  colorBalance?: ColorBalanceParams;
  shadowsHighlights?: ShadowsHighlightsParams;
  lensCorrections?: LensCorrectionsParams;
  localAdjustments?: LocalAdjustmentsParams;
}

export interface ProcessingSettings {
  quality: 'draft' | 'balanced' | 'quality';
  useGPU: boolean;
  maxThreads: number;
  memoryLimit: number;
  enableCaching: boolean;
  outputFormat: string;
  colorSpace: string;
  bitDepth: number;
}

// GPU operation types
export interface WebGLUniforms {
  [uniform: string]: number | number[] | WebGLTexture | Int32Array | Float32Array | undefined;
  // Common uniforms
  u_resolution?: number[];
  u_texture?: WebGLTexture;
  u_time?: number;
  u_exposure?: number;
  u_contrast?: number;
  u_saturation?: number;
  u_temperature?: number;
  u_tint?: number;
}

// Service configuration types
export interface ServiceConfig {
  [key: string]: string | number | boolean | ServiceConfig | undefined;
  enabled: boolean;
  priority?: number;
  maxRetries?: number;
  timeout?: number;
}

export interface WorkerConfig extends ServiceConfig {
  maxConcurrency: number;
  queueSize: number;
  idleTimeout: number;
  workerScript: string;
}

export interface CacheConfig extends ServiceConfig {
  maxSize: number;
  ttl: number;
  strategy: 'lru' | 'fifo' | 'lfu';
  compression: boolean;
}

// Module parameter interfaces
export interface ModuleParameters {
  [key: string]: number | string | boolean | object | undefined;
}

export interface ExposureParams extends ModuleParameters {
  exposure: number;
  blackpoint: number;
  mode: 'additive' | 'multiplicative';
}

export interface WhiteBalanceParams extends ModuleParameters {
  temperature: number;
  tint: number;
  illuminant: 'daylight' | 'tungsten' | 'fluorescent' | 'flash' | 'custom';
}

export interface BasicAdjustmentsParams extends ModuleParameters {
  contrast: number;
  brightness: number;
  saturation: number;
  vibrance: number;
  clarity: number;
  dehaze: number;
}

export interface ToneCurveParams extends ModuleParameters {
  points: Array<{ x: number; y: number }>;
  channel: 'rgb' | 'red' | 'green' | 'blue';
  interpolation: 'linear' | 'smooth' | 'sharp';
}

export interface ColorBalanceParams extends ModuleParameters {
  shadows: { cyan: number; magenta: number; yellow: number };
  midtones: { cyan: number; magenta: number; yellow: number };
  highlights: { cyan: number; magenta: number; yellow: number };
  preserveLuminosity: boolean;
}

export interface ShadowsHighlightsParams extends ModuleParameters {
  shadows: number;
  highlights: number;
  whitepoint: number;
  blackpoint: number;
  radius: number;
  compress: number;
}

export interface LensCorrectionsParams extends ModuleParameters {
  vignetting: number;
  distortion: number;
  chromaticAberration: number;
  autoCorrection: boolean;
  lensProfile?: string;
}

export interface LocalAdjustmentsParams extends ModuleParameters {
  adjustments: LocalAdjustment[];
  activeAdjustment?: string;
  brushSize: number;
  brushHardness: number;
  brushOpacity: number;
}

export interface LocalAdjustment {
  id: string;
  type: 'brush' | 'gradient' | 'radial' | 'parametric';
  mask: Float32Array;
  parameters: ModuleParameters;
  blendMode: BlendMode;
  opacity: number;
  name: string;
  visible: boolean;
}

export interface ImageFile {
  id: string;
  name: string;
  path: string;
  thumbnail: string;
  metadata: {
    width: number;
    height: number;
    size: number;
    format: string;
    dateCreated: Date;
  };
  isRaw?: boolean;
  autoAdjustmentResult?: import('../services/AutoRawAdjustmentService').RAWDetectionResult;
}

export interface Tool {
  id: string;
  name: string;
  icon: string;
  category: 'adjustment' | 'selection' | 'transform' | 'filter';
}

export interface Adjustment {
  id: string;
  name: string;
  value: number;
  min: number;
  max: number;
  default: number;
  unit?: string;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  adjustments: Adjustment[];
}

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'difference'
  | 'exclusion';

export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
  rotation: number;
}

export interface ProcessedImageData {
  data: Float32Array;
  width: number;
  height: number;
  isPreview: boolean;
}

export type RenderMode = 'gpu' | 'cpu';

export interface AppState {
  selectedTool: string | null;
  layers: Layer[];
  viewport: ViewportState;
  sidebarCollapsed: boolean;
  processedImageData: Float32Array | ProcessedImageData | null;
}

// Image operation interfaces for JobData
export interface ImageOperation {
  imageData: Float32Array;
  width: number;
  height: number;
  format?: string;
  metadata?: ImageMetadata;
}

export interface ProcessingOperation {
  imageData: Float32Array;
  width: number;
  height: number;
  operation: string;
  params?: ModuleParameters;
}