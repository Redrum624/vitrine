/**
 * Safelight — docked App shell: title bar, command bar, canvas, docked
 * inspector + tool strip, filmstrip and status bar. jsdom-friendly unit
 * coverage for the pieces that don't need a live layout: the axis store field,
 * the photo-region insets, the filename label composers, and the command
 * bar's Auto All primary + responsive collapse.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useAppStore } from '../stores/appStore';
import { Toolbar } from '../components/Layout/Toolbar';
import { electronService } from '../services/ElectronService';
import {
  formatFilenameChip,
  formatFilenameLabel,
  INSPECTOR_WIDTH,
  PHOTO_INSET_LEFT,
  PHOTO_INSET_RIGHT,
  PHOTO_INSET_TOP,
  PHOTO_INSET_BOTTOM,
  TOOL_STRIP_WIDTH,
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

describe('photo-region insets (docked shell)', () => {
  it('are positive and equal on every side — the chrome is docked, so the photo only needs breathing room', () => {
    for (const inset of [PHOTO_INSET_LEFT, PHOTO_INSET_RIGHT, PHOTO_INSET_TOP, PHOTO_INSET_BOTTOM]) {
      expect(inset).toBeGreaterThan(0);
      expect(inset).toBe(PHOTO_INSET_LEFT);
    }
  });

  it('leave a wide photo region at 1920px even with the inspector and tool strip docked open', () => {
    const canvasWidth = 1920 - INSPECTOR_WIDTH - TOOL_STRIP_WIDTH;
    expect(canvasWidth - PHOTO_INSET_LEFT - PHOTO_INSET_RIGHT).toBeGreaterThan(1200);
  });

  it('getPhotoInsetRight is the same whether or not the inspector is open (it is outside the canvas area)', () => {
    expect(getPhotoInsetRight(true)).toBe(PHOTO_INSET_RIGHT);
    expect(getPhotoInsetRight(false)).toBe(PHOTO_INSET_RIGHT);
  });
});

describe('formatFilenameLabel', () => {
  it('composes `name · i of N` (zoom lives in the command bar\'s zoom cluster)', () => {
    expect(formatFilenameLabel({ name: 'download.png', current: 1, total: 2 })).toBe('download.png · 1 of 2');
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

describe('Toolbar (docked command bar)', () => {
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
    expect(autoAll).toHaveStyle({ background: 'var(--accent)', color: 'var(--accent-ink)' });
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

describe('Toolbar responsive collapse (Develop command bar overflow menu)', () => {
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
