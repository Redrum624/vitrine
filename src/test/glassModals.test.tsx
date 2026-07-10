// src/test/glassModals.test.tsx
/**
 * Contract tests for the shared GlassModal chrome (overlay + glass card +
 * header/footer slots) used by every ported dialog. Keep these assertions
 * generic to the chrome itself — per-dialog behavior is covered by each
 * dialog's own contract test (exportProgressBar, batchEnqueue, ...).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { GlassModal } from '../components/Dialogs/GlassModal';

describe('GlassModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <GlassModal isOpen={false} title="Export Image" onClose={() => {}}>
        <div>body</div>
      </GlassModal>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders role=dialog with an accessible name when open', () => {
    render(
      <GlassModal isOpen title="Export Image" onClose={() => {}}>
        <div>body</div>
      </GlassModal>
    );
    expect(screen.getByRole('dialog', { name: 'Export Image' })).toBeInTheDocument();
  });

  it('renders the footer slot when provided', () => {
    render(
      <GlassModal
        isOpen
        title="Export Image"
        onClose={() => {}}
        footer={<button type="button">Do the thing</button>}
      >
        <div>body</div>
      </GlassModal>
    );
    expect(screen.getByRole('button', { name: 'Do the thing' })).toBeInTheDocument();
  });

  it('does not render a footer region when no footer is given', () => {
    const { container } = render(
      <GlassModal isOpen title="Export Image" onClose={() => {}}>
        <div>body</div>
      </GlassModal>
    );
    expect(container.querySelector('[data-testid="glass-modal-footer"]')).not.toBeInTheDocument();
  });

  it('carries the dc-rise entrance class on the card', () => {
    const { container } = render(
      <GlassModal isOpen title="Export Image" onClose={() => {}}>
        <div>body</div>
      </GlassModal>
    );
    expect(container.querySelector('.dc-rise')).toBeInTheDocument();
  });

  it('renders a close chip that fires onClose when clicked', () => {
    const onClose = jest.fn();
    render(
      <GlassModal isOpen title="Export Image" onClose={onClose}>
        <div>body</div>
      </GlassModal>
    );
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders subtitle and icon when provided', () => {
    render(
      <GlassModal
        isOpen
        title="Export Image"
        subtitle="3 images queued"
        icon={<span data-testid="modal-icon">i</span>}
        onClose={() => {}}
      >
        <div>body</div>
      </GlassModal>
    );
    expect(screen.getByText('3 images queued')).toBeInTheDocument();
    expect(screen.getByTestId('modal-icon')).toBeInTheDocument();
  });

  it('omits the close chip when onClose is not provided', () => {
    render(
      <GlassModal isOpen title="Export Image">
        <div>body</div>
      </GlassModal>
    );
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
  });
});
