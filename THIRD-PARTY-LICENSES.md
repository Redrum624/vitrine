# Third-Party Licenses — Photo Editor Pro

Photo Editor Pro bundles the third-party components below. Each is licensed under its own terms
(NOT the project's PolyForm Noncommercial license); their rights are unaffected by the project license.

---

## npm Production Dependencies (17 packages)

Source: `pnpm licenses list --prod` — full transitive production closure.

| Package | Version | License | Repository / Homepage |
|---------|---------|---------|----------------------|
| @img/colour | 1.1.0 | MIT | https://github.com/lovell/colour#readme |
| @img/sharp-win32-x64 | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later | https://sharp.pixelplumbing.com |
| @types/react | 19.2.15 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react |
| @xmldom/xmldom | 0.9.10 | MIT | https://github.com/xmldom/xmldom |
| csstype | 3.2.3 | MIT | https://github.com/frenic/csstype#readme |
| detect-libc | 2.1.2 | Apache-2.0 | https://github.com/lovell/detect-libc#readme |
| exifreader | 4.39.1 | MPL-2.0 | https://github.com/mattiasw/ExifReader#readme |
| libraw-wasm | 1.1.2 | ISC | https://github.com/ybouane/libraw-wasm |
| lucide-react | 0.562.0 | ISC | https://lucide.dev |
| onnxruntime-common | 1.27.0 | MIT | https://github.com/microsoft/onnxruntime |
| onnxruntime-node | 1.27.0 | MIT | https://github.com/microsoft/onnxruntime |
| react | 19.2.6 | MIT | https://react.dev/ |
| react-dom | 19.2.6 | MIT | https://react.dev/ |
| scheduler | 0.27.0 | MIT | https://react.dev/ |
| semver | 7.8.1 | ISC | https://github.com/npm/node-semver#readme |
| sharp | 0.34.5 | Apache-2.0 | https://sharp.pixelplumbing.com |
| zustand | 5.0.13 | MIT | https://github.com/pmndrs/zustand |

### License Obligations

**Apache-2.0** (`sharp`, `detect-libc`) — Retain copyright notices and the NOTICE file (if present) when distributing.

**Apache-2.0 AND LGPL-3.0-or-later** (`@img/sharp-win32-x64`) — See LGPL obligations below.

**ISC** (`libraw-wasm`, `lucide-react`, `semver`) — Retain the copyright notice and permission notice in all copies.

**MIT** — Retain the copyright notice and permission notice in all copies or substantial portions.

**MPL-2.0 (`exifreader`)** — File-level copyleft: if you modify any `.js` or `.ts` source files
from exifreader and distribute those modifications, you must make the modified source files
available under MPL-2.0. Unmodified use and distribution (as done here) carries no extra obligation
beyond preserving copyright notices.

**LGPL-3.0-or-later (`@img/sharp-win32-x64`)** — This package bundles libvips. The LGPL requires
that end users can replace the LGPL-covered library with a modified version (relinking right).
The native `.node` addon loads the libvips DLL dynamically; users may replace `libvips-42.dll`
with a compatible build. Source for libvips is available at https://github.com/libvips/libvips.

---

## Native / Bundled Binaries (not in npm scan)

### Real-ESRGAN x4plus AI model (`resources/models/RealESRGAN_x4plus.onnx`, `…/real_esrgan_x4plus.data`)

- **Use:** AI super-resolution upscale in the Enhance module (run via onnxruntime-node + DirectML).
- **License:** BSD 3-Clause — **Copyright (c) 2021, Xintao Wang** (the Real-ESRGAN project).
- **Source:** https://github.com/xinntao/Real-ESRGAN (ONNX export via the Qualcomm AI Hub model
  `qualcomm/Real-ESRGAN-x4plus`, which inherits the upstream BSD-3-Clause license).
- **Obligation (BSD-3-Clause):** This binary redistribution reproduces the copyright notice, the
  list of conditions, and the disclaimer (below). The author's name is not used to endorse or
  promote this product.

  > Redistribution and use in source and binary forms, with or without modification, are permitted
  > provided that the following conditions are met: (1) Redistributions of source code must retain
  > the above copyright notice, this list of conditions and the following disclaimer. (2)
  > Redistributions in binary form must reproduce the above copyright notice, this list of
  > conditions and the following disclaimer in the documentation and/or other materials provided
  > with the distribution. (3) Neither the name of the copyright holder nor the names of its
  > contributors may be used to endorse or promote products derived from this software without
  > specific prior written permission. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND
  > CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES ARE DISCLAIMED. IN NO EVENT SHALL
  > THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DAMAGES ARISING IN ANY WAY OUT OF THE
  > USE OF THIS SOFTWARE.

### NAFNet-GoPro AI motion-deblur model (`resources/models/NAFNet-GoPro-width32.onnx`)

- **Use:** AI motion deblur ("Motion deblur (AI)") in the Enhance module (run via onnxruntime-node +
  DirectML). A single self-contained ONNX (weights inline), opset 11, dynamic input size.
- **License:** **MIT — Copyright (c) 2022 megvii-model** (the NAFNet project). Portions derived from
  **BasicSR are Apache-2.0 — Copyright (c) 2020 BasicSR authors / XPixelGroup**.
- **Source:** https://github.com/megvii-research/NAFNet (upstream, MIT). ONNX export distributed by
  ailia-models (`https://storage.googleapis.com/ailia-models/nafnet/NAFNet-GoPro-width32.onnx`); the
  ailia `image_restoration/nafnet/LICENSE` reproduces the megvii MIT text.
- **Obligation (MIT):** This binary redistribution reproduces the copyright notice and permission
  notice (below).
- **Obligation (Apache-2.0, BasicSR parts):** Retain the copyright notice and the NOTICE (if any);
  no trademark grant.

  > **MIT License — Copyright (c) 2022 megvii-model.** Permission is hereby granted, free of charge,
  > to any person obtaining a copy of this software and associated documentation files (the
  > "Software"), to deal in the Software without restriction, including without limitation the rights
  > to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
  > and to permit persons to whom the Software is furnished to do so, subject to the above copyright
  > notice and this permission notice being included in all copies or substantial portions of the
  > Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
  > INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE
  > AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
  > DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  > OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### LibRaw (`vendor/libraw/dcraw_emu.exe`, `vendor/libraw/libraw.dll`)

- **License:** LGPL-2.1 OR CDDL-1.0 (dual-licensed; this project invokes dcraw_emu as a
  separate subprocess and dynamically links libraw.dll)
- **Homepage:** https://www.libraw.org/
- **Obligation (LGPL):** Users may replace `libraw.dll` with a compatible modified build.
  Source code for LibRaw is available at https://github.com/LibRaw/LibRaw.

### libvips (`libvips-42.dll`, `libvips-cpp.dll`, bundled by `@img/sharp-win32-x64`)

- **License:** LGPL-2.1-or-later
- **Homepage:** https://github.com/libvips/libvips
- **Obligation (LGPL):** Dynamically linked; users may replace the DLL with a compatible build.
  Source available at https://github.com/libvips/libvips.

### Microsoft Visual C++ Runtime (`msvcp140.dll`, `vcruntime140.dll`, `vcruntime140_1.dll`)

- **License:** Microsoft Visual C++ Redistributable License (Visual Studio redistribution terms)
- **Bundled to satisfy:** LibRaw's runtime dependency on the MSVC runtime.
- Redistribution permitted per Microsoft's redistribution guidelines for Visual C++ redistributables.

### Electron + Chromium + Node.js (runtime, packaged by electron-builder)

- **Electron:** MIT — https://github.com/electron/electron
- **Chromium:** BSD-3-Clause and other open-source licenses (see `LICENSES.chromium.html` bundled
  in the packaged app by electron-builder)
- **Node.js:** MIT — https://nodejs.org/
- electron-builder automatically bundles Electron's `LICENSE` and `LICENSES.chromium.html` inside
  the packaged application.

### ICC Color Profiles (`assets/icc/*.icc`)

- Generated from published colorimetric specifications (sRGB IEC 61966-2-1, AdobeRGB 1998,
  ProPhoto RGB, ITU-R BT.2020).
- Freely redistributable; no additional attribution required.

---

*Generated for Photo Editor Pro v1.9.0 — 2026-06-30*
*Source: `pnpm licenses list --prod --json` (full transitive production closure, build tools excluded)*
