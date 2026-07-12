// Tests the Electron-side XMP rating round-trip helpers (write packet ↔ read back).
// The bug was that ratings were WRITTEN to the file but never READ back on load, so they
// vanished on restart. parseXmpRating is the read-back parser that closes that loop.
const { buildXmpPacket, parseXmpRating } = require('../../electron/imageWriter.cjs') as {
  buildXmpPacket: (xmp: { rating?: number }) => string;
  parseXmpRating: (xmp: Buffer | string | null | undefined) => number | null;
};

describe('parseXmpRating', () => {
  it('round-trips a rating through the packet we write', () => {
    for (let r = 0; r <= 5; r++) {
      expect(parseXmpRating(buildXmpPacket({ rating: r }))).toBe(r);
    }
  });

  it('reads the element form <xmp:Rating>N</xmp:Rating>', () => {
    expect(parseXmpRating('<xmp:Rating>4</xmp:Rating>')).toBe(4);
    expect(parseXmpRating('<xmp:Rating> 3 </xmp:Rating>')).toBe(3);
  });

  it('reads the attribute form xmp:Rating="N" used by Lightroom/Bridge', () => {
    expect(parseXmpRating('<rdf:Description xmp:Rating="5" />')).toBe(5);
    expect(parseXmpRating("xmp:Rating='2'")).toBe(2);
  });

  it('accepts a Buffer (as sharp returns embedded XMP)', () => {
    expect(parseXmpRating(Buffer.from('<xmp:Rating>1</xmp:Rating>', 'utf8'))).toBe(1);
  });

  it('returns null when there is no rating / invalid input', () => {
    expect(parseXmpRating(null)).toBeNull();
    expect(parseXmpRating(undefined)).toBeNull();
    expect(parseXmpRating('')).toBeNull();
    expect(parseXmpRating('<dc:subject>foo</dc:subject>')).toBeNull();
    expect(parseXmpRating('<xmp:Rating>9</xmp:Rating>')).toBeNull(); // out of 0-5 range
  });
});
