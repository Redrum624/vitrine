/**
 * Glass · Sectioned — App shell (Task 5): full-bleed workspace, floating chrome,
 * alignment axis. jsdom-friendly unit coverage for the pieces that don't need a
 * live layout: the axis store field, the derived photo-region insets, the
 * filename-chip composer, and the Toolbar's Auto All primary.
 */
import { render, screen } from '@testing-library/react';
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
