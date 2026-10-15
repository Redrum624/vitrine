#!/usr/bin/env node
/**
 * gpu-crop-probe.cjs — run the REAL GPU crop shader (FRAG_CROP via GpuPreviewPipeline) in
 * headless Chromium (SwiftShader WebGL2) against the CPU CropModule. Jest has no WebGL, so
 * this is the only off-app execution of the GLSL (v1.40.0 Task 10a).
 *
 * Bundles the real src modules with esbuild (vite's copy), then in the page:
 *   - GpuPreviewPipeline.selfTest() — prints every "[GPU-PIPELINE] ... self-test" line
 *   - a sweep: 61x37 x orientations 0/90/180/270 x nearest/bilinear/bicubic x 3 flip combos
 *     x angles 0/3.3/-11 (backstop-clamped rects), a 640x481 @ 0.84 deg frame, and a
 *     suspended full canvas with fill — GPU readback vs processWithGeometry, maxDiff < 1e-3.
 *
 * Usage: node scripts/gpu-crop-probe.cjs     Exit 1 on any crop failure (CROP_PROBE_FAIL).
 * Note: SwiftShader is not the owner's GPU — the in-app selfTest remains the live gate.
 */
const path = require('path');
const { chromium } = require('@playwright/test');

const ROOT = path.join(__dirname, '..');
const esbuild = require(require.resolve('esbuild', { paths: [path.dirname(require.resolve('vite/package.json', { paths: [ROOT] }))] }));

const ENTRY = `
import { GpuPreviewPipeline } from './src/shaders/GpuPreviewPipeline';
import { cropPassDescriptor } from './src/shaders/passDescriptors';
import { CropModule } from './src/modules/CropModule';
import { computeCropGeometry } from './src/modules/cropGeometry';

function synth(w, h) {
  const d = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    d[i] = x / w; d[i + 1] = y / h; d[i + 2] = ((x * 7 + y * 3) % 11) / 11; d[i + 3] = 1;
  }
  return d;
}
window.runProbe = () => {
  const out = [];
  const p = new GpuPreviewPipeline();
  if (!p.attach()) return { lines: ['attach failed (no WebGL2 float targets)'], fails: 1 };
  const st = p.selfTest();
  out.push('selfTest ok=' + st.ok + ' unsafe=' + st.unsafe.join(','));
  let fails = st.unsafe.includes('crop') ? 1 : 0;
  const cases = [];
  for (const orientation of [0, 90, 180, 270]) for (const m of ['nearest', 'bilinear', 'bicubic'])
    for (const fl of [[false, false], [true, true], [true, false]]) for (const angle of [0, 3.3, -11])
      cases.push([61, 37, { angle, orientation, resampleMethod: m, flipHorizontal: fl[0], flipVertical: fl[1], x: 0.07, y: 0.11, width: 0.8, height: 0.77 }, false]);
  cases.push([640, 481, { angle: 0.84, resampleMethod: 'bilinear' }, false]);
  cases.push([61, 37, { angle: 5, resampleMethod: 'bilinear' }, true]);
  let worst = 0;
  for (const [w, h, prm, full] of cases) {
    const m = new CropModule(); m.setParams({ enabled: true, ...prm });
    const geom = full
      ? computeCropGeometry({ ...m.getParams(), x: 0, y: 0, width: 1, height: 1, fillColor: [0.2, 0.4, 0.6, 1] }, w, h)
      : m.getRenderGeometry(w, h);
    const src = synth(w, h);
    p.setSource(src, w, h);
    const r = p.render([cropPassDescriptor(geom)]);
    const g = p.readback();
    const ref = m.processWithGeometry(new Float32Array(src), geom, 4);
    let md = 0; for (let i = 0; i < ref.length; i++) md = Math.max(md, Math.abs(g[i] - ref[i]));
    if (r.width !== geom.outW || r.height !== geom.outH || g.length !== ref.length || md > 1e-3) {
      fails++;
      out.push('FAIL ' + w + 'x' + h + ' ' + JSON.stringify(prm) + ' full=' + full + ' dims=' + r.width + 'x' + r.height + ' vs ' + geom.outW + 'x' + geom.outH + ' md=' + md);
    }
    worst = Math.max(worst, md);
  }
  out.push('sweep cases=' + cases.length + ' fails=' + fails + ' worst=' + worst.toExponential(2));
  p.destroy();
  return { lines: out, fails };
};
`;

(async () => {
  const r = await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: 'ts' },
    absWorkingDir: ROOT, bundle: true, write: false, format: 'iife', logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env': '{}' },
  });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage();
    page.on('console', (m) => { const t = m.text(); if (/self-test/.test(t)) console.log(t); });
    await page.setContent('<html><body></body></html>');
    await page.addScriptTag({ content: r.outputFiles[0].text });
    const { lines, fails } = await page.evaluate(() => globalThis.runProbe());
    console.log(lines.join('\n'));
    if (fails > 0) { console.log('CROP_PROBE_FAIL'); process.exitCode = 1; }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
