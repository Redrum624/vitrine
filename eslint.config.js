import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'build/**',
      'release/**',
      'out/**',
      'wasm-build/**',
      'public/wasm/**/*.js',
      'public/workers/**/*.js',
      '*.cjs'
    ]
  },
  // Main TypeScript/React files
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: typescriptParser,
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        performance: 'readonly',
        Worker: 'readonly',
        Buffer: 'readonly',
        CustomEvent: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        localStorage: 'readonly',
        Image: 'readonly',
        process: 'readonly',
        alert: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
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
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'prefer-const': 'error',
      'no-console': 'off',
      'no-unused-vars': 'off',
    },
  },
  // Electron files
  {
    files: ['electron/**/*.{js,cjs}'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        Buffer: 'readonly',
        global: 'readonly',
        window: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-console': 'off',
      'no-useless-catch': 'off',
    },
  },
  // Build scripts (CJS)
  {
    files: ['scripts/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        Buffer: 'readonly',
        global: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-console': 'off',
    },
  },
  // ES Module build scripts
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        global: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-console': 'off',
    },
  },
  // LibRaw WASM scripts
  {
    files: ['scripts/libraw-*.js'],
    languageOptions: {
      ecmaVersion: 2020,
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