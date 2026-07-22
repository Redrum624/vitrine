/**
 * DEAD CODE — unused (its only importer, the equally-dead GPUImageProcessor.ts,
 * was deleted alongside whitebalance.frag.ts in the WB axis-decoupling fix).
 * The live color-balance shader is FRAG_COLORBALANCE in ./sources.ts.
 *
 * Color Balance Shader
 * GPU-accelerated 3-way color grading (shadows, midtones, highlights)
 */

import { colorSpaceUtils } from './common.glsl';

export const colorBalanceFragmentShader = `#version 300 es
precision highp float;

in vec2 v_texCoord;

uniform sampler2D u_image;

// 3-way color grading
uniform vec3 u_shadowsColor;     // RGB offset for shadows
uniform vec3 u_midtonesColor;    // RGB offset for midtones
uniform vec3 u_highlightsColor;  // RGB offset for highlights

// Falloff parameters
uniform float u_shadowsMax;      // Upper bound for shadows (0.0-1.0)
uniform float u_highlightsMin;   // Lower bound for highlights (0.0-1.0)

out vec4 fragColor;

${colorSpaceUtils}

// Smooth weight function (0 to 1)
float smoothWeight(float value, float min, float max) {
  float t = clamp((value - min) / (max - min), 0.0, 1.0);
  // Smoothstep for smooth transitions
  return t * t * (3.0 - 2.0 * t);
}

void main() {
  vec4 color = texture(u_image, v_texCoord);
  vec3 linear = srgbToLinear(color.rgb);

  // Get luminance for zone calculation
  float luma = getLuminance(linear);

  // Calculate weights for each zone
  float shadowWeight = 1.0 - smoothWeight(luma, 0.0, u_shadowsMax);
  float highlightWeight = smoothWeight(luma, u_highlightsMin, 1.0);
  float midtoneWeight = 1.0 - shadowWeight - highlightWeight;

  // Apply color shifts
  vec3 result = linear;
  result += u_shadowsColor * shadowWeight * 0.1;     // Scale factor for subtle shifts
  result += u_midtonesColor * midtoneWeight * 0.1;
  result += u_highlightsColor * highlightWeight * 0.1;

  // Convert back and clamp
  vec3 srgb = linearToSrgb(result);
  srgb = clamp(srgb, 0.0, 1.0);

  fragColor = vec4(srgb, color.a);
}
`;
