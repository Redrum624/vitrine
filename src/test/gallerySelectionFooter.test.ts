import { formatGalleryFooterLeft } from '../utils/gallerySelection';
import type { ImageFileInfo } from '../services/FileSystemService';

const img = (name: string, size = 0): ImageFileInfo =>
  ({ id: name, name, path: `D:\\Photos\\Trip\\${name}`, size, type: 'image', dateModified: new Date(0) } as unknown as ImageFileInfo);

describe('formatGalleryFooterLeft', () => {
  it('lists path, count, RAW count and total size', () => {
    expect(formatGalleryFooterLeft([img('a.ORF', 1024 * 1024), img('b.jpg', 1024 * 1024)]))
      .toMatch(/^D:\\Photos\\Trip · 2 images · 1 RAW · 2(\.0)? MB$/);
  });

  it('omits a zero RAW count and an unknown size instead of printing "0 RAW · 0 B"', () => {
    expect(formatGalleryFooterLeft([img('a.jpg'), img('b.jpg')])).toBe('D:\\Photos\\Trip · 2 images');
  });
});
