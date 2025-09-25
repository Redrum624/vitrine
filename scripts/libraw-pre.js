/**
 * LibRaw WebAssembly Pre-JS Module
 *
 * This file is included before the generated WebAssembly code
 * and sets up the LibRaw API bindings and utilities.
 */

// LibRaw constants
var LIBRAW_SUCCESS = 0;
var LIBRAW_UNSPECIFIED_ERROR = -1;
var LIBRAW_FILE_UNSUPPORTED = -2;
var LIBRAW_REQUEST_FOR_NONEXISTENT_IMAGE = -3;
var LIBRAW_OUT_OF_ORDER_CALL = -4;

// Bayer patterns
var LIBRAW_BAYER_RGGB = 0;
var LIBRAW_BAYER_BGGR = 1;
var LIBRAW_BAYER_GRBG = 2;
var LIBRAW_BAYER_GBRG = 3;

// Output color spaces
var LIBRAW_COLORSPACE_sRGB = 0;
var LIBRAW_COLORSPACE_AdobeRGB = 1;
var LIBRAW_COLORSPACE_WideGamutRGB = 2;
var LIBRAW_COLORSPACE_ProPhotoRGB = 3;

// Demosaic algorithms
var LIBRAW_DEMOSAIC_LINEAR = 0;
var LIBRAW_DEMOSAIC_VNG = 1;
var LIBRAW_DEMOSAIC_PPG = 2;
var LIBRAW_DEMOSAIC_AHD = 3;

// Initialize LibRaw API helpers
var LibRawAPI = {
  // Error handling
  getErrorString: function(errorCode) {
    switch(errorCode) {
      case LIBRAW_SUCCESS: return "Success";
      case LIBRAW_UNSPECIFIED_ERROR: return "Unspecified error";
      case LIBRAW_FILE_UNSUPPORTED: return "File format not supported";
      case LIBRAW_REQUEST_FOR_NONEXISTENT_IMAGE: return "Request for nonexistent image";
      case LIBRAW_OUT_OF_ORDER_CALL: return "Out of order call";
      default: return "Unknown error: " + errorCode;
    }
  },

  // Memory utilities
  stringToUTF8: function(str) {
    var len = lengthBytesUTF8(str);
    var ptr = _malloc(len + 1);
    stringToUTF8(str, ptr, len + 1);
    return ptr;
  },

  freeString: function(ptr) {
    _free(ptr);
  },

  // Image data conversion utilities
  convertToFloat32Array: function(uint8Data, width, height, channels) {
    var floatData = new Float32Array(width * height * channels);
    for (var i = 0; i < uint8Data.length; i++) {
      floatData[i] = uint8Data[i] / 255.0;
    }
    return floatData;
  },

  convertFromFloat32Array: function(floatData, outputDepth) {
    if (outputDepth === 16) {
      var uint16Data = new Uint16Array(floatData.length);
      for (var i = 0; i < floatData.length; i++) {
        uint16Data[i] = Math.round(floatData[i] * 65535);
      }
      return uint16Data;
    } else {
      var uint8Data = new Uint8Array(floatData.length);
      for (var i = 0; i < floatData.length; i++) {
        uint8Data[i] = Math.round(floatData[i] * 255);
      }
      return uint8Data;
    }
  },

  // RAW processing pipeline helpers
  createProcessingParams: function() {
    return {
      // White balance
      user_wb: [1.0, 1.0, 1.0, 1.0],
      use_camera_wb: 1,
      use_auto_wb: 0,

      // Output parameters
      output_color: LIBRAW_COLORSPACE_sRGB,
      output_bps: 16,
      gamma: [2.222, 4.5],

      // Demosaic
      user_qual: LIBRAW_DEMOSAIC_AHD,
      half_size: 0,
      four_color_rgb: 0,

      // Highlight handling
      highlight: 0, // clip highlights

      // Other
      bright: 1.0,
      no_auto_bright: 0
    };
  },

  // Camera-specific optimizations
  getOptimalSettings: function(make, model) {
    var settings = this.createProcessingParams();

    // Olympus optimizations
    if (make === "Olympus") {
      settings.user_qual = LIBRAW_DEMOSAIC_AHD; // AHD works well for Olympus
      settings.highlight = 2; // Blend highlights for better tonality
      settings.gamma = [2.2, 4.5]; // Slightly lower gamma for Olympus
    }

    // Canon optimizations
    else if (make === "Canon") {
      settings.user_qual = LIBRAW_DEMOSAIC_AHD; // AHD for Canon as well
      settings.highlight = 1; // Unclip highlights
      settings.gamma = [2.222, 4.5]; // Standard sRGB gamma
    }

    // Nikon optimizations
    else if (make === "Nikon") {
      settings.user_qual = LIBRAW_DEMOSAIC_VNG; // VNG works well for Nikon
      settings.highlight = 0; // Clip highlights
      settings.gamma = [2.222, 4.5];
    }

    // Sony optimizations
    else if (make === "Sony") {
      settings.user_qual = LIBRAW_DEMOSAIC_AHD;
      settings.highlight = 2; // Blend highlights
      settings.gamma = [2.2, 4.5];
    }

    return settings;
  }
};

console.log("LibRaw WebAssembly Pre-JS loaded");