'use strict';

/**
 * Main-process image writer for exports.
 *
 * Extracted from main.cjs so it can be unit-tested without Electron.
 * Correctly handles 8-bit and 16-bit raw RGBA buffers coming from the renderer
 * (ExportService.convertBitDepth) and writes them via sharp.
 *
 * The original handler always treated the raw buffer as 8-bit, so a 16-bit
 * Uint16Array (2 bytes/sample) was misread by sharp and the file came out
 * garbled. We now thread the bit depth through and feed sharp a Uint16Array for
 * 16-bit data (sharp infers raw depth 'ushort' from the TypedArray constructor),
 * validate the byte size against the declared depth, and embed an sRGB ICC
 * profile so viewers interpret the colours correctly.
 */

/**
 * XML-escape a string for safe embedding inside an XMP/RDF packet.
 * An unescaped `&` or `<` makes the whole packet unparseable, so every
 * user-supplied value MUST pass through here.
 * @param {unknown} value
 * @returns {string}
 */
function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build an XMP/RDF packet string from a high-level metadata object.
 *
 * Maps the supported fields onto the standard XMP namespaces:
 *   - dc: (Dublin Core)         title, description, creator, subject, rights
 *   - photoshop:                credit, source
 *   - xmpRights:                webStatement (WebStatement), usageTerms (UsageTerms)
 *
 * IPTC is intentionally expressed as XMP here: sharp cannot write a legacy
 * IPTC-IIM block, and XMP is the accepted modern equivalent (and is what the
 * app's own exifreader-based reader consumes back).
 *
 * @param {{
 *   rights?: string,
 *   creator?: string[],
 *   title?: string,
 *   description?: string,
 *   subject?: string[],
 *   credit?: string,
 *   source?: string,
 *   webStatement?: string,
 *   usageTerms?: string
 * }} xmp
 * @returns {string} a complete XMP packet
 */
function buildXmpPacket(xmp) {
  const props = [];

  // dc:title and dc:description are language-alternative arrays in XMP.
  if (xmp.title) {
    props.push(
      `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(xmp.title)}</rdf:li></rdf:Alt></dc:title>`
    );
  }
  if (xmp.description) {
    props.push(
      `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(xmp.description)}</rdf:li></rdf:Alt></dc:description>`
    );
  }
  // dc:rights is also a language-alternative array.
  if (xmp.rights) {
    props.push(
      `<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(xmp.rights)}</rdf:li></rdf:Alt></dc:rights>`
    );
  }
  // dc:creator is an ordered list (Seq).
  if (Array.isArray(xmp.creator) && xmp.creator.length > 0) {
    const items = xmp.creator
      .filter((c) => c != null && c !== '')
      .map((c) => `<rdf:li>${xmlEscape(c)}</rdf:li>`)
      .join('');
    if (items) props.push(`<dc:creator><rdf:Seq>${items}</rdf:Seq></dc:creator>`);
  }
  // dc:subject (keywords) is an unordered list (Bag).
  if (Array.isArray(xmp.subject) && xmp.subject.length > 0) {
    const items = xmp.subject
      .filter((s) => s != null && s !== '')
      .map((s) => `<rdf:li>${xmlEscape(s)}</rdf:li>`)
      .join('');
    if (items) props.push(`<dc:subject><rdf:Bag>${items}</rdf:Bag></dc:subject>`);
  }
  // Simple scalar properties.
  if (xmp.credit) props.push(`<photoshop:Credit>${xmlEscape(xmp.credit)}</photoshop:Credit>`);
  if (xmp.source) props.push(`<photoshop:Source>${xmlEscape(xmp.source)}</photoshop:Source>`);
  if (xmp.webStatement) {
    props.push(`<xmpRights:WebStatement>${xmlEscape(xmp.webStatement)}</xmpRights:WebStatement>`);
  }
  if (xmp.usageTerms) {
    props.push(
      `<xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(xmp.usageTerms)}</rdf:li></rdf:Alt></xmpRights:UsageTerms>`
    );
  }
  // xmp:Rating (0-5) — Windows Explorer and Lightroom/Bridge read this as the star rating.
  if (typeof xmp.rating === 'number' && xmp.rating >= 0) {
    props.push(`<xmp:Rating>${Math.round(xmp.rating)}</xmp:Rating>`);
  }

  // The XMP packet header conventionally starts with a UTF-8 BOM (U+FEFF)
  // inside begin="..."; use the escape form so no irregular literal whitespace
  // appears in source (the emitted byte is identical).
  return (
    `<?xpacket begin="${String.fromCharCode(0xFEFF)}" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
    `xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" ` +
    `xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/" ` +
    `xmlns:xmp="http://ns.adobe.com/xap/1.0/">` +
    props.join('') +
    `</rdf:Description>` +
    `</rdf:RDF>` +
    `</x:xmpmeta>` +
    `<?xpacket end="w"?>`
  );
}

/**
 * Map the high-level EXIF fields onto sharp's withExif IFD0 shape.
 * sharp's withExif expects all values as strings. Only the fields we
 * support are forwarded; unset fields are omitted.
 *
 * @param {{ Copyright?: string, Artist?: string, ImageDescription?: string, DateTimeOriginal?: string }} exif
 * @returns {Record<string, string>} the IFD0 tag map
 */
function mapExifIfd0(exif) {
  const ifd0 = {};
  if (exif.Copyright) ifd0.Copyright = String(exif.Copyright);
  if (exif.Artist) ifd0.Artist = String(exif.Artist);
  if (exif.ImageDescription) ifd0.ImageDescription = String(exif.ImageDescription);
  if (exif.DateTimeOriginal) ifd0.DateTimeOriginal = String(exif.DateTimeOriginal);
  return ifd0;
}

/**
 * Apply EXIF and/or XMP metadata to a sharp pipeline.
 *
 * Both withExif and withXmp only write container metadata and do NOT touch
 * pixels, so this is safe in BOTH the 8-bit and 16-bit (rgb16) branches —
 * unlike withIccProfile, which can trigger a colour re-conversion.
 *
 * @param {import('sharp').Sharp} img
 * @param {{ exif?: object, xmp?: object }} [metadata]
 * @returns {import('sharp').Sharp}
 */
function applyMetadata(img, metadata) {
  if (!metadata) return img;

  if (metadata.exif && typeof img.withExif === 'function') {
    const ifd0 = mapExifIfd0(metadata.exif);
    if (Object.keys(ifd0).length > 0) {
      img = img.withExif({ IFD0: ifd0 });
    }
  }

  if (metadata.xmp && typeof img.withXmp === 'function') {
    const packet = buildXmpPacket(metadata.xmp);
    img = img.withXmp(packet);
  }

  return img;
}

/**
 * Normalise an incoming pixel payload to a plain ArrayBuffer.
 * Accepts an ArrayBuffer (the IPC case), any TypedArray/DataView, or a Node Buffer.
 */
function toArrayBuffer(imageData) {
  if (imageData instanceof ArrayBuffer) return imageData;
  if (ArrayBuffer.isView(imageData)) {
    return imageData.buffer.slice(imageData.byteOffset, imageData.byteOffset + imageData.byteLength);
  }
  // Fallback: array-like of bytes.
  return Uint8Array.from(imageData).buffer;
}

/**
 * Resolve a bundled ICC profile path (assets/icc/<file>), trying the dev source
 * layout first and then the packaged extraResources location.
 * @param {string} file  e.g. 'AdobeRGB1998.icc'
 * @returns {string|null}
 */
function resolveIccProfilePath(file) {
  const fs = require('fs');
  const path = require('path');
  const candidates = [path.join(__dirname, '..', 'assets', 'icc', file)];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'assets', 'icc', file));
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return null;
}

// Wide-gamut output spaces -> bundled profile filename. Pixels reaching the
// writer are already converted to the target space by ExportService; we only
// ATTACH the matching profile so viewers interpret the values correctly.
const WIDE_GAMUT_ICC = { adobergb: 'AdobeRGB1998.icc', prophoto: 'ProPhoto.icc', rec2020: 'Rec2020.icc' };

/**
 * @param {string} filePath           destination path
 * @param {ArrayBuffer|Buffer} imageData  raw interleaved RGBA samples
 * @param {string} format             'jpeg' | 'png' | 'tiff' | 'webp'
 * @param {object} options            { width, height, channels?, bitDepth?, colorSpace?, quality?, progressive?, compressionLevel?, compression?, lossless?, targetWidth?, targetHeight?, targetFit?, resize?, metadata? }
 *                                     targetWidth/targetHeight/targetFit = primary export resize done here in the
 *                                       main process (off the renderer thread) on the RAW input BEFORE encode.
 *                                       width/height describe the incoming (full-res) buffer; targetWidth/Height the output.
 *                                     metadata = { exif?: { Copyright?, Artist?, ImageDescription?, DateTimeOriginal? },
 *                                                  xmp?: { rights?, creator?[], title?, description?, subject?[], credit?, source?, webStatement?, usageTerms? } }
 * @returns {Promise<boolean>}
 */
async function writeImageFile(filePath, imageData, format, options = {}) {
  const sharp = require('sharp');

  const channels = options.channels || 4;
  const is16 = options.bitDepth === 16;
  const bytesPerSample = is16 ? 2 : 1;

  const ab = toArrayBuffer(imageData);
  const expectedSize = options.width * options.height * channels * bytesPerSample;

  if (ab.byteLength !== expectedSize) {
    // Throw rather than warn-and-proceed: a mis-sized buffer means a corrupt
    // file. Fail loudly at the boundary so the export is observably wrong.
    throw new Error(
      `Export buffer size mismatch: got ${ab.byteLength} bytes, expected ${expectedSize} ` +
      `(${options.width}x${options.height} x ${channels}ch @ ${is16 ? 16 : 8}-bit)`
    );
  }

  const colorSpace = options.colorSpace || 'srgb';
  const wideGamut = Object.prototype.hasOwnProperty.call(WIDE_GAMUT_ICC, colorSpace);

  // Choose the raw input sharp sees:
  //  - 16-bit (non-wide-gamut): a Uint16Array so sharp picks depth 'ushort'.
  //  - 8-bit: a Buffer ('uchar').
  //  - 16-bit + wide-gamut: downsample to 8-bit OURSELVES. Handing sharp a
  //    ushort buffer here makes it treat the data as linear and re-encode gamma
  //    on the 8-bit downconvert (corrupting the already-encoded wide-gamut
  //    values); an 8-bit Buffer is read verbatim and then tagged.
  let rawInput;
  if (is16 && wideGamut) {
    const u16 = new Uint16Array(ab);
    const u8 = Buffer.allocUnsafe(u16.length);
    for (let i = 0; i < u16.length; i++) u8[i] = Math.round(u16[i] / 257);
    rawInput = u8;
  } else if (is16) {
    rawInput = new Uint16Array(ab);
  } else {
    rawInput = Buffer.from(ab);
  }

  let img = sharp(rawInput, {
    raw: { width: options.width, height: options.height, channels }
  });

  // Guard: callers must not set both resize mechanisms at the same time.
  // targetWidth/targetHeight = primary (sharp, main process); options.resize = secondary legacy hook.
  // If both are set, sharp would silently resize twice and corrupt the output.
  if ((options.targetWidth || options.targetHeight) && options.resize) {
    throw new Error(
      'imageWriter: cannot combine targetWidth/targetHeight (primary resize) with options.resize (secondary resize)'
    );
  }

  // Primary export resize, performed in the MAIN process off the renderer thread.
  // ExportService used to run a CPU bicubic loop on the renderer (blocking the UI)
  // and pass us a buffer already at the target size; now it passes the FULL-res
  // processed buffer plus the target dimensions, and we downscale here with
  // sharp's lanczos3 kernel (higher quality than the old bicubic).
  //
  // CORRECTNESS: this MUST be the FIRST pixel operation, before removeAlpha /
  // toColourspace('rgb16') / encode, so the resize sees the raw RGBA samples at
  // their declared bit depth (uchar or ushort). ExportService already computed
  // aspect-correct dimensions, so we use fit:'fill' to honour them exactly and
  // allow enlargement (no withoutEnlargement) so an upscale request is respected.
  // The 16-bit (ushort) raw input is resized as ushort and stays ushort, so the
  // downstream toColourspace('rgb16') + true 16-bit encode are unaffected.
  if (options.targetWidth && options.targetHeight &&
      (options.targetWidth !== options.width || options.targetHeight !== options.height)) {
    img = img.resize(options.targetWidth, options.targetHeight, {
      kernel: 'lanczos3',
      fit: options.targetFit || 'fill'
    });
  }

  const fmt = String(format).toLowerCase();
  // Keep a 16-bit working space (PNG/TIFF only). NOT for wide-gamut: sharp's
  // rgb16 colourspace conversion combined with an attached profile re-transforms
  // the pixels and shifts colours, so wide-gamut exports fall back to 8-bit
  // (correct colour prioritised over bit depth) and carry the matching profile.
  const keep16 = is16 && (fmt === 'png' || fmt === 'tiff') && !wideGamut;
  if (is16 && wideGamut) {
    console.warn(`16-bit ${colorSpace} export downgraded to 8-bit (16-bit + wide-gamut ICC is unsupported by the encoder).`);
  }

  // JPEG cannot carry alpha; strip it (other formats keep the opaque alpha).
  if (fmt === 'jpeg') {
    img = img.removeAlpha();
  }

  // Without this, sharp reads the ushort raw input but downconverts to 8-bit on
  // encode, silently defeating a 16-bit export. Force a 16-bit working space for
  // the formats that can actually store it.
  if (keep16) {
    img = img.toColourspace('rgb16');
  }

  switch (fmt) {
    case 'jpeg':
      img = img.jpeg({
        quality: options.quality ?? 90,
        progressive: options.progressive ?? false,
        mozjpeg: true
      });
      break;
    case 'png':
      img = img.png({
        compressionLevel: options.compressionLevel ?? 6,
        progressive: options.progressive ?? false
      });
      break;
    case 'tiff': {
      // The UI/estimator use the user-facing label 'zip', but sharp's libtiff
      // binding only accepts 'deflate' (no 'zip' name) — passing 'zip' straight
      // through throws and the export fails. Map it at this boundary only; the
      // UI keeps calling it 'zip'.
      const requestedCompression = options.compression || 'lzw';
      const tiffCompression = requestedCompression === 'zip' ? 'deflate' : requestedCompression;
      img = img.tiff({
        compression: tiffCompression,
        quality: options.quality ?? 90,
        // BigTIFF avoids the classic-TIFF 4GB / 0xFFFFFFFF offset limit on large
        // (e.g. 16-bit, high-MP) exports — "Maximum TIFF file size exceeded".
        bigtiff: true
      });
      break;
    }
    case 'webp':
      img = img.webp({
        quality: options.quality ?? 80,
        lossless: options.lossless ?? false
      });
      break;
    default:
      throw new Error(`Unsupported format: ${format}`);
  }

  // Embed the matching ICC profile so viewers interpret the colours correctly.
  // sRGB is skipped on the 16-bit (rgb16) path because combining the rgb16
  // colourspace conversion with an attached profile makes sharp re-convert and
  // shift the pixels; 16-bit sRGB pixels are already sRGB-encoded so an untagged
  // file still displays correctly. Wide-gamut pixels were already converted by
  // ExportService, so withIccProfile here only ATTACHES (it does not re-transform
  // raw input) — verified against sharp 0.34.
  if (colorSpace === 'srgb' && !keep16) {
    if (typeof img.withIccProfile === 'function') {
      img = img.withIccProfile('srgb');
    } else if (typeof img.withMetadata === 'function') {
      img = img.withMetadata();
    }
  } else if (wideGamut) {
    const iccPath = resolveIccProfilePath(WIDE_GAMUT_ICC[colorSpace]);
    if (iccPath && typeof img.withIccProfile === 'function') {
      img = img.withIccProfile(iccPath);
    } else {
      console.warn(`No bundled ICC profile for ${colorSpace} (${WIDE_GAMUT_ICC[colorSpace]}); exporting untagged.`);
    }
  }

  // Embed EXIF copyright/artist + IPTC-as-XMP metadata when supplied. Applied
  // here alongside the ICC block; safe in BOTH the 8-bit and 16-bit branches
  // because withExif/withXmp only write container metadata, not pixels.
  img = applyMetadata(img, options.metadata);

  // Optional secondary resize (only when a caller explicitly sets options.resize).
  if (options.resize && (options.resize.width || options.resize.height)) {
    img = img.resize(options.resize.width, options.resize.height, {
      fit: options.resize.fit || 'inside',
      withoutEnlargement: true
    });
  }

  await img.toFile(filePath);
  return true;
}

/**
 * Embed EXIF/XMP metadata into an EXISTING image file in place.
 *
 * Re-opens the file with sharp, applies withExif/withXmp, and writes it back.
 * Used by the standalone 'write-image-metadata' IPC (e.g. the Copyright
 * module's "Embed Metadata" button) to tag an already-exported image.
 *
 * Only sharp-encodable raster formats (jpeg/png/tiff/webp) are supported.
 * Proprietary camera RAW (ORF/CR2/NEF/ARW/DNG) cannot be re-encoded by sharp
 * and MUST be guarded by the caller. The caller keeps existing pixels by
 * passing the file through sharp untouched (this re-encodes, so for lossy
 * formats like JPEG it re-compresses — the caller decides whether that is
 * acceptable or whether to write a sibling copy / route through export).
 *
 * @param {string} filePath  existing image to tag
 * @param {{ exif?: object, xmp?: object }} metadata
 * @returns {Promise<boolean>}
 */
async function writeImageMetadata(filePath, metadata) {
  const sharp = require('sharp');
  const fs = require('fs');

  if (!metadata || (!metadata.exif && !metadata.xmp)) {
    throw new Error('writeImageMetadata: no exif or xmp metadata supplied');
  }

  // Keep the source pixels/format; only add the requested container metadata.
  let img = sharp(filePath, { failOn: 'none' }).keepMetadata();
  img = applyMetadata(img, metadata);

  // sharp re-encodes the file on toFile(), so the entropy-coded scan data is
  // rebuilt — for lossy formats this would otherwise fall back to sharp's
  // DEFAULT quality (~q80, no mozjpeg) and visibly degrade the image. Re-attach
  // the SAME encoder family at high fidelity to bound that loss. PNG/TIFF are
  // lossless, so re-encoding them is pixel-exact and needs no quality override.
  const { format: srcFormat } = await sharp(filePath).metadata();
  if (srcFormat === 'jpeg') {
    img = img.jpeg({ quality: 95, mozjpeg: true });
  } else if (srcFormat === 'webp') {
    img = img.webp({ quality: 95 });
  }

  // Write to a temp sibling then atomically rename, so a failed encode never
  // truncates the original file.
  const tmpPath = `${filePath}.tmp-${Date.now()}`;
  try {
    await img.toFile(tmpPath);
    await fs.promises.rename(tmpPath, filePath);
  } catch (error) {
    try { await fs.promises.unlink(tmpPath); } catch { /* ignore cleanup failure */ }
    throw error;
  }
  return true;
}

/**
 * Parse the star rating (0-5) out of an XMP packet. Handles both the element form we write
 * (`<xmp:Rating>N</xmp:Rating>`) and the attribute form other apps use (`xmp:Rating="N"`).
 * @param {Buffer|string|null|undefined} xmp  raw XMP packet (embedded metadata or a sidecar)
 * @returns {number|null} rating 0-5, or null when no valid rating is present
 */
function parseXmpRating(xmp) {
  if (xmp == null) return null;
  const s = Buffer.isBuffer(xmp) ? xmp.toString('utf8') : String(xmp);
  let m = s.match(/<xmp:Rating>\s*(-?\d+(?:\.\d+)?)\s*<\/xmp:Rating>/i);
  if (!m) m = s.match(/xmp:Rating\s*=\s*["'](-?\d+(?:\.\d+)?)["']/i);
  if (!m) return null;
  const r = Math.round(parseFloat(m[1]));
  return r >= 0 && r <= 5 ? r : null;
}

module.exports = {
  writeImageFile,
  writeImageMetadata,
  toArrayBuffer,
  buildXmpPacket,
  parseXmpRating,
  xmlEscape,
  mapExifIfd0
};
