'use strict';
/*
 * Generate minimal, spec-correct matrix/TRC ICC v2 display profiles for the
 * wide-gamut export spaces (Adobe RGB 1998, ProPhoto / ROMM RGB, Rec.2020) plus
 * a reference sRGB. Built entirely from published colorimetry (primaries, white
 * point, gamma) so the output is original and freely redistributable.
 *
 * Also emits src/services/colorSpaceMatrices.ts: the exact linear-light
 * sRGB -> target 3x3 matrices (and TRC gammas) so the renderer's pixel
 * conversion stays consistent with the embedded profiles.
 *
 *   node scripts/gen-icc-profiles.cjs
 *
 * Output: assets/icc/*.icc + src/services/colorSpaceMatrices.ts
 */
const fs = require('fs');
const path = require('path');

// ---- linear algebra (3x3) ----------------------------------------------------
const mul = (A, B) => A.map((row, i) => B[0].map((_, j) => row.reduce((s, _v, k) => s + A[i][k] * B[k][j], 0)));
const mulVec = (A, v) => A.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const diag = (v) => [[v[0], 0, 0], [0, v[1], 0], [0, 0, v[2]]];
function inv(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('singular matrix');
  const id = 1 / det;
  return [
    [A * id, (c * h - b * i) * id, (b * f - c * e) * id],
    [B * id, (a * i - c * g) * id, (c * d - a * f) * id],
    [C * id, (b * g - a * h) * id, (a * e - b * d) * id],
  ];
}

// ---- colorimetry -------------------------------------------------------------
const xyToXYZ = ([x, y]) => [x / y, 1, (1 - x - y) / y];

/** RGB->XYZ matrix for the given primaries adapted so that R=G=B=1 yields whiteXYZ. */
function rgbToXYZ(primaries, whiteXYZ) {
  const Xr = xyToXYZ(primaries.r), Xg = xyToXYZ(primaries.g), Xb = xyToXYZ(primaries.b);
  const P = [[Xr[0], Xg[0], Xb[0]], [Xr[1], Xg[1], Xb[1]], [Xr[2], Xg[2], Xb[2]]];
  const S = mulVec(inv(P), whiteXYZ);
  return mul(P, diag(S));
}

// Bradford chromatic adaptation transform.
const BRADFORD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
function bradford(srcW, dstW) {
  const s = mulVec(BRADFORD, srcW), d = mulVec(BRADFORD, dstW);
  return mul(inv(BRADFORD), mul(diag([d[0] / s[0], d[1] / s[1], d[2] / s[2]]), BRADFORD));
}

const D65 = xyToXYZ([0.3127, 0.3290]);
const D50 = xyToXYZ([0.3457, 0.3585]);

const SPACES = {
  srgb:     { file: 'sRGB.icc',        desc: 'sRGB (generated)',            white: D65, gamma: 2.2,
              primaries: { r: [0.6400, 0.3300], g: [0.3000, 0.6000], b: [0.1500, 0.0600] } },
  adobergb: { file: 'AdobeRGB1998.icc', desc: 'Compatible Adobe RGB (1998)', white: D65, gamma: 2.19921875,
              primaries: { r: [0.6400, 0.3300], g: [0.2100, 0.7100], b: [0.1500, 0.0600] } },
  prophoto: { file: 'ProPhoto.icc',    desc: 'ProPhoto (ROMM RGB, generated)', white: D50, gamma: 1.8,
              primaries: { r: [0.734699, 0.265301], g: [0.159597, 0.840403], b: [0.036598, 0.000105] } },
  rec2020:  { file: 'Rec2020.icc',     desc: 'Rec.2020 (generated)',        white: D65, gamma: 2.4,
              primaries: { r: [0.7080, 0.2920], g: [0.1700, 0.7970], b: [0.1310, 0.0460] } },
};

// ---- ICC serialization (v2, mntr/RGB/XYZ, D50 PCS) ---------------------------
const s15f16 = (x) => { const b = Buffer.alloc(4); b.writeInt32BE(Math.round(x * 65536), 0); return b; };
const xyzTag = (v) => Buffer.concat([Buffer.from('XYZ \0\0\0\0', 'latin1'), s15f16(v[0]), s15f16(v[1]), s15f16(v[2])]);
function curvTag(gamma) {
  const b = Buffer.alloc(12 + 2);
  b.write('curv', 0, 'latin1'); b.writeUInt32BE(0, 4); b.writeUInt32BE(1, 8);
  b.writeUInt16BE(Math.round(gamma * 256), 12); // u8Fixed8
  return b;
}
function descTag(text) {
  const ascii = Buffer.from(text + '\0', 'latin1');
  const b = Buffer.alloc(12 + 4 + ascii.length + 4 + 1 + 2 + 1 + 67);
  let o = 0;
  b.write('desc', o, 'latin1'); o += 4; b.writeUInt32BE(0, o); o += 4;
  b.writeUInt32BE(ascii.length, o); o += 4; ascii.copy(b, o); o += ascii.length;
  return b; // remaining bytes (unicode + scriptcode placeholders) left zero
}
function textTag(text) {
  const ascii = Buffer.from(text + '\0', 'latin1');
  return Buffer.concat([Buffer.from('text\0\0\0\0', 'latin1'), ascii]);
}
function chadTag(m) {
  const parts = [Buffer.from('sf32\0\0\0\0', 'latin1')];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) parts.push(s15f16(m[i][j]));
  return Buffer.concat(parts);
}

function buildProfile(space) {
  const M = rgbToXYZ(space.primaries, space.white);
  const cat = bradford(space.white, D50);
  const Mad = mul(cat, M); // colorants adapted to D50 PCS
  const linearMatrix = mul(inv(M), rgbToXYZ(SPACES.srgb.primaries, SPACES.srgb.white)); // sRGB-lin -> target-lin (no CAT)
  const linearMatrixAdapted = mul(inv(Mad), mul(bradford(SPACES.srgb.white, D50), rgbToXYZ(SPACES.srgb.primaries, SPACES.srgb.white)));

  const trc = curvTag(space.gamma);
  const tags = [
    ['desc', descTag(space.desc)],
    ['wtpt', xyzTag(D50)],
    ['rXYZ', xyzTag([Mad[0][0], Mad[1][0], Mad[2][0]])],
    ['gXYZ', xyzTag([Mad[0][1], Mad[1][1], Mad[2][1]])],
    ['bXYZ', xyzTag([Mad[0][2], Mad[1][2], Mad[2][2]])],
    ['rTRC', trc], ['gTRC', trc], ['bTRC', trc],
    ['chad', chadTag(cat)],
    ['cprt', textTag('CC0 / public domain - generated from published colorimetry')],
  ];

  // Tag table + data (4-byte aligned).
  const header = Buffer.alloc(128);
  header.write('mntr', 12, 'latin1');
  header.write('RGB ', 16, 'latin1');
  header.write('XYZ ', 20, 'latin1');
  header.writeUInt32BE(0x02400000, 8);       // version 2.4
  header.write('acsp', 36, 'latin1');
  s15f16(D50[0]).copy(header, 68); s15f16(D50[1]).copy(header, 72); s15f16(D50[2]).copy(header, 76);

  const tagCount = tags.length;
  const tableSize = 4 + tagCount * 12;
  let offset = 128 + tableSize;
  const table = Buffer.alloc(tableSize);
  table.writeUInt32BE(tagCount, 0);
  const dataParts = [];
  // De-dup identical TRC buffers by sharing offsets.
  const seen = new Map();
  tags.forEach(([sig, buf], i) => {
    const key = buf.toString('latin1');
    let off, len = buf.length;
    if (seen.has(key)) { ({ off, len } = seen.get(key)); }
    else {
      off = offset; const pad = (4 - (len % 4)) % 4;
      dataParts.push(buf, Buffer.alloc(pad));
      offset += len + pad; seen.set(key, { off, len });
    }
    const e = 4 + i * 12;
    table.write(sig, e, 'latin1');
    table.writeUInt32BE(off, e + 4);
    table.writeUInt32BE(len, e + 8);
  });

  const profile = Buffer.concat([header, table, ...dataParts]);
  profile.writeUInt32BE(profile.length, 0); // profile size
  return { profile, linearMatrix, linearMatrixAdapted, needsCAT: space.white !== D65 };
}

// ---- write outputs -----------------------------------------------------------
const iccDir = path.join(__dirname, '..', 'assets', 'icc');
fs.mkdirSync(iccDir, { recursive: true });

const matrices = {};
for (const [key, space] of Object.entries(SPACES)) {
  const { profile, linearMatrix, linearMatrixAdapted, needsCAT } = buildProfile(space);
  fs.writeFileSync(path.join(iccDir, space.file), profile);
  console.log(`wrote assets/icc/${space.file} (${profile.length} bytes)`);
  if (key !== 'srgb') {
    matrices[key] = { gamma: space.gamma, srgbToLinearTarget: needsCAT ? linearMatrixAdapted : linearMatrix, file: space.file };
  }
}

const tsLines = [
  '// AUTO-GENERATED by scripts/gen-icc-profiles.cjs - do not edit by hand.',
  '// Linear-light sRGB -> target 3x3 matrices + target TRC gamma, kept consistent',
  '// with the embedded ICC profiles in assets/icc/.',
  'export interface ColorSpaceConversion {',
  '  gamma: number;',
  '  srgbToLinearTarget: number[][];',
  '  file: string;',
  '}',
  'export const COLOR_SPACE_CONVERSIONS: Record<string, ColorSpaceConversion> = ' +
    JSON.stringify(matrices, null, 2) + ';',
  '',
];
const tsPath = path.join(__dirname, '..', 'src', 'services', 'colorSpaceMatrices.ts');
fs.writeFileSync(tsPath, tsLines.join('\n'));
console.log('wrote src/services/colorSpaceMatrices.ts');
