/**
 * Q7 LOW (round 9): the multi-export "unapplied enhancement" toast used to show only a count of
 * skipped images. formatSkippedNames surfaces up to 3 names inline + "and N more" beyond that.
 */
import { formatSkippedNames } from '../components/Dialogs/formatSkippedNames';

describe('formatSkippedNames', () => {
  test('a single name renders as-is', () => {
    expect(formatSkippedNames(['sunset'])).toBe('sunset');
  });

  test('exactly 3 names render fully, comma-separated, no "and N more"', () => {
    expect(formatSkippedNames(['a', 'b', 'c'])).toBe('a, b, c');
  });

  test('5 names render the first 3 plus "and 2 more"', () => {
    expect(formatSkippedNames(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c and 2 more');
  });

  test('empty list renders an empty string', () => {
    expect(formatSkippedNames([])).toBe('');
  });

  test('2 names render both, no "and N more"', () => {
    expect(formatSkippedNames(['a', 'b'])).toBe('a, b');
  });
});
