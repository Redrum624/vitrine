/**
 * Unit tests for the top-left ExportProgressBar overlay.
 */
import { render, screen, fireEvent } from '@testing-library/react';

type ExportProgress = { current: number; total: number; currentName: string; cancelRequested: boolean } | null;

const requestExportCancel = jest.fn();
let mockProgress: ExportProgress = null;

jest.mock('../stores/appStore', () => ({
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({ exportProgress: mockProgress, requestExportCancel }),
}));

import { ExportProgressBar } from '../components/ExportProgressBar';

beforeEach(() => {
  jest.clearAllMocks();
  mockProgress = null;
});

it('renders nothing when there is no export in progress', () => {
  const { container } = render(<ExportProgressBar />);
  expect(container).toBeEmptyDOMElement();
});

it('shows the current/total count and the image name', () => {
  mockProgress = { current: 2, total: 5, currentName: 'photo.jpg', cancelRequested: false };
  render(<ExportProgressBar />);
  // current is a 0-based index of the in-progress item → display current+1.
  expect(screen.getByText(/Exporting 3 of 5/)).toBeInTheDocument();
  expect(screen.getByText(/photo\.jpg/)).toBeInTheDocument();
});

it('caps the displayed count at total on the final tick', () => {
  mockProgress = { current: 5, total: 5, currentName: '', cancelRequested: false };
  render(<ExportProgressBar />);
  expect(screen.getByText(/Exporting 5 of 5/)).toBeInTheDocument();
});

it('cancels when the Cancel button is clicked', () => {
  mockProgress = { current: 1, total: 4, currentName: 'a.jpg', cancelRequested: false };
  render(<ExportProgressBar />);
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
  expect(requestExportCancel).toHaveBeenCalled();
});

it('disables the Cancel button once cancellation is requested', () => {
  mockProgress = { current: 1, total: 4, currentName: 'a.jpg', cancelRequested: true };
  render(<ExportProgressBar />);
  expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
});
