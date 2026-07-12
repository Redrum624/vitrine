import { PipelineModule, ProcessingContext } from '../services/ImageProcessingPipeline';
import {
  localAdjustmentsModule,
  LocalAdjustmentParams,
  BrushParameters,
  LocalAdjustmentLayer,
  MaskGeometry
} from './LocalAdjustmentsModule';
import { BasicAdjParams } from './BasicAdjustmentsModule';
import { logger } from '../utils/Logger';

export interface LocalAdjustmentsPipelineParams {
  enabled: boolean;
  layers: LocalAdjustmentLayer[];
  activeLayerId: string | null;
  defaultParams: LocalAdjustmentParams;
  brushParams: BrushParameters;
}

export class LocalAdjustmentsPipelineModule implements PipelineModule {
  id = 'localadjustments';
  name = 'Local Adjustments';

  getId(): string {
    return this.id;
  }

  getName(): string {
    return this.name;
  }

  private params: LocalAdjustmentsPipelineParams = {
    enabled: false,
    layers: [],
    activeLayerId: null,
    defaultParams: {
      exposure: 0.0,
      shadows: 0,
      highlights: 0,
      temperature: 0,
      tint: 0,
      saturation: 0,
      vibrance: 0,
      contrast: 0,
      brightness: 0,
      clarity: 0,
      hueShift: 0,
      colorBalance: [0, 0, 0]
    },
    brushParams: {
      size: 50,
      hardness: 0.5,
      opacity: 1.0,
      flow: 1.0,
      spacing: 1.0
    }
  };

  get isEnabled(): boolean {
    return this.params.enabled && this.params.layers.some(layer => layer.enabled);
  }

  enable(): void {
    this.params.enabled = true;
    logger.info('Local adjustments module enabled');
  }

  disable(): void {
    this.params.enabled = false;
    logger.info('Local adjustments module disabled');
  }

  getParameters(): LocalAdjustmentsPipelineParams {
    return { ...this.params };
  }

  setParameters(params: Partial<LocalAdjustmentsPipelineParams>): void {
    this.params = { ...this.params, ...params };

    // Sync layers with the local adjustments module
    if (params.layers) {
      localAdjustmentsModule.clearAllLayers();
      for (const _layer of params.layers) {
        // Note: In a full implementation, we'd need to recreate layers
        // For now, we'll update the module's internal state
      }
    }

    logger.debug('Local adjustments parameters updated');
  }

  process(imageData: Float32Array, context: ProcessingContext): Float32Array {
    if (!this.isEnabled) {
      return imageData;
    }

    const startTime = performance.now();

    try {
      // Sync current layers to the module
      this.syncLayersToModule();

      // Process image through local adjustments
      const result = localAdjustmentsModule.processImage(imageData, context.width, context.height);

      const processingTime = performance.now() - startTime;
      logger.debug(`Local adjustments processed in ${processingTime.toFixed(2)}ms`);

      return result;
    } catch (error) {
      const processingTime = performance.now() - startTime;
      logger.error(`Local adjustments processing failed after ${processingTime.toFixed(2)}ms:`, error);
      return imageData; // Return original on error
    }
  }

  reset(): void {
    this.params = {
      enabled: false,
      layers: [],
      activeLayerId: null,
      defaultParams: {
        exposure: 0.0,
        shadows: 0,
        highlights: 0,
        temperature: 0,
        tint: 0,
        saturation: 0,
        vibrance: 0,
        contrast: 0,
        brightness: 0,
        clarity: 0,
        hueShift: 0,
        colorBalance: [0, 0, 0]
      },
      brushParams: {
        size: 50,
        hardness: 0.5,
        opacity: 1.0,
        flow: 1.0,
        spacing: 1.0
      }
    };

    localAdjustmentsModule.clearAllLayers();
    logger.info('Local adjustments module reset');
  }

  // Local Adjustments specific methods
  createLayer(
    type: LocalAdjustmentLayer['type'],
    name: string,
    imageWidth: number,
    imageHeight: number
  ): string {
    const layerId = localAdjustmentsModule.createLayer(type, name, imageWidth, imageHeight);

    // Update pipeline params with new layers
    this.syncLayersFromModule();

    if (!this.params.enabled) {
      this.enable();
    }

    return layerId;
  }

  removeLayer(layerId: string): boolean {
    const success = localAdjustmentsModule.removeLayer(layerId);

    if (success) {
      this.syncLayersFromModule();

      // Disable module if no layers remain
      if (this.params.layers.length === 0) {
        this.disable();
      }
    }

    return success;
  }

  toggleLayer(layerId: string, enabled: boolean): boolean {
    const layer = localAdjustmentsModule.getLayer(layerId);
    if (!layer) return false;

    layer.enabled = enabled;
    this.syncLayersFromModule();

    return true;
  }

  setActiveLayer(layerId: string): boolean {
    const success = localAdjustmentsModule.setActiveLayer(layerId);

    if (success) {
      this.params.activeLayerId = layerId;
    }

    return success;
  }

  clearActiveLayer(): void {
    localAdjustmentsModule.clearActiveLayer();
    this.params.activeLayerId = null;
  }

  updateLayerOpacity(layerId: string, opacity: number): boolean {
    const layer = localAdjustmentsModule.getLayer(layerId);
    if (!layer) return false;

    layer.opacity = Math.max(0, Math.min(1, opacity));
    this.syncLayersFromModule();

    return true;
  }

  updateLayerParameters(layerId: string, params: Partial<LocalAdjustmentParams>): boolean {
    const success = localAdjustmentsModule.updateLayerParameters(layerId, params);

    if (success) {
      this.syncLayersFromModule();
    }

    return success;
  }

  setLayerGeometry(layerId: string, geom: MaskGeometry, width: number, height: number): boolean {
    const success = localAdjustmentsModule.setLayerGeometry(layerId, geom, width, height);
    if (success) {
      this.syncLayersFromModule();
    }
    return success;
  }

  updateLayerBasicAdj(layerId: string, params: Partial<BasicAdjParams>): boolean {
    const success = localAdjustmentsModule.updateLayerBasicAdj(layerId, params);
    if (success) {
      this.syncLayersFromModule();
    }
    return success;
  }

  /**
   * Rebuild the baked mask for a layer at the given (width, height) resolution.
   * Routes through the inner module's setLayerGeometry so geometry→mask logic
   * is never duplicated here. Returns the freshly-baked mask, or null when the
   * layer doesn't exist or has no geometry to rebuild from.
   */
  rebuildMask(layerId: string, width: number, height: number): Float32Array | null {
    const layer = localAdjustmentsModule.getLayer(layerId);
    if (!layer || !layer.geometry) return null;
    localAdjustmentsModule.setLayerGeometry(layerId, layer.geometry, width, height);
    return localAdjustmentsModule.getLayer(layerId)?.mask ?? null;
  }

  updateBrushParameters(params: Partial<BrushParameters>): void {
    this.params.brushParams = { ...this.params.brushParams, ...params };

    // Update module brush parameters
    if (params.size !== undefined) localAdjustmentsModule.setBrushSize(params.size);
    if (params.hardness !== undefined) localAdjustmentsModule.setBrushHardness(params.hardness);
    if (params.opacity !== undefined) localAdjustmentsModule.setBrushOpacity(params.opacity);
    if (params.flow !== undefined) localAdjustmentsModule.setBrushFlow(params.flow);
  }

  // Brush operations
  addBrushStroke(
    layerId: string,
    points: Array<{ x: number; y: number; pressure?: number }>,
    imageWidth: number,
    imageHeight: number,
    isErase: boolean = false
  ): boolean {
    const success = localAdjustmentsModule.addBrushStroke(
      layerId,
      points,
      imageWidth,
      imageHeight,
      isErase
    );

    if (success) {
      this.syncLayersFromModule();
    }

    return success;
  }

  // Gradient operations
  createLinearGradient(
    layerId: string,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    imageWidth: number,
    imageHeight: number
  ): boolean {
    const success = localAdjustmentsModule.createLinearGradientMask(
      layerId,
      {
        startX: startX / imageWidth,
        startY: startY / imageHeight,
        endX: endX / imageWidth,
        endY: endY / imageHeight,
        centerX: 0.5,
        centerY: 0.5,
        radiusX: 0.5,
        radiusY: 0.5,
        falloff: 1.0,
        symmetry: false
      },
      imageWidth,
      imageHeight
    );

    if (success) {
      this.syncLayersFromModule();
    }

    return success;
  }

  createRadialGradient(
    layerId: string,
    centerX: number,
    centerY: number,
    radiusX: number,
    radiusY: number,
    imageWidth: number,
    imageHeight: number
  ): boolean {
    const success = localAdjustmentsModule.createRadialGradientMask(
      layerId,
      {
        startX: 0,
        startY: 0,
        endX: 1,
        endY: 1,
        centerX: centerX / imageWidth,
        centerY: centerY / imageHeight,
        radiusX: radiusX / imageWidth,
        radiusY: radiusY / imageHeight,
        falloff: 1.0,
        symmetry: false
      },
      imageWidth,
      imageHeight
    );

    if (success) {
      this.syncLayersFromModule();
    }

    return success;
  }

  // Synchronization methods
  private syncLayersFromModule(): void {
    this.params.layers = localAdjustmentsModule.getLayers();

    // Update active layer ID
    const activeLayer = this.params.layers.find(layer =>
      layer.id === localAdjustmentsModule.getStats().activeLayerId
    );
    this.params.activeLayerId = activeLayer ? activeLayer.id : null;
  }

  private syncLayersToModule(): void {
    // Sync pipeline layer state to the module
    // Check if module layers match pipeline layers
    const moduleLayers = localAdjustmentsModule.getLayers();
    const pipelineLayers = this.params.layers;

    // If counts don't match, we need to sync
    if (moduleLayers.length !== pipelineLayers.length) {
      logger.debug(`Syncing layers: module has ${moduleLayers.length}, pipeline has ${pipelineLayers.length}`);

      // Check for layers in pipeline that don't exist in module
      for (const pipelineLayer of pipelineLayers) {
        const existsInModule = moduleLayers.some(ml => ml.id === pipelineLayer.id);
        if (!existsInModule) {
          logger.warn(`Layer ${pipelineLayer.id} exists in pipeline but not in module - skipping sync`);
        }
      }
    }

    // Sync active layer
    if (this.params.activeLayerId) {
      const moduleActiveId = localAdjustmentsModule.getStats().activeLayerId;
      if (moduleActiveId !== this.params.activeLayerId) {
        localAdjustmentsModule.setActiveLayer(this.params.activeLayerId);
      }
    }

    // Sync layer parameters for existing layers
    for (const pipelineLayer of pipelineLayers) {
      const moduleLayer = localAdjustmentsModule.getLayer(pipelineLayer.id);
      if (moduleLayer) {
        // Update parameters if they differ
        localAdjustmentsModule.updateLayerParameters(pipelineLayer.id, pipelineLayer.parameters);
      }
    }
  }

  // Get current parameters (required by pipeline)
  getParams(): Record<string, unknown> {
    return {
      ...this.params,
      moduleStats: localAdjustmentsModule.getStats()
    };
  }

  // Get module statistics
  getStats() {
    const moduleStats = localAdjustmentsModule.getStats();

    return {
      ...moduleStats,
      enabled: this.params.enabled,
      enabledLayers: this.params.layers.filter(layer => layer.enabled).length,
      totalLayers: this.params.layers.length
    };
  }
}

// Export singleton instance
export const localAdjustmentsPipelineModule = new LocalAdjustmentsPipelineModule();