# Image Enhance — deterministic + AI, with the order done right

A small, dependency-light toolkit for **denoising, deblurring, upscaling, and sharpening** images. Three CLI scripts, no UI: just tools and math.

The whole point of this repo is the **order** and the **separation of luma from chroma**. Most enhancement goes wrong by sharpening a blur, upscaling noise, or amplifying color fringing. These scripts make the right order structural — you can't do it backwards.

```
enhance.py            full chain:  denoise -> deblur -> upscale -> sharpen
hybrid_upscale.py     upscale only: clean Lanczos base + GAN detail
hybrid_sharpen.py     sharpen only: clean original + restored detail (deblur)
```

---

## Core principles (why it's built this way)

These came out of a long compare-everything experiment; they're enforced in code, not left to the user:

1. **Denoise first.** Deblurring and sharpening both amplify noise. Clean it *before* those steps, never after.
2. **Deblur before upscaling, at native resolution.** Deblurring reverses the blur on the real data; upscaling a blurry image just produces a bigger blur. (Sharpening only boosts edge *contrast*; deblurring/deconvolution recovers real structure.)
3. **Sharpen last, once.** Never sharpen a lossy or blurred intermediate. The real detail comes from the deblur and GAN stages; the final contrast-adaptive sharpen (CAS) only adds bite.
4. **Detail lives in luma; artifacts live in chroma.** All sharpening/detail is grafted onto the **luminance** channel only. **Chroma** (color) is cleaned separately with a luma-guided joint-bilateral filter, which removes chromatic-aberration fringing without softening perceived detail.
5. **Meter the AI.** Reconstructed detail (GAN upscaling, AI deblur) is added through an `alpha` knob and confined to real edges with a mask, so it never tips into the plasticky, "looks like an illustration" over-processing failure mode. Flat regions (sky, water, skin) stay clean.

Everything is **deterministic by default** (no GPU, no model needed) and upgrades to AI when you provide weights.

---

## Install

```bash
pip install opencv-contrib-python numpy scikit-image
```

That's enough for the full deterministic pipeline (Lanczos upscaling + Richardson-Lucy deblur + CAS).

### Optional: GAN upscaling (Real-ESRGAN)

```bash
pip install torch  # for GPU support, see https://pytorch.org/get-started/locally/
pip install realesrgan basicsr
```

Weights: download `RealESRGAN_x4plus.pth` from the official Real-ESRGAN release and pass it with `--gan-weights` (the `realesrgan` package can also auto-download on first run).

> **basicsr import fix (torchvision ≥ 0.17).** `basicsr` imports `torchvision.transforms.functional_tensor`, which was removed. Either `pip install basicsr-fixed`, or add this shim at the top of your entry point before importing basicsr:
> ```python
> import torchvision.transforms.functional as F, sys, types
> m = types.ModuleType("torchvision.transforms.functional_tensor")
> m.rgb_to_grayscale = F.rgb_to_grayscale
> sys.modules["torchvision.transforms.functional_tensor"] = m
> ```

### Optional: AI deblur (NAFNet / Restormer)

```bash
pip install onnxruntime-gpu
```

Export NAFNet or Restormer to ONNX and pass it with `--deblur-model model.onnx`. Adjust the pre/post-processing in `ai_deblur()` to match your export's expected input layout. Alternatively, run any external tool (Topaz, DxO PureRAW, LetsEnhance) and feed its output in with `--restored`.

---

## Usage

### `enhance.py` — the full chain

```bash
# deterministic everything (no GPU): denoise + RL deblur + Lanczos 4x + CAS
python enhance.py in.png out.png --denoise

# full GPU pipeline
python enhance.py in.png out.png --denoise --scale 4 \
       --gan-weights RealESRGAN_x4plus.pth --deblur-model nafnet.onnx

# plain clean upscale, no detail invention
python enhance.py in.png out.png --no-deblur --no-gan --scale 2

# restore + sharpen only, no resize
python enhance.py in.png out.png --scale 1

# use an external deblur (Topaz/DxO) as the restoration source, keep clean graft + chroma logic
python enhance.py in.png out.png --restored topaz_out.png
```

Stages print individual timings:
```
enhance in.png  2592x1944
  [0] denoise         11.9s
  [1] deblur           6.0s
  [2] upscale x4        ...
  [3] finish            ...
  ->  10368x7776  total ...s  ->  out.png
```

### `hybrid_upscale.py` — upscale only

```bash
python hybrid_upscale.py in.png out.png                       # GAN hybrid, 4x
python hybrid_upscale.py in.png out.png --alpha 0.5 --sharpness 0.3
python hybrid_upscale.py in.png out.png --no-gan              # deterministic Lanczos, no GPU
```

### `hybrid_sharpen.py` — sharpen only (no resize)

```bash
python hybrid_sharpen.py in.png out.png                       # deterministic (RL deconv)
python hybrid_sharpen.py in.png out.png --ai-model nafnet.onnx
python hybrid_sharpen.py in.png out.png --restored topaz_out.png
python hybrid_sharpen.py in.png out.png --denoise --alpha 0.8 --sharpness 0.4
```

---

## Parameters

| Flag | Scripts | Meaning | Default |
|------|---------|---------|---------|
| `--scale` | enhance, upscale | upscale factor (1 = no resize) | 4 |
| `--denoise` | enhance, sharpen | stage 0: pre-denoise (non-local means) | off |
| `--no-deblur` | enhance | skip the deblur/restore stage | — |
| `--deblur-model` / `--ai-model` | enhance / sharpen | deblur ONNX (NAFNet/Restormer) | none → RL deconv |
| `--restored` | enhance, sharpen | use an external deblur output as the source | none |
| `--psf-sigma` | enhance, sharpen | assumed blur radius for Richardson-Lucy | 1.0 |
| `--rl-iters` | enhance, sharpen | Richardson-Lucy iterations | 12 |
| `--no-gan` | enhance, upscale | upscale with Lanczos only (no GAN detail) | — |
| `--gan-weights` | enhance, upscale | path to `RealESRGAN_x4plus.pth` | auto |
| `--tile` | enhance, upscale | GAN tile size (bounds VRAM) | 512 |
| `--alpha-deblur` | enhance | how much recovered (deblur) detail to graft, 0–1 | 0.8 |
| `--alpha-gan` / `--alpha` | enhance / upscale | how much GAN detail to graft, 0–1 | 0.7 |
| `--hp-sigma` | all | high-pass radius for the detail graft | 1.2 |
| `--sharpness` | all | final CAS strength, 0–1 (peak −0.125 soft … −0.2 sharp) | 0.4 |

**Tuning notes**
- More crispness without halos: raise `--sharpness` toward 1.0, not the alphas.
- More invented texture (GAN/AI): raise the `alpha` knobs (risk: plasticky if too high).
- Color fringing persists: the joint-bilateral handles most; for severe lateral CA, correct it upstream.
- Aim final acutance near the source's, don't beat it — overshoot is over-sharpening.

---

## The math, stage by stage

- **Denoise** — `cv2.fastNlMeansDenoisingColored`, gentle by default.
- **Deblur** — Richardson-Lucy deconvolution on luma with an assumed Gaussian PSF (`--psf-sigma`), or a learned deblur net (NAFNet/Restormer). RL is exact for a known blur, a good approximation for mild defocus/softness.
- **Upscale** — Lanczos in **linear light** (degamma → resize → regamma, avoids edge fringing) for the clean base; Real-ESRGAN x4plus tiled for reconstructed detail.
- **Luma graft** — `new_Y = base_Y + alpha · mask · highpass(detail_Y)`, where `mask` is a softened, normalized Sobel magnitude. Low-frequency tone/color is preserved exactly; only edge-region high-frequency is added.
- **Chroma cleanup** — `cv2.ximgproc.jointBilateralFilter` on Cr/Cb guided by the finished luma (Gaussian fallback if `ximgproc` is unavailable).
- **CAS** — AMD FidelityFX Contrast-Adaptive Sharpening on luma: ring min/max → adaptive amplitude → a single sharpening pass that lifts low-contrast detail more than hard edges, so it adds bite without halos.

---

## Performance

On a 16 GB GPU the full `enhance.py` (denoise + AI deblur + Real-ESRGAN 4× tiled + CAS) runs in seconds — well under two minutes for a typical photo. The dominant costs are the two model passes; `--tile 512` keeps GAN VRAM to a few GB. Without a GPU, everything still runs deterministically (the deblur falls back to RL deconvolution and the upscale to Lanczos); expect tens of seconds, with non-local-means denoise being the slowest single step.
