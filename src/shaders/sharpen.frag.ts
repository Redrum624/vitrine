/**
 * Unsharp Mask Shader
 * GPU-accelerated sharpening using unsharp masking
 */

import { colorSpaceUtils } from './common.glsl';

export const sharpenFragmentShader = `#version 300 es
precision highp float;

in vec2 v_texCoord;

uniform sampler2D u_image;
uniform float u_amount;     // 0.0-2.0 (sharpening strength)
uniform float u_radius;     // Blur radius for unsharp mask
uniform float u_threshold;  // Edge threshold (0.0-1.0)
uniform vec2 u_texelSize;

out vec4 fragColor;

${colorSpaceUtils}

// Fast box blur approximation for unsharp mask
vec3 boxBlur(sampler2D tex, vec2 uv, float radius) {
  vec3 sum = vec3(0.0);
  float count = 0.0;

  int r = int(radius);

  for (int y = -r; y <= r; y++) {
    for (int x = -r; x <= r; x++) {
      vec2 offset = vec2(float(x), float(y)) * u_texelSize;
      sum += texture(tex, uv + offset).rgb;
      count += 1.0;
    }
  }

  return sum / count;
}

void main() {
  vec4 color = texture(u_image, v_texCoord);

  if (u_amount < 0.01) {
    // No sharpening
    fragColor = color;
    return;
  }

  // Get blurred version
  vec3 blurred = boxBlur(u_image, v_texCoord, u_radius);

  // Calculate detail (high-pass filter)
  vec3 detail = color.rgb - blurred;

  // Apply threshold to detail (edge-aware sharpening)
  float detailMag = length(detail);
  if (detailMag < u_threshold) {
    detail *= 0.0;  // Suppress noise
  }

  // Add enhanced detail back to original
  vec3 sharpened = color.rgb + detail * u_amount;

  // Clamp and output
  sharpened = clamp(sharpened, 0.0, 1.0);
  fragColor = vec4(sharpened, color.a);
}
`;
