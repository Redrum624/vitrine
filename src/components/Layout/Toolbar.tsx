import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { electronService } from '../../services/ElectronService';
import { useAppStore } from '../../stores/appStore';
import { ChipButton } from '../Controls/ChipButton';

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
  /** Progressive RAW open: background full decode still running — Auto All, Print, Copy Style,
   *  and Paste Style would each act on the graded preview's pixels/stats rather than the neutral
   *  full-res base. Each handler already gates this itself (the source of truth, via
   *  guardDeveloping's toast); disabling the buttons too is a cheap, optional visual affordance
   *  so the greyed-out state matches the functional gate instead of looking clickable while it
   *  silently no-ops (L3 review round 1 added it for Auto All; round 6 P8 extended the same
   *  reactive store read to the other three developing-unsafe actions). */
  developing?: boolean;
  /** True when the sideways heuristic fired for the CURRENT photo — shows the
   *  dismissible "Photo may be sideways — rotate?" chip (v1.37.0 R2 Part C).
   *  The chip NEVER auto-rotates: click applies the suggested lossless
   *  quarter-turn, × dismisses it for that photo for the session. */
  sidewaysHint?: boolean;
  onSidewaysRotate?: () => void;
  onSidewaysDismiss?: () => void;
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
  /** Left-hand content of the docked bar (the filename / folder label). */
  leading?: ReactNode;
}

// Base layout for an idle command-bar button — interactive :hover/:active/:disabled
// states come from .glass-pill-btn in index.css (inline styles can't express
// pseudo-classes). Flat text buttons, like a native command bar.
const pillBtn: CSSProperties = {
  height: '28px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 9px',
  gap: '6px',
  fontSize: '12.5px',
  borderRadius: '5px',
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--glass-text-label)',
  whiteSpace: 'nowrap',
  flex: 'none',
};

const pillIconBtn: CSSProperties = { ...pillBtn, width: '28px', padding: '0', fontSize: '15px' };

const divider: CSSProperties = { width: '1px', height: '16px', margin: '0 6px', background: 'var(--vt-line)', flex: 'none' };

// The docked bar itself (Develop and Gallery variants).
const barStyle: CSSProperties = {
  height: 44,
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: '0 8px 0 6px',
  background: 'var(--vt-chrome)',
  borderBottom: '1px solid var(--vt-line-soft)',
  minWidth: 0,
};

const primaryBtn: CSSProperties = {
  ...pillBtn,
  padding: '0 12px',
  fontWeight: 600,
  color: 'var(--accent-ink)',
  background: 'var(--accent)',
};

// Shared title copy for the four developing-gated actions (Auto All, Print, Copy Style,
// Paste Style) — matches guardDeveloping's toast message exactly (utils/developingGuard.ts).
const DEVELOPING_TITLE = 'Full quality still developing — try again in a moment';

// A toggle that is "on" (Before/After, Reference) reads as a raised, pressed-in tile.
const toggleActive: CSSProperties = {
  background: 'var(--vt-raised)',
  border: '1px solid var(--vt-line)',
  color: 'var(--vt-text)',
};

/**
 * innerWidth below which the Develop bar's secondary actions collapse into the
 * overflow menu when a live measurement isn't available yet (jsdom / first frame).
 * The real app path uses the bar's own measured width (see Toolbar below); this
 * is only the unmeasured fallback.
 */
const COLLAPSE_INNERWIDTH_FALLBACK = 1745;

/** Width the filename label keeps before the bar's secondary actions fold away. */
const LEADING_RESERVE = 240;

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
          className="glass-chrome vt-pop-in"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            transformOrigin: 'top right',
            borderRadius: '8px',
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

export function Toolbar({ onExport, onPrint, onBatchProcess, onUndo: _onUndo, onRedo: _onRedo, canUndo: _canUndo = false, canRedo: _canRedo = false, onZoomIn, onZoomOut, onFitWindow, onActualSize, zoom = 1, onAutoAll, developing = false, sidewaysHint = false, onSidewaysRotate, onSidewaysDismiss, onCopyStyle, onPasteStyle, hasStyleClipboard = false, hasImage = false, onToggleOriginal, showOriginal = false, onToggleReference, referenceMode = false, onOpenFolder, onExportSelected, leading }: ToolbarProps) {
  const { viewMode, selectedImageIds, gallerySortAscending, toggleGallerySortDirection } = useAppStore();

  // Responsive collapse (Develop bar). The bar is docked across the top of the
  // canvas column; when its actions no longer fit beside the leading filename
  // label, the secondary actions (Print, Copy/Paste Style, Reference) fold into
  // the "⋯" overflow menu. The expanded actions width is cached so the decision
  // doesn't oscillate (collapsing shrinks the very thing being measured).
  // Unmeasured (jsdom / first frame) falls back to an innerWidth heuristic so
  // the path stays unit-testable.
  const barRef = useRef<HTMLDivElement>(null);
  const leadingRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const fullWidthRef = useRef(0);
  const [collapsed, setCollapsed] = useState(false);

  useLayoutEffect(() => {
    if (viewMode !== 'develop') return;
    const measure = () => {
      const bar = barRef.current;
      const actions = actionsRef.current;
      if (!bar || !actions) return;
      const barWidth = bar.getBoundingClientRect().width;
      if (barWidth === 0) { // jsdom / not laid out yet
        setCollapsed(window.innerWidth < COLLAPSE_INNERWIDTH_FALLBACK);
        return;
      }
      if (!collapsed) fullWidthRef.current = actions.scrollWidth; // cache only the expanded width
      // The leading label shrinks (and ellipsizes) under pressure, so measure its
      // NATURAL width — and give it up to LEADING_RESERVE px before the actions
      // fold: secondary actions go into "⋯" before the filename truncates.
      const leadingEl = leadingRef.current;
      const leadingChild = leadingEl?.firstElementChild as HTMLElement | null | undefined;
      const leadingNatural = Math.max(leadingEl?.scrollWidth ?? 0, leadingChild?.scrollWidth ?? 0);
      const available = barWidth - Math.min(leadingNatural, LEADING_RESERVE) - 32; // bar padding + breathing room
      setCollapsed((fullWidthRef.current || actions.scrollWidth) > available);
    };
    measure();
    // Re-measure when the bar resizes AND when its contents change size (the
    // filename label appears after an image opens; actions grow/shrink with
    // the sideways hint) — neither changes the bar's own size.
    const ro = new ResizeObserver(measure);
    for (const el of [barRef.current, leadingRef.current, actionsRef.current]) {
      if (el) ro.observe(el);
    }
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [collapsed, viewMode]);

  if (!electronService.isElectron()) return <div />;

  const leadingSlot = (
    <div ref={leadingRef} className="flex items-center" style={{ minWidth: 0, flex: '0 1 auto', overflow: 'hidden' }}>
      {leading}
    </div>
  );

  if (viewMode === 'gallery') {
    const selectedCount = selectedImageIds?.length ?? 0;
    return (
      <div ref={barRef} className="no-select" style={barStyle} role="toolbar" aria-label="Gallery">
        {leadingSlot}
        <div style={{ flex: 1 }} />
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

        <ChipButton onClick={toggleGallerySortDirection} title="Sort the grid by capture time (file date fallback)">
          Sort: Capture time {gallerySortAscending ? '↑' : '↓'}
        </ChipButton>

        <div style={divider} />

        {/* Batch Process — the one solid-accent primary in this bar. */}
        <button
          onClick={onBatchProcess}
          className="glass-pill-primary"
          style={primaryBtn}
          title="Batch process multiple images"
        >
          Batch Process
        </button>
      </div>
    );
  }

  return (
    <div ref={barRef} className="no-select" style={barStyle} role="toolbar" aria-label="Develop">
      {leadingSlot}
      <div style={{ flex: 1, minWidth: 8 }} />
      <div ref={actionsRef} className="flex items-center" style={{ gap: 2, flex: 'none' }}>
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

        {/* Auto All — the bar's one solid-accent primary. Kept inline at every width. */}
        <button
          onClick={onAutoAll}
          disabled={!hasImage || developing}
          className="glass-pill-primary"
          style={primaryBtn}
          title={developing ? DEVELOPING_TITLE : 'Auto-adjust all modules based on image analysis'}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 2v2M8 12v2M2 8h2M12 8h2M4.2 4.2l1.4 1.4M10.4 10.4l1.4 1.4M4.2 11.8l1.4-1.4M10.4 5.6l1.4-1.4" />
          </svg>
          Auto All
        </button>
        {/* "May be sideways?" suggestion chip (v1.37.0 R2 Part C) — sits next to
            Auto All. NON-DESTRUCTIVE: clicking it applies the suggested lossless
            quarter-turn (the heuristic never rotates by itself); × hides it for
            this photo for the session. */}
        {sidewaysHint && hasImage && (
          <span className="flex items-center vt-fade-in" style={{ gap: 0 }}>
            <button
              onClick={onSidewaysRotate}
              className="glass-pill-btn"
              style={{
                ...pillBtn,
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--accent)',
              }}
              title="A dual-signal analysis suggests this photo is lying on its side. Click to apply a lossless quarter-turn in the detected direction — nothing is ever rotated automatically."
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 8a6 6 0 1 1 1.76 4.24" />
                <path d="M2 12.5V8h4.5" />
              </svg>
              Photo may be sideways — rotate?
            </button>
            <button
              onClick={onSidewaysDismiss}
              aria-label="Dismiss sideways suggestion"
              className="glass-pill-btn"
              style={{ ...pillBtn, padding: '0 6px', fontSize: 13, color: 'var(--glass-text-muted)' }}
              title="Hide this suggestion for this photo (this session)"
            >
              ×
            </button>
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
          aria-pressed={showOriginal}
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
            aria-pressed={referenceMode}
            className="glass-pill-btn"
            style={{ ...pillBtn, ...(referenceMode ? toggleActive : null) }}
            title="Compare with a reference photo"
          >
            Reference
          </button>
        )}

        <div style={divider} />

        {/* Zoom cluster at the right end. The % readout doubles as the 1:1 action
            (click → Actual Size). */}
        <button onClick={onZoomOut} className="glass-pill-btn" style={pillIconBtn} title="Zoom Out" aria-label="Zoom Out">−</button>
        <button
          onClick={onActualSize}
          className="glass-pill-btn"
          style={{ ...pillBtn, padding: '0 4px', minWidth: '46px', fontSize: '12px', fontVariantNumeric: 'tabular-nums', color: 'var(--glass-text-secondary)' }}
          title="Actual Size — 100% (1:1)"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={onZoomIn} className="glass-pill-btn" style={pillIconBtn} title="Zoom In" aria-label="Zoom In">+</button>
        <button onClick={onFitWindow} className="glass-pill-btn" style={pillBtn} title="Fit to Window">Fit</button>

        {/* Overflow "⋯" — only when collapsed; holds the secondary actions that were
            pulled out of the bar. All keep working; none have a menu-bar home, so
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
    </div>
  );
}
