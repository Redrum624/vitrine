/**
 * Tone Curve Shader
 * GPU-accelerated LUT-based tone curve application
 */

import { colorSpaceUtils } from './common.glsl';

export const toneCurveFragmentShader = `#version 300 es
precision highp float;

in vec2 v_texCoord;

uniform sampler2D u_image;
uniform sampler2D u_curveLUT;  // 1D LUT texture (256x1 or 1024x1)
uniform bool u_applyToRGB;     // Apply same curve to all channels
uniform bool u_applySeparate;  // Apply separate curves to R, G, B

out vec4 fragColor;

${colorSpaceUtils}

// Sample 1D LUT
float sampleLUT(float value, float channel) {
  // channel: 0=combined, 1=red, 2=green, 3=blue
  float y = (channel + 0.5) / 4.0;  // Assuming 4 rows in LUT texture
  return texture(u_curveLUT, vec2(value, y)).r;
}

void main() {
  vec4 color = texture(u_image, v_texCoord);
  vec3 result = color.rgb;

  if (u_applyToRGB) {
    // Apply same curve to all channels (luminosity curve)
    float luma = getLuminance(result);
    float newLuma = sampleLUT(luma, 0.0);

    // Preserve color ratios
    if (luma > 0.0001) {
      float ratio = newLuma / luma;
      result *= ratio;
    }
  } else if (u_applySeparate) {
    // Apply separate curves to each channel
    result.r = sampleLUT(result.r, 1.0);
    result.g = sampleLUT(result.g, 2.0);
    result.b = sampleLUT(result.b, 3.0);
  } else {
    // Apply curve to luminance only
    float luma = getLuminance(result);
    float newLuma = sampleLUT(luma, 0.0);

    // Reconstruct RGB preserving chroma
    if (luma > 0.0001) {
      float ratio = newLuma / luma;
      result *= ratio;
    }
  }

  result = clamp(result, 0.0, 1.0);
  fragColor = vec4(result, color.a);
}
`;
