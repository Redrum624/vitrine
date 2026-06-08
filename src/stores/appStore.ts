import { create } from 'zustand';
import type { AppState, ImageFile, Layer, ViewportState, ProcessedImageData } from '../types';

interface AppStore extends AppState {
  setCurrentImage: (image: ImageFile | null) => void;
  setSelectedTool: (toolId: string | null) => void;
  addLayer: (layer: Layer) => void;
  removeLayer: (layerId: string) => void;
  updateLayer: (layerId: string, updates: Partial<Layer>) => void;
  setViewport: (viewport: Partial<ViewportState>) => void;
  setProcessedImageData: (data: Float32Array | ProcessedImageData | null) => void;
  toggleSidebar: () => void;
  resetZoom: () => void;
  getCurrentPipelineSettings: () => Record<string, unknown>;
  // Rotation grid overlay state
  isAdjustingRotation: boolean;
  setIsAdjustingRotation: (adjusting: boolean) => void;
  // Processing trigger - increments to signal that reprocessing is needed
  processingVersion: number;
  triggerReprocessing: () => void;
  // Bumped only when module params are set in BULK from outside the panels
  // (Paste Style, Auto All, presets) so the open module panel can re-read
  // module.getParams() and refresh its sliders. NOT bumped on normal slider
  // edits (that would remount the panel mid-drag).
  externalParamsVersion: number;
  notifyExternalParamsChange: () => void;
  // True while the pipeline is (re)processing after a bulk apply (Auto All /
  // Paste Style) so the canvas can show its spinner; cleared when the new
  // processed image lands (setProcessedImageData).
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  // Live processing stats (surfaced in the StatusBar)
  lastProcessingTimeMs: number;
  modulesActive: number;
  modulesTotal: number;
  setProcessingStats: (s: { timeMs: number; active: number; total: number }) => void;
  // View overlays
  showGrid: boolean;
  showRulers: boolean;
  toggleGrid: () => void;
  toggleRulers: () => void;
  // Before/after comparison
  showOriginal: boolean;
  toggleOriginal: () => void;
  // Reference comparison
  referenceMode: boolean;
  referenceImageUrl: string | null;  // data-URL of the reference photo
  referenceImageName: string | null;
  toggleReferenceMode: () => void;
  setReferenceImage: (url: string | null, name: string | null) => void;
  // Star ratings (1-5, 0 = unrated)
  imageRatings: Record<string, number>;
  setImageRating: (imageId: string, rating: number) => void;
  // Multi-image selection
  selectedImageIds: string[];
  selectionAnchorId: string | null;
  setSelection: (ids: string[], anchorId?: string | null) => void;
  toggleImageSelection: (id: string) => void;
  clearSelection: () => void;
  // Export progress
  exportProgress: { current: number; total: number; currentName: string; cancelRequested: boolean } | null;
  startExportProgress: (total: number) => void;
  updateExportProgress: (current: number, currentName: string) => void;
  requestExportCancel: () => void;
  endExportProgress: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  currentImage: null,
  selectedTool: null,
  layers: [],
  processedImageData: null,
  viewport: {
    zoom: 1,
    panX: 0,
    panY: 0,
    rotation: 0,
  },
  sidebarCollapsed: false,
  isAdjustingRotation: false,
  processingVersion: 0,
  externalParamsVersion: 0,
  isProcessing: false,
  lastProcessingTimeMs: 0,
  modulesActive: 0,
  modulesTotal: 0,
  showGrid: false,
  showRulers: false,
  showOriginal: false,
  referenceMode: false,
  referenceImageUrl: null,
  referenceImageName: null,
  imageRatings: {},
  selectedImageIds: [],
  selectionAnchorId: null,
  exportProgress: null,

  triggerReprocessing: () => set((state) => ({
    processingVersion: state.processingVersion + 1
  })),

  notifyExternalParamsChange: () => set((state) => ({
    externalParamsVersion: state.externalParamsVersion + 1
  })),

  setIsProcessing: (v) => set({ isProcessing: v }),

  setCurrentImage: (image) => set({ currentImage: image }),

  setIsAdjustingRotation: (adjusting) => set({ isAdjustingRotation: adjusting }),

  // Clear the processing spinner whenever fresh processed data lands.
  setProcessedImageData: (data) => set({ processedImageData: data, isProcessing: false }),

  setProcessingStats: ({ timeMs, active, total }) => set({
    lastProcessingTimeMs: timeMs,
    modulesActive: active,
    modulesTotal: total,
  }),

  setSelectedTool: (toolId) => set({ selectedTool: toolId }),

  addLayer: (layer) => set((state) => ({
    layers: [...state.layers, layer]
  })),

  removeLayer: (layerId) => set((state) => ({
    layers: state.layers.filter(l => l.id !== layerId)
  })),

  updateLayer: (layerId, updates) => set((state) => ({
    layers: state.layers.map(layer =>
      layer.id === layerId ? { ...layer, ...updates } : layer
    )
  })),

  setViewport: (viewport) => set((state) => ({
    viewport: { ...state.viewport, ...viewport }
  })),

  toggleSidebar: () => set((state) => ({
    sidebarCollapsed: !state.sidebarCollapsed
  })),

  resetZoom: () => set((state) => ({
    viewport: { ...state.viewport, zoom: 1, panX: 0, panY: 0 }
  })),

  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  toggleRulers: () => set((state) => ({ showRulers: !state.showRulers })),
  toggleOriginal: () => set((state) => ({ showOriginal: !state.showOriginal, referenceMode: false })),
  toggleReferenceMode: () => set((state) => ({ referenceMode: !state.referenceMode, showOriginal: false })),
  setReferenceImage: (url, name) => set({ referenceImageUrl: url, referenceImageName: name }),

  setImageRating: (imageId, rating) => set((state) => ({
    imageRatings: { ...state.imageRatings, [imageId]: rating }
  })),

  setSelection: (ids, anchorId) => set(() => ({
    selectedImageIds: ids,
    selectionAnchorId: anchorId !== undefined ? anchorId : (ids.length > 0 ? ids[ids.length - 1] : null),
  })),

  toggleImageSelection: (id) => set((state) => {
    const exists = state.selectedImageIds.includes(id);
    return {
      selectedImageIds: exists
        ? state.selectedImageIds.filter((x) => x !== id)
        : [...state.selectedImageIds, id],
      selectionAnchorId: id,
    };
  }),

  clearSelection: () => set(() => ({
    selectedImageIds: [],
    selectionAnchorId: null,
  })),

  startExportProgress: (total) => set(() => ({
    exportProgress: { current: 0, total, currentName: '', cancelRequested: false },
  })),

  updateExportProgress: (current, currentName) => set((state) => {
    if (state.exportProgress === null) return {};
    return { exportProgress: { ...state.exportProgress, current, currentName } };
  }),

  requestExportCancel: () => set((state) => {
    if (state.exportProgress === null) return {};
    return { exportProgress: { ...state.exportProgress, cancelRequested: true } };
  }),

  endExportProgress: () => set(() => ({ exportProgress: null })),

  getCurrentPipelineSettings: () => {
    // This would need to be implemented to collect current settings from all modules
    // For now, return a placeholder structure
    return {
      lensCorrections: {},
      basicAdjustments: {},
      shadowsHighlights: {},
      localAdjustments: {},
      noiseReduction: {},
      sharpening: {},
      colorGrading: {},
      export: {}
    };
  },
}));