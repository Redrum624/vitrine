/**
 * White Balance Shader
 * GPU-accelerated color temperature and tint adjustment
 */

import { colorSpaceUtils } from './common.glsl';

export const whiteBalanceFragmentShader = `#version 300 es
precision highp float;

in vec2 v_texCoord;

uniform sampler2D u_image;
uniform float u_temperature;  // -100 to +100 (kelvin adjustment)
uniform float u_tint;         // -100 to +100 (green-magenta)

out vec4 fragColor;

${colorSpaceUtils}

// Temperature to RGB multipliers (simplified Planckian locus approximation)
vec3 temperatureToRGB(float temp) {
  // Normalize temperature from -100/+100 to a kelvin-like scale
  // Negative = cooler (more blue), Positive = warmer (more yellow/red)
  float t = temp / 100.0;

  vec3 rgb = vec3(1.0);

  if (t < 0.0) {
    // Cool (increase blue, decrease red)
    rgb.r = 1.0 + t * 0.3;
    rgb.b = 1.0 - t * 0.3;
  } else {
    // Warm (increase red/yellow, decrease blue)
    rgb.r = 1.0 + t * 0.3;
    rgb.g = 1.0 + t * 0.15;
    rgb.b = 1.0 - t * 0.3;
  }

  return rgb;
}

// Tint adjustment (green-magenta axis)
vec3 applyTint(vec3 rgb, float tint) {
  float t = tint / 100.0;

  if (t > 0.0) {
    // Add green
    rgb.g += t * 0.2;
  } else {
    // Add magenta (red + blue)
    rgb.r -= t * 0.1;
    rgb.b -= t * 0.1;
  }

  return rgb;
}

void main() {
  vec4 color = texture(u_image, v_texCoord);

  // Work in linear space
  vec3 linear = srgbToLinear(color.rgb);

  // Apply temperature adjustment
  vec3 tempRGB = temperatureToRGB(u_temperature);
  linear *= tempRGB;

  // Apply tint adjustment
  linear = applyTint(linear, u_tint);

  // Convert back to sRGB
  vec3 srgb = linearToSrgb(linear);
  srgb = clamp(srgb, 0.0, 1.0);

  fragColor = vec4(srgb, color.a);
}
`;
