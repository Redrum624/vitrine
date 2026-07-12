export interface TouchPoint {
  id: number;
  x: number;
  y: number;
  timestamp: number;
  pressure?: number;
  radiusX?: number;
  radiusY?: number;
}

export interface GestureState {
  type: 'none' | 'pan' | 'pinch' | 'rotate' | 'tap' | 'double-tap' | 'long-press' | 'swipe';
  isActive: boolean;
  startTime: number;
  touchPoints: TouchPoint[];
  center: { x: number; y: number };
  scale: number;
  rotation: number;
  velocity: { x: number; y: number };
  distance: number;
}

export interface GestureConfig {
  enablePan: boolean;
  enablePinch: boolean;
  enableRotate: boolean;
  enableSwipe: boolean;
  enableTap: boolean;
  enableDoubleTap: boolean;
  enableLongPress: boolean;

  // Sensitivity settings
  panThreshold: number;
  pinchThreshold: number;
  rotateThreshold: number;
  swipeThreshold: number;
  tapThreshold: number;
  doubleTapDelay: number;
  longPressDelay: number;

  // Advanced settings
  enableInertia: boolean;
  inertiaDeceleration: number;
  enableBoundaries: boolean;
  preventDefault: boolean;
}

export interface GestureEvent {
  type: string;
  gesture: GestureState;
  preventDefault: () => void;
  deltaX?: number;
  deltaY?: number;
  scale?: number;
  rotation?: number;
  velocity?: { x: number; y: number };
  direction?: 'up' | 'down' | 'left' | 'right';
}

export interface TabletSettings {
  enablePressure: boolean;
  enableTilt: boolean;
  enableBarrel: boolean;
  pressureCurve: 'linear' | 'soft' | 'hard' | 'custom';
  customCurve?: number[];
  minPressure: number;
  maxPressure: number;
  tiltSensitivity: number;
}

export interface TouchOptimizations {
  enableTouchMode: boolean;
  largerHitTargets: boolean;
  simplifiedUI: boolean;
  adaptiveToolbars: boolean;
  gestureHints: boolean;
  hapticFeedback: boolean;
}

class TouchGestureService {
  private static instance: TouchGestureService;
  private config: GestureConfig;
  private tabletSettings: TabletSettings;
  private touchOptimizations: TouchOptimizations;
  private gestureState: GestureState;
  private observers: Set<(event: GestureEvent) => void> = new Set();
  private element: HTMLElement | null = null;
  private isListening = false;
  private lastTap: number = 0;
  private tapCount = 0;
  private longPressTimer: NodeJS.Timeout | null = null;
  private inertiaAnimation: number | null = null;

  private constructor() {
    this.config = this.createDefaultConfig();
    this.tabletSettings = this.createDefaultTabletSettings();
    this.touchOptimizations = this.createDefaultTouchOptimizations();
    this.gestureState = this.createDefaultGestureState();
    this.detectTouchCapabilities();
  }

  static getInstance(): TouchGestureService {
    if (!TouchGestureService.instance) {
      TouchGestureService.instance = new TouchGestureService();
    }
    return TouchGestureService.instance;
  }

  private createDefaultConfig(): GestureConfig {
    return {
      enablePan: true,
      enablePinch: true,
      enableRotate: true,
      enableSwipe: true,
      enableTap: true,
      enableDoubleTap: true,
      enableLongPress: true,

      panThreshold: 10,
      pinchThreshold: 0.1,
      rotateThreshold: 5,
      swipeThreshold: 50,
      tapThreshold: 10,
      doubleTapDelay: 300,
      longPressDelay: 500,

      enableInertia: true,
      inertiaDeceleration: 0.95,
      enableBoundaries: true,
      preventDefault: true
    };
  }

  private createDefaultTabletSettings(): TabletSettings {
    return {
      enablePressure: true,
      enableTilt: true,
      enableBarrel: true,
      pressureCurve: 'linear',
      minPressure: 0.1,
      maxPressure: 1.0,
      tiltSensitivity: 1.0
    };
  }

  private createDefaultTouchOptimizations(): TouchOptimizations {
    return {
      enableTouchMode: false,
      largerHitTargets: true,
      simplifiedUI: false,
      adaptiveToolbars: true,
      gestureHints: true,
      hapticFeedback: false
    };
  }

  private createDefaultGestureState(): GestureState {
    return {
      type: 'none',
      isActive: false,
      startTime: 0,
      touchPoints: [],
      center: { x: 0, y: 0 },
      scale: 1,
      rotation: 0,
      velocity: { x: 0, y: 0 },
      distance: 0
    };
  }

  private detectTouchCapabilities(): void {
    if (typeof window === 'undefined') return;

    // Detect touch support
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // Detect pen/stylus support
    const hasStylus = navigator.maxTouchPoints > 0 && window.PointerEvent;

    // Detect tablet/large screen touch
    const isTablet = hasTouch && (
      window.screen.width >= 768 ||
      window.matchMedia('(min-width: 768px)').matches
    );

    if (hasTouch || isTablet) {
      this.touchOptimizations.enableTouchMode = true;
      this.applyTouchOptimizations();
    }

    if (hasStylus) {
      this.enableStylusFeatures();
    }

    console.log('Touch capabilities detected:', {
      hasTouch,
      hasStylus,
      isTablet,
      maxTouchPoints: navigator.maxTouchPoints
    });
  }

  private applyTouchOptimizations(): void {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;

    if (this.touchOptimizations.enableTouchMode) {
      root.classList.add('touch-mode');
    }

    if (this.touchOptimizations.largerHitTargets) {
      root.classList.add('large-hit-targets');
    }

    if (this.touchOptimizations.simplifiedUI) {
      root.classList.add('simplified-ui');
    }

    if (this.touchOptimizations.adaptiveToolbars) {
      root.classList.add('adaptive-toolbars');
    }

    // Add CSS for touch optimizations
    this.injectTouchCSS();
  }

  private injectTouchCSS(): void {
    if (typeof document === 'undefined') return;

    if (document.querySelector('#touch-gesture-styles')) return;

    const style = document.createElement('style');
    style.id = 'touch-gesture-styles';
    style.textContent = `
      .touch-mode {
        --touch-target-size: 44px;
        --touch-spacing: 12px;
      }

      .touch-mode .large-hit-targets button,
      .touch-mode .large-hit-targets .slider,
      .touch-mode .large-hit-targets .control {
        min-height: var(--touch-target-size);
        min-width: var(--touch-target-size);
        padding: var(--touch-spacing);
      }

      .touch-mode .simplified-ui .panel {
        padding: var(--touch-spacing);
      }

      .touch-mode .simplified-ui .control-group {
        margin-bottom: var(--touch-spacing);
      }

      .touch-mode .adaptive-toolbars .toolbar {
        padding: var(--touch-spacing);
        gap: var(--touch-spacing);
      }

      .touch-mode .adaptive-toolbars .toolbar-button {
        min-height: var(--touch-target-size);
        min-width: var(--touch-target-size);
      }

      .gesture-hint {
        position: fixed;
        background: var(--color-surface);
        color: var(--color-text-primary);
        padding: 8px 12px;
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        font-size: var(--text-sm);
        z-index: 10000;
        pointer-events: none;
        opacity: 0;
        transform: scale(0.9);
        transition: opacity 0.2s, transform 0.2s;
      }

      .gesture-hint.visible {
        opacity: 1;
        transform: scale(1);
      }

      .touch-canvas {
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
      }

      .pinch-zoom-container {
        overflow: hidden;
        position: relative;
      }

      .pan-area {
        cursor: grab;
      }

      .pan-area.panning {
        cursor: grabbing;
      }

      @media (hover: none) and (pointer: coarse) {
        /* Touch-specific styles */
        .hover-effect {
          display: none;
        }

        .touch-only {
          display: block;
        }
      }
    `;

    document.head.appendChild(style);
  }

  private enableStylusFeatures(): void {
    this.tabletSettings.enablePressure = true;
    this.tabletSettings.enableTilt = true;

    // Register pointer events for stylus support
    if (typeof document !== 'undefined') {
      document.addEventListener('pointerdown', this.handlePointerDown.bind(this));
      document.addEventListener('pointermove', this.handlePointerMove.bind(this));
      document.addEventListener('pointerup', this.handlePointerUp.bind(this));
    }
  }

  attachToElement(element: HTMLElement): void {
    if (this.element) {
      this.detachFromElement();
    }

    this.element = element;
    this.isListening = true;

    // Touch events
    element.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    element.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    element.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
    element.addEventListener('touchcancel', this.handleTouchCancel.bind(this), { passive: false });

    // Mouse events for testing
    element.addEventListener('mousedown', this.handleMouseDown.bind(this));
    element.addEventListener('mousemove', this.handleMouseMove.bind(this));
    element.addEventListener('mouseup', this.handleMouseUp.bind(this));

    // Wheel events for pinch simulation
    element.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });

    // Add touch-specific classes
    element.classList.add('touch-canvas');
    element.style.touchAction = 'none';
  }

  detachFromElement(): void {
    if (!this.element || !this.isListening) return;

    const element = this.element;

    element.removeEventListener('touchstart', this.handleTouchStart.bind(this));
    element.removeEventListener('touchmove', this.handleTouchMove.bind(this));
    element.removeEventListener('touchend', this.handleTouchEnd.bind(this));
    element.removeEventListener('touchcancel', this.handleTouchCancel.bind(this));

    element.removeEventListener('mousedown', this.handleMouseDown.bind(this));
    element.removeEventListener('mousemove', this.handleMouseMove.bind(this));
    element.removeEventListener('mouseup', this.handleMouseUp.bind(this));

    element.removeEventListener('wheel', this.handleWheel.bind(this));

    element.classList.remove('touch-canvas');
    element.style.touchAction = '';

    this.element = null;
    this.isListening = false;
  }

  private handleTouchStart(event: TouchEvent): void {
    if (this.config.preventDefault) {
      event.preventDefault();
    }

    this.clearLongPressTimer();
    this.stopInertia();

    const touches = this.extractTouchPoints(event.touches);
    this.gestureState.touchPoints = touches;
    this.gestureState.startTime = Date.now();
    this.gestureState.isActive = true;

    if (touches.length === 1) {
      this.handleSingleTouchStart(touches[0]);
    } else if (touches.length === 2) {
      this.handleMultiTouchStart(touches);
    }

    this.updateGestureCenter();
    this.emitGestureEvent('gesturestart');
  }

  private handleTouchMove(event: TouchEvent): void {
    if (!this.gestureState.isActive) return;

    if (this.config.preventDefault) {
      event.preventDefault();
    }

    const touches = this.extractTouchPoints(event.touches);
    const prevTouches = this.gestureState.touchPoints;

    this.gestureState.touchPoints = touches;
    this.updateGestureCenter();

    if (touches.length === 1 && prevTouches.length === 1) {
      this.handleSingleTouchMove(touches[0], prevTouches[0]);
    } else if (touches.length === 2 && prevTouches.length === 2) {
      this.handleMultiTouchMove(touches, prevTouches);
    }

    this.emitGestureEvent('gesturechange');
  }

  private handleTouchEnd(event: TouchEvent): void {
    if (!this.gestureState.isActive) return;

    this.clearLongPressTimer();

    const touches = this.extractTouchPoints(event.touches);

    if (touches.length === 0) {
      this.handleGestureEnd();
    } else {
      this.gestureState.touchPoints = touches;
      this.updateGestureCenter();
    }
  }

  private handleTouchCancel(_event: TouchEvent): void {
    this.clearLongPressTimer();
    this.handleGestureEnd();
  }

  private handleSingleTouchStart(_touch: TouchPoint): void {
    this.gestureState.type = 'tap';

    // Check for double tap
    const now = Date.now();
    if (now - this.lastTap < this.config.doubleTapDelay) {
      this.tapCount++;
      if (this.tapCount === 2 && this.config.enableDoubleTap) {
        this.gestureState.type = 'double-tap';
        this.emitGestureEvent('doubletap');
        this.tapCount = 0;
        return;
      }
    } else {
      this.tapCount = 1;
    }

    this.lastTap = now;

    // Set up long press detection
    if (this.config.enableLongPress) {
      this.longPressTimer = setTimeout(() => {
        if (this.gestureState.isActive && this.gestureState.type === 'tap') {
          this.gestureState.type = 'long-press';
          this.emitGestureEvent('longpress');
        }
      }, this.config.longPressDelay);
    }
  }

  private handleSingleTouchMove(currentTouch: TouchPoint, prevTouch: TouchPoint): void {
    const deltaX = currentTouch.x - prevTouch.x;
    const deltaY = currentTouch.y - prevTouch.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    if (distance > this.config.tapThreshold) {
      this.clearLongPressTimer();

      if (distance > this.config.panThreshold && this.config.enablePan) {
        this.gestureState.type = 'pan';

        // Calculate velocity
        const timeDelta = currentTouch.timestamp - prevTouch.timestamp;
        if (timeDelta > 0) {
          this.gestureState.velocity = {
            x: deltaX / timeDelta,
            y: deltaY / timeDelta
          };
        }

        this.emitGestureEvent('pan', { deltaX, deltaY });
      }
    }
  }

  private handleMultiTouchStart(touches: TouchPoint[]): void {
    if (touches.length === 2) {
      this.gestureState.type = 'pinch';
      this.gestureState.scale = 1;
      this.gestureState.rotation = 0;

      const distance = this.calculateDistance(touches[0], touches[1]);
      this.gestureState.distance = distance;
    }
  }

  private handleMultiTouchMove(currentTouches: TouchPoint[], prevTouches: TouchPoint[]): void {
    if (currentTouches.length === 2 && prevTouches.length === 2) {
      const currentDistance = this.calculateDistance(currentTouches[0], currentTouches[1]);
      const prevDistance = this.calculateDistance(prevTouches[0], prevTouches[1]);

      // Pinch/zoom detection
      if (this.config.enablePinch) {
        const scaleChange = currentDistance / prevDistance;
        const scaleDelta = Math.abs(scaleChange - 1);

        if (scaleDelta > this.config.pinchThreshold) {
          this.gestureState.type = 'pinch';
          this.gestureState.scale = scaleChange;
          this.emitGestureEvent('pinch', { scale: scaleChange });
        }
      }

      // Rotation detection
      if (this.config.enableRotate) {
        const currentAngle = this.calculateAngle(currentTouches[0], currentTouches[1]);
        const prevAngle = this.calculateAngle(prevTouches[0], prevTouches[1]);
        let rotationDelta = currentAngle - prevAngle;

        // Normalize rotation delta
        if (rotationDelta > 180) rotationDelta -= 360;
        if (rotationDelta < -180) rotationDelta += 360;

        if (Math.abs(rotationDelta) > this.config.rotateThreshold) {
          this.gestureState.type = 'rotate';
          this.gestureState.rotation = rotationDelta;
          this.emitGestureEvent('rotate', { rotation: rotationDelta });
        }
      }
    }
  }

  private handleGestureEnd(): void {
    const gestureType = this.gestureState.type;
    const velocity = this.gestureState.velocity;

    // Handle swipe detection
    if (gestureType === 'pan' && this.config.enableSwipe) {
      const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
      if (speed > this.config.swipeThreshold) {
        const direction = this.getSwipeDirection(velocity);
        this.emitGestureEvent('swipe', { direction, velocity });
      }
    }

    // Handle tap
    if (gestureType === 'tap' && this.config.enableTap) {
      this.emitGestureEvent('tap');
    }

    // Start inertia animation for pan gestures
    if (gestureType === 'pan' && this.config.enableInertia) {
      this.startInertia(velocity);
    }

    this.emitGestureEvent('gestureend');
    this.resetGestureState();
  }

  private handlePointerDown(event: PointerEvent): void {
    if (event.pointerType === 'pen' && this.tabletSettings.enablePressure) {
      this.handleStylusInput(event);
    }
  }

  private handlePointerMove(event: PointerEvent): void {
    if (event.pointerType === 'pen' && this.tabletSettings.enablePressure) {
      this.handleStylusInput(event);
    }
  }

  private handlePointerUp(event: PointerEvent): void {
    if (event.pointerType === 'pen') {
      this.emitGestureEvent('stylusup', {
        pressure: event.pressure,
        tiltX: event.tiltX,
        tiltY: event.tiltY
      });
    }
  }

  private handleStylusInput(event: PointerEvent): void {
    let pressure = event.pressure;

    // Apply pressure curve
    pressure = this.applyPressureCurve(pressure);

    // Clamp to min/max pressure
    pressure = Math.max(this.tabletSettings.minPressure,
      Math.min(this.tabletSettings.maxPressure, pressure));

    this.emitGestureEvent('stylus', {
      pressure,
      tiltX: event.tiltX * this.tabletSettings.tiltSensitivity,
      tiltY: event.tiltY * this.tabletSettings.tiltSensitivity,
      twist: (event as unknown as { twist?: number }).twist || 0
    });
  }

  private applyPressureCurve(pressure: number): number {
    switch (this.tabletSettings.pressureCurve) {
      case 'soft':
        return Math.pow(pressure, 0.5);
      case 'hard':
        return Math.pow(pressure, 2);
      case 'custom':
        if (this.tabletSettings.customCurve) {
          const index = Math.floor(pressure * (this.tabletSettings.customCurve.length - 1));
          return this.tabletSettings.customCurve[index] || pressure;
        }
        return pressure;
      default:
        return pressure;
    }
  }

  private handleMouseDown(event: MouseEvent): void {
    // Simulate touch for testing
    const touch: TouchPoint = {
      id: 0,
      x: event.clientX,
      y: event.clientY,
      timestamp: Date.now()
    };

    this.gestureState.touchPoints = [touch];
    this.gestureState.startTime = Date.now();
    this.gestureState.isActive = true;
    this.gestureState.type = 'pan';

    this.element?.classList.add('panning');
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.gestureState.isActive) return;

    const prevTouch = this.gestureState.touchPoints[0];
    const currentTouch: TouchPoint = {
      id: 0,
      x: event.clientX,
      y: event.clientY,
      timestamp: Date.now()
    };

    const deltaX = currentTouch.x - prevTouch.x;
    const deltaY = currentTouch.y - prevTouch.y;

    this.gestureState.touchPoints = [currentTouch];
    this.emitGestureEvent('pan', { deltaX, deltaY });
  }

  private handleMouseUp(_event: MouseEvent): void {
    if (this.gestureState.isActive) {
      this.handleGestureEnd();
    }
    this.element?.classList.remove('panning');
  }

  private handleWheel(event: WheelEvent): void {
    if (!this.config.enablePinch) return;

    event.preventDefault();

    const scale = event.deltaY > 0 ? 0.9 : 1.1;
    this.emitGestureEvent('pinch', { scale });
  }

  private extractTouchPoints(touches: TouchList): TouchPoint[] {
    const points: TouchPoint[] = [];

    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i];
      points.push({
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        timestamp: Date.now(),
        pressure: (touch as unknown as { force?: number }).force || 1,
        radiusX: touch.radiusX || 0,
        radiusY: touch.radiusY || 0
      });
    }

    return points;
  }

  private updateGestureCenter(): void {
    if (this.gestureState.touchPoints.length === 0) return;

    let centerX = 0;
    let centerY = 0;

    this.gestureState.touchPoints.forEach(touch => {
      centerX += touch.x;
      centerY += touch.y;
    });

    this.gestureState.center = {
      x: centerX / this.gestureState.touchPoints.length,
      y: centerY / this.gestureState.touchPoints.length
    };
  }

  private calculateDistance(touch1: TouchPoint, touch2: TouchPoint): number {
    const dx = touch2.x - touch1.x;
    const dy = touch2.y - touch1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private calculateAngle(touch1: TouchPoint, touch2: TouchPoint): number {
    const dx = touch2.x - touch1.x;
    const dy = touch2.y - touch1.y;
    return Math.atan2(dy, dx) * (180 / Math.PI);
  }

  private getSwipeDirection(velocity: { x: number; y: number }): 'up' | 'down' | 'left' | 'right' {
    const absX = Math.abs(velocity.x);
    const absY = Math.abs(velocity.y);

    if (absX > absY) {
      return velocity.x > 0 ? 'right' : 'left';
    } else {
      return velocity.y > 0 ? 'down' : 'up';
    }
  }

  private startInertia(velocity: { x: number; y: number }): void {
    const currentVelocity = { ...velocity };

    const animate = () => {
      this.emitGestureEvent('pan', {
        deltaX: currentVelocity.x,
        deltaY: currentVelocity.y
      });

      currentVelocity.x *= this.config.inertiaDeceleration;
      currentVelocity.y *= this.config.inertiaDeceleration;

      const speed = Math.sqrt(currentVelocity.x * currentVelocity.x + currentVelocity.y * currentVelocity.y);

      if (speed > 0.1) {
        this.inertiaAnimation = requestAnimationFrame(animate);
      } else {
        this.stopInertia();
      }
    };

    this.inertiaAnimation = requestAnimationFrame(animate);
  }

  private stopInertia(): void {
    if (this.inertiaAnimation) {
      cancelAnimationFrame(this.inertiaAnimation);
      this.inertiaAnimation = null;
    }
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private resetGestureState(): void {
    this.gestureState = this.createDefaultGestureState();
  }

  private emitGestureEvent(type: string, data: unknown = {}): void {
    const event: GestureEvent = {
      type,
      gesture: { ...this.gestureState },
      preventDefault: () => {},
      ...(typeof data === 'object' && data !== null ? data as Record<string, unknown> : {})
    };

    this.observers.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        console.error('Error in gesture observer:', error);
      }
    });

    // Show gesture hints
    if (this.touchOptimizations.gestureHints) {
      this.showGestureHint(type, data);
    }
  }

  private showGestureHint(type: string, data: unknown): void {
    if (typeof document === 'undefined') return;

    const hintText = this.getGestureHintText(type, data);
    if (!hintText) return;

    let hint = document.querySelector('.gesture-hint') as HTMLElement;
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'gesture-hint';
      document.body.appendChild(hint);
    }

    hint.textContent = hintText;
    hint.classList.add('visible');

    setTimeout(() => {
      hint.classList.remove('visible');
    }, 1000);
  }

  private getGestureHintText(type: string, data: unknown): string | null {
    switch (type) {
      case 'pinch':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (data as any)?.scale > 1 ? 'Zoom In' : 'Zoom Out';
      case 'rotate':
        return 'Rotate';
      case 'pan':
        return 'Pan';
      case 'swipe':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return `Swipe ${(data as any)?.direction || ''}`;
      case 'doubletap':
        return 'Double Tap';
      case 'longpress':
        return 'Long Press';
      default:
        return null;
    }
  }

  updateConfig(updates: Partial<GestureConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  updateTabletSettings(updates: Partial<TabletSettings>): void {
    this.tabletSettings = { ...this.tabletSettings, ...updates };
  }

  updateTouchOptimizations(updates: Partial<TouchOptimizations>): void {
    this.touchOptimizations = { ...this.touchOptimizations, ...updates };
    this.applyTouchOptimizations();
  }

  getConfig(): GestureConfig {
    return { ...this.config };
  }

  getTabletSettings(): TabletSettings {
    return { ...this.tabletSettings };
  }

  getTouchOptimizations(): TouchOptimizations {
    return { ...this.touchOptimizations };
  }

  isGestureActive(): boolean {
    return this.gestureState.isActive;
  }

  getCurrentGesture(): GestureState {
    return { ...this.gestureState };
  }

  subscribe(callback: (event: GestureEvent) => void): () => void {
    this.observers.add(callback);
    return () => this.observers.delete(callback);
  }

  dispose(): void {
    this.detachFromElement();
    this.stopInertia();
    this.clearLongPressTimer();
    this.observers.clear();

    // Remove touch CSS
    const style = document.querySelector('#touch-gesture-styles');
    if (style) {
      style.remove();
    }
  }
}

export default TouchGestureService;