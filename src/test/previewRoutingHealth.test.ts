/**
 * Preview routing × worker health (v1.29). A failed worker-pool initialization
 * must route ≥1MP frames to the MAIN thread — 'worker' would hang on a dead
 * pool. Omitted health keeps the historical behaviour (assumed healthy).
 */
import { choosePreviewPath, WORKER_MIN_PIXELS } from '../services/previewRouting';

const big = { width: 2000, height: 1000 }; // 2MP ≥ WORKER_MIN_PIXELS
const base = { gpuAvailable: false, activeCpuBridgeCount: 1, passCount: 3 };

describe('choosePreviewPath worker health', () => {
  test('healthy workers take ≥1MP frames', () => {
    expect(choosePreviewPath({ ...base, ...big, workersHealthy: true })).toBe('worker');
  });

  test('unhealthy workers push ≥1MP frames to main', () => {
    expect(choosePreviewPath({ ...base, ...big, workersHealthy: false })).toBe('main');
  });

  test('omitted health preserves the old behaviour', () => {
    expect(choosePreviewPath({ ...base, ...big })).toBe('worker');
  });

  test('below the pixel floor stays on main regardless of health', () => {
    expect(WORKER_MIN_PIXELS).toBe(1_000_000);
    expect(choosePreviewPath({ ...base, width: 800, height: 600, workersHealthy: true })).toBe('main');
  });

  test('GPU wins over workers when eligible', () => {
    expect(choosePreviewPath({
      gpuAvailable: true, activeCpuBridgeCount: 0, passCount: 3, ...big, workersHealthy: true,
    })).toBe('gpu');
  });
});
