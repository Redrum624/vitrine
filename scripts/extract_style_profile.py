"""
extract_style_profile.py
========================

Reads a folder of graded JPEGs (the user's portfolio) and extracts statistical
"look" targets matched to the photo_app's AutoAdjustService.analyse() shape.
Bucketed by scene type so AutoAll can pick the most appropriate profile at
runtime based on the current image's stats.

Output: src/services/UserStyleProfile.ts

Run:
    python scripts/extract_style_profile.py \
        --portfolio "/path/to/your/portfolio" \
        --out src/services/UserStyleProfile.ts

The stats computed here mirror AutoAdjustService.analyse() exactly:
  - luminance via Rec.709: 0.2126*R + 0.7152*G + 0.0722*B
  - saturation via HSL (max-min/(max+min) or /(2-max-min))
  - percentiles p1, p5, p25, p50, p75, p95, p99
  - shadow/highlight zones: lum<0.25 / lum>0.75
  - noise estimate (less critical for profiling, but included for parity)
  - meanR/meanG/meanB for color cast

Image processing notes:
  - We work in sRGB float 0..1, NOT linear light.
    AutoAdjustService.analyse() runs on display-referred Float32 data; we mirror
    that semantic so the profile targets are directly comparable to runtime stats.
  - Photos are downsampled to longest-side 768px before analysis. The portfolio
    is graded output, so any downscale that preserves the global tonal
    distribution is fine, and this lets us process 200 files in ~20s.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Iterable, Optional

import numpy as np
from PIL import Image, ImageOps


# ──────────────────────────────────────────────────────────────────────────────
# Stats (parity with AutoAdjustService.ImageStats)
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class ImageStats:
    mean_r: float
    mean_g: float
    mean_b: float
    mean_lum: float
    std_lum: float
    mean_sat: float
    p1: float
    p5: float
    p25: float
    p50: float
    p75: float
    p95: float
    p99: float
    shadow_mean_lum: float
    highlight_mean_lum: float
    shadow_pixel_ratio: float
    highlight_pixel_ratio: float
    # Auxiliary (used for bucketing — not in AutoAdjustService)
    rb_ratio: float       # meanR / meanB, for warm/cool detection
    tonal_span: float     # p95 - p5

    @classmethod
    def empty(cls) -> "ImageStats":
        return cls(*([0.0] * 19))


def analyse(rgb: np.ndarray) -> ImageStats:
    """Compute ImageStats from an HxWx3 float32 array in sRGB 0..1.

    Mirrors AutoAdjustService.analyse() in TypeScript.
    """
    h, w, _ = rgb.shape
    flat = rgb.reshape(-1, 3)
    r, g, b = flat[:, 0], flat[:, 1], flat[:, 2]

    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b

    # HSL saturation, vectorised
    mx = flat.max(axis=1)
    mn = flat.min(axis=1)
    rng = mx - mn
    l = (mx + mn) / 2
    # Avoid divide-by-zero by branching on l > 0.5
    den_low = mx + mn
    den_high = 2 - mx - mn
    sat = np.where(rng == 0, 0,
                   np.where(l > 0.5,
                            np.divide(rng, np.maximum(den_high, 1e-9)),
                            np.divide(rng, np.maximum(den_low, 1e-9))))

    sorted_lum = np.sort(lum)

    def pct(p: float) -> float:
        idx = min(len(sorted_lum) - 1, max(0, int(len(sorted_lum) * p)))
        return float(sorted_lum[idx])

    shadow_mask = lum < 0.25
    highlight_mask = lum > 0.75
    shadow_count = int(shadow_mask.sum())
    highlight_count = int(highlight_mask.sum())
    pixel_count = lum.size

    mean_r, mean_g, mean_b = float(r.mean()), float(g.mean()), float(b.mean())
    mean_lum = float(lum.mean())

    return ImageStats(
        mean_r=mean_r,
        mean_g=mean_g,
        mean_b=mean_b,
        mean_lum=mean_lum,
        std_lum=float(lum.std()),
        mean_sat=float(sat.mean()),
        p1=pct(0.01),
        p5=pct(0.05),
        p25=pct(0.25),
        p50=pct(0.50),
        p75=pct(0.75),
        p95=pct(0.95),
        p99=pct(0.99),
        shadow_mean_lum=float(lum[shadow_mask].mean()) if shadow_count > 0 else 0.0,
        highlight_mean_lum=float(lum[highlight_mask].mean()) if highlight_count > 0 else 1.0,
        shadow_pixel_ratio=shadow_count / pixel_count,
        highlight_pixel_ratio=highlight_count / pixel_count,
        rb_ratio=mean_r / max(1e-6, mean_b),
        tonal_span=pct(0.95) - pct(0.05),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Loading + bucketing
# ──────────────────────────────────────────────────────────────────────────────

JPEG_EXTS = {".jpg", ".jpeg", ".JPG", ".JPEG"}


def load_image(path: Path, max_side: int = 768) -> Optional[np.ndarray]:
    """Open and downsample (longest side = max_side). Returns float32 sRGB 0..1."""
    try:
        with Image.open(path) as im:
            im = ImageOps.exif_transpose(im).convert("RGB")
            w, h = im.size
            scale = max_side / max(w, h)
            if scale < 1.0:
                im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))),
                               Image.LANCZOS)
            arr = np.asarray(im, dtype=np.float32) / 255.0
            return arr
    except Exception as e:
        print(f"  WARN: failed to load {path.name}: {e}", file=sys.stderr)
        return None


# Bucket definitions: tuple (name, predicate(stats) -> bool).
# Order matters — first match wins. Last bucket "standard" is the fallback.
def bucket_of(s: ImageStats) -> str:
    if s.mean_lum < 0.20:
        return "low_light"
    if s.mean_lum > 0.62:
        return "high_key"
    if s.rb_ratio > 1.15 and s.mean_lum < 0.55:
        return "warm"  # golden-hour, indoor tungsten
    if s.rb_ratio < 0.88:
        return "cool"  # overcast, blue-hour, deep shade
    return "standard"


BUCKET_ORDER = ["standard", "warm", "cool", "low_light", "high_key"]


# ──────────────────────────────────────────────────────────────────────────────
# Aggregation
# ──────────────────────────────────────────────────────────────────────────────

def aggregate(stats_list: list[ImageStats]) -> dict:
    """Median-based aggregation of a list of ImageStats. Robust to outliers."""
    if not stats_list:
        return {}
    arr = np.array([list(asdict(s).values()) for s in stats_list], dtype=np.float64)
    keys = list(asdict(stats_list[0]).keys())
    medians = np.median(arr, axis=0)
    means = np.mean(arr, axis=0)
    p25 = np.percentile(arr, 25, axis=0)
    p75 = np.percentile(arr, 75, axis=0)
    out = {}
    for i, k in enumerate(keys):
        out[k] = {
            "median": float(medians[i]),
            "mean":   float(means[i]),
            "p25":    float(p25[i]),
            "p75":    float(p75[i]),
        }
    out["__count__"] = len(stats_list)
    return out


# ──────────────────────────────────────────────────────────────────────────────
# TypeScript output
# ──────────────────────────────────────────────────────────────────────────────

def _f(v: float, ndigits: int = 4) -> str:
    return f"{round(v, ndigits)}"


def build_profile_ts(buckets: dict[str, dict], portfolio_count: int,
                     portfolio_path: str, generated_at: str) -> str:
    """Render the aggregated bucket stats into a TypeScript profile module."""

    portfolio_path = (portfolio_path.replace(" ", " ").replace(" ", " ").replace(" ", " "))

    def render_bucket(name: str, agg: dict) -> str:
        if not agg or "__count__" not in agg:
            return f"  // bucket '{name}' had no samples"

        def m(field: str) -> str:
            return _f(agg[field]["median"])

        # (rgbBalance was dropped in v1.37.0 R2 — its last reader, the Auto
        # Color Balance path, was removed in R1 and the field went unread.)

        return f"""  {name}: {{
    sampleCount: {agg["__count__"]},
    targetMedianLum:            {m("p50")},
    targetMeanLum:              {m("mean_lum")},
    targetStdLum:               {m("std_lum")},
    targetMeanSat:              {m("mean_sat")},
    targetP5:                   {m("p5")},
    targetP25:                  {m("p25")},
    targetP75:                  {m("p75")},
    targetP95:                  {m("p95")},
    targetTonalSpan:            {m("tonal_span")},
    acceptableShadowMeanLum:    {m("shadow_mean_lum")},
    acceptableHighlightMeanLum: {m("highlight_mean_lum")},
    shadowPixelRatio:           {m("shadow_pixel_ratio")},
    highlightPixelRatio:        {m("highlight_pixel_ratio")},
    rbRatio:                    {m("rb_ratio")},
  }}"""

    bucket_blocks = ",\n".join(render_bucket(b, buckets.get(b, {})) for b in BUCKET_ORDER)

    return f"""/**
 * UserStyleProfile
 *
 * AUTO-GENERATED by scripts/extract_style_profile.py — do not edit by hand.
 * Re-run the script after grading more photos:
 *
 *   python scripts/extract_style_profile.py \\
 *     --portfolio "{portfolio_path}" \\
 *     --out src/services/UserStyleProfile.ts
 *
 * Generated:   {generated_at}
 * Source:      {portfolio_path}
 * Photo count: {portfolio_count} processed
 *
 * AutoAdjustService imports this module and uses the bucket-appropriate
 * profile as targets for its autoXxx() methods. selectBucket() chooses
 * which profile applies based on the current image's ImageStats.
 */

export type BucketName = 'standard' | 'warm' | 'cool' | 'low_light' | 'high_key';

export interface StyleProfile {{
  sampleCount: number;
  targetMedianLum: number;
  targetMeanLum: number;
  targetStdLum: number;
  targetMeanSat: number;
  targetP5: number;
  targetP25: number;
  targetP75: number;
  targetP95: number;
  targetTonalSpan: number;
  acceptableShadowMeanLum: number;
  acceptableHighlightMeanLum: number;
  shadowPixelRatio: number;
  highlightPixelRatio: number;
  rbRatio: number;
}}

export interface BucketSelectorStats {{
  mean_lum: number;
  rb_ratio: number;
}}

/**
 * Choose the bucket whose grading characteristics best fit the current image.
 * Order of tests matches scripts/extract_style_profile.py:bucket_of().
 */
export function selectBucket(stats: BucketSelectorStats): BucketName {{
  if (stats.mean_lum < 0.20) return 'low_light';
  if (stats.mean_lum > 0.62) return 'high_key';
  if (stats.rb_ratio > 1.15 && stats.mean_lum < 0.55) return 'warm';
  if (stats.rb_ratio < 0.88) return 'cool';
  return 'standard';
}}

export const userStyleProfile: Record<BucketName, StyleProfile> = {{
{bucket_blocks}
}} as const;
"""


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def _resolve_portfolio(arg_value: str) -> Optional[Path]:
    """Resolve a portfolio path. Two forms accepted:
       1. Direct path (if it exists)
       2. 'parent::substring' — search the parent dir for a directory whose
          name contains the substring. This avoids shell encoding issues with
          non-ASCII folder names (em-dashes, etc.).
    """
    if "::" in arg_value:
        parent_str, pattern = arg_value.split("::", 1)
        parent = Path(parent_str).resolve()
        if not parent.is_dir():
            return None
        matches = [p for p in parent.iterdir() if p.is_dir() and pattern in p.name]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            print(f"WARN: '{pattern}' matched {len(matches)} dirs; using first: {matches[0]}",
                  file=sys.stderr)
            return matches[0]
        return None
    p = Path(arg_value).resolve()
    return p if p.exists() else None


def main() -> int:
    ap = argparse.ArgumentParser(description="Extract style profile from a folder of graded JPEGs.")
    ap.add_argument("--portfolio", required=True,
                    help="Portfolio folder. Either a full path, OR 'parent::substring' "
                         "(e.g. '/path/to/pictures::Portfolio-Sep') to avoid "
                         "shell encoding issues with unicode folder names.")
    ap.add_argument("--out", required=True, help="Output .ts path")
    ap.add_argument("--max-side", type=int, default=768, help="Downsample longest side (px). Default 768.")
    ap.add_argument("--report", default=None, help="Optional JSON report of per-bucket aggregate stats")
    args = ap.parse_args()

    portfolio = _resolve_portfolio(args.portfolio)
    if portfolio is None or not portfolio.exists():
        print(f"ERROR: portfolio folder not found: {args.portfolio}", file=sys.stderr)
        return 2
    print(f"Resolved portfolio: {portfolio}")
    out = Path(args.out).resolve()

    jpegs = sorted(p for p in portfolio.iterdir() if p.suffix in JPEG_EXTS)
    if not jpegs:
        print(f"ERROR: no JPEGs found in {portfolio}", file=sys.stderr)
        return 2

    print(f"Found {len(jpegs)} JPEGs in {portfolio.name}")
    print(f"Analysing (max_side={args.max_side})...")

    bucket_stats: dict[str, list[ImageStats]] = {b: [] for b in BUCKET_ORDER}
    skipped = 0
    t0 = time.monotonic()

    for i, jp in enumerate(jpegs, 1):
        if i % 20 == 0 or i == len(jpegs):
            elapsed = time.monotonic() - t0
            print(f"  [{i}/{len(jpegs)}] {jp.name[:50]:<50} ({elapsed:.1f}s)", flush=True)
        arr = load_image(jp, max_side=args.max_side)
        if arr is None:
            skipped += 1
            continue
        s = analyse(arr)
        bucket_stats[bucket_of(s)].append(s)

    print(f"Done analysing. Skipped {skipped}, processed {len(jpegs) - skipped}.")
    for b in BUCKET_ORDER:
        print(f"  bucket '{b}': {len(bucket_stats[b])} photos")

    aggregates = {b: aggregate(bucket_stats[b]) for b in BUCKET_ORDER}

    ts = build_profile_ts(
        buckets=aggregates,
        portfolio_count=len(jpegs) - skipped,
        portfolio_path=str(portfolio),
        generated_at=time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
    )

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(ts, encoding="utf-8")
    print(f"\nWrote {out}  ({out.stat().st_size} bytes)")

    if args.report:
        report_path = Path(args.report).resolve()
        report_path.write_text(json.dumps(aggregates, indent=2), encoding="utf-8")
        print(f"Wrote {report_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
