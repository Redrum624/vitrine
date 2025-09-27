/**
 * LibRaw WebAssembly Post-JS Module
 *
 * This file is included after the generated WebAssembly code
 * and provides high-level JavaScript API wrappers.
 */

// High-level LibRaw JavaScript API
Module.LibRaw = {
  /**
   * Process a RAW file from an ArrayBuffer
   */
  processRawBuffer: function(buffer, params) {
    return new Promise(function(resolve, reject) {
      try {
        // Initialize LibRaw processor
        var processor = ccall('libraw_init', 'number', ['number'], [0]);
        if (!processor) {
          reject(new Error('Failed to initialize LibRaw processor'));
          return;
        }

        // Copy buffer to WASM memory
        var dataPtr = _malloc(buffer.byteLength);
        HEAPU8.set(new Uint8Array(buffer), dataPtr);

        // Open RAW data
        var openResult = ccall('libraw_open_buffer', 'number',
          ['number', 'number', 'number'], [processor, dataPtr, buffer.byteLength]);

        if (openResult !== LIBRAW_SUCCESS) {
          _free(dataPtr);
          ccall('libraw_close', 'void', ['number'], [processor]);
          reject(new Error('Failed to open RAW buffer: ' + LibRawAPI.getErrorString(openResult)));
          return;
        }

        // Set processing parameters
        if (params) {
          Module.LibRaw.setProcessingParams(processor, params);
        }

        // Unpack RAW data
        var unpackResult = ccall('libraw_unpack', 'number', ['number'], [processor]);
        if (unpackResult !== LIBRAW_SUCCESS) {
          _free(dataPtr);
          ccall('libraw_close', 'void', ['number'], [processor]);
          reject(new Error('Failed to unpack RAW data: ' + LibRawAPI.getErrorString(unpackResult)));
          return;
        }

        // Convert raw to image
        var raw2imageResult = ccall('libraw_raw2image', 'number', ['number'], [processor]);
        if (raw2imageResult !== LIBRAW_SUCCESS) {
          _free(dataPtr);
          ccall('libraw_close', 'void', ['number'], [processor]);
          reject(new Error('Failed to convert raw to image: ' + LibRawAPI.getErrorString(raw2imageResult)));
          return;
        }

        // Process image
        var processResult = ccall('libraw_dcraw_process', 'number', ['number'], [processor]);
        if (processResult !== LIBRAW_SUCCESS) {
          _free(dataPtr);
          ccall('libraw_close', 'void', ['number'], [processor]);
          reject(new Error('Failed to process image: ' + LibRawAPI.getErrorString(processResult)));
          return;
        }

        // Get processed image
        var imageResult = ccall('libraw_dcraw_make_mem_image', 'number', ['number'], [processor]);
        if (!imageResult) {
          _free(dataPtr);
          ccall('libraw_close', 'void', ['number'], [processor]);
          reject(new Error('Failed to create processed image'));
          return;
        }

        // Extract image data and metadata
        var imageData = Module.LibRaw.extractImageData(processor, imageResult);
        var metadata = Module.LibRaw.extractMetadata(processor);

        // Clean up
        _free(dataPtr);
        ccall('libraw_recycle', 'void', ['number'], [processor]);
        ccall('libraw_close', 'void', ['number'], [processor]);

        resolve({
          imageData: imageData,
          metadata: metadata
        });

      } catch (error) {
        reject(error);
      }
    });
  },

  /**
   * Set processing parameters on a LibRaw processor
   */
  setProcessingParams: function(processor, params) {
    // In the real implementation, this would set parameters in the LibRaw imgdata structure
    // For now, we'll just log what would be set
    console.log('Setting LibRaw parameters:', params);

    // Example of how parameters would be set:
    // HEAPF32[(processor + offsetof_user_wb) >> 2] = params.temperature / 6500.0;
    // HEAPF32[(processor + offsetof_user_wb + 4) >> 2] = 1.0;
    // HEAPF32[(processor + offsetof_user_wb + 8) >> 2] = params.tint;
    // HEAPF32[(processor + offsetof_user_wb + 12) >> 2] = 1.0;
  },

  /**
   * Extract image data from processed LibRaw result
   */
  extractImageData: function(processor, imageResult) {
    // In the real implementation, this would read from the LibRaw processed_image structure
    // For now, return mock data

    var width = 4000;  // Mock dimensions
    var height = 3000;
    var channels = 4;
    var depth = 16;

    var dataSize = width * height * channels;
    var data = new Float32Array(dataSize);

    // Create mock image data
    for (var i = 0; i < dataSize; i += channels) {
      data[i] = 0.5;     // R
      data[i + 1] = 0.5; // G
      data[i + 2] = 0.5; // B
      data[i + 3] = 1.0; // A
    }

    return {
      width: width,
      height: height,
      channels: channels,
      depth: depth,
      data: data,
      rawWidth: width + 100,
      rawHeight: height + 80,
      topMargin: 40,
      leftMargin: 50,
      iwidth: width,
      iheight: height
    };
  },

  /**
   * Extract metadata from LibRaw processor
   */
  extractMetadata: function(processor) {
    // In the real implementation, this would read from LibRaw imgdata.idata and imgdata.other
    // For now, return mock metadata

    return {
      make: 'Olympus',
      model: 'OM-D E-M1 Mark III',
      dngVersion: 0,
      iso: 200,
      aperture: 5.6,
      shutter: 1/125,
      focalLength: 40.0,
      timestamp: Date.now(),
      orientation: 1,
      colorMatrix1: new Float32Array([
        1.0234, -0.2345, -0.1234,
        -0.3456, 1.4567, -0.0987,
        -0.0123, -0.5678, 1.3456
      ]),
      colorMatrix2: new Float32Array([
        1.1234, -0.3345, -0.2234,
        -0.4456, 1.5567, -0.1987,
        -0.1123, -0.6678, 1.4456
      ]),
      whiteBalance: [2.345, 1.0, 1.456, 1.0],
      blackLevel: [512, 512, 512, 512],
      whiteLevel: 16383,
      bayerPattern: 'RGGB',
      colorSpace: 'sRGB',
      profileDescription: 'Olympus OM-D E-M1 Mark III'
    };
  },

  /**
   * Get LibRaw version
   */
  getVersion: function() {
    // In the real implementation:
    // return UTF8ToString(ccall('libraw_version', 'number', [], []));
    return '0.21.1-wasm';
  },

  /**
   * Get list of supported cameras
   */
  getSupportedCameras: function() {
    // In the real implementation, this would call libraw_cameraList()
    return [
      'Canon EOS R5', 'Canon EOS R6', 'Canon EOS R3',
      'Olympus OM-D E-M1 Mark III', 'Olympus OM-D E-M1 Mark II',
      'Nikon Z9', 'Nikon Z7 II', 'Nikon D850',
      'Sony α7R V', 'Sony α7 IV', 'Sony α7S III'
    ];
  },

  /**
   * Check if LibRaw supports a specific format
   */
  supportsFormat: function(extension) {
    var supportedFormats = [
      '.orf', '.cr2', '.cr3', '.nef', '.arw', '.dng',
      '.raf', '.rw2', '.pef', '.x3f', '.mrw', '.dcr',
      '.k25', '.kdc', '.erf', '.mef', '.mos', '.raw', '.rwl'
    ];
    return supportedFormats.includes(extension.toLowerCase());
  }
};

// Export for Node.js if available
if (typeof globalThis !== 'undefined' && globalThis.module && globalThis.module.exports) {
  globalThis.module.exports = Module;
}

console.log("LibRaw WebAssembly Post-JS loaded");