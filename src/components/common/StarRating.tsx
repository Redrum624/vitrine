import { Star } from 'lucide-react';

/**
 * Shared star-rating control: 5 clickable stars, filled gold up to `rating`.
 *
 * Click semantics match the filmstrip thumbnails: clicking a star sets that
 * rating, and clicking the currently-active star again clears it (0). Used by
 * both the filmstrip thumbnails (small) and the canvas overlay (large).
 */
interface StarRatingProps {
  rating: number;
  onRate: (rating: number) => void;
  /** Icon size in px (default 16). */
  size?: number;
  /** Gap between stars in px (default 2). */
  gap?: number;
  /** Filled-star color override (default `#facc15`; the footer cluster uses `#eab308`). */
  color?: string;
  className?: string;
}

const FILLED_COLOR = '#facc15';
const EMPTY_COLOR = 'rgba(255,255,255,0.75)';

export function StarRating({ rating, onRate, size = 16, gap = 2, color = FILLED_COLOR, className }: StarRatingProps) {
  return (
    <div className={`inline-flex items-center ${className ?? ''}`} style={{ gap: `${gap}px` }}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= rating;
        return (
          <Star
            key={star}
            size={size}
            role="button"
            aria-label={`${star} star${star > 1 ? 's' : ''}`}
            data-testid={`star-${star}`}
            data-filled={filled ? 'true' : 'false'}
            className="cursor-pointer transition-colors"
            style={{
              color: filled ? color : EMPTY_COLOR,
              fill: filled ? color : 'none',
            }}
            onClick={(e) => {
              e.stopPropagation();
              // Clicking the active star toggles the rating off.
              onRate(star === rating ? 0 : star);
            }}
          />
        );
      })}
    </div>
  );
}
