/**
 * Regression tests for the main-process image writer (electron/imageWriter.cjs).
 *
 * Headline bug ("the file saving saves badly the pictures"): the 16-bit export
 * path produced a Uint16Array but the writer handed it to sharp as 8-bit raw
 * (no depth hint), so every 16-bit PNG/TIFF came out garbled/byte-split.
 * These tests pin the corrected behaviour:
 *   - 8-bit round-trips pixel-exact
 *   - 16-bit round-trips correctly AND yields a true 16-bit file (depth 'ushort')
 *   - a buffer/size mismatch THROWS instead of silently writing a corrupt file
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { writeImageFile, buildXmpPacket } = require('../../electron/imageWriter.cjs');
const sharp = require('sharp');
const exifreader = require('exifreader');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-export-test-'));

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function packRgba(pixels: number[][], TypedArray: typeof Uint8Array | typeof Uint16Array): ArrayBuffer {
  const arr = new TypedArray(pixels.length * 4);
  pixels.forEach((p, i) => {
    arr[i * 4] = p[0]; arr[i * 4 + 1] = p[1]; arr[i * 4 + 2] = p[2]; arr[i * 4 + 3] = p[3];
  });
  return arr.buffer;
}

/** Read a channel value from a sharp raw buffer, normalised to 0..1 regardless of bit depth. */
function makeReader(data: Buffer, info: { width: number; height: number; channels: number }) {
  // Derive bytes-per-sample from the buffer length (raw output omits `depth`).
  const samples = info.width * info.height * info.channels;
  const bps = Math.round(data.length / samples); // 1 = uchar, 2 = ushort
  const max = bps === 2 ? 65535 : 255;
  return (pxIndex: number, ch: number): number => {
    const off = (pxIndex * info.channels + ch) * bps;
    const raw = bps === 2 ? data.readUInt16LE(off) : data[off];
    return raw / max;
  };
}

describe('imageWriter.writeImageFile', () => {
  // 2x2: red, green, blue, white — all opaque
  const corners8 = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]];
  const corners16 = [[65535, 0, 0, 65535], [0, 65535, 0, 65535], [0, 0, 65535, 65535], [65535, 65535, 65535, 65535]];

  test('8-bit PNG round-trips pixel-exact', async () => {
    const out = path.join(tmpDir, '8bit.png');
    await writeImageFile(out, packRgba(corners8, Uint8Array), 'png', { width: 2, height: 2, channels: 4, bitDepth: 8 });

    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(2);
    expect(info.height).toBe(2);
    const read = makeReader(data, info);
    expect(read(0, 0)).toBeCloseTo(1, 2); // pixel 0 = red
    expect(read(0, 1)).toBeCloseTo(0, 2);
    expect(read(2, 2)).toBeCloseTo(1, 2); // pixel 2 = blue
    expect(read(3, 0)).toBeCloseTo(1, 2); // pixel 3 = white
  });

  test('16-bit PNG round-trips correctly and is a true 16-bit file (regression RC-1)', async () => {
    const out = path.join(tmpDir, '16bit.png');
    await writeImageFile(out, packRgba(corners16, Uint16Array), 'png', { width: 2, height: 2, channels: 4, bitDepth: 16 });

    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(2);
    expect(meta.height).toBe(2);
    // The bug wrote an 8-bit ('uchar') garbled file; a correct 16-bit export is 'ushort'.
    expect(meta.depth).toBe('ushort');

    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const read = makeReader(data, info);
    expect(read(0, 0)).toBeCloseTo(1, 2); // red
    expect(read(0, 1)).toBeCloseTo(0, 2);
    expect(read(2, 2)).toBeCloseTo(1, 2); // blue
    expect(read(3, 0)).toBeCloseTo(1, 2); // white
  });

  test('16-bit data exported to an 8-bit format (JPEG) keeps tonality — no gamma double-encode (regression RC-2)', async () => {
    // Default export bitDepth is 16; JPEG must output 8-bit. The writer used to hand
    // sharp the ushort buffer, which sharp treated as linear and re-gamma'd on the
    // 8-bit downconvert → dark/desaturated. Mid-grey must round-trip near 0.5, not
    // ~0.73 (encode) or ~0.21 (decode).
    const out = path.join(tmpDir, 'gray16.jpg');
    const mid = Math.round(0.5 * 65535);
    const gray = [[mid, mid, mid, 65535], [mid, mid, mid, 65535], [mid, mid, mid, 65535], [mid, mid, mid, 65535]];
    await writeImageFile(out, packRgba(gray, Uint16Array), 'jpeg', { width: 2, height: 2, channels: 4, bitDepth: 16 });

    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const read = makeReader(data, info);
    expect(read(0, 0)).toBeCloseTo(0.5, 1); // within 0.05
    expect(read(0, 1)).toBeCloseTo(0.5, 1);
    expect(read(0, 2)).toBeCloseTo(0.5, 1);
  });

  test('resizes via sharp in the writer (8-bit) — written file has the target dims and sane pixels', async () => {
    // 4x4 solid mid-grey, downscaled to 2x2. The resize now happens inside the
    // writer (sharp lanczos3) instead of a renderer-side bicubic loop. We assert
    // the file is the REQUESTED size and not byte-garbled (a flat input must stay
    // flat grey after a downscale).
    const w = 4, h = 4;
    const px = [];
    for (let i = 0; i < w * h; i++) px.push([128, 128, 128, 255]);
    const out = path.join(tmpDir, 'resize8.png');

    await writeImageFile(out, packRgba(px, Uint8Array), 'png', {
      width: w, height: h, channels: 4, bitDepth: 8,
      targetWidth: 2, targetHeight: 2, targetFit: 'fill'
    });

    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(2);
    expect(info.height).toBe(2);
    const read = makeReader(data, info);
    // Flat grey in → flat grey out (~0.5), every channel, no garbling.
    for (let p = 0; p < 4; p++) {
      expect(read(p, 0)).toBeCloseTo(128 / 255, 1);
      expect(read(p, 1)).toBeCloseTo(128 / 255, 1);
      expect(read(p, 2)).toBeCloseTo(128 / 255, 1);
    }
  });

  test('resizes via sharp in the writer (16-bit) — stays a true ushort file with sane pixels (regression RC-3)', async () => {
    // A 16-bit resize must keep the ushort working space all the way through encode
    // (resize on ushort raw → toColourspace('rgb16') → 16-bit PNG). A regression
    // here would either downconvert to 8-bit or garble the bytes.
    const w = 4, h = 4;
    const mid = Math.round(0.5 * 65535);
    const px = [];
    for (let i = 0; i < w * h; i++) px.push([mid, mid, mid, 65535]);
    const out = path.join(tmpDir, 'resize16.png');

    await writeImageFile(out, packRgba(px, Uint16Array), 'png', {
      width: w, height: h, channels: 4, bitDepth: 16,
      targetWidth: 2, targetHeight: 2, targetFit: 'fill'
    });

    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(2);
    expect(meta.height).toBe(2);
    expect(meta.depth).toBe('ushort'); // still a real 16-bit file after resize

    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const read = makeReader(data, info);
    for (let p = 0; p < 4; p++) {
      expect(read(p, 0)).toBeCloseTo(0.5, 1);
      expect(read(p, 1)).toBeCloseTo(0.5, 1);
      expect(read(p, 2)).toBeCloseTo(0.5, 1);
    }
  });

  test('writer-side resize still validates the INCOMING buffer size (mismatch throws)', async () => {
    // The size check guards the full-res input buffer, not the target. A buffer
    // that does not match width/height must still throw before any resize.
    const out = path.join(tmpDir, 'resize-bad.png');
    const px = [[0, 0, 0, 255]]; // 1 px
    await expect(
      writeImageFile(out, packRgba(px, Uint8Array), 'png', {
        width: 4, height: 4, channels: 4, bitDepth: 8,
        targetWidth: 2, targetHeight: 2
      })
    ).rejects.toThrow(/mismatch/i);
  });

  test('throws on buffer/size mismatch instead of writing a corrupt file', async () => {
    const out = path.join(tmpDir, 'bad.png');
    // Claim 4x4 (16 px) but only supply 4 px worth of bytes.
    await expect(
      writeImageFile(out, packRgba(corners8, Uint8Array), 'png', { width: 4, height: 4, channels: 4, bitDepth: 8 })
    ).rejects.toThrow(/mismatch/i);
  });

  test('TIFF "zip" compression maps to sharp\'s deflate instead of throwing (regression)', async () => {
    // The UI/estimator call this option 'zip', but sharp 0.34 only accepts
    // 'deflate' for libtiff compression — passing 'zip' straight through used
    // to throw (`Expected one of: none, jpeg, deflate, ...`) and fail every
    // ZIP-compression TIFF export. A big flat-colour image compresses hard
    // under real deflate, so comparing against an uncompressed control proves
    // deflate actually ran (not just that 'zip' was silently ignored).
    const w = 64, h = 64;
    const px: number[][] = [];
    for (let i = 0; i < w * h; i++) px.push([255, 0, 0, 255]); // flat red — highly compressible
    const zipOut = path.join(tmpDir, 'zip.tiff');
    const noneOut = path.join(tmpDir, 'none.tiff');

    await expect(
      writeImageFile(zipOut, packRgba(px, Uint8Array), 'tiff', {
        width: w, height: h, channels: 4, bitDepth: 8, compression: 'zip'
      })
    ).resolves.toBe(true);
    await writeImageFile(noneOut, packRgba(px, Uint8Array), 'tiff', {
      width: w, height: h, channels: 4, bitDepth: 8, compression: 'none'
    });

    expect(fs.statSync(zipOut).size).toBeLessThan(fs.statSync(noneOut).size);

    const { data, info } = await sharp(zipOut).raw().toBuffer({ resolveWithObject: true });
    const read = makeReader(data, info);
    expect(read(0, 0)).toBeCloseTo(1, 2); // red channel
    expect(read(0, 1)).toBeCloseTo(0, 2); // green channel
  });
});

describe('imageWriter metadata embedding', () => {
  const corners8 = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]];
  const corners16 = [[65535, 0, 0, 65535], [0, 65535, 0, 65535], [0, 0, 65535, 65535], [65535, 65535, 65535, 65535]];

  test('embeds EXIF Copyright/Artist + XMP rights/creator/subject into a JPEG', async () => {
    const out = path.join(tmpDir, 'meta.jpg');
    await writeImageFile(out, packRgba(corners8, Uint8Array), 'jpeg', {
      width: 2, height: 2, channels: 4, bitDepth: 8,
      metadata: {
        exif: { Copyright: '(c) 2026 X', Artist: 'Jane' },
        xmp: { rights: '(c) 2026 X', creator: ['Jane'], subject: ['a', 'b'] }
      }
    });

    const tags = exifreader.load(fs.readFileSync(out), { expanded: true });
    expect(tags.exif?.Copyright?.description).toBe('(c) 2026 X');
    expect(tags.exif?.Artist?.description).toBe('Jane');
    expect(tags.xmp?.rights?.description).toBe('(c) 2026 X');
    // dc:subject is a Bag; exifreader exposes it as the 'subject' XMP tag.
    const subject = tags.xmp?.subject;
    const subjectValues = Array.isArray(subject?.value)
      ? subject.value.map((v: { value?: string }) => v.value)
      : [subject?.description];
    expect(subjectValues).toContain('a');
    expect(subjectValues).toContain('b');
  });

  test('embeds metadata in a 16-bit PNG without corrupting pixels', async () => {
    const out = path.join(tmpDir, 'meta16.png');
    await writeImageFile(out, packRgba(corners16, Uint16Array), 'png', {
      width: 2, height: 2, channels: 4, bitDepth: 16,
      metadata: {
        exif: { Copyright: '(c) 2026 16bit', Artist: 'Bob' },
        xmp: { rights: '(c) 2026 16bit', creator: ['Bob'] }
      }
    });

    // Still a true 16-bit file with intact pixels.
    const meta = await sharp(out).metadata();
    expect(meta.depth).toBe('ushort');
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const read = makeReader(data, info);
    expect(read(0, 0)).toBeCloseTo(1, 2); // red
    expect(read(0, 1)).toBeCloseTo(0, 2);
    expect(read(2, 2)).toBeCloseTo(1, 2); // blue
    expect(read(3, 0)).toBeCloseTo(1, 2); // white

    // EXIF round-trips through PNG via the app's exifreader-based reader.
    const tags = exifreader.load(fs.readFileSync(out), { expanded: true });
    expect(tags.exif?.Copyright?.description).toBe('(c) 2026 16bit');
    expect(tags.exif?.Artist?.description).toBe('Bob');
    // The XMP packet survives in the file (verified via sharp). NOTE: this
    // exifreader version does not surface XMP from PNG iTXt chunks (it does for
    // JPEG), so we assert survival via sharp's own metadata, not exifreader.
    expect(meta.xmp).toBeTruthy();
  });

  test('still throws on size mismatch even when metadata is supplied', async () => {
    const out = path.join(tmpDir, 'meta-bad.png');
    await expect(
      writeImageFile(out, packRgba(corners16, Uint16Array), 'png', {
        width: 4, height: 4, channels: 4, bitDepth: 16,
        metadata: { exif: { Copyright: 'x' } }
      })
    ).rejects.toThrow(/mismatch/i);
  });

  test('XML-escapes special characters so the XMP packet stays parseable', async () => {
    const out = path.join(tmpDir, 'meta-escape.jpg');
    const rights = 'Rights & <Stuff> "quoted" \'apos\'';
    await writeImageFile(out, packRgba(corners8, Uint8Array), 'jpeg', {
      width: 2, height: 2, channels: 4, bitDepth: 8,
      metadata: { xmp: { rights } }
    });

    // The raw packet must not contain a bare ampersand or angle bracket from the value.
    const packet = buildXmpPacket({ rights });
    expect(packet).toContain('&amp;');
    expect(packet).toContain('&lt;');
    expect(packet).toContain('&gt;');
    expect(packet).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);

    // exifreader parses the packet back without throwing and decodes the value.
    const tags = exifreader.load(fs.readFileSync(out), { expanded: true });
    expect(tags.xmp?.rights?.description).toBe(rights);
  });
});
