/**
 * Build script for compiling LibRaw to WebAssembly
 *
 * This script will eventually compile LibRaw C++ library to WebAssembly
 * using Emscripten. For now, it serves as a placeholder and documentation
 * for the compilation process.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LIBRAW_SOURCE_DIR = path.join(__dirname, '..', 'darktable', 'src', 'external', 'LibRaw');
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'wasm');
const BUILD_DIR = path.join(__dirname, '..', 'build', 'libraw-wasm');

// Ensure directories exist
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

if (!fs.existsSync(BUILD_DIR)) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
}

console.log('LibRaw WebAssembly Build Script');
console.log('================================');

// Check for Emscripten
try {
  const emccVersion = execSync('emcc --version', { encoding: 'utf8' });
  console.log('✓ Emscripten found:', emccVersion.split('\n')[0]);
} catch (error) {
  console.error('✗ Emscripten not found. Please install Emscripten SDK:');
  console.error('  https://emscripten.org/docs/getting_started/downloads.html');
  console.error('');
  console.error('Quick install:');
  console.error('  git clone https://github.com/emscripten-core/emsdk.git');
  console.error('  cd emsdk');
  console.error('  ./emsdk install latest');
  console.error('  ./emsdk activate latest');
  console.error('  source ./emsdk_env.sh');
  process.exit(1);
}

// Check LibRaw source
if (!fs.existsSync(LIBRAW_SOURCE_DIR)) {
  console.error('✗ LibRaw source not found at:', LIBRAW_SOURCE_DIR);
  console.error('Please ensure darktable submodule is properly initialized.');
  process.exit(1);
}

console.log('✓ LibRaw source found at:', LIBRAW_SOURCE_DIR);

// Build configuration for WebAssembly
const EMCC_FLAGS = [
  // Basic flags
  '-O3',                                    // Optimization level
  '-s WASM=1',                             // Enable WebAssembly
  '-s MODULARIZE=1',                       // Create a module function
  '-s EXPORT_NAME="LibRawWasm"',           // Module name
  '-s USE_ES6_IMPORT_META=0',              // Compatibility

  // Memory settings
  '-s INITIAL_MEMORY=64MB',                // Initial memory
  '-s MAXIMUM_MEMORY=2GB',                 // Max memory for large RAW files
  '-s ALLOW_MEMORY_GROWTH=1',              // Allow memory to grow
  '-s MALLOC=emmalloc',                    // Efficient malloc

  // Export settings
  '-s EXPORTED_FUNCTIONS=["_malloc","_free"]',
  '-s EXPORTED_RUNTIME_METHODS=["ccall","cwrap"]',

  // Features
  '-s FILESYSTEM=0',                       // Disable filesystem (we'll provide data)
  '-s ENVIRONMENT=web',                    // Web environment only
  '-s SINGLE_FILE=1',                      // Embed WASM in JS

  // Optimization flags
  '-s ELIMINATE_DUPLICATE_FUNCTIONS=1',
  '-s MINIFY_HTML=0',

  // Error handling
  '-s ASSERTIONS=0',                       // Disable assertions in production
  '-s ERROR_ON_UNDEFINED_SYMBOLS=0',       // Allow undefined symbols for now

  // Threading (for future use)
  // '-s USE_PTHREADS=1',                   // Enable threading
  // '-s PTHREAD_POOL_SIZE=4',              // Thread pool size
].join(' ');

// LibRaw source files to compile
const LIBRAW_SOURCES = [
  'src/libraw_cxx.cpp',
  'src/libraw_c_api.cpp',
  'src/libraw_datastream.cpp',
  'src/utils/utils_libraw.cpp',
  'src/utils/utils_dcraw.cpp',
  'src/decoders/decoders_libraw.cpp',
  'src/decoders/decoders_libraw_dcrdefs.cpp',
  'src/decoders/decoders_dcraw.cpp',
  'src/preprocessing/raw2image.cpp',
  'src/postprocessing/dcraw_process.cpp'
];

// Include directories
const INCLUDES = [
  `-I${path.join(LIBRAW_SOURCE_DIR, 'libraw')}`,
  `-I${path.join(LIBRAW_SOURCE_DIR, 'internal')}`,
  `-I${path.join(LIBRAW_SOURCE_DIR, 'src')}`,
];

// Build command
const sourceFiles = LIBRAW_SOURCES.map(src =>
  path.join(LIBRAW_SOURCE_DIR, src)
).join(' ');

const buildCommand = [
  'emcc',
  EMCC_FLAGS,
  INCLUDES.join(' '),
  sourceFiles,
  `-o ${path.join(OUTPUT_DIR, 'libraw.js')}`,

  // Custom C bindings
  `--pre-js ${path.join(__dirname, 'libraw-pre.js')}`,
  `--post-js ${path.join(__dirname, 'libraw-post.js')}`,

  // Defines
  '-D LIBRAW_LIBRARY_BUILD',
  '-D NO_JASPER',              // Disable JASPER support
  '-D NO_JPEG',                // Disable JPEG support (we handle this separately)
  '-D NO_LCMS',                // Disable LCMS support (for now)
].join(' ');

console.log('\nBuild Configuration:');
console.log('Source files:', LIBRAW_SOURCES.length);
console.log('Output:', path.join(OUTPUT_DIR, 'libraw.js'));
console.log('');

// For now, we'll create a placeholder since we need proper LibRaw compilation setup
console.log('⚠️  PLACEHOLDER: Creating mock LibRaw WASM module...');
console.log('   In production, this would compile the actual LibRaw library.');

// Create a mock module for development
const mockWasmModule = `
/**
 * Mock LibRaw WebAssembly Module
 * This is a placeholder until the real LibRaw is compiled to WASM
 */

const LibRawWasm = function() {
  return new Promise((resolve) => {
    // Mock LibRaw API
    const libraw = {
      // Version info
      version: '0.21.1-mock',

      // Core functions (mock implementations)
      libraw_init: () => ({ ptr: 0x1000 }),
      libraw_open_file: () => 0,
      libraw_open_buffer: () => 0,
      libraw_unpack: () => 0,
      libraw_raw2image: () => 0,
      libraw_dcraw_process: () => 0,
      libraw_dcraw_make_mem_image: () => ({ data: new Uint8Array(1000), size: 1000 }),
      libraw_close: () => {},
      libraw_recycle: () => {},

      // Memory management
      _malloc: (size) => new ArrayBuffer(size),
      _free: () => {},

      // Heap access
      HEAPU8: new Uint8Array(1024 * 1024),
      HEAP32: new Int32Array(256 * 1024),
      HEAPF32: new Float32Array(256 * 1024),

      // Supported formats
      supportedFormats: [
        'ORF', 'CR2', 'CR3', 'NEF', 'ARW', 'DNG', 'RAF', 'RW2',
        'PEF', 'X3F', 'MRW', 'DCR', 'K25', 'KDC', 'ERF', 'MEF', 'MOS'
      ]
    };

    console.log('LibRaw WASM Mock Module loaded');
    resolve(libraw);
  });
};

export default LibRawWasm;
`;

fs.writeFileSync(path.join(OUTPUT_DIR, 'libraw.js'), mockWasmModule);

console.log('✓ Mock LibRaw WASM module created at:', path.join(OUTPUT_DIR, 'libraw.js'));
console.log('');
console.log('Next Steps:');
console.log('1. Set up proper LibRaw build environment');
console.log('2. Configure Emscripten compilation flags');
console.log('3. Test with actual RAW files');
console.log('4. Optimize for web performance');
console.log('');
console.log('To build the real WebAssembly module:');
console.log(`  cd ${BUILD_DIR}`);
console.log('  emconfigure cmake ../darktable/src/external/LibRaw');
console.log('  emmake make');
console.log(`  ${buildCommand}`);