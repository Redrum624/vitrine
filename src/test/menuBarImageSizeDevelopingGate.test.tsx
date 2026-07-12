/**
 * Task 5 (R5) polish: while `developing` is true (the progressive-open window — a fast
 * embedded-JPEG preview is on screen, the full decode is still running in the background),
 * the Image Size / Canvas Size dialog can't seed correct preview dims yet (App.tsx's seed
 * site reads the not-yet-final base). The apply path is already gated
 * (baseMutatingDevelopingGuard.test.ts); this covers the entry point: the two menu items
 * should render disabled/inert while developing, and re-enable once it clears.
 *
 * Rotate/Flip stay enabled here by design — those are gated with an info toast instead
 * (see baseMutatingDevelopingGuard.test.ts), so the menu shouldn't also grey them out.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MenuBar } from '../components/Layout/MenuBar';
import { useAppStore } from '../stores/appStore';

describe('MenuBar — Image Size / Canvas Size disabled while developing', () => {
  afterEach(() => {
    useAppStore.getState().setDeveloping(false);
  });

  it('is inert for Image Size / Canvas Size while developing, but Rotate/Flip stay live', () => {
    useAppStore.getState().setDeveloping(true);
    const onImageSize = jest.fn();
    const onCanvasSize = jest.fn();
    const onRotateCW = jest.fn();

    render(
      <MenuBar
        hasImage
        onImageSize={onImageSize}
        onCanvasSize={onCanvasSize}
        onRotateCW={onRotateCW}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Image' }));

    fireEvent.click(screen.getByText('Image Size...'));
    expect(onImageSize).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Canvas Size...'));
    expect(onCanvasSize).not.toHaveBeenCalled();

    // Rotate/Flip are gated elsewhere (toast), not by the menu — still clickable here.
    fireEvent.click(screen.getByText(/Rotate 90° CW/));
    expect(onRotateCW).toHaveBeenCalledTimes(1);
  });

  it('re-enables Image Size / Canvas Size once developing clears', () => {
    useAppStore.getState().setDeveloping(false);
    const onImageSize = jest.fn();
    const onCanvasSize = jest.fn();

    render(<MenuBar hasImage onImageSize={onImageSize} onCanvasSize={onCanvasSize} />);
    fireEvent.click(screen.getByRole('button', { name: 'Image' }));

    fireEvent.click(screen.getByText('Image Size...'));
    expect(onImageSize).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Image' }));
    fireEvent.click(screen.getByText('Canvas Size...'));
    expect(onCanvasSize).toHaveBeenCalledTimes(1);
  });
});
