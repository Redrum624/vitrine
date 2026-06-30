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

## Source & license

- **Model:** Real-ESRGAN x4plus — ONNX export from the Qualcomm AI Hub model
  [`qualcomm/Real-ESRGAN-x4plus`](https://huggingface.co/qualcomm/Real-ESRGAN-x4plus), which inherits
  the upstream [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) license.
- **License:** BSD-3-Clause, © 2021 Xintao Wang (redistributable; see `THIRD-PARTY-LICENSES.md`).

## Building without the model

If these files are absent, the build still succeeds but the packaged app's AI upscale will report
unavailable and Enhance → Upscale falls back to the deterministic Lanczos path. Place the files here
before running `npm run build:win` to include AI upscale in the installer.
