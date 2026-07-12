export interface ThemeColors {
  // Primary colors
  primary: string;
  primaryHover: string;
  primaryActive: string;
  primaryDisabled: string;

  // Secondary colors
  secondary: string;
  secondaryHover: string;
  secondaryActive: string;

  // Background colors
  background: string;
  backgroundSecondary: string;
  backgroundTertiary: string;
  backgroundOverlay: string;

  // Surface colors
  surface: string;
  surfaceHover: string;
  surfaceActive: string;
  surfaceBorder: string;

  // Text colors
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;

  // Status colors
  success: string;
  warning: string;
  error: string;
  info: string;

  // Accent colors
  accent: string;
  accentSecondary: string;

  // Panel specific
  panelBackground: string;
  panelHeader: string;
  panelBorder: string;
  panelShadow: string;

  // Control specific
  controlBackground: string;
  controlBorder: string;
  controlText: string;
  controlDisabled: string;
}

export interface ThemeSpacing {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  xxl: string;
}

export interface ThemeTypography {
  fontFamily: string;
  fontFamilyMono: string;
  fontSize: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
    xxl: string;
  };
  fontWeight: {
    normal: string;
    medium: string;
    semibold: string;
    bold: string;
  };
  lineHeight: {
    tight: string;
    normal: string;
    relaxed: string;
  };
}

export interface ThemeBorderRadius {
  none: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  full: string;
}

export interface ThemeShadows {
  none: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  inner: string;
}

export interface ThemeBreakpoints {
  sm: string;
  md: string;
  lg: string;
  xl: string;
  xxl: string;
}

export interface Theme {
  name: string;
  type: 'light' | 'dark' | 'auto';
  colors: ThemeColors;
  spacing: ThemeSpacing;
  typography: ThemeTypography;
  borderRadius: ThemeBorderRadius;
  shadows: ThemeShadows;
  breakpoints: ThemeBreakpoints;
  animations: {
    duration: {
      fast: string;
      normal: string;
      slow: string;
    };
    easing: {
      linear: string;
      easeIn: string;
      easeOut: string;
      easeInOut: string;
    };
  };
}

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  category: 'professional' | 'creative' | 'minimal' | 'high-contrast';
  theme: Theme;
  preview: {
    primaryColor: string;
    backgroundColor: string;
    accentColor: string;
  };
}

class ThemeService {
  private static instance: ThemeService;
  private currentTheme: Theme;
  private availableThemes: Map<string, Theme> = new Map();
  private themePresets: ThemePreset[] = [];
  private observers: Set<(theme: Theme) => void> = new Set();
  private systemThemeQuery: MediaQueryList | null = null;

  private constructor() {
    this.initializeThemes();
    this.currentTheme = this.availableThemes.get('professional-dark')!;
    this.setupSystemThemeDetection();
  }

  static getInstance(): ThemeService {
    if (!ThemeService.instance) {
      ThemeService.instance = new ThemeService();
    }
    return ThemeService.instance;
  }

  private initializeThemes(): void {
    // Professional Dark Theme (Default)
    const professionalDark: Theme = {
      name: 'Professional Dark',
      type: 'dark',
      colors: {
        primary: '#3b82f6',
        primaryHover: '#2563eb',
        primaryActive: '#1d4ed8',
        primaryDisabled: '#1e3a8a',
        secondary: '#6b7280',
        secondaryHover: '#4b5563',
        secondaryActive: '#374151',
        background: '#0f172a',
        backgroundSecondary: '#1e293b',
        backgroundTertiary: '#334155',
        backgroundOverlay: 'rgba(15, 23, 42, 0.8)',
        surface: '#1e293b',
        surfaceHover: '#334155',
        surfaceActive: '#475569',
        surfaceBorder: '#475569',
        textPrimary: '#f8fafc',
        textSecondary: '#cbd5e1',
        textMuted: '#64748b',
        textInverse: '#0f172a',
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
        info: '#3b82f6',
        accent: '#8b5cf6',
        accentSecondary: '#a78bfa',
        panelBackground: '#1e293b',
        panelHeader: '#334155',
        panelBorder: '#475569',
        panelShadow: 'rgba(0, 0, 0, 0.3)',
        controlBackground: '#334155',
        controlBorder: '#475569',
        controlText: '#f8fafc',
        controlDisabled: '#64748b'
      },
      spacing: {
        xs: '0.25rem',
        sm: '0.5rem',
        md: '1rem',
        lg: '1.5rem',
        xl: '2rem',
        xxl: '3rem'
      },
      typography: {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
        fontFamilyMono: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
        fontSize: {
          xs: '0.75rem',
          sm: '0.875rem',
          md: '1rem',
          lg: '1.125rem',
          xl: '1.25rem',
          xxl: '1.5rem'
        },
        fontWeight: {
          normal: '400',
          medium: '500',
          semibold: '600',
          bold: '700'
        },
        lineHeight: {
          tight: '1.25',
          normal: '1.5',
          relaxed: '1.75'
        }
      },
      borderRadius: {
        none: '0',
        sm: '0.125rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
        full: '9999px'
      },
      shadows: {
        none: 'none',
        sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)'
      },
      breakpoints: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
        xxl: '1536px'
      },
      animations: {
        duration: {
          fast: '150ms',
          normal: '300ms',
          slow: '500ms'
        },
        easing: {
          linear: 'linear',
          easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
          easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
          easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)'
        }
      }
    };

    // Professional Light Theme
    const professionalLight: Theme = {
      ...professionalDark,
      name: 'Professional Light',
      type: 'light',
      colors: {
        ...professionalDark.colors,
        background: '#ffffff',
        backgroundSecondary: '#f8fafc',
        backgroundTertiary: '#f1f5f9',
        backgroundOverlay: 'rgba(255, 255, 255, 0.8)',
        surface: '#ffffff',
        surfaceHover: '#f8fafc',
        surfaceActive: '#f1f5f9',
        surfaceBorder: '#e2e8f0',
        textPrimary: '#1e293b',
        textSecondary: '#475569',
        textMuted: '#64748b',
        textInverse: '#ffffff',
        panelBackground: '#ffffff',
        panelHeader: '#f8fafc',
        panelBorder: '#e2e8f0',
        panelShadow: 'rgba(0, 0, 0, 0.1)',
        controlBackground: '#f8fafc',
        controlBorder: '#e2e8f0',
        controlText: '#1e293b',
        controlDisabled: '#94a3b8'
      }
    };

    // Creative Dark Theme
    const creativeDark: Theme = {
      ...professionalDark,
      name: 'Creative Dark',
      type: 'dark',
      colors: {
        ...professionalDark.colors,
        primary: '#8b5cf6',
        primaryHover: '#7c3aed',
        primaryActive: '#6d28d9',
        primaryDisabled: '#4c1d95',
        accent: '#f59e0b',
        accentSecondary: '#fbbf24',
        background: '#1a1a2e',
        backgroundSecondary: '#16213e',
        backgroundTertiary: '#0f3460',
        panelBackground: '#16213e',
        panelHeader: '#0f3460'
      }
    };

    // Minimal Light Theme
    const minimalLight: Theme = {
      ...professionalLight,
      name: 'Minimal Light',
      type: 'light',
      colors: {
        ...professionalLight.colors,
        primary: '#000000',
        primaryHover: '#374151',
        primaryActive: '#1f2937',
        secondary: '#6b7280',
        accent: '#ef4444',
        accentSecondary: '#f87171'
      }
    };

    // High Contrast Theme
    const highContrast: Theme = {
      ...professionalDark,
      name: 'High Contrast',
      type: 'dark',
      colors: {
        primary: '#ffffff',
        primaryHover: '#f3f4f6',
        primaryActive: '#e5e7eb',
        primaryDisabled: '#9ca3af',
        secondary: '#d1d5db',
        secondaryHover: '#f3f4f6',
        secondaryActive: '#e5e7eb',
        background: '#000000',
        backgroundSecondary: '#111111',
        backgroundTertiary: '#222222',
        backgroundOverlay: 'rgba(0, 0, 0, 0.9)',
        surface: '#111111',
        surfaceHover: '#222222',
        surfaceActive: '#333333',
        surfaceBorder: '#ffffff',
        textPrimary: '#ffffff',
        textSecondary: '#e5e7eb',
        textMuted: '#d1d5db',
        textInverse: '#000000',
        success: '#00ff00',
        warning: '#ffff00',
        error: '#ff0000',
        info: '#00ffff',
        accent: '#ffff00',
        accentSecondary: '#ffffff',
        panelBackground: '#111111',
        panelHeader: '#222222',
        panelBorder: '#ffffff',
        panelShadow: 'rgba(255, 255, 255, 0.1)',
        controlBackground: '#222222',
        controlBorder: '#ffffff',
        controlText: '#ffffff',
        controlDisabled: '#666666'
      }
    };

    // Register themes
    this.availableThemes.set('professional-dark', professionalDark);
    this.availableThemes.set('professional-light', professionalLight);
    this.availableThemes.set('creative-dark', creativeDark);
    this.availableThemes.set('minimal-light', minimalLight);
    this.availableThemes.set('high-contrast', highContrast);

    // Create theme presets
    this.themePresets = [
      {
        id: 'professional-dark',
        name: 'Professional Dark',
        description: 'Industry-standard dark theme optimized for professional photo editing',
        category: 'professional',
        theme: professionalDark,
        preview: {
          primaryColor: '#3b82f6',
          backgroundColor: '#0f172a',
          accentColor: '#8b5cf6'
        }
      },
      {
        id: 'professional-light',
        name: 'Professional Light',
        description: 'Clean light theme for bright working environments',
        category: 'professional',
        theme: professionalLight,
        preview: {
          primaryColor: '#3b82f6',
          backgroundColor: '#ffffff',
          accentColor: '#8b5cf6'
        }
      },
      {
        id: 'creative-dark',
        name: 'Creative Dark',
        description: 'Vibrant dark theme for creative professionals',
        category: 'creative',
        theme: creativeDark,
        preview: {
          primaryColor: '#8b5cf6',
          backgroundColor: '#1a1a2e',
          accentColor: '#f59e0b'
        }
      },
      {
        id: 'minimal-light',
        name: 'Minimal Light',
        description: 'Distraction-free minimal design for focused editing',
        category: 'minimal',
        theme: minimalLight,
        preview: {
          primaryColor: '#000000',
          backgroundColor: '#ffffff',
          accentColor: '#ef4444'
        }
      },
      {
        id: 'high-contrast',
        name: 'High Contrast',
        description: 'Maximum contrast for accessibility and visibility',
        category: 'high-contrast',
        theme: highContrast,
        preview: {
          primaryColor: '#ffffff',
          backgroundColor: '#000000',
          accentColor: '#ffff00'
        }
      }
    ];
  }

  private setupSystemThemeDetection(): void {
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.systemThemeQuery.addEventListener('change', this.handleSystemThemeChange.bind(this));
    }
  }

  private handleSystemThemeChange(event: MediaQueryListEvent): void {
    if (this.currentTheme.type === 'auto') {
      const systemTheme = event.matches ? 'dark' : 'light';
      this.applySystemTheme(systemTheme);
    }
  }

  private applySystemTheme(systemTheme: 'dark' | 'light'): void {
    const fallbackTheme = systemTheme === 'dark' ? 'professional-dark' : 'professional-light';
    const theme = this.availableThemes.get(fallbackTheme);
    if (theme) {
      this.applyTheme(theme);
    }
  }

  setTheme(themeId: string): void {
    const theme = this.availableThemes.get(themeId);
    if (!theme) {
      console.warn(`Theme '${themeId}' not found`);
      return;
    }

    this.currentTheme = theme;
    this.applyTheme(theme);
    this.persistTheme(themeId);
    this.notifyObservers(theme);
  }

  private applyTheme(theme: Theme): void {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;

    // Apply CSS custom properties
    Object.entries(theme.colors).forEach(([key, value]) => {
      root.style.setProperty(`--color-${this.kebabCase(key)}`, value);
    });

    Object.entries(theme.spacing).forEach(([key, value]) => {
      root.style.setProperty(`--spacing-${key}`, value);
    });

    Object.entries(theme.typography.fontSize).forEach(([key, value]) => {
      root.style.setProperty(`--text-${key}`, value);
    });

    Object.entries(theme.typography.fontWeight).forEach(([key, value]) => {
      root.style.setProperty(`--font-${key}`, value);
    });

    Object.entries(theme.borderRadius).forEach(([key, value]) => {
      root.style.setProperty(`--radius-${key}`, value);
    });

    Object.entries(theme.shadows).forEach(([key, value]) => {
      root.style.setProperty(`--shadow-${key}`, value);
    });

    Object.entries(theme.animations.duration).forEach(([key, value]) => {
      root.style.setProperty(`--duration-${key}`, value);
    });

    Object.entries(theme.animations.easing).forEach(([key, value]) => {
      root.style.setProperty(`--easing-${this.kebabCase(key)}`, value);
    });

    // Set font families
    root.style.setProperty('--font-family', theme.typography.fontFamily);
    root.style.setProperty('--font-family-mono', theme.typography.fontFamilyMono);

    // Set data attribute for theme-specific styles
    root.setAttribute('data-theme', theme.type);
    root.setAttribute('data-theme-name', this.kebabCase(theme.name));

    // Update meta theme-color for mobile browsers
    this.updateMetaThemeColor(theme.colors.background);
  }

  private updateMetaThemeColor(color: string): void {
    if (typeof document === 'undefined') return;

    let metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (!metaThemeColor) {
      metaThemeColor = document.createElement('meta');
      metaThemeColor.setAttribute('name', 'theme-color');
      document.head.appendChild(metaThemeColor);
    }
    metaThemeColor.setAttribute('content', color);
  }

  private kebabCase(str: string): string {
    return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase();
  }

  private persistTheme(themeId: string): void {
    try {
      localStorage.setItem('photo-editor-theme', themeId);
    } catch (error) {
      console.warn('Failed to persist theme preference:', error);
    }
  }

  loadPersistedTheme(): void {
    try {
      const persistedTheme = localStorage.getItem('photo-editor-theme');
      if (persistedTheme && this.availableThemes.has(persistedTheme)) {
        this.setTheme(persistedTheme);
        return;
      }
    } catch (error) {
      console.warn('Failed to load persisted theme:', error);
    }

    // Fall back to system theme detection
    if (this.systemThemeQuery) {
      const systemTheme = this.systemThemeQuery.matches ? 'dark' : 'light';
      this.applySystemTheme(systemTheme);
    }
  }

  getCurrentTheme(): Theme {
    return this.currentTheme;
  }

  getAvailableThemes(): Theme[] {
    return Array.from(this.availableThemes.values());
  }

  getThemePresets(): ThemePreset[] {
    return [...this.themePresets];
  }

  getThemePresetsByCategory(category: ThemePreset['category']): ThemePreset[] {
    return this.themePresets.filter(preset => preset.category === category);
  }

  createCustomTheme(baseThemeId: string, customizations: Partial<Theme>): Theme {
    const baseTheme = this.availableThemes.get(baseThemeId);
    if (!baseTheme) {
      throw new Error(`Base theme '${baseThemeId}' not found`);
    }

    const customTheme: Theme = {
      ...baseTheme,
      ...customizations,
      colors: {
        ...baseTheme.colors,
        ...customizations.colors
      },
      typography: {
        ...baseTheme.typography,
        ...customizations.typography,
        fontSize: {
          ...baseTheme.typography.fontSize,
          ...customizations.typography?.fontSize
        },
        fontWeight: {
          ...baseTheme.typography.fontWeight,
          ...customizations.typography?.fontWeight
        }
      }
    };

    return customTheme;
  }

  registerCustomTheme(id: string, theme: Theme): void {
    this.availableThemes.set(id, theme);
  }

  subscribe(callback: (theme: Theme) => void): () => void {
    this.observers.add(callback);

    // Call immediately with current theme
    callback(this.currentTheme);

    // Return unsubscribe function
    return () => {
      this.observers.delete(callback);
    };
  }

  private notifyObservers(theme: Theme): void {
    this.observers.forEach(callback => {
      try {
        callback(theme);
      } catch (error) {
        console.error('Error in theme observer:', error);
      }
    });
  }

  exportTheme(theme: Theme): string {
    return JSON.stringify(theme, null, 2);
  }

  importTheme(themeJson: string): Theme {
    try {
      const theme = JSON.parse(themeJson) as Theme;
      // Validate theme structure
      if (!theme.name || !theme.colors || !theme.typography) {
        throw new Error('Invalid theme structure');
      }
      return theme;
    } catch {
      throw new Error('Failed to import theme: Invalid JSON or theme structure');
    }
  }

  getThemeCSS(theme: Theme): string {
    const cssVariables = [
      ':root {',
      ...Object.entries(theme.colors).map(([key, value]) => `  --color-${this.kebabCase(key)}: ${value};`),
      ...Object.entries(theme.spacing).map(([key, value]) => `  --spacing-${key}: ${value};`),
      ...Object.entries(theme.typography.fontSize).map(([key, value]) => `  --text-${key}: ${value};`),
      ...Object.entries(theme.typography.fontWeight).map(([key, value]) => `  --font-${key}: ${value};`),
      ...Object.entries(theme.borderRadius).map(([key, value]) => `  --radius-${key}: ${value};`),
      ...Object.entries(theme.shadows).map(([key, value]) => `  --shadow-${key}: ${value};`),
      '}'
    ];

    return cssVariables.join('\n');
  }

  dispose(): void {
    if (this.systemThemeQuery) {
      this.systemThemeQuery.removeEventListener('change', this.handleSystemThemeChange.bind(this));
    }
    this.observers.clear();
  }
}

export default ThemeService;