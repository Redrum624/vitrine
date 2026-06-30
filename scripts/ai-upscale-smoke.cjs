/**
 * AI upscaler smoke (Phase-2 Task 3). Runs the REAL model on a REAL photo and verifies the result.
 *
 *   ELECTRON_RUN_AS_NODE=1 npx electron scripts/ai-upscale-smoke.cjs   (tests Electron's Node ABI)
 *   node scripts/ai-upscale-smoke.cjs                                  (plain node)
 *
 * Checks: output dims are exactly 2x; progress reached total; and — the real test of preprocess
 * correctness — downscaling the AI output back to source size matches the source closely
 * (small per-channel mean-abs-diff). A swapped RGB order or wrong value range would make this large.
 */
'use strict';
const path = require('path');
const sharp = require('sharp');
const ai = require('../electron/aiUpscaler.cjs');

const SRC = path.join(__dirname, '..', 'test', 'P2060833.JPG');
const OUT = path.join(require('os').tmpdir(), 'ai-upscale-smoke-2x.png');
const line = (s) => process.stdout.write(String(s) + '\n');

(async () => {
  line('available = ' + (await ai.isAvailable()));
  line('backend   = ' + ai.getBackend());

  // Load + downsize source to keep the smoke quick (~24 tiles).
  const small = await sharp(SRC).resize(480, null, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = small.info.width, h = small.info.height;
  // sharp raw with 3 channels -> expand to RGBA for the upscaler's Uint8 RGBA contract.
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = small.data[i * 3]; rgba[i * 4 + 1] = small.data[i * 3 + 1]; rgba[i * 4 + 2] = small.data[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
  line('source = ' + w + 'x' + h);

  let lastProgress = { done: 0, total: 0 };
  const t0 = Date.now();
  const res = await ai.upscale(rgba, w, h, 2, (p) => { lastProgress = p; });
  const ms = Date.now() - t0;
  line('upscale x2: ' + res.width + 'x' + res.height + ' in ' + ms + 'ms  (' + (ms / Math.max(1, lastProgress.total)).toFixed(0) + 'ms/tile, ' + lastProgress.total + ' tiles)');
  line('progress reached = ' + lastProgress.done + '/' + lastProgress.total);

  await sharp(Buffer.from(res.data.buffer, res.data.byteOffset, res.data.byteLength), { raw: { width: res.width, height: res.height, channels: 4 } }).png().toFile(OUT);
  line('wrote ' + OUT);

  // Correctness: downscale AI output back to source size, compare to source (per-channel MAD).
  const back = await sharp(Buffer.from(res.data.buffer, res.data.byteOffset, res.data.byteLength), { raw: { width: res.width, height: res.height, channels: 4 } })
    .resize(w, h, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
  let madR = 0, madG = 0, madB = 0;
  for (let i = 0; i < w * h; i++) {
    madR += Math.abs(back[i * 3] - small.data[i * 3]);
    madG += Math.abs(back[i * 3 + 1] - small.data[i * 3 + 1]);
    madB += Math.abs(back[i * 3 + 2] - small.data[i * 3 + 2]);
  }
  const n = w * h;
  madR /= n; madG /= n; madB /= n;
  line('round-trip MAD (per channel, /255) = R:' + madR.toFixed(2) + ' G:' + madG.toFixed(2) + ' B:' + madB.toFixed(2));

  const dimsOk = res.width === w * 2 && res.height === h * 2;
  const progressOk = lastProgress.done === lastProgress.total && lastProgress.total > 1;
  const fidelityOk = madR < 20 && madG < 20 && madB < 20; // structurally faithful, correct channels/range
  const ok = dimsOk && progressOk && fidelityOk;
  line('dimsOk=' + dimsOk + ' progressOk=' + progressOk + ' fidelityOk=' + fidelityOk);
  line(ok ? 'AI_UPSCALE_SMOKE_PASS' : 'AI_UPSCALE_SMOKE_FAIL');
  process.exit(ok ? 0 : 1);
})().catch((e) => { line('SMOKE_ERR ' + (e && e.stack ? e.stack : e)); process.exit(2); });
