# Interactive Crop/Transform UX Implementation

**Date:** 2025-10-02
**Status:** Planning

---

## Overview

Implement professional photo editor crop/transform experience with:
- 3x3 grid overlay
- Darkened crop-out areas
- Live preview mode
- Apply/Cancel buttons
- Canvas auto-resize

---

## Phase 1: State Management ✅ (Ready to implement)

### Add Preview/Applied Mode States
- [ ] Add `isPreviewMode` state to CropModule
- [ ] Track `originalParams` before changes
- [ ] Add `previewParams` for live updates
- [ ] Add Apply/Cancel methods

### UI Changes
- [ ] Add "Apply" button (commits changes)
- [ ] Add "Cancel" button (reverts to original)
- [ ] Disable sliders when not in preview mode
- [ ] Show status: "Preview Mode" or "Applied"

**Files to modify:**
- `src/modules/CropModule.ts` - Add state management
- `src/components/Modules/CropModuleComponent.tsx` - Add Apply/Cancel buttons

---

## Phase 2: Canvas Overlay System 🔄 (Major work)

### Create Overlay Component
- [ ] New component: `CropTransformOverlay.tsx`
- [ ] Render 3x3 grid (rule of thirds)
- [ ] Darken areas outside crop region
- [ ] Position overlay over canvas image

### Grid Rendering
- [ ] Grid stays straight (doesn't rotate)
- [ ] Show grid only during preview mode
- [ ] Adjust grid to crop region bounds
- [ ] Style: white lines, semi-transparent

### Darkened Areas
- [ ] Semi-transparent black overlay outside crop
- [ ] Calculate crop region coordinates
- [ ] Use SVG mask or canvas overlay
- [ ] Opacity: ~60% for cropped-out areas

**Files to create:**
- `src/components/Canvas/CropTransformOverlay.tsx`

**Files to modify:**
- `src/components/Layout/Canvas.tsx` - Add overlay rendering

---

## Phase 3: Rotation Preview 🔄 (Complex)

### Show Rotated Preview
- [ ] Rotate image visually (CSS transform)
- [ ] Keep grid straight
- [ ] Show final canvas bounds
- [ ] Handle rotation + crop together

### Visual Indicators
- [ ] Show rotation angle on image
- [ ] Indicate final canvas size
- [ ] Show what will be cropped out after rotation
- [ ] Preview button: "Preview Rotation"

**Challenge:** Showing rotation preview WITHOUT processing image data (use CSS transform for speed)

---

## Phase 4: Canvas Viewport Updates 🔄 (Critical)

### Auto-Resize After Apply
- [ ] Detect dimension changes
- [ ] Call `setViewport()` with new dimensions
- [ ] Re-center image in canvas
- [ ] Zoom to fit new dimensions

### Dimension Tracking
- [ ] Track dimensions before/after crop
- [ ] Track dimensions before/after rotation
- [ ] Update canvas viewport automatically
- [ ] Maintain aspect ratio

**Files to modify:**
- `src/components/Layout/Canvas.tsx` - Add viewport update logic
- `src/stores/appStore.ts` - May need viewport state updates

---

## Phase 5: Interactive Crop Handles 🎯 (Future enhancement)

### Draggable Crop Region
- [ ] Corner handles to resize crop
- [ ] Edge handles to resize crop
- [ ] Drag crop region to reposition
- [ ] Constrain to aspect ratio

### Visual Feedback
- [ ] Handles visible on hover
- [ ] Show dimensions while dragging
- [ ] Snap to grid intersections
- [ ] Preview updates in real-time

**Note:** This is a nice-to-have, can be done after core functionality works

---

## Implementation Order

1. **Phase 1** (1-2 hours) - State management, Apply/Cancel buttons
2. **Phase 2** (2-3 hours) - Grid overlay and darkened areas
3. **Phase 4** (1-2 hours) - Canvas viewport updates (prioritize before Phase 3)
4. **Phase 3** (2-3 hours) - Rotation preview with grid
5. **Phase 5** (4-6 hours) - Interactive handles (optional)

**Total Est:** 6-10 hours for core functionality (Phases 1-4)

---

## Current Issues to Address

1. ❌ Crop happens at top - needs proper centering
2. ❌ Rotation displays from top-left - Canvas doesn't re-center
3. ❌ Canvas doesn't resize after crop/transform applied
4. ❌ No visual feedback (grid, darkened areas)
5. ❌ Changes apply immediately (need preview mode)
6. ❌ Rotation doesn't auto-crop to largest inscribed rectangle (calculateAutoCropForRotation exists but not called!)

## Auto-Crop on Rotation (Critical!)

**Important:** When rotating, automatically apply `calculateAutoCropForRotation()` to:
- Remove black borders from rotation
- Find largest rectangle that fits in rotated image
- Constrain by aspect ratio if set
- Center the crop region

This ensures rotation stays within original image bounds.

---

## Next Steps

Start with **Phase 1** - Add preview mode and Apply/Cancel buttons.
This will give us the foundation for all other features.

**Command to start:**
1. Add state to CropModule
2. Add Apply/Cancel UI
3. Test preview/apply workflow
4. Then move to Phase 2 (overlay system)
