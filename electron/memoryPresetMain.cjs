'use strict';
/**
 * Main-process mirror of src/utils/memoryPreset.ts for the numbers main needs at init (disk cache budget). src/test/memoryPresetParity.test.ts keeps the two
 * in step.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MB = 1024 * 1024;
const GB = 1024 * MB;
const PRESET_KEY = 'memoryPreset';

function isPreset(v) { return v === 'balanced' || v === 'high' || v === 'max'; }

/** Disk cache budget in bytes, or undefined (= baseCache.cjs default 2 GB). */
function diskBudget(preset) {
  if (preset === 'high') return 4 * GB;
  if (preset === 'max') return 8 * GB;
  return undefined;
}

/** Synchronous read of the durable store entry (same file naming as main.cjs storeFilePath). */
function readPresetSync(storeDir) {
  try {
    const hash = crypto.createHash('sha1').update(PRESET_KEY).digest('hex');
    const v = JSON.parse(fs.readFileSync(path.join(storeDir, `${hash}.json`), 'utf8'));
    return isPreset(v) ? v : 'balanced';
  } catch (_) {
    return 'balanced';
  }
}

module.exports = { PRESET_KEY, isPreset, diskBudget, readPresetSync };
