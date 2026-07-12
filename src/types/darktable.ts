// Darktable module types based on the C source code analysis

export interface ModuleParams {
  [key: string]: unknown;
}

export interface ModuleMetadata {
  id: string;
  name: string;
  description: string;
  group: ModuleGroup;
  version: number;
  flags: ModuleFlags;
}

export enum ModuleGroup {
  BASIC = 'basic',
  TONE = 'tone',
  COLOR = 'color',
  CORRECT = 'correct',
  EFFECT = 'effect',
  TECHNICAL = 'technical',
  GRADING = 'grading'
}

export enum ModuleFlags {
  SUPPORTS_BLENDING = 1 << 1,
  ALLOW_TILING = 1 << 4,
  ONE_INSTANCE = 1 << 7,
  NO_MASKS = 1 << 10
}

// Exposure module parameters (from exposure.c)
export interface ExposureParams extends ModuleParams {
  mode: 'manual' | 'automatic';
  black: number;                    // -1.0 to 1.0, default: 0.0
  exposure: number;                 // -18.0 to 18.0, default: 0.0
  deflicker_percentile: number;     // 0.0 to 100.0, default: 50.0
  deflicker_target_level: number;   // -18.0 to 18.0, default: -4.0
  compensate_exposure_bias: boolean; // default: false
}

// Basic adjustments parameters (from basicadj.c)
export interface BasicAdjustmentParams extends ModuleParams {
  black_point: number;    // -1.0 to 1.0, default: 0.0
  exposure: number;       // -18.0 to 18.0, default: 0.0
  hlcompr: number;        // 0 to 500.0, default: 0.0 (highlight compression)
  contrast: number;       // -1.0 to 5.0, default: 0.0
  middle_grey: number;    // 0.05 to 100, default: 18.42
  brightness: number;     // -4.0 to 4.0, default: 0.0
  saturation: number;     // -1.0 to 1.0, default: 0.0
  vibrance: number;       // -1.0 to 1.0, default: 0.0
}

// White balance parameters (from temperature.c)
export interface WhiteBalanceParams extends ModuleParams {
  temp_out: number;       // 1667 to 25000, default: 5000
  tint: number;          // 0.135 to 2.326, default: 1.0
  coeffs: [number, number, number]; // RGB coefficients
}

// Curve node for tone curves
export interface CurveNode {
  x: number; // 0.0 to 1.0
  y: number; // 0.0 to 1.0
}

// Base curve parameters (from basecurve.c)
export interface BaseCurveParams extends ModuleParams {
  basecurve: CurveNode[][]; // 3 curves with up to 20 nodes each
  basecurve_nodes: number[]; // Number of nodes per curve
  basecurve_type: number[];  // Curve interpolation type
  exposure_fusion: number;   // Fusion steps, default: 0
  exposure_stops: number;    // 0.01 to 4.0, default: 1.0
  exposure_bias: number;     // -1.0 to 1.0, default: 1.0
}

// Image processing context
export interface ProcessingContext {
  width: number;
  height: number;
  channels: number; // Usually 4 (RGBA) or 3 (RGB)
  data: Float32Array | Uint8ClampedArray;
  roi?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// Module interface that all darktable modules implement
export interface DarktableModule<T extends ModuleParams = ModuleParams> {
  metadata: ModuleMetadata;
  defaultParams: T;

  // Core processing function
  process(input: ProcessingContext, params: T): ProcessingContext;

  // Parameter validation
  validateParams(params: Partial<T>): T;

  // Get parameter constraints
  getParamConstraints(): Record<keyof T, {
    min: number;
    max: number;
    default: number;
    step?: number;
    unit?: string;
  }>;

  // Initialize module
  init?(): void;

  // Cleanup resources
  cleanup?(): void;
}