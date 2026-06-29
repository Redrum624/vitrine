#!/usr/bin/env python3
"""
hybrid_sharpen.py
=================
Clean-base + restored-detail hybrid SHARPENER. No UI: a CLI tool + the math.
Resolution is unchanged; this only sharpens / deblurs.

Pipeline (every GPU step fits comfortably under ~2 min on a 16 GB card):

  0. Denoise (optional)   pre-clean so we sharpen detail, not noise
  1. Restoration source   AI deblur (NAFNet/Restormer ONNX) -> genuinely recovered detail
                          fallback: Richardson-Lucy deconvolution (math, no model)
  2. Luma graft           orig_Y + alpha * mask * HP(restored_Y)  -> metered, edge-masked
  3. Chroma clean         joint-bilateral on Cr/Cb (luma-guided)  -> kills CA / fringing
  4. CAS                  contrast-adaptive sharpen on Y          -> halo-free final bite

Why this shape (carried over from the upscale exercise):
  * SHARPEN != DEBLUR. Unsharp/CAS boost edge *contrast*; deconvolution and AI
    deblur reverse the blur *mixing* and recover real structure. We use a
    restoration source for real detail, then CAS only for the last bit of bite.
  * Sharpness lives in LUMA; artifacts (CA, fringing, color noise) live in CHROMA.
    Sharpen luma only; clean chroma separately.
  * Confine recovered detail to real edges (mask) so skies/water/skin stay clean,
    and meter it with `alpha` so AI restoration never tips into the plasticky,
    "looks like an illustration" over-deblur failure mode.
  * Never sharpen a noisy or blurred intermediate: denoise first, CAS last/once.

Requirements
  pip install opencv-contrib-python numpy scikit-image
  Optional AI deblur:  pip install onnxruntime-gpu        # + a NAFNet/Restormer .onnx
  (Export NAFNet/Restormer to ONNX, or use Topaz/DxO externally and feed the
   result in via --restored.)

Usage
  python hybrid_sharpen.py in.png out.png                       # deterministic (RL deconv)
  python hybrid_sharpen.py in.png out.png --ai-model nafnet.onnx
  python hybrid_sharpen.py in.png out.png --restored topaz_out.png   # use an external deblur
  python hybrid_sharpen.py in.png out.png --denoise --alpha 0.8 --sharpness 0.4
"""

import argparse, time
import numpy as np
import cv2


# ----------------------------------------------------------------------------
# 0. Optional denoise (so deblur/sharpen doesn't amplify grain). Luma-aware
#    non-local-means; gentle by default.
# ----------------------------------------------------------------------------
def denoise(bgr, h=3, hcolor=3):
    return cv2.fastNlMeansDenoisingColored(bgr, None, h, hcolor, 7, 21)


# ----------------------------------------------------------------------------
# 1a. Deterministic restoration: Richardson-Lucy deconvolution on luma with an
#     assumed PSF. This is the math route -- exact for a known blur, a decent
#     approximation for mild defocus/softness. (sigma ~ blur radius.)
# ----------------------------------------------------------------------------
def rl_deconv_luma(y01, psf_sigma=1.0, iters=12):
    from skimage.restoration import richardson_lucy
    k = cv2.getGaussianKernel(max(3, int(psf_sigma * 6) | 1), psf_sigma)
    psf = k @ k.T
    psf /= psf.sum()
    return np.clip(richardson_lucy(y01, psf, num_iter=iters, clip=True), 0.0, 1.0)


# ----------------------------------------------------------------------------
# 1b. AI restoration: run a deblur ONNX (NAFNet / Restormer) on GPU. Returns BGR
#     uint8 at the same size. Models expect RGB float; adapt to your export.
# ----------------------------------------------------------------------------
def ai_deblur(bgr, model_path, providers=("CUDAExecutionProvider", "CPUExecutionProvider")):
    import onnxruntime as ort
    sess = ort.InferenceSession(model_path, providers=list(providers))
    inp = sess.get_inputs()[0].name
    x = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    x = np.transpose(x, (2, 0, 1))[None]                      # 1,C,H,W
    y = sess.run(None, {inp: x})[0][0]                        # C,H,W
    y = np.clip(np.transpose(y, (1, 2, 0)), 0, 1)
    return cv2.cvtColor((y * 255).round().astype(np.uint8), cv2.COLOR_RGB2BGR)


# ----------------------------------------------------------------------------
# 2a. High-pass = image - lowpass. We add the restoration's high-frequency onto
#     the clean original luma, so low-freq tone/color is preserved exactly.
# ----------------------------------------------------------------------------
def highpass(y, sigma):
    return y - cv2.GaussianBlur(y, (0, 0), sigma)


# ----------------------------------------------------------------------------
# 2b. Edge mask: confine sharpening to real structure. Sobel magnitude of the
#     original luma, normalized + softened. Flat areas -> ~0 (stay clean).
# ----------------------------------------------------------------------------
def edge_mask(y, blur=2.0, gamma=0.75):
    gx = cv2.Sobel(y, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(y, cv2.CV_32F, 0, 1, ksize=3)
    m = np.sqrt(gx * gx + gy * gy)
    m /= (m.max() + 1e-6)
    m = cv2.GaussianBlur(np.power(m, gamma), (0, 0), blur)
    return np.clip(m, 0.0, 1.0)


# ----------------------------------------------------------------------------
# 3. Chroma cleanup: luma-guided joint-bilateral on Cr/Cb -> remove color
#    fringing, snap color edges to luma edges. Gaussian fallback if no ximgproc.
# ----------------------------------------------------------------------------
def clean_chroma(y_guide_u8, cr, cb, d=7, sigma_color=25, sigma_space=7):
    try:
        jb = cv2.ximgproc.jointBilateralFilter
        cr = jb(y_guide_u8, cr, d, sigma_color, sigma_space)
        cb = jb(y_guide_u8, cb, d, sigma_color, sigma_space)
    except (AttributeError, cv2.error):
        cr = cv2.GaussianBlur(cr, (0, 0), 1.2)
        cb = cv2.GaussianBlur(cb, (0, 0), 1.2)
    return cr, cb


# ----------------------------------------------------------------------------
# 4. CAS (AMD FidelityFX Contrast-Adaptive Sharpening), luma only, in [0,1].
#    Adaptive: lifts low-contrast texture more than hard edges -> bite, no halos.
# ----------------------------------------------------------------------------
def cas(y, sharpness=0.4):
    p = np.pad(y, 1, mode="edge")
    a, b, c = p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:]
    d, e, f = p[1:-1, :-2], y,           p[1:-1, 2:]
    g, h, i = p[2:, :-2],  p[2:, 1:-1],  p[2:, 2:]
    mn = np.minimum.reduce([b, d, e, f, h]); mn = np.minimum(mn, np.minimum.reduce([a, c, g, i]))
    mx = np.maximum.reduce([b, d, e, f, h]); mx = np.maximum(mx, np.maximum.reduce([a, c, g, i]))
    amp = np.sqrt(np.clip(np.minimum(mn, 1.0 - mx) / np.maximum(mx, 1e-6), 0.0, 1.0))
    peak = -(0.125 + 0.075 * np.clip(sharpness, 0.0, 1.0))   # -0.125 soft .. -0.2 sharp
    w = amp * peak
    return np.clip((e + w * (b + d + f + h)) / (1.0 + 4.0 * w), 0.0, 1.0)


# ----------------------------------------------------------------------------
# Orchestration
# ----------------------------------------------------------------------------
def hybrid_sharpen(bgr, alpha=0.8, hp_sigma=1.2, sharpness=0.4, do_denoise=False,
                   ai_model=None, restored=None, psf_sigma=1.0, rl_iters=12):
    if do_denoise:
        bgr = denoise(bgr)

    # luma / chroma of the clean original (math in float [0,1])
    y_u8, cr, cb = cv2.split(cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb))
    orig_y = y_u8.astype(np.float32) / 255.0

    # (1) restoration source -> restored luma
    if restored is not None:                                 # external deblur (Topaz/DxO/etc.)
        rb = cv2.imread(restored, cv2.IMREAD_COLOR)
        if rb.shape[:2] != bgr.shape[:2]:
            rb = cv2.resize(rb, (bgr.shape[1], bgr.shape[0]), interpolation=cv2.INTER_LANCZOS4)
        rest_y = cv2.cvtColor(rb, cv2.COLOR_BGR2YCrCb)[:, :, 0].astype(np.float32) / 255.0
    elif ai_model is not None:                               # AI deblur ONNX
        rb = ai_deblur(bgr, ai_model)
        rest_y = cv2.cvtColor(rb, cv2.COLOR_BGR2YCrCb)[:, :, 0].astype(np.float32) / 255.0
    else:                                                    # deterministic deconvolution
        rest_y = rl_deconv_luma(orig_y, psf_sigma, rl_iters)

    # (2) luma graft: clean original + metered, edge-masked recovered high-freq
    mask = edge_mask(orig_y)
    new_y = np.clip(orig_y + alpha * mask * highpass(rest_y, hp_sigma), 0.0, 1.0)

    # (4) CAS bite
    new_y = cas(new_y, sharpness)
    y_out = (new_y * 255.0).round().astype(np.uint8)

    # (3) chroma cleanup guided by finished luma
    cr, cb = clean_chroma(y_out, cr, cb)
    return cv2.cvtColor(cv2.merge([y_out, cr, cb]), cv2.COLOR_YCrCb2BGR)


def main():
    ap = argparse.ArgumentParser(description="Hybrid clean-base + restored-detail sharpener")
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--alpha", type=float, default=0.8,
                    help="how much recovered detail to graft (0=none, 1=full)")
    ap.add_argument("--hp-sigma", type=float, default=1.2, help="high-pass radius of grafted detail")
    ap.add_argument("--sharpness", type=float, default=0.4, help="CAS strength 0..1")
    ap.add_argument("--denoise", action="store_true", help="pre-denoise before sharpening")
    ap.add_argument("--ai-model", default=None, help="path to a deblur ONNX (NAFNet/Restormer)")
    ap.add_argument("--restored", default=None, help="use an external deblur output as the source")
    ap.add_argument("--psf-sigma", type=float, default=1.0, help="assumed blur radius for RL deconv")
    ap.add_argument("--rl-iters", type=int, default=12, help="Richardson-Lucy iterations")
    args = ap.parse_args()

    bgr = cv2.imread(args.input, cv2.IMREAD_COLOR)
    if bgr is None:
        raise SystemExit(f"could not read {args.input}")

    t = time.time()
    out = hybrid_sharpen(bgr, alpha=args.alpha, hp_sigma=args.hp_sigma, sharpness=args.sharpness,
                         do_denoise=args.denoise, ai_model=args.ai_model, restored=args.restored,
                         psf_sigma=args.psf_sigma, rl_iters=args.rl_iters)
    cv2.imwrite(args.output, out)
    src = "external" if args.restored else ("AI:" + args.ai_model if args.ai_model else "RL-deconv")
    print(f"{args.input} {bgr.shape[1]}x{bgr.shape[0]} sharpened [{src}] "
          f"in {time.time()-t:.1f}s -> {args.output}")


if __name__ == "__main__":
    main()
