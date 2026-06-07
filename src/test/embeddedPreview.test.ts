// Tests the Electron-side embedded-JPEG boundary parser used for RAW thumbnails.
const { jpegEnd, findEmbeddedJpegs, rawDataStart } = require('../../electron/embeddedPreview.cjs') as {
  jpegEnd: (buf: Buffer, start: number) => number;
  findEmbeddedJpegs: (buf: Buffer) => { offset: number; length: number }[];
  rawDataStart: (buf: Buffer) => number;
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
});
