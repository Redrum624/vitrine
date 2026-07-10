import { create } from 'zustand';
import type { AppState, ImageFile, Layer, ViewportState, ProcessedImageData, RenderMode } from '../types';
import { DEFAULT_RAW_DECODE_OPTIONS, type RawDecodeOptions } from '../types/electron';

interface AppStore extends AppState {
  setCurrentImage: (image: ImageFile | null) => void;
  setSelectedTool: (toolId: string | null) => void;
  addLayer: (layer: Layer) => void;
  removeLayer: (layerId: string) => void;
  updateLayer: (layerId: string, updates: Partial<Layer>) => void;
  setViewport: (viewport: Partial<ViewportState>) => void;
  // Main-canvas fit-rect (CSS px) published by Canvas.redrawCanvas so the before/after
  // OriginalPane can convert the shared (main-canvas-space) pan into its own pane's
  // pixels for the viewport-canvas model (Task R5).
  mainCanvasFit: { width: number; height: number };
  setMainCanvasFit: (fit: { width: number; height: number }) => void;
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
  // AI upscale: determinate progress 0..1 while tiles run (null when idle), and which
  // path the last/current Enhance upscale used so the panel can badge AI vs Standard.
  upscaleProgress: number | null;
  setUpscaleProgress: (v: number | null) => void;
  upscaleMode: 'ai' | 'standard' | null;
  setUpscaleMode: (v: 'ai' | 'standard' | null) => void;
  // RAW decode options applied to the CURRENT image's base pixels. Changed only via a
  // re-decode (RawImageService.reDecode) or restored from per-image persistence on open —
  // never a live edit, so it stays in lock-step with the actually-decoded base.
  rawDecodeOptions: RawDecodeOptions;
  setRawDecodeOptions: (opts: RawDecodeOptions) => void;
  // True while a re-decode IPC round-trip + reprocess is in flight (drives the panel's
  // progress affordance and disables the decode controls).
  reDecoding: boolean;
  setReDecoding: (v: boolean) => void;
  // Which display path the Canvas should use:
  //  'gpu' → present the resident-texture GPU result on the WebGL2 canvas (zero readback)
  //  'cpu' → blit `processedImageData` to the 2D canvas (the proven path)
  // Default 'cpu' (safe); AdjustmentPanel flips to 'gpu' only when it actually renders
  // a frame on the GPU pipeline (all enabled modules have a GPU path).
  renderMode: RenderMode;
  setRenderMode: (mode: RenderMode) => void;
  // Bumped every time a GPU render completes so the Canvas re-presents the new result.
  gpuResultVersion: number;
  bumpGpuResult: () => void;
  // Bumped when the working BASE image pixels are replaced in place (RAW re-decode,
  // upscale, rotate/flip). Path AND dimensions can stay the same across such a swap
  // (a re-decode changes neither), so consumers that key a cache off path+dims — e.g.
  // the GPU resident-source upload in AdjustmentPanel — must fold this in to know the
  // pixels changed and re-upload.
  baseImageVersion: number;
  bumpBaseImageVersion: () => void;
  // Alignment axis: horizontal center (workspace-relative px) of the LIVE photo
  // region. The floating toolbar pill centers on it now; the filmstrip dock and
  // footer rating cluster will consume it in Task 6. null until first measured.
  alignmentAxisX: number | null;
  setAlignmentAxisX: (x: number | null) => void;
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
  // Shared rating filter (0 = All, 1-5 = show only images rated >= N). Consumed by
  // the footer's segmented control, the filmstrip dock, and (Task 7) the gallery grid.
  ratingFilter: number;
  setRatingFilter: (n: number) => void;
  // View mode (Task 7, Glass · Sectioned 5a): 'develop' is the editing workspace
  // (default); 'gallery' is the library grid. Toggled by the filmstrip dock's
  // Gallery chip (Develop -> Gallery) and the toolbar's Develop|Gallery segmented,
  // which lives ONLY in the Gallery toolbar variant (its "Develop" tab covers
  // Gallery -> Develop). Selection/rating/filter state all live in this SAME
  // store regardless of viewMode, so round-tripping between the two views never
  // loses the current selection.
  viewMode: 'develop' | 'gallery';
  setViewMode: (mode: 'develop' | 'gallery') => void;
  // Gallery grid sort direction for the toolbar's "Sort: Capture time" chip.
  // false (default) = newest first. ImageFileInfo carries no EXIF capture-time
  // field, so `dateModified` (file mtime) is the actual sort key.
  gallerySortAscending: boolean;
  toggleGallerySortDirection: () => void;
  // Multi-image selection
  selectedImageIds: string[];
  selectionAnchorId: string | null;
  setSelection: (ids: string[], anchorId?: string | null) => void;
  toggleImageSelection: (id: string) => void;
  clearSelection: () => void;
  // Real pixel dimensions learned lazily from a thumbnail decode (Task B2):
  // folder-scanned ImageFileInfo carries no `dimensions` (no per-file decode at
  // scan time), so the dock/gallery thumbnail loaders capture the decoded
  // `<img>`'s naturalWidth/naturalHeight (a free byproduct of the browser
  // decode it already performs to paint the thumbnail) and record it here,
  // keyed by image id. Kept as a separate store map — not a mutation of the
  // `images` list App-local state owns — so GalleryView/StatusBar react to it
  // without either loader needing to touch that list.
  imageDimensions: Record<string, { width: number; height: number }>;
  setImageDimensions: (id: string, dims: { width: number; height: number }) => void;
  /** Drop every learned dimension — called when the folder-load path swaps in a
   * genuinely different image LIST (see App.tsx's handleFolderSelected), so a
   * new folder never shows a stale dimension carried over under a REUSED id. */
  clearImageDimensions: () => void;
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
  mainCanvasFit: { width: 0, height: 0 },
  sidebarCollapsed: false,
  isAdjustingRotation: false,
  processingVersion: 0,
  externalParamsVersion: 0,
  isProcessing: false,
  upscaleProgress: null,
  upscaleMode: null,
  rawDecodeOptions: DEFAULT_RAW_DECODE_OPTIONS,
  reDecoding: false,
  renderMode: 'cpu',
  gpuResultVersion: 0,
  baseImageVersion: 0,
  alignmentAxisX: null,
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
  ratingFilter: 0,
  viewMode: 'develop',
  gallerySortAscending: false,
  selectedImageIds: [],
  selectionAnchorId: null,
  exportProgress: null,
  imageDimensions: {},

  triggerReprocessing: () => set((state) => ({
    processingVersion: state.processingVersion + 1
  })),

  notifyExternalParamsChange: () => set((state) => ({
    externalParamsVersion: state.externalParamsVersion + 1
  })),

  setIsProcessing: (v) => set({ isProcessing: v }),
  setUpscaleProgress: (v) => set({ upscaleProgress: v }),
  setUpscaleMode: (v) => set({ upscaleMode: v }),
  setRawDecodeOptions: (opts) => set({ rawDecodeOptions: opts }),
  setReDecoding: (v) => set({ reDecoding: v }),

  setAlignmentAxisX: (x) => set({ alignmentAxisX: x }),

  setRenderMode: (mode) => set({ renderMode: mode }),

  bumpGpuResult: () => set((state) => ({ gpuResultVersion: state.gpuResultVersion + 1 })),

  bumpBaseImageVersion: () => set((state) => ({ baseImageVersion: state.baseImageVersion + 1 })),

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

  setMainCanvasFit: (fit) => set(() => ({ mainCanvasFit: fit })),
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

  setRatingFilter: (n) => set({ ratingFilter: n }),

  setViewMode: (mode) => set({ viewMode: mode }),

  toggleGallerySortDirection: () => set((state) => ({ gallerySortAscending: !state.gallerySortAscending })),

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

  setImageDimensions: (id, dims) => set((state) => {
    const existing = state.imageDimensions[id];
    if (existing && existing.width === dims.width && existing.height === dims.height) return state;
    return { imageDimensions: { ...state.imageDimensions, [id]: dims } };
  }),

  clearImageDimensions: () => set(() => ({ imageDimensions: {} })),

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
      enhance: {},
      colorGrading: {},
      export: {}
    };
  },
}));