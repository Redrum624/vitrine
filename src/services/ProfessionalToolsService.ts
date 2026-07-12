export interface MeasurementUnit {
  id: string;
  name: string;
  abbreviation: string;
  pixelsPerUnit: number;
  category: 'length' | 'area' | 'angle';
}

export interface RulerSettings {
  visible: boolean;
  units: string;
  subdivisions: number;
  opacity: number;
  color: string;
  thickness: number;
  position: 'inside' | 'outside';
}

export interface GridSettings {
  visible: boolean;
  type: 'square' | 'rule-of-thirds' | 'golden-ratio' | 'diagonal' | 'custom';
  size: number;
  subdivisions: number;
  opacity: number;
  color: string;
  snapToGrid: boolean;
  snapThreshold: number;
}

export interface GuideSettings {
  visible: boolean;
  magnetic: boolean;
  snapThreshold: number;
  color: string;
  opacity: number;
  thickness: number;
}

export interface Guide {
  id: string;
  type: 'horizontal' | 'vertical';
  position: number;
  color?: string;
  locked: boolean;
  name?: string;
}

export interface MeasurementTool {
  id: string;
  type: 'ruler' | 'protractor' | 'area' | 'pixel-inspector' | 'color-sampler';
  active: boolean;
  persistent: boolean;
  settings: unknown;
}

export interface Measurement {
  id: string;
  tool: string;
  type: 'distance' | 'angle' | 'area' | 'color' | 'coordinates';
  startPoint: { x: number; y: number };
  endPoint?: { x: number; y: number };
  value: number | string;
  unit: string;
  timestamp: number;
  notes?: string;
}

export interface CrosshairSettings {
  visible: boolean;
  style: 'simple' | 'crosshair' | 'target' | 'custom';
  size: number;
  color: string;
  opacity: number;
  followMouse: boolean;
}

export interface PixelInspector {
  visible: boolean;
  magnification: number;
  size: { width: number; height: number };
  position: { x: number; y: number };
  showCoordinates: boolean;
  showColorValues: boolean;
  showRGB: boolean;
  showHSV: boolean;
  showHex: boolean;
}

export interface ColorSampler {
  id: string;
  position: { x: number; y: number };
  color: { r: number; g: number; b: number; a: number };
  name?: string;
  timestamp: number;
}

class ProfessionalToolsService {
  private static instance: ProfessionalToolsService;
  private units: Map<string, MeasurementUnit> = new Map();
  private rulerSettings: RulerSettings;
  private gridSettings: GridSettings;
  private guideSettings: GuideSettings;
  private crosshairSettings: CrosshairSettings;
  private pixelInspector: PixelInspector;
  private guides: Map<string, Guide> = new Map();
  private measurements: Map<string, Measurement> = new Map();
  private tools: Map<string, MeasurementTool> = new Map();
  private colorSamplers: Map<string, ColorSampler> = new Map();
  private observers: Set<(event: string, data?: unknown) => void> = new Set();
  private canvasElement: HTMLCanvasElement | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayContext: CanvasRenderingContext2D | null = null;
  // @ts-ignore - Reserved for future implementation
  private _isActive = false;

  private constructor() {
    this.initializeUnits();
    this.rulerSettings = this.createDefaultRulerSettings();
    this.gridSettings = this.createDefaultGridSettings();
    this.guideSettings = this.createDefaultGuideSettings();
    this.crosshairSettings = this.createDefaultCrosshairSettings();
    this.pixelInspector = this.createDefaultPixelInspector();
    this.initializeTools();
    this.loadPersistedSettings();
  }

  static getInstance(): ProfessionalToolsService {
    if (!ProfessionalToolsService.instance) {
      ProfessionalToolsService.instance = new ProfessionalToolsService();
    }
    return ProfessionalToolsService.instance;
  }

  private initializeUnits(): void {
    const units: MeasurementUnit[] = [
      { id: 'px', name: 'Pixels', abbreviation: 'px', pixelsPerUnit: 1, category: 'length' },
      { id: 'in', name: 'Inches', abbreviation: 'in', pixelsPerUnit: 96, category: 'length' },
      { id: 'cm', name: 'Centimeters', abbreviation: 'cm', pixelsPerUnit: 37.8, category: 'length' },
      { id: 'mm', name: 'Millimeters', abbreviation: 'mm', pixelsPerUnit: 3.78, category: 'length' },
      { id: 'pt', name: 'Points', abbreviation: 'pt', pixelsPerUnit: 1.33, category: 'length' },
      { id: 'pc', name: 'Picas', abbreviation: 'pc', pixelsPerUnit: 16, category: 'length' },
      { id: 'deg', name: 'Degrees', abbreviation: '°', pixelsPerUnit: 1, category: 'angle' },
      { id: 'rad', name: 'Radians', abbreviation: 'rad', pixelsPerUnit: 57.2958, category: 'angle' },
      { id: 'px2', name: 'Square Pixels', abbreviation: 'px²', pixelsPerUnit: 1, category: 'area' }
    ];

    units.forEach(unit => {
      this.units.set(unit.id, unit);
    });
  }

  private createDefaultRulerSettings(): RulerSettings {
    return {
      visible: false,
      units: 'px',
      subdivisions: 10,
      opacity: 0.8,
      color: '#3b82f6',
      thickness: 20,
      position: 'outside'
    };
  }

  private createDefaultGridSettings(): GridSettings {
    return {
      visible: false,
      type: 'square',
      size: 50,
      subdivisions: 5,
      opacity: 0.3,
      color: '#64748b',
      snapToGrid: false,
      snapThreshold: 10
    };
  }

  private createDefaultGuideSettings(): GuideSettings {
    return {
      visible: false,
      magnetic: true,
      snapThreshold: 8,
      color: '#f59e0b',
      opacity: 0.8,
      thickness: 1
    };
  }

  private createDefaultCrosshairSettings(): CrosshairSettings {
    return {
      visible: false,
      style: 'crosshair',
      size: 20,
      color: '#ef4444',
      opacity: 0.8,
      followMouse: true
    };
  }

  private createDefaultPixelInspector(): PixelInspector {
    return {
      visible: false,
      magnification: 400,
      size: { width: 120, height: 120 },
      position: { x: 20, y: 20 },
      showCoordinates: true,
      showColorValues: true,
      showRGB: true,
      showHSV: false,
      showHex: true
    };
  }

  private initializeTools(): void {
    const tools: MeasurementTool[] = [
      {
        id: 'ruler',
        type: 'ruler',
        active: false,
        persistent: false,
        settings: { showLength: true, showAngle: false }
      },
      {
        id: 'protractor',
        type: 'protractor',
        active: false,
        persistent: false,
        settings: { showAngle: true, centerPoint: null }
      },
      {
        id: 'area',
        type: 'area',
        active: false,
        persistent: false,
        settings: { shape: 'rectangle', showDimensions: true }
      },
      {
        id: 'pixel-inspector',
        type: 'pixel-inspector',
        active: false,
        persistent: true,
        settings: this.pixelInspector
      },
      {
        id: 'color-sampler',
        type: 'color-sampler',
        active: false,
        persistent: true,
        settings: { maxSamplers: 10, showLabels: true }
      }
    ];

    tools.forEach(tool => {
      this.tools.set(tool.id, tool);
    });
  }

  attachToCanvas(canvas: HTMLCanvasElement): void {
    this.canvasElement = canvas;
    this.createOverlayCanvas();
    this.setupEventListeners();
    this._isActive = true;
    this.redrawOverlay();
  }

  detachFromCanvas(): void {
    this.removeEventListeners();
    this.removeOverlayCanvas();
    this.canvasElement = null;
    this._isActive = false;
  }

  private createOverlayCanvas(): void {
    if (!this.canvasElement) return;

    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.style.position = 'absolute';
    this.overlayCanvas.style.top = '0';
    this.overlayCanvas.style.left = '0';
    this.overlayCanvas.style.pointerEvents = 'none';
    this.overlayCanvas.style.zIndex = '1000';

    this.overlayCanvas.width = this.canvasElement.width;
    this.overlayCanvas.height = this.canvasElement.height;

    this.overlayContext = this.overlayCanvas.getContext('2d');

    // Insert overlay after the main canvas
    this.canvasElement.parentNode?.insertBefore(this.overlayCanvas, this.canvasElement.nextSibling);
  }

  private removeOverlayCanvas(): void {
    if (this.overlayCanvas) {
      this.overlayCanvas.remove();
      this.overlayCanvas = null;
      this.overlayContext = null;
    }
  }

  private setupEventListeners(): void {
    if (!this.canvasElement) return;

    this.canvasElement.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvasElement.addEventListener('click', this.handleClick.bind(this));
    this.canvasElement.addEventListener('contextmenu', this.handleRightClick.bind(this));
  }

  private removeEventListeners(): void {
    if (!this.canvasElement) return;

    this.canvasElement.removeEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvasElement.removeEventListener('click', this.handleClick.bind(this));
    this.canvasElement.removeEventListener('contextmenu', this.handleRightClick.bind(this));
  }

  private handleMouseMove(event: MouseEvent): void {
    const rect = this.canvasElement!.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (this.crosshairSettings.visible && this.crosshairSettings.followMouse) {
      this.updateCrosshair(x, y);
    }

    if (this.pixelInspector.visible) {
      this.updatePixelInspector(x, y);
    }

    this.notifyObservers('mouse.move', { x, y });
  }

  private handleClick(event: MouseEvent): void {
    const rect = this.canvasElement!.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Handle active tool clicks
    const activeTool = Array.from(this.tools.values()).find(tool => tool.active);
    if (activeTool) {
      this.handleToolClick(activeTool, x, y);
    }

    this.notifyObservers('canvas.click', { x, y, tool: activeTool });
  }

  private handleRightClick(event: MouseEvent): void {
    event.preventDefault();
    const rect = this.canvasElement!.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    this.notifyObservers('canvas.rightclick', { x, y });
  }

  private handleToolClick(tool: MeasurementTool, x: number, y: number): void {
    switch (tool.type) {
      case 'color-sampler':
        this.addColorSampler(x, y);
        break;
      case 'ruler':
        this.handleRulerClick(x, y);
        break;
      case 'protractor':
        this.handleProtractorClick(x, y);
        break;
      case 'area':
        this.handleAreaClick(x, y);
        break;
    }
  }

  // Rulers
  showRulers(show: boolean = true): void {
    this.rulerSettings.visible = show;
    this.redrawOverlay();
    this.persistSettings();
  }

  updateRulerSettings(settings: Partial<RulerSettings>): void {
    this.rulerSettings = { ...this.rulerSettings, ...settings };
    this.redrawOverlay();
    this.persistSettings();
  }

  // Grid
  showGrid(show: boolean = true): void {
    this.gridSettings.visible = show;
    this.redrawOverlay();
    this.persistSettings();
  }

  updateGridSettings(settings: Partial<GridSettings>): void {
    this.gridSettings = { ...this.gridSettings, ...settings };
    this.redrawOverlay();
    this.persistSettings();
  }

  snapToGrid(x: number, y: number): { x: number; y: number } {
    if (!this.gridSettings.snapToGrid) {
      return { x, y };
    }

    const gridSize = this.gridSettings.size;
    const snappedX = Math.round(x / gridSize) * gridSize;
    const snappedY = Math.round(y / gridSize) * gridSize;

    const distanceX = Math.abs(x - snappedX);
    const distanceY = Math.abs(y - snappedY);

    return {
      x: distanceX <= this.gridSettings.snapThreshold ? snappedX : x,
      y: distanceY <= this.gridSettings.snapThreshold ? snappedY : y
    };
  }

  // Guides
  showGuides(show: boolean = true): void {
    this.guideSettings.visible = show;
    this.redrawOverlay();
    this.persistSettings();
  }

  addGuide(type: 'horizontal' | 'vertical', position: number, name?: string): string {
    const id = `guide_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const guide: Guide = {
      id,
      type,
      position,
      locked: false,
      name
    };

    this.guides.set(id, guide);
    this.redrawOverlay();
    this.persistSettings();

    return id;
  }

  removeGuide(guideId: string): void {
    this.guides.delete(guideId);
    this.redrawOverlay();
    this.persistSettings();
  }

  moveGuide(guideId: string, position: number): void {
    const guide = this.guides.get(guideId);
    if (guide && !guide.locked) {
      guide.position = position;
      this.redrawOverlay();
      this.persistSettings();
    }
  }

  snapToGuides(x: number, y: number): { x: number; y: number } {
    if (!this.guideSettings.magnetic) {
      return { x, y };
    }

    let snappedX = x;
    let snappedY = y;

    for (const guide of this.guides.values()) {
      if (guide.type === 'vertical') {
        const distance = Math.abs(x - guide.position);
        if (distance <= this.guideSettings.snapThreshold) {
          snappedX = guide.position;
        }
      } else if (guide.type === 'horizontal') {
        const distance = Math.abs(y - guide.position);
        if (distance <= this.guideSettings.snapThreshold) {
          snappedY = guide.position;
        }
      }
    }

    return { x: snappedX, y: snappedY };
  }

  // Measurement Tools
  activateTool(toolId: string): void {
    // Deactivate all tools first
    this.tools.forEach(tool => {
      tool.active = false;
    });

    const tool = this.tools.get(toolId);
    if (tool) {
      tool.active = true;
      this.notifyObservers('tool.activated', { tool });
    }
  }

  deactivateTool(toolId: string): void {
    const tool = this.tools.get(toolId);
    if (tool) {
      tool.active = false;
      this.notifyObservers('tool.deactivated', { tool });
    }
  }

  // Color Sampling
  addColorSampler(x: number, y: number): string {
    if (!this.canvasElement) return '';

    const context = this.canvasElement.getContext('2d');
    if (!context) return '';

    const imageData = context.getImageData(x, y, 1, 1);
    const pixel = imageData.data;

    const id = `sampler_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const sampler: ColorSampler = {
      id,
      position: { x, y },
      color: { r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3] / 255 },
      timestamp: Date.now()
    };

    this.colorSamplers.set(id, sampler);
    this.redrawOverlay();
    this.notifyObservers('sampler.added', { sampler });

    return id;
  }

  removeColorSampler(samplerId: string): void {
    this.colorSamplers.delete(samplerId);
    this.redrawOverlay();
    this.notifyObservers('sampler.removed', { samplerId });
  }

  // Measurements
  private handleRulerClick(x: number, y: number): void {
    // Implementation for ruler measurement
    const measurementId = this.startMeasurement('distance', x, y);
    this.notifyObservers('measurement.started', { id: measurementId, type: 'distance' });
  }

  private handleProtractorClick(x: number, y: number): void {
    // Implementation for angle measurement
    const measurementId = this.startMeasurement('angle', x, y);
    this.notifyObservers('measurement.started', { id: measurementId, type: 'angle' });
  }

  private handleAreaClick(x: number, y: number): void {
    // Implementation for area measurement
    const measurementId = this.startMeasurement('area', x, y);
    this.notifyObservers('measurement.started', { id: measurementId, type: 'area' });
  }

  private startMeasurement(type: Measurement['type'], x: number, y: number): string {
    const id = `measurement_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const measurement: Measurement = {
      id,
      tool: type,
      type,
      startPoint: { x, y },
      value: 0,
      unit: this.rulerSettings.units,
      timestamp: Date.now()
    };

    this.measurements.set(id, measurement);
    return id;
  }

  completeMeasurement(measurementId: string, endPoint: { x: number; y: number }): void {
    const measurement = this.measurements.get(measurementId);
    if (!measurement) return;

    measurement.endPoint = endPoint;

    switch (measurement.type) {
      case 'distance':
        measurement.value = this.calculateDistance(measurement.startPoint, endPoint);
        break;
      case 'angle':
        measurement.value = this.calculateAngle(measurement.startPoint, endPoint);
        break;
      case 'area':
        measurement.value = this.calculateArea(measurement.startPoint, endPoint);
        break;
    }

    this.redrawOverlay();
    this.notifyObservers('measurement.completed', { measurement });
  }

  private calculateDistance(start: { x: number; y: number }, end: { x: number; y: number }): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);

    const unit = this.units.get(this.rulerSettings.units);
    return unit ? pixelDistance / unit.pixelsPerUnit : pixelDistance;
  }

  private calculateAngle(start: { x: number; y: number }, end: { x: number; y: number }): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    return Math.atan2(dy, dx) * (180 / Math.PI);
  }

  private calculateArea(start: { x: number; y: number }, end: { x: number; y: number }): number {
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    const pixelArea = width * height;

    const unit = this.units.get(this.rulerSettings.units);
    const pixelsPerUnit = unit ? unit.pixelsPerUnit : 1;
    return pixelArea / (pixelsPerUnit * pixelsPerUnit);
  }

  // Crosshair
  showCrosshair(show: boolean = true): void {
    this.crosshairSettings.visible = show;
    this.redrawOverlay();
  }

  updateCrosshair(x: number, y: number): void {
    if (this.crosshairSettings.visible) {
      this.redrawOverlay();
      this.drawCrosshair(x, y);
    }
  }

  // Pixel Inspector
  showPixelInspector(show: boolean = true): void {
    this.pixelInspector.visible = show;
    this.redrawOverlay();
  }

  updatePixelInspector(x: number, y: number): void {
    if (!this.pixelInspector.visible || !this.canvasElement) return;

    const context = this.canvasElement.getContext('2d');
    if (!context) return;

    const imageData = context.getImageData(
      Math.max(0, x - 2),
      Math.max(0, y - 2),
      5,
      5
    );

    this.drawPixelInspector(x, y, imageData);
  }

  // Drawing methods
  private redrawOverlay(): void {
    if (!this.overlayContext || !this.overlayCanvas) return;

    // Clear overlay
    this.overlayContext.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

    // Draw components
    if (this.gridSettings.visible) this.drawGrid();
    if (this.rulerSettings.visible) this.drawRulers();
    if (this.guideSettings.visible) this.drawGuides();

    this.drawMeasurements();
    this.drawColorSamplers();
  }

  private drawGrid(): void {
    if (!this.overlayContext || !this.overlayCanvas) return;

    const ctx = this.overlayContext;
    const { size, color, opacity, type, subdivisions } = this.gridSettings;

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.5;

    switch (type) {
      case 'square':
        this.drawSquareGrid(ctx, size, subdivisions);
        break;
      case 'rule-of-thirds':
        this.drawRuleOfThirdsGrid(ctx);
        break;
      case 'golden-ratio':
        this.drawGoldenRatioGrid(ctx);
        break;
      case 'diagonal':
        this.drawDiagonalGrid(ctx);
        break;
    }

    ctx.restore();
  }

  private drawSquareGrid(ctx: CanvasRenderingContext2D, size: number, subdivisions: number): void {
    const width = this.overlayCanvas!.width;
    const height = this.overlayCanvas!.height;

    // Main grid
    ctx.beginPath();
    for (let x = 0; x <= width; x += size) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += size) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // Subdivisions
    if (subdivisions > 1) {
      ctx.save();
      ctx.globalAlpha *= 0.5;
      ctx.lineWidth = 0.25;
      ctx.beginPath();

      const subSize = size / subdivisions;
      for (let x = 0; x <= width; x += subSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = 0; y <= height; y += subSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawRuleOfThirdsGrid(ctx: CanvasRenderingContext2D): void {
    const width = this.overlayCanvas!.width;
    const height = this.overlayCanvas!.height;

    ctx.beginPath();
    // Vertical lines
    ctx.moveTo(width / 3, 0);
    ctx.lineTo(width / 3, height);
    ctx.moveTo((2 * width) / 3, 0);
    ctx.lineTo((2 * width) / 3, height);
    // Horizontal lines
    ctx.moveTo(0, height / 3);
    ctx.lineTo(width, height / 3);
    ctx.moveTo(0, (2 * height) / 3);
    ctx.lineTo(width, (2 * height) / 3);
    ctx.stroke();
  }

  private drawGoldenRatioGrid(ctx: CanvasRenderingContext2D): void {
    const width = this.overlayCanvas!.width;
    const height = this.overlayCanvas!.height;
    const ratio = 1.618;

    ctx.beginPath();
    // Vertical lines
    const vLine1 = width / ratio;
    const vLine2 = width - vLine1;
    ctx.moveTo(vLine1, 0);
    ctx.lineTo(vLine1, height);
    ctx.moveTo(vLine2, 0);
    ctx.lineTo(vLine2, height);

    // Horizontal lines
    const hLine1 = height / ratio;
    const hLine2 = height - hLine1;
    ctx.moveTo(0, hLine1);
    ctx.lineTo(width, hLine1);
    ctx.moveTo(0, hLine2);
    ctx.lineTo(width, hLine2);
    ctx.stroke();
  }

  private drawDiagonalGrid(ctx: CanvasRenderingContext2D): void {
    const width = this.overlayCanvas!.width;
    const height = this.overlayCanvas!.height;

    ctx.beginPath();
    // Main diagonals
    ctx.moveTo(0, 0);
    ctx.lineTo(width, height);
    ctx.moveTo(width, 0);
    ctx.lineTo(0, height);
    ctx.stroke();
  }

  private drawRulers(): void {
    if (!this.overlayContext || !this.overlayCanvas) return;

    const ctx = this.overlayContext;
    const { units: _units, subdivisions: _subdivisions, color, opacity, thickness } = this.rulerSettings;

    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;

    // Draw horizontal ruler
    ctx.fillRect(0, 0, this.overlayCanvas.width, thickness);

    // Draw vertical ruler
    ctx.fillRect(0, 0, thickness, this.overlayCanvas.height);

    ctx.restore();
  }

  private drawGuides(): void {
    if (!this.overlayContext || !this.overlayCanvas) return;

    const ctx = this.overlayContext;
    const { color, opacity, thickness } = this.guideSettings;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = opacity;
    ctx.lineWidth = thickness;

    for (const guide of this.guides.values()) {
      ctx.beginPath();
      if (guide.type === 'horizontal') {
        ctx.moveTo(0, guide.position);
        ctx.lineTo(this.overlayCanvas.width, guide.position);
      } else {
        ctx.moveTo(guide.position, 0);
        ctx.lineTo(guide.position, this.overlayCanvas.height);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawMeasurements(): void {
    if (!this.overlayContext) return;

    const ctx = this.overlayContext;

    for (const measurement of this.measurements.values()) {
      if (!measurement.endPoint) continue;

      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.moveTo(measurement.startPoint.x, measurement.startPoint.y);
      ctx.lineTo(measurement.endPoint.x, measurement.endPoint.y);
      ctx.stroke();

      // Draw measurement text
      const midX = (measurement.startPoint.x + measurement.endPoint.x) / 2;
      const midY = (measurement.startPoint.y + measurement.endPoint.y) / 2;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(midX - 30, midY - 10, 60, 20);
      ctx.fillStyle = '#000000';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`${Number(measurement.value).toFixed(2)} ${measurement.unit}`, midX, midY + 4);

      ctx.restore();
    }
  }

  private drawColorSamplers(): void {
    if (!this.overlayContext) return;

    const ctx = this.overlayContext;

    for (const sampler of this.colorSamplers.values()) {
      ctx.save();

      // Draw sampler point
      ctx.fillStyle = `rgba(${sampler.color.r}, ${sampler.color.g}, ${sampler.color.b}, 1)`;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.arc(sampler.position.x, sampler.position.y, 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();

      // Draw color info
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sampler.position.x + 10, sampler.position.y - 15, 80, 30);
      ctx.fillStyle = '#000000';
      ctx.font = '10px Arial';
      ctx.fillText(`RGB(${sampler.color.r}, ${sampler.color.g}, ${sampler.color.b})`,
                   sampler.position.x + 12, sampler.position.y - 5);

      ctx.restore();
    }
  }

  private drawCrosshair(x: number, y: number): void {
    if (!this.overlayContext || !this.overlayCanvas) return;

    const ctx = this.overlayContext;
    const { size, color, opacity } = this.crosshairSettings;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = opacity;
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();

    ctx.restore();
  }

  private drawPixelInspector(_x: number, _y: number, _imageData: ImageData): void {
    // This would draw a magnified view of the pixels around the cursor
    // Implementation would create a magnified view with pixel grid
  }

  // Getters
  getRulerSettings(): RulerSettings {
    return { ...this.rulerSettings };
  }

  getGridSettings(): GridSettings {
    return { ...this.gridSettings };
  }

  getGuideSettings(): GuideSettings {
    return { ...this.guideSettings };
  }

  getGuides(): Guide[] {
    return Array.from(this.guides.values());
  }

  getMeasurements(): Measurement[] {
    return Array.from(this.measurements.values());
  }

  getColorSamplers(): ColorSampler[] {
    return Array.from(this.colorSamplers.values());
  }

  getTools(): MeasurementTool[] {
    return Array.from(this.tools.values());
  }

  getUnits(): MeasurementUnit[] {
    return Array.from(this.units.values());
  }

  // Persistence
  private persistSettings(): void {
    try {
      const dataToSave = {
        rulerSettings: this.rulerSettings,
        gridSettings: this.gridSettings,
        guideSettings: this.guideSettings,
        crosshairSettings: this.crosshairSettings,
        pixelInspector: this.pixelInspector,
        guides: Array.from(this.guides.entries()),
        measurements: Array.from(this.measurements.entries()),
        colorSamplers: Array.from(this.colorSamplers.entries())
      };
      localStorage.setItem('photo-editor-professional-tools', JSON.stringify(dataToSave));
    } catch (error) {
      console.warn('Failed to persist professional tools settings:', error);
    }
  }

  private loadPersistedSettings(): void {
    try {
      const data = localStorage.getItem('photo-editor-professional-tools');
      if (!data) return;

      const parsed = JSON.parse(data);

      if (parsed.rulerSettings) {
        this.rulerSettings = { ...this.rulerSettings, ...parsed.rulerSettings };
      }
      if (parsed.gridSettings) {
        this.gridSettings = { ...this.gridSettings, ...parsed.gridSettings };
      }
      if (parsed.guideSettings) {
        this.guideSettings = { ...this.guideSettings, ...parsed.guideSettings };
      }
      if (parsed.crosshairSettings) {
        this.crosshairSettings = { ...this.crosshairSettings, ...parsed.crosshairSettings };
      }
      if (parsed.pixelInspector) {
        this.pixelInspector = { ...this.pixelInspector, ...parsed.pixelInspector };
      }
      if (parsed.guides) {
        this.guides = new Map(parsed.guides);
      }
      if (parsed.measurements) {
        this.measurements = new Map(parsed.measurements);
      }
      if (parsed.colorSamplers) {
        this.colorSamplers = new Map(parsed.colorSamplers);
      }
    } catch (error) {
      console.warn('Failed to load professional tools settings:', error);
    }
  }

  subscribe(callback: (event: string, data?: unknown) => void): () => void {
    this.observers.add(callback);
    return () => this.observers.delete(callback);
  }

  private notifyObservers(event: string, data?: unknown): void {
    this.observers.forEach(callback => {
      try {
        callback(event, data);
      } catch (error) {
        console.error('Error in professional tools observer:', error);
      }
    });
  }

  dispose(): void {
    this.detachFromCanvas();
    this.observers.clear();
  }
}

export default ProfessionalToolsService;