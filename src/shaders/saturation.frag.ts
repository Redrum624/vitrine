/**
 * Saturation and Vibrance Shader
 * GPU-accelerated color saturation adjustments
 */

import { colorSpaceUtils } from './common.glsl';

export const saturationFragmentShader = `#version 300 es
precision highp float;

in vec2 v_texCoord;

uniform sampler2D u_image;
uniform float u_saturation;  // -1.0 to +1.0
uniform float u_vibrance;    // -1.0 to +1.0

out vec4 fragColor;

${colorSpaceUtils}

// Apply saturation adjustment
vec3 adjustSaturation(vec3 rgb, float amount) {
  float luma = getLuminance(rgb);
  vec3 gray = vec3(luma);

  // amount: -1 = grayscale, 0 = original, +1 = double saturation
  float factor = 1.0 + amount;
  return mix(gray, rgb, factor);
}

// Apply vibrance adjustment (affects less saturated colors more)
vec3 adjustVibrance(vec3 rgb, float amount) {
  float luma = getLuminance(rgb);
  vec3 gray = vec3(luma);

  // Calculate current saturation
  float maxC = max(max(rgb.r, rgb.g), rgb.b);
  float minC = min(min(rgb.r, rgb.g), rgb.b);
  float currentSat = maxC > 0.0 ? (maxC - minC) / maxC : 0.0;

  // Vibrance affects less saturated colors more (inverse relationship)
  float vibranceStrength = amount * (1.0 - currentSat);
  float factor = 1.0 + vibranceStrength;

  return mix(gray, rgb, factor);
}

void main() {
  vec4 color = texture(u_image, v_texCoord);
  vec3 result = color.rgb;

  // Apply saturation
  if (abs(u_saturation) > 0.001) {
    result = adjustSaturation(result, u_saturation);
  }

  // Apply vibrance
  if (abs(u_vibrance) > 0.001) {
    result = adjustVibrance(result, u_vibrance);
  }

  result = clamp(result, 0.0, 1.0);
  fragColor = vec4(result, color.a);
}
`;
