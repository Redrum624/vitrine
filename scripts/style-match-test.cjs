// Generalization harness: mirrors the in-app Paste Style path (per-channel CDF
// match -> 65-node curve -> linear-interp LUT -> apply) across every ORF+JPG
// pair in a folder, and reports how close the matched ORF lands to its JPG.
// Crop/geometry differs between ORF and JPG by design; we compare distributions.
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { decodeNative } = require('../electron/rawDecoder.cjs');

const FOLDER = process.argv[2];
if (!FOLDER) {
  console.error('Usage: node scripts/style-match-test.cjs <folder-with-orf-jpg-pairs>');
  process.exit(1);
}
const W = 700;

function cdf(pixels, ch, c) {
  const h = new Float64Array(256);
  for (let i = c; i < pixels.length; i += ch) h[pixels[i]]++;
  const out = new Float64Array(256); let acc = 0; const n = pixels.length / ch;
  for (let v = 0; v < 256; v++) { acc += h[v]; out[v] = acc / n; }
  return out;
}
// Match curve as 65 nodes, then rebuild a 256-LUT by linear interp (== buildCurveLUT type 0).
function matchLut(srcCdf, tgtCdf) {
  const full = new Uint8Array(256); let w = 0;
  for (let v = 0; v < 256; v++) { while (w < 255 && srcCdf[w] < tgtCdf[v]) w++; full[v] = w; }
  const nodes = [];
  for (let v = 0; v <= 255; v += 4) nodes.push([v / 255, full[v] / 255]);
  if (nodes[nodes.length - 1][0] < 1) nodes.push([1, full[255] / 255]);
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255; let y = x;
    for (let j = 1; j < nodes.length; j++) {
      if (x <= nodes[j][0]) { const [x1, y1] = nodes[j - 1], [x2, y2] = nodes[j]; const t = (x - x1) / (x2 - x1 || 1); y = y1 + t * (y2 - y1); break; }
    }
    lut[i] = Math.max(0, Math.min(255, Math.round(y * 255)));
  }
  return lut;
}
function means(p, ch) { const m = [0, 0, 0]; for (let i = 0; i < p.length; i += ch) { m[0] += p[i]; m[1] += p[i + 1]; m[2] += p[i + 2]; } const n = p.length / ch; return m.map((s) => s / n); }

(async () => {
  const files = fs.readdirSync(FOLDER);
  const bases = files.filter((f) => /\.orf$/i.test(f)).map((f) => f.replace(/\.orf$/i, ''));
  console.log(`pairs: ${bases.length}  (folder ${FOLDER})`);
  console.log('base        | ORF mean RGB      | JPG mean RGB      | MATCHED mean RGB  | residual |Δ|');
  let saved = 0;
  for (const base of bases) {
    const orfPath = path.join(FOLDER, `${base}.ORF`);
    const jpgPath = path.join(FOLDER, files.find((f) => f.toLowerCase() === `${base}.jpg`.toLowerCase()));
    try {
      const dec = await decodeNative(orfPath, { log() {} });
      const u16 = new Uint16Array(dec.data); const u8 = Buffer.allocUnsafe(u16.length);
      for (let i = 0; i < u16.length; i++) u8[i] = u16[i] >> 8;
      const orf = await sharp(u8, { raw: { width: dec.width, height: dec.height, channels: 3 } }).resize(W).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const jpg = await sharp(jpgPath).resize(W).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const op = orf.data, jp = jpg.data;
      const matched = Buffer.allocUnsafe(op.length);
      for (let c = 0; c < 3; c++) { const lut = matchLut(cdf(jp, 3, c), cdf(op, 3, c)); for (let i = c; i < op.length; i += 3) matched[i] = lut[op[i]]; }
      const mo = means(op, 3), mj = means(jp, 3), mm = means(matched, 3);
      const resid = (mm.reduce((a, v, i) => a + Math.abs(v - mj[i]), 0) / 3);
      const fmt = (a) => a.map((v) => String(Math.round(v)).padStart(3)).join(',');
      console.log(`${base.padEnd(11)} | ${fmt(mo)}     | ${fmt(mj)}     | ${fmt(mm)}     | ${resid.toFixed(1)}`);
      if (saved < 2) {
        await sharp(matched, { raw: { width: orf.info.width, height: orf.info.height, channels: 3 } }).png().toFile(path.join(__dirname, '..', 'test', `match-${base}.png`));
        await sharp(jp, { raw: { width: jpg.info.width, height: jpg.info.height, channels: 3 } }).png().toFile(path.join(__dirname, '..', 'test', `ref-${base}.png`));
        saved++;
      }
    } catch (e) { console.log(`${base.padEnd(11)} | ERROR: ${e.message}`); }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
