// Tests the Electron-side embedded-JPEG boundary parser used for RAW thumbnails.
const { jpegEnd, findEmbeddedJpegs, rawDataStart, readOrientation } = require('../../electron/embeddedPreview.cjs') as {
  jpegEnd: (buf: Buffer, start: number) => number;
  findEmbeddedJpegs: (buf: Buffer) => { offset: number; length: number }[];
  rawDataStart: (buf: Buffer) => number;
  readOrientation: (buf: Buffer) => number;
};

// A JPEG whose DQT segment DATA contains a false FF D9, and whose entropy stream uses
// FF 00 stuffing — exactly what makes a naive indexOf(FF D9) scan truncate the image.
const makeJpeg = (): Buffer => Buffer.concat([
  Buffer.from([0xFF, 0xD8]),                                    // SOI
  Buffer.from([0xFF, 0xDB, 0x00, 0x06, 0xFF, 0xD9, 0xAA, 0xBB]), // DQT len=6, data holds a false FF D9
  Buffer.from([0xFF, 0xDA, 0x00, 0x04, 0x01, 0x02]),            // SOS len=4
  Buffer.alloc(1100, 0x11),                                     // entropy (no real markers)
  Buffer.from([0xFF, 0x00]),                                    // stuffed FF
  Buffer.from([0xFF, 0xD9]),                                    // real EOI
]);

describe('embeddedPreview JPEG boundary parser', () => {
  it('jpegEnd returns the REAL EOI, skipping a false FF D9 inside segment data', () => {
    const jpeg = makeJpeg();
    expect(jpegEnd(jpeg, 0)).toBe(jpeg.length);
  });

  it('jpegEnd rejects a non-JPEG / garbage start', () => {
    const garbage = Buffer.from([0xFF, 0xD8, 0x12, 0x34, 0x56, 0x78]);
    expect(jpegEnd(garbage, 0)).toBe(-1);
  });

  it('findEmbeddedJpegs bounds the embedded JPEG amid surrounding bytes + a stray SOI', () => {
    const jpeg = makeJpeg();
    const buf = Buffer.concat([
      Buffer.from([0, 0, 0]),       // leading padding
      jpeg,                         // the real preview
      Buffer.from([0xFF, 0xD8, 0xFF, 0x00]), // a stray SOI that is NOT a valid JPEG
    ]);
    const found = findEmbeddedJpegs(buf);
    expect(found.length).toBe(1);
    expect(found[0].offset).toBe(3);
    expect(found[0].length).toBe(jpeg.length);
  });

  it('findEmbeddedJpegs returns the largest of multiple embedded JPEGs first', () => {
    const small = Buffer.concat([
      Buffer.from([0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x02]),
      Buffer.alloc(1050, 0x22),
      Buffer.from([0xFF, 0xD9]),
    ]);
    const big = makeJpeg();
    const buf = Buffer.concat([small, big]);
    const found = findEmbeddedJpegs(buf);
    expect(found.length).toBe(2);
    expect(found[0].length).toBe(big.length); // largest first
  });

  it('rawDataStart reads the uncompressed strip offset from a tiny TIFF header', () => {
    // Little-endian TIFF: II, magic 42, IFD0 @8; one IFD with Compression=1 + StripOffsets=2048.
    const b = Buffer.alloc(64, 0);
    b.write('II', 0, 'ascii');
    b.writeUInt16LE(42, 2);
    b.writeUInt32LE(8, 4);
    b.writeUInt16LE(2, 8); // 2 entries
    // entry 0: Compression (0x0103) SHORT count1 = 1
    b.writeUInt16LE(0x0103, 10); b.writeUInt16LE(3, 12); b.writeUInt32LE(1, 14); b.writeUInt16LE(1, 18);
    // entry 1: StripOffsets (0x0111) LONG count1 = 2048
    b.writeUInt16LE(0x0111, 22); b.writeUInt16LE(4, 24); b.writeUInt32LE(1, 26); b.writeUInt32LE(2048, 30);
    expect(rawDataStart(b)).toBe(2048);
  });

  it('readOrientation reads IFD0 Orientation (0x0112) from a little-endian header', () => {
    const b = Buffer.alloc(64, 0);
    b.write('II', 0, 'ascii');
    b.writeUInt16LE(42, 2);
    b.writeUInt32LE(8, 4);
    b.writeUInt16LE(1, 8); // 1 entry
    // Orientation (0x0112) SHORT count1 = 6 (rotate 90 CW)
    b.writeUInt16LE(0x0112, 10); b.writeUInt16LE(3, 12); b.writeUInt32LE(1, 14); b.writeUInt16LE(6, 18);
    expect(readOrientation(b)).toBe(6);
  });

  it('readOrientation reads a big-endian (MM) Orientation', () => {
    const b = Buffer.alloc(64, 0);
    b.write('MM', 0, 'ascii');
    b.writeUInt16BE(42, 2);
    b.writeUInt32BE(8, 4);
    b.writeUInt16BE(1, 8);
    b.writeUInt16BE(0x0112, 10); b.writeUInt16BE(3, 12); b.writeUInt32BE(1, 14); b.writeUInt16BE(8, 18);
    expect(readOrientation(b)).toBe(8);
  });

  it('readOrientation defaults to 1 when the tag is absent or unparseable', () => {
    const noTag = Buffer.alloc(64, 0);
    noTag.write('II', 0, 'ascii'); noTag.writeUInt16LE(42, 2); noTag.writeUInt32LE(8, 4);
    noTag.writeUInt16LE(1, 8);
    noTag.writeUInt16LE(0x0103, 10); noTag.writeUInt16LE(3, 12); noTag.writeUInt32LE(1, 14); noTag.writeUInt16LE(1, 18);
    expect(readOrientation(noTag)).toBe(1);
    expect(readOrientation(Buffer.from([0x00, 0x01]))).toBe(1); // too small
    expect(readOrientation(Buffer.from('XX0000000000', 'ascii'))).toBe(1); // bad byte order
  });
});
