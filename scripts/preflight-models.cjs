#!/usr/bin/env node
/**
 * preflight-models.cjs
 *
 * Build preflight: FAIL LOUDLY when an expected AI model file is missing from
 * `resources/models/`, so a fresh clone never ships an installer with an AI feature
 * (Enhance -> Upscale / Motion deblur) silently absent.
 *
 * Why this exists: the `.onnx` / `.data` weights are git-ignored (too large for the repo,
 * see `.gitignore` + `resources/models/README.md`). electron-builder happily packages
 * WITHOUT them (extraResources filter just copies whatever is there), and the app's
 * availability gates then HIDE the AI UI — no error anywhere. A clean-clone `build:win`
 * would produce a working-looking installer that quietly lacks both AI features. This
 * preflight turns that silent gap into a hard, actionable build failure.
 *
 * Single source of truth: the expected-file list lives in `resources/models/models.manifest.json`
 * (NOT hardcoded here) — add future models there and the preflight picks them up automatically.
 *
 * Escape hatch for CPU-only / CI builds that intentionally omit the models:
 *   node scripts/preflight-models.cjs --allow-missing-models
 *   ALLOW_MISSING_MODELS=1 npm run build:win
 * Either downgrades the hard failure to a prominent warning (exit 0).
 *
 * The pure decision (`checkModels`) is exported and unit-tested (see
 * src/test/preflightModels.test.js) so the ok/missing logic is verified without a real build.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODELS_DIR = path.join(ROOT, 'resources', 'models');
const MANIFEST_PATH = path.join(MODELS_DIR, 'models.manifest.json');
const README_REL = 'resources/models/README.md';

/**
 * PURE decision function — no I/O, unit-tested in isolation.
 *
 * @param {string[]} presentFiles  Names present in the models directory (e.g. fs.readdirSync output).
 * @param {{file: string, feature?: string}[]} manifestModels  The manifest's `models` array.
 * @returns {{ ok: boolean, missing: {file: string, feature?: string}[], present: string[] }}
 */
function checkModels(presentFiles, manifestModels) {
  const set = new Set(presentFiles || []);
  const missing = [];
  const present = [];
  for (const entry of manifestModels || []) {
    if (set.has(entry.file)) present.push(entry.file);
    else missing.push(entry);
  }
  return { ok: missing.length === 0, missing, present };
}

/** Load and validate the manifest. Throws with a clear message on a malformed/absent manifest. */
function loadManifest(manifestPath = MANIFEST_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch {
    throw new Error(`Model manifest not found at ${manifestPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Model manifest is not valid JSON (${manifestPath}): ${e.message}`);
  }
  if (!parsed || !Array.isArray(parsed.models)) {
    throw new Error(`Model manifest ${manifestPath} must have a "models" array`);
  }
  return parsed.models;
}

/** Directory listing that tolerates a totally absent models dir (fresh clone) → empty. */
function listModelsDir(dir = MODELS_DIR) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function allowMissingFromArgsEnv(argv = process.argv, env = process.env) {
  return argv.includes('--allow-missing-models') || env.ALLOW_MISSING_MODELS === '1';
}

function runCli() {
  let manifestModels;
  try {
    manifestModels = loadManifest();
  } catch (e) {
    console.error(`[preflight-models] ${e.message}`);
    process.exit(1);
    return;
  }

  const present = listModelsDir();
  const { ok, missing } = checkModels(present, manifestModels);

  if (ok) {
    console.log(`[preflight-models] OK — all ${manifestModels.length} AI model file(s) present in ${README_REL.replace('/README.md', '/')}`);
    process.exit(0);
    return;
  }

  const allowMissing = allowMissingFromArgsEnv();
  const lines = [
    '',
    '  ' + '='.repeat(72),
    `  Missing ${missing.length} AI model file(s) that the installer is expected to bundle:`,
    '',
    ...missing.map((m) => `    - ${m.file}${m.feature ? `   (${m.feature})` : ''}`),
    '',
    `  Expected in:  ${MODELS_DIR}`,
    `  How to get them:  ${README_REL}  (sources, sizes, SHA-256)`,
    '  ' + '='.repeat(72),
    '',
  ];

  if (allowMissing) {
    console.warn('[preflight-models] WARNING — building WITHOUT the AI models (--allow-missing-models / ALLOW_MISSING_MODELS=1).');
    console.warn(lines.join('\n'));
    console.warn('[preflight-models] The packaged app will hide the affected AI feature(s). Continuing.');
    process.exit(0);
    return;
  }

  console.error('[preflight-models] BUILD FAILED — AI models are missing.');
  console.error(lines.join('\n'));
  console.error('[preflight-models] Place the file(s) above in resources/models/ and rebuild,');
  console.error('[preflight-models] or pass --allow-missing-models (env ALLOW_MISSING_MODELS=1) for an intentional CPU-only build.');
  process.exit(1);
}

module.exports = {
  checkModels,
  loadManifest,
  listModelsDir,
  allowMissingFromArgsEnv,
  MODELS_DIR,
  MANIFEST_PATH,
};

if (require.main === module) {
  runCli();
}
