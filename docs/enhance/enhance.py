#!/usr/bin/env python3
"""
enhance.py
==========
Unified image-enhancement pipeline. No UI: a CLI tool + the math. Composes the
hybrid upscaler and hybrid sharpener into one chain, with the *correct order*
baked in so you can never sharpen a blur or upscale noise:

      0. DENOISE   (native res)      pre-clean so nothing downstream amplifies grain
      1. DEBLUR    (native res)      recover real detail lost to blur  [AI / RL deconv]
      2. UPSCALE   (-> n x)          clean Lanczos base + GAN detail, luma-grafted
      3. FINISH    (final res)       chroma cleanup (luma-guided) + CAS sharpen

Order rationale (the whole reason this file exists):
  * Denoise FIRST: deblur and sharpen both amplify noise; clean it before, not after.
  * Deblur at NATIVE res, BEFORE upscaling: deblurring works on the real data;
    upscaling a blurry image just makes a bigger blur.
  * Sharpen LAST, ONCE: never sharpen a lossy/blurred intermediate. The big detail
    comes from deblur (stage 1) + the GAN (stage 2); CAS only adds the final bite.
  * Everywhere: detail/sharpening live in LUMA; artifacts (CA, fringing, color
    noise) live in CHROMA. We graft detail onto luma, mask it to real edges,
    meter it with alpha (so AI never tips into plasticky over-processing), and
    clean chroma separately at the end.

Requirements
  pip install opencv-contrib-python numpy scikit-image
  Optional upscale GAN : pip install torch(CUDA) realesrgan basicsr   (+ RealESRGAN_x4plus.pth)
  Optional deblur AI   : pip install onnxruntime-gpu                  (+ NAFNet/Restormer .onnx)
  (basicsr on torchvision>=0.17 needs the functional_tensor shim -- see hybrid_upscale.py.)

Usage
  python enhance.py in.png out.png                                  # deterministic everything
  python enhance.py in.png out.png --denoise --scale 4              # +denoise, 4x
  python enhance.py in.png out.png --gan-weights x4plus.pth --deblur-model nafnet.onnx
  python enhance.py in.png out.png --no-deblur --no-gan --scale 2   # plain clean 2x + sharpen
  python enhance.py in.png out.png --scale 1                        # restore+sharpen only (no resize)
"""

import argparse, time
import numpy as np
import cv2


# ============================ color transfer ===============================
def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


# ============================ shared math ==================================
def highpass(y, sigma):
    return y - cv2.GaussianBlur(y, (0, 0), sigma)

def edge_mask(y, blur=2.0, gamma=0.75):
    gx = cv2.Sobel(y, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(y, cv2.CV_32F, 0, 1, ksize=3)
    m = np.sqrt(gx * gx + gy * gy)
    m /= (m.max() + 1e-6)
    return np.clip(cv2.GaussianBlur(np.power(m, gamma), (0, 0), blur), 0.0, 1.0)

def clean_chroma(y_guide_u8, cr, cb, d=7, sigma_color=25, sigma_space=7):
    try:
        jb = cv2.ximgproc.jointBilateralFilter
        cr = jb(y_guide_u8, cr, d, sigma_color, sigma_space)
        cb = jb(y_guide_u8, cb, d, sigma_color, sigma_space)
    except (AttributeError, cv2.error):
        cr = cv2.GaussianBlur(cr, (0, 0), 1.2)
        cb = cv2.GaussianBlur(cb, (0, 0), 1.2)
    return cr, cb

def cas(y, sharpness=0.4):
    """AMD FidelityFX CAS on luma; adaptive -> bite without halos."""
    p = np.pad(y, 1, mode="edge")
    a, b, c = p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:]
    d, e, f = p[1:-1, :-2], y,           p[1:-1, 2:]
    g, h, i = p[2:, :-2],  p[2:, 1:-1],  p[2:, 2:]
    mn = np.minimum.reduce([b, d, e, f, h]); mn = np.minimum(mn, np.minimum.reduce([a, c, g, i]))
    mx = np.maximum.reduce([b, d, e, f, h]); mx = np.maximum(mx, np.maximum.reduce([a, c, g, i]))
    amp = np.sqrt(np.clip(np.minimum(mn, 1.0 - mx) / np.maximum(mx, 1e-6), 0.0, 1.0))
    peak = -(0.125 + 0.075 * np.clip(sharpness, 0.0, 1.0))
    w = amp * peak
    return np.clip((e + w * (b + d + f + h)) / (1.0 + 4.0 * w), 0.0, 1.0)

def luma_graft_bgr(base_bgr, detail_bgr, alpha, hp_sigma):
    """new_Y = base_Y + alpha * edge_mask * HP(detail_Y); base chroma untouched."""
    yb, cr, cb = cv2.split(cv2.cvtColor(base_bgr, cv2.COLOR_BGR2YCrCb))
    dy = cv2.cvtColor(detail_bgr, cv2.COLOR_BGR2YCrCb)[:, :, 0].astype(np.float32) / 255.0
    by = yb.astype(np.float32) / 255.0
    new_y = np.clip(by + alpha * edge_mask(by) * highpass(dy, hp_sigma), 0.0, 1.0)
    y_u8 = (new_y * 255.0).round().astype(np.uint8)
    return cv2.cvtColor(cv2.merge([y_u8, cr, cb]), cv2.COLOR_YCrCb2BGR)


# ============================ stage 0: denoise =============================
def denoise(bgr, h=3, hcolor=3):
    return cv2.fastNlMeansDenoisingColored(bgr, None, h, hcolor, 7, 21)


# ============================ stage 1: deblur ==============================
def rl_deconv(bgr, psf_sigma=1.0, iters=12):
    from skimage.restoration import richardson_lucy
    k = cv2.getGaussianKernel(max(3, int(psf_sigma * 6) | 1), psf_sigma)
    psf = k @ k.T; psf /= psf.sum()
    y = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)[:, :, 0].astype(np.float32) / 255.0
    yd = np.clip(richardson_lucy(y, psf, num_iter=iters, clip=True), 0, 1)
    out = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
    out[:, :, 0] = (yd * 255).round().astype(np.uint8)
    return cv2.cvtColor(out, cv2.COLOR_YCrCb2BGR)

def ai_deblur(bgr, model_path, providers=("CUDAExecutionProvider", "CPUExecutionProvider")):
    import onnxruntime as ort
    sess = ort.InferenceSession(model_path, providers=list(providers))
    inp = sess.get_inputs()[0].name
    x = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    x = np.transpose(x, (2, 0, 1))[None]
    y = np.clip(np.transpose(sess.run(None, {inp: x})[0][0], (1, 2, 0)), 0, 1)
    return cv2.cvtColor((y * 255).round().astype(np.uint8), cv2.COLOR_RGB2BGR)


# ============================ stage 2: upscale =============================
def lanczos_linear(bgr, scale):
    lin = srgb_to_linear(bgr.astype(np.float32) / 255.0)
    h, w = bgr.shape[:2]
    out = cv2.resize(lin, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_LANCZOS4)
    return (linear_to_srgb(out) * 255.0).clip(0, 255).astype(np.uint8)

def gan_upscale(bgr, weights=None, tile=512, half=True, gpu_id=0):
    import torch
    from realesrgan import RealESRGANer
    from basicsr.archs.rrdbnet_arch import RRDBNet
    model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)
    up = RealESRGANer(scale=4, model_path=weights or "RealESRGAN_x4plus.pth", model=model,
                      tile=tile, tile_pad=16, pre_pad=0,
                      half=half and torch.cuda.is_available(), gpu_id=gpu_id)
    out, _ = up.enhance(bgr, outscale=4)
    return out


# ============================ orchestration ================================
def enhance(bgr, scale=4, do_denoise=False,
            deblur=True, deblur_model=None, restored=None, psf_sigma=1.0, rl_iters=12,
            gan=True, gan_weights=None, tile=512,
            alpha_deblur=0.8, alpha_gan=0.7, hp_sigma=1.2, sharpness=0.4, log=print):

    # 0. denoise (native)
    if do_denoise:
        t = time.time(); bgr = denoise(bgr); log(f"  [0] denoise        {time.time()-t:5.1f}s")

    # 1. deblur / restore (native): graft recovered HF onto the clean original
    if deblur:
        t = time.time()
        if restored is not None:
            rb = cv2.imread(restored, cv2.IMREAD_COLOR)
            if rb.shape[:2] != bgr.shape[:2]:
                rb = cv2.resize(rb, (bgr.shape[1], bgr.shape[0]), interpolation=cv2.INTER_LANCZOS4)
        elif deblur_model is not None:
            rb = ai_deblur(bgr, deblur_model)
        else:
            rb = rl_deconv(bgr, psf_sigma, rl_iters)
        bgr = luma_graft_bgr(bgr, rb, alpha_deblur, hp_sigma)
        log(f"  [1] deblur         {time.time()-t:5.1f}s")

    # 2. upscale: clean Lanczos base + GAN detail (luma graft)
    t = time.time()
    tw, th = round(bgr.shape[1] * scale), round(bgr.shape[0] * scale)
    base = lanczos_linear(bgr, scale)
    if gan:
        g = gan_upscale(bgr, weights=gan_weights, tile=tile)
        if (g.shape[1], g.shape[0]) != (tw, th):
            g = cv2.resize(g, (tw, th), interpolation=cv2.INTER_LANCZOS4)
        up = luma_graft_bgr(base, g, alpha_gan, hp_sigma)
    else:
        up = base
    log(f"  [2] upscale x{scale:g}      {time.time()-t:5.1f}s")

    # 3. finish: chroma cleanup (luma-guided) + CAS, once, at final res
    t = time.time()
    y_u8, cr, cb = cv2.split(cv2.cvtColor(up, cv2.COLOR_BGR2YCrCb))
    y = cas(y_u8.astype(np.float32) / 255.0, sharpness)
    y_u8 = (y * 255.0).round().astype(np.uint8)
    cr, cb = clean_chroma(y_u8, cr, cb)
    out = cv2.cvtColor(cv2.merge([y_u8, cr, cb]), cv2.COLOR_YCrCb2BGR)
    log(f"  [3] finish         {time.time()-t:5.1f}s")
    return out


def main():
    ap = argparse.ArgumentParser(description="Unified enhance: denoise -> deblur -> upscale -> sharpen")
    ap.add_argument("input"); ap.add_argument("output")
    ap.add_argument("--scale", type=float, default=4.0, help="upscale factor (1 = no resize)")
    ap.add_argument("--denoise", action="store_true", help="stage 0: pre-denoise")
    # deblur
    ap.add_argument("--no-deblur", action="store_true", help="skip stage 1")
    ap.add_argument("--deblur-model", default=None, help="deblur ONNX (NAFNet/Restormer)")
    ap.add_argument("--restored", default=None, help="external deblur output to use as source")
    ap.add_argument("--psf-sigma", type=float, default=1.0, help="assumed blur radius (RL deconv)")
    ap.add_argument("--rl-iters", type=int, default=12)
    # upscale
    ap.add_argument("--no-gan", action="store_true", help="upscale with Lanczos only (no GAN detail)")
    ap.add_argument("--gan-weights", default=None, help="RealESRGAN_x4plus.pth")
    ap.add_argument("--tile", type=int, default=512, help="GAN tile size (VRAM bound)")
    # strengths
    ap.add_argument("--alpha-deblur", type=float, default=0.8, help="deblur detail amount 0..1")
    ap.add_argument("--alpha-gan", type=float, default=0.7, help="GAN detail amount 0..1")
    ap.add_argument("--hp-sigma", type=float, default=1.2, help="high-pass radius for grafts")
    ap.add_argument("--sharpness", type=float, default=0.4, help="final CAS strength 0..1")
    args = ap.parse_args()

    bgr = cv2.imread(args.input, cv2.IMREAD_COLOR)
    if bgr is None:
        raise SystemExit(f"could not read {args.input}")

    print(f"enhance {args.input}  {bgr.shape[1]}x{bgr.shape[0]}")
    t0 = time.time()
    out = enhance(bgr, scale=args.scale, do_denoise=args.denoise,
                  deblur=not args.no_deblur, deblur_model=args.deblur_model, restored=args.restored,
                  psf_sigma=args.psf_sigma, rl_iters=args.rl_iters,
                  gan=not args.no_gan, gan_weights=args.gan_weights, tile=args.tile,
                  alpha_deblur=args.alpha_deblur, alpha_gan=args.alpha_gan,
                  hp_sigma=args.hp_sigma, sharpness=args.sharpness)
    cv2.imwrite(args.output, out)
    print(f"  ->  {out.shape[1]}x{out.shape[0]}  total {time.time()-t0:.1f}s  ->  {args.output}")


if __name__ == "__main__":
    main()
