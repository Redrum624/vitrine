# Changelog

All notable changes to **Vitrine** (formerly Photo Editor Pro) are documented in
this file. The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.35.0] - 2026-07-20

### Fixed
- **The packaged app's image workers never worked — every heavy pass ran on the UI thread.** Cause (two stacked): Vite never bundled the worker (the `new URL()` / `new Worker()` split across two modules defeated its static detection, so the installed app shipped raw TypeScript as the worker file — dev-mode transpilation masked it, meaning the v1.29.0 "worker revival" only ever worked in dev), and Chromium blocks ALL `file://` worker scripts anyway. Fix: the worker is now a compiled chunk booted from a `blob:` URL in the packaged app (dev unchanged), with contract tests pinning the whole arrangement. Verified live: pool init 189 ms, a ≥1MP pass through a real worker in 62 ms. Affects: `src/workers/createPipelineWorker.ts` (new), `vite.config.ts`, `src/services/WebWorkerImageProcessor.ts`.
- **Batch export was pathologically slow (75 JPEGs ≈ 1h30, ~72 s/photo).** Causes: a stale "workers may differ" safety flag forced every export onto the single UI thread (workers were dead anyway — see above); the sharpen chain's Richardson-Lucy deconvolution paid per-pixel boundary clamps in its hottest loop; photos were decoded, processed, and encoded strictly one at a time. Fixes: exports route through the worker pool (with proof: outputs SHA256-identical to the old path), the blur inner loop is 3× faster bit-identically, and the batch pipelines decode-ahead and encode overlap. Measured live: 34.7 s → 18.1 s/photo on 20MP JPEGs with sharpening (steady-state ~16 s). Guardrails kept: noise-reduction exports stay on the main thread (their GPU path lives there), small exports (≤4096 px) keep their GPU passes, and the exposure stage still clamps after a vignetting correction. Affects: `src/services/MultiExportService.ts`, `src/services/exportRouting.ts` (new), `src/utils/enhanceOps.ts`, `src/utils/enhanceRestore.ts`, `src/services/ImageProcessingPipeline.ts`, `src/components/Dialogs/ExportDialog.tsx`.
- **Motion deblur could bake corrupted regions into the photo and froze the UI.** Causes: the NAFNet model deterministically garbles some bright/high-contrast windows (outputs at ±28 where valid data is 0–1) and nothing checked; independent 768 px windows with a 40 px feather disagree across long motion streaks (ghost seams); the finishing pass ran the whole frame on the UI thread; and the develop pass cached ~320 MB per module for nothing. Fixes: every tile output is sanity-checked (a garbled window keeps its original pixels and you're told how many were skipped), DirectML runs 1536 px windows with a 128 px feather, the finishing pass runs in the revived enhance worker (UI stays responsive), and bake develop passes no longer populate caches. Affects: `electron/aiDeblur.cjs`, `src/services/EnhanceService.ts`, `src/utils/createEnhanceWorker.ts` (new), `src/services/EnhanceWorkerClient.ts`.
- **Switching photos during an Enhance/AI bake could write the previous photo's pixels, revert point, and saved edits onto the new photo.** Cause: no identity re-check after the minutes-long develop + inference awaits, while the filmstrip stays clickable. Every bake now captures the target photo's identity up front and cleanly cancels (with a notice) if you've moved on; every bake result is also size- and sanity-validated before it may replace the working base — the v1.32.0 corruption class is now guarded at its highest-consequence write. A crashed or hung enhance worker now rejects cleanly (watchdog) instead of leaving the panel stuck busy. Affects: `src/services/EnhanceService.ts`, `src/services/EnhanceWorkerClient.ts`, `src/services/EditPersistenceService.ts`.
- **AI upscale on a machine without GPU acceleration silently ran on the CPU — a 20MP ×2 upscale meant ~2,000 tiles and over an hour, uncancellable.** The AI route is now available only when the model actually runs on DirectML; otherwise the deterministic (Lanczos) upscaler serves the same request at the same scale. Affects: `electron/aiUpscaler.cjs`, `src/services/EnhanceService.ts`.

## [1.34.2] - 2026-07-19

### Fixed
- **Starting a crop on a 90°-rotated photo snapped it back to the original rotation.** Cause: the re-crop "show the full frame" suspension disabled the whole crop module — which now also owns the quarter-turn orientation. The suspension now zeroes only the crop rect (orientation, straighten angle, and flips keep applying), and a plain handle click restores the rect losslessly. Also fixed: the 'Original' aspect lock used the unrotated frame's ratio under 90°/270°, forcing landscape crops inside a portrait frame — it now follows the rotated frame. Affects: `src/components/Layout/Canvas.tsx`, `src/modules/CropModule.ts`.
- **Straightening left the exposed non-photo wedges visible.** The ±2°/±5° chips and Auto-Straighten never applied the auto-crop, and the slider only did with no existing crop. All straighten entry points now end wedge-free: the largest inscribed crop is applied (or intersected with your existing crop), orientation-aware. Affects: `src/components/Modules/CropModuleComponent.tsx`.

### Changed
- **Before/After: the Before pane now shows the 90° rotation too.** Comparing a rotated After against an unrotated Before was useless; the Before stays otherwise pristine (no crop/straighten/edits). Affects: `src/App.tsx`.

## [1.34.1] - 2026-07-19

### Fixed
- **Auto Basic Adjustments could darken a well-exposed photo (−0.5 stops, histogram dragged left).** Cause: the v1.33.0 standalone exposure targeted the style-profile bucket medians — post-edit portfolio statistics (the dark bucket sits at ~0.07 median), so a decent photo classified into a dark-leaning bucket was yanked down at full gain. Fix: standalone exposure now targets a NEUTRAL median (0.40) with a dead zone and an asymmetric clamp — strong lifts for dark shots (up to +0.7), cautious ceiling on darkening (−0.35, and only for genuinely bright medians); style grading remains Auto All's job. Verified: well-exposed scene now gets a subtle refinement with zero darkening, the dark sunset still gets its clear lift. Affects: `src/services/AutoAdjustService.ts`.

## [1.34.0] - 2026-07-19

### Changed
- **The Crop & Transform ±1° nudge arrows are now 90° rotation buttons.** Each click rotates the photo a lossless quarter-turn (clockwise / counter-clockwise, pure pixel remap — no resampling), swapping the frame for portrait/landscape; four clicks return exactly to the original. Fine straightening still lives in the Rotation slider and the ±2°/±5° chips. The orientation persists with the photo's edits and applies before flips, straightening, and the crop rect. Also fixed along the way: on a freshly opened photo, panel-driven crop edits (rotation slider, flips, ratios) could silently not render until an app restart — the same adapter-enable gate as the v1.29.0 interactive-crop fix, now mirrored for panel edits too. Affects: `src/modules/CropModule.ts`, `src/modules/CropPipelineModule.ts`, `src/components/Modules/CropModuleComponent.tsx`, `src/components/Panels/AdjustmentPanel.tsx`.

## [1.33.0] - 2026-07-19

### Changed
- **The Basic Adjustments card's ⚡ Auto is much stronger.** Cause of the old timidity: exposure was hardcoded to zero (correct inside Auto All, where the Exposure module owns it — but the card's own Auto never touches that module, so under/over-exposed photos got no exposure correction at all) and the remaining gains were whisper-level (brightness capped at 2.5% of its range). Standalone Auto now corrects exposure toward your style profile's target (up to ±0.7 stops) with proportionally stronger contrast/brightness/saturation moves; Auto All's composed look is unchanged (frozen at the original gentler numbers). Live-verified on two RAW scenes: clearly visible, balanced corrections without blowout. Affects: `src/services/AutoAdjustService.ts`, `src/components/Modules/BasicAdjustmentsModuleComponent.tsx`.

## [1.32.0] - 2026-07-19

### Fixed
- **Exports with Noise Reduction came out shredded (repeated strips at the top, black below).** Cause: the CPU "wavelet" denoiser was an unfinished placeholder — its no-op transforms returned a quarter-resolution buffer, and auto-selection routed EVERY image above 1MP into it. Only exports were affected because previews always use the GPU denoiser; the CPU path runs when the image exceeds the single-pass GPU size cap. Fixes: full-resolution denoise now runs the SAME GPU NLM kernel in seam-free tiles (exports match the preview's look); the stub is an honest, logged identity; the module validates every output buffer; and the pipeline itself now skips any module whose output size lies (buffer-conservation guard) so this entire corruption class is dead. Affects: `src/services/AdvancedDenoisingService.ts`, `src/modules/NoiseReductionModule.ts`, `src/services/ImageProcessingPipeline.ts`.

### Changed
- **Lens Corrections no longer has per-section enable checkboxes.** A correction is active exactly when its values are non-neutral (amount ≠ 0, radius > 0, …) — sliders are always live, a small accent dot marks active sections, and neutral settings cost nothing. Affects: `src/components/Modules/LensCorrectionsModuleComponent.tsx`.

### Added
- **Enhance settings are remembered.** Sharpen/upscale toggles, scale, detail sliders, chroma clean, and the Noise Reduction toggle/strength persist across pictures and sessions (durable store, debounced). A photo's own saved enhance state always wins; prefs only seed a panel at factory defaults. Applying remains an explicit per-photo action. Affects: `src/utils/enhancePrefsStorage.ts` (new), `src/components/Modules/EnhanceModuleComponent.tsx`.

## [1.31.0] - 2026-07-19

### Added
- **RAW Decode settings are remembered.** The decode options you last chose (demosaic algorithm, highlight mode, Camera match) become the default for RAW files you haven't opened before — across pictures and across sessions. Committed whenever a re-decode you triggered in the RAW Decode panel succeeds; each already-opened photo still keeps its own saved per-image options, and batch exports of never-opened RAWs use the same defaults so they render exactly as opening them would. Stored in the main-process durable store — a renderer localStorage write was proven to vanish when the app quits soon after. Affects: `src/utils/rawDecodeDefaultsStorage.ts` (new), `src/services/RawImageService.ts`, `src/components/Layout/Canvas.tsx`, `src/services/ImageService.ts`.

### Fixed
- **Changing the star filter snapped the filmstrip back to the beginning.** Cause: the filtered list shrinks, the old scroll offset clamps toward zero, and nothing re-anchored. The strip now re-centers the current picture after a filter change — or, when the filter hides it, the nearest surviving photo in folder order. Affects: `src/components/Panels/ThumbnailPanel.tsx`.

## [1.30.0] - 2026-07-19

### Fixed
- **Exporting a cropped photo produced a shredded image (content squeezed into the top of the frame, black band at the bottom).** Cause: with a crop active the pipeline returns a SMALLER buffer and reports the post-crop dimensions by mutating the processing context in place — but both export paths encoded that buffer with the ORIGINAL dimensions, so the encoder ran out of rows. Latent for months: until v1.29.0 fixed the crop adapter gate, interactive crops were pipeline no-ops and the export path never saw a crop-shrunk buffer. Fix: both single and multi export now read the post-crop context dims; regression tests pin the contract (including a pipeline-wide channel/length conservation suite). Affects: `src/components/Dialogs/ExportDialog.tsx`, `src/services/MultiExportService.ts`.

### Changed
- **Exported filenames now use the `_VIT` suffix** (Vitrine) instead of the pre-rebrand `_PEP` (Photo Editor Pro), e.g. `photo_VIT.jpg`. Affects: `src/utils/exportFilename.ts`, `src/services/ExportService.ts`.
- **Single exports never overwrite an earlier export.** If `photo_VIT.jpg` already exists the name auto-increments (`photo_VIT_1.jpg`, `photo_VIT_2.jpg`, …), matching the multi-export behaviour. Affects: `src/services/ExportService.ts`.

### Added
- **Export settings are remembered.** The Export dialog restores the last-used format, quality, bit depth, color space, compression, sharpening, and output folder across sessions (per-image values like resize dimensions are never persisted). Affects: `src/utils/exportSettingsStorage.ts` (new), `src/components/Dialogs/ExportDialog.tsx`.
- **Star-filtered thumbnails appear faster.** Right after a folder's ratings load, the rated photos' thumbnails are prefetched in the background at idle priority (they are exactly what filters reveal), and the decode queue runs six-wide — so clicking a filter chip shows thumbnails near-instantly instead of decoding on demand. Affects: `src/App.tsx`, `src/utils/thumbnailScheduler.ts`.

## [1.29.0] - 2026-07-19

### Changed
- **Crop tool reworked around apply-on-release.** The crop overlay now appears the moment the Crop & Transform module opens (no click-on-the-image needed) and stays up while it's open. Releasing a handle applies the crop to the preview immediately; grabbing a handle again brings the full picture back with the rect at its last position, so re-cropping always happens against the whole frame. Why: the old flow (arm by clicking the image, apply only when the overlay closed) read as "the crop does nothing". Affects: `src/components/Layout/Canvas.tsx`, `src/components/Canvas/InteractiveCropHandles.tsx`.

### Added
- **Side handles on the crop rect, always.** The n/s/e/w mid-edge handles now render with a locked aspect ratio too (they used to vanish): edge drags resize keeping the ratio (opposite edge fixed, the other axis scales around its center) and corner drags follow the dominant axis. Affects: `src/components/Canvas/InteractiveCropHandles.tsx`.
- **Preview quality ratchet.** Zooming past an image's previous farthest zoom — or applying a crop, which magnifies what's left — now re-renders the preview from a higher-resolution source (base 1024px long edge, ratcheted up to 4096px or the file's native size), so zoomed and cropped views regain fit-view sharpness instead of showing upscaled preview pixels. The cap resets per image and only ever ratchets up, debounced so continuous zooming triggers one refresh at rest. Why: the preview pipeline always processed a 1024px source and both render paths upscale it. Affects: `src/utils/previewQuality.ts` (new), `src/stores/appStore.ts`, `src/components/Layout/Canvas.tsx`, `src/components/Panels/AdjustmentPanel.tsx`.

### Fixed
- **Interactive crops never actually applied to the preview.** Cause: the drag path enabled only the inner CropModule while `CropPipelineModule.process()` gates on the adapter-level `isEnabled` too — which every image open resets to false — so the crop rendered in the overlay but was a pipeline no-op until an app restart restored it. Fix: apply goes through `setCropRegion` (enables both), with a regression test pinning the gate. Affects: `src/components/Layout/Canvas.tsx`, `src/test/cropAdapterGate.test.ts`.
- **CPU worker pool was dead on arrival — ≥1MP previews froze on "Applying…" for 30–60 s.** Cause: the Logger singleton registered `window` listeners at module scope; the pipeline worker imports it transitively, so the whole worker bundle crashed at evaluation ("window is not defined"), INITIALIZE never got answered, and callers sat through stacked 30-second dead-worker timeouts (the store's `isProcessing` flag — and the spinner — stuck the whole time). Invisible until now because 1024px previews sit below the 1MP worker threshold. Fix: worker-safe Logger guards; worker `error` events reject all pending requests immediately; failed initialization is sticky, tears down the half-built pool, and routes subsequent big frames to the main thread (`workersHealthy` in preview routing). Regression-tested by importing the pipeline in a windowless environment. Affects: `src/utils/Logger.ts`, `src/services/WebWorkerImageProcessor.ts`, `src/services/previewRouting.ts`, `src/components/Panels/AdjustmentPanel.tsx`.
- **Crop handles could be unclickable at the image edge.** Cause: handles centered on the rect edge overhang the canvas box; with the box flush against the photo region (maximized fit, zoomed in) the overflow-clipped half stopped being hit-testable. Fix: handles clamp fully inside the canvas box. Affects: `src/components/Canvas/InteractiveCropHandles.tsx`.

## [1.28.1] - 2026-07-19

### Fixed
- **Rating filter left rated photos invisible after a restart.** Cause: the store's `imageRatings` starts empty each session and was seeded ONLY by the lazy per-tile thumbnail loads — a rated photo whose tile never mounted (deep in a large folder, never scrolled near) simply didn't match any filter. Fix: an eager seeding pass reads every file's persisted xmp:Rating on folder load (bounded concurrency, deduped by path, canceled by folder switch); the lazy seeds stay as backup. Live-verified: 25-RAW folder, deepest file pre-rated on disk, ≥1★ applied with zero scrolling → the photo appears. Affects: `src/utils/ratingSeeder.ts` (new), `src/App.tsx`.
- **Filtered thumbnails were not generated in priority.** Cause: every mounted tile fired its `readImageAsDataURL` IPC immediately and the main process served them in arrival order — applying a rating filter on a big folder queued the newly-revealed tiles' decodes BEHIND the whole pre-filter window, so the photos the user asked to see rendered last. Fix: a shared priority queue for gallery + filmstrip thumbnail fetches — max 4 in flight, newest visible batch first (FIFO within a batch), re-requests bump queued tiles — so a filter or scroll change always jumps ahead of stale work. Live-verified: filtered RAW thumbnail decoded 386 ms after the filter click. Affects: `src/utils/thumbnailScheduler.ts` (new), `src/components/Gallery/GalleryView.tsx`, `src/components/Panels/ThumbnailPanel.tsx`.

## [1.28.0] - 2026-07-17

### Added
- **Star ratings on filmstrip thumbnails.** Rated photos show a small gold star strip on their dock thumbnail, so the culled/kept signal is visible at a glance without opening the Gallery. Affects: `src/components/Panels/ThumbnailPanel.tsx`.
- **Sharper RAW thumbnails.** The embedded-preview thumbnail for RAW files is now rendered into a 512px box (was 300×200 — portrait previews were squeezed to 150×200 and upscaled ~3× on 420px gallery tiles, visibly soft). Affects: `electron/main.cjs`.

### Changed
- **Filmstrip tiles follow each photo's aspect ratio.** Cause of the old distortion: fixed 66/114×88 tiles with cover-fit cropped portraits to a horizontal band and the current landscape to a sliver. Tiles now size to the photo's own aspect (clamped 56–132px wide at constant 88px height), so portraits and landscapes both display whole. Affects: `src/components/Panels/ThumbnailPanel.tsx`.

### Fixed
- **Number-key rating was dead in the Gallery.** Cause: the global shortcuts service swallows matched keys at capture phase (preventDefault + stopPropagation) before its handler runs; the rating digits' handler no-ops in Gallery by design, but the swallow meant GalleryView's own bubble-phase 1–5/0 selection-rating listener never received the keypress. Fix: shortcuts gain a `when` applicability gate evaluated BEFORE the swallow — an inapplicable shortcut lets the event flow through untouched (same pattern the numpad rating path already used). Live-verified: click a tile, press 3, stars fill. Affects: `src/services/KeyboardShortcutsService.ts`, `src/App.tsx`.

## [1.27.0] - 2026-07-17

### Changed
- **Auto All softens itself on a camera-matched base.** Cause: the one-click style grade targets ABSOLUTE portfolio statistics (e.g. the warm bucket's median-luminance target of 0.33), which is correct on Vitrine's neutral decode but double-grades a camera-matched base — the camera's own tone mapping plus the full portfolio pull crushed bright scenes into a dark, muddy render that users read as "the decoder is broken" (verified live on a 20MP garden portrait). Fix: when the current base is camera-matched, Auto All runs at half strength — every adjustment lerps toward its neutral value — and skips auto white balance entirely (the matched base already carries the camera's WB decision); the toast says so. Affects: `src/services/AutoAdjustService.ts` (strength option + `CAMERA_MATCHED_AUTO_STRENGTH`), `src/App.tsx`.

### Added
- **"Styled" toolbar chip.** Shows next to Auto All whenever a style grade (Auto All, a preset, or a pasted style) is layered on the decode, with a tooltip explaining that the on-screen colors come from those adjustments, not the RAW render — so a heavy grade can no longer masquerade as a decode problem. Live-detected from the grade's signature params (non-identity base curve / Color Balance offsets), so resetting those modules clears it automatically. Affects: `src/App.tsx`, `src/components/Layout/Toolbar.tsx`.

### Fixed
- **The Camera match checkbox appeared frozen for the duration of the re-decode.** Cause: a controlled input bound to store options that only update after the multi-second decode resolves — clicking produced no visual change for up to ~10 s on 20MP files, so users clicked repeatedly believing it was dead. Fix: optimistic pending state — the box flips immediately, then settles on the store truth when the decode lands. Affects: `src/components/Panels/RawDecodePanel.tsx`.

## [1.26.0] - 2026-07-15

### Added
- **Camera match render mode — RAW opens now match the out-of-camera look by default.** Why: Vitrine's neutral decode (LibRaw auto-brighten + generic color matrices) rendered visibly brighter and punchier than the manufacturer's engine — measured at ΔE76 14–25 against OM Workspace on real ORFs — and photographers asked for the camera's rendering as the starting point. A single global "look" profile cannot deliver that (in-camera processing is per-shot adaptive: picture modes, adaptive gradation — a 56-image corpus fit plateaued at ΔE ≈ 16). Instead, every RAW carries its own ground truth: the full-size embedded camera JPEG. At decode time Vitrine now fits a compact per-image transform (ridge-regularised linear matrix + monotone per-channel curves + a perceptually-weighted, smoothing-regularised 13³ residual LUT) against that shot's own preview — orientation-aligned — and applies it to the full-resolution 16-bit decode in a worker thread. Measured on the documented 4-photo comparison set: ΔE76 vs Workspace dropped to 1.2–4.7 (the measurement floor between Workspace and the camera itself is ~0.8–1.1). Brand-agnostic by construction (verified on Olympus ORF; the fit targets whatever preview the camera embedded). Toggle per image in the RAW Decode panel; existing edited photos keep their exact look (persisted decode options without the flag decode unmatched); the disk base cache keys the flag so both variants coexist. Known limitation, documented honestly: scenes where the camera's local tone mapping gives the same input color different treatments by position (e.g. deep-shadow foliage in a backlit sunset) retain a slight residual — a global color mapping cannot express position-dependent processing. Affects: `electron/cameraMatch.cjs` + `electron/cameraMatchWorker.cjs` (new), `electron/rawDecoder.cjs` (`-W` + fail-open post-pass on the demosaic rungs), `electron/baseCache.cjs`, `src/types/electron.ts`, `src/services/EditPersistenceService.ts`, `src/services/ImageService.ts`, `src/components/Panels/RawDecodePanel.tsx`.
- **Color fidelity comparison published.** README gains a "Color fidelity" section with a Camera JPEG / OM Workspace / Vitrine side-by-side grid (`docs/shots/color-fidelity.jpg`) and the measured ΔE numbers, methodology disclosed.

## [1.25.0] - 2026-07-15

### Added
- **Portable build.** Why: photographers asked for a way to try Vitrine without running an installer or having admin rights — download `Vitrine <version> portable.exe`, run it from anywhere (USB stick included), delete it when done. It shares the same on-disk profile as the installed app, so edits and presets carry over. Note it is not a way around SmartScreen: like any downloaded unsigned executable it may still show the "unknown publisher" prompt on first run. Affects: `package.json` (win `portable` target), `scripts/collect-installer.cjs`, `scripts/gh-release.cjs`.
- **SHA256 checksums published with every release.** Why: lets users verify an unsigned download is byte-identical to what was built before running it. `scripts/gen-checksums.cjs` (new, wired into `build:win`) writes `SHA256SUMS.txt` covering the installer and the portable exe; it ships in `installer/`, uploads as a release asset, and is embedded in the GitHub release notes. Verify with `CertUtil -hashfile <file> SHA256`. Affects: `package.json`, `scripts/gen-checksums.cjs`, `scripts/collect-installer.cjs`, `scripts/gh-release.cjs`.
- **Microsoft Store (MSIX) build target.** Why: signed, SmartScreen-free distribution with automatic updates, without the cost of a code-signing certificate. `npm run build:store` produces `release/Vitrine <version>.appx` (unsigned — the Store signs on ingestion), with the account-specific Partner Center identity read from a gitignored `store-identity.json` (`scripts/build-store.cjs`); a clearly-labeled local test identity is used when the file is absent. Data continuity with the NSIS install was verified end-to-end on Windows 11 by the new `scripts/msix-smoke.cjs` (11/11: package identity, shared `%APPDATA%\photo_app`, NSIS-era edits and presets readable, RAW full-quality open, restart survival, profile left clean). Setup, submission steps, validation recipe, and Windows 10 caveats: `docs/STORE.md`.
- **winget distribution.** `Redrum624.Vitrine` submitted to the winget community repo against the v1.24.1 release (`winget install vitrine` once merged); per-release manifest maintenance documented in `docs/STORE.md`.

## [1.24.1] - 2026-07-12

### Fixed
- **Local Adjustments masks (circle and gradient) jumped to the top-left corner when adjusted.** Cause: the mask overlay derived its on-screen box and pointer origin from the 2D `<canvas>`, but that canvas is `display:none` in GPU render mode (the WebGL canvas presents instead), so `offsetWidth`/`getBoundingClientRect` were `0` — collapsing a mask's normalized centre `0.5` to screen `(0,0)`. Both mask types share the helper, so both were affected. Fix: read the box and rect from the overlay's own always-visible root element (correct in both CPU and GPU modes). Affects: `src/components/Canvas/LocalAdjustmentMaskOverlay.tsx`, `src/components/Layout/Canvas.tsx`.
- **Before/After sometimes showed a different photo (the previously-opened image's original).** Cause: the Before pane rebuilt its snapshot only when `baseImageVersion` bumped, but an ordinary open (JPEG/cache/plain) records the new original via `deferOriginalSnapshot()` without bumping it — only the in-place RAW full-decode swap does — so the pane kept the prior image's original. Fix: a dedicated `originalSnapshotVersion`, bumped whenever a new original is recorded (`deferOriginalSnapshot`/`setOriginalImage`) and folded into the pane's rebuild dependencies. Affects: `src/App.tsx`, `src/services/ImageService.ts`, `src/stores/appStore.ts`.

## [1.24.0] - 2026-07-12

### Changed
- **Upgraded the Electron runtime from 39 to 43** (Chromium 150, Node 24). Electron 39 had reached end-of-life and no longer received Chromium or Node security patches; moving to the current stable line restores that coverage. The app's Electron usage sits entirely on the long-lived core (`app` / `BrowserWindow` / `ipcMain` / `dialog` / `shell` / `Menu`) with modern security defaults already in place (context isolation, sandbox, no remote module), so the four-major bump needed **no application code changes**. Verified end-to-end on the new runtime: the full 1834-test suite, type-check, lint, a fresh installer build, and the packaged RAW smoke (progressive open + disk base cache, which exercises libraw-wasm's SharedArrayBuffer via the COOP/COEP header hook) all pass. The native modules (`sharp`, `onnxruntime-node`) are N-API prebuilds and load unchanged against Node 24. Affects: `package.json`, `pnpm-lock.yaml`.

## [1.23.0] - 2026-07-12

### Changed
- **The app is now named Vitrine.** "Photo Editor Pro" is retired in favor of *Vitrine* — French for a glass display case, and a nod to both a lens's glass and the app's glass UI. Tagline: *Develop. Display.* The rename covers the window title, splash, About dialog, installer (`Vitrine Setup X.Y.Z.exe`), Start Menu shortcut, README, and docs. **Your saved work is untouched:** the app's on-disk identity (the `photo_app` userData folder holding every image's edits, presets, and RAW cache) is deliberately pinned across the rename, and installs upgrade in place. Affects: `package.json` (productName/installer), `electron/main.cjs` (identity pin), and all user-facing brand strings.

## [1.22.0] - 2026-07-12

### Security
- **The file-write IPC is hardened against path-based escalation.** A three-pass adversarial review closed every Windows path-canonicalization bypass in the write-path policy: it now denies writes into user autorun sinks (Startup folder, PowerShell profile, `~/.ssh`) on top of system directories, enforces an extension allow-list on the raster/generic write handlers, and — the durable fix — *fails closed*, admitting only ordinary drive-letter and UNC-share roots and rejecting raw device-namespace paths that alias a normal volume under an unfoldable root, along with 8.3/short-name and symlinked parents. The accepted residuals are documented in the code and commit history. Affects: `electron/writePathPolicy.cjs` (new), `electron/main.cjs`.

### Fixed
- **A folder-browser listener leak.** Expanding/collapsing folders in the File Explorer registered a new IPC listener each time without removing it, causing redundant reloads over a long session; the listener is now registered once. Affects: `src/components/Layout/FileBrowser.tsx`.
- **Imported presets are validated at the trust boundary.** A hand-crafted or corrupt `.preset` file with a partial block could throw during apply; malformed blocks are now dropped (with a named notice) and unsalvageable presets skipped, rather than crashing the apply. Affects: `src/services/presetShapeValidation.ts` (new), `src/services/PresetService.ts`.
- Minor hardening: the unsaved-changes dialog escapes its message; a hung RAW wasm-fallback worker is now terminated on timeout; folder watchers are closed when the window closes; the sub-second shutter and preset validators from v1.21 were tightened.

### Changed
- **Dependencies pinned for reproducible builds.** The pnpm lockfile is now committed and the native binary dependencies (`sharp`, `onnxruntime-node`) are pinned to exact versions, so a fresh clone builds the same installer; the deprecated `@types/electron` stub was removed. A build now fails loudly if a bundled AI model is missing (from v1.21). Affects: `package.json`, `.gitignore`, `pnpm-lock.yaml`.
- Full pre-ship audit (dependency hygiene, security, memory) run and recorded — nine dimensions verified correctly bounded. A planned Electron major upgrade (39 is end-of-life) is tracked for a dedicated release.

## [1.21.0] - 2026-07-12

### Added
- **Edits made after an upscale or deblur now survive restarts.** Previously, adjustments made after baking an enhance result silently never saved (quitting lost them) — a deliberate v1 trade-off that protected your pre-bake edits. Now they persist alongside the bake intent: reopening the photo restores your pre-bake edits and the one-click Re-apply replays the bake *and* the edits you made on top, restoring exactly what you saw. Editing without re-applying starts a fresh timeline (the stale post-bake edits are discarded — the two histories never merge silently). AI deblur gains the same cross-session re-apply notice upscale already had. A second bake stacked on top of a first stays session-only (disclosed in the tooltip) — the disk record of your first bake and its edits is inviolate. Affects: `src/services/EditPersistenceService.ts`, `src/services/EnhanceService.ts`, `src/components/Modules/EnhanceModuleComponent.tsx`.

### Fixed
- **Crop, Exposure, Tone Curve, Color Balance, and Lens Corrections edits no longer vanish on reopen.** Cause: the per-image restore path could only apply params to modules exposing one specific setter name — five core modules were saved to disk but silently skipped on restore, so reopening rendered without those edits and the next save durably erased them (the same progressive-destruction class fixed for Local Adjustments in v1.18.0). Fix: the restore tries each module's real setter, and the three adapters that had no setter at all gained one; every module now has a round-trip regression test. This also repaired History undo/redo, batch export, and the enhance re-apply flow on cropped images. Affects: `src/services/EditPersistenceService.ts`, `src/modules/*PipelineModule.ts`.
- **Presets now capture Tone Curve, Color Balance, Shadows/Highlights, and Lens Corrections.** Cause: a type mismatch made preset capture silently throw and drop every module exposing its enabled state as a plain field — four modules never made it into any saved preset. Fix: the capture reads the field correctly; presets also capture the new Highlight Recovery strength. Old presets apply exactly as before (absent blocks leave your settings untouched); a follow-up review fix also made Lens Corrections presets genuinely apply (the first attempt threw into a swallowed error). Affects: `src/services/PresetService.ts`.
- **A fresh-clone build can no longer ship without the AI models.** The build now fails loudly listing any missing model file (with an explicit `ALLOW_MISSING_MODELS=1` escape hatch for deliberate CPU-only builds); previously both AI features would silently vanish from the installer. Affects: `scripts/preflight-models.cjs` (new), `resources/models/models.manifest.json` (new).
- AI motion deblur declines images over 160 MP with a clear notice instead of risking an out-of-memory failure; the multi-export "upscale not applied" notice names the affected photos; RAW metadata reads only the file header instead of the whole 25 MB file; sub-second shutter speeds between 0.5 s and 1 s display as decimals instead of "1/1 s".

### Changed
- The tiled-pipeline edge-mask normalization question (approximate under exposure shifts) was investigated to a written conclusion: the current bound is uniform, clamped, and within ~1.55× of exact at a worst-case +2 EV — the refinement would swap it for an equally approximate estimate at twice the cost. Documented in the code as deliberately closed.

## [1.20.0] - 2026-07-11

### Added
- **AI motion deblur.** A new opt-in "Motion deblur (AI)" control in Enhance runs NAFNet (MIT-licensed, bundled) on your GPU via DirectML — dramatic, artifact-free recovery of motion-blurred shots where deconvolution does nothing. It ships alongside the deterministic Deblur sliders (which remain better for defocus blur — the model is trained on motion blur only, so it is never applied automatically), with revert support and the AI badge. Hidden on machines without GPU acceleration. Affects: `electron/aiDeblur.cjs` (new), `src/services/EnhanceService.ts`, `src/components/Modules/EnhanceModuleComponent.tsx`.
- **Highlight reconstruction beyond LibRaw (M1).** A "Highlight recovery" slider on the RAW Decode panel reconstructs blown highlights where only one channel clipped (the common case — measured 100% of clipped pixels on the test RAW were red-only) by extrapolating from the surviving channels, with a smooth desaturation shoulder. Post-decode — no re-decode needed; default off; persists per image. Measured on a real blown-sun ORF: red-clipped pixels 12.95% → 0.52% with a natural render. Affects: `src/modules/HighlightRecoveryModule.ts` (new), `src/shaders/GpuPreviewPipeline.ts`, `src/components/Panels/RawDecodePanel.tsx`.

### Changed
- **Apply Enhance is ~30× faster.** The deterministic enhance chain (deconvolution, detail graft, sharpen, Lanczos upscale, chroma denoise) now runs as WebGL2 passes on the GPU: a 20 MP sharpen dropped from 42 s to 1.4 s, a 12→48 MP upscale from 65 s to 1.9 s — with bit-level agreement to the CPU chain (measured 7e-7) verified by startup self-tests that transparently fall back to the CPU path on any mismatch. Very large outputs (>96 MP) and >48 MP tiled processing stay on the CPU path unchanged. Affects: `src/shaders/GpuPreviewPipeline.ts`, `src/services/EnhanceService.ts`.

### Fixed
- Corrupt persisted upscale-intent data can no longer reach the Enhance panel (shape-validated like decode options); a partial revert of stacked upscales now persists the corrected intent immediately; the unsaved-changes close prompt now blocks global shortcuts like every other dialog and no longer leaks a listener that could swallow the next Escape press; ~800 lines of dead keyboard-workflow code removed.

## [1.19.0] - 2026-07-11

### Added
- **Camera EXIF for RAW files.** Click the filename chip to open an Info popover showing camera make/model, lens, ISO, shutter, aperture, focal length, and capture date — for every format. RAW containers (ORF, CR2, NEF, ARW, DNG, …) are read by a new dependency-free TIFF/EXIF parser in the main process (exifreader can't parse them); JPG/PNG/TIFF keep the existing path. Affects: `electron/rawMetadata.cjs` (new), `src/components/Layout/InfoPopover.tsx` (new), `src/services/CameraMetadataService.ts`.
- **Gallery tile context menu.** Right-click a tile for Open, Remove… (routes to the same confirmed dialog as Del — still the single destructive gate), and Show in Explorer. Right-clicking an unselected tile selects it; a selected tile keeps the multi-selection. Affects: `src/components/Gallery/GalleryTileContextMenu.tsx` (new), `electron/main.cjs`.
- **Upscale survives restarts (as intent).** Baked upscales now persist their intent (scale + AI/Standard) with the image's edits: reopening shows "Upscale ×N was applied — Re-apply to restore" with a one-click re-apply, and exporting a reopened-but-not-reapplied image warns explicitly instead of silently exporting at native resolution (the previous behavior — a silent-loss bug). Affects: `src/services/EnhanceService.ts`, `src/services/EditPersistenceService.ts`, `src/components/Dialogs/ExportDialog.tsx`.
- **Chroma noise and Detail radius sliders now work on AI upscales.** The AI route previously returned the model output verbatim, silently ignoring the enhance sliders; it now runs the same finishing stages as the standard route (deblur excluded by evidence — AI output is already sharp and deconvolution only rings), with a note in the panel. Affects: `src/utils/enhanceChain.ts`, `src/services/EnhanceService.ts`.

### Fixed
- **Dialogs now block every global shortcut.** Cause: only two of six document-level key listeners checked for open dialogs, so typing in a dialog field could rate files on disk, switch photos, or delete masks (this exact class was patched piecemeal three times before). Fix: one shared guard (`keyboardEventBlocked`) routed through all six listeners; the filmstrip's arrow/Esc listener also gained the input-field check it never had. Affects: `src/utils/keyboardScope.ts` (new), 6 listener sites.
- **Batch processing uses each image's own RAW decode options.** Cause: batch decoded every file with whatever options the open image had, and also swapped the open editor image per file as a side effect. Fix: batch routes through the per-image export decoder (per-image persisted options, no editor side effects, no cache churn). Affects: `src/services/BatchProcessingService.ts`.
- **Uniform sharpening across tiles in very large images.** Cause: the sharpen edge mask normalized per tile in the >48 MP path, producing a subtle per-tile intensity variation. Fix: a global edge maximum is computed once and threaded to all tiles (verified bit-exact against untiled processing). Also: a redundant processing pass eliminated on the sharpen Apply path. Affects: `src/utils/tiledPipeline.ts`, `src/utils/enhanceOps.ts`, `src/workers/pipeline.worker.ts`.
- A failed RAW re-decode now recovers instantly from the in-memory cache instead of a ~1 s disk read; corrupt persisted decode options can no longer reach the decoder from the canvas path; the AI/Standard badge and route hint reset when switching images.

## [1.18.0] - 2026-07-11

### Added
- **Delete photos from the Gallery.** Select any photos in Gallery view and press Del: a confirmation dialog offers "Remove from session" (default — just drops them from the open folder listing) or "Move to Recycle Bin" (never permanent deletion). Multi-select honored; if the open photo is removed the app advances to the next one; files that fail to trash stay listed and selected with an error notice. Affects: `src/components/Dialogs/GalleryRemoveDialog.tsx` (new), `src/utils/galleryRemove.ts` (new), `src/App.tsx`, `electron/main.cjs`, `electron/preload.cjs`.
- **Chroma noise and Detail radius sliders in Enhance.** The new luma-guided joint-bilateral chroma denoiser (smooths color noise without bleeding across luminance edges) and the deconvolution detail radius are now user-adjustable — both previously existed only as internal parameters no UI could reach. Affects: `src/components/Modules/EnhanceModuleComponent.tsx`, `src/utils/enhanceRestore.ts`.
- **Presets now capture and apply Local Adjustments.** Saving a preset records your radial/gradient mask layers (geometry, per-layer settings, order) and applying one restores them; presets saved before this version simply leave local adjustments untouched. Brush layers are excluded, with a note in the save dialog. Applying a preset also repaints immediately (previously the canvas showed stale pixels until the next edit). Affects: `src/services/PresetService.ts`, `src/components/Dialogs/PresetDialog.tsx`.
- **"Re-apply to update" hint in Enhance** — after Apply Enhance, editing any upstream adjustment shows a subtle hint on the Apply button so you know the enhanced result is stale.

### Fixed
- **Local Adjustments per-layer settings no longer vanish.** Cause: the edit-restore path applied each saved layer's geometry and opacity but never its adjustment values, so History undo/redo, image reopen, Enhance, and batch export all silently reset every mask's exposure/color settings to defaults — and the next save made the loss permanent. Fix: restore applies the saved per-layer parameters; regression tests cover the reopen and undo/redo paths. Affects: `src/services/EditPersistenceService.ts`.
- **Local Adjustments now run on the GPU.** Cause: a texture-upload ordering bug (upload before selecting the texture unit) corrupted a neighboring texture binding, failing the pipeline's startup self-test since v1.7.2 and silently gating the module to the CPU for every GPU user. Fix: select the unit first; the self-test now passes (measured GPU-vs-CPU agreement 1.19e-7). Affects: `src/shaders/GpuPreviewPipeline.ts`.
- **No more tile seams in very large images.** Cause: the CPU fallback pipeline (>48 MP) processed tiles as standalone images, so spatial filters (sharpen, noise reduction, blur, clarity) clamped at tile edges and produced visible seams. Fix: each tile now carries an apron of neighbor pixels sized to the enabled filters' true kernel reach (verified bit-exact against untiled processing). Affects: `src/utils/tiledPipeline.ts` (new), `src/services/WebWorkerImageProcessor.ts`.
- **Module previews are properly anti-aliased.** Cause: the panel preview downsampler picked every Nth pixel (aliasing/moiré on fine detail). Fix: area-averaged downsampling, computed once per image instead of on every slider drag. Affects: `src/components/Panels/AdjustmentPanel.tsx`, `src/utils/imageDownsample.ts` (new).
- **Grid and rulers track the image.** Cause: at zoom the grid/ruler overlays stayed pinned to the viewport instead of the photo. Fix: they now derive from the same shared viewport geometry as every other overlay; ruler ticks measure from the image origin. Also: the Before pane re-fits immediately when only the divider moves, and opening a tiny image (under 40 px) no longer hangs the canvas. Affects: `src/components/Layout/Canvas.tsx`, `src/utils/viewportGeometry.ts`, `src/utils/renderCacheHash.ts` (new).
- **RAW decode robustness batch**: cache entries now carry their decode-options provenance and the cache read verifies it; batch/export decodes no longer churn the 2 GB disk cache (write-through is interactive-only); a re-decode racing a background decode can no longer cause a wasteful double image swap; corrupt persisted decode options fall back to defaults; disk-cache hits skip a redundant 122 MB buffer copy. Affects: `src/services/ImageService.ts`, `src/services/RawImageService.ts`, `electron/baseCache.cjs`.
- Redundant processing pass eliminated when applying Noise Reduction + Upscale together (3 passes → 2).

### Changed
- **~17,000 lines of orphaned pre-Glass code removed** — eight unreachable module components (Copyright, old Lens Correction, old Noise Reduction, Output Collection, old Print, Watermark, Web Gallery, Luminosity Mask), seven unreachable services, the renderer-side iframe LibRaw fallback (provably inert — it re-ran the exact wasm the main process had already tried), the never-populated store `currentImage` field, and dead IPC surface. No user-visible behavior changed; the type-checker, full suite, and production build verify every removal. Affects: 40+ files deleted or trimmed.
- Toolbar Print/Copy Style/Paste Style now appear disabled while a RAW is still developing (the actions were already safely blocked); the Image Size dialog annotates preview dimensions honestly during that window; Shadows/Highlights got its own glyph (was sharing the Sun with Basic Adjustments); gallery, filmstrip, and file-browser tiles show clean format labels (ORF, JPG) instead of raw MIME strings.
- Internal: `processImage` takes an options object (23 call sites); eviction tests use an injected clock; the two-session progressive-open smoke test is now repo-owned at `scripts/smoke-progressive.cjs`.

## [1.17.0] - 2026-07-10

### Added
- **RAW full quality is now instant across sessions (disk-persisted base cache).** The decoded 16-bit base of every RAW you open is persisted to disk (up to 2 GB, least-recently-used entries evicted), so reopening a photo in a *later session* loads full quality from disk in about a second instead of re-running the multi-second LibRaw decode — measured in the packaged app on a 20 MP ORF: full quality at **1.2 s** from disk vs **7.5 s** cold (~6×), with the instant preview unchanged. Entries are keyed by file, decode options, and the file's modification time/size — editing the source file or changing demosaic/highlight options invalidates them automatically, and a degraded 8-bit fallback decode is never persisted. All v1.16.0 progressive-open guarantees are unchanged. Affects: `electron/baseCache.cjs` (new), `electron/main.cjs`, `electron/preload.cjs`, `src/services/RawImageService.ts`.

### Fixed
- **Enhance Revert can no longer restore another photo's pixels.** Cause: the upscale revert stack survived image switches, so Revert after switching photos would have restored the previous image's pre-upscale pixels as the current image; Revert was also not gated during the progressive-open developing window. Fix: the stack is cleared on every image switch, and Revert waits for full quality like every other base-mutating action. Affects: `src/services/EnhanceService.ts`, `src/services/ImageService.ts`.
- **A superseded background decode now pays forward instead of being discarded.** Cause: switching photos while a ~4 s RAW decode was still running threw the finished decode away. Fix: the result is cached under its own (file, options) key before the supersede guards run, so the next reopen of that photo is instant; a stale-options result for the currently-open photo is still skipped so it can never clobber a fresher re-decode. Affects: `src/services/ImageService.ts`.

### Changed
- A repository tripwire test now fails the suite if any future action that reads or writes base pixels is added without the developing-window guard (this bypass class was caught three separate times by review during v1.16.0 — now it's caught by CI at introduction time). Affects: `src/test/developingGuardTripwire.test.ts` (new).
- The Image Size and Canvas Size menu entries are disabled while "Developing full quality…" is shown (they would display the preview's dimensions); the status bar subscribes to exactly the fields it renders; the toolbar's Print button no longer claims a Ctrl+P shortcut (Ctrl+P opens the Preset Manager).

## [1.16.0] - 2026-07-10

### Added
- **RAW photos open near-instantly (progressive open).** Opening a RAW now paints the camera's embedded preview in ~0.5 s (measured on a 20 MP ORF: 5.5 s → 0.50 s cold, ~11×) with your saved edits already applied, while the full 16-bit LibRaw decode develops in the background and swaps in seamlessly (~5.5 s) — a "Developing full quality…" note shows in the footer meanwhile. Pixel-precise actions (Auto adjustments, Rotate/Flip, Image Size, Enhance upscale, Print, Copy Style, export sizing) are gated until full quality lands so nothing ever bakes numbers from the low-res preview; batch processing always uses the full decode. The critical-path IPC payload shrank from 122 MB to 9.4 MB (~13×) because the full 16-bit buffer transfer moved off the first-paint path into the background step. Affects: `electron/rawDecoder.cjs`, `electron/embeddedPreview.cjs` (new), `electron/main.cjs`, `src/services/RawImageService.ts`, `src/services/ImageService.ts`, `src/utils/developingGuard.ts` (new), `src/components/Layout/Canvas.tsx`.

### Changed
- **Switching photos is dramatically snappier.** Three compounding causes fixed: (1) the keyboard-shortcut system tore itself down and re-registered on every image open (an effect-dependency churn bug that profiled like a full app remount), and the canvas wasted ~0.7 s re-drawing the *previous* photo at full resolution before the new one even dispatched — decode dispatch now starts at ~380 ms after the click (was 912 ms) with zero stale redraws; (2) persisted edits are restored *before* the first processing pass instead of ~350 ms after it, eliminating both the second full pass (2 → 1) and the visible "unedited flash" on every edited photo — heavy warm reopen ~0.96 s (was 1.98 s); (3) the 310 MB Before/After original snapshot is no longer copied on every open — it materializes lazily on first use (copy-on-write), saving ~90 ms and 310 MB of allocation per open. Affects: `src/App.tsx`, `src/components/Layout/Canvas.tsx`, `src/services/ImageService.ts`.
- Rapidly switching A→B→A no longer re-runs a superseded load (the image-load guard now uses a per-call token instead of path equality, so a stale resumed call can't re-dispatch a duplicate RAW decode).
- Session-cache polish: the entry-count cap now counts per category, so large RAW bases no longer evict thumbnail slots; the main process's RAW format list is consolidated into one constant (closing a `.sr2`/`.srf`/`.x3f` preview gap).
- A regression test now locks the GPU canvas-sizing resize-observer chain (the load-bearing effect chain documented in Canvas.tsx).

## [1.15.0] - 2026-07-10

### Added
- **Zooming in now uses the whole workspace.** The canvas grows up to the full photo region when zoomed past fit (previously the zoomed image stayed clipped inside the fitted rectangle), and the image pans within it — including in the Before/After split, where both panes now share the exact same viewport geometry. One shared geometry model drives the CPU draw, the GPU present, pan bounds, and every overlay (crop handles and masks keep tracking the image content at any zoom). Zoom at or below fit is unchanged. Affects: `src/utils/viewportGeometry.ts` (new), `src/utils/panBounds.ts`, `src/components/Layout/Canvas.tsx`, `src/App.tsx`, `src/shaders/GpuPreviewPipeline.ts`, overlay components.
- **The photo recenters when the side panel closes.** The photo region's right inset now follows the module/histogram column's visibility instead of staying reserved, so the image takes the freed space (toolbar, dock, and footer follow the photo's center automatically). Affects: `src/layout/photoRegion.ts`, `src/App.tsx`.
- **RAW switching is faster**: the session cache now holds multiple large RAW base images (dedicated 700 MB budget) so switching between big RAWs and back no longer re-decodes. Also fixed a long-standing cache bug where the eviction order was inverted (the newest, most-used entries were evicted first). Affects: `src/services/ImageCacheService.ts`.
- Typed slider entry accepts finer precision than dragging (e.g. 0.01 steps for Saturation/Vibrance/Dehaze); the Export and Batch dialogs' sliders gained double-click-reset and click-to-type like the rest of the app.

### Changed
- **Auto White Balance treats slight RAW decode bias as "no cast"**: genuinely balanced RAW files now snap to exactly 6500 K / 0 tint instead of applying a small residual correction; real color casts still correct. Affects: `src/modules/WhiteBalanceModule.ts`.
- History checkpoints show the absolute clock time inline (relative age moved to the tooltip), matching the design mock.
- Nikon `.nrw` gallery thumbnails now use the RAW preview path.
- Removed the non-functional renderer-side "WASM fallback" for RAW decoding — an audit proved it was a leftover mock that returned a fabricated gray image for any input; the real decode fallbacks (native → wasm → embedded JPEG, all in the main process) are unchanged. ~1,000 lines of dead code deleted across three services. Affects: `src/services/RawImageService.ts` and deletions.
- New maintenance script `scripts/reset-smoke-fixtures.cjs` (dry-run by default) clears accumulated test edits from the smoke-fixture folder.

## [1.14.6] - 2026-07-10

### Fixed
- **Zoomed photos can now be panned horizontally.** Cause: the drag clamp bounded panning against the photo-region container instead of the canvas box the zoomed image is actually drawn and clipped in — for any photo that is height-constrained in the letterbox (portrait or 4:3 in the wide workspace), the displayed width never exceeded the region width, so the horizontal bound computed 0 and left-right dragging was permanently locked (vertical worked only because the fitted height happens to match the region height). Fix: pan bounds derive from the canvas's own dimensions (`computePanBounds` helper with regression tests); verified live — horizontal drag pans and clamps at the exact computed bound. Affects: `src/components/Layout/Canvas.tsx`, `src/utils/panBounds.ts` (new).

## [1.14.5] - 2026-07-10

### Fixed
- **Export "Estimated size" is now realistic.** Cause: the estimate used invented per-format constants (e.g. JPEG ≈ 1.35 bytes/pixel at quality 90) that overshot real encoder output several-fold. Fix: the estimator was calibrated empirically — two reference photos (a camera JPEG and a RAW-decoded frame, both at full resolution) encoded through the app's actual sharp settings across the full format/quality grid, with per-format curves set at the midpoint of the two measurements (JPEG q90 ≈ 0.10 B/px; the measured table is documented in the code). Estimates carry an inherent ±20% content/resolution spread. Affects: `src/utils/exportSizeEstimate.ts` (new), `src/components/Dialogs/ExportDialog.tsx`.
- **TIFF "ZIP (Lossless)" export works for the first time.** Cause: the writer passed the UI's `zip` value straight to sharp, which only accepts `deflate` — the option has thrown on every export since it was added. Fix: mapped at the writer boundary, with a regression test proving compression genuinely runs. Affects: `electron/imageWriter.cjs`.
- **Settings → About shows the real version and current year.** Cause: the panel hardcoded "Version 1.0.0 / © 2025" since its creation. Fix: version via the same IPC the About dialog uses; year derived at render. Affects: `src/components/Panels/SettingsPanel.tsx`.
- **Module panels no longer end flush at the card's bottom edge.** Cause: the module body wrappers had top/side padding only. Fix: the design's 18px bottom padding applied once on the shared container. Affects: `src/components/Panels/AdjustmentPanel.tsx`.

## [1.14.4] - 2026-07-10

### Fixed
- **Reopening a RAW photo is now instant.** Cause: the session image cache was write-only — lookups used a different key shape than writes, so every reopen ran the full multi-second LibRaw decode. Fix: a dedicated base-image cache key; reopens serve the cached decode (options-coherent: the cache is only written together with the image's persisted decode options, and entries larger than the cache budget are rejected instead of evicting everything). Affects: `src/services/ImageCacheService.ts`, `src/services/ImageService.ts`, `src/services/RawImageService.ts`.
- **Nikon `.nrw` and Samsung `.srw` files now decode.** Cause: the decode-routing extension list missed them, sending them to the standard image loader, which cannot read them. Fix: one canonical RAW extension list shared by decode routing and the UI's RAW detection. Affects: `src/utils/rawExtensions.ts` (new), `src/services/RawImageService.ts`, `src/utils/gallerySelection.ts`.
- **Switching photos during a slow load can no longer misfile the result.** Cause: the canvas load path never re-checked which image was current after its async decode. Fix: an identity guard mirrors the existing re-decode guard. Affects: `src/components/Layout/Canvas.tsx`.

### Changed
- **Segmented controls are keyboard-accessible**: Tab lands on the active segment; Arrow keys (with wrap), Home and End move and activate; a visible focus ring appears for keyboard users. Affects: `src/components/Controls/Segmented.tsx`, `src/index.css`.
- Removed three orphaned RAW-service functions left behind by earlier cleanups.

## [1.14.3] - 2026-07-10

### Fixed
- **Gallery: exporting a single selected photo now exports that photo.** Cause: the gallery toolbar's Export… only used the selection at 2+ selected tiles (and a downstream guard silently dropped 1-item selections), so a single ctrl-selected tile exported the photo on the canvas instead. Fix: in Gallery view any selection ≥1 exports the selection; the export dialog title now pluralizes correctly ("Export 1 Image"). Affects: `src/components/Layout/Toolbar.tsx`, `src/App.tsx`, `src/components/Dialogs/ExportDialog.tsx`.
- **Footer and gallery tiles show real image metadata.** Cause: folder scans never recorded image dimensions and carried a MIME-ish type string, so the footer read "IMAGE/JPEG" and gallery tiles lacked `W × H`. Fix: dimensions are captured for free when thumbnails decode (and for RAW files — whose gallery previews are downscaled — when the photo is actually opened), and a single format helper renders clean labels (JPG, ORF, …) everywhere. Affects: `src/components/Layout/StatusBar.tsx`, `src/components/Gallery/GalleryView.tsx`, `src/components/Panels/ThumbnailPanel.tsx`, `src/components/Layout/Canvas.tsx`, `src/utils/imageFormat.ts`, `src/stores/appStore.ts`.

### Changed
- Removed the orphaned Advanced RAW module and its dead camera-profile infrastructure (unreachable from the UI since the M0 RAW rework; ~900 lines). The live RAW decode path is untouched. Affects: `src/components/Modules/AdvancedRawModule.tsx` (deleted), `src/services/AdvancedRawProcessor.ts`.
- The Print dialog gained its first dedicated test contract.

## [1.14.2] - 2026-07-10

### Changed
- **All dialogs and overlays restyled to the Glass UI.** Export, Batch Processing, Image Size, Presets, Print, Keyboard Shortcuts, the About dialog, and the Welcome screen now share one glass modal chrome (`GlassModal`): dimmed blurred scrim, glass card with the module-card header anatomy, solid-accent primary buttons (new shared `AccentButton`), token text colors, and the standard entrance animation (disabled under `prefers-reduced-motion`). Each dialog keeps exactly its previous open/close semantics (the About dialog remains the only one that closes on an outside click). Print's resolution and color-adjustment sliders adopt the standard slider row, gaining double-click-reset and click-to-type value entry consistent with the rest of the app. Behavior, IPC, and state flow are otherwise unchanged. Affects: `src/components/Dialogs/*`, `src/components/Layout/MenuBar.tsx`, `src/components/Welcome/WelcomeScreen.tsx`, `src/components/Controls/AccentButton.tsx`, `src/index.css`.

## [1.14.1] - 2026-07-10

### Changed
- **Splash screen restyled to the Glass UI.** The launch splash now matches the redesigned workspace: the same radial canvas backdrop, a glass loading card, a solid-accent progress bar with glow on the standard track style, accent-styled subtitle, monospaced percentage/version, and the app's entrance animation (disabled under `prefers-reduced-motion`). Loading logic and progress IPC are unchanged. Affects: `electron/splash.html`.

## [1.14.0] - 2026-07-10

### Added
- **"Glass · Sectioned" UI — a full workspace redesign.** The editing workspace is now a full-bleed canvas with floating glass chrome: a toolbar pill (with **Auto All** as the primary action and a responsive overflow menu at narrow widths), a floating icon rail, a right column holding a standalone **histogram card** above the **module card**, a floating filmstrip dock (selected thumbnail highlighted with an accent outline, prev/next chevrons, image counter), and a 32-px footer whose center hosts the **rating filter and the current photo's star rating**. Nothing ever overlaps the photo; the toolbar, dock, and footer cluster all align to the photo's center axis and recompute on resize. Why: one consistent, premium card system across every adjustment module instead of ad-hoc per-module styling. Affects: `src/App.tsx`, `src/components/Layout/{Toolbar,IconSidebar,StatusBar}.tsx`, `src/components/Panels/{AdjustmentPanel,HistogramPanel,ThumbnailPanel}.tsx`, `src/components/photoRegion.ts`, `src/index.css`.
- **Unified module card system.** Every module (Basic Adjustments, White Balance, Color Balance, Tone Curve, Crop, Enhance, Lens Corrections, Local Adjustments, History, RAW Decode) shares one anatomy: an accent icon-chip header with a live state subtitle (e.g. "Cloudy · 5900 K", "Develop · 2 edits active") and Auto ⚡ / Reset ↺ chips, accent section labels (TONE / PRESENCE / COLOR, RATIO / GEOMETRY, …), and shared slider rows with **click-to-edit value chips** (click the value to type an exact number; edited values highlight in accent), gradient tracks, center detents, and double-click reset. Built on a new shared controls library: `src/components/Controls/{SliderRow,SectionLabel,ChipButton,Segmented}.tsx`.
- **Gallery view.** A library grid opened from the dock's Gallery button: virtualized, lazy-loading tiles with selection (click / Shift range / Ctrl toggle), RAW badges, per-tile star ratings, a rating filter shared with the Develop footer, folder summary in the toolbar and footer, **Batch Process** as the primary action, and double-click to open any photo in Develop. How to use: click **Gallery** in the filmstrip dock; double-click a tile to return to editing. Affects: `src/components/Gallery/GalleryView.tsx`, `src/stores/appStore.ts` (`viewMode`, `ratingFilter`).
- **Entrance motion.** Cards and the dock rise in once per workspace mount with staggered timing (gallery tiles stagger in on entry); fully disabled under `prefers-reduced-motion`.

### Changed
- Rating controls moved: the rating filter and the current photo's stars live in the footer center (Develop) and on gallery tiles — no longer overlaid on the photo or filmstrip header. Prev/next moved from photo-edge overlays into the dock.
- Known deviation from the design spec: the Gallery's "Del removes from folder" interaction is **deferred** — the app has no remove-from-folder flow, and a destructive file operation was deliberately not rushed into this release.

## [1.13.1] - 2026-07-09

### Fixed
- **The RAW Decode panel now actually appears (v1.13.0 shipped it invisible).** Cause: the panel gated its visibility on the Zustand store's `currentImage`, but this app keeps the open image in App-local React state and never populates that store field (a code comment even notes it), so the gate was always false and the panel — the headline v1.13.0 feature — never rendered for any file. Fix: App threads its live `currentImage` down through `AdjustmentPanel` to `RawDecodePanel` as a prop (the prop is required on `AdjustmentPanel`, so the compiler now guarantees the wiring); the panel's own RAW-only extension check is unchanged. A regression test drives the panel through the prop, and the earlier test that masked the bug by writing the unused store field was corrected. Affects: `src/components/Panels/RawDecodePanel.tsx`, `src/components/Panels/AdjustmentPanel.tsx`, `src/App.tsx`.
- **Changing a RAW decode option now actually updates the image on screen.** Cause: the GPU preview keeps its source texture resident and only re-uploaded it when the image path or preview dimensions changed — but a re-decode keeps both identical (only the demosaic/highlight pixels differ), so the pipeline kept rendering the previous decode even though the re-decode ran. Fix: a `baseImageVersion` counter is bumped whenever the working base pixels are replaced in place (RAW re-decode, upscale, rotate/flip) and folded into the GPU source-upload key, forcing the new pixels to upload. Affects: `src/stores/appStore.ts`, `src/services/ImageService.ts`, `src/components/Panels/AdjustmentPanel.tsx`.
- **A failed RAW re-decode now shows an error instead of a silent unhandled rejection.** Cause: the panel called the async `reDecode` fire-and-forget; if the whole native→wasm→embedded chain failed it rejected with no `.catch`, giving the user no feedback and an unhandled promise rejection. Fix: re-decode failures surface a notification. Affects: `src/components/Panels/RawDecodePanel.tsx`.

## [1.13.0] - 2026-07-09

### Added
- **Per-image RAW Decode panel — choose demosaic + highlight recovery per photo.** A collapsible "RAW Decode" section (pinned in the Adjustments panel, shown only for RAW files) exposes the demosaic algorithm (**AHD** / **DCB**) and highlight-recovery mode (**Off** / **Blend** / **Reconstruct**) for the currently open RAW. Changing either re-decodes the file from disk, and the choice is persisted per image — restored on reopen and honoured by export. Why: the best demosaic/highlight settings differ shot to shot, so decode quality is now tunable instead of a fixed global. How to use: open a RAW file → **Adjustments → RAW Decode** → pick demosaic / highlight. Affects: `src/components/Panels/RawDecodePanel.tsx`, `src/components/Panels/AdjustmentPanel.tsx`, `src/services/RawImageService.ts`, `src/services/ImageService.ts`, `src/services/EditPersistenceService.ts`, `src/stores/appStore.ts`, `src/components/Layout/Canvas.tsx`.

### Fixed
- **RAW re-decode no longer races an image switch, and exports honour the saved decode options.** Cause: re-decoding a RAW is async — switching to another photo mid-flight could apply the finished decode to the wrong image, and the export path re-decoded with defaults instead of the image's saved demosaic/highlight choice. Fix: `reDecode` now guards against a mid-flight current-image change, and the persisted decode options are threaded through the export decode. Affects: `src/services/RawImageService.ts`, `src/services/ImageService.ts`.
- **Status bar no longer stuck on "No image loaded" after File > Open.** Cause: the File > Open / Ctrl+O handler decoded and displayed the image but never set the app's `currentImage` state that the status bar reads, unlike the filmstrip/import paths. Fix: the open handler now sets `currentImage` from the opened path (matching the sibling load paths) and relies on the reactive canvas load rather than a second explicit decode. Affects: `src/App.tsx`.

## [1.12.0] - 2026-07-09

### Added
- **RAW decode quality: DCB demosaic + highlight reconstruction by default.** The native decode now runs `dcraw_emu` with `-q 4` (DCB demosaic) and `-H 2` (blend highlights) instead of AHD + clipped highlights, and the demosaic/highlight options are parameterised through the decode IPC (`decodeRawFile(path, options)`, mirrored in the `libraw-wasm` fallback) — the groundwork for the upcoming per-image RAW Decode panel. Why: sharper fine detail and recovered highlight rolloff on every RAW file. Affects: `electron/rawDecoder.cjs`, `electron/librawWasmNode.cjs`, `electron/main.cjs`, `electron/preload.cjs`, `src/types/electron.ts`.

### Fixed
- **Correct camera colour on RAW files.** Cause: LibRaw already outputs camera-matrixed sRGB, but a JS camera-profile layer applied the 3×3 colour matrix a second time, visibly distorting colours (the regression test shows a red of 0.20 collapsing to 0.012 under the old double transform). Fix: trust LibRaw — the JS matrix stage no longer touches colour on the LibRaw path. Affects: `src/services/CameraProfileService.ts`, `src/services/RawImageService.ts`, `src/services/AdvancedRawProcessor.ts`.
- **Color Balance sliders recalibrated — the full 0–100% travel now works.** Cause: the Global Colors sliders added their raw −100..+100 value as *absolute* HSL points, so the effect clamped at a fraction of the travel (luminance +50 already blew mid-gray to white); grays (hue 0) fell in the red band at full weight, so the Red sliders repainted neutral pixels; overlapping band weights doubled the effect at hue boundaries; and the Traditional wheel was damped ×0.1, making 100% deflection nearly invisible. Fix: proportional saturation (−100 = grayscale, +100 = 2× chroma), headroom-mapped luminance, band-weight normalisation, a chroma gate that leaves neutrals untouched, and wheel damping raised to 0.3 — formula-identical across the CPU module, the GPU shader, and the parity-check replica so the GPU path stays enabled; Auto and built-in presets compensated ÷3 so their output is unchanged. Affects: `src/modules/ColorBalanceModule.ts`, `src/shaders/sources.ts`, `src/services/WebGLImageProcessor.ts`, `src/services/AutoAdjustService.ts`, `src/services/PresetService.ts`.
- **Enhance ×4 no longer hangs the app in a reprocess loop.** Cause: two independent defects — the preview's `processCurrentImageRealTime` callback listed the `isProcessing` state in its own dependency array while toggling it every run, so each pass re-created the callback and re-fired the mount effect endlessly; and ×4 of any image over 10 MP always threw at the 160 MP output-memory guard before doing anything, surfacing only as small red text. Fix: stable callback identity (effects keyed to image identity, busy-skips only requeue for real triggers) plus a `getUpscaleFeasibility()` helper that disables infeasible scale buttons with a computed tooltip (e.g. "×4 would create a 325 MP image — over the 160 MP limit (max for this image: ×2)"). Affects: `src/components/Panels/AdjustmentPanel.tsx`, `src/services/EnhanceService.ts`, `src/components/Modules/EnhanceModuleComponent.tsx`.
- **Auto white balance no longer flips warm scenes cold.** Cause: the Auto button ran a full median gray-world neutralisation — on scenes whose warmth is the subject (sunsets) it cancelled all of it plus a strong magenta tint (measured live: 3948K / tint −40.5, canvas R/B 1.49 → 1.03), which reads as the image inverting around neutral. Fix: the illuminant is now estimated from near-neutral pixels (colourful subjects can't drag it), only 70% of the solved correction is applied (tint clamped to ±35), and a no-cast dead-band snaps tiny corrections to exactly 6500 K / 0 — verified live: the balanced sunset is now a pixel-exact no-op, while genuine casts are still corrected. Affects: `src/modules/WhiteBalanceModule.ts`.

## [1.11.1] - 2026-06-30

### Fixed
- **Undo/Redo buttons now work.** They step the position in the History timeline. Cause: Undo/Redo were wired to `HistoryService`, whose `saveState()` is never called anywhere, so its stack stayed empty and `canUndo()/canRedo()` were always false — the buttons were permanently inert. Fix: added `undo()/redo()/canUndo()/canRedo()` to `CheckpointService` (the real, persisted History timeline) that step the active checkpoint and restore it, rewired every Undo/Redo path (menu, toolbar, keyboard, window-event) through them, and reprocess the canvas the same way clicking a History checkpoint does. Affects: `src/services/CheckpointService.ts`, `src/App.tsx`.

## [1.11.0] - 2026-06-30

### Added
- **Help ("?") menu with an About dialog.** A new "?" menu sits after Window with *Keyboard Shortcuts*, *View on GitHub*, and *About Photo Editor Pro*. The About dialog shows the app version, description, license, author, engine versions (Electron / Chromium / Node), platform, and a clickable repository link. Why: standard discoverability for version/support info. Backed by new IPC `get-app-info` and a scheme-allowlisted `open-external-url`. Affects: `src/components/Layout/MenuBar.tsx`, `electron/main.cjs`, `electron/preload.cjs`, `src/types/electron.ts`.

### Changed
- **Build collects a clean `installer/` folder.** `build:win` now cleans `installer/` before building and, after the NSIS build, copies just the user-facing files there: `Setup <ver>.exe`, `README.txt`, `LICENSE`, `THIRD-PARTY-LICENSES.md`. electron-builder's full `release/` staging (unpacked app, block maps) is left behind, and the **portable** target was dropped (no longer built). Affects: `package.json`, `scripts/collect-installer.cjs`, `scripts/gh-release.cjs`.

## [1.10.0] - 2026-06-30

### Added
- **AI super-resolution upscale (Real-ESRGAN x4plus).** The Enhance → Upscale path now auto-routes to a GPU AI upscaler when a DirectML-capable GPU is available, producing far sharper, more detailed enlargements than the deterministic Lanczos path; it falls back to the deterministic path (and on any AI failure mid-run) otherwise. Why: the deterministic upscale was inherently soft and slow. How to use: open **Enhance → Upscale**, pick ×2/×4, **Apply Enhance** — a determinate "Enhancing… NN%" and an **AI**/**Standard** badge show which path ran; History records `Enhanced ×N (AI|Standard)`. Inference runs in the Electron main process (onnxruntime-node + DirectML) over tiled 128×128 windows with feathered seam blending; the ×4 model serves ×2 by downscaling each tile before compositing (bounded memory). The model (`RealESRGAN_x4plus.onnx`, BSD-3-Clause © 2021 Xintao Wang) is bundled. Affects: `electron/aiUpscaler.cjs`, `src/utils/tilePlan.ts`, `src/services/AiUpscaleClient.ts`, `src/services/EnhanceService.ts`, `src/components/Modules/EnhanceModuleComponent.tsx`, IPC in `electron/main.cjs`/`preload.cjs`, packaging in `package.json`.

## [1.9.2] - 2026-06-30

### Fixed
- **Upscale no longer blocks normal photos.** A ~20 MP image at ×2 (≈81 MP output) was rejected by an over-conservative memory guard. Raised the cap from 40 MP to 160 MP — covering ×2 of cameras up to ~40 MP — while still blocking the genuinely dangerous cases (e.g. ×4 of a 20 MP image ≈ 22 GB). The error message now reports the size in megapixels. Affects: `src/services/EnhanceService.ts`.

## [1.9.1] - 2026-06-30

### Fixed
- **Histogram now reflects live edits.** Cause: it read a CPU buffer only refreshed by a delayed GPU→CPU readback, so in GPU mode it kept showing the original. Fix: it now recomputes on each GPU result (`gpuResultVersion`) via a throttled fresh readback. Affects: `src/components/Panels/HistogramPanel.tsx`.
- **Image aspect ratio preserved.** Landscape images no longer stretch on load, and the image keeps its ratio when the right panel is closed. Cause: the fit-rect fell back to container size before the image fully loaded, and the GPU present didn't re-run on container resize. Affects: `src/components/Layout/Canvas.tsx`.

### Changed
- **Removed fabricated "CUDA / RTX / Tensor / VRAM" acceleration services and logs.** They performed no real work (the genuine acceleration is the WebGL2 pipeline); the fake startup claims and ~3,800 lines of unused scaffolding are gone.
- **Security hardening:** tightened CSP (`script-src` no longer allows inline scripts), pinned navigation (`will-navigate`), added an `openExternal` scheme allowlist, enabled `sandbox`, and added write-path validation on file IPC handlers.
- **Licensing & repo hygiene for public release:** PolyForm Noncommercial license + complete third-party attribution; build toolchain moved out of shipped dependencies; removed fabricated performance docs and personal paths.

## [1.9.0] - 2026-06-30

### Added
- **Noise Reduction consolidated into Enhance.** The Enhance module is now a single
  denoise → sharpen → upscale pipeline with three toggles — **Noise Reduction**, **Sharpen**,
  **Upscale** — driven by one **Apply Enhance** button. The standalone Noise Reduction sidebar
  tool is removed; its GPU Non-Local-Means engine still runs at pipeline slot 7 (correctly
  ordered before sharpen/upscale), now controlled from the Enhance panel. How to use:
  sidebar → Enhance → toggle Noise Reduction / Sharpen / Upscale → Apply Enhance.

### Changed
- **Enhance panel redesigned** to match the other module panels: styled mode toggles, a
  collapsible "Detail & quality" section for the advanced sliders, and a primary Apply button
  (replacing the previous unstyled controls). Affects: `src/components/Modules/EnhanceModuleComponent.tsx`.
- **Before/After now tracks zoom & pan across both panes.** Panning or zooming the edited side
  moves the original side identically, for pixel-level detail comparison. The Reference view
  stays independent (deliberately not synced). Affects: `src/App.tsx`.

### Fixed
- **Wheel-zoom no longer warns "Unable to preventDefault inside passive event listener".**
  Cause: the canvas wheel handler was a React `onWheel` (passive), so its `preventDefault()`
  was ignored on every scroll. Fix: the handler is attached as a native non-passive listener
  (`{ passive: false }`), so zoom is honored cleanly. Affects: `src/components/Layout/Canvas.tsx`.

## [1.8.0] - 2026-06-29

### Added
- **Enhance module (replaces Sharpen).** A new develop module that ports a deterministic
  denoise → deblur → upscale → sharpen chain into the Float32 RGBA pipeline, with two
  toggles: **Sharpen** and **Upscale**.
  - **Sharpen** (resolution-preserving): Richardson–Lucy deconvolution deblur + edge-masked
    luma graft + AMD FidelityFX CAS sharpening + luma-guided chroma cleanup, in BT.601
    luma/chroma with alpha preserved. Identity by default; runs only on **Apply Enhance**
    (like Noise Reduction), so it never auto-processes. Applies on the live canvas and on
    export at full resolution.
  - **Upscale** (×2 / ×4, in-session): an off-main-thread bake that Lanczos-resamples in
    linear light and reloads the enlarged image as the working image. Export writes the
    upscaled result, History records an **"Enhanced ×N"** checkpoint, and a multi-level
    **Revert** stack guarantees the native original is never lost. Reopening the image
    returns the original (the upscale is in-session only). How to use: sidebar → Enhance →
    toggle Sharpen and/or Upscale → Apply Enhance.

### Changed
- **Sharpen module removed.** Its sidebar tool, panel, and GPU shader pass are replaced by
  Enhance. Export-time output sharpening is a separate feature and is unchanged. Affects:
  `src/modules/EnhanceModule.ts`, `src/services/EnhanceService.ts`, `src/utils/enhance*.ts`,
  `src/workers/enhance.worker.ts`, `src/components/Modules/EnhanceModuleComponent.tsx`,
  plus pipeline/sidebar/panel wiring.
- Removed the static "Processing Stats" footer from the adjustment panel.

### Fixed
- Export, History, and edit-persistence now correctly account for an in-session upscaled
  (baked) image. Cause: export/persistence/History re-decoded the original file and ignored
  the baked pixels. Fix: a baked-source marker on `ImageService` drives export to read the
  baked buffer at baked dimensions; the "Enhanced ×N" checkpoint restores by unwinding the
  bake; persistence is skipped while baked so the saved state isn't corrupted; upscaling
  after a Crop uses the post-crop dimensions. Affects: `src/services/ImageService.ts`,
  `src/services/CheckpointService.ts`, `src/services/EditPersistenceService.ts`,
  `src/components/Dialogs/ExportDialog.tsx`.

## [1.7.2] - 2026-06-23

### Fixed
- **First image (and intermittent later loads) rendered black on the GPU canvas.** Cause:
  `present()` depended on a *separate* effect having sized the GL drawing buffer; when it
  ran first (canvas still 0×0) the v1.7.1 guard skipped the frame and nothing ever
  re-presented, so it stayed black. A second trigger: the ~150 ms histogram readback
  resized — and therefore cleared — the buffer with no re-present. Fix: `present()` now
  owns the drawing-buffer size (sized from the resident result dimensions, assigned only
  when it differs), and `redrawCanvas()` no longer writes the GL drawing buffer in GPU
  mode, eliminating the resize-fight. Affects: `src/shaders/GpuPreviewPipeline.ts`,
  `src/components/Layout/Canvas.tsx`.
- **Tone-curve-edited images rendered as a red gradient.** Cause: in the GPU render loop
  the tone-curve LUT upload called `uploadLut()` (which binds + `texImage2D`s on the
  *active* texture unit) **before** selecting the LUT's unit — while unit 0 still held the
  input image — so creating the LUT clobbered unit 0 and the shader's `u_image` sampled an
  R32F LUT instead of the photo. Fix: select the LUT's texture unit before uploading, so
  unit 0 stays the image. Affects: `src/shaders/GpuPreviewPipeline.ts`.
- **A faulty GPU shader corrupted the preview instead of falling back.** Cause: the
  GPU-vs-CPU self-test detected mismatched shaders but its result was only logged
  (dev-only) and never acted on. Fix: the self-test now runs in dev **and** production and
  reports the failing module IDs; `buildPassList` routes those to the CPU bridge, so any
  GPU pass that doesn't match its CPU reference (e.g. local adjustments) falls back to the
  proven CPU path rather than shipping a corrupted frame. Affects:
  `src/shaders/GpuPreviewPipeline.ts`, `src/shaders/passDescriptors.ts`, `src/App.tsx`.
- **Star ratings didn't persist across sessions.** Cause: ratings were written to the file
  (`xmp:Rating`) but never read back — the in-memory store reset to empty on load. Fix:
  added a `read-image-rating` IPC (embedded XMP for standard formats, sidecar `.xmp` for
  RAW) and seed each thumbnail's rating from the file on load. Affects: `electron/main.cjs`,
  `electron/imageWriter.cjs`, `electron/preload.cjs`, `src/types/electron.ts`,
  `src/components/Panels/ThumbnailPanel.tsx`.
- **RAW thumbnails showed in the wrong orientation.** Cause: the embedded-preview JPEG was
  handed to sharp with no auto-orient, and for Olympus ORF the orientation lives in the RAW
  container's IFD0, not the preview's EXIF. Fix: auto-orient from the preview's own EXIF
  when present, otherwise apply the container's IFD0 Orientation (tag 0x0112); the DNG
  fallback is auto-oriented too. Affects: `electron/main.cjs`, `electron/embeddedPreview.cjs`.

### Changed
- **Export diagnostics.** The export path already re-decodes the original and re-applies the
  full module pipeline (confirmed by a new regression test); added logging that reports how
  many modules are active per export so any "missing edits" report can be traced to module
  state rather than guessed. Affects: `src/components/Dialogs/ExportDialog.tsx`.

## [1.7.1] - 2026-06-16

### Fixed
- **Every image rendered upside-down on the GPU canvas.** Cause: the present vertex
  shader applied an extra vertical flip (`v_uv.y = 1.0 - unit.y`), but the source upload
  doesn't flip Y and the render+readback path preserves orientation (so the GPU-vs-CPU
  self-tests, which exercise render+readback and not `present()`, still passed). Fix: the
  present pass now samples `v_uv = vec2(unit.x, unit.y)`, matching the render/readback
  convention. Affects: `src/shaders/sources.ts`.
- **GL canvas went black after minimizing and restoring the window.** Cause: the GPU
  canvas is presented on demand (not every frame), but its WebGL2 context was created
  without `preserveDrawingBuffer`, so Chromium cleared the volatile drawing buffer after
  any composite that wasn't immediately followed by a `present()`. Fix: create the context
  with `preserveDrawingBuffer: true` and re-present when the window regains focus /
  visibility. Affects: `src/shaders/GpuPreviewPipeline.ts`, `src/components/Layout/Canvas.tsx`.
- **First image of a session rendered as red-and-black garbage.** Cause: on the very first
  GPU frame `present()` could run before the GL canvas drawing-buffer was sized (width/
  height still 0), so the destination-rect math divided by zero → `NaN` clip coordinates →
  a degenerate frame. Fix: `present()` now skips a frame when the canvas is not yet sized;
  the sizing pass then triggers a correct re-present. Affects: `src/shaders/GpuPreviewPipeline.ts`.
- **"Before / After" showed an edited "before" after switching images and returning.**
  Cause: the GPU before/after split sampled the editing *base* texture (`currentImage.data`,
  which rotate/flip/Auto-All bake in place via `updateCurrentImageData`) instead of the
  pristine original. Fix: disable the GPU split and rely on the dedicated `OriginalPane`,
  which draws the pristine `imageService.getOriginalImage()` snapshot in both CPU and GPU
  modes — a single source of truth for the "before" half. Affects: `src/components/Layout/Canvas.tsx`.

## [1.7.0] - 2026-06-16

### Added
- **Resident-texture WebGL2 GPU pipeline for the live preview.** The image is uploaded
  to the GPU once; every editing module runs as a fragment-shader pass ping-ponging
  between RGBA32F float textures, and the final result is **presented directly to the
  canvas with zero GPU→CPU readback** (on a dedicated WebGL canvas; the previous
  2D-canvas path stays as the CPU fallback, switched by a `renderMode` store flag). This
  replaces the old per-module GPU calls that copied pixels back to the CPU between every
  step. All editing modules now have a GPU path: Exposure, White Balance, Basic
  Adjustments, Tone Curve, Color Balance, Lens distortion/CA/vignetting,
  Shadows/Highlights, Sharpen (separable unsharp mask, multi-pass), and Local Adjustment
  masks (one mask-blend pass per layer). Why: real-time slider feedback without the
  per-module readback stalls. Files: `src/shaders/GpuPreviewPipeline.ts`,
  `passDescriptors.ts`, `sources.ts`, `uniforms.ts`, `Canvas.tsx`, `AdjustmentPanel.tsx`.
- **CPU fallback runs off the renderer main thread.** When WebGL2 is unavailable or an
  active operation has no GPU path, the preview pipeline runs in a **Web Worker** instead
  of blocking the UI. The worker is a Vite module worker that imports the real
  `ImageProcessingPipeline` — no duplicated pixel math (the old hand-ported worker that
  kept diverged copies of 5 modules was retired). The worker returns output dimensions so
  cropped previews stay correct across the worker boundary, with a graceful main-thread
  fallback if the worker can't be used. Files: `src/workers/pipeline.worker.ts`,
  `WebWorkerImageProcessor.ts`, `previewRouting.ts`.

### Changed
- **Export resize moved off the renderer thread.** Full-resolution downscaling now runs
  via **sharp in the Electron main process** (Lanczos3) for the common path, instead of a
  per-pixel bicubic loop on the UI thread — exports no longer freeze the window. The
  watermark path keeps the renderer-side resize (so the watermark composites at output
  size); 16-bit (true ushort) and ICC handling are unchanged, with a guard against
  double-resizing. Files: `electron/imageWriter.cjs`, `src/services/ExportService.ts`.

### Safety / correctness
- Every GPU operation keeps its CPU reference and a startup **GPU-vs-CPU self-check**; the
  GPU path is used only when it matches the CPU within tolerance. `renderMode` defaults to
  CPU and only flips to GPU once a render succeeds, so a machine without working WebGL2
  behaves exactly as before. Test suite: 1027 passing (was 920).

## [1.6.0] - 2026-06-12

### Changed
- **Export defaults.** Color Space now defaults to **Adobe RGB** and Bit Depth to the
  **highest the chosen format supports** (16-bit for PNG/TIFF, 8-bit for JPEG/WebP —
  switching format auto-adjusts the depth); Dimensions stay "original". Note: a
  16-bit + wide-gamut combination is currently written as 8-bit on disk (sharp can't
  embed a wide-gamut ICC into a 16-bit file without a colour shift) — pick sRGB when
  true 16-bit output matters more than the wider gamut.
- **Single-image export UX.** The export dialog **closes immediately** and progress is
  shown in the same cancellable top-left bar that multi-export uses. Cause of the old
  "stuck for minutes" feel: the full-resolution pipeline ran synchronously on the UI
  thread — with leftover per-module debug pixel scans making it far slower — freezing
  the window until done. The debug scans are removed and the pipeline now reports
  progress and yields between modules. Files: `ImageProcessingPipeline`, `ExportDialog`,
  `ExportService`.
- **Filmstrip selection visuals unified.** One blue hierarchy: the image open on the
  canvas gets a solid blue border + subtle glow; other multi-selected thumbnails get a
  dimmer blue border. The competing white border, white corner dot, and blue check
  badge were removed (deselect with **Ctrl/Cmd+click**).

### Fixed
- **Rating a photo no longer refreshes the filmstrip and jumps to the first
  thumbnail.** Cause: the `xmp:Rating` write modified the file inside the watched
  folder → `fs.watch` fired → full folder reload → a brand-new `images` array →
  the strip re-rendered from scratch and lost its scroll position. Fix: app-initiated
  writes (ratings, exports, metadata) are registered in `electron/selfWriteRegistry.cjs`
  and the watcher ignores them (race-free debouncer that still honours genuine external
  changes), and folder reloads that yield an identical file list keep the existing
  array reference (`src/utils/imageList.ts`). Affects: `main.cjs`, `App.tsx`.
- **Memory leaks.** (1) Full-resolution exports (single, multi, batch) parked a
  Float32 copy of the image **per pipeline module** in the preview cache — hundreds of
  MB to multiple GB per export; exports now skip the module cache (preview caching
  unchanged). (2) The filmstrip thumbnail cache was unbounded — now capped at 400
  entries with FIFO eviction (evicted thumbs lazily reload on scroll). (3) Stale
  `photoapp-raw-*` temp folders left behind by interrupted RAW decodes are swept at
  startup (>24 h old). (4) Every filmstrip scroll event re-issued thumbnail IPC
  fetches for already-loaded thumbs — loads are now ref-guarded. Affects:
  `ImageProcessingPipeline`, `ExportDialog`, `MultiExportService`,
  `BatchProcessingService`, `ThumbnailPanel`, `rawDecoder.cjs`, `main.cjs`.

## [1.5.0] - 2026-06-09

### Added
- **Sharpen module** (right sidebar, under Noise Reduction). A non-destructive
  unsharp-mask develop module with live **Amount / Radius / Detail** sliders. It runs
  inside the pipeline, so the canvas preview and the export match exactly. This
  replaces the old export-only "Output Sharpening". Files: `SharpenModule.ts`,
  `SharpenModuleComponent.tsx`, `ImageProcessingPipeline`, `AdjustmentPanel`, `IconSidebar`.
- **Blur & Film Grain in Lens Corrections** (non-destructive). Two new collapsible
  sections — **Blur** (Gaussian radius) and **Film Grain** (Amount + Grain Size,
  deterministic/seeded so it doesn't shimmer between preview and export) — relocated
  from the removed Filter menu. Files: `LensCorrectionsModule(.ts/Pipeline)`,
  `LensCorrectionsModuleComponent`.

### Changed
- **Auto White Balance is now median gray-world.** The White Balance panel's **Auto**
  button *and* **Auto All** scan the image's overall **median** colour cast and
  neutralise **both warmth (temperature) and tint**, inverting the module's own gain
  model so the corrected median is genuinely neutral. Cause of the old behaviour: it
  only gently nudged `meanR/meanB` toward a style-profile target (and used the mean),
  so it under-corrected. Files: `WhiteBalanceModule.ts`, `AdjustmentPanel`, `App`.
- **Sidebar order.** Color Balance moved to directly under White Balance; the new
  Sharpen module sits under Noise Reduction.
- **Lens Corrections** was silently inert in the live pipeline — its wrapper required
  a top-level `enabled` flag nothing ever set, so Vignetting/Distortion/Chromatic
  Aberration never ran. Enablement is now derived from the sections, so those
  corrections (and the new Blur/Film Grain) actually apply.
- **Toolbar export button** renamed **"Save" → "Export"**.
- **Seamless zoom-out.** The canvas background now matches the surrounding container,
  so a zoomed-out image no longer sits in a lighter-grey rectangle with a border.
  (Full-window zoom-in remains a planned follow-up.)

### Removed
- **Filter menu** removed from the menu bar. Its **Blur** and **Film Grain** moved
  into Lens Corrections (non-destructive); **Sharpen** and **Noise Reduction** are
  sidebar modules. The orphaned `FilterDialog` component was deleted.
- **Export "Output Sharpening" tab** removed — sharpening is now the Sharpen develop
  module, and export presets no longer apply export-time sharpening (prevents
  double-sharpening on top of the module).
- **File → New…** menu item removed (a placeholder that opened the Welcome screen;
  the Welcome screen is still under the **Window** menu).

### Fixed
- **Thumbnail selection checkmark couldn't be cleared.** Re-clicking a selected
  thumbnail kept the blue check. Cause: plain-click always re-selected and the check
  badge had no handler. The badge is now a clickable **"Deselect"** toggle, and
  re-clicking the sole-selected thumbnail clears it.

## [1.4.1] - 2026-06-08

### Fixed
- **Keyboard shortcuts died after the first image / tool change.** The keyboard
  init effect's cleanup called `destroy()`, removing the document keydown listener
  that is only added in the service constructor; re-registration never re-added it.
  `register()` now re-attaches the listener idempotently. This is why the **1–5 / 0
  rating keys** appeared not to work.
- **RAW export came out as noise.** Noise Reduction (disabled by default) was not
  recognised as a no-op, so it ran on every export and its full-resolution GPU pass
  corrupted the image. Disabled / identity modules are now correctly skipped — which
  also means **untouched modules are no longer processed** (faster export). In
  addition, the WebGL pipeline now falls back to the CPU above a safe texture size,
  and **output sharpening defaults to off** (it amplified RAW noise).
- **Single-image export** now uses the `_PEP` suffix (matching multi-export) instead
  of `_exported`.
- **Lens Corrections checkboxes** desynced after Vignetting **Auto-detect**; toggles
  and sliders are now applied to the module and the panel stays in sync.
- **The last-used mask couldn't be hidden** — re-click its chip to deselect it.
- **Mask dragging** is responsive again: the mask is baked at preview resolution
  during the drag (full resolution only for export), so handles react immediately.

### Changed
- **Numpad rating.** The numpad number keys now rate the current photo regardless of
  Num Lock, and no longer trigger image navigation.

### Removed
- **Non-functional placeholder features.** Removed the Lens Corrections **Lens
  Profile** section (it applied no correction and had no lens database), the
  **Plugin Manager** (a stub that did nothing — its store read "Coming Soon"), and
  the Welcome screen's fake **Recent Files**, decorative export-presets panel, and
  no-op tour button.

## [1.4.0] - 2026-06-08

### Added
- **Star rating on the canvas.** A larger, always-visible 5-star control sits at the
  bottom-right of the canvas whenever an image is open, mirroring the filmstrip
  thumbnail stars (click a star to set, click the active star to clear). Pressing
  **1–5** rates the current image and **0** clears it. The rating is written to the
  file (`xmp:Rating`) and stays in sync with the thumbnail.
- **Multi-export.** Select several photos in the filmstrip — **Ctrl/Cmd+click** to
  toggle individual ones, **Shift+click** to select a contiguous range — then click
  **Export N** to export them all with the same settings, chosen once in the Export
  dialog. Each photo is re-decoded at full resolution and exported with **its own**
  saved edits applied (an unedited photo never inherits another's edits). Files are
  written into a chosen folder as `<name>_PEP.<ext>` and auto-suffixed (`_PEP_1`,
  `_PEP_2`, …) so an existing file is never overwritten. A cancellable progress bar at
  the top-left shows "Exporting X of N", and a summary toast reports how many
  succeeded / failed.

### Changed
- **Exported filenames use the `_PEP` suffix** (single and multi export), e.g.
  `photo_PEP.jpg` instead of `photo_exported.jpg`.

### Fixed
- **Corrupted RAW exports.** Exporting a RAW file (ORF/CR2/NEF/…) produced a
  scrambled image — the exporter pulled the small embedded preview (~300×200)
  through the full-resolution pipeline. RAW files are now decoded at full
  resolution for export. Affected all output formats.
- **Masks couldn't be hidden.** Clicking an already-selected mask's button now
  deselects it, hiding the per-mask sliders and the on-canvas overlay.
- **Mask dragging now previews live.** Moving / resizing / rotating a mask on the
  canvas updates the masked adjustment during the drag (throttled), not only on
  release.

## [1.3.1] - 2026-06-07

### Fixed
- **Export produced a malformed path on Windows** (`C:\…\Desktop/C:\…\image.jpg` →
  "unable to open for write", all formats). The basename was split on `/` only, but
  Windows source paths use backslashes, so the whole absolute path was appended to the
  chosen folder. Now splits on both separators and joins folder + basename. Large 16-bit
  TIFFs also use BigTIFF to avoid the classic 4GB / `0xFFFFFFFF` limit.
- **Image went blurry when using Noise Reduction and then editing something else.** A slow
  NR pass and a second edit could run two pipeline passes concurrently through the shared
  GPU processor, corrupting the output. Passes are now serialized (synchronous guard) and
  a queued edit re-runs when the current pass finishes.
- **`npm run build:win` failed at the installer step from an elevated shell** — NSIS temp
  files in `C:\WINDOWS\TEMP` were swept mid-compile. The build now runs through a wrapper
  that points `TEMP`/`TMP` at the per-user temp.

### Changed
- **History checkpoints are labelled by the actual change** (e.g. "White Balance —
  Tint -4.00", "Lens Corrections — Barrel -15") instead of just the module name.

## [1.3.0] - 2026-06-07

### Added
- **History module.** A new sidebar tool (under Lens Corrections) showing a per-image
  checkpoint timeline. Every committed edit is auto-recorded as a labelled checkpoint;
  the full list is kept and you can click any checkpoint to restore that state (it never
  truncates later ones). Persisted per image in the durable store — survives sessions and
  app updates — and seeded with an "Opened" baseline. Separate from the Ctrl+Z undo/redo.
- **Lens Corrections redesign.** The 4-tab pill selector is now an accordion of clear
  category sections — Distortion, Vignetting, Chromatic Aberration, Lens Profile — each a
  collapsible card with its own enable toggle and reset (plus auto-detect for vignetting),
  so all categories are visible and divided at a glance.

### Fixed
- **Auto white balance was too green.** The standalone WB "Auto" button now uses the same
  user-style-profile white balance as Auto All, and the green/magenta tint is computed
  toward neutral (ratio-based, negative removes green) instead of the previous weak /
  wrong-signed correction that left images too green.
- **RAW thumbnails** try the embedded-JPEG extractor first (no misleading "sharp failed"
  noise for ORF) and are cached in the main process, so scrolling the filmstrip no longer
  re-decodes the same previews.
- **Splash screen** now appears fully painted instead of blank-then-fill (it was shown
  before its content rendered, and had a fade-in entrance).
- **Dev script** no longer hangs on "Cleaning up processes…" at shutdown (run-once guard
  + synchronous force-kill of the child process trees).
- Removed hardcoded placeholder stats (`6000 × 4000 / 24.0 MP / sRGB`) from the toolbar;
  the real values are in the footer status bar.

## [1.2.0] - 2026-06-07

### Added
- **Per-image edit persistence.** Edits now survive sessions **and** app updates. A new
  durable JSON store under Electron `userData` (outside the install dir) keeps every
  pipeline module's params + Local Adjustment layers (geometry only — the mask is rebuilt
  on load) keyed by the image's file path. Saved debounced on edit, when switching images,
  and on app close; restored automatically when you reopen a photo. (Settings already
  persisted via localStorage.)
- **Local Adjustments — graduated filter gradient.** The linear mask is now a proper
  one-sided graduated filter: a line through the centre, effect on one side, with a
  rotate handle and move-by-dragging-the-line. Feather is the spread — 0.5 ramps the
  effect 100% at the edge to 0% at the line; 1.0 is a solid full-effect rectangle.
- **Local Adjustments — rotate, delete, off-image masks.** Radial masks gain a rotation
  handle; **Delete/Backspace** removes the selected mask; masks may extend outside the
  image. The per-mask sliders moved under the mask buttons in a lighter card. Clicking
  the canvas off the handles deselects/hides the mask.
- **Noise Reduction — explicit Apply button.** No more algorithm dropdown (single engine);
  the sliders stage settings and NR runs only on **Apply** (with the canvas spinner), never
  on slider change.
- **Thumbnails.** Lazy-load (only visible + a margin), a **RAW** badge, brighter star
  outlines, and star ratings written to the file (`xmp:Rating`). Any range slider is now
  **wheel-adjustable** on hover. Removed the redundant status-bar clock.
- **Histogram** now stacks below the Controls instead of overlapping them.

### Fixed
- **RAW thumbnails for Olympus ORF (and similar).** The embedded-JPEG extractor scanned
  bytes for `FF D8 .. FF D9`, but those markers also occur inside entropy-coded data, so
  the preview came out truncated or spanning two images ("Corrupt JPEG / found marker
  0xd8 instead of RST"). Now it parses the JPEG marker structure to bound each preview
  exactly (ORF keeps its preview in the MakerNote); reads are capped before the raw strip.
- **Masked edits did nothing.** Masks were baked at full resolution but the pipeline runs
  a downscaled preview, so the mask indexed the wrong pixels. The mask is now rebuilt at
  the processing resolution — which also makes Local Adjustments export at full resolution.
- **Blurry/soft image after adding a mask + changing WB Tint.** The canvas `backdrop-blur`
  processing overlay could get stuck on. The spinner is now guarded by a per-run id (can't
  orphan), and a neutral mask skips its full-image pass so it no longer slows reprocessing.

## [1.1.0] - 2026-06-07

### Added
- **GPU acceleration (WebGL2).** A new `WebGLImageProcessor` runs the editing
  pipeline on the GPU: uploads RGBA Float32 → float texture → fragment-shader pass →
  RGBA32F framebuffer → Float32 readback. GPU-accelerated: **Basic Adjustments,
  White Balance, Color Balance, Tone Curve, Hue Curves, Lens vignetting, Lens
  distortion, Lens chromatic aberration**, and a **GPU Non-Local-Means** noise
  reducer (replaces the slow CPU BM3D — sub-second even on RAW). Each op carries a
  CPU reference and an init **self-check**: the GPU path is used only if its output
  matches the CPU within tolerance, so a faulty shader silently falls back rather
  than corrupting an image. Geometric ops (distortion/CA) use manual `texelFetch`
  bilinear to match the CPU exactly. Transparent: no UI change, automatic CPU
  fallback when WebGL2 is unavailable.

### Fixed
- **Hue Curves produced NaN when enabled.** Cause: `rgbToHsl` returns hue 0–360 and
  s/l 0–100, but the curve `sampleLUT` expects `[0,1]` (`idx = x*255`) → out-of-bounds.
  Fix: normalise h/360, s/100, l/100 after `rgbToHsl` and scale back before
  `hslToRgb`. Affects: `src/modules/HueCurvesModule.ts`.

### Changed
- **Default export is now PNG 16-bit** (was JPEG 8-bit). The pipeline is 32-bit
  float end-to-end; an 8-bit default discarded that precision. JPEG presets stay
  8-bit (JPEG is 8-bit only).

## [1.0.2] - 2026-06-07

### Fixed
- **Packaged RAW thumbnails (and export) were broken.** Cause: `sharp` is a native
  module but was not in electron-builder's `asarUnpack`, so its binding could not
  load from inside `app.asar` — `require('sharp')` failed in the built app, so RAW
  thumbnails (which need sharp) showed placeholders while JPEGs (no sharp) loaded
  fine. Fix: add `sharp` + `@img/**` to `asarUnpack`. Affects: `package.json`.
- **Lens Corrections tab pills** (Vignetting / Distortion / Chromatic / Profile)
  overflowed the selector on the narrow panel — the 4th spilled out. Fix:
  shrinkable pills (`min-w-0` + label truncation, tighter padding) so all 4 fit.

### Changed
- **Processing spinner** now appears for any adjustment that runs longer than
  ~0.8 s (e.g. noise reduction), not just Auto All / Paste Style — slow operations
  show feedback instead of looking frozen.
- **Noise Reduction "Auto"** no longer hangs on large images: above ~1 MP it uses
  the fast wavelet method instead of the heavy patch-based methods (BM3D / NLMeans
  / hybrid). A GPU-accelerated denoiser is being evaluated for full speed.

## [1.0.1] - 2026-06-07

### Fixed
- **RAW thumbnails not displaying.** Cause: the embedded-preview extractor read the
  entire RAW file and ran a synchronous `exifreader` parse on the full buffer for
  every thumbnail; the filmstrip requests all thumbnails at once, so this flooded
  the main process and starved the responses. Fix: bounded 24 MB read + fast native
  `Buffer.indexOf` scan, no `exifreader`. Affects: `electron/main.cjs`.
- **Welcome modal reappeared on every right-sidebar click.** Cause: the show-welcome
  effect had `selectedTool` in its dependencies, re-arming the 1 s timer on each tool
  change. Fix: show it once, on mount only. Affects: `src/App.tsx`.

### Changed
- **Filmstrip toggle.** The thumbnail panel's close (X) button is now a chevron
  (down/up) that collapses/expands the strip in place instead of closing it.
- **File → New…** added to reopen the Welcome / open-folder modal on demand.

## [1.0.0] - 2026-06-07

First release — a desktop RAW photo editor (Electron + React + a WebGL2/CPU
processing pipeline).

### Added
- Non-destructive editing modules: **Crop & Transform**, **Basic Adjustments**
  (exposure, contrast, highlights, brightness, black point, shadows, dehaze,
  saturation, vibrance), **White Balance**, **Tone Curve**, **Noise Reduction**,
  **Color Balance**, **Lens Corrections**.
- **Local Adjustments**: radial (circle/oval) and linear gradient masks with
  drag-to-place / move / resize on the canvas, per-mask feather, and a per-mask
  "second Basic Adjustments" panel — created from buttons at the top of Basic
  Adjustments.
- **RAW processing**: native LibRaw demosaic (`dcraw_emu`) with libraw-wasm and
  embedded-JPEG fallbacks.
- **Copy / Paste Style**: per-channel histogram matching to transfer a grade
  between images.
- **Auto adjustments**: per-image *Auto All* driven by a user-style profile, plus
  Auto Levels / Contrast / Color.
- **Export**: JPEG / PNG / TIFF / WebP, 8- and 16-bit, sRGB and wide-gamut
  (Adobe RGB / ProPhoto / Rec.2020) via generated ICC profiles, with EXIF/XMP
  metadata embedding.
- Filmstrip with star ratings and filtering, batch processing, presets,
  watermarking, web gallery, and print soft-proof.

### Fixed
- **16-bit export corruption** — exported 16-bit buffers were handed to sharp as
  8-bit raw, producing garbled files. Now written as true 16-bit (ushort +
  `toColourspace('rgb16')`), with depth-aware size validation.
- **Output sharpening** ran only a horizontal blur pass (directionally biased) —
  now a separable horizontal + vertical pass.
- **Paste Style / Auto All** changed the image but left the panel sliders stale —
  they now refresh, and the canvas shows an "Applying…" spinner.
- **Filmstrip** now scrolls left/right with the mouse wheel.
- **RAW thumbnails** — some RAWs showed no thumbnail because the embedded-preview
  scan was capped at the first 10 MB. Now scans the whole file (sharp →
  exifreader → full-file JPEG scan).

### Notes
- Windows build: `npm run build:win` (NSIS installer + portable; output in
  `release/`). The native LibRaw binaries and ICC profiles ship via
  electron-builder `extraResources`.
