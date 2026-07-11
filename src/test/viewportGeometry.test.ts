import {
  computeViewportGeometry,
  overlayContentRect,
  imageAnchorToOverlay,
} from '../utils/viewportGeometry';

// Reference region 1408×790 (a wide photo pane); a 3:2 photo fits height-constrained
// to fit = 1185×790 inside it.
const FIT_W = 1185;
const FIT_H = 790;
const CONT_W = 1408;
const CONT_H = 790;

describe('computeViewportGeometry', () => {
  it('is pixel-identical to the fit-rect at zoom = 1 (viewport = fit, no pan, no offset)', () => {
    const g = computeViewportGeometry(FIT_W, FIT_H, CONT_W, CONT_H, 1, 0, 0);
    expect(g.viewportW).toBe(FIT_W);
    expect(g.viewportH).toBe(FIT_H);
    expect(g.contentW).toBe(FIT_W);
    expect(g.contentH).toBe(FIT_H);
    expect(g.maxPanX).toBe(0);
    expect(g.maxPanY).toBe(0);
    expect(g.offsetX).toBe(0);
    expect(g.offsetY).toBe(0);
  });

  it('keeps the viewport at the fit-rect when zoomed OUT (content smaller, centered)', () => {
    const g = computeViewportGeometry(FIT_W, FIT_H, CONT_W, CONT_H, 0.5, 0, 0);
    expect(g.viewportW).toBe(FIT_W); // box does NOT shrink below fit
    expect(g.viewportH).toBe(FIT_H);
    expect(g.contentW).toBe(FIT_W * 0.5);
    expect(g.maxPanX).toBe(0);
    // Smaller content centered in the fit box.
    expect(g.offsetX).toBeCloseTo((FIT_W - FIT_W * 0.5) / 2, 6);
    expect(g.offsetY).toBeCloseTo((FIT_H - FIT_H * 0.5) / 2, 6);
  });

  it('grows the viewport up to the container and pans in both axes at zoom = 2', () => {
    const g = computeViewportGeometry(FIT_W, FIT_H, CONT_W, CONT_H, 2, 0, 0);
    // content 2370×1580 clamps to the container in X, to itself... in Y it exceeds too.
    expect(g.contentW).toBe(2370);
    expect(g.contentH).toBe(1580);
    expect(g.viewportW).toBe(CONT_W); // clamped to the region width
    expect(g.viewportH).toBe(CONT_H); // clamped to the region height
    expect(g.maxPanX).toBe((2370 - 1408) / 2); // 481
    expect(g.maxPanY).toBe((1580 - 790) / 2); // 395
  });

  it('clamps pan to the bounds and reflects it in the content offset', () => {
    const g = computeViewportGeometry(FIT_W, FIT_H, CONT_W, CONT_H, 2, 9999, -9999);
    expect(g.panX).toBe(g.maxPanX); // clamped to +bound
    expect(g.panY).toBe(-g.maxPanY); // clamped to −bound
    // At +maxPanX the content's left edge reaches the viewport's left edge (offsetX = 0).
    expect(g.offsetX).toBeCloseTo(0, 6);
    // At −maxPanY the content bottom reaches the viewport bottom: offsetY + contentH = viewportH.
    expect(g.offsetY + g.contentH).toBeCloseTo(g.viewportH, 6);
  });

  it('floors the X pan to 0 when a zoomed portrait is still narrower than the region', () => {
    // 3:4 portrait fits to 592×790; at 2× content is 1184×1580 — narrower than the 1408
    // region in X, taller in Y.
    const g = computeViewportGeometry(592, 790, CONT_W, CONT_H, 2, 300, 300);
    expect(g.contentW).toBe(1184);
    expect(g.viewportW).toBe(1184); // viewport hugs the content in X (fully visible)
    expect(g.maxPanX).toBe(0);
    expect(g.panX).toBe(0);
    expect(g.offsetX).toBeCloseTo(0, 6); // (1184 − 1184)/2 + 0
    expect(g.maxPanY).toBe((1580 - 790) / 2);
  });
});

// The grid/rulers overlays used to render in screen space (pinned to the viewport box), so
// at zoom > 1 they detached from the image. They now map image-space anchors through the
// SAME viewport-canvas model via overlayContentRect/imageAnchorToOverlay. These tests prove
// the overlay mapping matches what computeViewportGeometry predicts and that an image anchor
// tracks the image across two zoom/pan states.
describe('overlayContentRect / imageAnchorToOverlay (image-space grid & rulers)', () => {
  it('reproduces the geometry offset/content when given the geometry viewport box', () => {
    const g = computeViewportGeometry(FIT_W, FIT_H, CONT_W, CONT_H, 2, 200, -100);
    // Feed the box the geometry produced + the (already in-bounds) clamped pan.
    const rect = overlayContentRect(FIT_W, FIT_H, g.viewportW, g.viewportH, 2, g.panX, g.panY);
    expect(rect.x).toBeCloseTo(g.offsetX, 6);
    expect(rect.y).toBeCloseTo(g.offsetY, 6);
    expect(rect.w).toBeCloseTo(g.contentW, 6);
    expect(rect.h).toBeCloseTo(g.contentH, 6);
  });

  it('maps the image top-left anchor (0,0) to the content top-left (offset)', () => {
    const g = computeViewportGeometry(FIT_W, FIT_H, CONT_W, CONT_H, 1.5, 0, 0);
    const rect = overlayContentRect(FIT_W, FIT_H, g.viewportW, g.viewportH, 1.5, g.panX, g.panY);
    const topLeft = imageAnchorToOverlay(rect, 0, 0);
    expect(topLeft.x).toBeCloseTo(g.offsetX, 6);
    expect(topLeft.y).toBeCloseTo(g.offsetY, 6);
  });

  it('maps the image center anchor (0.5,0.5) to the viewport center shifted by the pan', () => {
    const zoom = 2;
    const panX = 150;
    const panY = -80;
    const g = computeViewportGeometry(FIT_W, FIT_H, CONT_W, CONT_H, zoom, panX, panY);
    const rect = overlayContentRect(FIT_W, FIT_H, g.viewportW, g.viewportH, zoom, g.panX, g.panY);
    const center = imageAnchorToOverlay(rect, 0.5, 0.5);
    // Image center sits at the box center plus the (clamped) pan.
    expect(center.x).toBeCloseTo(g.viewportW / 2 + g.panX, 6);
    expect(center.y).toBeCloseTo(g.viewportH / 2 + g.panY, 6);
  });

  it('tracks the same image anchor across two different zoom/pan states', () => {
    // State A: zoom 1 (content centered in the fit box, no pan).
    const gA = computeViewportGeometry(FIT_W, FIT_H, CONT_W, CONT_H, 1, 0, 0);
    const rectA = overlayContentRect(FIT_W, FIT_H, gA.viewportW, gA.viewportH, 1, gA.panX, gA.panY);
    // State B: zoom 2 panned right — the SAME image point must move with the content, not
    // stay pinned to the box (the screen-space bug), so its overlay X differs between states.
    const gB = computeViewportGeometry(FIT_W, FIT_H, CONT_W, CONT_H, 2, 300, 0);
    const rectB = overlayContentRect(FIT_W, FIT_H, gB.viewportW, gB.viewportH, 2, gB.panX, gB.panY);

    const anchor = { nx: 0.25, ny: 0.75 };
    const a = imageAnchorToOverlay(rectA, anchor.nx, anchor.ny);
    const b = imageAnchorToOverlay(rectB, anchor.nx, anchor.ny);

    // Each state's mapping equals its own geometry prediction (content origin + fraction·size).
    expect(a.x).toBeCloseTo(gA.offsetX + anchor.nx * gA.contentW, 6);
    expect(b.x).toBeCloseTo(gB.offsetX + anchor.nx * gB.contentW, 6);
    // And the anchor genuinely moved (would be identical if the overlay were screen-fixed).
    expect(Math.abs(b.x - a.x)).toBeGreaterThan(1);
  });
});
