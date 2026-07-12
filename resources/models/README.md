# AI models (not tracked in git)

The Enhance module's AI super-resolution upscale uses **Real-ESRGAN x4plus**, an ONNX model bundled
into the Windows installer (via electron-builder `extraResources`) but **not committed to git** — the
external weights file is ~64 MB, which is too large for the repository.

## Files expected here (for a build that includes AI upscale)

| File | Size | SHA-256 |
|------|------|---------|
| `RealESRGAN_x4plus.onnx` | ~446 KB | `36b217f0ef1c4a88c7bb493c188c15314724dec19f46ae5393f27c4fa7cfc5b4` |
| `real_esrgan_x4plus.data` | ~64 MB | `1bcfa110ca9d9c59594630d73a679d2582b947b9103b10de6743c762f6d006f6` |

Both files must sit side-by-side here (the `.onnx` references the `.data` external-weights file by
relative name).

## Files expected here (for a build that includes AI motion deblur)

| File | Size | SHA-256 |
|------|------|---------|
| `NAFNet-GoPro-width32.onnx` | ~66.5 MB | `32a602cf7e553a79be57059ccbbdd500345a4b90df305a55724be9d22f6dd115` |

Single self-contained file (weights inline; no `.data` sidecar). Dynamic H×W input; opset 11.

**Source:** ailia-models ONNX export of megvii's NAFNet-GoPro-width32 checkpoint —
`https://storage.googleapis.com/ailia-models/nafnet/NAFNet-GoPro-width32.onnx`.
**License:** MIT (© 2022 megvii-model), with the BasicSR components under Apache-2.0. See
`THIRD-PARTY-LICENSES.md`. Used by the Enhance module's **Motion deblur (AI)** control (run via
onnxruntime-node + DirectML). DirectML-gated: on a CPU-only machine the control is hidden.

## Source & license

- **Model:** Real-ESRGAN x4plus — ONNX export from the Qualcomm AI Hub model
  [`qualcomm/Real-ESRGAN-x4plus`](https://huggingface.co/qualcomm/Real-ESRGAN-x4plus), which inherits
  the upstream [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) license.
- **License:** BSD-3-Clause, © 2021 Xintao Wang (redistributable; see `THIRD-PARTY-LICENSES.md`).

## Building without the models

Since round 9 the build **fails loudly** when any file listed in `models.manifest.json` is
missing — `npm run build:win` / `build:win:dir` run `scripts/preflight-models.cjs` before the
expensive steps, and its error names each missing file and its feature.

To deliberately build a CPU-only installer (both AI features hidden at runtime — AI upscale
falls back to Lanczos, AI motion deblur's control does not appear), use the escape hatch:

- `ALLOW_MISSING_MODELS=1 npm run build:win` (bash / POSIX shells), or
- `$env:ALLOW_MISSING_MODELS='1'; npm run build:win` (PowerShell — the Windows default), or
- `node scripts/preflight-models.cjs --allow-missing-models` (direct invocation, any shell)

which downgrades the failure to a prominent warning. Place the files listed above in this
directory before building to include the AI features in the installer. New models must be
added to `models.manifest.json` — the preflight reads only that manifest.
