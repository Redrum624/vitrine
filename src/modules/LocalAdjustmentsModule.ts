import { logger } from '../utils/Logger';
import { smoothStep, rgbToHS } from './utils/ColorUtils';
import { BasicAdjustmentsModule, BasicAdjParams } from './BasicAdjustmentsModule';

export interface LocalAdjustmentLayer {
  id: string;
  name: string;
  type: 'brush' | 'linear_gradient' | 'radial_gradient' | 'parametric';
  enabled: boolean;
  opacity: number; // 0.0 to 1.0
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft_light';
  mask: Float32Array; // Grayscale mask (0=no effect, 1=full effect)
  parameters: LocalAdjustmentParams;
  geometry?: MaskGeometry;   // for radial/linear gradient layers (drives the mask)
  basicAdj?: BasicAdjParams; // when set, the mask applies Basic Adjustments to the masked region
}

/** Normalised (0..1) geometry for a radial (circle/oval) or linear gradient mask. */
export interface MaskGeometry {
  type: 'radial' | 'linear';
  centerX: number; centerY: number; // radial centre
  radiusX: number; radiusY: number; // radial radii (oval when unequal)
  startX: number; startY: number;   // linear start
  endX: number; endY: number;       // linear end
  feather: number;                  // 0..1 edge softness
  invert: boolean;                  // swap inside/outside
  rotation?: number;                // radial ellipse rotation, radians (default 0)
}

export interface LocalAdjustmentParams {
  // Exposure adjustments
  exposure: number;        // -4.0 to 4.0, default: 0.0
  shadows: number;        // -100 to 100, default: 0
  highlights: number;     // -100 to 100, default: 0

  // Color adjustments
  temperature: number;    // -100 to 100, default: 0
  tint: number;          // -100 to 100, default: 0
  saturation: number;    // -100 to 100, default: 0
  vibrance: number;      // -100 to 100, default: 0

  // Tone adjustments
  contrast: number;      // -100 to 100, default: 0
  brightness: number;    // -100 to 100, default: 0
  clarity: number;       // -100 to 100, default: 0

  // Color grading
  hueShift: number;      // -180 to 180, default: 0
  colorBalance: [number, number, number]; // RGB color shift, -1 to 1

  // Index signature for Record compatibility
  [key: string]: unknown;
}

export interface BrushParameters {
  size: number;          // 1 to 500 pixels
  hardness: number;      // 0.0 to 1.0 (soft to hard edge)
  opacity: number;       // 0.0 to 1.0
  flow: number;         // 0.0 to 1.0
  spacing: number;      // 0.1 to 5.0 (brush spacing multiplier)
}

export interface GradientParameters {
  // Linear gradient
  startX: number;       // 0.0 to 1.0 (normalized coordinates)
  startY: number;       // 0.0 to 1.0
  endX: number;         // 0.0 to 1.0
  endY: number;         // 0.0 to 1.0

  // Radial gradient (for radial type)
  centerX: number;      // 0.0 to 1.0
  centerY: number;      // 0.0 to 1.0
  radiusX: number;      // 0.0 to 1.0
  radiusY: number;      // 0.0 to 1.0

  // Common gradient properties
  falloff: number;      // 0.0 to 5.0 (gradient transition steepness)
  symmetry: boolean;    // Whether gradient is symmetric
}

export interface ParametricMaskParameters {
  // Luminance masking
  luminanceMin: number;  // 0.0 to 1.0
  luminanceMax: number;  // 0.0 to 1.0
  luminanceFeather: number; // 0.0 to 0.2

  // Color masking
  hueCenter: number;     // 0 to 360 degrees
  hueRange: number;      // 0 to 180 degrees
  saturationMin: number; // 0.0 to 1.0
  saturationMax: number; // 0.0 to 1.0

  // Edge masking
  edgeThreshold: number; // 0.0 to 1.0
  edgeRadius: number;    // 0.0 to 10.0
}

export class LocalAdjustmentsModule {
  id = 'localadjustments';
  name = 'Local Adjustments';

  private layers: LocalAdjustmentLayer[] = [];
  private activeLayerId: string | null = null;
  private brushParams: BrushParameters = {
    size: 50,
    hardness: 0.5,
    opacity: 1.0,
    flow: 1.0,
    spacing: 1.0
  };

  // Create a new adjustment layer
  createLayer(
    type: LocalAdjustmentLayer['type'],
    name: string,
    imageWidth: number,
    imageHeight: number
  ): string {
    const layer: LocalAdjustmentLayer = {
      id: `layer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      type,
      enabled: true,
      opacity: 1.0,
      blendMode: 'normal',
      mask: new Float32Array(imageWidth * imageHeight), // Initialize empty mask
      parameters: this.getDefaultParameters()
    };

    this.layers.push(layer);
    this.activeLayerId = layer.id;

    // Give gradient layers a default centred mask so adjustments are visible
    // immediately (an all-zero mask would have no effect).
    if (type === 'radial_gradient') {
      this.setLayerGeometry(layer.id, {
        type: 'radial', centerX: 0.5, centerY: 0.5, radiusX: 0.3, radiusY: 0.3,
        startX: 0.5, startY: 0.15, endX: 0.5, endY: 0.85, feather: 0.5, invert: false,
      }, imageWidth, imageHeight);
    } else if (type === 'linear_gradient') {
      // Default: a horizontal line across the centre, effect on the bottom half,
      // feather 0.5 (rotation 0). 1.0 feather → a solid full-effect rectangle below.
      this.setLayerGeometry(layer.id, {
        type: 'linear', centerX: 0.5, centerY: 0.5, radiusX: 0.3, radiusY: 0.3,
        startX: 0.5, startY: 0.15, endX: 0.5, endY: 0.85, feather: 0.5, invert: false, rotation: 0,
      }, imageWidth, imageHeight);
    }

    logger.info(`Created local adjustment layer: ${name} (${type})`);
    return layer.id;
  }

  /** Update a mask's Basic Adjustments params (the per-mask "second Basic Adjustments"). */
  updateLayerBasicAdj(layerId: string, params: Partial<BasicAdjParams>): boolean {
    const layer = this.getLayer(layerId);
    if (!layer) return false;
    layer.basicAdj = { ...(layer.basicAdj ?? {
      black_point: 0, exposure: 0, contrast: 0, brightness: 0,
      saturation: 0, vibrance: 0, dehaze: 0, highlights: 0, shadows: 0,
    }), ...params };
    return true;
  }

  /**
   * Set a radial/linear gradient layer's geometry and (re)generate its mask.
   * All coordinates are normalised (0..1).
   */
  setLayerGeometry(layerId: string, geom: MaskGeometry, width: number, height: number): boolean {
    const layer = this.getLayer(layerId);
    if (!layer) return false;

    layer.geometry = { ...geom };
    // Resize the mask buffer if the target resolution changed (e.g. preview vs export).
    if (layer.mask.length !== width * height) {
      layer.mask = new Float32Array(width * height);
    }
    const mask = layer.mask;

    if (geom.type === 'radial') {
      const cx = geom.centerX * width;
      const cy = geom.centerY * height;
      const rx = Math.max(1e-3, geom.radiusX) * width;
      const ry = Math.max(1e-3, geom.radiusY) * height;
      const feather = Math.max(0.001, Math.min(0.999, geom.feather));
      const rot = geom.rotation || 0;
      const cosR = Math.cos(rot), sinR = Math.sin(rot);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          // Rotate the offset into the ellipse's local frame before normalising.
          const ox = x - cx, oy = y - cy;
          const dx = (ox * cosR + oy * sinR) / rx;
          const dy = (-ox * sinR + oy * cosR) / ry;
          const d = Math.sqrt(dx * dx + dy * dy);
          // 1 inside, smoothly fading to 0 across the feather band at the edge.
          let m = 1 - smoothStep(1 - feather, 1, d);
          if (geom.invert) m = 1 - m;
          mask[y * width + x] = m;
        }
      }
    } else {
      // Graduated filter: a line through (centerX, centerY) at angle `rotation`. The
      // effect is on ONE side — the line's perpendicular +direction, which is "down"
      // at rotation 0. `feather` is the spread: 1 = a solid full-effect rectangle
      // (hard edge at the line); lower = a softer ramp from the line outward.
      const cx = geom.centerX, cy = geom.centerY;
      const rot = geom.rotation || 0;
      const pxn = -Math.sin(rot), pyn = Math.cos(rot); // effect-side unit normal
      const D = Math.max(1e-3, 1 - Math.max(0.001, Math.min(1, geom.feather)));
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          // Signed perpendicular distance from the line (normalised image units).
          const s = (x / width - cx) * pxn + (y / height - cy) * pyn;
          let m = Math.max(0, Math.min(1, s / D));
          if (geom.invert) m = 1 - m;
          mask[y * width + x] = m;
        }
      }
    }
    return true;
  }

  // Remove a layer
  removeLayer(layerId: string): boolean {
    const index = this.layers.findIndex(layer => layer.id === layerId);
    if (index === -1) return false;

    this.layers.splice(index, 1);

    if (this.activeLayerId === layerId) {
      this.activeLayerId = this.layers.length > 0 ? this.layers[0].id : null;
    }

    logger.info(`Removed local adjustment layer: ${layerId}`);
    return true;
  }

  // Get layer by ID
  getLayer(layerId: string): LocalAdjustmentLayer | null {
    return this.layers.find(layer => layer.id === layerId) || null;
  }

  // Get all layers
  getLayers(): LocalAdjustmentLayer[] {
    return [...this.layers];
  }

  // Set active layer
  setActiveLayer(layerId: string): boolean {
    const layer = this.getLayer(layerId);
    if (!layer) return false;

    this.activeLayerId = layerId;
    return true;
  }

  clearActiveLayer(): void {
    this.activeLayerId = null;
  }

  // Update layer parameters
  updateLayerParameters(layerId: string, params: Partial<LocalAdjustmentParams>): boolean {
    const layer = this.getLayer(layerId);
    if (!layer) return false;

    layer.parameters = { ...layer.parameters, ...params };
    return true;
  }

  // Create brush mask stroke
  addBrushStroke(
    layerId: string,
    points: Array<{ x: number; y: number; pressure?: number }>,
    imageWidth: number,
    imageHeight: number,
    isErase: boolean = false
  ): boolean {
    const layer = this.getLayer(layerId);
    if (!layer || layer.type !== 'brush') return false;

    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i];
      const end = points[i + 1];

      this.drawBrushStroke(
        layer.mask,
        start,
        end,
        this.brushParams,
        imageWidth,
        imageHeight,
        isErase
      );
    }

    return true;
  }

  // Create linear gradient mask
  createLinearGradientMask(
    layerId: string,
    gradientParams: GradientParameters,
    imageWidth: number,
    imageHeight: number
  ): boolean {
    const layer = this.getLayer(layerId);
    if (!layer || layer.type !== 'linear_gradient') return false;

    // Create linear gradient mask
    const mask = layer.mask;
    const { startX, startY, endX, endY, falloff, symmetry } = gradientParams;

    // Convert normalized coordinates to pixel coordinates
    const x1 = startX * imageWidth;
    const y1 = startY * imageHeight;
    const x2 = endX * imageWidth;
    const y2 = endY * imageHeight;

    const gradientLength = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
    if (gradientLength === 0) return false;

    const gradientDx = (x2 - x1) / gradientLength;
    const gradientDy = (y2 - y1) / gradientLength;

    for (let y = 0; y < imageHeight; y++) {
      for (let x = 0; x < imageWidth; x++) {
        const pixelIndex = y * imageWidth + x;

        // Project pixel onto gradient line
        const dx = x - x1;
        const dy = y - y1;
        const projection = dx * gradientDx + dy * gradientDy;

        // Calculate gradient position (0 to 1)
        let gradientPos = projection / gradientLength;

        if (symmetry) {
          // Symmetric gradient (mirror around center)
          gradientPos = Math.abs(gradientPos - 0.5) * 2;
        }

        // Apply falloff curve
        let maskValue = this.applyGradientFalloff(gradientPos, falloff);
        maskValue = Math.max(0, Math.min(1, maskValue));

        mask[pixelIndex] = maskValue;
      }
    }

    logger.info(`Created linear gradient mask for layer: ${layerId}`);
    return true;
  }

  // Create radial gradient mask
  createRadialGradientMask(
    layerId: string,
    gradientParams: GradientParameters,
    imageWidth: number,
    imageHeight: number
  ): boolean {
    const layer = this.getLayer(layerId);
    if (!layer || layer.type !== 'radial_gradient') return false;

    const mask = layer.mask;
    const { centerX, centerY, radiusX, radiusY, falloff } = gradientParams;

    // Convert normalized coordinates to pixels
    const cx = centerX * imageWidth;
    const cy = centerY * imageHeight;
    const rx = radiusX * imageWidth;
    const ry = radiusY * imageHeight;

    for (let y = 0; y < imageHeight; y++) {
      for (let x = 0; x < imageWidth; x++) {
        const pixelIndex = y * imageWidth + x;

        // Calculate elliptical distance
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Apply falloff curve
        let maskValue = this.applyGradientFalloff(1.0 - distance, falloff);
        maskValue = Math.max(0, Math.min(1, maskValue));

        mask[pixelIndex] = maskValue;
      }
    }

    logger.info(`Created radial gradient mask for layer: ${layerId}`);
    return true;
  }

  // Create parametric mask based on image properties
  createParametricMask(
    layerId: string,
    maskParams: ParametricMaskParameters,
    sourceImageData: Float32Array,
    _imageWidth: number,
    _imageHeight: number
  ): boolean {
    const layer = this.getLayer(layerId);
    if (!layer || layer.type !== 'parametric') return false;

    const mask = layer.mask;
    const { luminanceMin, luminanceMax, luminanceFeather, hueCenter, hueRange } = maskParams;

    for (let i = 0; i < sourceImageData.length; i += 4) {
      const pixelIndex = Math.floor(i / 4);

      const r = sourceImageData[i];
      const g = sourceImageData[i + 1];
      const b = sourceImageData[i + 2];

      // Calculate luminance
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

      // Calculate HSV for color-based masking
      const [h] = rgbToHS(r, g, b);

      // Luminance mask
      const lumMask = smoothStep(
        luminanceMin - luminanceFeather,
        luminanceMin + luminanceFeather,
        luminance
      ) * (1.0 - smoothStep(
        luminanceMax - luminanceFeather,
        luminanceMax + luminanceFeather,
        luminance
      ));

      // Hue mask (if hue range is specified)
      let hueMask = 1.0;
      if (hueRange > 0) {
        const hueDistance = Math.min(
          Math.abs(h - hueCenter),
          360 - Math.abs(h - hueCenter)
        );
        hueMask = 1.0 - smoothStep(0, hueRange, hueDistance);
      }

      // Combine masks
      mask[pixelIndex] = lumMask * hueMask;
    }

    logger.info(`Created parametric mask for layer: ${layerId}`);
    return true;
  }

  // Apply all local adjustment layers to image
  processImage(imageData: Float32Array, width: number, height: number): Float32Array {
    if (this.layers.length === 0) return imageData;

    const result = new Float32Array(imageData);

    logger.info(`Applying ${this.layers.filter(l => l.enabled).length} local adjustment layers`);

    for (const layer of this.layers) {
      if (!layer.enabled || layer.opacity === 0) continue;

      // The mask is baked at the resolution it was last built at, but the pipeline
      // processes at different sizes (e.g. the 1024px preview vs full-res export).
      // If they differ, mask[i] would index the wrong pixels and the masked edit
      // lands in the wrong place (or nowhere) — so rebuild the geometry mask at the
      // current resolution first.
      if (layer.geometry && layer.mask.length !== width * height) {
        this.setLayerGeometry(layer.id, layer.geometry, width, height);
      }

      if (layer.basicAdj) {
        this.applyBasicAdjLayer(result, layer, width, height);
      } else {
        this.applyLayerToImage(result, layer, width, height);
      }
    }

    return result;
  }

  // Apply a mask's Basic Adjustments to the masked region (per-mask "second Basic
  // Adjustments"): run BasicAdjustmentsModule on the full image, then blend the
  // result back in weighted by mask * opacity.
  private applyBasicAdjLayer(
    imageData: Float32Array,
    layer: LocalAdjustmentLayer,
    width: number,
    height: number
  ): void {
    if (!layer.basicAdj) return;
    const adj = layer.basicAdj;
    // A neutral mask (no sliders moved) is an identity transform — skip the expensive
    // full-image BasicAdjustments pass + blend, so merely HAVING a mask doesn't slow
    // every reprocess (which tripped the 800ms canvas spinner) or perturb the result.
    if (!Object.values(adj).some((v) => typeof v === 'number' && Math.abs(v) > 1e-6)) return;
    const ba = new BasicAdjustmentsModule();
    ba.setParams(adj);
    const processed = ba.process(imageData, { width, height, channels: 4 });
    const mask = layer.mask;
    const op = layer.opacity;
    for (let i = 0; i < imageData.length; i += 4) {
      const w = mask[i >> 2] * op;
      if (w === 0) continue;
      imageData[i] = imageData[i] + w * (processed[i] - imageData[i]);
      imageData[i + 1] = imageData[i + 1] + w * (processed[i + 1] - imageData[i + 1]);
      imageData[i + 2] = imageData[i + 2] + w * (processed[i + 2] - imageData[i + 2]);
    }
  }

  // Apply a single layer to the image
  private applyLayerToImage(
    imageData: Float32Array,
    layer: LocalAdjustmentLayer,
    _width: number,
    _height: number
  ): void {
    const { mask, parameters, opacity } = layer;

    for (let i = 0; i < imageData.length; i += 4) {
      const pixelIndex = Math.floor(i / 4);
      const maskValue = mask[pixelIndex] * opacity;

      if (maskValue === 0) continue;

      const r = imageData[i];
      const g = imageData[i + 1];
      const b = imageData[i + 2];

      // Apply adjustments
      const [adjustedR, adjustedG, adjustedB] = this.applyLocalAdjustments(r, g, b, parameters);

      // Blend with original based on mask
      imageData[i] = this.blendPixel(r, adjustedR, maskValue, layer.blendMode);
      imageData[i + 1] = this.blendPixel(g, adjustedG, maskValue, layer.blendMode);
      imageData[i + 2] = this.blendPixel(b, adjustedB, maskValue, layer.blendMode);
    }
  }

  // Apply local adjustments to a single pixel
  private applyLocalAdjustments(
    r: number,
    g: number,
    b: number,
    params: LocalAdjustmentParams
  ): [number, number, number] {
    let adjustedR = r;
    let adjustedG = g;
    let adjustedB = b;

    // Exposure adjustment
    if (params.exposure !== 0) {
      const exposureFactor = Math.pow(2, params.exposure);
      adjustedR *= exposureFactor;
      adjustedG *= exposureFactor;
      adjustedB *= exposureFactor;
    }

    // Temperature/Tint adjustment
    if (params.temperature !== 0 || params.tint !== 0) {
      [adjustedR, adjustedG, adjustedB] = this.applyTemperatureTint(
        adjustedR, adjustedG, adjustedB, params.temperature, params.tint
      );
    }

    // Saturation adjustment
    if (params.saturation !== 0) {
      [adjustedR, adjustedG, adjustedB] = this.applySaturation(
        adjustedR, adjustedG, adjustedB, params.saturation / 100.0
      );
    }

    // Contrast adjustment
    if (params.contrast !== 0) {
      [adjustedR, adjustedG, adjustedB] = this.applyContrast(
        adjustedR, adjustedG, adjustedB, params.contrast / 100.0
      );
    }

    // Brightness adjustment
    if (params.brightness !== 0) {
      const brightnessFactor = params.brightness / 100.0;
      adjustedR += brightnessFactor;
      adjustedG += brightnessFactor;
      adjustedB += brightnessFactor;
    }

    // Color balance
    if (params.colorBalance[0] !== 0 || params.colorBalance[1] !== 0 || params.colorBalance[2] !== 0) {
      adjustedR += params.colorBalance[0];
      adjustedG += params.colorBalance[1];
      adjustedB += params.colorBalance[2];
    }

    // Clamp values
    return [
      Math.max(0, Math.min(1, adjustedR)),
      Math.max(0, Math.min(1, adjustedG)),
      Math.max(0, Math.min(1, adjustedB))
    ];
  }

  // Helper methods
  private drawBrushStroke(
    mask: Float32Array,
    start: { x: number; y: number; pressure?: number },
    end: { x: number; y: number; pressure?: number },
    brushParams: BrushParameters,
    imageWidth: number,
    imageHeight: number,
    isErase: boolean
  ): void {
    const { size, hardness, opacity, flow } = brushParams;
    const pressure1 = start.pressure || 1.0;
    const pressure2 = end.pressure || 1.0;

    // Interpolate between start and end points
    const distance = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
    const steps = Math.max(1, Math.floor(distance));

    for (let step = 0; step <= steps; step++) {
      const t = steps === 0 ? 0 : step / steps;
      const x = start.x + (end.x - start.x) * t;
      const y = start.y + (end.y - start.y) * t;
      const pressure = pressure1 + (pressure2 - pressure1) * t;

      this.drawBrushDab(mask, x, y, size * pressure, hardness, opacity * flow, imageWidth, imageHeight, isErase);
    }
  }

  private drawBrushDab(
    mask: Float32Array,
    centerX: number,
    centerY: number,
    size: number,
    hardness: number,
    opacity: number,
    imageWidth: number,
    imageHeight: number,
    isErase: boolean
  ): void {
    const radius = size / 2;
    const hardRadius = radius * hardness;
    const softRadius = radius - hardRadius;

    const minX = Math.max(0, Math.floor(centerX - radius));
    const maxX = Math.min(imageWidth - 1, Math.ceil(centerX + radius));
    const minY = Math.max(0, Math.floor(centerY - radius));
    const maxY = Math.min(imageHeight - 1, Math.ceil(centerY + radius));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= radius) {
          let alpha = 1.0;

          if (distance > hardRadius && softRadius > 0) {
            // Soft edge falloff
            const softT = (distance - hardRadius) / softRadius;
            alpha = 1.0 - smoothStep(0, 1, softT);
          }

          alpha *= opacity;

          const pixelIndex = y * imageWidth + x;
          const currentValue = mask[pixelIndex];

          if (isErase) {
            mask[pixelIndex] = currentValue * (1.0 - alpha);
          } else {
            mask[pixelIndex] = Math.min(1.0, currentValue + alpha * (1.0 - currentValue));
          }
        }
      }
    }
  }

  private applyGradientFalloff(position: number, falloff: number): number {
    if (falloff === 1.0) {
      return Math.max(0, Math.min(1, position));
    }

    // Apply power curve for falloff
    if (position <= 0) return 0;
    if (position >= 1) return 1;

    return Math.pow(position, falloff);
  }

  private applyTemperatureTint(r: number, g: number, b: number, temperature: number, tint: number): [number, number, number] {
    // Simplified temperature/tint adjustment
    const tempFactor = temperature / 100.0;
    const tintFactor = tint / 100.0;

    const newR = r * (1.0 - tempFactor * 0.3) + tempFactor * 0.2;
    const newG = g * (1.0 + tintFactor * 0.2);
    const newB = b * (1.0 + tempFactor * 0.3) - tempFactor * 0.2;

    return [newR, newG, newB];
  }

  private applySaturation(r: number, g: number, b: number, saturation: number): [number, number, number] {
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const factor = 1.0 + saturation;

    return [
      gray + factor * (r - gray),
      gray + factor * (g - gray),
      gray + factor * (b - gray)
    ];
  }

  private applyContrast(r: number, g: number, b: number, contrast: number): [number, number, number] {
    const factor = 1.0 + contrast;
    const midpoint = 0.5;

    return [
      midpoint + factor * (r - midpoint),
      midpoint + factor * (g - midpoint),
      midpoint + factor * (b - midpoint)
    ];
  }

  private blendPixel(original: number, adjusted: number, opacity: number, blendMode: string): number {
    switch (blendMode) {
      case 'multiply':
        return original + opacity * (original * adjusted - original);
      case 'screen':
        return original + opacity * (1 - (1 - original) * (1 - adjusted) - original);
      case 'overlay': {
        const overlay = original < 0.5
          ? 2 * original * adjusted
          : 1 - 2 * (1 - original) * (1 - adjusted);
        return original + opacity * (overlay - original);
      }
      case 'soft_light': {
        const softLight = original < 0.5
          ? 2 * original * adjusted + original * original * (1 - 2 * adjusted)
          : 2 * original * (1 - adjusted) + Math.sqrt(original) * (2 * adjusted - 1);
        return original + opacity * (softLight - original);
      }
      default: // normal
        return original + opacity * (adjusted - original);
    }
  }

  private getDefaultParameters(): LocalAdjustmentParams {
    return {
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
    };
  }

  // Brush parameter methods
  setBrushSize(size: number): void {
    this.brushParams.size = Math.max(1, Math.min(500, size));
  }

  setBrushHardness(hardness: number): void {
    this.brushParams.hardness = Math.max(0, Math.min(1, hardness));
  }

  setBrushOpacity(opacity: number): void {
    this.brushParams.opacity = Math.max(0, Math.min(1, opacity));
  }

  setBrushFlow(flow: number): void {
    this.brushParams.flow = Math.max(0, Math.min(1, flow));
  }

  getBrushParameters(): BrushParameters {
    return { ...this.brushParams };
  }

  // Reset all layers
  clearAllLayers(): void {
    this.layers = [];
    this.activeLayerId = null;
    logger.info('Cleared all local adjustment layers');
  }

  // Get module stats
  getStats() {
    return {
      layerCount: this.layers.length,
      activeLayerId: this.activeLayerId,
      enabledLayers: this.layers.filter(l => l.enabled).length
    };
  }
}

export const localAdjustmentsModule = new LocalAdjustmentsModule();