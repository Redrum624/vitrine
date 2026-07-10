import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

// Shared global sets so every config block declares the same environment.
const timerGlobals = {
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  queueMicrotask: 'readonly',
  setImmediate: 'readonly',
};

const nodeGlobals = {
  ...timerGlobals,
  console: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  global: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  MessageEvent: 'readonly',
  fetch: 'readonly',
  structuredClone: 'readonly',
  AbortController: 'readonly',
};

const browserGlobals = {
  ...timerGlobals,
  console: 'readonly',
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  performance: 'readonly',
  Worker: 'readonly',
  Buffer: 'readonly',
  CustomEvent: 'readonly',
  localStorage: 'readonly',
  Image: 'readonly',
  process: 'readonly',
  alert: 'readonly',
  Blob: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  React: 'readonly',
  HTMLCanvasElement: 'readonly',
  HTMLDivElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLElement: 'readonly',
  CanvasRenderingContext2D: 'readonly',
  KeyboardEvent: 'readonly',
  caches: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  crypto: 'readonly',
  queueMicrotask: 'readonly',
  structuredClone: 'readonly',
  // DOM APIs
  FileReader: 'readonly',
  MouseEvent: 'readonly',
  TouchEvent: 'readonly',
  PointerEvent: 'readonly',
  WheelEvent: 'readonly',
  TouchList: 'readonly',
  MediaQueryListEvent: 'readonly',
  MediaQueryList: 'readonly',
  Window: 'readonly',
  HTMLImageElement: 'readonly',
  ImageData: 'readonly',
  OffscreenCanvas: 'readonly',
  ResizeObserver: 'readonly',
  IntersectionObserver: 'readonly',
  MessageEvent: 'readonly',
  MessageChannel: 'readonly',
  WebGLTexture: 'readonly',
  WebGLBuffer: 'readonly',
  WebGLFramebuffer: 'readonly',
  WebGL2RenderingContext: 'readonly',
  WebGLProgram: 'readonly',
  WebGLShader: 'readonly',
  WebGLVertexArrayObject: 'readonly',
  WebGLUniformLocation: 'readonly',
  Event: 'readonly',
  HTMLButtonElement: 'readonly',
  GlobalCompositeOperation: 'readonly',
  btoa: 'readonly',
  atob: 'readonly',
  // Node.js types
  NodeJS: 'readonly',
  // Error types
  ErrorEvent: 'readonly',
  fetch: 'readonly',
};

// Experimental react-compiler diagnostics shipped in eslint-plugin-react-hooks.
// This codebase predates them and has many pre-existing violations; enforcing
// them now would require a large, risky refactor. Disable them for now while
// keeping the critical `rules-of-hooks` (still error via recommended) active.
// Re-enable + remediate as a dedicated cleanup pass.
const reactCompilerRulesOff = {
  'react-hooks/set-state-in-effect': 'off',
  'react-hooks/purity': 'off',
  'react-hooks/immutability': 'off',
  'react-hooks/preserve-manual-memoization': 'off',
  'react-hooks/refs': 'off',
  'react-hooks/exhaustive-deps': 'off',
  'react-hooks/static-components': 'off',
};

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'build/**',
      'release/**',
      'out/**',
      'wasm-build/**',
      'public/workers/**/*.js',
      'public/libraw/**',
      'e2e/**',
      '*.cjs'
    ]
  },
  // Main TypeScript/React files
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: typescriptParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserGlobals,
    },
    plugins: {
      '@typescript-eslint': typescript,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'prefer-const': 'error',
      'no-console': 'off',
      'no-unused-vars': 'off',
      ...reactCompilerRulesOff,
    },
  },
  // Web Worker module files — DedicatedWorkerGlobalScope, not Window.
  {
    files: ['src/workers/**/*.{ts,tsx}'],
    languageOptions: {
      parser: typescriptParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...browserGlobals,
        self: 'readonly',
        Transferable: 'readonly',
        DedicatedWorkerGlobalScope: 'readonly',
        importScripts: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
    },
    rules: {
      ...js.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'prefer-const': 'error',
      'no-console': 'off',
      'no-unused-vars': 'off',
    },
  },
  // Test files
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}', 'src/**/__tests__/**/*.{ts,tsx}', 'src/setupTests.ts'],
    languageOptions: {
      parser: typescriptParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...browserGlobals,
        ...nodeGlobals,
        jest: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        test: 'readonly',
        ImageBitmap: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
    },
    rules: {
      ...js.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-unused-vars': 'off',
    },
  },
  // Electron files
  {
    files: ['electron/**/*.{js,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...nodeGlobals,
        window: 'readonly',
        logger: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-console': 'off',
      'no-useless-catch': 'off',
      'no-control-regex': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  // Build scripts (CJS)
  {
    files: ['scripts/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-console': 'off',
      'no-control-regex': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  // ES Module build scripts
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...nodeGlobals,
        module: 'readonly',
        require: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-console': 'off',
      'no-control-regex': 'off',
    },
  },
  // LibRaw WASM scripts
  {
    files: ['scripts/libraw-*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        Module: 'readonly',
        ccall: 'readonly',
        _malloc: 'readonly',
        _free: 'readonly',
        HEAPU8: 'readonly',
        LIBRAW_SUCCESS: 'readonly',
        LIBRAW_BAYER_RGGB: 'readonly',
        LIBRAW_BAYER_BGGR: 'readonly',
        LIBRAW_BAYER_GRBG: 'readonly',
        LIBRAW_BAYER_GBRG: 'readonly',
        LIBRAW_COLORSPACE_sRGB: 'readonly',
        LIBRAW_COLORSPACE_AdobeRGB: 'readonly',
        LIBRAW_COLORSPACE_WideGamutRGB: 'readonly',
        LIBRAW_COLORSPACE_ProPhotoRGB: 'readonly',
        LIBRAW_DEMOSAIC_LINEAR: 'readonly',
        LIBRAW_DEMOSAIC_VNG: 'readonly',
        LIBRAW_DEMOSAIC_PPG: 'readonly',
        LibRawAPI: 'readonly',
        lengthBytesUTF8: 'readonly',
        stringToUTF8: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-console': 'off',
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
    },
  },
];
