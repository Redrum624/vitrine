/**
 * The crash screen is the one surface every user sees when something goes wrong; it used to
 * render with dead Tailwind classes (transparent background, unstyled grey buttons). Pin the
 * Safelight version: plain-language copy, one accent primary (Try Again), a Reload fallback,
 * and the technical details folded away.
 */
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../components/ErrorBoundary';

jest.mock('../services/ErrorHandlingService', () => ({ errorHandlingService: { handleError: jest.fn(() => 'ERR-1') } }));
jest.mock('../services/CanvasPoolService', () => ({ canvasPoolService: { clearPool: jest.fn() } }));
jest.mock('../services/ImageCacheService', () => ({ imageCacheService: { clear: jest.fn() } }));

function Boom(): never {
  throw new Error('kaboom');
}

describe('ErrorBoundary crash screen', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => (console.error as jest.Mock).mockRestore());

  it('shows plain-language recovery actions with the accent primary', () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Vitrine ran into a problem')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try Again/ })).toHaveClass('glass-modal-btn-primary');
    expect(screen.getByRole('button', { name: 'Reload Window' })).toHaveClass('glass-modal-btn-secondary');
    expect(screen.getByText(/Technical details/)).toBeInTheDocument();
    expect(screen.getAllByText(/kaboom/).length).toBeGreaterThan(0);
  });
});
