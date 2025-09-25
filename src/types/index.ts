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

export interface AppState {
  currentImage: ImageFile | null;
  selectedTool: string | null;
  layers: Layer[];
  viewport: ViewportState;
  sidebarCollapsed: boolean;
  processedImageData: Float32Array | null;
}