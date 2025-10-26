/**
 * Fast Bilateral Filter Denoise Shader
 * GPU-accelerated noise reduction using bilateral filtering
 */

import { colorSpaceUtils } from './common.glsl';

export const denoiseFragmentShader = `#version 300 es
precision highp float;

in vec2 v_texCoord;

uniform sampler2D u_image;
uniform float u_strength;      // 0.0-1.0
uniform float u_sigma_spatial; // Spatial sigma (pixel radius)
uniform float u_sigma_range;   // Range sigma (intensity difference)
uniform vec2 u_texelSize;      // 1.0 / textureSize

out vec4 fragColor;

${colorSpaceUtils}

// Bilateral filter kernel
vec3 bilateralFilter(sampler2D tex, vec2 uv, float sigmaS, float sigmaR) {
  vec3 centerColor = texture(tex, uv).rgb;
  float centerLuma = getLuminance(centerColor);

  vec3 sum = vec3(0.0);
  float weightSum = 0.0;

  // Kernel radius (3 sigma covers 99.7% of Gaussian)
  int radius = int(ceil(sigmaS * 3.0));

  for (int y = -radius; y <= radius; y++) {
    for (int x = -radius; x <= radius; x++) {
      vec2 offset = vec2(float(x), float(y)) * u_texelSize;
      vec2 sampleUV = uv + offset;

      // Skip out-of-bounds samples
      if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
        continue;
      }

      vec3 sampleColor = texture(tex, sampleUV).rgb;
      float sampleLuma = getLuminance(sampleColor);

      // Spatial weight (Gaussian based on distance)
      float dist2 = float(x * x + y * y);
      float spatialWeight = exp(-dist2 / (2.0 * sigmaS * sigmaS));

      // Range weight (Gaussian based on intensity difference)
      float lumaDiff = sampleLuma - centerLuma;
      float rangeWeight = exp(-(lumaDiff * lumaDiff) / (2.0 * sigmaR * sigmaR));

      // Combined weight
      float weight = spatialWeight * rangeWeight;

      sum += sampleColor * weight;
      weightSum += weight;
    }
  }

  return weightSum > 0.0 ? sum / weightSum : centerColor;
}

void main() {
  vec4 color = texture(u_image, v_texCoord);

  if (u_strength > 0.01) {
    // Apply bilateral filter with strength modulation
    vec3 denoised = bilateralFilter(u_image, v_texCoord, u_sigma_spatial, u_sigma_range);

    // Blend with original based on strength
    vec3 result = mix(color.rgb, denoised, u_strength);
    fragColor = vec4(result, color.a);
  } else {
    // No denoising, pass through
    fragColor = color;
  }
}
`;
