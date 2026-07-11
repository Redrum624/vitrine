/**
 * Task P11 — GalleryRemoveDialog contract (destructive-path safety).
 *
 * The dialog is mandatory before any removal: it must name the count, focus the
 * SAFE default ("Remove from session"), spell out that the destructive option
 * goes to the Windows Recycle Bin, and cancel on Esc / outside-click / Cancel.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { GalleryRemoveDialog } from '../components/Dialogs/GalleryRemoveDialog';

const setup = (over: Partial<React.ComponentProps<typeof GalleryRemoveDialog>> = {}) => {
  const props = {
    isOpen: true,
    count: 3,
    onCancel: jest.fn(),
    onRemoveFromSession: jest.fn(),
    onMoveToTrash: jest.fn(),
    ...over,
  };
  render(<GalleryRemoveDialog {...props} />);
  return props;
};

describe('GalleryRemoveDialog', () => {
  it('names the selected count in the title', () => {
    setup({ count: 3 });
    expect(screen.getByText('Remove 3 photos?')).toBeInTheDocument();
  });

  it('uses the singular noun for a single photo', () => {
    setup({ count: 1 });
    expect(screen.getByText('Remove 1 photo?')).toBeInTheDocument();
  });

  it('focuses the safe default action ("Remove from session") on open', () => {
    setup();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove from session' }));
  });

  it('spells out that the destructive option goes to the Windows Recycle Bin', () => {
    setup();
    expect(screen.getByRole('button', { name: /Move to Recycle Bin/ })).toBeInTheDocument();
    expect(screen.getByText(/Windows Recycle Bin/)).toBeInTheDocument();
    // Never a permanent delete — the copy must say so.
    expect(screen.getByText(/never\s+deletes/i)).toBeInTheDocument();
  });

  it('calls onRemoveFromSession when the default action is clicked', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Remove from session' }));
    expect(p.onRemoveFromSession).toHaveBeenCalledTimes(1);
    expect(p.onMoveToTrash).not.toHaveBeenCalled();
  });

  it('calls onMoveToTrash when the Recycle Bin action is clicked', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: /Move to Recycle Bin/ }));
    expect(p.onMoveToTrash).toHaveBeenCalledTimes(1);
    expect(p.onRemoveFromSession).not.toHaveBeenCalled();
  });

  it('cancels on the Cancel button', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels on Escape', () => {
    const p = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(p.onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels on an outside (scrim) click', () => {
    const p = setup();
    // The scrim is the dialog's outer overlay; clicking it (not the card) dismisses.
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(p.onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    setup({ isOpen: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
