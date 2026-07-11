/**
 * Render-cache hash for the main Canvas draw path (extracted from Canvas.tsx so it is
 * unit-testable in isolation). The hash embeds the image path, dimensions, byte length
 * and a sparse sampling of pixel values so a changed image with identical dimensions
 * never collides with a cached ImageData.
 *
 * BUG (sub-40px infinite loop): the center-area sampling stepped by
 * `Math.floor(centerRange / 10)` where `centerRange = min(w, h) / 4`. For any image with
 * `min(w, h) < 40` that step evaluates to 0, so `dy += 0` / `dx += 0` never advances and
 * the loops spin forever (a 16×16 image → centerRange 4 → floor(0.4) = 0). The step is
 * now clamped to >= 1 so tiny images terminate; images >= 40px are unaffected (their step
 * was already >= 1).
 */
export function computeRenderCacheHash(
  imagePath: string,
  width: number,
  height: number,
  data: ArrayLike<number>,
): string {
  let dataHash = `${imagePath}_${width}x${height}_${data.length}`;

  if (data.length > 0) {
    const sampleIndices: number[] = [];
    const totalPixels = data.length / 4;
    const sampleCount = Math.min(100, Math.max(50, Math.floor(totalPixels / 100))); // 50–100 pixels

    // Strategy 1: systematic sampling across the whole image.
    for (let i = 0; i < sampleCount; i++) {
      const pixelIndex = Math.floor((i * totalPixels) / sampleCount);
      const pixelStart = pixelIndex * 4;
      if (pixelStart + 2 < data.length) {
        sampleIndices.push(pixelStart, pixelStart + 1, pixelStart + 2);
      }
    }

    // Strategy 2: sample the center area where content is most likely.
    const centerY = Math.floor(height / 2);
    const centerX = Math.floor(width / 2);
    const centerRange = Math.min(width, height) / 4;
    // Clamp step >= 1 — sub-40px images produced a 0 step and looped forever.
    const step = Math.max(1, Math.floor(centerRange / 10));
    for (let dy = -centerRange; dy <= centerRange; dy += step) {
      for (let dx = -centerRange; dx <= centerRange; dx += step) {
        const y = centerY + dy;
        const x = centerX + dx;
        if (y >= 0 && y < height && x >= 0 && x < width) {
          const pixelStart = (y * width + x) * 4;
          if (pixelStart + 2 < data.length) {
            sampleIndices.push(pixelStart, pixelStart + 1, pixelStart + 2);
          }
        }
      }
    }

    const samples = sampleIndices.map((i) => (data[i] ? data[i].toFixed(4) : '0')).join(',');
    dataHash += `_${samples}`;
  }

  return dataHash;
}
