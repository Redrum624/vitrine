/**
 * @jest-environment node
 */
/**
 * ORF display regressions in the main-process RAW chain (electron/rawDecoder.cjs +
 * electron/librawWasmNode.cjs), pinned on the real Olympus PEN-F header fixture:
 *
 *  1. The embedded-JPEG last resort ignored the ORF container's orientation (ORF previews carry
 *     none of their own), so a portrait ORF opened upright from the progressive preview and then
 *     turned sideways when the "full" decode swapped in. It also stretched the 4:3 preview to the
 *     IFD0 sensor size (which includes margins) with `fit: 'fill'`.
 *  2. A source checkout lacked libraw.js/libraw.wasm next to public/libraw/worker.js; the wasm
 *     rung aborted inside its worker and every open waited out the 60s watchdog. The resolver now
 *     requires the complete runtime (fail fast), and scripts/sync-libraw-wasm.cjs copies it in.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type Decoded = { data: ArrayBuffer; width: number; height: number; channels: number; bitDepth: number };
const { decodeEmbeddedJpeg, decodeEmbeddedPreview } = require('../../electron/rawDecoder.cjs') as {
  decodeEmbeddedJpeg: (p: string, log: unknown) => Promise<Decoded>;
  decodeEmbeddedPreview: (p: string, maxDim: number, log: unknown) => Promise<Decoded>;
};
const { resolveWorkerJs } = require('../../electron/librawWasmNode.cjs') as {
  resolveWorkerJs: (candidates?: string[]) => string | null;
};
const { syncRuntime } = require('../../scripts/sync-libraw-wasm.cjs') as {
  syncRuntime: (src: string, dest: string) => { copied: string[]; upToDate: string[]; missingSource: string[] };
};

const FIXTURE = path.join(__dirname, 'fixtures', 'P2060833.header.ORF');
const quiet = { log: () => {}, warn: () => {}, error: () => {} };
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orf-fallback-test-'));

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

/** Copy the fixture with its IFD0 Orientation (tag 274) patched to `orientation`. */
function orfWithOrientation(orientation: number): string {
  const buf = Buffer.from(fs.readFileSync(FIXTURE));
  const le = buf[0] === 0x49;
  const r16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const ifd0 = le ? buf.readUInt32LE(4) : buf.readUInt32BE(4);
  const count = r16(ifd0);
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (r16(entry) === 274) {
      if (le) buf.writeUInt16LE(orientation, entry + 8);
      else buf.writeUInt16BE(orientation, entry + 8);
    }
  }
  const out = path.join(tmpDir, `ori${orientation}.ORF`);
  fs.writeFileSync(out, buf);
  return out;
}

describe('embedded-JPEG fallback decode for ORF', () => {
  it('keeps a landscape ORF landscape and preserves the 4:3 preview aspect', async () => {
    const r = await decodeEmbeddedJpeg(orfWithOrientation(1), quiet);
    // 3200×2400 preview upscaled to fit the 5200×3904 sensor box → 5200×3900 (no stretch).
    expect([r.width, r.height]).toEqual([5200, 3900]);
    expect(r.channels).toBe(3);
    expect(r.data.byteLength).toBe(r.width * r.height * 3);
  }, 30000);

  it.each([6, 8])('turns a portrait ORF (orientation %i) upright, matching the progressive preview', async (ori) => {
    const file = orfWithOrientation(ori);
    const preview = await decodeEmbeddedPreview(file, 512, quiet);
    const full = await decodeEmbeddedJpeg(file, quiet);
    expect(preview.height).toBeGreaterThan(preview.width);
    expect([full.width, full.height]).toEqual([3900, 5200]);
  }, 30000);
});

describe('libraw-wasm runtime resolution', () => {
  const makeDir = (name: string, files: string[]) => {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(dir, f), f);
    return dir;
  };

  it('skips a directory that has worker.js but not the runtime it loads', () => {
    const partial = makeDir('partial', ['worker.js']);
    expect(resolveWorkerJs([partial])).toBeNull();
  });

  it('resolves the first directory with the complete runtime', () => {
    const partial = makeDir('partial2', ['worker.js', 'libraw.js']);
    const complete = makeDir('complete', ['worker.js', 'libraw.js', 'libraw.wasm']);
    expect(resolveWorkerJs([partial, complete])).toBe(path.join(complete, 'worker.js'));
  });

  it('sync script copies a missing runtime once, then leaves it alone', () => {
    const src = makeDir('pkg-dist', ['libraw.js', 'libraw.wasm']);
    const dest = makeDir('public-libraw', ['worker.js']);
    expect(syncRuntime(src, dest).copied).toEqual(['libraw.js', 'libraw.wasm']);
    expect(syncRuntime(src, dest)).toMatchObject({ copied: [], upToDate: ['libraw.js', 'libraw.wasm'] });
    expect(resolveWorkerJs([dest])).toBe(path.join(dest, 'worker.js'));
  });
});
