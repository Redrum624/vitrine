# Third-Party Licenses — Vitrine

Vitrine bundles the third-party components below. Each is licensed under its own terms
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

  > **Apache License, Version 2.0, January 2004 — http://www.apache.org/licenses/ — Copyright (c)
  > 2020 BasicSR Authors (XPixelGroup), portions incorporated into NAFNet.**
  >
  > TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION
  >
  > 1. Definitions. "License" shall mean the terms and conditions for use, reproduction, and
  > distribution as defined by Sections 1 through 9 of this document. "Licensor" shall mean the
  > copyright owner or entity authorized by the copyright owner that is granting the License.
  > "Legal Entity" shall mean the union of the acting entity and all other entities that control,
  > are controlled by, or are under common control with that entity. For the purposes of this
  > definition, "control" means (i) the power, direct or indirect, to cause the direction or
  > management of such entity, whether by contract or otherwise, or (ii) ownership of fifty
  > percent (50%) or more of the outstanding shares, or (iii) beneficial ownership of such
  > entity. "You" (or "Your") shall mean an individual or Legal Entity exercising permissions
  > granted by this License. "Source" form shall mean the preferred form for making modifications,
  > including but not limited to software source code, documentation source, and configuration
  > files. "Object" form shall mean any form resulting from mechanical transformation or
  > translation of a Source form, including but not limited to compiled object code, generated
  > documentation, and conversions to other media types. "Work" shall mean the work of
  > authorship, whether in Source or Object form, made available under the License, as indicated
  > by a copyright notice that is included in or attached to the work. "Derivative Works" shall
  > mean any work, whether in Source or Object form, that is based on (or derived from) the Work
  > and for which the editorial revisions, annotations, elaborations, or other modifications
  > represent, as a whole, an original work of authorship. "Contribution" shall mean any work of
  > authorship, including the original version of the Work and any modifications or additions to
  > that Work or Derivative Works thereof, that is intentionally submitted to Licensor for
  > inclusion in the Work by the copyright owner or by an individual or Legal Entity authorized to
  > submit on behalf of the copyright owner. "Contributor" shall mean Licensor and any individual
  > or Legal Entity on behalf of whom a Contribution has been received by Licensor and
  > subsequently incorporated within the Work.
  >
  > 2. Grant of Copyright License. Subject to the terms and conditions of this License, each
  > Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-
  > free, irrevocable copyright license to reproduce, prepare Derivative Works of, publicly
  > display, publicly perform, sublicense, and distribute the Work and such Derivative Works in
  > Source or Object form.
  >
  > 3. Grant of Patent License. Subject to the terms and conditions of this License, each
  > Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-
  > free, irrevocable (except as stated in this section) patent license to make, have made, use,
  > offer to sell, sell, import, and otherwise transfer the Work, where such license applies only
  > to those patent claims licensable by such Contributor that are necessarily infringed by their
  > Contribution(s) alone or by combination of their Contribution(s) with the Work to which such
  > Contribution(s) was submitted. If You institute patent litigation against any entity
  > (including a cross-claim or counterclaim in a lawsuit) alleging that the Work or a
  > Contribution incorporated within the Work constitutes direct or contributory patent
  > infringement, then any patent licenses granted to You under this License for that Work shall
  > terminate as of the date such litigation is filed.
  >
  > 4. Redistribution. You may reproduce and distribute copies of the Work or Derivative Works
  > thereof in any medium, with or without modifications, and in Source or Object form, provided
  > that You meet the following conditions: (a) You must give any other recipients of the Work or
  > Derivative Works a copy of this License; (b) You must cause any modified files to carry
  > prominent notices stating that You changed the files; (c) You must retain, in the Source form
  > of any Derivative Works that You distribute, all copyright, patent, trademark, and attribution
  > notices from the Source form of the Work, excluding those notices that do not pertain to any
  > part of the Derivative Works; and (d) If the Work includes a "NOTICE" text file as part of its
  > distribution, then any Derivative Works that You distribute must include a readable copy of
  > the attribution notices contained within such NOTICE file, in at least one of the following
  > places: within a NOTICE text file distributed as part of the Derivative Works; within the
  > Source form or documentation, if provided along with the Derivative Works; or, within a
  > display generated by the Derivative Works, if and wherever such third-party notices normally
  > appear. You may add Your own attribution notices within Derivative Works that You distribute,
  > alongside or as an addendum to the NOTICE text from the Work, provided that such additional
  > attribution notices cannot be construed as modifying the License. You may add Your own
  > copyright statement to Your modifications and may provide additional or different license
  > terms and conditions for use, reproduction, or distribution of Your modifications, or for any
  > such Derivative Works as a whole, provided Your use, reproduction, and distribution of the
  > Work otherwise complies with the conditions stated in this License.
  >
  > 5. Submission of Contributions. Unless You explicitly state otherwise, any Contribution
  > intentionally submitted for inclusion in the Work by You to the Licensor shall be under the
  > terms and conditions of this License, without any additional terms or conditions.
  > Notwithstanding the above, nothing herein shall supersede or modify the terms of any separate
  > license agreement you may have executed with Licensor regarding such Contributions.
  >
  > 6. Trademarks. This License does not grant permission to use the trade names, trademarks,
  > service marks, or product names of the Licensor, except as required for reasonable and
  > customary use in describing the origin of the Work and reproducing the content of the NOTICE
  > file.
  >
  > 7. Disclaimer of Warranty. Unless required by applicable law or agreed to in writing, Licensor
  > provides the Work (and each Contributor provides its Contributions) on an "AS IS" BASIS,
  > WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without
  > limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or
  > FITNESS FOR A PARTICULAR PURPOSE. You are solely responsible for determining the
  > appropriateness of using or redistributing the Work and assume any risks associated with Your
  > exercise of permissions under this License.
  >
  > 8. Limitation of Liability. In no event and under no legal theory, whether in tort (including
  > negligence), contract, or otherwise, unless required by applicable law (such as deliberate and
  > grossly negligent acts) or agreed to in writing, shall any Contributor be liable to You for
  > damages, including any direct, indirect, special, incidental, or consequential damages of any
  > character arising as a result of this License or out of the use or inability to use the Work
  > (including but not limited to damages for loss of goodwill, work stoppage, computer failure or
  > malfunction, or any and all other commercial damages or losses), even if such Contributor has
  > been advised of the possibility of such damages.
  >
  > 9. Accepting Warranty or Additional Liability. While redistributing the Work or Derivative
  > Works thereof, You may choose to offer, and charge a fee for, acceptance of support, warranty,
  > indemnity, or other liability obligations and/or rights consistent with this License. However,
  > in accepting such obligations, You may act only on Your own behalf and on Your sole
  > responsibility, not on behalf of any other Contributor, and only if You agree to indemnify,
  > defend, and hold each Contributor harmless for any liability incurred by, or claims asserted
  > against, such Contributor by reason of your accepting any such warranty or additional
  > liability.
  >
  > END OF TERMS AND CONDITIONS

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

*Generated for Vitrine v1.24.0 — 2026-07-12*
*Source: `pnpm licenses list --prod --json` (full transitive production closure, build tools excluded)*
