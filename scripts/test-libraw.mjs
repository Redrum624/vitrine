/**
 * Standalone test for libraw-wasm processing.
 * Run: node --experimental-vm-modules scripts/test-libraw.mjs
 *
 * Tests multiple RAW files in sequence to reproduce the
 * "second file returns undefined from imageData()" bug.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const TEST_DIR = process.argv[2] || '/path/to/your/raw-files';

// Find test files
const allFiles = fs.readdirSync(TEST_DIR);
const orfFiles = allFiles.filter(f => f.toLowerCase().endsWith('.orf')).slice(0, 3);
const dngFiles = allFiles.filter(f => f.toLowerCase().endsWith('.dng')).slice(0, 2);
const testFiles = [...orfFiles, ...dngFiles];

console.log(`Found ${testFiles.length} test files:`, testFiles);

// Dynamic import libraw-wasm
let LibRaw;
try {
  const mod = await import('libraw-wasm');
  LibRaw = mod.default || mod;
  console.log('libraw-wasm imported successfully, constructor:', typeof LibRaw);
} catch (e) {
  console.error('Failed to import libraw-wasm:', e.message);
  console.log('Trying from node_modules directly...');
  process.exit(1);
}

// Test each file
for (let i = 0; i < testFiles.length; i++) {
  const file = testFiles[i];
  const filePath = path.join(TEST_DIR, file);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${i + 1}/${testFiles.length}] Testing: ${file}`);
  console.log(`${'='.repeat(60)}`);

  try {
    const buffer = fs.readFileSync(filePath);
    const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    console.log(`  File size: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

    // Create fresh instance
    const raw = new LibRaw();
    console.log(`  Created LibRaw instance (has worker: ${!!raw.worker})`);

    // Open
    const t0 = performance.now();
    await raw.open(uint8, {
      userQual: 3,
      useCameraWb: true,
      outputBps: 8,
      outputColor: 1,
    });
    console.log(`  open() completed in ${(performance.now() - t0).toFixed(0)}ms`);

    // Metadata
    const t1 = performance.now();
    const meta = await raw.metadata();
    console.log(`  metadata() completed in ${(performance.now() - t1).toFixed(0)}ms`);
    console.log(`  Dimensions: ${meta.width}x${meta.height}`);
    console.log(`  Camera: ${meta.make} ${meta.model}`);
    console.log(`  ISO: ${meta.iso}, Aperture: ${meta.aperture}, Shutter: ${meta.shutter}`);

    // Image data
    const t2 = performance.now();
    const imgData = await raw.imageData();
    const elapsed = (performance.now() - t2).toFixed(0);

    if (!imgData) {
      console.error(`  ❌ imageData() returned: ${imgData} (${typeof imgData}) after ${elapsed}ms`);
      continue;
    }

    const isUint8 = imgData instanceof Uint8Array;
    const len = imgData.length ?? imgData.byteLength ?? 0;
    const keys = typeof imgData === 'object' && !isUint8 ? Object.keys(imgData).slice(0, 5) : [];

    console.log(`  imageData() returned in ${elapsed}ms:`);
    console.log(`    type: ${typeof imgData}`);
    console.log(`    constructor: ${imgData?.constructor?.name}`);
    console.log(`    instanceof Uint8Array: ${isUint8}`);
    console.log(`    length: ${len}`);
    console.log(`    ArrayBuffer.isView: ${ArrayBuffer.isView(imgData)}`);
    if (keys.length) console.log(`    keys (first 5): ${keys.join(', ')}`);

    const expectedRGB = meta.width * meta.height * 3;
    const expectedRGBA = meta.width * meta.height * 4;
    console.log(`    expected RGB: ${expectedRGB}, RGBA: ${expectedRGBA}`);

    if (isUint8 && len === expectedRGB) {
      console.log(`  ✅ Correct RGB data!`);
    } else if (isUint8 && len === expectedRGBA) {
      console.log(`  ✅ Correct RGBA data!`);
    } else if (len > 0) {
      console.log(`  ⚠️ Data present but unexpected length (got ${len})`);
    } else {
      console.log(`  ❌ No usable pixel data`);
    }

    // Terminate worker to free resources
    if (raw.worker) {
      raw.worker.terminate();
    }

  } catch (err) {
    console.error(`  ❌ Error: ${err.message}`);
  }
}

console.log('\n✅ Test complete');
process.exit(0);
