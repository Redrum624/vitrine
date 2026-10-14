/**
 * cropGeometry — the single, pure source of truth for crop/straighten geometry
 * (v1.40.0 Task 9a). Every consumer derives its numbers from here:
 *  - CropModule.process / getOutputDimensions / rotate (CPU render + export)
 *  - the auto (inscribed) rect for a straighten angle
 *  - the interactive handles' live clamp and the crop card's handlers
 *  - (Task 10a) the GPU crop pass uniforms
 *
 * Pipeline order (matches CropModule.process):
 *   1. lossless orientation (0/90/180/270 CW) — 90/270 swap the frame to oriW x oriH
 *   2. flips (in the oriented frame; they never change geometry)
 *   3. fine rotation by `angle` about the frame centre into an expanded canvas
 *      expW x expH (ceil of the rotated bounding box)
 *   4. integer crop rect cropX/cropY/outW/outH of the expanded canvas
 *
 * Sampling convention (pixel CENTRES): output pixel index (px, py) has its
 * centre at (px + 0.5, py + 0.5) in canvas units; the inverse rotation maps it
 * to continuous source coordinates u, and the sampled source INDEX is u - 0.5.
 * A sample is valid (not fill) iff 0 <= s < ori - 1 on both axes — exactly the
 * predicate CropModule.samplePixel applies.
 *
 * "Wedge-free" = every pixel of the integer crop rect samples a valid source
 * position. The valid set is the preimage of a box under an affine map, hence
 * convex, so the 4 corner pixel indices suffice.
 */

export type CropOrientation = 0 | 90 | 180 | 270;
export type ResampleMethod = 'nearest' | 'bilinear' | 'bicubic';

/** Normalized (0-1) crop rect relative to the expanded (rotated) canvas. */
export interface NormalizedCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The subset of CropParams the geometry depends on. */
export interface CropGeometryParams extends NormalizedCropRect {
  angle: number;
  orientation?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  expandCanvas?: boolean;
  fillColor?: [number, number, number, number];
  resampleMethod?: ResampleMethod;
  /** Only 'free' vs locked matters (edge-handle clamp keeps a locked ratio). */
  aspectRatio?: string;
}

export interface CropGeometry {
  /** Input (pre-orientation) dims. */
  inW: number;
  inH: number;
  orientation: CropOrientation;
  flipH: boolean;
  flipV: boolean;
  /** Frame dims after orientation (swapped for 90/270). */
  oriW: number;
  oriH: number;
  /** Fine rotation in degrees and whether it is applied at all. */
  angle: number;
  rotated: boolean;
  /** Rotation centre in continuous source units (oriW/2, oriH/2). */
  cx: number;
  cy: number;
  cos: number;
  sin: number;
  /** Canvas position (continuous units) of the rotation centre. */
  offX: number;
  offY: number;
  /** Expanded canvas dims (== oriW/oriH when not rotated). */
  expW: number;
  expH: number;
  /** Integer crop rect in expanded-canvas pixels — also the output dims. */
  cropX: number;
  cropY: number;
  outW: number;
  outH: number;
  method: ResampleMethod;
  fill: [number, number, number, number];
}

/** Below this |angle| the fine rotation is skipped entirely (historic threshold). */
export const ROTATION_EPSILON_DEG = 0.01;

const DEFAULT_FILL: [number, number, number, number] = [0, 0, 0, 1];

export function normalizeOrientation(raw: unknown): CropOrientation {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n)) return 0;
  const o = ((Math.round(n / 90) * 90) % 360 + 360) % 360;
  return (o === 90 || o === 180 || o === 270) ? o : 0;
}

/** Expanded-canvas size for a frame rotated by angleDeg (continuous bbox, ceil'd). */
export function rotatedCanvasSize(
  frameW: number, frameH: number, angleDeg: number, expandCanvas = true,
): { width: number; height: number; offX: number; offY: number } {
  if (!expandCanvas || Math.abs(angleDeg) <= ROTATION_EPSILON_DEG) {
    return { width: frameW, height: frameH, offX: frameW / 2, offY: frameH / 2 };
  }
  const r = (angleDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const hx = frameW / 2;
  const hy = frameH / 2;
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const [dx, dy] of [[-hx, -hy], [hx, -hy], [-hx, hy], [hx, hy]]) {
    const rx = dx * c - dy * s;
    const ry = dx * s + dy * c;
    if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
  }
  return { width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY), offX: -minX, offY: -minY };
}

export function computeCropGeometry(params: CropGeometryParams, inW: number, inH: number): CropGeometry {
  const orientation = normalizeOrientation(params.orientation);
  const swapped = orientation === 90 || orientation === 270;
  const oriW = swapped ? inH : inW;
  const oriH = swapped ? inW : inH;
  const angle = Number(params.angle) || 0;
  const rotated = Math.abs(angle) > ROTATION_EPSILON_DEG;
  const r = (angle * Math.PI) / 180;
  const canvas = rotatedCanvasSize(oriW, oriH, rotated ? angle : 0, params.expandCanvas !== false);
  const expW = canvas.width;
  const expH = canvas.height;

  // Integer crop — the historic floor convention, bounded to the canvas.
  const cropX = Math.min(Math.max(0, Math.floor(params.x * expW)), Math.max(0, expW - 1));
  const cropY = Math.min(Math.max(0, Math.floor(params.y * expH)), Math.max(0, expH - 1));
  const outW = Math.max(1, Math.min(Math.max(1, Math.floor(params.width * expW)), expW - cropX));
  const outH = Math.max(1, Math.min(Math.max(1, Math.floor(params.height * expH)), expH - cropY));

  return {
    inW, inH, orientation,
    flipH: !!params.flipHorizontal,
    flipV: !!params.flipVertical,
    oriW, oriH, angle, rotated,
    cx: oriW / 2, cy: oriH / 2,
    cos: rotated ? Math.cos(r) : 1,
    sin: rotated ? Math.sin(r) : 0,
    offX: canvas.offX, offY: canvas.offY,
    expW, expH, cropX, cropY, outW, outH,
    method: params.resampleMethod ?? 'bicubic',
    fill: params.fillColor ?? DEFAULT_FILL,
  };
}

/** Expanded-canvas pixel INDEX -> source sample INDEX in the oriented frame. */
export function mapCanvasPixelToSource(geom: CropGeometry, px: number, py: number): { sx: number; sy: number } {
  const dx = px + 0.5 - geom.offX;
  const dy = py + 0.5 - geom.offY;
  return {
    sx: dx * geom.cos + dy * geom.sin + geom.cx - 0.5,
    sy: -dx * geom.sin + dy * geom.cos + geom.cy - 0.5,
  };
}

/** The renderer's sample predicate (CropModule.samplePixel keeps fill otherwise). */
export function isSourceSampleValid(geom: CropGeometry, sx: number, sy: number): boolean {
  return sx >= 0 && sx < geom.oriW - 1 && sy >= 0 && sy < geom.oriH - 1;
}

/** True when no pixel of the integer crop rect would render fill. */
export function isPixelRectWedgeFree(geom: CropGeometry): boolean {
  if (!geom.rotated) return true; // orientation/flips are lossless remaps
  const x0 = geom.cropX;
  const y0 = geom.cropY;
  const x1 = geom.cropX + geom.outW - 1;
  const y1 = geom.cropY + geom.outH - 1;
  for (const [px, py] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    const { sx, sy } = mapCanvasPixelToSource(geom, px, py);
    if (!isSourceSampleValid(geom, sx, sy)) return false;
  }
  return true;
}

/** Scale between a frame and its largest same-aspect rect inscribed after rotation. */
export function inscribedScale(frameW: number, frameH: number, angleDeg: number): number {
  const r = Math.abs((angleDeg * Math.PI) / 180);
  return Math.cos(r) + Math.sin(r) * Math.max(frameW / frameH, frameH / frameW);
}

/**
 * Anchors for clampRectWedgeFree:
 *  - 'best'         (default; render backstop) try the centre and each of the
 *                   four corners as the fixed point, shrinking uniformly (ratio
 *                   kept), and keep the LARGEST-AREA valid result. A rect that
 *                   only overshoots on one side keeps its other edges — the
 *                   owner's framing survives (v1.40.0 fix round 1).
 *  - 'center'       shrink uniformly about the rect centre
 *  - 'move'         translation clamp, size unchanged when possible
 *  - handle names   the opposite corner/edge stays fixed while shrinking
 * When no shrink family can work (every candidate fixed point already lies in
 * a wedge, e.g. the rect's centre and corners are all outside the photo), the
 * rect is TRANSLATED toward the valid region (translateIntoValid): size kept,
 * position the closest valid one found along the way back, then x and y
 * recovered independently toward the request.
 */
export type CropClampAnchor = 'best' | 'center' | 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

const BISECT_STEPS = 48;

/** Largest t in [0,1] with valid(t), given valid(0) and monotone validity. */
function bisect(valid: (t: number) => boolean): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < BISECT_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (valid(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

/**
 * Shrink a rect toward the fixed point (fx, fy) — normalized coords —
 * scaling width by t when sw, height by t when sh.
 */
function scaledRect(rect: NormalizedCropRect, fx: number, fy: number, sw: boolean, sh: boolean, t: number): NormalizedCropRect {
  return {
    x: sw ? fx + (rect.x - fx) * t : rect.x,
    y: sh ? fy + (rect.y - fy) * t : rect.y,
    width: sw ? rect.width * t : rect.width,
    height: sh ? rect.height * t : rect.height,
  };
}

/**
 * Shrink/translate `rect` until it is wedge-free at (inW, inH) under `params`
 * (angle, orientation, ...). Returns `rect` unchanged (same values) when it is
 * already wedge-free or there is no fine rotation. `inW/inH` are the
 * PRE-orientation input dims of the pass being rendered — clamp at the dims you
 * render at, because the integer crop quantizes per resolution.
 */
export function clampRectWedgeFree(
  rect: NormalizedCropRect,
  inW: number,
  inH: number,
  params: Omit<CropGeometryParams, keyof NormalizedCropRect> & Partial<NormalizedCropRect>,
  anchor: CropClampAnchor = 'best',
): NormalizedCropRect {
  if (!(inW > 0) || !(inH > 0)) return rect;
  const at = (r: NormalizedCropRect) => computeCropGeometry({ ...params, ...r }, inW, inH);
  const probe = at(rect);
  if (!probe.rotated || isPixelRectWedgeFree(probe)) return rect;
  const ok = (r: NormalizedCropRect) => isPixelRectWedgeFree(at(r));

  // Shrink families tried in order; the first whose t=0 end is valid wins.
  const families: Array<{ fx: number; fy: number; sw: boolean; sh: boolean }> = [];
  const { x, y, width: w, height: h } = rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const locked = params.aspectRatio !== undefined && params.aspectRatio !== 'free';
  switch (anchor) {
    case 'best':
      families.push(
        { fx: cx, fy: cy, sw: true, sh: true },
        { fx: x, fy: y, sw: true, sh: true },
        { fx: x + w, fy: y, sw: true, sh: true },
        { fx: x, fy: y + h, sw: true, sh: true },
        { fx: x + w, fy: y + h, sw: true, sh: true },
      );
      break;
    case 'center': families.push({ fx: cx, fy: cy, sw: true, sh: true }); break;
    case 'nw': families.push({ fx: x + w, fy: y + h, sw: true, sh: true }); break;
    case 'ne': families.push({ fx: x, fy: y + h, sw: true, sh: true }); break;
    case 'sw': families.push({ fx: x + w, fy: y, sw: true, sh: true }); break;
    case 'se': families.push({ fx: x, fy: y, sw: true, sh: true }); break;
    case 'e':
      if (!locked) families.push({ fx: x, fy: cy, sw: true, sh: false });
      families.push({ fx: x, fy: cy, sw: true, sh: true });
      break;
    case 'w':
      if (!locked) families.push({ fx: x + w, fy: cy, sw: true, sh: false });
      families.push({ fx: x + w, fy: cy, sw: true, sh: true });
      break;
    case 'n':
      if (!locked) families.push({ fx: cx, fy: y + h, sw: false, sh: true });
      families.push({ fx: cx, fy: y + h, sw: true, sh: true });
      break;
    case 's':
      if (!locked) families.push({ fx: cx, fy: y, sw: false, sh: true });
      families.push({ fx: cx, fy: y, sw: true, sh: true });
      break;
    case 'move':
      break;
  }
  let best: NormalizedCropRect | null = null;
  for (const f of families) {
    if (!ok(scaledRect(rect, f.fx, f.fy, f.sw, f.sh, 0))) continue;
    const t = bisect((tt) => ok(scaledRect(rect, f.fx, f.fy, f.sw, f.sh, tt)));
    const candidate = scaledRect(rect, f.fx, f.fy, f.sw, f.sh, t);
    if (anchor !== 'best') return candidate; // ordered fallbacks: first viable wins
    // Largest area wins; ties keep the earlier (centre first).
    if (!best || candidate.width * candidate.height > best.width * best.height * (1 + 1e-9)) best = candidate;
  }
  return best ?? translateIntoValid(rect, probe, ok);
}

/**
 * Translation clamp: slide the rect from its requested position toward the
 * valid region's centre until it fits (the valid region is centrally symmetric
 * and convex, so if the rect fits anywhere it fits centred), then recover as
 * much of the requested x and y independently as stays valid. A rect too big
 * to fit at all is shrunk about the region centre.
 */
function translateIntoValid(
  rect: NormalizedCropRect,
  geom: CropGeometry,
  ok: (r: NormalizedCropRect) => boolean,
): NormalizedCropRect {
  // Valid-region centre in normalized canvas coords: the canvas point that maps
  // to source index ((oriW-1)/2, (oriH-1)/2), i.e. continuous (offX, offY).
  const rcx = geom.offX / geom.expW;
  const rcy = geom.offY / geom.expH;
  const centred = { x: rcx - rect.width / 2, y: rcy - rect.height / 2, width: rect.width, height: rect.height };
  if (!ok(centred)) {
    // Too big to fit anywhere at this size: shrink about the region centre
    // (t=0 is the single centre pixel — always valid).
    const t = bisect((tt) => ok(scaledRect(centred, rcx, rcy, true, true, tt)));
    return scaledRect(centred, rcx, rcy, true, true, t);
  }
  const lerp = (t: number) => ({
    ...centred,
    x: centred.x + (rect.x - centred.x) * t,
    y: centred.y + (rect.y - centred.y) * t,
  });
  let best = lerp(bisect((t) => ok(lerp(t))));
  const fromX = best.x;
  const tx = bisect((t) => ok({ ...best, x: fromX + (rect.x - fromX) * t }));
  best = { ...best, x: fromX + (rect.x - fromX) * tx };
  const fromY = best.y;
  const ty = bisect((t) => ok({ ...best, y: fromY + (rect.y - fromY) * t }));
  return { ...best, y: fromY + (rect.y - fromY) * ty };
}

/**
 * The largest centred same-aspect rect inside a frame rotated by angleDeg,
 * normalized to the expanded canvas, then clamped wedge-free at (frameW, frameH)
 * pixels. frameW/frameH are the ORIENTED frame dims.
 */
export function autoCropRectForRotation(
  frameW: number, frameH: number, angleDeg: number, expandCanvas = true,
): NormalizedCropRect {
  if (Math.abs(angleDeg) < ROTATION_EPSILON_DEG || !(frameW > 0) || !(frameH > 0)) {
    return { x: 0, y: 0, width: 1.0, height: 1.0 };
  }
  const canvas = rotatedCanvasSize(frameW, frameH, angleDeg, expandCanvas);
  const s = inscribedScale(frameW, frameH, angleDeg);
  const width = Math.min(1.0, frameW / s / canvas.width);
  const height = Math.min(1.0, frameH / s / canvas.height);
  const rect = { x: (1.0 - width) / 2, y: (1.0 - height) / 2, width, height };
  return clampRectWedgeFree(rect, frameW, frameH, { angle: angleDeg, orientation: 0, expandCanvas }, 'center');
}
