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
  PHOTO_INSET_TOP,
  PHOTO_INSET_BOTTOM,
  RIGHT_COLUMN_OFFSET,
  RIGHT_COLUMN_WIDTH,
} from '../layout/photoRegion';

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
});

describe('Toolbar responsive collapse (Develop pill overflow menu)', () => {
  const setInnerWidth = (w: number) => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: w });
  };

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
