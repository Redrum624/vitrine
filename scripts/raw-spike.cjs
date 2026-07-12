#!/usr/bin/env node
/**
 * M0 RAW Quick Wins — decoder capability spike / smoke tool.
 * Probes the vendored dcraw_emu for DCB (-q 4), highlight modes (-H), and the false-colour median (-m),
 * then decodes a sample RAW with the current vs. new-default flags to prove the combination works.
 *
 * Usage: node scripts/raw-spike.cjs [path-to-raw]   (defaults to test/P2060833.ORF)
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'vendor', 'libraw', 'dcraw_emu.exe');
const SRC = path.resolve(process.argv[2] || path.join(ROOT, 'test', 'P2060833.ORF'));
const BASE = ['-w', '-o', '1', '-6', '-g', '2.4', '12.92'];

function help() {
  try { return execFileSync(BIN, [], { encoding: 'utf8' }); }
  catch (e) { return (e.stdout || '') + (e.stderr || ''); } // dcraw_emu prints usage then exits non-zero
}

function decode(label, flags) {
  const tmp = path.join(os.tmpdir(), `raw-spike-${label}-${process.pid}.ORF`);
  fs.copyFileSync(SRC, tmp);
  execFileSync(BIN, [...flags, ...BASE, tmp], { stdio: 'pipe' });
  const out = `${tmp}.ppm`;
  const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
  try { fs.unlinkSync(tmp); fs.unlinkSync(out); } catch { /* best-effort cleanup */ }
  return size;
}

const h = help();
const qLine = (h.match(/interpolation quality:[\s\S]*?\n.*\n/i) || [''])[0].replace(/\s+/g, ' ').trim();
const hasDCB = /4\s*[-–]\s*DCB/i.test(h);
const hasH = /-H\s*\[0-9\]/i.test(h);
const hasM = /-m\s*<num>/i.test(h);
console.log('binary       :', BIN);
console.log('sample RAW   :', SRC, fs.existsSync(SRC) ? '(found)' : '(MISSING)');
console.log('-q levels    :', qLine);
console.log('DCB (-q 4)   :', hasDCB ? 'YES' : 'NO');
console.log('-H highlights:', hasH ? 'YES' : 'NO');
console.log('-m median    :', hasM ? 'YES' : 'NO');

if (fs.existsSync(SRC)) {
  const cur = decode('cur', ['-q', '3']);
  const neu = decode('new', ['-q', '4', '-H', '2']);
  console.log('decode AHD   :', cur, 'bytes');
  console.log('decode DCB+Hl:', neu, 'bytes');
  console.log('VERDICT      :', hasDCB && hasH && hasM && cur > 0 && neu > 0 ? 'VIABLE' : 'BLOCKED');
} else {
  console.log('VERDICT      :', hasDCB && hasH && hasM ? 'FLAGS-OK (no sample to decode)' : 'BLOCKED');
}
