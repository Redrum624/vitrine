/**
 * Glass · Sectioned — App shell (Task 5): full-bleed workspace, floating chrome,
 * alignment axis. jsdom-friendly unit coverage for the pieces that don't need a
 * live layout: the axis store field, the derived photo-region insets, the
 * filename-chip composer, and the Toolbar's Auto All primary.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useAppStore } from '../stores/appStore';
import { Toolbar } from '../components/Layout/Toolbar';
import { electronService } from '../services/ElectronService';
import {
  formatFilenameChip,
  PHOTO_INSET_LEFT,
  PHOTO_INSET_RIGHT,
  PHOTO_INSET_RIGHT_NO_COLUMN,
  PHOTO_INSET_TOP,
  PHOTO_INSET_BOTTOM,
  PHOTO_RAIL_CLEARANCE,
  RAIL_BOX_WIDTH,
  RAIL_OFFSET,
  RIGHT_COLUMN_OFFSET,
  RIGHT_COLUMN_WIDTH,
  getPhotoInsetRight,
} from '../layout/photoRegion';

// Shared by every describe block below that needs the Toolbar's Develop pill NOT to
// collapse into the overflow menu (see "Toolbar responsive collapse" for the mechanism).
const setInnerWidth = (w: number) => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: w });
};

describe('alignment axis store field', () => {
  it('defaults to null and round-trips through the setter', () => {
    expect(useAppStore.getState().alignmentAxisX).toBeNull();
    useAppStore.getState().setAlignmentAxisX(752);
    expect(useAppStore.getState().alignmentAxisX).toBe(752);
    useAppStore.getState().setAlignmentAxisX(null);
    expect(useAppStore.getState().alignmentAxisX).toBeNull();
  });
});

describe('photo-region insets', () => {
  it('are positive and leave a photo region wider than it is inset on the left', () => {
    for (const inset of [PHOTO_INSET_LEFT, PHOTO_INSET_RIGHT, PHOTO_INSET_TOP, PHOTO_INSET_BOTTOM]) {
      expect(inset).toBeGreaterThan(0);
    }
    // At the 1920px reference the region stays comfortably wide.
    expect(1920 - PHOTO_INSET_LEFT - PHOTO_INSET_RIGHT).toBeGreaterThan(600);
  });

  it('derive the right inset so it fully clears the floating right column', () => {
    // Column offset (88) + width (392) + 8px clearance = 488: the photo region's
    // right edge stays LEFT of the column's left edge at every window width, so a
    // width-filling photo never sits under the column (spec §3 "nothing overlaps").
    expect(PHOTO_INSET_RIGHT).toBe(RIGHT_COLUMN_OFFSET + RIGHT_COLUMN_WIDTH + 8);
    expect(PHOTO_INSET_RIGHT).toBeGreaterThan(RIGHT_COLUMN_OFFSET + RIGHT_COLUMN_WIDTH);
  });

  describe('getPhotoInsetRight (Task 4/R4 — recenters when the right column closes)', () => {
    it('uses the full column-clearing inset when the column is visible', () => {
      expect(getPhotoInsetRight(true)).toBe(PHOTO_INSET_RIGHT);
    });

    it('shrinks to the rail-clearing inset when the column is hidden', () => {
      expect(getPhotoInsetRight(false)).toBe(PHOTO_INSET_RIGHT_NO_COLUMN);
      // Strictly smaller than the column-clearing inset — the photo recenters
      // (more of the workspace becomes photo region) once the column closes.
      expect(PHOTO_INSET_RIGHT_NO_COLUMN).toBeLessThan(PHOTO_INSET_RIGHT);
    });

    it('the no-column inset still fully clears the floating icon rail (no overlap)', () => {
      // Rail's left edge sits RAIL_OFFSET + RAIL_BOX_WIDTH from the workspace's
      // right edge; the photo's right edge (PHOTO_INSET_RIGHT_NO_COLUMN) must sit
      // AT LEAST that far in, plus PHOTO_RAIL_CLEARANCE of breathing room.
      expect(PHOTO_INSET_RIGHT_NO_COLUMN).toBe(RAIL_OFFSET + RAIL_BOX_WIDTH + PHOTO_RAIL_CLEARANCE);
      const railLeftEdge = RAIL_OFFSET + RAIL_BOX_WIDTH;
      expect(PHOTO_INSET_RIGHT_NO_COLUMN - railLeftEdge).toBeGreaterThanOrEqual(18);
    });
  });
});

describe('formatFilenameChip', () => {
  it('composes `name · i of N · zoom%`', () => {
    expect(formatFilenameChip({ name: 'download.png', current: 1, total: 2, zoom: 1 })).toBe(
      'download.png · 1 of 2 · 100%',
    );
  });

  it('rounds the live zoom fraction to a whole percent', () => {
    expect(formatFilenameChip({ name: 'P9190037.JPG', current: 3, total: 12, zoom: 0.666 })).toBe(
      'P9190037.JPG · 3 of 12 · 67%',
    );
  });
});

describe('Toolbar (floating pill)', () => {
  beforeEach(() => {
    jest.spyOn(electronService, 'isElectron').mockReturnValue(true);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    setInnerWidth(1024); // restore jsdom default
  });

  it('renders Auto All as the solid-accent primary', () => {
    render(<Toolbar hasImage zoom={1} onAutoAll={jest.fn()} />);
    const autoAll = screen.getByRole('button', { name: /auto all/i });
    expect(autoAll).toHaveClass('glass-pill-primary');
    // Solid accent fill + dark glyph text = the primary treatment.
    expect(autoAll).toHaveStyle({ background: 'var(--accent)', color: '#0b0b0c' });
  });

  it('keeps the zoom cluster readout in sync with the zoom prop', () => {
    render(<Toolbar hasImage zoom={0.5} />);
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  // Round-6 P8: Print/Copy Style/Paste Style get the same reactive `developing` visual
  // disable Auto All already had (L3 review round 1) — the functional gate (guardDeveloping's
  // toast) already existed on their handlers; this only makes the affordance visibly inert too.
  it('greys out Auto All, Print, Copy Style, and Paste Style while developing (wide window, inline)', () => {
    setInnerWidth(1920);
    render(
      <Toolbar
        hasImage
        zoom={1}
        developing
        onAutoAll={jest.fn()}
        onPrint={jest.fn()}
        onCopyStyle={jest.fn()}
        onPasteStyle={jest.fn()}
        hasStyleClipboard
      />,
    );
    expect(screen.getByRole('button', { name: /auto all/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /copy style/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /paste style/i })).toBeDisabled();
    // Title mirrors guardDeveloping's own toast copy so hover explains the greyed-out state.
    expect(screen.getByRole('button', { name: 'Print' })).toHaveAttribute(
      'title',
      'Full quality still developing — try again in a moment',
    );
  });

  it('re-enables Print, Copy Style, and Paste Style once developing clears (Paste Style still composes with hasStyleClipboard)', () => {
    setInnerWidth(1920);
    const { rerender } = render(
      <Toolbar
        hasImage
        zoom={1}
        developing={false}
        onPrint={jest.fn()}
        onCopyStyle={jest.fn()}
        onPasteStyle={jest.fn()}
        hasStyleClipboard={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Print' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /copy style/i })).not.toBeDisabled();
    // Composed, not replaced: no clipboard still disables Paste Style even though not developing.
    expect(screen.getByRole('button', { name: /paste style/i })).toBeDisabled();

    rerender(
      <Toolbar
        hasImage
        zoom={1}
        developing={false}
        onPrint={jest.fn()}
        onCopyStyle={jest.fn()}
        onPasteStyle={jest.fn()}
        hasStyleClipboard
      />,
    );
    expect(screen.getByRole('button', { name: /paste style/i })).not.toBeDisabled();
  });
});

describe('Toolbar responsive collapse (Develop pill overflow menu)', () => {
  beforeEach(() => {
    jest.spyOn(electronService, 'isElectron').mockReturnValue(true);
    useAppStore.setState({ viewMode: 'develop' });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    setInnerWidth(1024); // restore jsdom default
  });

  it('keeps the secondary actions inline at a wide window (no overflow menu)', () => {
    setInnerWidth(1920);
    render(
      <Toolbar hasImage zoom={1} onPrint={jest.fn()} onCopyStyle={jest.fn()} onPasteStyle={jest.fn()} hasStyleClipboard onToggleReference={jest.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy style/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /paste style/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reference' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more actions/i })).toBeNull();
  });

  it('collapses the secondary actions into the overflow menu at a narrow window', () => {
    setInnerWidth(1200);
    render(
      <Toolbar hasImage zoom={1} onPrint={jest.fn()} onCopyStyle={jest.fn()} onPasteStyle={jest.fn()} onToggleReference={jest.fn()} />,
    );
    // Pulled out of the pill (not inline)…
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull();
    expect(screen.queryByRole('button', { name: /copy style/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /paste style/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reference' })).toBeNull();
    // …into the overflow chip; primary + kept actions stay inline.
    expect(screen.getByRole('button', { name: /more actions/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /auto all/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /before \/ after/i })).toBeInTheDocument();
    expect(screen.getByText('Fit')).toBeInTheDocument();
  });

  it('opens the overflow popover and dispatches each secondary action', () => {
    setInnerWidth(1200);
    const onPrint = jest.fn();
    const onCopyStyle = jest.fn();
    const onPasteStyle = jest.fn();
    const onToggleReference = jest.fn();
    render(
      <Toolbar hasImage zoom={1} onPrint={onPrint} onCopyStyle={onCopyStyle} onPasteStyle={onPasteStyle} hasStyleClipboard onToggleReference={onToggleReference} />,
    );

    expect(screen.queryByRole('menu')).toBeNull(); // closed initially

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Print' }));
    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull(); // click closes the popover

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /copy style/i }));
    expect(onCopyStyle).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /paste style/i }));
    expect(onPasteStyle).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Reference' }));
    expect(onToggleReference).toHaveBeenCalledTimes(1);
  });

  // Round-6 P8: the collapsed overflow menu's Print/Copy Style/Paste Style items mirror
  // the inline buttons' developing-disabled state — same source prop, same treatment.
  it('greys out Print, Copy Style, and Paste Style inside the overflow menu while developing', () => {
    setInnerWidth(1200);
    render(
      <Toolbar
        hasImage
        zoom={1}
        developing
        onPrint={jest.fn()}
        onCopyStyle={jest.fn()}
        onPasteStyle={jest.fn()}
        hasStyleClipboard
        onToggleReference={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Print' })).toBeDisabled();
    expect(within(menu).getByRole('menuitem', { name: /copy style/i })).toBeDisabled();
    expect(within(menu).getByRole('menuitem', { name: /paste style/i })).toBeDisabled();
    // Reference isn't developing-unsafe (no pixel/stat bake) — stays live.
    expect(within(menu).getByRole('menuitem', { name: 'Reference' })).not.toBeDisabled();
  });

  it('closes the overflow popover on an outside click', () => {
    setInnerWidth(1200);
    render(<Toolbar hasImage zoom={1} onPrint={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the overflow popover on Escape (a11y minor, Fix round 1)', () => {
    setInnerWidth(1200);
    render(<Toolbar hasImage zoom={1} onPrint={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
