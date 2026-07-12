// Locate embedded JPEG previews inside a RAW file (ORF/CR2/NEF/ARW/PEF/...).
//
// Olympus ORF stores the preview JPEG inside the MakerNote, not in a TIFF IFD, so we
// can't rely on JPEGInterchangeFormat tags. Instead we scan for JPEG SOI markers and
// bound each one by PARSING the JPEG marker structure (skip length-prefixed segments,
// walk the SOS entropy stream skipping FF00 stuffing + RST markers) to find the real
// EOI. A naive indexOf(FFD9) finds false markers inside entropy-coded data → truncated
// JPEGs or ranges spanning two images ("Corrupt JPEG / found marker 0xd8 instead of RST").

/**
 * Given `buf[start] == 0xFF && buf[start+1] == 0xD8` (SOI), return the offset just past
 * the matching EOI (FF D9), or -1 if the structure isn't a valid JPEG.
 * @param {Buffer} buf
 * @param {number} start
 * @returns {number} end offset (exclusive), or -1
 */
function jpegEnd(buf, start) {
  const n = buf.length;
  let p = start + 2; // past SOI
  while (p + 1 < n) {
    if (buf[p] !== 0xFF) return -1; // expected a marker here
    let marker = buf[p + 1];
    // Skip fill bytes (FF FF ...).
    while (marker === 0xFF && p + 2 < n) { p++; marker = buf[p + 1]; }
    if (marker === 0xD9) return p + 2;                         // EOI
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { p += 2; continue; } // TEM / RST (no payload)
    if (p + 3 >= n) return -1;
    const segLen = (buf[p + 2] << 8) | buf[p + 3];             // segment length (incl. these 2 bytes)
    if (segLen < 2) return -1;
    if (marker === 0xDA) {
      // SOS: entropy-coded data follows; walk it to the next real marker.
      p += 2 + segLen;
      while (p + 1 < n) {
        if (buf[p] === 0xFF) {
          const m = buf[p + 1];
          if (m === 0x00) { p += 2; continue; }                // stuffed 0xFF
          if (m >= 0xD0 && m <= 0xD7) { p += 2; continue; }    // restart marker
          if (m === 0xD9) return p + 2;                        // EOI
          break;                                               // next real marker (e.g. another SOS / DHT)
        }
        p++;
      }
    } else {
      p += 2 + segLen;
    }
  }
  return -1;
}

/**
 * Find embedded JPEGs in `buf`, returned largest first as {offset,length}. `buf` must
 * actually contain the JPEG bytes (read a bounded region of the file before the raw data).
 * @param {Buffer} buf
 * @returns {{offset:number,length:number}[]}
 */
function findEmbeddedJpegs(buf) {
  if (!buf || buf.length < 4) return [];
  const SOI = Buffer.from([0xFF, 0xD8, 0xFF]);
  const found = [];
  let pos = 0;
  while (pos < buf.length) {
    const start = buf.indexOf(SOI, pos);
    if (start < 0) break;
    const end = jpegEnd(buf, start);
    if (end > start + 1000) {
      found.push({ offset: start, length: end - start });
      pos = end; // continue after this JPEG
    } else {
      pos = start + 2; // false SOI — step past it
    }
  }
  // Load-bearing: decodeEmbeddedPreview's "largest embedded JPEG" contract (rawDecoder.cjs)
  // depends on this descending sort — it takes the first entry that clears its size
  // threshold, assuming that's the largest candidate.
  found.sort((a, b) => b.length - a.length);
  return found;
}

/**
 * Parse the TIFF IFD0 of an uncompressed RAW to find where the raw sensor strip starts.
 * Embedded preview JPEGs live BEFORE it, so this caps how much of the file we scan.
 * @param {Buffer} buf  a small header read
 * @returns {number} the raw-strip offset, or 0 if unknown
 */
function rawDataStart(buf) {
  if (!buf || buf.length < 8) return 0;
  const order = buf.toString('ascii', 0, 2);
  const le = order === 'II' ? true : order === 'MM' ? false : null;
  if (le === null) return 0;
  const rU16 = (o) => (o + 2 > buf.length ? 0 : le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const rU32 = (o) => (o + 4 > buf.length ? 0 : le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const ifd = rU32(4);
  if (ifd < 8 || ifd + 2 > buf.length) return 0;
  const count = rU16(ifd);
  if (count <= 0 || count > 512) return 0;
  let compression = 0, stripOffset = 0;
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    const tag = rU16(e);
    const type = rU16(e + 2);
    const cnt = rU32(e + 4);
    const dataAt = (type === 3 ? 2 : 4) * cnt <= 4 ? e + 8 : rU32(e + 8);
    const scalar = type === 3 ? rU16(dataAt) : rU32(dataAt);
    if (tag === 0x0103) compression = scalar;
    else if (tag === 0x0111) stripOffset = scalar;
  }
  return compression === 1 ? stripOffset : 0; // only meaningful for an uncompressed main image
}

/**
 * Read the EXIF/TIFF Orientation (tag 0x0112) from a RAW container's IFD0. This is where
 * Olympus ORF (and other TIFF-based RAWs) record orientation — their embedded preview JPEG
 * typically carries NO orientation tag of its own, so the thumbnail path needs this to
 * rotate portrait shots upright.
 * @param {Buffer} buf  a small header read (must cover IFD0)
 * @returns {number} EXIF orientation 1-8, or 1 (no rotation) if absent/unparseable
 */
function readOrientation(buf) {
  if (!buf || buf.length < 8) return 1;
  const order = buf.toString('ascii', 0, 2);
  const le = order === 'II' ? true : order === 'MM' ? false : null;
  if (le === null) return 1;
  const rU16 = (o) => (o + 2 > buf.length ? 0 : le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const rU32 = (o) => (o + 4 > buf.length ? 0 : le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const ifd = rU32(4);
  if (ifd < 8 || ifd + 2 > buf.length) return 1;
  const count = rU16(ifd);
  if (count <= 0 || count > 512) return 1;
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > buf.length) break;
    if (rU16(e) === 0x0112) {
      const v = rU16(e + 8); // SHORT value packed into the first 2 bytes of the value field
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

/**
 * Apply an EXIF/TIFF orientation (1-8) to a sharp pipeline. Used for RAW previews whose
 * orientation lives in the container's IFD0 (Olympus ORF) rather than the embedded JPEG's own
 * EXIF, so sharp's `.rotate()` auto-orient can't help. `.rotate(deg)` is clockwise; `.flip()` is
 * vertical, `.flop()` is horizontal. 5/7 (transpose/transverse) are best-effort — real cameras
 * only emit 1/3/6/8 (and rarely 2).
 * @param {import('sharp').Sharp} pipe
 * @param {number} ori  EXIF orientation 1-8
 * @returns {import('sharp').Sharp}
 */
function applyExifOrientation(pipe, ori) {
  switch (ori) {
    case 2: return pipe.flop();
    case 3: return pipe.rotate(180);
    case 4: return pipe.flip();
    case 5: return pipe.rotate(90).flop();
    case 6: return pipe.rotate(90);
    case 7: return pipe.rotate(270).flop();
    case 8: return pipe.rotate(270);
    default: return pipe; // 1 (none) or unknown
  }
}

module.exports = { jpegEnd, findEmbeddedJpegs, rawDataStart, readOrientation, applyExifOrientation };
