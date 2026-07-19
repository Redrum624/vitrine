/**
 * Unit tests for the multi-export filename helpers.
 */
import { suffixedName, baseNameOf, EXPORT_SUFFIX } from '../utils/exportFilename';

describe('suffixedName', () => {
  it('uses the bare _VIT suffix at index 0 (post-rebrand — no more _PEP)', () => {
    expect(EXPORT_SUFFIX).toBe('_VIT');
    expect(suffixedName('photo', 'jpg', 0)).toBe('photo_VIT.jpg');
  });

  it('appends a numeric suffix for index > 0', () => {
    expect(suffixedName('photo', 'jpg', 1)).toBe('photo_VIT_1.jpg');
    expect(suffixedName('photo', 'png', 2)).toBe('photo_VIT_2.png');
  });
});

describe('baseNameOf', () => {
  it('strips a Windows directory and extension', () => {
    expect(baseNameOf('C:\\Users\\me\\Pictures\\P2060833.ORF')).toBe('P2060833');
  });

  it('strips a POSIX directory and extension', () => {
    expect(baseNameOf('/home/me/pics/pic.jpeg')).toBe('pic');
  });

  it('removes only the final extension when the name contains dots', () => {
    expect(baseNameOf('C:\\a\\b\\P206.0833.ORF')).toBe('P206.0833');
  });

  it('returns the name unchanged when there is no extension', () => {
    expect(baseNameOf('/home/me/README')).toBe('README');
  });
});
