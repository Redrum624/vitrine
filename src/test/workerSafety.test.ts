/**
 * @jest-environment node
 *
 * Worker-safety regression (v1.29). The pipeline worker imports the REAL
 * ImageProcessingPipeline, which transitively imports the Logger singleton —
 * an unguarded `window` reference there crashed the whole worker bundle at
 * module evaluation ("window is not defined"), so every ≥1MP CPU preview pass
 * hung through 30s dead-worker timeouts (the stuck "Applying…" spinner).
 *
 * This test runs in a NODE environment (no `window`, like a worker scope) and
 * asserts the worker's import graph evaluates and processes an image.
 */

import * as fs from 'fs';
import * as path from 'path';

describe('pipeline worker import graph is window-free', () => {
  test('Logger singleton constructs without window', () => {
    expect(typeof window).toBe('undefined');
    expect(() => {
      const { logger } = require('../utils/Logger');
      logger.info('worker-safety probe');
    }).not.toThrow();
  });

  test('ImageProcessingPipeline constructs and processes without window', () => {
    const { ImageProcessingPipeline } = require('../services/ImageProcessingPipeline');
    const pipeline = new ImageProcessingPipeline();
    const W = 8;
    const H = 8;
    const data = new Float32Array(W * H * 4).fill(0.5);
    const context = { width: W, height: H, channels: 4 };
    // useWebWorkers=false: the exact configuration pipeline.worker.ts runs with.
    return expect(
      pipeline.processImage(data, context, { useWebWorkers: false }),
    ).resolves.toBeInstanceOf(Float32Array);
  });

  test('pipeline worker ENTRY evaluates and answers INITIALIZE without window', async () => {
    // The v1.29 tests above import the worker's DEPENDENCIES; this imports the
    // worker entry itself (with a minimal DedicatedWorkerGlobalScope shim), so a
    // future window/localStorage touch anywhere in the ENTRY file is caught too.
    expect(typeof window).toBe('undefined');
    const posted: unknown[] = [];
    let onMessage: ((event: { data: unknown }) => Promise<void>) | undefined;
    const g = globalThis as { self?: unknown };
    const prevSelf = g.self;
    g.self = {
      addEventListener: (type: string, cb: (event: { data: unknown }) => Promise<void>) => {
        if (type === 'message') onMessage = cb;
      },
      postMessage: (msg: unknown) => { posted.push(msg); },
    };
    try {
      expect(() => require('../workers/pipeline.worker')).not.toThrow();
      expect(onMessage).toBeDefined();
      await onMessage!({ data: { type: 'INITIALIZE', id: 'ws-probe' } });
      expect(posted).toContainEqual({ type: 'INITIALIZE_COMPLETE', id: 'ws-probe', success: true });
    } finally {
      if (prevSelf === undefined) delete g.self; else g.self = prevSelf;
    }
  });
});

describe('packaged worker build contract (2026-07-20 regression lock)', () => {
  // WHY these source-level assertions exist: the v1.29 revival only fixed DEV.
  // In the PACKAGED build the worker stayed dead for two stacked reasons:
  //  1. The `new URL('./pipeline.worker.ts', import.meta.url)` lived in a
  //     DIFFERENT module (pipelineWorkerUrl.ts) from the `new Worker(...)` call,
  //     which defeats Vite's static worker detection — Vite emitted the RAW
  //     TypeScript source as an asset (dist/assets/pipeline.worker-*.ts) and the
  //     packaged app asked Chromium to execute uncompiled TS.
  //  2. Chromium refuses ALL worker scripts from file:// pages (module AND
  //     classic, in or out of app.asar) with an empty-message error event —
  //     verified live on the v1.34.2 exe. Only blob: workers load.
  // The fix: createPipelineWorker.ts imports the COMPILED chunk via
  // `?worker&url` and instantiates it from a blob: URL under file://. Each test
  // below pins one load-bearing piece; jsdom/node cannot exercise the real
  // packaged loader, so the source contract is the regression lock.
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

  test('factory imports the compiled chunk (?worker&url) and blob-instantiates for file://', () => {
    const src = read('../workers/createPipelineWorker.ts');
    expect(src).toMatch(/from\s+'\.\/pipeline\.worker\?worker&url'/);
    expect(src).toMatch(/URL\.createObjectURL/);
  });

  test('the split URL module (raw-asset emission trap) stays deleted', () => {
    expect(fs.existsSync(path.join(__dirname, '../workers/pipelineWorkerUrl.ts'))).toBe(false);
  });

  test('WebWorkerImageProcessor constructs workers only through the factory', () => {
    const src = read('../services/WebWorkerImageProcessor.ts');
    expect(src).not.toMatch(/pipelineWorkerUrl/);
    expect(src).toMatch(/createPipelineWorker/);
  });

  test('worker bundle cannot self-reference: pipeline only type-imports the pool manager', () => {
    // A VALUE import of webWorkerImageProcessor inside ImageProcessingPipeline
    // would pull the pool manager — and its own worker factory — into the worker
    // bundle, making the worker chunk reference itself at build time.
    const src = read('../services/ImageProcessingPipeline.ts');
    expect(src).toMatch(/import\s+type\s+\{[^}]*\}\s+from\s+'\.\/WebWorkerImageProcessor'/);
    expect(src).not.toMatch(/import\s+\{[^}]*webWorkerImageProcessor[^}]*\}/);
  });

  test('vite pins worker.format to iife (blob classic worker needs a self-contained chunk)', () => {
    const src = read('../../vite.config.ts');
    expect(src).toMatch(/worker:\s*\{[^}]*format:\s*'iife'/);
  });
});

describe('packaged ENHANCE worker build contract (W4 — same file:// trap as the pipeline worker)', () => {
  // W1's live probes proved BOTH parts apply to the enhance worker too: its compiled chunk exists
  // (the inline `new URL` pattern did compile it) but Chromium refuses ALL worker scripts on
  // file:// pages — so the packaged enhance worker NEVER booted (Probe B: error event, empty
  // message). Same fix as createPipelineWorker: import the compiled chunk via `?worker&url`,
  // fetch it once under file:, boot from a blob: URL. These pins are the regression lock (jsdom
  // cannot exercise the packaged loader).
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

  test('enhance factory imports the compiled chunk (?worker&url) and blob-instantiates for file://', () => {
    const src = read('../utils/createEnhanceWorker.ts');
    expect(src).toMatch(/from\s+'\.\.\/workers\/enhance\.worker\?worker&url'/);
    expect(src).toMatch(/URL\.createObjectURL/);
    // The import.meta.url pattern (which bypasses the ?worker&url chunk) must never come back.
    expect(src).not.toMatch(/import\.meta\.url/);
  });

  test('EnhanceWorkerClient constructs workers only through the factory', () => {
    const src = read('../services/EnhanceWorkerClient.ts');
    expect(src).toMatch(/createEnhanceWorker/);
    expect(src).not.toMatch(/new\s+Worker\(/);
  });

  test('enhance worker ENTRY evaluates and round-trips ENHANCE + ENHANCE_AI_FINISH without window', () => {
    expect(typeof window).toBe('undefined');
    const posted: Array<{ type: string; id: number; rgba?: Float32Array; enhanced?: Float32Array; error?: string }> = [];
    const g = globalThis as { self?: unknown };
    const prevSelf = g.self;
    const shim: { onmessage?: (e: { data: unknown }) => void; postMessage: (m: unknown) => void } = {
      postMessage: (m: unknown) => { posted.push(m as (typeof posted)[number]); },
    };
    g.self = shim;
    try {
      expect(() => require('../workers/enhance.worker')).not.toThrow();
      expect(typeof shim.onmessage).toBe('function');
      const rgba = new Float32Array(4 * 4 * 4).fill(0.5);
      shim.onmessage!({ data: { type: 'ENHANCE', id: 1, data: { rgba: rgba.slice(), width: 4, height: 4, params: { enabled: true, sharpen: true, upscale: false, scale: 2, denoiseStrength: 0, psfSigma: 1, rlIters: 2, alpha: 0.8, hpSigma: 1.2, sharpness: 0.4, chromaClean: true } } } });
      const enh = posted.find((m) => m.type === 'ENHANCE_COMPLETE' && m.id === 1);
      expect(enh).toBeDefined();
      expect(enh!.enhanced).toBeInstanceOf(Float32Array);
      // W4 R4: the AI finishing pass rides the same worker.
      shim.onmessage!({ data: { type: 'ENHANCE_AI_FINISH', id: 2, data: { rgba: rgba.slice(), width: 4, height: 4, params: { enabled: true, sharpen: true, upscale: false, scale: 2, denoiseStrength: 0, psfSigma: 1, rlIters: 0, alpha: 0, hpSigma: 1.2, sharpness: 0.3, chromaClean: true } } } });
      const fin = posted.find((m) => m.type === 'ENHANCE_AI_FINISH_COMPLETE' && m.id === 2);
      expect(fin).toBeDefined();
      expect(fin!.rgba).toBeInstanceOf(Float32Array);
      expect(fin!.rgba!.length).toBe(4 * 4 * 4);
    } finally {
      if (prevSelf === undefined) delete g.self; else g.self = prevSelf;
    }
  });
});
