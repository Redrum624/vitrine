/**
 * Common Shader Sources
 * Vertex and utility shaders used across all image processing shaders
 */

/**
 * Standard fullscreen quad vertex shader
 * Used by all fragment shaders for image processing
 */
export const vertexShaderSource = `#version 300 es
precision highp float;

// Vertex attributes
in vec2 a_position;  // Position (-1 to 1)
in vec2 a_texCoord;  // Texture coordinates (0 to 1)

// Output to fragment shader
out vec2 v_texCoord;

void main() {
  // Pass texture coordinates to fragment shader
  v_texCoord = a_texCoord;

  // Set vertex position
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/**
 * Utility functions for color space conversions
 * Included in fragment shaders that need color transforms
 */
export const colorSpaceUtils = `
// sRGB to Linear conversion
vec3 srgbToLinear(vec3 srgb) {
  vec3 linear;
  for (int i = 0; i < 3; i++) {
    if (srgb[i] <= 0.04045) {
      linear[i] = srgb[i] / 12.92;
    } else {
      linear[i] = pow((srgb[i] + 0.055) / 1.055, 2.4);
    }
  }
  return linear;
}

// Linear to sRGB conversion
vec3 linearToSrgb(vec3 linear) {
  vec3 srgb;
  for (int i = 0; i < 3; i++) {
    if (linear[i] <= 0.0031308) {
      srgb[i] = linear[i] * 12.92;
    } else {
      srgb[i] = 1.055 * pow(linear[i], 1.0/2.4) - 0.055;
    }
  }
  return srgb;
}

// RGB to Luminance (Rec. 709)
float getLuminance(vec3 rgb) {
  return dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}

// RGB to HSV
vec3 rgbToHsv(vec3 rgb) {
  float maxC = max(max(rgb.r, rgb.g), rgb.b);
  float minC = min(min(rgb.r, rgb.g), rgb.b);
  float delta = maxC - minC;

  vec3 hsv = vec3(0.0, 0.0, maxC);

  if (delta > 0.0001) {
    hsv.y = delta / maxC;  // Saturation

    // Hue
    if (rgb.r == maxC) {
      hsv.x = mod((rgb.g - rgb.b) / delta, 6.0);
    } else if (rgb.g == maxC) {
      hsv.x = (rgb.b - rgb.r) / delta + 2.0;
    } else {
      hsv.x = (rgb.r - rgb.g) / delta + 4.0;
    }
    hsv.x /= 6.0;
  }

  return hsv;
}

// HSV to RGB
vec3 hsvToRgb(vec3 hsv) {
  float h = hsv.x * 6.0;
  float s = hsv.y;
  float v = hsv.z;

  float c = v * s;
  float x = c * (1.0 - abs(mod(h, 2.0) - 1.0));
  float m = v - c;

  vec3 rgb;
  if (h < 1.0) {
    rgb = vec3(c, x, 0.0);
  } else if (h < 2.0) {
    rgb = vec3(x, c, 0.0);
  } else if (h < 3.0) {
    rgb = vec3(0.0, c, x);
  } else if (h < 4.0) {
    rgb = vec3(0.0, x, c);
  } else if (h < 5.0) {
    rgb = vec3(x, 0.0, c);
  } else {
    rgb = vec3(c, 0.0, x);
  }

  return rgb + m;
}
`;
