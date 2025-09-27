export interface SpotRemovalSettings {
  brushSize: number; // 1-500 pixels
  hardness: number; // 0-1 (0 = soft, 1 = hard)
  opacity: number; // 0-1
  flow: number; // 0-1
  spacing: number; // 0-100% of brush size
  pressure: boolean; // pressure sensitivity
  feather: number; // edge feathering 0-100
}

export interface HealingSettings extends SpotRemovalSettings {
  sampleRadius: number; // radius for texture sampling
  blendMode: 'normal' | 'luminosity' | 'color' | 'texture';
  preserveTexture: boolean;
  adaptiveSize: boolean; // adapt sample size to defect size
  multiSample: boolean; // use multiple sample points
}

export interface CloningSettings extends SpotRemovalSettings {
  alignSource: boolean; // maintain source alignment
  sourcePoint: { x: number; y: number };
  rotation: number; // rotate source texture
  scale: number; // scale source texture
  perspective: boolean; // maintain perspective
}

export interface SpotRemovalStroke {
  id: string;
  type: 'healing' | 'cloning' | 'patch';
  points: Array<{ x: number; y: number; pressure?: number; timestamp?: number }>;
  settings: HealingSettings | CloningSettings;
  sourceArea?: { x: number; y: number; width: number; height: number };
  completed: boolean;
}

export interface PatchSettings {
  sourceArea: { x: number; y: number; width: number; height: number };
  targetArea: { x: number; y: number; width: number; height: number };
  blendMode: 'content-aware' | 'texture' | 'luminosity';
  preserveStructure: boolean;
  featherEdges: boolean;
  adaptToLighting: boolean;
}

export interface ContentAwareResult {
  success: boolean;
  patchedData: Float32Array;
  confidence: number; // 0-1 how confident the algorithm is
  iterations: number;
  processingTime: number;
}

class SpotRemovalService {
  private static instance: SpotRemovalService;
  private activeStrokes: Map<string, SpotRemovalStroke> = new Map();
  // @ts-ignore - Reserved for future implementation
  private _previewCanvas: OffscreenCanvas | null = null;

  private constructor() {}

  static getInstance(): SpotRemovalService {
    if (!SpotRemovalService.instance) {
      SpotRemovalService.instance = new SpotRemovalService();
    }
    return SpotRemovalService.instance;
  }

  createDefaultHealingSettings(): HealingSettings {
    return {
      brushSize: 20,
      hardness: 0.8,
      opacity: 1.0,
      flow: 1.0,
      spacing: 25,
      pressure: true,
      feather: 10,
      sampleRadius: 30,
      blendMode: 'normal',
      preserveTexture: true,
      adaptiveSize: true,
      multiSample: true
    };
  }

  createDefaultCloningSettings(): CloningSettings {
    return {
      brushSize: 20,
      hardness: 0.8,
      opacity: 1.0,
      flow: 1.0,
      spacing: 25,
      pressure: true,
      feather: 10,
      alignSource: true,
      sourcePoint: { x: 0, y: 0 },
      rotation: 0,
      scale: 1.0,
      perspective: false
    };
  }

  startStroke(
    type: 'healing' | 'cloning' | 'patch',
    startPoint: { x: number; y: number },
    settings: HealingSettings | CloningSettings
  ): string {
    const strokeId = `stroke_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const stroke: SpotRemovalStroke = {
      id: strokeId,
      type,
      points: [{ x: startPoint.x, y: startPoint.y, pressure: 1.0, timestamp: Date.now() }],
      settings,
      completed: false
    };

    this.activeStrokes.set(strokeId, stroke);
    return strokeId;
  }

  addStrokePoint(
    strokeId: string,
    point: { x: number; y: number; pressure?: number }
  ): boolean {
    const stroke = this.activeStrokes.get(strokeId);
    if (!stroke || stroke.completed) {
      return false;
    }

    stroke.points.push({
      ...point,
      pressure: point.pressure ?? 1.0,
      timestamp: Date.now()
    });

    return true;
  }

  completeStroke(strokeId: string): boolean {
    const stroke = this.activeStrokes.get(strokeId);
    if (!stroke) {
      return false;
    }

    stroke.completed = true;
    return true;
  }

  applyHealing(
    imageData: Float32Array,
    width: number,
    height: number,
    targetArea: { x: number; y: number; width: number; height: number },
    settings: HealingSettings
  ): Float32Array {
    const result = imageData.slice();
    const { x: tx, y: ty, width: tw, height: th } = targetArea;

    // Create a mask for the target area
    const mask = this.createBrushMask(tw, th, settings);

    // Find optimal source samples around the target area
    const sampleAreas = this.findHealingSamples(
      imageData, width, height, targetArea, settings
    );

    if (sampleAreas.length === 0) {
      console.warn('No suitable healing samples found');
      return result;
    }

    // Extract target area texture characteristics
    const _targetTexture = this.analyzeTexture(imageData, width, height, targetArea);

    // Blend samples based on texture matching
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const maskValue = mask[y * tw + x];
        if (maskValue <= 0) continue;

        const globalX = tx + x;
        const globalY = ty + y;

        if (globalX < 0 || globalX >= width || globalY < 0 || globalY >= height) continue;

        const targetIdx = (globalY * width + globalX) * 4;

        // Blend samples
        let blendedR = 0, blendedG = 0, blendedB = 0;
        let totalWeight = 0;

        for (const sample of sampleAreas) {
          const sampleX = sample.x + x;
          const sampleY = sample.y + y;

          if (sampleX >= 0 && sampleX < width && sampleY >= 0 && sampleY < height) {
            const sampleIdx = (sampleY * width + sampleX) * 4;
            const weight = sample.weight * this.calculateTextureWeight(
              imageData, width, sampleX, sampleY, _targetTexture
            );

            blendedR += imageData[sampleIdx] * weight;
            blendedG += imageData[sampleIdx + 1] * weight;
            blendedB += imageData[sampleIdx + 2] * weight;
            totalWeight += weight;
          }
        }

        if (totalWeight > 0) {
          blendedR /= totalWeight;
          blendedG /= totalWeight;
          blendedB /= totalWeight;

          // Apply luminosity preservation if enabled
          if (settings.blendMode === 'luminosity') {
            const originalLum = this.getLuminance(
              result[targetIdx], result[targetIdx + 1], result[targetIdx + 2]
            );
            const newLum = this.getLuminance(blendedR, blendedG, blendedB);

            if (newLum > 0) {
              const lumRatio = originalLum / newLum;
              blendedR *= lumRatio;
              blendedG *= lumRatio;
              blendedB *= lumRatio;
            }
          }

          // Blend with original based on mask and opacity
          const blendStrength = maskValue * settings.opacity;
          result[targetIdx] = result[targetIdx] * (1 - blendStrength) + blendedR * blendStrength;
          result[targetIdx + 1] = result[targetIdx + 1] * (1 - blendStrength) + blendedG * blendStrength;
          result[targetIdx + 2] = result[targetIdx + 2] * (1 - blendStrength) + blendedB * blendStrength;

          // Clamp values
          result[targetIdx] = Math.max(0, Math.min(255, result[targetIdx]));
          result[targetIdx + 1] = Math.max(0, Math.min(255, result[targetIdx + 1]));
          result[targetIdx + 2] = Math.max(0, Math.min(255, result[targetIdx + 2]));
        }
      }
    }

    return result;
  }

  applyCloning(
    imageData: Float32Array,
    width: number,
    height: number,
    sourceArea: { x: number; y: number; width: number; height: number },
    targetArea: { x: number; y: number; width: number; height: number },
    settings: CloningSettings
  ): Float32Array {
    const result = imageData.slice();
    const { x: sx, y: sy, width: _sw, height: _sh } = sourceArea;
    const { x: tx, y: ty, width: tw, height: th } = targetArea;

    // Create brush mask
    const mask = this.createBrushMask(tw, th, settings);

    // Apply transformation to source if needed
    // @ts-ignore - Reserved for future implementation
    const _transformedSource = this.transformSourceArea(
      imageData, width, height, sourceArea, settings
    );

    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const maskValue = mask[y * tw + x];
        if (maskValue <= 0) continue;

        const targetX = tx + x;
        const targetY = ty + y;

        if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) continue;

        let sourceX = sx + x;
        let sourceY = sy + y;

        // Handle aligned cloning
        if (settings.alignSource) {
          sourceX = sx + x;
          sourceY = sy + y;
        } else {
          // Use relative offset from source point
          sourceX = settings.sourcePoint.x + x;
          sourceY = settings.sourcePoint.y + y;
        }

        if (sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height) {
          const sourceIdx = (sourceY * width + sourceX) * 4;
          const targetIdx = (targetY * width + targetX) * 4;

          // Apply cloning with opacity and flow
          const blendStrength = maskValue * settings.opacity * settings.flow;

          result[targetIdx] = result[targetIdx] * (1 - blendStrength) +
                             imageData[sourceIdx] * blendStrength;
          result[targetIdx + 1] = result[targetIdx + 1] * (1 - blendStrength) +
                                 imageData[sourceIdx + 1] * blendStrength;
          result[targetIdx + 2] = result[targetIdx + 2] * (1 - blendStrength) +
                                 imageData[sourceIdx + 2] * blendStrength;

          // Clamp values
          result[targetIdx] = Math.max(0, Math.min(255, result[targetIdx]));
          result[targetIdx + 1] = Math.max(0, Math.min(255, result[targetIdx + 1]));
          result[targetIdx + 2] = Math.max(0, Math.min(255, result[targetIdx + 2]));
        }
      }
    }

    return result;
  }

  applyContentAwarePatch(
    imageData: Float32Array,
    width: number,
    height: number,
    targetArea: { x: number; y: number; width: number; height: number },
    settings: PatchSettings
  ): ContentAwareResult {
    const startTime = performance.now();
    const result = imageData.slice();
    const { x: tx, y: ty, width: tw, height: th } = targetArea;

    try {
      // Create search space around target
      const searchRadius = Math.max(tw, th) * 2;
      const searchArea = {
        x: Math.max(0, tx - searchRadius),
        y: Math.max(0, ty - searchRadius),
        width: Math.min(width - Math.max(0, tx - searchRadius), tw + searchRadius * 2),
        height: Math.min(height - Math.max(0, ty - searchRadius), th + searchRadius * 2)
      };

      // Find the best matching patch
      const bestMatch = this.findBestMatchingPatch(
        imageData, width, height, targetArea, searchArea, settings
      );

      if (!bestMatch) {
        return {
          success: false,
          patchedData: result,
          confidence: 0,
          iterations: 0,
          processingTime: performance.now() - startTime
        };
      }

      // Apply seamless blending
      const blendedArea = this.seamlessBlend(
        imageData, width, height, bestMatch, targetArea, settings
      );

      // Copy blended area to result
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const sourceIdx = y * tw + x;
          const targetIdx = ((ty + y) * width + (tx + x)) * 4;

          if (targetIdx >= 0 && targetIdx < result.length - 3) {
            result[targetIdx] = blendedArea[sourceIdx * 4];
            result[targetIdx + 1] = blendedArea[sourceIdx * 4 + 1];
            result[targetIdx + 2] = blendedArea[sourceIdx * 4 + 2];
            result[targetIdx + 3] = blendedArea[sourceIdx * 4 + 3];
          }
        }
      }

      return {
        success: true,
        patchedData: result,
        confidence: bestMatch.confidence,
        iterations: 1,
        processingTime: performance.now() - startTime
      };

    } catch (error) {
      console.error('Content-aware patch failed:', error);
      return {
        success: false,
        patchedData: result,
        confidence: 0,
        iterations: 0,
        processingTime: performance.now() - startTime
      };
    }
  }

  private createBrushMask(width: number, height: number, settings: SpotRemovalSettings): Float32Array {
    const mask = new Float32Array(width * height);
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        let value = 0;
        if (distance <= radius) {
          if (settings.hardness >= 1) {
            value = 1;
          } else {
            const softRadius = radius * (1 - settings.hardness);
            if (distance <= radius - softRadius) {
              value = 1;
            } else {
              const falloff = (radius - distance) / softRadius;
              value = Math.max(0, Math.min(1, falloff));
            }
          }

          // Apply feathering
          if (settings.feather > 0) {
            const featherRadius = radius * (settings.feather / 100);
            if (distance > radius - featherRadius) {
              const featherFalloff = (radius - distance) / featherRadius;
              value *= Math.max(0, Math.min(1, featherFalloff));
            }
          }
        }

        mask[y * width + x] = value;
      }
    }

    return mask;
  }

  private findHealingSamples(
    imageData: Float32Array,
    width: number,
    height: number,
    targetArea: { x: number; y: number; width: number; height: number },
    settings: HealingSettings
  ): Array<{ x: number; y: number; weight: number }> {
    const samples: Array<{ x: number; y: number; weight: number }> = [];
    const { x: _tx, y: _ty, width: _tw, height: th } = targetArea;
    const sampleRadius = settings.sampleRadius;

    // Define search rings around the target area
    const rings = [
      { minRadius: th + 5, maxRadius: sampleRadius },
      { minRadius: sampleRadius, maxRadius: sampleRadius * 1.5 },
      { minRadius: sampleRadius * 1.5, maxRadius: sampleRadius * 2 }
    ];

    for (const ring of rings) {
      const candidates = this.sampleInRing(
        imageData, width, height, targetArea, ring.minRadius, ring.maxRadius
      );

      // Evaluate candidates
      for (const candidate of candidates) {
        const similarity = this.calculateSimilarity(
          imageData, width, height, targetArea, candidate
        );

        if (similarity > 0.3) { // threshold for acceptable similarity
          samples.push({
            x: candidate.x,
            y: candidate.y,
            weight: similarity
          });
        }
      }

      // If we have enough good samples, break
      if (samples.length >= 8) break;
    }

    // Normalize weights
    const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
    if (totalWeight > 0) {
      samples.forEach(sample => {
        sample.weight /= totalWeight;
      });
    }

    return samples.slice(0, settings.multiSample ? 8 : 1);
  }

  private sampleInRing(
    _imageData: Float32Array,
    width: number,
    height: number,
    targetArea: { x: number; y: number; width: number; height: number },
    minRadius: number,
    maxRadius: number
  ): Array<{ x: number; y: number }> {
    const samples: Array<{ x: number; y: number }> = [];
    const centerX = targetArea.x + targetArea.width / 2;
    const centerY = targetArea.y + targetArea.height / 2;
    const angleStep = (Math.PI * 2) / 16; // 16 directions

    for (let angle = 0; angle < Math.PI * 2; angle += angleStep) {
      for (let radius = minRadius; radius <= maxRadius; radius += 10) {
        const x = Math.round(centerX + Math.cos(angle) * radius);
        const y = Math.round(centerY + Math.sin(angle) * radius);

        if (x >= 0 && x < width - targetArea.width &&
            y >= 0 && y < height - targetArea.height) {
          samples.push({ x, y });
        }
      }
    }

    return samples;
  }

  private calculateSimilarity(
    imageData: Float32Array,
    width: number,
    _height: number,
    targetArea: { x: number; y: number; width: number; height: number },
    sampleArea: { x: number; y: number }
  ): number {
    const { width: tw, height: th } = targetArea;
    let similarity = 0;
    let pixels = 0;

    // Compare border pixels (since center might be corrupted)
    const borderWidth = Math.min(5, Math.floor(tw / 4));

    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        // Only compare border pixels
        if (x < borderWidth || x >= tw - borderWidth ||
            y < borderWidth || y >= th - borderWidth) {

          const targetIdx = ((targetArea.y + y) * width + (targetArea.x + x)) * 4;
          const sampleIdx = ((sampleArea.y + y) * width + (sampleArea.x + x)) * 4;

          if (targetIdx >= 0 && targetIdx < imageData.length - 3 &&
              sampleIdx >= 0 && sampleIdx < imageData.length - 3) {

            const dr = imageData[targetIdx] - imageData[sampleIdx];
            const dg = imageData[targetIdx + 1] - imageData[sampleIdx + 1];
            const db = imageData[targetIdx + 2] - imageData[sampleIdx + 2];

            const distance = Math.sqrt(dr * dr + dg * dg + db * db);
            similarity += Math.max(0, 1 - distance / (255 * Math.sqrt(3)));
            pixels++;
          }
        }
      }
    }

    return pixels > 0 ? similarity / pixels : 0;
  }

  private analyzeTexture(
    imageData: Float32Array,
    width: number,
    _height: number,
    area: { x: number; y: number; width: number; height: number }
  ): { averageGradient: number; dominantDirection: number; contrast: number } {
    let totalGradient = 0;
    let totalContrast = 0;
    let gradientX = 0;
    let gradientY = 0;
    let pixels = 0;

    for (let y = 1; y < area.height - 1; y++) {
      for (let x = 1; x < area.width - 1; x++) {
        const centerIdx = ((area.y + y) * width + (area.x + x)) * 4;
        const rightIdx = ((area.y + y) * width + (area.x + x + 1)) * 4;
        const bottomIdx = ((area.y + y + 1) * width + (area.x + x)) * 4;

        if (centerIdx >= 0 && rightIdx < imageData.length - 3 && bottomIdx < imageData.length - 3) {
          const centerLum = this.getLuminance(imageData[centerIdx], imageData[centerIdx + 1], imageData[centerIdx + 2]);
          const rightLum = this.getLuminance(imageData[rightIdx], imageData[rightIdx + 1], imageData[rightIdx + 2]);
          const bottomLum = this.getLuminance(imageData[bottomIdx], imageData[bottomIdx + 1], imageData[bottomIdx + 2]);

          const gx = rightLum - centerLum;
          const gy = bottomLum - centerLum;
          const gradient = Math.sqrt(gx * gx + gy * gy);

          totalGradient += gradient;
          gradientX += gx;
          gradientY += gy;
          totalContrast += Math.abs(gx) + Math.abs(gy);
          pixels++;
        }
      }
    }

    return {
      averageGradient: pixels > 0 ? totalGradient / pixels : 0,
      dominantDirection: pixels > 0 ? Math.atan2(gradientY, gradientX) : 0,
      contrast: pixels > 0 ? totalContrast / pixels : 0
    };
  }

  private calculateTextureWeight(
    _imageData: Float32Array,
    _width: number,
    _x: number,
    _y: number,
    _targetTexture: { averageGradient: number; dominantDirection: number; contrast: number }
  ): number {
    // Simple texture matching weight
    return 1.0; // Simplified for now
  }

  private getLuminance(r: number, g: number, b: number): number {
    return r * 0.299 + g * 0.587 + b * 0.114;
  }

  private transformSourceArea(
    imageData: Float32Array,
    _width: number,
    _height: number,
    _sourceArea: { x: number; y: number; width: number; height: number },
    _settings: CloningSettings
  ): Float32Array {
    // For now, return the source area as-is
    // Could implement rotation, scaling, perspective in the future
    return imageData;
  }

  private findBestMatchingPatch(
    imageData: Float32Array,
    width: number,
    height: number,
    targetArea: { x: number; y: number; width: number; height: number },
    searchArea: { x: number; y: number; width: number; height: number },
    _settings: PatchSettings
  ): { x: number; y: number; confidence: number } | null {
    let bestMatch: { x: number; y: number; confidence: number } | null = null;
    let bestSimilarity = -1;

    const stepSize = Math.max(1, Math.floor(targetArea.width / 8));

    for (let y = searchArea.y; y <= searchArea.y + searchArea.height - targetArea.height; y += stepSize) {
      for (let x = searchArea.x; x <= searchArea.x + searchArea.width - targetArea.width; x += stepSize) {
        // Skip if overlaps with target
        if (!(x + targetArea.width < targetArea.x || x > targetArea.x + targetArea.width ||
              y + targetArea.height < targetArea.y || y > targetArea.y + targetArea.height)) {
          continue;
        }

        const similarity = this.calculateSimilarity(
          imageData, width, height, targetArea, { x, y }
        );

        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatch = { x, y, confidence: similarity };
        }
      }
    }

    return bestMatch;
  }

  private seamlessBlend(
    imageData: Float32Array,
    width: number,
    _height: number,
    sourceArea: { x: number; y: number; confidence: number },
    targetArea: { x: number; y: number; width: number; height: number },
    _settings: PatchSettings
  ): Float32Array {
    const result = new Float32Array(targetArea.width * targetArea.height * 4);

    // Simple copy for now - could implement Poisson blending
    for (let y = 0; y < targetArea.height; y++) {
      for (let x = 0; x < targetArea.width; x++) {
        const sourceIdx = ((sourceArea.y + y) * width + (sourceArea.x + x)) * 4;
        const resultIdx = (y * targetArea.width + x) * 4;

        if (sourceIdx >= 0 && sourceIdx < imageData.length - 3) {
          result[resultIdx] = imageData[sourceIdx];
          result[resultIdx + 1] = imageData[sourceIdx + 1];
          result[resultIdx + 2] = imageData[sourceIdx + 2];
          result[resultIdx + 3] = imageData[sourceIdx + 3];
        }
      }
    }

    return result;
  }

  getActiveStrokes(): SpotRemovalStroke[] {
    return Array.from(this.activeStrokes.values());
  }

  clearStrokes(): void {
    this.activeStrokes.clear();
  }

  removeStroke(strokeId: string): boolean {
    return this.activeStrokes.delete(strokeId);
  }

  exportStrokes(): string {
    const strokes = Array.from(this.activeStrokes.values());
    return JSON.stringify(strokes, null, 2);
  }

  importStrokes(strokesJson: string): boolean {
    try {
      const strokes = JSON.parse(strokesJson) as SpotRemovalStroke[];
      this.activeStrokes.clear();

      strokes.forEach(stroke => {
        this.activeStrokes.set(stroke.id, stroke);
      });

      return true;
    } catch (error) {
      console.error('Failed to import strokes:', error);
      return false;
    }
  }
}

export default SpotRemovalService;