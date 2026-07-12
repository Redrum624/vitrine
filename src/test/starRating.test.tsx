/**
 * Unit tests for the shared <StarRating> presentational component.
 *
 * StarRating renders 5 clickable stars, fills them up to `rating` (gold),
 * and reports clicks via `onRate` with thumbnail-parity toggle semantics
 * (clicking the currently-active star clears the rating to 0).
 */
import { render, fireEvent, screen } from '@testing-library/react';
import { StarRating } from '../components/common/StarRating';

describe('StarRating', () => {
  it('renders exactly five stars', () => {
    render(<StarRating rating={0} onRate={() => {}} />);
    expect(screen.getAllByTestId(/^star-[1-5]$/)).toHaveLength(5);
  });

  it('fills stars up to the current rating and leaves the rest empty', () => {
    render(<StarRating rating={3} onRate={() => {}} />);
    expect(screen.getByTestId('star-1')).toHaveAttribute('data-filled', 'true');
    expect(screen.getByTestId('star-2')).toHaveAttribute('data-filled', 'true');
    expect(screen.getByTestId('star-3')).toHaveAttribute('data-filled', 'true');
    expect(screen.getByTestId('star-4')).toHaveAttribute('data-filled', 'false');
    expect(screen.getByTestId('star-5')).toHaveAttribute('data-filled', 'false');
  });

  it('reports the clicked star value when a new star is clicked', () => {
    const onRate = jest.fn();
    render(<StarRating rating={0} onRate={onRate} />);
    fireEvent.click(screen.getByTestId('star-4'));
    expect(onRate).toHaveBeenCalledWith(4);
  });

  it('clears the rating (0) when the currently-active star is clicked again', () => {
    const onRate = jest.fn();
    render(<StarRating rating={3} onRate={onRate} />);
    fireEvent.click(screen.getByTestId('star-3'));
    expect(onRate).toHaveBeenCalledWith(0);
  });

  it('honours the size prop on each star', () => {
    render(<StarRating rating={0} onRate={() => {}} size={24} />);
    // lucide forwards width/height attributes from the size prop onto the svg.
    expect(screen.getByTestId('star-1')).toHaveAttribute('width', '24');
  });
});
