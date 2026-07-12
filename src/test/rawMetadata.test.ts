/**
 * Unit tests for electron/rawMetadata.cjs::parseRawExif — the main-process TIFF/
 * EXIF IFD parser that extracts camera metadata from proprietary RAW containers
 * (Task Q6). exifreader throws "Invalid image format" on these containers, so
 * this hand parser is the reliable source LibRaw's metadata rides on.
 *
 * The headline case parses a REAL Olympus PEN-F ORF fixture
 * (src/test/fixtures/P2060833.header.ORF) end to end — proving the parser works
 * on a genuine proprietary RAW that exifreader cannot touch. The fixture is
 * header-truncated (~2MB: the full TIFF/EXIF IFD region; the raw sensor data is
 * cut) so it can be committed for CI without bloating the repo — every field the
 * tests assert lives in the header, well within the first 1MB. The remaining
 * cases cover the synthetic edge paths (non-TIFF, truncated, big-endian) that
 * the binary fixture can't exercise.
 */
import * as fs from 'fs';
import * as path from 'path';

// Imported via require so ts-jest treats the .cjs as CommonJS.
type RawExif = {
  make?: string;
  model?: string;
  iso?: number;
  exposureTime?: number;
  aperture?: number;
  focalLength?: number;
  dateTime?: string;
  lens?: string;
};
const { parseRawExif, readRawMetadataFile } = require('../../electron/rawMetadata.cjs') as {
  parseRawExif: (buf: Buffer) => RawExif;
  readRawMetadataFile: (filePath: string, prefixBytes?: number) => Promise<RawExif>;
};

const ORF_FIXTURE = path.resolve(__dirname, 'fixtures/P2060833.header.ORF');

describe('parseRawExif — real ORF fixture', () => {
  test('extracts full camera EXIF from the Olympus PEN-F ORF', () => {
    const buf = fs.readFileSync(ORF_FIXTURE);
    const md = parseRawExif(buf);

    expect(md.make).toBe('OLYMPUS CORPORATION');
    expect(md.model).toBe('PEN-F');
    expect(md.iso).toBe(1600);
    // ExposureTime 1/500s.
    expect(md.exposureTime).toBeCloseTo(0.002, 5);
    expect(md.aperture).toBeCloseTo(1.8, 5);
    expect(md.focalLength).toBe(17);
    expect(md.dateTime).toBe('2025:02:06 20:27:48');
    expect(md.lens).toBe('OLYMPUS M.17mm F1.8');
  });
});

describe('parseRawExif — edge cases', () => {
  test('returns {} for a non-TIFF buffer (e.g. a JPEG)', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0, 0, 0, 0, 0]);
    expect(parseRawExif(jpeg)).toEqual({});
  });

  test('returns {} for a too-short buffer', () => {
    expect(parseRawExif(Buffer.from([0x49, 0x49, 0x2a, 0x00]))).toEqual({});
  });

  test('returns {} for an empty/undefined buffer', () => {
    expect(parseRawExif(Buffer.alloc(0))).toEqual({});
    expect(parseRawExif(undefined as unknown as Buffer)).toEqual({});
  });

  test('parses a minimal hand-built little-endian TIFF (Make + Model in IFD0)', () => {
    const buf = buildTinyTiff(true);
    const md = parseRawExif(buf);
    expect(md.make).toBe('ACME');
    expect(md.model).toBe('CAM1');
  });

  test('parses a minimal hand-built big-endian TIFF (Make + Model in IFD0)', () => {
    const buf = buildTinyTiff(false);
    const md = parseRawExif(buf);
    expect(md.make).toBe('ACME');
    expect(md.model).toBe('CAM1');
  });
});

/**
 * Build a minimal, valid TIFF with an IFD0 carrying Make (0x010F) + Model
 * (0x0110) ASCII tags whose values are stored after the IFD. Exercises the
 * endianness + ASCII-pointer path without needing a real RAW binary.
 */
function buildTinyTiff(littleEndian: boolean): Buffer {
  const header = Buffer.alloc(8);
  if (littleEndian) {
    header.write('II', 0, 'ascii');
    header.writeUInt16LE(42, 2);
    header.writeUInt32LE(8, 4); // IFD0 at offset 8
  } else {
    header.write('MM', 0, 'ascii');
    header.writeUInt16BE(42, 2);
    header.writeUInt32BE(8, 4);
  }

  const entryCount = 2;
  const ifdSize = 2 + entryCount * 12 + 4; // count + entries + next-IFD ptr
  const valuesOff = 8 + ifdSize;
  const makeVal = Buffer.from('ACME\0', 'ascii'); // 5 bytes -> pointer (>4)
  const modelVal = Buffer.from('CAM1\0', 'ascii');

  const ifd = Buffer.alloc(ifdSize);
  const w16 = (b: Buffer, o: number, v: number) => (littleEndian ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o));
  const w32 = (b: Buffer, o: number, v: number) => (littleEndian ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o));

  w16(ifd, 0, entryCount);
  // Entry 0: Make
  w16(ifd, 2, 0x010f);
  w16(ifd, 4, 2); // ASCII
  w32(ifd, 6, makeVal.length);
  w32(ifd, 10, valuesOff);
  // Entry 1: Model
  w16(ifd, 14, 0x0110);
  w16(ifd, 16, 2);
  w32(ifd, 18, modelVal.length);
  w32(ifd, 22, valuesOff + makeVal.length);
  w32(ifd, 26, 0); // next IFD = none

  return Buffer.concat([header, ifd, makeVal, modelVal]);
}

/**
 * readRawMetadataFile (Q6 LOW): the read-raw-metadata IPC used to read the WHOLE RAW file
 * (~20-25MB) just to parse a header-local TIFF/EXIF IFD. It now reads a bounded prefix first
 * and falls back to the whole file only if the prefix yields nothing.
 */
describe('readRawMetadataFile — bounded prefix read', () => {
  test('the default 1MB prefix alone (no fallback needed) covers the real ORF header', () => {
    // Proves the PREFIX itself — not the fallback — is what satisfies the common case: parsing
    // just the first 1MB (no fallback whole-file read) already yields every field.
    const full = fs.readFileSync(ORF_FIXTURE);
    const prefixOnly = parseRawExif(full.subarray(0, 1024 * 1024));
    expect(prefixOnly.make).toBe('OLYMPUS CORPORATION');
    expect(prefixOnly.model).toBe('PEN-F');
    expect(prefixOnly.lens).toBe('OLYMPUS M.17mm F1.8');
  });

  test('reads the real ORF fixture end to end and extracts full camera EXIF', async () => {
    const md = await readRawMetadataFile(ORF_FIXTURE);
    expect(md.make).toBe('OLYMPUS CORPORATION');
    expect(md.model).toBe('PEN-F');
    expect(md.iso).toBe(1600);
    expect(md.exposureTime).toBeCloseTo(0.002, 5);
    expect(md.aperture).toBeCloseTo(1.8, 5);
    expect(md.focalLength).toBe(17);
    expect(md.dateTime).toBe('2025:02:06 20:27:48');
    expect(md.lens).toBe('OLYMPUS M.17mm F1.8');
  });

  test('a too-small prefix alone finds nothing, but the whole-file fallback recovers it', async () => {
    // A 16-byte prefix cannot possibly reach IFD0's entries (bounds-checked -> {}) — this
    // isolates the synthetic fallback path: readRawMetadataFile must retry against the whole
    // file rather than returning the prefix's empty result.
    const full = fs.readFileSync(ORF_FIXTURE);
    expect(parseRawExif(full.subarray(0, 16))).toEqual({});

    const md = await readRawMetadataFile(ORF_FIXTURE, 16);
    expect(md.make).toBe('OLYMPUS CORPORATION');
    expect(md.model).toBe('PEN-F');
    expect(md.lens).toBe('OLYMPUS M.17mm F1.8');
  });

  test('rejects for a non-existent file (the IPC handler catches this and returns null)', async () => {
    await expect(readRawMetadataFile(path.resolve(__dirname, 'does-not-exist.orf'))).rejects.toThrow();
  });
});
