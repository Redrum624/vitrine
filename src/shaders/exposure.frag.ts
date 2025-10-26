/**
 * Exposure Adjustment Shader
 * GPU-accelerated exposure and black point adjustment
 */

import { colorSpaceUtils } from './common.glsl';

export const exposureFragmentShader = `#version 300 es
precision highp float;

// Input from vertex shader
in vec2 v_texCoord;

// Uniforms
uniform sampler2D u_image;
uniform float u_exposure;    // -3.0 to +3.0 EV
uniform float u_blackPoint;  // -0.1 to +0.1

// Output
out vec4 fragColor;

${colorSpaceUtils}

void main() {
  // Sample input image
  vec4 color = texture(u_image, v_texCoord);

  // Convert to linear space for proper exposure adjustment
  vec3 linear = srgbToLinear(color.rgb);

  // Apply black point adjustment (subtract before multiplying)
  linear = max(vec3(0.0), linear - u_blackPoint);

  // Apply exposure (multiplicative in linear space)
  float exposureMultiplier = pow(2.0, u_exposure);
  linear *= exposureMultiplier;

  // Convert back to sRGB
  vec3 srgb = linearToSrgb(linear);

  // Clamp to valid range
  srgb = clamp(srgb, 0.0, 1.0);

  fragColor = vec4(srgb, color.a);
}
`;
