import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { SlidersHorizontal, Trash2, FolderOpen } from 'lucide-react';

const MENU_WIDTH_ESTIMATE = 190;
const MENU_HEIGHT_ESTIMATE = 132;
const VIEWPORT_MARGIN = 8;

/** Clamps the cursor position so the menu never renders past the viewport edge —
 *  falls back to the estimate above until the menu's real size is measured
 *  (and stays on the estimate forever in jsdom, where offsetWidth/Height are 0). */
function clampToViewport(x: number, y: number, width: number, height: number): { left: number; top: number } {
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
  const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
  return {
    left: Math.min(Math.max(x, VIEWPORT_MARGIN), maxLeft),
    top: Math.min(Math.max(y, VIEWPORT_MARGIN), maxTop),
  };
}

const itemStyle: CSSProperties = {
  height: '30px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: '8px',
  padding: '0 10px',
  fontSize: '12.5px',
  borderRadius: '7px',
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--glass-text-chrome-primary)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  width: '100%',
};

interface GalleryTileContextMenuProps {
  /** Cursor position (MouseEvent.clientX/clientY from the contextmenu event) — viewport-relative,
   *  matching this menu's `position: fixed`. */
  x: number;
  y: number;
  onOpen: () => void;
  onRemove: () => void;
  onShowInExplorer: () => void;
  onClose: () => void;
}

/**
 * Right-click popover for a Gallery tile (Task Q5, P11 follow-up). A plain glass
 * popover — role="menu", deliberately NOT aria-modal, mirroring the Toolbar's
 * "More actions" overflow popover (ToolbarOverflowMenu in Layout/Toolbar.tsx):
 * same glass-chrome idiom, same outside-click/Esc dismissal via a document
 * mousedown + capture-phase keydown listener. Not aria-modal means global
 * shortcuts stay live while it's open (keyboardScope.ts does not need to know
 * about it) — every one of this menu's own actions closes it, so it never
 * lingers stale.
 *
 * "Remove…" deliberately does NOT delete anything itself — it just forwards the
 * target ids to the caller (`onRequestRemove` on GalleryView), which routes to
 * App's existing `removeTargetIds` state and the single GalleryRemoveDialog
 * confirm gate (same path the gallery's Del key uses). No second destructive path.
 */
export function GalleryTileContextMenu({ x, y, onOpen, onRemove, onShowInExplorer, onClose }: GalleryTileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => clampToViewport(x, y, MENU_WIDTH_ESTIMATE, MENU_HEIGHT_ESTIMATE));

  // Re-clamp against the menu's REAL measured size once mounted. Also re-runs
  // whenever x/y change (a second contextmenu while the menu is already open
  // updates the SAME mounted instance's props — no key prop, so React updates
  // rather than remounts; the [x, y] deps re-clamp on mount and reposition alike).
  useLayoutEffect(() => {
    const el = menuRef.current;
    const width = el?.offsetWidth || MENU_WIDTH_ESTIMATE;
    const height = el?.offsetHeight || MENU_HEIGHT_ESTIMATE;
    setPos(clampToViewport(x, y, width, height));
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Capture phase + stopImmediatePropagation: this menu is deliberately not
        // aria-modal, so keyboardScope.ts's dialog guard does NOT shield the
        // filmstrip dock's own bubble-phase Esc listener (ThumbnailPanel) — consume
        // the key here, before it, same pattern as ToolbarOverflowMenu.
        e.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);

  const runAndClose = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      className="glass-chrome"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        borderRadius: '10px',
        padding: '5px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        minWidth: '190px',
        zIndex: 60,
      }}
    >
      <button type="button" role="menuitem" className="glass-pill-btn" style={itemStyle} onClick={() => runAndClose(onOpen)}>
        <SlidersHorizontal size={13} />
        Open
      </button>
      <button type="button" role="menuitem" className="glass-pill-btn" style={itemStyle} onClick={() => runAndClose(onRemove)}>
        <Trash2 size={13} />
        Remove…
      </button>
      <button type="button" role="menuitem" className="glass-pill-btn" style={itemStyle} onClick={() => runAndClose(onShowInExplorer)}>
        <FolderOpen size={13} />
        Show in Explorer
      </button>
    </div>
  );
}

export default GalleryTileContextMenu;
