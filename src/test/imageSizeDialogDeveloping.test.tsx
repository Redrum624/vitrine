/**
 * Round-6 P8 polish: ImageSizeDialog's `currentWidth`/`currentHeight` seed always comes from
 * imageService.getCurrentImage() (App.tsx's seed site) — during the progressive-open
 * `developing` window that's the embedded-preview's dims (2048px-class), not the full-res
 * sensor dims. The menu entries that open this dialog are already disabled while developing
 * (v1.17.0, see menuBarImageSizeDevelopingGate.test.tsx), but a dialog instance opened just
 * before the window started, or a future entry point that isn't gated, could still show the
 * dialog while `developing` is true.
 *
 * Investigation (see ImageService.ts): there is NO accessor with true full-res dims during the
 * window either — getOriginalImageDimensions() reads pendingOriginalSource, which is deferred
 * to the PREVIEW's dims at the progressive-open's first pass and only swapped to the full
 * decode's dims in the same synchronous tick that clears `developing` (developFullDecode:
 * deferOriginalSnapshot(rawData) runs immediately before the finally block's
 * setDeveloping(false), no await between them) — so there's no observable window where
 * `developing` is true AND full dims are known. The honest fix: show the current (possibly
 * preview) dims as before, but annotate them so the dialog doesn't silently imply they're the
 * full-res sensor dims.
 */
import { render, screen } from '@testing-library/react';
import { ImageSizeDialog } from '../components/Dialogs/ImageSizeDialog';

describe('ImageSizeDialog — developing-aware dims annotation', () => {
  it('annotates the current-size readout while developing, without hiding the (possibly preview) dims', () => {
    render(
      <ImageSizeDialog
        isOpen
        onClose={jest.fn()}
        onApply={jest.fn()}
        currentWidth={2048}
        currentHeight={1365}
        mode="imageSize"
        developing
      />,
    );
    expect(screen.getByText(/Current: 2048 x 1365 px/)).toBeInTheDocument();
    expect(screen.getByText(/developing full quality/i)).toBeInTheDocument();
  });

  it('shows no annotation once developing is false (or omitted)', () => {
    render(
      <ImageSizeDialog
        isOpen
        onClose={jest.fn()}
        onApply={jest.fn()}
        currentWidth={6000}
        currentHeight={4000}
        mode="imageSize"
      />,
    );
    expect(screen.getByText(/Current: 6000 x 4000 px/)).toBeInTheDocument();
    expect(screen.queryByText(/developing full quality/i)).toBeNull();
  });
});
