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

  setCurrentImage: (image) => set({ currentImage: image }),

  setProcessedImageData: (data) => set({ processedImageData: data }),

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