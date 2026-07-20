/**
 * W5 R1 (chain-audit F3): AI super-resolution availability must be DirectML-gated, mirroring
 * aiDeblur.cjs. Before this, aiUpscaler.cjs created the session with ['dml','cpu'] and classified
 * the backend by a timing probe — when the session silently landed on the CPU EP it STILL reported
 * available, auto-routing a 20MP ×2 upscale into ~2,000 tiles at ~2s each (>1h, uncancellable)
 * while the UI claimed AI-on-GPU. The gate is by CONSTRUCTION: create with ['dml'] ONLY first
 * (ORT throws at init when the DirectML EP can't bind), and report available ONLY when the session
 * bound to DirectML — a CPU-EP session exists for diagnostics but the feature is not offered, so
 * the router falls back to the deterministic Lanczos path (router side covered by
 * enhanceAiRouting.test.ts — "uses the deterministic worker when AI is unavailable").
 *
 * Imported via require so ts-jest treats it as CommonJS; requiring the module loads only path+fs
 * (onnxruntime-node is required lazily inside ensureSession, never reached here).
 */
export {}; // module scope — aiDeblurPlanner.test.ts is import-free (a global script), so a bare
           // top-level `const mod` here would collide with its own in the project-wide tsc pass.

type FakeSession = { ep: string };
type CreateFn = (modelPath: string, opts: { executionProviders: string[] }) => Promise<FakeSession>;

const mod = require('../../electron/aiUpscaler.cjs') as {
  createSessionByConstruction: (
    create: CreateFn,
    modelPath: string,
  ) => Promise<{ session: FakeSession | null; backend: 'directml' | 'cpu' | null }>;
  availableFor: (session: unknown, backend: string | null) => boolean;
};

describe('aiUpscaler — DirectML-gated availability (W5 R1)', () => {
  it('DML session creation succeeds → backend=directml → AVAILABLE', async () => {
    const create: jest.MockedFunction<CreateFn> = jest.fn(async (_p, opts) => {
      if (!opts.executionProviders.includes('dml')) throw new Error('unexpected EP list');
      return { ep: 'dml' };
    });
    const r = await mod.createSessionByConstruction(create, 'model.onnx');
    expect(r.backend).toBe('directml');
    // DML must be requested ALONE — a ['dml','cpu'] list lets ORT silently fall through to CPU.
    expect(create.mock.calls[0][1].executionProviders).toEqual(['dml']);
    expect(mod.availableFor(r.session, r.backend)).toBe(true);
  });

  it('DML init throws, CPU succeeds → backend=cpu → UNAVAILABLE (the >1h CPU tile path is never offered)', async () => {
    const create: jest.MockedFunction<CreateFn> = jest.fn(async (_p, opts) => {
      if (opts.executionProviders.includes('dml')) throw new Error('no DirectML device');
      return { ep: 'cpu' };
    });
    const r = await mod.createSessionByConstruction(create, 'model.onnx');
    expect(r.session).toEqual({ ep: 'cpu' }); // session exists (diagnostics)…
    expect(r.backend).toBe('cpu');
    expect(mod.availableFor(r.session, r.backend)).toBe(false); // …but the feature is NOT offered
    // Construction order: ['dml'] alone first, ['cpu'] alone only after the DML init failed.
    expect(create.mock.calls.map((c) => c[1].executionProviders)).toEqual([['dml'], ['cpu']]);
  });

  it('both EP inits throw → no session → unavailable', async () => {
    const create: jest.MockedFunction<CreateFn> = jest.fn(
      async (_p: string, _o: { executionProviders: string[] }) => { throw new Error('ORT broken'); },
    );
    const r = await mod.createSessionByConstruction(create, 'model.onnx');
    expect(r.session).toBeNull();
    expect(r.backend).toBeNull();
    expect(mod.availableFor(r.session, r.backend)).toBe(false);
  });

  it('availableFor is a hard AND: session alone or directml alone is not enough', () => {
    expect(mod.availableFor(null, 'directml')).toBe(false);
    expect(mod.availableFor({ ep: 'dml' }, 'cpu')).toBe(false);
    expect(mod.availableFor({ ep: 'dml' }, null)).toBe(false);
    expect(mod.availableFor({ ep: 'dml' }, 'directml')).toBe(true);
  });
});
