// Camera EXIF extraction for proprietary RAW containers (Task Q6).
//
// WHY this exists: exifreader (the app's normal EXIF reader, used for
// JPG/PNG/TIFF via the read-image-metadata IPC) THROWS "Invalid image format"
// on proprietary RAW containers (ORF/CR2/NEF/ARW/DNG/...), and the camera's
// embedded preview JPEG frequently carries NO EXIF at all (verified: Olympus
// ORF previews expose zero EXIF tags). The bundled `dcraw_emu.exe` has no
// identify (`-i`) flag and its `-v` verbose output only prints progress — so it
// cannot cheaply emit metadata either.
//
// LibRaw DOES know the metadata, but the reliable, dependency-free, near-instant
// source that works WITHOUT running a decode is the file's own TIFF/EXIF IFD
// structure: every one of these RAW formats is a TIFF-based container that
// stores Make/Model in IFD0 and ISO/exposure/aperture/focal-length/timestamp in
// a standard EXIF sub-IFD (tag 0x8769). We parse just those tags here. This is
// consumed by a dedicated cheap `read-raw-metadata` IPC, which keeps camera EXIF
// completely decoupled from the (load-bearing) decode payload + disk base-cache
// round-trip — so it is available identically on a fresh decode, an L1 hit, or
// an L2 disk hit, with nothing new persisted.

const fs = require('fs');

// TIFF field-type -> element byte size (types 1-12; 0/unknown default to 1).
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

// Bounded-read size for readRawMetadataFile (Q6 LOW): every field parseRawExif looks for lives in
// IFD0 + the EXIF sub-IFD, which real-world RAW containers place near the start of the file —
// 1 MB comfortably covers those on every format this app supports (verified against the real
// Olympus ORF fixture in src/test/rawMetadata.test.ts) without reading the ~20-25MB pixel payload.
const PREFIX_BYTES = 1024 * 1024;

// EXIF/TIFF tag ids we care about.
const TAG = {
  MAKE: 0x010f,
  MODEL: 0x0110,
  DATETIME: 0x0132, // IFD0 ModifyDate (fallback for capture time)
  EXIF_IFD: 0x8769, // pointer to the EXIF sub-IFD
  EXPOSURE_TIME: 0x829a,
  FNUMBER: 0x829d,
  ISO: 0x8827, // ISOSpeedRatings
  DATETIME_ORIGINAL: 0x9003,
  DATETIME_DIGITIZED: 0x9004,
  FOCAL_LENGTH: 0x920a,
  LENS_MODEL: 0xa434,
};

/**
 * Parse the camera EXIF from a RAW file's leading TIFF/EXIF IFD structure.
 * Pure function (Buffer in, plain object out) — no I/O, directly unit-testable.
 *
 * Returns ONLY the fields that were present and valid; a caller must treat every
 * field as optional (no fabricated defaults). Returns {} for a non-TIFF buffer
 * or any structural problem (never throws).
 *
 * @param {Buffer} buf  the RAW file bytes (or a leading slice large enough to
 *                      cover IFD0 + the EXIF sub-IFD and their value blocks)
 * @returns {{make?:string, model?:string, iso?:number, exposureTime?:number,
 *            aperture?:number, focalLength?:number, dateTime?:string, lens?:string}}
 */
function parseRawExif(buf) {
  if (!buf || buf.length < 16) return {};
  const le = buf[0] === 0x49 && buf[1] === 0x49; // 'II'
  const be = buf[0] === 0x4d && buf[1] === 0x4d; // 'MM'
  if (!le && !be) return {};

  const r16 = (o) => (o + 2 <= buf.length ? (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)) : 0);
  const r32 = (o) => (o + 4 <= buf.length ? (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o)) : 0);
  const s32 = (o) => (o + 4 <= buf.length ? (le ? buf.readInt32LE(o) : buf.readInt32BE(o)) : 0);

  // Read one IFD entry's value (standard TIFF entry layout:
  // tag[0..1] type[2..3] count[4..7] value-or-offset[8..11]).
  function readValue(entryOff) {
    const type = r16(entryOff + 2);
    const count = r32(entryOff + 4);
    const elemSize = TYPE_SIZE[type] || 1;
    const byteLen = elemSize * count;
    if (!count || byteLen <= 0) return undefined;
    // <=4 bytes -> value sits inline in the entry; otherwise it's a pointer.
    const valOff = byteLen <= 4 ? entryOff + 8 : r32(entryOff + 8);
    if (valOff < 0 || valOff >= buf.length) return undefined;

    switch (type) {
      case 2: { // ASCII (NUL-terminated)
        const limit = Math.min(valOff + count, buf.length);
        let end = valOff;
        while (end < limit && buf[end] !== 0) end++;
        return buf.toString('ascii', valOff, end).trim();
      }
      case 1: // BYTE
      case 6: // SBYTE
        return valOff < buf.length ? buf[valOff] : undefined;
      case 3: // SHORT (take first element for arrays, e.g. ISOSpeedRatings)
      case 8:
        return r16(valOff);
      case 4: // LONG
      case 9:
        return r32(valOff);
      case 5: { // RATIONAL
        const num = r32(valOff);
        const den = r32(valOff + 4);
        return den ? num / den : undefined;
      }
      case 10: { // SRATIONAL
        const num = s32(valOff);
        const den = s32(valOff + 4);
        return den ? num / den : undefined;
      }
      default:
        return undefined;
    }
  }

  // Walk an IFD, invoking readValue for the tag ids we recognise. Returns a
  // { tagId: value } map. Bails safely on a corrupt/out-of-range IFD.
  function readIFD(ifdOff) {
    const out = {};
    if (ifdOff <= 0 || ifdOff + 2 > buf.length) return out;
    const n = r16(ifdOff);
    if (n <= 0 || n > 1024) return out; // sanity cap against garbage counts
    for (let i = 0; i < n; i++) {
      const e = ifdOff + 2 + i * 12;
      if (e + 12 > buf.length) break;
      out[r16(e)] = readValue(e);
    }
    return out;
  }

  const ifd0 = readIFD(r32(4));
  const exif = ifd0[TAG.EXIF_IFD] ? readIFD(ifd0[TAG.EXIF_IFD]) : {};

  const result = {};
  const str = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
  const posNum = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

  const make = str(ifd0[TAG.MAKE]);
  const model = str(ifd0[TAG.MODEL]);
  const iso = posNum(exif[TAG.ISO]);
  const exposureTime = posNum(exif[TAG.EXPOSURE_TIME]);
  const aperture = posNum(exif[TAG.FNUMBER]);
  const focalLength = posNum(exif[TAG.FOCAL_LENGTH]);
  const dateTime = str(exif[TAG.DATETIME_ORIGINAL]) || str(exif[TAG.DATETIME_DIGITIZED]) || str(ifd0[TAG.DATETIME]);
  const lens = str(exif[TAG.LENS_MODEL]);

  if (make !== undefined) result.make = make;
  if (model !== undefined) result.model = model;
  if (iso !== undefined) result.iso = iso;
  if (exposureTime !== undefined) result.exposureTime = exposureTime;
  if (aperture !== undefined) result.aperture = aperture;
  if (focalLength !== undefined) result.focalLength = focalLength;
  if (dateTime !== undefined) result.dateTime = dateTime;
  if (lens !== undefined) result.lens = lens;
  return result;
}

/**
 * Read camera EXIF from a RAW file WITHOUT loading the whole (~20-25MB) file into memory (Q6 LOW).
 * Reads a bounded `prefixBytes`-byte prefix first — parseRawExif is fully bounds-checked (every
 * offset/length is validated against the buffer it's given, see readValue/readIFD above), so a
 * value whose offset lands beyond the prefix is simply dropped, never a crash.
 *
 * If the bounded read finds NOTHING (an unusual IFD layout placing every tag beyond the prefix),
 * retry once against the whole file rather than silently returning no metadata — the common case
 * (prefix suffices) never pays for the fallback.
 *
 * @param {string} filePath
 * @param {number} [prefixBytes] override for tests; defaults to PREFIX_BYTES (1 MB)
 */
async function readRawMetadataFile(filePath, prefixBytes = PREFIX_BYTES) {
  let handle;
  try {
    handle = await fs.promises.open(filePath, 'r');
    const stat = await handle.stat();
    const len = Math.min(prefixBytes, stat.size);
    const buf = Buffer.alloc(len);
    if (len > 0) await handle.read(buf, 0, len, 0);
    const prefixResult = parseRawExif(buf);
    if (Object.keys(prefixResult).length > 0) return prefixResult;
  } finally {
    if (handle) await handle.close();
  }
  const whole = await fs.promises.readFile(filePath);
  return parseRawExif(whole);
}

module.exports = { parseRawExif, readRawMetadataFile };
