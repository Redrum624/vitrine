import { create } from 'zustand';
import type { AppState, Layer, ViewportState, ProcessedImageData, RenderMode } from '../types';
import { DEFAULT_RAW_DECODE_OPTIONS, type RawDecodeOptions, type BakedUpscaleIntent } from '../types/electron';

interface AppStore extends AppState {
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
  // Rotation grid overlay state
  isAdjustingRotation: boolean;
  setIsAdjustingRotation: (adjusting: boolean) => void;
  // Processing trigger - increments to signal that reprocessing is needed
  processingVersion: number;
  triggerReprocessing: () => void;
  // Preview quality cap (long-edge px) the AdjustmentPanel downsamples the
  // source to. Base 1024; Canvas RATCHETS it up when zoom exceeds the image's
  // previous farthest zoom or a crop apply raises effective magnification
  // (utils/previewQuality.ts), and resets it per image open. Consumed
  // imperatively (getState) by the processing callback — cap changes take
  // effect through triggerReprocessing, never through render-identity churn.
  previewQualityCap: number;
  setPreviewQualityCap: (cap: number) => void;
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
  // Durable upscale INTENT for the current image (Q7): {scale, mode} when an upscale bake is
  // active OR when a reopened image carries a persisted-but-not-yet-reapplied upscale, else null.
  // Distinct from upscaleMode (the in-session AI/Standard badge): this survives the reopen window
  // so the Enhance panel can offer a one-click re-apply and the Export dialog can warn instead of
  // silently exporting at native res. serialize() reads it so the marker round-trips through flush.
  upscaleIntent: BakedUpscaleIntent | null;
  setUpscaleIntent: (v: BakedUpscaleIntent | null) => void;
  // Durable DEBLUR intent for the current image (Z1, mirror of upscaleIntent): true when a motion-
  // deblur bake is active OR when a reopened image carries a persisted-but-not-yet-reapplied deblur.
  // Deblur has no scale/mode payload (dimension-preserving, AI-only), so a boolean presence marker
  // suffices. Drives the Enhance panel's re-apply notice and the Export unapplied-bake warning.
  deblurIntent: boolean;
  setDeblurIntent: (v: boolean) => void;
  // Ordered list of the bakes in the current image's durable intent (Z1). Empty = none; ['upscale']
  // or ['deblur'] for a single bake; ['upscale','deblur'] (etc.) when stacked. Kept in sync with
  // EnhanceService's restore stack so a reopen's one-click re-apply replays the bakes in order.
  bakeOrder: ('upscale' | 'deblur')[];
  setBakeOrder: (v: ('upscale' | 'deblur')[]) => void;
  // AI motion deblur: determinate progress 0..1 while tiles run (null when idle). Deblur is
  // DirectML-only and AI-only (no Standard fallback), so there is no mode badge — just progress.
  deblurProgress: number | null;
  setDeblurProgress: (v: number | null) => void;
  // RAW decode options applied to the CURRENT image's base pixels. Changed only via a
  // re-decode (RawImageService.reDecode) or restored from per-image persistence on open —
  // never a live edit, so it stays in lock-step with the actually-decoded base.
  rawDecodeOptions: RawDecodeOptions;
  setRawDecodeOptions: (opts: RawDecodeOptions) => void;
  // True while a re-decode IPC round-trip + reprocess is in flight (drives the panel's
  // progress affordance and disables the decode controls).
  reDecoding: boolean;
  setReDecoding: (v: boolean) => void;
  // True while a progressive open is showing the fast embedded-JPEG preview and the full
  // 16-bit LibRaw decode is still running in the background (drives the footer "Developing
  // full quality…" affordance). Cleared when the full decode swaps in, or the open is superseded.
  developing: boolean;
  setDeveloping: (v: boolean) => void;
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
  // Bumped whenever ImageService records a NEW before/after "original" snapshot —
  // deferOriginalSnapshot() on every fresh open (plain/JPEG/cache/RAW) and
  // setOriginalImage() on a base-mutating bake. Unlike baseImageVersion (only the
  // in-place swap path bumps it), this fires on ordinary image switches, so the
  // Before pane re-reads getOriginalImage() for the NEW photo instead of showing
  // the previous image's original.
  originalSnapshotVersion: number;
  bumpOriginalSnapshotVersion: () => void;
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
  previewQualityCap: 1024,
  externalParamsVersion: 0,
  isProcessing: false,
  upscaleProgress: null,
  upscaleMode: null,
  upscaleIntent: null,
  deblurIntent: false,
  bakeOrder: [],
  deblurProgress: null,
  rawDecodeOptions: DEFAULT_RAW_DECODE_OPTIONS,
  reDecoding: false,
  developing: false,
  renderMode: 'cpu',
  gpuResultVersion: 0,
  baseImageVersion: 0,
  originalSnapshotVersion: 0,
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

  setPreviewQualityCap: (cap) => set({ previewQualityCap: cap }),

  notifyExternalParamsChange: () => set((state) => ({
    externalParamsVersion: state.externalParamsVersion + 1
  })),

  setIsProcessing: (v) => set({ isProcessing: v }),
  setUpscaleProgress: (v) => set({ upscaleProgress: v }),
  setUpscaleMode: (v) => set({ upscaleMode: v }),
  setUpscaleIntent: (v) => set({ upscaleIntent: v }),
  setDeblurIntent: (v) => set({ deblurIntent: v }),
  setBakeOrder: (v) => set({ bakeOrder: v }),
  setDeblurProgress: (v) => set({ deblurProgress: v }),
  setRawDecodeOptions: (opts) => set({ rawDecodeOptions: opts }),
  setReDecoding: (v) => set({ reDecoding: v }),
  setDeveloping: (v) => set({ developing: v }),

  setAlignmentAxisX: (x) => set({ alignmentAxisX: x }),

  setRenderMode: (mode) => set({ renderMode: mode }),

  bumpGpuResult: () => set((state) => ({ gpuResultVersion: state.gpuResultVersion + 1 })),

  bumpBaseImageVersion: () => set((state) => ({ baseImageVersion: state.baseImageVersion + 1 })),

  bumpOriginalSnapshotVersion: () => set((state) => ({ originalSnapshotVersion: state.originalSnapshotVersion + 1 })),

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

  // LOAD-BEARING: always publish the fresh object reference, even when the values
  // are unchanged. OriginalPane (before/after split) has no ResizeObserver of its
  // own — it re-fits on region resizes ONLY because redrawCanvas republishes a new
  // mainCanvasFit reference every run. Adding a value-equality dedupe here would
  // silently break Before-pane resize tracking.
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
}));