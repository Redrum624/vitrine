/**
 * Unit tests for CopyrightService.toEmbeddableMetadata and formatDateForExif.
 *
 * These cover the renderer-side mapping from the Copyright module's
 * IPTC/XMP model onto the writer's embeddable { exif, xmp } payload, which is
 * the contract the main-process image writer (sharp withExif/withXmp) consumes.
 */
import { CopyrightService, IPTCMetadata, XMPMetadata } from '../services/CopyrightService';

const service = CopyrightService.getInstance();

describe('CopyrightService.formatDateForExif', () => {
  test('formats a date as EXIF colon format YYYY:MM:DD HH:MM:SS', () => {
    const d = new Date(2025, 1, 6, 9, 5, 3); // 2025-02-06 09:05:03 local
    expect(service.formatDateForExif(d)).toBe('2025:02:06 09:05:03');
  });
});

describe('CopyrightService.toEmbeddableMetadata', () => {
  test('maps copyright/creator/keywords onto EXIF + XMP', () => {
    const iptc: IPTCMetadata = {
      copyrightNotice: '(c) 2026 X',
      creator: 'Jane',
      title: 'Sunset',
      keywords: ['sky', 'sea'],
      rightsUsageTerms: 'Contact for use',
      credit: 'Agency',
      source: 'Original'
    };
    const xmp: XMPMetadata = {};

    const out = service.toEmbeddableMetadata(iptc, xmp);

    // EXIF universally-readable tags.
    expect(out.exif?.Copyright).toBe('(c) 2026 X');
    expect(out.exif?.Artist).toBe('Jane');
    // XMP block.
    expect(out.xmp?.rights).toBe('(c) 2026 X');
    expect(out.xmp?.creator).toEqual(['Jane']);
    expect(out.xmp?.title).toBe('Sunset');
    expect(out.xmp?.subject).toEqual(['sky', 'sea']);
    expect(out.xmp?.usageTerms).toBe('Contact for use');
    expect(out.xmp?.credit).toBe('Agency');
    expect(out.xmp?.source).toBe('Original');
  });

  test('prefers the XMP creator array and subject over IPTC fallbacks', () => {
    const iptc: IPTCMetadata = { creator: 'IptcCreator', keywords: ['ignored'] };
    const xmp: XMPMetadata = { creator: ['A', 'B'], subject: ['x', 'y'] };

    const out = service.toEmbeddableMetadata(iptc, xmp);
    expect(out.xmp?.creator).toEqual(['A', 'B']);
    expect(out.xmp?.subject).toEqual(['x', 'y']);
    // EXIF Artist still derived from the single IPTC creator field.
    expect(out.exif?.Artist).toBe('IptcCreator');
  });

  test('emits DateTimeOriginal in EXIF colon format from dateCreated', () => {
    const iptc: IPTCMetadata = {
      copyrightNotice: '(c)',
      dateCreated: new Date(2025, 1, 6, 12, 30, 0)
    };
    const out = service.toEmbeddableMetadata(iptc, {});
    expect(out.exif?.DateTimeOriginal).toBe('2025:02:06 12:30:00');
  });

  test('returns an empty object when nothing is set (no exif/xmp keys)', () => {
    const out = service.toEmbeddableMetadata({}, {});
    expect(out.exif).toBeUndefined();
    expect(out.xmp).toBeUndefined();
  });

  test('ignores an invalid dateCreated', () => {
    const iptc: IPTCMetadata = { copyrightNotice: '(c)', dateCreated: new Date('not-a-date') };
    const out = service.toEmbeddableMetadata(iptc, {});
    expect(out.exif?.DateTimeOriginal).toBeUndefined();
    expect(out.exif?.Copyright).toBe('(c)');
  });
});
