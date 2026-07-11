import { useAppStore } from './appStore';
import type { Layer } from '../types';

describe('appStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAppStore.setState({
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
    });
  });

  describe('selectedTool', () => {
    it('should set selected tool', () => {
      useAppStore.getState().setSelectedTool('crop');

      expect(useAppStore.getState().selectedTool).toBe('crop');
    });

    it('should clear selected tool', () => {
      useAppStore.getState().setSelectedTool('crop');
      useAppStore.getState().setSelectedTool(null);

      expect(useAppStore.getState().selectedTool).toBeNull();
    });
  });

  describe('layers', () => {
    const createMockLayer = (id: string): Layer => ({
      id,
      name: `Layer ${id}`,
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      adjustments: [],
    });

    it('should add a layer', () => {
      const layer = createMockLayer('layer-1');

      useAppStore.getState().addLayer(layer);

      expect(useAppStore.getState().layers).toHaveLength(1);
      expect(useAppStore.getState().layers[0]).toEqual(layer);
    });

    it('should add multiple layers', () => {
      const layer1 = createMockLayer('layer-1');
      const layer2 = createMockLayer('layer-2');

      useAppStore.getState().addLayer(layer1);
      useAppStore.getState().addLayer(layer2);

      expect(useAppStore.getState().layers).toHaveLength(2);
    });

    it('should remove a layer', () => {
      const layer1 = createMockLayer('layer-1');
      const layer2 = createMockLayer('layer-2');

      useAppStore.getState().addLayer(layer1);
      useAppStore.getState().addLayer(layer2);
      useAppStore.getState().removeLayer('layer-1');

      expect(useAppStore.getState().layers).toHaveLength(1);
      expect(useAppStore.getState().layers[0].id).toBe('layer-2');
    });

    it('should update a layer', () => {
      const layer = createMockLayer('layer-1');

      useAppStore.getState().addLayer(layer);
      useAppStore.getState().updateLayer('layer-1', {
        visible: false,
        opacity: 0.5,
      });

      const updatedLayer = useAppStore.getState().layers[0];
      expect(updatedLayer.visible).toBe(false);
      expect(updatedLayer.opacity).toBe(0.5);
      expect(updatedLayer.name).toBe('Layer layer-1'); // Unchanged
    });

    it('should not update non-existent layer', () => {
      const layer = createMockLayer('layer-1');

      useAppStore.getState().addLayer(layer);
      useAppStore.getState().updateLayer('non-existent', { visible: false });

      expect(useAppStore.getState().layers[0].visible).toBe(true);
    });
  });

  describe('viewport', () => {
    it('should set viewport properties', () => {
      useAppStore.getState().setViewport({ zoom: 2, panX: 100 });

      const viewport = useAppStore.getState().viewport;
      expect(viewport.zoom).toBe(2);
      expect(viewport.panX).toBe(100);
      expect(viewport.panY).toBe(0); // Unchanged
    });

    it('should reset zoom', () => {
      useAppStore.getState().setViewport({ zoom: 3, panX: 200, panY: 150 });
      useAppStore.getState().resetZoom();

      const viewport = useAppStore.getState().viewport;
      expect(viewport.zoom).toBe(1);
      expect(viewport.panX).toBe(0);
      expect(viewport.panY).toBe(0);
    });
  });

  describe('sidebar', () => {
    it('should toggle sidebar', () => {
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);

      useAppStore.getState().toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);

      useAppStore.getState().toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });
  });

  describe('processedImageData', () => {
    it('should set processed image data', () => {
      const data = new Float32Array([1, 2, 3, 4]);

      useAppStore.getState().setProcessedImageData(data);

      expect(useAppStore.getState().processedImageData).toBe(data);
    });

    it('should clear processed image data', () => {
      const data = new Float32Array([1, 2, 3, 4]);

      useAppStore.getState().setProcessedImageData(data);
      useAppStore.getState().setProcessedImageData(null);

      expect(useAppStore.getState().processedImageData).toBeNull();
    });
  });

  describe('processingStats', () => {
    it('should update processing stats fields', () => {
      useAppStore.getState().setProcessingStats({ timeMs: 42, active: 7, total: 10 });

      expect(useAppStore.getState().lastProcessingTimeMs).toBe(42);
      expect(useAppStore.getState().modulesActive).toBe(7);
      expect(useAppStore.getState().modulesTotal).toBe(10);
    });

    it('should initialize processing stats to zero', () => {
      useAppStore.setState({ lastProcessingTimeMs: 0, modulesActive: 0, modulesTotal: 0 });

      expect(useAppStore.getState().lastProcessingTimeMs).toBe(0);
      expect(useAppStore.getState().modulesActive).toBe(0);
      expect(useAppStore.getState().modulesTotal).toBe(0);
    });
  });

});
