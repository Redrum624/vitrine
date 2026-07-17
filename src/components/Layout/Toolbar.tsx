import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { electronService } from '../../services/ElectronService';
import { useAppStore } from '../../stores/appStore';
import { Segmented } from '../Controls/Segmented';
import { ChipButton } from '../Controls/ChipButton';
import { CHIP_LEFT } from '../../layout/photoRegion';

interface ToolbarProps {
  onExport?: () => void;
  onPrint?: () => void;
  onBatchProcess?: () => void;
  onOpenPresets?: () => void;
  onOpenPlugins?: () => void;
  onShowHelp?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitWindow?: () => void;
  onActualSize?: () => void;
  zoom?: number;
  onAutoAll?: () => void;
  /** True when a style grade (Auto All / preset / pasted style) is active — shows the "Styled" chip. */
  styleGradeActive?: boolean;
  /** Progressive RAW open: background full decode still running — Auto All, Print, Copy Style,
   *  and Paste Style would each act on the graded preview's pixels/stats rather than the neutral
   *  full-res base. Each handler already gates this itself (the source of truth, via
   *  guardDeveloping's toast); disabling the buttons too is a cheap, optional visual affordance
   *  so the greyed-out state matches the functional gate instead of looking clickable while it
   *  silently no-ops (L3 review round 1 added it for Auto All; round 6 P8 extended the same
   *  reactive store read to the other three developing-unsafe actions). */
  developing?: boolean;
  onCopyStyle?: () => void;
  onPasteStyle?: () => void;
  hasStyleClipboard?: boolean;
  hasImage?: boolean;
  onToggleOriginal?: () => void;
  showOriginal?: boolean;
  onToggleReference?: () => void;
  referenceMode?: boolean;
  /** Gallery variant (Task 7): opens the native folder picker. */
  onOpenFolder?: () => void;
  /** Gallery variant: exports the current selection (≥1 image) — the same flow
   * the filmstrip dock's "Export N" button triggers (that button itself only
   * appears at ≥2 selected; the Gallery toolbar's Export… routes here at ≥1). */
  onExportSelected?: () => void;
}

/**
 * Develop | Gallery segmented values. Shown ONLY in the Gallery toolbar variant
 * (per the locked spec's §7 Gallery geometry table and the 4a-develop.png/
 * 5a-gallery.png reference screenshots — 4a's own toolbar geometry (§3) doesn't
 * list one). The round-trip is still complete without it in Develop: the dock's
 * Gallery chip goes Develop -> Gallery, and this segmented's "Develop" tab goes
 * Gallery -> Develop. Adding it to the Develop toolbar too was tried and reverted
 * (see task-7-report.md) — it widens the pill enough to overlap the filename chip
 * for longer filenames at axis positions left of window-center.
 */
type ViewModeValue = 'develop' | 'gallery';
const VIEW_MODE_OPTIONS: { value: ViewModeValue; label: string }[] = [
  { value: 'develop', label: 'Develop' },
  { value: 'gallery', label: 'Gallery' },
];

// Base layout for an idle pill button — interactive :hover/:disabled states come
// from .glass-pill-btn in index.css (inline styles can't express pseudo-classes).
const pillBtn: CSSProperties = {
  height: '30px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 10px',
  gap: '5px',
  fontSize: '12.5px',
  borderRadius: '9px',
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--glass-text-chrome-primary)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const pillIconBtn: CSSProperties = { ...pillBtn, width: '30px', padding: '0', fontSize: '15px' };

const divider: CSSProperties = { width: '1px', height: '18px', margin: '0 4px', background: 'var(--glass-border)' };

// Shared title copy for the four developing-gated actions (Auto All, Print, Copy Style,
// Paste Style) — matches guardDeveloping's toast message exactly (utils/developingGuard.ts).
const DEVELOPING_TITLE = 'Full quality still developing — try again in a moment';

// A toggle that is "on" (Before/After, Reference) reads as an accent-soft tile.
const toggleActive: CSSProperties = {
  background: 'var(--accent-soft)',
  border: '1px solid var(--accent-ring)',
  color: 'var(--accent)',
};

/**
 * innerWidth below which the Develop pill's secondary actions collapse into the
 * overflow menu when a live measurement isn't available yet (jsdom / first frame).
 * Derived from the measured collision: the full pill starts overlapping the
 * filename chip at ~1745px innerWidth (see task-8-report.md). The real app path
 * uses the geometric measurement below; this is only the unmeasured fallback.
 */
const COLLAPSE_INNERWIDTH_FALLBACK = 1745;

interface OverflowItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}

/**
 * Overflow "⋯" chip for the responsive-collapsed Develop pill (G5 review): a
 * simple glass popover holding the secondary actions (Print, Copy Style, Paste
 * Style, Reference). Every item keeps its original handler and disabled/active
 * state; click-outside closes. These actions have no menu-bar equivalent — when
 * the toolbar is collapsed, this popover is their only home.
 */
function ToolbarOverflowMenu({ items }: { items: OverflowItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Other Escape handlers (the dock's collapse) also listen on document;
        // stopPropagation() cannot suppress same-target siblings, so consume
        // the key with stopImmediatePropagation, registered in the CAPTURE
        // phase so it runs before bubble-phase document listeners regardless
        // of registration order.
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="glass-pill-btn"
        style={pillIconBtn}
        title="More actions"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="glass-chrome"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            borderRadius: '10px',
            padding: '5px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            minWidth: '150px',
            zIndex: 40,
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                item.onClick?.();
                setOpen(false);
              }}
              className="glass-pill-btn"
              style={{ ...pillBtn, justifyContent: 'flex-start', width: '100%', ...(item.active ? toggleActive : null) }}
              title={item.title}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Toolbar({ onExport, onPrint, onBatchProcess, onUndo: _onUndo, onRedo: _onRedo, canUndo: _canUndo = false, canRedo: _canRedo = false, onZoomIn, onZoomOut, onFitWindow, onActualSize, zoom = 1, onAutoAll, styleGradeActive = false, developing = false, onCopyStyle, onPasteStyle, hasStyleClipboard = false, hasImage = false, onToggleOriginal, showOriginal = false, onToggleReference, referenceMode = false, onOpenFolder, onExportSelected }: ToolbarProps) {
  const { viewMode, setViewMode, selectedImageIds, gallerySortAscending, toggleGallerySortDirection, alignmentAxisX } = useAppStore();

  // Responsive collapse + clamp (Develop pill only, G5 review). Two mechanisms
  // guarantee the axis-centered pill never overlaps the filename chip at any width
  // ≥ 1024 while staying on-axis wherever there is room:
  //   1. COLLAPSE — when the FULL pill (on-axis) would overlap the chip, the
  //      secondary actions (Print, Copy/Paste Style, Reference) fold into the
  //      overflow menu, shrinking the pill so it fits on-axis in the mid range.
  //   2. CLAMP — below the width where even the collapsed pill would overlap, the
  //      pill is shifted right (translateX) so its left edge clears the chip. It
  //      then reads slightly off-axis, but no-overlap is the hard constraint.
  // The decision is derived from the STORE's alignmentAxisX (the actual centering
  // source — App positions the pill at left:axis, translateX(-50%)), NOT the pill's
  // measured left: that lags a frame behind the axis (a separate ResizeObserver
  // drives it) and made the collapse mis-fire. Cached expanded width + axis-based
  // math also prevent a collapse↔expand feedback loop. Unmeasured (jsdom / first
  // frame) falls back to an innerWidth heuristic so the path stays unit-testable.
  const containerRef = useRef<HTMLDivElement>(null);
  const fullWidthRef = useRef(0);
  const [collapsed, setCollapsed] = useState(false);
  const [shift, setShift] = useState(0);
  const CHIP_CLEARANCE = 16;

  useLayoutEffect(() => {
    if (viewMode !== 'develop') { setShift(0); return; }
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) { // jsdom / not laid out yet
        setCollapsed(window.innerWidth < COLLAPSE_INNERWIDTH_FALLBACK);
        setShift(0);
        return;
      }
      if (!collapsed) fullWidthRef.current = rect.width; // cache only the expanded width
      const axis = alignmentAxisX ?? (rect.left + rect.width / 2 - shift);
      const chip = document.querySelector('[data-testid="filename-chip"]') as HTMLElement | null;
      const chipRight = chip ? chip.getBoundingClientRect().right : CHIP_LEFT;
      const minLeft = chipRight + CHIP_CLEARANCE;
      // Collapse if the FULL pill, centered on the axis, would cross the chip.
      const fullLeft = axis - (fullWidthRef.current || rect.width) / 2;
      setCollapsed(fullLeft < minLeft);
      // Clamp: shift right by however much the CURRENT (possibly collapsed) pill's
      // on-axis left edge falls short of the chip. axis & rect.width are both
      // shift-invariant, so this converges without oscillating.
      const onAxisLeft = axis - rect.width / 2;
      setShift(Math.max(0, minLeft - onAxisLeft));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [alignmentAxisX, collapsed, viewMode, shift]);

  if (!electronService.isElectron()) return <div />;

  if (viewMode === 'gallery') {
    const selectedCount = selectedImageIds?.length ?? 0;
    return (
      <div
        className="glass-chrome flex items-center no-select"
        style={{ borderRadius: '14px', padding: '6px 8px', gap: '3px' }}
      >
        <button onClick={onOpenFolder} className="glass-pill-btn" style={pillBtn} title="Open Folder">
          Open Folder
        </button>
        <button
          onClick={() => (selectedCount >= 1 ? onExportSelected?.() : onExport?.())}
          className="glass-pill-btn"
          style={pillBtn}
          title="Export"
        >
          Export…
        </button>

        <div style={divider} />

        <Segmented<ViewModeValue> options={VIEW_MODE_OPTIONS} value={viewMode} onChange={setViewMode} />

        <div style={divider} />

        <ChipButton onClick={toggleGallerySortDirection} title="Sort the grid by capture time (file date fallback)">
          Sort: Capture time {gallerySortAscending ? '↑' : '↓'}
        </ChipButton>

        <div style={divider} />

        {/* Batch Process — the solid-accent primary (mirrors Auto All / Enhance's Apply). */}
        <button
          onClick={onBatchProcess}
          className="glass-pill-primary"
          style={{
            ...pillBtn,
            padding: '0 14px',
            fontWeight: 600,
            color: '#0b0b0c',
            background: 'var(--accent)',
          }}
          title="Batch process multiple images"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2v2M8 12v2M2 8h2M12 8h2M4.2 4.2l1.4 1.4M10.4 10.4l1.4 1.4M4.2 11.8l1.4-1.4M10.4 5.6l1.4-1.4" />
          </svg>
          Batch Process
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="glass-chrome flex items-center no-select"
      style={{ borderRadius: '14px', padding: '6px 8px', gap: '3px', transform: shift ? `translateX(${shift}px)` : undefined }}
    >
      <button onClick={() => electronService.openFile()} className="glass-pill-btn" style={pillBtn} title="Open Image">
        Open
      </button>
      <button onClick={onExport} className="glass-pill-btn" style={pillBtn} title="Export Image">
        Export
      </button>
      {/* Print — secondary; moves to the overflow menu when collapsed. */}
      {!collapsed && (
        <button
          onClick={onPrint}
          disabled={!hasImage || developing}
          className="glass-pill-btn"
          style={pillBtn}
          title={developing ? DEVELOPING_TITLE : 'Print'}
        >
          Print
        </button>
      )}

      <div style={divider} />

      {/* Auto All — the solid-accent primary (mirrors Enhance's Apply). Kept inline
          at every width. */}
      <button
        onClick={onAutoAll}
        disabled={!hasImage || developing}
        className="glass-pill-primary"
        style={{
          ...pillBtn,
          padding: '0 14px',
          fontWeight: 600,
          color: '#0b0b0c',
          background: 'var(--accent)',
        }}
        title={developing ? DEVELOPING_TITLE : 'Auto-adjust all modules based on image analysis'}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2v2M8 12v2M2 8h2M12 8h2M4.2 4.2l1.4 1.4M10.4 10.4l1.4 1.4M4.2 11.8l1.4-1.4M10.4 5.6l1.4-1.4" />
        </svg>
        Auto All
      </button>
      {/* "Styled" chip — visible whenever a style grade (Auto All / preset /
          pasted style) is layered on the decode. The colors on screen come from
          those module params, not the RAW decode — without this hint, a heavy
          grade reads as "the decoder is broken" (verified live: a camera-match
          toggle appeared dead because a style grade dominated the render). */}
      {styleGradeActive && hasImage && (
        <span
          role="status"
          className="glass-pill-btn"
          style={{
            ...pillBtn,
            padding: '0 10px',
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            color: 'var(--accent)',
            cursor: 'help',
          }}
          title={'A style grade is applied on top of the decode (Auto All, a preset, or a pasted style). What you see is those adjustments, not the plain RAW render — reset Tone Curve and Color Balance to see the decode itself.'}
        >
          Styled
        </span>
      )}

      <div style={divider} />

      {/* Copy/Paste Style — secondary; move to the overflow menu when collapsed. */}
      {!collapsed && (
        <>
          <button
            onClick={onCopyStyle}
            disabled={!hasImage || developing}
            className="glass-pill-btn"
            style={pillBtn}
            title={developing ? DEVELOPING_TITLE : 'Analyse and copy the style of the current photo'}
          >
            Copy Style
          </button>
          <button
            onClick={onPasteStyle}
            disabled={!hasImage || developing || !hasStyleClipboard}
            className="glass-pill-btn"
            style={pillBtn}
            title={developing ? DEVELOPING_TITLE : hasStyleClipboard ? 'Apply the copied style to the current photo' : 'Copy a style first'}
          >
            Paste Style
          </button>
          <div style={divider} />
        </>
      )}

      {/* Before/After — kept inline (has the B shortcut and is a primary compare). */}
      <button
        onClick={onToggleOriginal}
        disabled={!hasImage}
        className="glass-pill-btn"
        style={{ ...pillBtn, ...(showOriginal ? toggleActive : null) }}
        title="Toggle before/after comparison (B)"
      >
        Before / After
      </button>
      {/* Reference — secondary; moves to the overflow menu when collapsed. */}
      {!collapsed && (
        <button
          onClick={onToggleReference}
          disabled={!hasImage}
          className="glass-pill-btn"
          style={{ ...pillBtn, ...(referenceMode ? toggleActive : null) }}
          title="Compare with a reference photo"
        >
          Reference
        </button>
      )}

      <div style={divider} />

      {/* Zoom cluster at the right end. The % readout doubles as the 1:1 action
          (click → Actual Size) — matches the reference pill (− 100% + Fit) while
          keeping both the readout and the actual-size semantics. */}
      <button onClick={onZoomOut} className="glass-pill-btn" style={pillIconBtn} title="Zoom Out">−</button>
      <button
        onClick={onActualSize}
        className="glass-pill-btn font-mono"
        style={{ ...pillBtn, padding: '0 6px', minWidth: '46px', fontSize: '11.5px', fontVariantNumeric: 'tabular-nums', color: 'var(--glass-text-chrome-idle)' }}
        title="Actual Size — 100% (1:1)"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button onClick={onZoomIn} className="glass-pill-btn" style={pillIconBtn} title="Zoom In">+</button>
      <button onClick={onFitWindow} className="glass-pill-btn" style={pillBtn} title="Fit to Window">Fit</button>

      {/* Overflow "⋯" — only when collapsed; holds the secondary actions that were
          pulled out of the pill. All keep working; none have a menu-bar home, so
          this popover is the only place to reach them while collapsed. */}
      {collapsed && (
        <>
          <div style={divider} />
          <ToolbarOverflowMenu
            items={[
              { label: 'Print', onClick: onPrint, disabled: !hasImage || developing, title: developing ? DEVELOPING_TITLE : 'Print' },
              { label: 'Copy Style', onClick: onCopyStyle, disabled: !hasImage || developing, title: developing ? DEVELOPING_TITLE : 'Analyse and copy the style of the current photo' },
              { label: 'Paste Style', onClick: onPasteStyle, disabled: !hasImage || developing || !hasStyleClipboard, title: developing ? DEVELOPING_TITLE : hasStyleClipboard ? 'Apply the copied style to the current photo' : 'Copy a style first' },
              { label: 'Reference', onClick: onToggleReference, disabled: !hasImage, active: referenceMode, title: 'Compare with a reference photo' },
            ]}
          />
        </>
      )}
    </div>
  );
}
