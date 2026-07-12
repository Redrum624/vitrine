#!/usr/bin/env python3
"""
hybrid_upscale.py
=================
Clean-base + GAN-detail hybrid image upscaler. No UI: a CLI tool + the math.

Pipeline (every GPU step fits comfortably under ~2 min total on a 16 GB card):

  1. GAN pass      Real-ESRGAN x4plus, tiled        -> genuine reconstructed texture
  2. Clean base    linear-light Lanczos             -> artifact-free structure (instant, CPU)
  3. Luma graft    base_Y + alpha * mask * HP(gan_Y) -> real detail, metered, edge-masked
  4. Chroma clean  joint-bilateral on Cr/Cb (luma-guided) -> kills CA / color fringing
  5. CAS           contrast-adaptive sharpen on Y    -> halo-free final bite

Design rationale (from the experiment that produced this):
  * Sharpness is a LUMA phenomenon; artifacts (CA, fringing) are mostly CHROMA.
    Treat them separately and you don't trade one for the other.
  * Deterministic upscalers add no information; only the GAN reconstructs detail.
    So the GAN supplies high-frequency content, `alpha` meters how much "invention"
    you accept, and `mask` confines it to real edges (skies/water stay glassy).
  * Never sharpen a blurred intermediate. CAS runs once, last, on the final luma.

Requirements
  pip install torch --index-url https://download.pytorch.org/whl/cu121   # CUDA build
  pip install realesrgan basicsr opencv-contrib-python numpy
  Weights: RealESRGAN_x4plus.pth (realesrgan auto-downloads on first run, or pass
           --gan-weights /path/RealESRGAN_x4plus.pth)
  NOTE: on torchvision >= 0.17 basicsr's `functional_tensor` import breaks.
        Fix: `pip install basicsr-fixed`  OR  add a shim:
          import torchvision.transforms.functional as F, sys, types
          m = types.ModuleType("torchvision.transforms.functional_tensor")
          m.rgb_to_grayscale = F.rgb_to_grayscale
          sys.modules["torchvision.transforms.functional_tensor"] = m

Usage
  python hybrid_upscale.py in.png out.png
  python hybrid_upscale.py in.png out.png --scale 4 --alpha 0.7 --sharpness 0.4
  python hybrid_upscale.py in.png out.png --no-gan          # deterministic-only fallback
"""

import argparse, time
import numpy as np
import cv2


# ----------------------------------------------------------------------------
# Color transfer (sRGB <-> linear light). Resampling in linear light avoids the
# dark fringing that plain-sRGB interpolation produces at high-contrast edges.
# ----------------------------------------------------------------------------
def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


# ----------------------------------------------------------------------------
# 2. Clean base: linear-light Lanczos. Highest-quality interpolation; produces
#    the soft-but-faithful structure we graft detail onto. (cv2 LANCZOS4 = 8x8.)
# ----------------------------------------------------------------------------
def lanczos_linear(bgr, scale):
    lin = srgb_to_linear(bgr.astype(np.float32) / 255.0)
    h, w = bgr.shape[:2]
    out = cv2.resize(lin, (round(w * scale), round(h * scale)),
                     interpolation=cv2.INTER_LANCZOS4)
    return (linear_to_srgb(out) * 255.0).clip(0, 255).astype(np.uint8)


# ----------------------------------------------------------------------------
# 1. GAN pass: Real-ESRGAN x4plus on GPU, tiled to bound VRAM. Returns BGR uint8
#    at exactly 4x. Lazy-imports torch/realesrgan so --no-gan runs without them.
# ----------------------------------------------------------------------------
def gan_upscale(bgr, weights=None, tile=512, half=True, gpu_id=0):
    import torch
    from realesrgan import RealESRGANer
    from basicsr.archs.rrdbnet_arch import RRDBNet

    model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64,
                    num_block=23, num_grow_ch=32, scale=4)
    up = RealESRGANer(
        scale=4,
        model_path=weights or "RealESRGAN_x4plus.pth",
        model=model,
        tile=tile,         # 512 keeps peak VRAM ~a few GB; raise for fewer seams
        tile_pad=16,
        pre_pad=0,
        half=half and torch.cuda.is_available(),
        gpu_id=gpu_id,
    )
    out, _ = up.enhance(bgr, outscale=4)   # BGR uint8, 4x
    return out


# ----------------------------------------------------------------------------
# 3a. High-pass: the high-frequency content of an image = image - lowpass(image).
#     We pull this from the GAN luma -- it's *reconstructed* detail, not unsharp.
# ----------------------------------------------------------------------------
def highpass(y, sigma):
    lp = cv2.GaussianBlur(y, (0, 0), sigma)
    return y - lp


# ----------------------------------------------------------------------------
# 3b. Edge mask: confine grafted detail to real structure. Sobel magnitude of the
#     clean base luma, normalized, softened. Flat regions (sky/water) -> ~0,
#     so they stay clean; edges -> ~1, where texture belongs.
# ----------------------------------------------------------------------------
def edge_mask(y, blur=2.0, gamma=0.75):
    gx = cv2.Sobel(y, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(y, cv2.CV_32F, 0, 1, ksize=3)
    m = np.sqrt(gx * gx + gy * gy)
    m /= (m.max() + 1e-6)
    m = np.power(m, gamma)                 # gamma<1 widens the masked region a bit
    m = cv2.GaussianBlur(m, (0, 0), blur)
    return np.clip(m, 0.0, 1.0)


# ----------------------------------------------------------------------------
# 4. Chroma cleanup: joint-bilateral filter on Cr/Cb *guided by luma*. Removes
#    lateral-CA color fringing while snapping color edges to luminance edges
#    (so no color bleed). Falls back to plain Gaussian if ximgproc is absent.
# ----------------------------------------------------------------------------
def clean_chroma(y_guide_u8, cr, cb, d=7, sigma_color=25, sigma_space=7):
    try:
        jb = cv2.ximgproc.jointBilateralFilter
        cr = jb(y_guide_u8, cr, d, sigma_color, sigma_space)
        cb = jb(y_guide_u8, cb, d, sigma_color, sigma_space)
    except (AttributeError, cv2.error):
        cr = cv2.GaussianBlur(cr, (0, 0), 1.4)
        cb = cv2.GaussianBlur(cb, (0, 0), 1.4)
    return cr, cb


# ----------------------------------------------------------------------------
# 5. CAS (AMD FidelityFX Contrast-Adaptive Sharpening), luma only.
#    Adaptive: boosts low-contrast detail more than already-hard edges, so it
#    adds bite without the halos a fixed unsharp leaves. y in float [0,1].
#      ring min/max over 3x3 -> amp = sqrt(clamp(min(mn,1-mx)/mx))
#      w = amp * peak   (peak<0)
#      out = (center + w*(up+down+left+right)) / (1 + 4w)
# ----------------------------------------------------------------------------
def cas(y, sharpness=0.4):
    p = np.pad(y, 1, mode="edge")
    a, b, c = p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:]
    d, e, f = p[1:-1, :-2], y,           p[1:-1, 2:]
    g, h, i = p[2:, :-2],  p[2:, 1:-1],  p[2:, 2:]
    mn = np.minimum.reduce([b, d, e, f, h]); mn = np.minimum(mn, np.minimum.reduce([a, c, g, i]))
    mx = np.maximum.reduce([b, d, e, f, h]); mx = np.maximum(mx, np.maximum.reduce([a, c, g, i]))
    amp = np.sqrt(np.clip(np.minimum(mn, 1.0 - mx) / np.maximum(mx, 1e-6), 0.0, 1.0))
    peak = -(0.125 + 0.075 * np.clip(sharpness, 0.0, 1.0))   # -0.125 (soft) .. -0.2 (sharp)
    w = amp * peak
    out = (e + w * (b + d + f + h)) / (1.0 + 4.0 * w)
    return np.clip(out, 0.0, 1.0)


# ----------------------------------------------------------------------------
# Orchestration
# ----------------------------------------------------------------------------
def hybrid_upscale(bgr, scale=4, alpha=0.7, hp_sigma=1.2,
                   sharpness=0.4, use_gan=True, gan_weights=None, tile=512):
    H, W = bgr.shape[:2]
    tw, th = round(W * scale), round(H * scale)

    # (2) clean base at target scale
    base = lanczos_linear(bgr, scale)

    # (1) GAN detail source, resized to match base
    if use_gan:
        gan = gan_upscale(bgr, weights=gan_weights, tile=tile)        # 4x
        if (gan.shape[1], gan.shape[0]) != (tw, th):
            gan = cv2.resize(gan, (tw, th), interpolation=cv2.INTER_LANCZOS4)
        detail_src = gan
    else:
        detail_src = base                                            # deterministic fallback

    # split luma / chroma (BT.601 YCrCb); math in float [0,1]
    by, bcr, bcb = cv2.split(cv2.cvtColor(base, cv2.COLOR_BGR2YCrCb))
    gy = cv2.cvtColor(detail_src, cv2.COLOR_BGR2YCrCb)[:, :, 0]
    base_y = by.astype(np.float32) / 255.0
    gan_y  = gy.astype(np.float32) / 255.0

    # (3) luma graft: clean base + metered, edge-masked GAN high-frequency
    mask = edge_mask(base_y)
    new_y = base_y + alpha * mask * highpass(gan_y, hp_sigma)
    new_y = np.clip(new_y, 0.0, 1.0)

    # (5) CAS bite, then back to 8-bit luma
    new_y = cas(new_y, sharpness)
    y_u8 = (new_y * 255.0).round().astype(np.uint8)

    # (4) chroma cleanup, guided by the finished luma
    cr, cb = clean_chroma(y_u8, bcr, bcb)

    out = cv2.cvtColor(cv2.merge([y_u8, cr, cb]), cv2.COLOR_YCrCb2BGR)
    return out


def main():
    ap = argparse.ArgumentParser(description="Hybrid clean-base + GAN-detail upscaler")
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--scale", type=float, default=4.0)
    ap.add_argument("--alpha", type=float, default=0.7,
                    help="how much GAN detail to graft (0=base only, 1=full)")
    ap.add_argument("--hp-sigma", type=float, default=1.2,
                    help="high-pass radius for the grafted detail")
    ap.add_argument("--sharpness", type=float, default=0.4, help="CAS strength 0..1")
    ap.add_argument("--tile", type=int, default=512, help="GAN tile size (VRAM bound)")
    ap.add_argument("--gan-weights", default=None, help="path to RealESRGAN_x4plus.pth")
    ap.add_argument("--no-gan", action="store_true",
                    help="deterministic only (no GPU / no model needed)")
    args = ap.parse_args()

    bgr = cv2.imread(args.input, cv2.IMREAD_COLOR)
    if bgr is None:
        raise SystemExit(f"could not read {args.input}")

    t = time.time()
    out = hybrid_upscale(bgr, scale=args.scale, alpha=args.alpha, hp_sigma=args.hp_sigma,
                         sharpness=args.sharpness, use_gan=not args.no_gan,
                         gan_weights=args.gan_weights, tile=args.tile)
    cv2.imwrite(args.output, out)
    print(f"{args.input} {bgr.shape[1]}x{bgr.shape[0]} -> "
          f"{out.shape[1]}x{out.shape[0]}  in {time.time()-t:.1f}s  -> {args.output}")


if __name__ == "__main__":
    main()
